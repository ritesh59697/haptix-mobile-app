/**
 * Guardian-side CLI for Haptix recovery.
 *
 * Why this exists: the phone app can play both parties, because the Devnet guardian key
 * is compiled into the bundle. That makes the recovery *state machine* testable but says
 * nothing about the property recovery is built on -- that a guardian can start a
 * takeover and still not be able to finish one. Splitting the roles across two machines
 * is the only way to observe that, so this runs the guardian half from a laptop while
 * the phone stays the owner.
 *
 * What each command maps to on-chain:
 *   status      read-only; nothing is signed
 *   initiate    `initiate_recovery` - guardian signs alone, freezes the wallet
 *   execute     `execute_recovery`  - permissionless, gated only by the timelock
 *   veto-check  simulation of `cancel_recovery` - proves the owner can still veto
 *
 * The replacement keys are generated and kept here, in
 * `~/.haptix-guardian/<wallet>.json`, so `initiate` and a later `execute` agree on the
 * pair. Those keys stand in for "the new phone": after a successful `execute` this
 * machine holds the wallet's signing keys and the old device no longer does.
 *
 * Usage:
 *   npx -y tsx tools/haptix-guardian.ts status     <walletAddress>
 *   npx -y tsx tools/haptix-guardian.ts initiate   <walletAddress>
 *   npx -y tsx tools/haptix-guardian.ts execute    <walletAddress> [--force]
 *   npx -y tsx tools/haptix-guardian.ts veto-check <walletAddress>
 *
 * Options (all optional):
 *   --keypair <path>   Solana CLI keypair JSON for the guardian. Falls back to
 *                      HAPTIX_GUARDIAN_KEYPAIR, then to EXPO_PUBLIC_HAPTIX_FUNDER_KEY in
 *                      `.env` (the key Devnet wallets are created with).
 *   --rpc <url>        Overrides EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL.
 *   --force            `execute`: submit before the timelock so the program's own refusal
 *                      can be observed rather than predicted.
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js'
import { p256 } from '@noble/curves/p256'
import {
  HAPTIX_PROGRAM_ID,
  WALLET_SEED,
  createCancelRecoveryInstruction,
  createExecuteRecoveryInstruction,
  createInitiateRecoveryInstruction,
  fetchHaptixWallet,
  getWalletSeedFromState,
} from '../utils/haptix-client'
import { getDevnetRpcUrl } from '../utils/rpc-endpoints'

/**
 * `.env` is loaded from inside `main` rather than at module scope: ESM imports are
 * evaluated first, so a top-level read would run before the file is parsed and silently
 * fall back to the public endpoint.
 */
function loadEnv(): void {
  const load = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile
  if (typeof load !== 'function') return
  try {
    load('.env')
  } catch {
    // No `.env` is fine; the guardian key can come from --keypair instead.
  }
}

interface ParsedArgs {
  command: string
  wallet: string
  keypairPath?: string
  rpc?: string
  force: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  let keypairPath: string | undefined
  let rpc: string | undefined
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--keypair') keypairPath = argv[++i]
    else if (arg === '--rpc') rpc = argv[++i]
    else if (arg === '--force') force = true
    else positional.push(arg)
  }

  return { command: positional[0] ?? '', wallet: positional[1] ?? '', keypairPath, rpc, force }
}

const USAGE = [
  'haptix-guardian <command> <walletAddress>',
  '',
  '  status      show guardian, timelock, recovery state and address integrity',
  '  initiate    start a recovery: propose new keys and freeze the wallet (guardian signs)',
  '  execute     install the proposed keys once the timelock has elapsed (no signature)',
  "  veto-check  confirm the owner's 2-of-2 veto is still reachable (nothing is signed)",
  '',
  'options',
  '  --keypair <path>  guardian keypair JSON (or HAPTIX_GUARDIAN_KEYPAIR, or the .env funder)',
  '  --rpc <url>       override EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL',
  '  --force           execute: submit before the timelock, to see the program refuse',
].join('\n')

function fail(message: string): never {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function keypairFrom(raw: string, label: string): Keypair {
  try {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)))
  } catch {
    fail(`${label} is not a Solana CLI keypair (expected a JSON array of 64 bytes).`)
  }
}

function resolveGuardian(explicitPath?: string): Keypair {
  const path = explicitPath ?? process.env.HAPTIX_GUARDIAN_KEYPAIR
  if (path) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      fail(`Could not read the keypair at ${path}.`)
    }
    return keypairFrom(raw, path)
  }

  const inline = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY
  if (!inline) {
    fail(
      'No guardian key. Pass --keypair <path>, set HAPTIX_GUARDIAN_KEYPAIR, or keep ' +
        'EXPO_PUBLIC_HAPTIX_FUNDER_KEY in .env.',
    )
  }
  return keypairFrom(inline, 'EXPO_PUBLIC_HAPTIX_FUNDER_KEY')
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'hex'))
}

