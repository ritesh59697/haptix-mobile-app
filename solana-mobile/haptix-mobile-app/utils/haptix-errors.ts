/**
 * Turns a Solana transaction failure into a sentence a person can act on.
 *
 * `SendTransactionError.message` is a raw simulation report: the program id, the
 * `[ "Program log: ..." ]` array, and a closing note telling the reader to call
 * `getLogs()` -- which is aimed at whoever is debugging, not at the person holding the
 * phone. Handing it straight to a dialog is what put
 * `Allocate: account Address { address: D6R74Cd433mgSUzazeSn97SMAoiyZp5o11tErm3GmDvu,`
 * `base: None } already in use` on screen, clipped mid-word under the heading
 * "Initialization Failed", with the same dump repeated in a snackbar underneath.
 *
 * Nothing is discarded: `formatChainErrorForLog` keeps the full text and the program
 * logs (web3.js buffers them on the error object) for the console. This module only
 * decides what the *UI* is allowed to say.
 */

/** Failure modes worth their own sentence, most specific first. */
const EXPLANATIONS: { pattern: RegExp; describe: string }[] = [
  {
    pattern: /encoding overruns Uint8Array|packet data size|exceeds maximum packet/i,
    describe: "Transaction packet exceeded Solana's 1,232-byte network limit. Two platform hardware passkeys together exceed packet size for agent session delegation. Everyday mode uses a biometric device backup key to stay within this limit.",
  },
  {
    // `HaptixError::RecoveryInProgress` (6015). The program rejects an unfreeze while a
    // guardian recovery is pending, because the freeze is what makes the recovery
    // visible. Matched on the Anchor hex code and on the message, since web3.js puts the
    // code in `message` and the text in the program logs.
    pattern: /0x177f|recovery is in flight/i,
    describe: 'A recovery is in flight, so this wallet stays frozen until you veto it or execute it.',
  },
  {
    pattern: /already in use/i,
    describe: 'That account already exists on-chain, so there is nothing to create.',
  },
  {
    pattern: /insufficient lamports/i,
    describe: 'The paying account does not have enough SOL to cover this transfer.',
  },
  {
    pattern: /blockhash not found|block height exceeded|blockhash .* expired/i,
    describe: 'The Devnet node dropped this transaction before it confirmed. Please try again.',
  },
  {
    pattern: /\b429\b|too many requests|rate limit/i,
    describe: 'The Devnet RPC provider is rate limiting requests. Wait a moment, then retry.',
  },
  {
    pattern: /cancelled|canceled|user rejected|rejected by user|declined/i,
    describe: 'Cancelled.',
  },
]

/**
 * Markers of a raw web3.js dump rather than a message we wrote ourselves. Anything
 * matching these is replaced by the caller's fallback; anything else is already
 * human-readable (our own validation errors) and passes through untouched.
 */
const RAW_DUMP = /simulation failed|failed to send transaction|custom program error|program log:|instructionerror/i

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return ''
}

function programLogs(err: unknown): string[] {
  const logs = err && typeof err === 'object' ? (err as { logs?: unknown }).logs : undefined
  return Array.isArray(logs) ? logs.filter((line): line is string => typeof line === 'string') : []
}

/**
 * The message a dialog may show. `fallback` is the caller's own sentence describing
 * what the user was trying to do, used whenever the underlying error is a raw dump.
 */
export function describeChainError(err: unknown, fallback: string): string {
  const raw = rawMessage(err)
  for (const { pattern, describe } of EXPLANATIONS) {
    if (pattern.test(raw)) return describe
  }
  return RAW_DUMP.test(raw) ? fallback : raw || fallback
}

/** The full detail for `console.error`: message plus any program logs web3.js kept. */
export function formatChainErrorForLog(err: unknown): string {
  const logs = programLogs(err)
  const head = rawMessage(err) || String(err)
  return logs.length > 0 ? `${head}\n${logs.join('\n')}` : head
}
