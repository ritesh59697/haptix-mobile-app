/**
 * Phase 0 spike: Helius Solana Privacy Rings on devnet (docs/PRIVATE_SEND_PLAN.md, section 3.1).
 *
 * Proves the Helius side works with plain ed25519 keys, before any app code depends on it:
 * fund two throwaway wallets, register both, deposit into A's private balance, send
 * privately A -> B, confirm an unregistered recipient is refused, withdraw from B to a public
 * address, then withdraw both remaining private balances and sweep the public SOL back to the funder. It records time, transaction size and
 * compute units per step.
 *
 * Run from this folder:  npm install && npm run spike
 *
 * Reads from the repo's `.env` (nothing here is a literal endpoint, key or amount):
 *   EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL  Helius devnet RPC with api-key (also used as the Helius key)
 *   EXPO_PUBLIC_HAPTIX_FUNDER_KEY      devnet funder, JSON array of 64 bytes
 *   HAPTIX_SPR_DEVNET_INDEXER_URL      Privacy Rings indexer: Helius unified `/v1/spr` base, no key
 *   HAPTIX_SPR_DEVNET_PROVER_URL       Privacy Rings prover:  the same base (key added from the RPC URL)
 *   (The standalone CloudFront URLs in the SDK README answered HTTP 403; see .env.example.)
 *   HAPTIX_SPR_SPIKE_BUDGET_LAMPORTS   optional; defaults to 1% of the funder's balance
 *
 * Never logs seeds or key material. Uses devnet SOL only.
 */
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  signTransactionWithSigners,
  type Address,
  type KeyPairSigner,
  type Signature,
  type Transaction,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  LocalKeys,
  SOL_MINT,
  ShieldedKeypair,
  SigningKey,
  Wallet,
  buildDepositTransaction,
  buildRegistrationTransaction,
  buildTransferTransaction,
  buildWithdrawalTransaction,
  createSprClient,
  syncWallet,
} from '@heliuslabs/spr'
import { SignedTeePolicy } from '@heliuslabs/spr/client'
import { bytes32 } from '@heliuslabs/spr/keypair'

