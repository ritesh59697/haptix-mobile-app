import { Connection, LAMPORTS_PER_SOL, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'
import { ellipsify } from './ellipsify'

/**
 * On-chain transaction history for a Haptix wallet.
 *
 * Records are derived from `getParsedTransaction` — the real instruction list,
 * balance deltas and Anchor program logs — rather than being inferred from the
 * signature list. The previous implementation labelled every signature as a
 * 0.05 SOL transfer, which meant the history could not be trusted at all.
 */

export type TransactionType =
  | 'transfer'
  | 'airdrop'
  | 'agent_trade'
  | 'agent_session'
  | 'swap'
  | 'freeze'
  | 'unfreeze'
  | 'init'
  | 'recovery'
  | 'policy'

export type TransactionDirection = 'send' | 'receive' | 'none'

export type TransactionStatus = 'confirmed' | 'finalized' | 'failed'

export interface TransactionRecord {
  signature: string
  type: TransactionType
  direction: TransactionDirection
  amount: number
  tokenSymbol: string
  recipientOrSender: string
  timestamp: number
  status: TransactionStatus
  securityType?: string
}

/** Deduplicates by signature and returns newest first. */
export function mergeTxRecords(existing: TransactionRecord[], incoming: TransactionRecord[]): TransactionRecord[] {
  const bySignature = new Map<string, TransactionRecord>()
  for (const record of [...existing, ...incoming]) {
    if (!bySignature.has(record.signature)) {
      bySignature.set(record.signature, record)
    }
  }
  return Array.from(bySignature.values()).sort((a, b) => b.timestamp - a.timestamp)
}

/** Anchor emits `Program log: Instruction: <Name>` from its generated dispatch. */
const HAPTIX_LOG_PREFIX = 'Program log: Instruction: '

/**
 * Anchor instruction names to history categories. Checked in this order so an
 * atomic `initialize_wallet` + `execute_transfer` transaction is reported as the
 * transfer it performed, not as the setup step that made it possible.
 */
const HAPTIX_INSTRUCTION_PRIORITY: [string, TransactionType][] = [
  ['Unfreeze', 'unfreeze'],
  ['PanicFreeze', 'freeze'],
  ['AgentExecute', 'agent_trade'],
  ['ExecuteTransfer', 'transfer'],
  ['InitiateRecovery', 'recovery'],
  ['CancelRecovery', 'recovery'],
  ['ExecuteRecovery', 'recovery'],
  ['SetGuardian', 'policy'],
  ['SetSpendThreshold', 'policy'],
  ['GrantAgentSession', 'agent_session'],
  ['InitializeWallet', 'init'],
]

/**
 * Instructions that change policy rather than move funds. Their transactions
 * still cost a network fee, but that fee is not a transfer and must not be
 * presented as one.
 */
const NON_VALUE_TYPES: TransactionType[] = ['freeze', 'unfreeze', 'init', 'recovery', 'policy', 'agent_session']

const SECURITY_TYPE_BY_CATEGORY: Record<TransactionType, string> = {
  transfer: 'Secp256r1 Passkey',
  airdrop: 'Devnet Faucet',
  agent_trade: 'Zero-Prompt Agent Session',
  agent_session: '2-of-2 Passkey Quorum',
  swap: 'Jupiter Route',
  freeze: 'Guardian Panic Freeze',
  unfreeze: '2-of-2 Passkey Quorum',
  init: 'On-Chain Policy Setup',
  recovery: 'Guardian Recovery',
  policy: '2-of-2 Passkey Quorum',
}

/** Token mints worth naming. Anything else falls back to a shortened mint. */
const KNOWN_TOKEN_MINTS: Record<string, string> = {
  // USDC
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC',
  // Wrapped SOL (also used by Jupiter routes)
  So11111111111111111111111111111111111111112: 'WSOL',
}

export function tokenSymbolForMint(mint: string): string {
  return KNOWN_TOKEN_MINTS[mint] ?? ellipsify(mint, 4)
}

export function isRecordLike(value: unknown): value is TransactionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<TransactionRecord>
  return (
    typeof record.signature === 'string' &&
    typeof record.type === 'string' &&
    typeof record.direction === 'string' &&
    typeof record.amount === 'number' &&
    typeof record.tokenSymbol === 'string' &&
    typeof record.recipientOrSender === 'string' &&
    typeof record.timestamp === 'number' &&
    typeof record.status === 'string'
  )
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function haptixInstructionNames(tx: ParsedTransactionWithMeta): string[] {
  const logs = tx.meta?.logMessages ?? []
  return logs
    .filter((line) => line.startsWith(HAPTIX_LOG_PREFIX))
    .map((line) => line.slice(HAPTIX_LOG_PREFIX.length).trim())
}

function categorize(tx: ParsedTransactionWithMeta): TransactionType | null {
  const names = haptixInstructionNames(tx)
  if (names.length === 0) return null
  for (const [instructionName, category] of HAPTIX_INSTRUCTION_PRIORITY) {
    if (names.includes(instructionName)) return category
  }
  return null
}

function accountIndexOf(tx: ParsedTransactionWithMeta, address: string): number {
  const keys = tx.transaction.message.accountKeys
  return keys.findIndex((key) => key.pubkey.toBase58() === address)
}

function lamportDelta(tx: ParsedTransactionWithMeta, address: string): number | null {
  const index = accountIndexOf(tx, address)
  if (index < 0 || !tx.meta) return null
  const pre = tx.meta.preBalances[index]
  const post = tx.meta.postBalances[index]
  if (typeof pre !== 'number' || typeof post !== 'number') return null
  return post - pre
}

interface TokenDelta {
  mint: string
  amount: number
}

/**
 * Sums SPL token balance changes for every token account owned by this wallet.
 * `uiAmount` is null for zero balances, so `uiAmountString` is the fallback.
 */
function tokenDeltas(tx: ParsedTransactionWithMeta, address: string): TokenDelta[] {
  if (!tx.meta) return []
  const totals = new Map<string, number>()

  const accumulate = (balances: typeof tx.meta.preTokenBalances, sign: 1 | -1) => {
    for (const balance of balances ?? []) {
      if (balance.owner !== address) continue
      const uiAmount = balance.uiTokenAmount.uiAmount ?? Number(balance.uiTokenAmount.uiAmountString)
      if (!Number.isFinite(uiAmount)) continue
      totals.set(balance.mint, (totals.get(balance.mint) ?? 0) + sign * (uiAmount as number))
    }
  }

  accumulate(tx.meta.preTokenBalances, -1)
  accumulate(tx.meta.postTokenBalances, 1)

  return Array.from(totals.entries())
    .filter(([, amount]) => Math.abs(amount) > 0)
    .map(([mint, amount]) => ({ mint, amount }))
}

interface TransferInstructionInfo {
  source?: string
  destination?: string
  lamports?: number
  amount?: number
  mint?: string
}

function collectTransferInstructions(tx: ParsedTransactionWithMeta): TransferInstructionInfo[] {
  const collected: TransferInstructionInfo[] = []
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions),
  ]

  for (const instruction of instructions) {
    if (!('parsed' in instruction)) continue
    const parsed = instruction.parsed as {
      type?: string
      info?: Record<string, unknown>
    } | null
    if (!parsed?.type || !parsed.info) continue

    const info = parsed.info
    if (parsed.type === 'transfer' || parsed.type === 'transferWithSeed') {
      collected.push({
        source: typeof info.source === 'string' ? info.source : undefined,
        destination: typeof info.destination === 'string' ? info.destination : undefined,
        lamports: typeof info.lamports === 'number' ? info.lamports : undefined,
      })
    } else if (parsed.type === 'transferChecked') {
      const tokenAmount = info.tokenAmount as { uiAmount?: number } | undefined
      collected.push({
        source: typeof info.source === 'string' ? info.source : undefined,
        destination: typeof info.destination === 'string' ? info.destination : undefined,
        amount: typeof tokenAmount?.uiAmount === 'number' ? tokenAmount.uiAmount : undefined,
        mint: typeof info.mint === 'string' ? info.mint : undefined,
      })
    }
  }

  return collected
}