/**
 * The pair a recovery will install, kept on disk between `initiate` and `execute`.
 *
 * These are software scalars rather than passkeys on purpose: the point of the exercise
 * is that *this* machine ends up holding keys the phone does not have, which is what a
 * replacement device looks like.
 */
interface ProposedKeys {
  primarySecret: string
  secondarySecret: string
  primaryPublic: string
  secondaryPublic: string
  proposedAt: string
}

function proposalPath(wallet: string): string {
  return join(homedir(), '.haptix-guardian', `${wallet}.json`)
}

async function readProposal(wallet: string): Promise<ProposedKeys | null> {
  try {
    return JSON.parse(await readFile(proposalPath(wallet), 'utf8')) as ProposedKeys
  } catch {
    return null
  }
}

async function writeProposal(wallet: string, keys: ProposedKeys): Promise<void> {
  await mkdir(join(homedir(), '.haptix-guardian'), { recursive: true })
  await writeFile(proposalPath(wallet), `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 })
}

function generateProposal(): ProposedKeys {
  const primarySecret = p256.utils.randomSecretKey()
  const secondarySecret = p256.utils.randomSecretKey()
  return {
    primarySecret: hex(primarySecret),
    secondarySecret: hex(secondarySecret),
    primaryPublic: hex(p256.getPublicKey(primarySecret, true)),
    secondaryPublic: hex(p256.getPublicKey(secondarySecret, true)),
    proposedAt: new Date().toISOString(),
  }
}

/** The PDA this wallet's own state derives. A mismatch means it can no longer be reached. */
function addressFromState(state: { walletSeed: Uint8Array; primaryPasskey: Uint8Array }): string {
  const seed = getWalletSeedFromState(state)
  const [derived] = PublicKey.findProgramAddressSync([WALLET_SEED, Buffer.from(seed)], HAPTIX_PROGRAM_ID)
  return derived.toBase58()
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'elapsed'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`
}

async function loadWallet(connection: Connection, wallet: string) {
  let pda: PublicKey
  try {
    pda = new PublicKey(wallet)
  } catch {
    fail(`"${wallet}" is not a Solana address.`)
  }

  const state = await fetchHaptixWallet(connection, pda)
  if (!state) fail(`No Haptix wallet at ${wallet} on this cluster.`)
  return { pda, state }
}

async function status(connection: Connection, wallet: string): Promise<void> {
  const { pda, state } = await loadWallet(connection, wallet)
  const balance = (await connection.getBalance(pda)) / LAMPORTS_PER_SOL
  const derived = addressFromState(state)
  const remaining = state.recoveryInitiatedAt
    ? Number(state.recoveryInitiatedAt) + Number(state.recoveryTimelock) - Math.floor(Date.now() / 1000)
    : 0
  const proposal = await readProposal(wallet)

  console.log(`
wallet      ${wallet}
balance     ${balance} SOL
threshold   ${Number(state.spendThresholdLamports) / LAMPORTS_PER_SOL} SOL  (above this, both keys are required)
guardian    ${state.guardian.toBase58()}
timelock    ${state.recoveryTimelock}s (${formatRemaining(Number(state.recoveryTimelock))})
agents      ${state.agents.length}

frozen      ${state.isFrozen}
recovery    ${state.recoveryInitiatedAt ? `in flight, ${formatRemaining(remaining)} left` : 'none'}

address integrity
  derived   ${derived}
  ${derived === wallet ? 'ok - the pinned seed still derives this account, so its constraints will pass' : 'MISMATCH - not derivable from its own state, so no instruction can reach it'}

proposed keys (this machine)
  ${
    proposal
      ? `primary   ${proposal.primaryPublic}\n  secondary ${proposal.secondaryPublic}\n  staged    ${proposal.proposedAt}`
      : `none staged at ${proposalPath(wallet)} - initiate will generate a pair`
  }
`)
}

async function initiate(connection: Connection, wallet: string, guardian: Keypair): Promise<void> {
  const { pda, state } = await loadWallet(connection, wallet)

  if (!guardian.publicKey.equals(state.guardian)) {
    fail(
      `This keypair (${guardian.publicKey.toBase58()}) is not the guardian ` +
        `(${state.guardian.toBase58()}).\n  The program rejects initiate_recovery from anyone else, which is the point.`,
    )
  }
  if (state.recoveryInitiatedAt) {
    fail('A recovery is already in flight. Veto it from the phone, or execute it once the timelock elapses.')
  }

  // Reuse the staged pair when there is one. Re-generating would leave this machine
  // holding keys the program will never install.
  const proposal = (await readProposal(wallet)) ?? generateProposal()
  await writeProposal(wallet, proposal)

  const instruction = createInitiateRecoveryInstruction({
    walletPda: pda,
    guardian: guardian.publicKey,
    newPrimaryPasskey: fromHex(proposal.primaryPublic),
    newSecondaryPasskey: fromHex(proposal.secondaryPublic),
  })
  const transaction = new Transaction({
    feePayer: guardian.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
  }).add(instruction)
  transaction.sign(guardian)

  const signature = await connection.sendRawTransaction(transaction.serialize())
  await connection.confirmTransaction(signature, 'confirmed')

  const after = await fetchHaptixWallet(connection, pda)
  console.log(`
recovery started
  tx        ${signature}
  explorer  https://explorer.solana.com/tx/${signature}?cluster=devnet
  frozen    ${after?.isFrozen}

  proposed primary    ${proposal.primaryPublic}
  proposed secondary  ${proposal.secondaryPublic}

  The wallet is now frozen. On the phone you should see:
    - sends refused, because the wallet is frozen
    - unfreeze refused, because a recovery is holding the freeze
    - Veto (2-of-2), which is the owner's answer to this

  execute is refused for another ${formatRemaining(Number(state.recoveryTimelock))}.
`)
}

async function execute(connection: Connection, wallet: string, force: boolean): Promise<void> {
  const { pda, state } = await loadWallet(connection, wallet)
  if (!state.recoveryInitiatedAt) fail('No recovery is in flight, so there is nothing to execute.')

  const unlockAt = Number(state.recoveryInitiatedAt) + Number(state.recoveryTimelock)
  const remaining = unlockAt - Math.floor(Date.now() / 1000)
  if (remaining > 0 && !force) {
    console.log(`
  The timelock has ${formatRemaining(remaining)} left, and the program will refuse this.
  Re-run then, or pass --force to see the refusal now.
`)
    return
  }

  const payer = resolveGuardian()
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
  }).add(createExecuteRecoveryInstruction({ walletPda: pda }))
  transaction.sign(payer)

  const simulation = await connection.simulateTransaction(transaction)
  if (simulation.value.err) {
    const logs = (simulation.value.logs ?? []).filter((line) => line.includes('Error'))
    console.log(`
execute refused
  ${logs.join('\n  ') || JSON.stringify(simulation.value.err)}

  That is the timelock doing its job: the guardian can propose, but not install.
`)
    return
  }

  const signature = await connection.sendRawTransaction(transaction.serialize())
  await connection.confirmTransaction(signature, 'confirmed')

  const after = await fetchHaptixWallet(connection, pda)
  const derived = after ? addressFromState(after) : '(unreadable)'
  console.log(`
recovery executed
  tx        ${signature}
  explorer  https://explorer.solana.com/tx/${signature}?cluster=devnet
  address   ${derived === wallet ? `unchanged at ${wallet}` : `BROKEN: derives ${derived}`}
  frozen    ${after?.isFrozen}

  This machine now holds the keys the phone does not, which is what a lost phone looks
  like. To hand the wallet back, either re-point the guardian at a key the phone holds
  and run initiate from there, or veto from the phone before executing.
`)
}

