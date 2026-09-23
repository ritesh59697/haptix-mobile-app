/**
 * Guardian recovery, end to end against the deployed Devnet program.
 *
 * The property this suite exists to pin is the *veto*: a guardian can start a
 * recovery but cannot finish one, because cancelling requires both hardware passkeys.
 * That is the difference between a guardian and a co-owner, and it is the only reason
 * a 24h timelock is safe to ship.
 *
 * Four things are checked against devnet rather than a local validator:
 *   1. a non-guardian cannot start a recovery at all;
 *   2. recovery cannot be executed before the timelock elapses;
 *   3. the guardian's initiation freezes the wallet and stores the proposed keys;
 *   4. a 2-of-2 assertion over `CANCEL_RECOVERY` clears it and keeps the original keys.
 *
 * The last leg needs real P-256 signatures in the exact WebAuthn shape the on-chain
 * parser accepts -- rpIdHash, UP|UV flags, and a `challenge` that base64url-decodes to
 * the authorized payload -- so the assertions here are built the way a platform
 * authenticator builds them, not hand-waved.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, type TransactionInstruction } from '@solana/web3.js'
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha2'
import {
  createCancelRecoveryInstruction,
  createExecuteRecoveryInstruction,
  createInitializeWalletInstruction,
  createInitiateRecoveryInstruction,
  createPanicFreezeInstruction,
  createUnfreezeInstruction,
  fetchHaptixWallet,
  getCancelRecoverySignedMessage,
  getWalletPda,
} from '../utils/haptix-client'
import { createWebAuthnSecp256r1Instruction, webAuthnSignedRegion } from '../utils/secp256r1-instruction'
import { getDevnetRpcUrl } from '../utils/rpc-endpoints'

/**
 * Must match `RP_ID` / `IOS_ORIGIN` in the program's `webauthn.rs`. The on-chain parser
 * compares `authenticatorData[0..32]` against `sha256(RP_ID)` and requires the origin to
 * be a known one, so an assertion built for any other relying party is rejected.
 */
const RP_ID = new TextEncoder().encode('haptix-passkeys.vercel.app')
const ORIGIN = 'https://haptix-passkeys.vercel.app'

/** Anchor custom errors start at 6000, in the order declared in `error.rs`. */
const ERR_UNAUTHORIZED = 6000
const ERR_RECOVERY_TIMELOCK_NOT_ELAPSED = 6006
const ERR_INVALID_RECOVERY_TIMELOCK = 6014
const ERR_RECOVERY_IN_PROGRESS = 6015

const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile
if (typeof loadEnvFile === 'function') {
  try {
    loadEnvFile('.env')
  } catch {
    // No `.env` means no funder key, which the suite reports as a skip below.
  }
}