/**
 * Finds the other side of the value movement. Returns null for transactions
 * that moved nothing (freeze, policy changes), where there is no counterparty.
 */
function findCounterparty(
  tx: ParsedTransactionWithMeta,
  address: string,
  direction: TransactionDirection,
): string | null {
  const transfers = collectTransferInstructions(tx)
  for (const transfer of transfers) {
    if (direction === 'send' && transfer.source === address && transfer.destination) {
      return transfer.destination
    }
    if (direction === 'receive' && transfer.destination === address && transfer.source) {
      return transfer.source
    }
  }

  // SPL transfers move tokens between token accounts, not the wallet itself.
  // Fall back to whichever other owner shows up in the token balances.
  for (const balance of [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])]) {
    if (balance.owner && balance.owner !== address) return balance.owner
  }

  return null
}

/**
 * Converts a parsed transaction into a history record, or null when the
 * transaction has no metadata to read (RPC pruning, unsupported version).
 */
export function parseTransactionRecord(
  signature: string,
  tx: ParsedTransactionWithMeta | null,
  walletAddress: string,
): TransactionRecord | null {
  if (!tx || !tx.meta) return null

  const timestamp = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000
  const failed = tx.meta.err !== null
  const category = categorize(tx)

  const type: TransactionType = category ?? 'transfer'

  let direction: TransactionDirection = 'none'
  let amount = 0
  let tokenSymbol = 'SOL'

  if (!NON_VALUE_TYPES.includes(type)) {
    const deltas = tokenDeltas(tx, walletAddress)
    const splDelta = deltas.length > 0 ? deltas[0] : null
    const rawLamportDelta = lamportDelta(tx, walletAddress)

    if (splDelta) {
      direction = splDelta.amount > 0 ? 'receive' : 'send'
      amount = Math.abs(splDelta.amount)
      tokenSymbol = tokenSymbolForMint(splDelta.mint)
    } else if (rawLamportDelta !== null && rawLamportDelta !== 0) {
      direction = rawLamportDelta > 0 ? 'receive' : 'send'
      amount = Math.abs(rawLamportDelta) / LAMPORTS_PER_SOL
    }
  }

  const movedFunds = direction !== 'none' && amount > 0

  return {
    signature,
    type,
    direction: movedFunds ? direction : 'none',
    amount,
    tokenSymbol,
    recipientOrSender: movedFunds
      ? (findCounterparty(tx, walletAddress, direction) ?? ellipsify(signature, 6))
      : 'Haptix Policy Program',
    timestamp,
    status: failed ? 'failed' : 'confirmed',
    securityType: SECURITY_TYPE_BY_CATEGORY[type],
  }
}