/**
 * Read-only proof that the veto path is still open.
 *
 * `cancel_recovery` cannot be run from here -- it needs the owner's two hardware
 * passkeys. What this does show is that the instruction reaches the wallet, which is the
 * half a guardian could otherwise break by stranding the account.
 */
async function vetoCheck(connection: Connection, wallet: string): Promise<void> {
  const { pda, state } = await loadWallet(connection, wallet)
  const payer = resolveGuardian()

  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
  }).add(createCancelRecoveryInstruction({ walletPda: pda, primarySigIxIndex: 0, secondarySigIxIndex: 1 }))

  const simulation = await connection.simulateTransaction(transaction, undefined, false)
  const logs = simulation.value.logs ?? []
  const reachedWallet = logs.some((line) => line.includes('CancelRecovery'))
  const reported = logs.find((line) => line.includes('Error Message')) ?? JSON.stringify(simulation.value.err)

  console.log(`
veto reachability
  instruction reached the program   ${reachedWallet ? 'yes' : 'no'}
  program said                      ${reported}
  recovery in flight                ${state.recoveryInitiatedAt ? 'yes' : 'no'}

  ${
    reachedWallet
      ? "The account is derivable and the veto instruction is reachable. A rejection here is\n  expected: the owner's passkeys are on the phone and only the phone can supply them."
      : 'The instruction never reached the wallet. That is the stranded-account failure, and\n  no action from the owner can fix it from outside.'
  }
`)
}

async function main(): Promise<void> {
  loadEnv()
  const { command, wallet, keypairPath, rpc, force } = parseArgs(process.argv.slice(2))

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE)
    return
  }
  if (!wallet) fail(`Missing wallet address.\n\n${USAGE}`)

  const connection = new Connection(rpc ?? getDevnetRpcUrl(), 'confirmed')

  switch (command) {
    case 'status':
      return status(connection, wallet)
    case 'initiate':
      return initiate(connection, wallet, resolveGuardian(keypairPath))
    case 'execute':
      return execute(connection, wallet, force)
    case 'veto-check':
      return vetoCheck(connection, wallet)
    default:
      fail(`Unknown command "${command}".\n\n${USAGE}`)
  }
}

main().catch((err) => fail(err?.message ?? String(err)))