let passed = 0
let failed = 0

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${name}`)
    passed++
  } else {
    console.error(`  FAIL: ${name}`)
    if (detail) console.error(`        Detail: ${detail}`)
    failed++
  }
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function isAllZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0)
}

/**
 * Builds an assertion the way a platform authenticator does for `message`.
 *
 * The challenge is the raw payload base64url-encoded, which is what lets the program
 * bind the signature to this specific authorization instead of any assertion the
 * credential ever produced.
 */
function buildAssertion(privateKey: Uint8Array, message: Uint8Array) {
  const authenticatorData = new Uint8Array(37)
  authenticatorData.set(sha256(RP_ID), 0)
  authenticatorData[32] = 0x05 // UP | UV: a real user gesture, verified.
  new DataView(authenticatorData.buffer).setUint32(33, 1, false)

  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.get', challenge: base64Url(message), origin: ORIGIN }),
  )

  const signature = p256
    .sign(sha256(webAuthnSignedRegion(authenticatorData, clientDataJSON)), privateKey, { lowS: true })
    .toCompactRawBytes()

  return { signature, publicKey: p256.getPublicKey(privateKey, true), authenticatorData, clientDataJSON }
}

interface SendResult {
  ok: boolean
  signature?: string
  logs: string[]
  message?: string
}

async function send(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): Promise<SendResult> {
  const transaction = new Transaction()
  transaction.add(...instructions)
  const latest = await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = latest.blockhash
  transaction.feePayer = payer.publicKey
  transaction.sign(payer, ...signers)

  try {
    const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false })
    await connection.confirmTransaction(
      { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      'confirmed',
    )
    return { ok: true, signature, logs: [] }
  } catch (err) {
    const e = err as { logs?: string[]; message?: string }
    return { ok: false, logs: e.logs ?? [], message: e.message }
  }
}

/** Anchor reports a custom error both as a numeric code and by name in the logs. */
function mentionsError(result: SendResult, code: number, name: string): boolean {
  const hex = `0x${code.toString(16)}`
  const haystack = `${result.message ?? ''} ${result.logs.join(' ')}`
  return haystack.includes(name) || haystack.includes(`custom program error: ${hex}`)
}

function loadFunder(): Keypair | null {
  const raw = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY
  if (!raw) return null
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))
  } catch {
    return null
  }
}

async function run() {
  const funder = loadFunder()
  if (!funder) {
    console.error('  SKIP: EXPO_PUBLIC_HAPTIX_FUNDER_KEY is not set (needs a funded Devnet key).')
    process.exit(1)
  }

  const connection = new Connection(getDevnetRpcUrl(), { commitment: 'confirmed' })
  console.log(`  RPC endpoint: ${new URL(getDevnetRpcUrl()).host}`)
  console.log(`  Guardian / fee payer: ${funder.publicKey.toBase58()}`)

  const balance = await connection.getBalance(funder.publicKey)
  assert(balance > 0.5 * LAMPORTS_PER_SOL, 'the funder holds enough Devnet SOL to pay rent', `${balance} lamports`)

  // A wallet whose keys this suite holds, so the veto leg can actually sign. A wallet
  // created by the app would be unrecoverable here: its scalars live in the device's
  // secure storage, which is exactly the property being tested.
  const primaryKey = p256.utils.randomSecretKey()
  const secondaryKey = p256.utils.randomSecretKey()
  const primaryPasskey = p256.getPublicKey(primaryKey, true)
  const secondaryPasskey = p256.getPublicKey(secondaryKey, true)
  const [walletPda] = getWalletPda(primaryPasskey)

  console.log(`\n  Wallet PDA: ${walletPda.toBase58()}`)

  // --- Setup ---------------------------------------------------------------
  const init = await send(connection, funder, [
    createInitializeWalletInstruction({
      payer: funder.publicKey,
      walletPda,
      primaryPasskey,
      secondaryPasskey,
      guardian: funder.publicKey,
    }),
  ])
  assert(init.ok, 'initializes a wallet with the funder as guardian', init.message)
  if (!init.ok) {
    console.log(`\n  RECOVERY DEVNET TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
    process.exit(1)
  }

  const created = await fetchHaptixWallet(connection, walletPda)
  assert(created !== null, 'reads the wallet back from Devnet')
  if (!created) process.exit(1)

  assert(bytesEqual(created.primaryPasskey, primaryPasskey), 'stores the primary passkey verbatim')
  assert(created.guardian.equals(funder.publicKey), 'stores the guardian')
  assert(created.recoveryInitiatedAt === 0n, 'starts with no recovery in flight')
  assert(created.isFrozen === false, 'starts unfrozen')
  assert(created.recoveryTimelock === 86_400n, 'installs the 24h timelock', created.recoveryTimelock.toString())
  assert(isAllZero(created.pendingPrimaryPasskey), 'starts with no pending primary key')

  // A negative window would let a guardian rotate the keys before the owner could ever
  // see the prompt, so the program has to reject it rather than coerce it.
  // The PDA is derived from the primary key, so deriving it from a different key
  // than the one in the instruction trips the seeds constraint first and the
  // timelock check never runs.
  const negativePrimary = p256.getPublicKey(p256.utils.randomSecretKey(), true)
  const negativeWindow = await send(connection, funder, [
    createInitializeWalletInstruction({
      payer: funder.publicKey,
      walletPda: getWalletPda(negativePrimary)[0],
      primaryPasskey: negativePrimary,
      secondaryPasskey: p256.getPublicKey(p256.utils.randomSecretKey(), true),
      recoveryTimelockSeconds: -1n,
    }),
  ])
  assert(
    !negativeWindow.ok && mentionsError(negativeWindow, ERR_INVALID_RECOVERY_TIMELOCK, 'InvalidRecoveryTimelock'),
    'rejects a negative recovery timelock',
    negativeWindow.message,
  )

  // --- The guardian is the only caller that may start a recovery ------------
  const attacker = Keypair.generate()
  const attackerAttempt = await send(
    connection,
    funder, // the funder pays the fee and also signs, so only *guardian* authorization differs
    [
      createInitiateRecoveryInstruction({
        walletPda,
        guardian: attacker.publicKey,
        newPrimaryPasskey: primaryPasskey,
        newSecondaryPasskey: secondaryPasskey,
      }),
    ],
    [attacker],
  )
  assert(
    !attackerAttempt.ok && mentionsError(attackerAttempt, ERR_UNAUTHORIZED, 'Unauthorized'),
    'a non-guardian cannot initiate recovery',
    attackerAttempt.message,
  )

  const untouched = await fetchHaptixWallet(connection, walletPda)
  assert(untouched?.isFrozen === false, 'the rejected attempt leaves the wallet unfrozen')
  assert(untouched?.recoveryInitiatedAt === 0n, 'the rejected attempt starts no recovery')

  // --- Guardian initiates with replacement keys ----------------------------
  const nextPrimaryKey = p256.utils.randomSecretKey()
  const nextSecondaryKey = p256.utils.randomSecretKey()
  const nextPrimary = p256.getPublicKey(nextPrimaryKey, true)
  const nextSecondary = p256.getPublicKey(nextSecondaryKey, true)

  const initiated = await send(connection, funder, [
    createInitiateRecoveryInstruction({
      walletPda,
      guardian: funder.publicKey,
      newPrimaryPasskey: nextPrimary,
      newSecondaryPasskey: nextSecondary,
    }),
  ])
  assert(initiated.ok, 'the guardian initiates recovery', initiated.message)

  const pending = await fetchHaptixWallet(connection, walletPda)
  assert((pending?.recoveryInitiatedAt ?? 0n) > 0n, 'records when recovery was initiated')
  assert(pending?.isFrozen === true, 'freezes the wallet for the duration of the timelock')
  assert(bytesEqual(pending?.pendingPrimaryPasskey ?? new Uint8Array(), nextPrimary), 'stores the proposed primary key')
  assert(
    bytesEqual(pending?.pendingSecondaryPasskey ?? new Uint8Array(), nextSecondary),
    'stores the proposed secondary key',
  )
  assert(
    bytesEqual(pending?.primaryPasskey ?? new Uint8Array(), primaryPasskey),
    'does not install the proposed keys yet',
  )

  // --- The timelock holds --------------------------------------------------
  const early = await send(connection, funder, [createExecuteRecoveryInstruction({ walletPda })])
  assert(
    !early.ok && mentionsError(early, ERR_RECOVERY_TIMELOCK_NOT_ELAPSED, 'RecoveryTimelockNotElapsed'),
    'refuses to execute recovery before the timelock elapses',
    early.message,
  )

  const stillPending = await fetchHaptixWallet(connection, walletPda)
  assert(bytesEqual(stillPending?.primaryPasskey ?? new Uint8Array(), primaryPasskey), 'keeps the original keys')
  assert(stillPending?.isFrozen === true, 'stays frozen after a refused execute')

  // --- Unfreezing is not an escape from a pending recovery -----------------
  // The freeze applied by initiation is what makes a pending recovery visible, and the
  // wallet's own recoverable state depends on it staying set. Signed here with the
  // wallet's current 2-of-2 keys, which are still valid at this point, so the recovery
  // itself is the only thing that can be rejecting it.
  const pendingUnfreezeMsg = new TextEncoder().encode('UNFREEZE_WALLET')
  const escapeAttempt = await send(connection, funder, [
    createWebAuthnSecp256r1Instruction(buildAssertion(primaryKey, pendingUnfreezeMsg)),
    createWebAuthnSecp256r1Instruction(buildAssertion(secondaryKey, pendingUnfreezeMsg)),
    createUnfreezeInstruction({ walletPda, primarySigIxIndex: 0, secondarySigIxIndex: 1 }),
  ])
  assert(
    !escapeAttempt.ok && mentionsError(escapeAttempt, ERR_RECOVERY_IN_PROGRESS, 'RecoveryInProgress'),
    'refuses to unfreeze while a recovery is pending',
    escapeAttempt.message,
  )

  const stillFrozenAfterEscape = await fetchHaptixWallet(connection, walletPda)
  assert(stillFrozenAfterEscape?.isFrozen === true, 'stays frozen after a refused unfreeze')
  assert((stillFrozenAfterEscape?.recoveryInitiatedAt ?? 0n) > 0n, 'the refused unfreeze leaves the recovery in flight')

  // --- The owner vetoes with 2-of-2 ---------------------------------------
  const cancelMessage = getCancelRecoverySignedMessage()
  const primaryAssertion = buildAssertion(primaryKey, cancelMessage)
  const secondaryAssertion = buildAssertion(secondaryKey, cancelMessage)

  // Indices 0 and 1 are the two verifications the program reads back through the
  // instructions sysvar; the cancel instruction itself sits last.
  const cancelled = await send(connection, funder, [
    createWebAuthnSecp256r1Instruction(primaryAssertion),
    createWebAuthnSecp256r1Instruction(secondaryAssertion),
    createCancelRecoveryInstruction({ walletPda, primarySigIxIndex: 0, secondarySigIxIndex: 1 }),
  ])
  assert(cancelled.ok, 'the owner cancels recovery with a 2-of-2 quorum', cancelled.message)

  const after = await fetchHaptixWallet(connection, walletPda)
  assert(after?.recoveryInitiatedAt === 0n, 'clears the recovery timestamp')
  assert(after?.isFrozen === false, 'unfreezes the wallet')
  assert(isAllZero(after?.pendingPrimaryPasskey ?? new Uint8Array()), 'discards the proposed primary key')
  assert(isAllZero(after?.pendingSecondaryPasskey ?? new Uint8Array()), 'discards the proposed secondary key')
  assert(bytesEqual(after?.primaryPasskey ?? new Uint8Array(), primaryPasskey), 'keeps the original primary key')
  assert(bytesEqual(after?.secondaryPasskey ?? new Uint8Array(), secondaryPasskey), 'keeps the original secondary key')

  // --- One passkey is not a quorum ----------------------------------------
  // Re-initiated first on purpose: with no recovery pending the cancel would fail on
  // `NoRecoveryPending` and the run would "pass" without ever testing the quorum.
  const reInitiated = await send(connection, funder, [
    createInitiateRecoveryInstruction({
      walletPda,
      guardian: funder.publicKey,
      newPrimaryPasskey: nextPrimary,
      newSecondaryPasskey: nextSecondary,
    }),
  ])
  assert(reInitiated.ok, 'the guardian can start a second recovery', reInitiated.message)

  const onlyPrimary = await send(connection, funder, [
    createWebAuthnSecp256r1Instruction(primaryAssertion),
    // Both indices point at the same assertion, so only one distinct passkey is present.
    createCancelRecoveryInstruction({ walletPda, primarySigIxIndex: 0, secondarySigIxIndex: 0 }),
  ])
  assert(!onlyPrimary.ok, 'rejects a veto carrying only one distinct passkey', onlyPrimary.message)

  const afterFailedVeto = await fetchHaptixWallet(connection, walletPda)
  assert((afterFailedVeto?.recoveryInitiatedAt ?? 0n) > 0n, 'the rejected veto leaves recovery in flight')
  assert(afterFailedVeto?.isFrozen === true, 'the rejected veto leaves the wallet frozen')

  const finalCancel = await send(connection, funder, [
    createWebAuthnSecp256r1Instruction(primaryAssertion),
    createWebAuthnSecp256r1Instruction(secondaryAssertion),
    createCancelRecoveryInstruction({ walletPda, primarySigIxIndex: 0, secondarySigIxIndex: 1 }),
  ])
  assert(finalCancel.ok, 'the full quorum still cancels afterwards', finalCancel.message)

  const settled = await fetchHaptixWallet(connection, walletPda)
  assert(settled?.isFrozen === false, 'the wallet ends unfrozen')
  assert(settled?.recoveryInitiatedAt === 0n, 'the wallet ends with no recovery in flight')

  // --- The other half of recovery: actually rotating the keys --------------
  // A second wallet on a three-second window. Waiting out the 24h default is not
  // something a test can do, and this is the branch where the guardian's proposed keys
  // become the wallet's keys -- the thing that makes a lost phone recoverable at all.
  const lostPrimaryKey = p256.utils.randomSecretKey()
  const lostSecondaryKey = p256.utils.randomSecretKey()
  const lostPrimary = p256.getPublicKey(lostPrimaryKey, true)
  const lostSecondary = p256.getPublicKey(lostSecondaryKey, true)
  const [lostPda] = getWalletPda(lostPrimary)

  const replacementKey = p256.utils.randomSecretKey()
  const replacementSecondaryKey = p256.utils.randomSecretKey()
  const replacementPrimary = p256.getPublicKey(replacementKey, true)
  const replacementSecondary = p256.getPublicKey(replacementSecondaryKey, true)

  const lostInit = await send(connection, funder, [
    createInitializeWalletInstruction({
      payer: funder.publicKey,
      walletPda: lostPda,
      primaryPasskey: lostPrimary,
      secondaryPasskey: lostSecondary,
      guardian: funder.publicKey,
      recoveryTimelockSeconds: 3n,
    }),
  ])
  assert(lostInit.ok, 'initializes a wallet with a 3s timelock', lostInit.message)

  const lostCreated = await fetchHaptixWallet(connection, lostPda)
  assert(lostCreated?.recoveryTimelock === 3n, 'honours the configured timelock', String(lostCreated?.recoveryTimelock))

  const lostRecovery = await send(connection, funder, [
    createInitiateRecoveryInstruction({
      walletPda: lostPda,
      guardian: funder.publicKey,
      newPrimaryPasskey: replacementPrimary,
      newSecondaryPasskey: replacementSecondary,
    }),
  ])
  assert(lostRecovery.ok, 'the guardian starts recovery for the lost device', lostRecovery.message)

  await new Promise((resolve) => setTimeout(resolve, 4000))

  const executed = await send(connection, funder, [createExecuteRecoveryInstruction({ walletPda: lostPda })])
  assert(executed.ok, 'executes recovery once the window has passed', executed.message)

  const rotated = await fetchHaptixWallet(connection, lostPda)
  assert(bytesEqual(rotated?.primaryPasskey ?? new Uint8Array(), replacementPrimary), 'installs the replacement keys')
  assert(rotated?.isFrozen === false, 'unfreezes the wallet after rotation')
  assert(rotated?.recoveryInitiatedAt === 0n, 'clears the recovery state after rotation')
  assert(isAllZero(rotated?.pendingSecondaryPasskey ?? new Uint8Array()), 'discards the staged keys')

  // The address is the PDA of the *original* key, and rotation must not move it: the
  // account and its funds have to stay where the user's records point.
  assert(rotated?.pda.equals(lostPda) === true, 'keeps the wallet address after rotation')

  // --- The recovered wallet has to still be usable ------------------------
  // A rotation that leaves the account unreachable is worse than no recovery at all:
  // the address is derived from the primary passkey in every instruction's seeds
  // constraint, so overwriting that key would strand the account and its lamports at an
  // address no instruction can ever derive again. Freezing with the guardian and
  // unfreezing with the *replacement* keys proves both halves -- the account is still
  // reachable, and the new passkeys are the ones that now control it.
  const postFreeze = await send(connection, funder, [
    createPanicFreezeInstruction({ walletPda: lostPda, guardianSigner: funder.publicKey }),
  ])
  assert(postFreeze.ok, 'the recovered wallet is still reachable on-chain', postFreeze.message)

  const unfreezeMsg = new TextEncoder().encode('UNFREEZE_WALLET')
  const newPrimaryAssertion = buildAssertion(replacementKey, unfreezeMsg)
  const newSecondaryAssertion = buildAssertion(replacementSecondaryKey, unfreezeMsg)

  const newKeyUnfreeze = await send(connection, funder, [
    createWebAuthnSecp256r1Instruction(newPrimaryAssertion),
    createWebAuthnSecp256r1Instruction(newSecondaryAssertion),
    createUnfreezeInstruction({ walletPda: lostPda, primarySigIxIndex: 0, secondarySigIxIndex: 1 }),
  ])
  assert(newKeyUnfreeze.ok, 'the replacement passkeys now control the wallet', newKeyUnfreeze.message)

  // ...and the keys that were replaced must not.
  const oldKeyFreeze = await send(connection, funder, [
    createPanicFreezeInstruction({ walletPda: lostPda, guardianSigner: funder.publicKey }),
  ])
  const oldKeyUnfreeze = await send(connection, funder, [
    createWebAuthnSecp256r1Instruction(buildAssertion(lostPrimaryKey, unfreezeMsg)),
    createWebAuthnSecp256r1Instruction(buildAssertion(lostSecondaryKey, unfreezeMsg)),
    createUnfreezeInstruction({ walletPda: lostPda, primarySigIxIndex: 0, secondarySigIxIndex: 1 }),
  ])
  assert(
    oldKeyFreeze.ok && !oldKeyUnfreeze.ok,
    'the pre-rotation passkeys are rejected after rotation',
    oldKeyUnfreeze.message,
  )

  console.log(`\n  RECOVERY DEVNET TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
  if (failed > 0) process.exit(1)
}

void run()