/**
 * Fetches the most recent transactions for a wallet and parses each one.
 *
 * `getParsedTransaction` costs one RPC round trip per signature, which forced two
 * limits. The public endpoints answer a burst of ten parallel calls with HTTP 429,
 * and web3.js then retries that request with growing backoff — so the burst was
 * showing up as a wall of `Server responded with 429` and, because the caller
 * swallowed errors, as an empty activity list. Parses now run in small batches.
 *
 * The second limit is wasted work: a signature parsed on an earlier launch keeps its
 * stored record (the merge keeps the first copy it sees), so re-parsing it buys
 * nothing and costs a round trip. Passing `knownSignatures` makes a routine launch
 * cost one call instead of eleven.
 */
// Measured against api.devnet.solana.com: ten parallel calls returned five 429s while
// eight sequential calls all passed, so the binding limit is a rolling request budget
// (roughly ten requests) rather than concurrency. A cold launch now spends one call on
// the signature list plus at most this many parses; later launches skip everything
// already parsed and cost one call.
const TX_FETCH_LIMIT = 4
const PARSE_BATCH_SIZE = 3

export async function fetchOnChainTransactions(
  connection: Connection,
  walletAddress: PublicKey,
  options: { limit?: number; knownSignatures?: Iterable<string> } = {},
): Promise<TransactionRecord[]> {
  const { limit = TX_FETCH_LIMIT, knownSignatures = [] } = options

  const signatures = await connection.getSignaturesForAddress(walletAddress, { limit }).catch(() => [])
  if (signatures.length === 0) return []

  const known = new Set(knownSignatures)
  const pending = signatures.filter((info) => !known.has(info.signature))
  if (pending.length === 0) return []

  const parsed: (ParsedTransactionWithMeta | null)[] = []
  for (let start = 0; start < pending.length; start += PARSE_BATCH_SIZE) {
    const batch = pending.slice(start, start + PARSE_BATCH_SIZE)
    parsed.push(
      ...(await Promise.all(
        batch.map((info) =>
          connection
            .getParsedTransaction(info.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            })
            .catch(() => null),
        ),
      )),
    )
  }

  const records: TransactionRecord[] = []
  pending.forEach((info, index) => {
    const record = parseTransactionRecord(info.signature, parsed[index], walletAddress.toBase58())
    if (record) {
      if (record.status !== 'failed' && info.confirmationStatus === 'finalized') {
        record.status = 'finalized'
      }
      records.push(record)
    }
  })

  return mergeTxRecords([], records)
}