// ---------------------------------------------------------------- config
process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. See the header of spike.ts.`)
  return value
}

const rpcUrl = required('EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL')
const indexerUrl = required('HAPTIX_SPR_DEVNET_INDEXER_URL')
const apiKey = new URL(rpcUrl).searchParams.get('api-key') ?? undefined
// The SDK's prover client takes its key from the prover URL's `api-key` query only; the
// client-level `apiKey` reaches the indexer, not the prover (seen in 0.9.0-alpha's
// `client/prover/client.js`). Without it, enclave attestation fails as "unavailable".
const proverUrl = (() => {
  const url = new URL(required('HAPTIX_SPR_DEVNET_PROVER_URL'))
  if (apiKey && !url.searchParams.has('api-key')) url.searchParams.set('api-key', apiKey)
  return url.toString()
})()
const funderBytes = Uint8Array.from(JSON.parse(required('EXPO_PUBLIC_HAPTIX_FUNDER_KEY')) as number[])

// ---------------------------------------------------------------- reporting
let passed = 0
let failed = 0
const metrics: { step: string; ms: number; bytes?: number; cu?: bigint; sig?: string }[] = []

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

function errorCode(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown }
  return typeof e?.code === 'string' ? e.code : String(e?.message ?? err)
}

/** The error and its cause chain, with any api-key in a URL redacted. */
function describeError(err: unknown): string {
  const parts: string[] = []
  let cur = err as { code?: unknown; message?: unknown; details?: unknown; cause?: unknown } | undefined
  for (let depth = 0; cur && depth < 5; depth++) {
    const details = cur.details
      ? ` ${JSON.stringify(cur.details, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`
      : ''
    parts.push(`${errorCode(cur)}${details}`)
    cur = cur.cause as typeof cur
  }
  return parts.join(' <- ').replace(/api-key=[^&"\s]+/g, 'api-key=REDACTED')
}

/** Wire size of a signed transaction: message bytes + compact-u16 count + 64 per signature. */
function wireSize(tx: Transaction): number {
  const sigs = Object.keys(tx.signatures).length
  return tx.messageBytes.length + (sigs < 128 ? 1 : 2) + 64 * sigs
}

function sol(lamports: bigint): string {
  return `${(Number(lamports) / 1e9).toFixed(6)} SOL`
}

// ---------------------------------------------------------------- setup
const client = await createSprClient({
  solanaRpcUrl: rpcUrl,
  indexerUrl,
  proverUrl,
  apiKey,
  proverTee: SignedTeePolicy.forNetwork('devnet'),
})
const rpc = client.solanaRpc
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: client.solanaRpcSubscriptions,
})

async function computeUnits(signature: Signature): Promise<bigint | undefined> {
  try {
    const tx = await rpc
      .getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 } as never)
      .send()
    const cu = (tx as { meta?: { computeUnitsConsumed?: bigint } } | null)?.meta?.computeUnitsConsumed
    return cu === undefined ? undefined : BigInt(cu)
  } catch {
    return undefined
  }
}

/** Sign, send, confirm, and record a built SDK transaction. Returns the landed slot. */
async function submit(step: string, tx: Transaction, signers: KeyPairSigner[], started: number) {
  const signed = await signTransactionWithSigners(signers, tx)
  await sendAndConfirm(signed as never, { commitment: 'confirmed' })
  const signature = getSignatureFromTransaction(signed)
  const slot = await client.confirmTransaction(signature)
  metrics.push({
    step,
    ms: Date.now() - started,
    bytes: wireSize(signed),
    cu: await computeUnits(signature),
    sig: signature,
  })
  return slot
}

async function transferSol(from: KeyPairSigner, to: Address, lamports: bigint) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [getTransferSolInstruction({ source: from, destination: to, amount: lamports })],
        m,
      ),
  )
  const signed = await signTransactionMessageWithSigners(message)
  await sendAndConfirm(signed as never, { commitment: 'confirmed' })
  return getSignatureFromTransaction(signed)
}

async function balanceOf(addr: Address): Promise<bigint> {
  return BigInt((await rpc.getBalance(addr, { commitment: 'confirmed' }).send()).value)
}

/** A throwaway ed25519 owner: the Solana signer and the shielded keypair from one seed. */
async function makeOwner() {
  const seed = webcrypto.getRandomValues(new Uint8Array(32))
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed.slice())
  const keypair = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(bytes32(seed.slice())))
  seed.fill(0)
  const wallet = new Wallet({ identity: keypair.shieldedAddress() })
  const keys = LocalKeys.fromKeypair(keypair, client.proofService)
  return { signer, keypair, wallet, keys }
}

console.log('\n--- PRIVACY RINGS DEVNET SPIKE ---\n')

const funder = await createKeyPairSignerFromBytes(funderBytes)
funderBytes.fill(0)
const funderBalance = await balanceOf(funder.address)
const budgetEnv = process.env.HAPTIX_SPR_SPIKE_BUDGET_LAMPORTS?.trim()
const budget = budgetEnv ? BigInt(budgetEnv) : funderBalance / 100n
// Amounts are fractions of the budget, so the run scales with whatever the funder holds.
const fundA = budget / 2n
const fundB = budget / 4n
const depositAmount = fundA / 2n
const transferAmount = depositAmount / 2n
const withdrawAmount = transferAmount / 2n
console.log(`  funder balance ${sol(funderBalance)}, spike budget ${sol(budget)}`)
console.log(
  `  deposit ${sol(depositAmount)}, private transfer ${sol(transferAmount)}, withdraw ${sol(withdrawAmount)}\n`,
)

const A = await makeOwner()
const B = await makeOwner()
// Kept as a signer (not just an address) so its SOL can be swept back to the funder.
const sink = await createKeyPairSignerFromPrivateKeyBytes(webcrypto.getRandomValues(new Uint8Array(32)))
const publicSink = sink.address

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    assert(false, name, describeError(err))
    return undefined
  }
}

// 1. Fund both owners from the devnet funder.
let t = Date.now()
const funded = await step('fund A and B from the devnet funder', async () => {
  await transferSol(funder, A.signer.address, fundA)
  await transferSol(funder, B.signer.address, fundB)
  return true
})
if (funded) {
  metrics.push({ step: 'fund (2 plain transfers)', ms: Date.now() - t })
  assert((await balanceOf(A.signer.address)) === fundA, 'A funded')
}

// 2. Register both owners in the user registry.
for (const [label, owner] of [
  ['A', A],
  ['B', B],
] as const) {
  if (!funded) break
  t = Date.now()
  await step(`register ${label}`, async () => {
    const reg = await buildRegistrationTransaction({
      client,
      owner: owner.signer.address,
      address: owner.keypair.shieldedAddress(),
    })
    assert(reg !== undefined, `registration for ${label} is needed the first time`)
    if (reg) await submit(`register ${label}`, reg, [owner.signer], t)
    const again = await buildRegistrationTransaction({
      client,
      owner: owner.signer.address,
      address: owner.keypair.shieldedAddress(),
    })
    assert(again === undefined, `${label} reads back as registered`)
  })
}

// 3. Deposit into A's private balance (public step: amount visible on-chain).
let depositSlot: bigint | undefined
if (funded) {
  t = Date.now()
  depositSlot = await step('deposit into A', async () => {
    await syncWallet({ client, wallet: A.wallet, keys: A.keys })
    const tx = await buildDepositTransaction({
      client,
      feePayer: A.signer.address,
      recipient: A.keypair.shieldedAddress(),
      amount: depositAmount,
    })
    return submit('deposit', tx, [A.signer], t)
  })
}
if (depositSlot !== undefined) {
  t = Date.now()
  await syncWallet({ client, wallet: A.wallet, keys: A.keys, config: { requireSlot: depositSlot } })
  metrics.push({ step: 'sync A after deposit', ms: Date.now() - t })
  const bal = A.wallet.balance(SOL_MINT).amount
  assert(bal === depositAmount, 'A private balance equals the deposit', `got ${bal}`)
}

// 4. Private transfer A -> B (amount hidden, both addresses visible).
let transferSlot: bigint | undefined
if (depositSlot !== undefined) {
  t = Date.now()
  transferSlot = await step('private transfer A -> B', async () => {
    const tx = await buildTransferTransaction({
      client,
      wallet: A.wallet,
      keys: A.keys,
      feePayer: A.signer.address,
      recipient: B.signer.address,
      amount: transferAmount,
    })
    return submit('private transfer (incl. remote proof)', tx, [A.signer], t)
  })
}
if (transferSlot !== undefined) {
  await syncWallet({ client, wallet: A.wallet, keys: A.keys, config: { requireSlot: transferSlot } })
  t = Date.now()
  await syncWallet({ client, wallet: B.wallet, keys: B.keys, config: { requireSlot: transferSlot } })
  metrics.push({ step: 'sync B to discover inbound', ms: Date.now() - t })
  const a = A.wallet.balance(SOL_MINT).amount
  const b = B.wallet.balance(SOL_MINT).amount
  assert(b === transferAmount, 'B decrypts the inbound amount', `got ${b}`)
  assert(a === depositAmount - transferAmount, 'A private balance drops by exactly the amount sent', `got ${a}`)
}

// 5. Unregistered recipient must be refused, not silently withdrawn.
if (transferSlot !== undefined) {
  const unregistered = (await createKeyPairSignerFromPrivateKeyBytes(webcrypto.getRandomValues(new Uint8Array(32))))
    .address
  try {
    await buildTransferTransaction({
      client,
      wallet: A.wallet,
      keys: A.keys,
      feePayer: A.signer.address,
      recipient: unregistered,
      amount: 1n,
    })
    assert(false, 'transfer to an unregistered address is refused', 'it built a transaction')
  } catch (err) {
    // The SDK wraps it: WALLET_BUILD_TRANSFER <- WALLET_RECIPIENT_NOT_REGISTERED.
    const chain = describeError(err)
    assert(
      chain.includes('WALLET_RECIPIENT_NOT_REGISTERED'),
      'transfer to an unregistered address is refused as not registered',
      chain,
    )
  }
}

// 6. Withdraw from B to a fresh public address.
let withdrawSlot: bigint | undefined
if (transferSlot !== undefined) {
  t = Date.now()
  withdrawSlot = await step('withdraw from B to a public address', async () => {
    const tx = await buildWithdrawalTransaction({
      client,
      wallet: B.wallet,
      keys: B.keys,
      feePayer: B.signer.address,
      recipient: publicSink,
      amount: withdrawAmount,
    })
    return submit('withdraw (incl. remote proof)', tx, [B.signer], t)
  })
}
if (withdrawSlot !== undefined) {
  await syncWallet({ client, wallet: B.wallet, keys: B.keys, config: { requireSlot: withdrawSlot } })
  assert((await balanceOf(publicSink)) === withdrawAmount, 'public address received the withdrawal')
  const b = B.wallet.balance(SOL_MINT).amount
  assert(b === transferAmount - withdrawAmount, 'B private balance drops by the withdrawal', `got ${b}`)
}

// 7. Withdraw what is left in both private balances to the funder, so re-runs cost only fees.
for (const [label, owner] of [
  ['A', A],
  ['B', B],
] as const) {
  if (withdrawSlot === undefined) break
  const left = owner.wallet.balance(SOL_MINT).amount
  if (left <= 0n) continue
  t = Date.now()
  await step(`return ${label}'s remaining private balance to the funder`, async () => {
    const tx = await buildWithdrawalTransaction({
      client,
      wallet: owner.wallet,
      keys: owner.keys,
      feePayer: owner.signer.address,
      recipient: funder.address,
      amount: left,
    })
    const slot = await submit(`return ${label} private balance`, tx, [owner.signer], t)
    await syncWallet({ client, wallet: owner.wallet, keys: owner.keys, config: { requireSlot: slot } })
    const after = owner.wallet.balance(SOL_MINT).amount
    assert(after === 0n, `${label} private balance is empty after returning it`, `got ${after}`)
  })
}

