/**
 * Transfer fee estimation.
 *
 * The send sheet used to print a literal `0.000005 SOL` and sum it into "Total
 * outflow". This suite pins the two things that make the live version trustworthy:
 * the cluster is actually asked (and answers with the base fee for a plain transfer),
 * and a wallet with no RPC still gets a usable number instead of zero or a crash.
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { FALLBACK_TRANSFER_FEE_LAMPORTS, LAMPORTS_PER_SIGNATURE, estimateTransferFee } from '../utils/solana-fees'
import { getDevnetRpcUrl } from '../utils/rpc-endpoints'

/**
 * `.env` is gitignored, so a fresh clone has none. Same pattern as the integration
 * suite: load it when the runtime supports it so the suite runs against the configured
 * node rather than the public endpoint.
 */
const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile
if (typeof loadEnvFile === 'function') {
  try {
    loadEnvFile('.env')
  } catch {
    // No `.env`, or a runtime without the API: the public Devnet endpoint still works.
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

async function run() {
  console.log('\nSolana transfer fees\n')

  const payer = Keypair.generate().publicKey
  const destination = Keypair.generate().publicKey

  // Fallback path: nothing is listening on this port.
  const deadConnection = new Connection('http://127.0.0.1:9', { commitment: 'confirmed' })
  const offline = await estimateTransferFee(deadConnection, {
    feePayer: payer,
    destination,
    lamports: 1_000_000n,
  })
  assert(offline.source === 'fallback', 'an unreachable RPC falls back instead of throwing')
  assert(
    offline.lamports === FALLBACK_TRANSFER_FEE_LAMPORTS,
    'the fallback is the base fee, not zero',
    `got ${offline.lamports}`,
  )
  assert(
    Math.abs(offline.sol - LAMPORTS_PER_SIGNATURE / LAMPORTS_PER_SOL) < 1e-12,
    'the fallback is reported in SOL as well as lamports',
  )

  // Live path.
  const connection = new Connection(getDevnetRpcUrl(), { commitment: 'confirmed' })
  const live = await estimateTransferFee(connection, {
    feePayer: payer,
    destination,
    lamports: 1_000_000n,
  })
  assert(live.source === 'rpc', 'a reachable cluster prices the transfer', `got ${live.source}`)
  assert(
    live.lamports === LAMPORTS_PER_SIGNATURE,
    'a plain SOL transfer costs the base fee of one signature',
    `got ${live.lamports} lamports`,
  )

  const quorum = await estimateTransferFee(connection, {
    feePayer: payer,
    destination,
    lamports: 1_000_000n,
    extraSignatures: 1,
  })
  assert(
    quorum.lamports === LAMPORTS_PER_SIGNATURE * 2,
    'each extra required signature is priced',
    `got ${quorum.lamports} lamports`,
  )

  // The estimate must not depend on the destination, or the sheet would start showing a
  // scary number when a recipient is typed.
  const otherDestination = await estimateTransferFee(connection, {
    feePayer: payer,
    destination: new PublicKey('So11111111111111111111111111111111111111112'),
    lamports: 1_000_000n,
  })
  assert(
    otherDestination.lamports === live.lamports,
    'the fee does not change with the recipient',
    `${otherDestination.lamports} vs ${live.lamports}`,
  )

  console.log(`\n  SOLANA FEES TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
  if (failed > 0) process.exit(1)
}

void run()