// 8. Sweep leftover public SOL back to the funder (best effort; dust stays on throwaway keys).
for (const owner of [A.signer, B.signer, sink]) {
  try {
    const bal = await balanceOf(owner.address)
    const rentMin = BigInt(await rpc.getMinimumBalanceForRentExemption(0n).send())
    // Leave two rent minimums behind so the fee never drops the remainder below rent.
    const sweep = bal - 2n * rentMin
    if (sweep > 0n) await transferSol(owner, funder.address, sweep)
  } catch {
    // leftovers are devnet SOL on a throwaway key
  }
}

// ---------------------------------------------------------------- summary
const funderAfter = await balanceOf(funder.address)
console.log(`\n  net devnet SOL spent by this run: ${sol(funderBalance - funderAfter)}`)
console.log('\n  step                                     ms     bytes   CU')
for (const m of metrics) {
  console.log(
    `  ${m.step.padEnd(40)} ${String(m.ms).padStart(6)} ${String(m.bytes ?? '-').padStart(7)}   ${m.cu ?? '-'}`,
  )
}
const sigs = metrics.filter((m) => m.sig).map((m) => `  ${m.step}: ${m.sig}`)
if (sigs.length) console.log(`\n  signatures (devnet):\n${sigs.join('\n')}`)
console.log(`\n  PRIVACY RINGS SPIKE TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
process.exit(failed > 0 ? 1 : 0)
