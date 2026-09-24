/**
 * Spending limit governance, end to end against the deployed Devnet program.
 *
 * Verifies that:
 *  1. An unauthorized attempt (or single passkey signature) cannot update the threshold.
 *  2. A valid 2-of-2 passkey quorum (Primary + Secondary) updates `spend_threshold_lamports` on-chain.
 *  3. Subsequent on-chain reads reflect the new limit.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, type TransactionInstruction } from '@solana/web3.js'
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha2'
import {
  createInitializeWalletInstruction,
  createSetSpendThresholdInstruction,
  fetchHaptixWallet,
  getSetSpendThresholdSignedMessage,
  getWalletPda,
} from '../utils/haptix-client'
import { createWebAuthnSecp256r1Instruction, webAuthnSignedRegion } from '../utils/secp256r1-instruction'
import { getDevnetRpcUrl } from '../utils/rpc-endpoints'

const RP_ID = new TextEncoder().encode('haptix-passkeys.vercel.app')
const ORIGIN = 'https://haptix-passkeys.vercel.app'

const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile
if (typeof loadEnvFile === 'function') {
  try {
    loadEnvFile('.env')
  } catch {
    // Falls back to process.env
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

function buildAssertion(privateKey: Uint8Array, message: Uint8Array) {
  const authenticatorData = new Uint8Array(37)
  authenticatorData.set(sha256(RP_ID), 0)
  authenticatorData[32] = 0x05 // UP | UV: verified user biometric gesture
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

async function main() {
  console.log('\n--- SPEND THRESHOLD ON-CHAIN GOVERNANCE (DEVNET) ---')

  const rpcUrl = getDevnetRpcUrl()
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })
  console.log(`  RPC endpoint: ${new URL(rpcUrl).host}`)

  const rawFunder = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY?.trim()
  if (!rawFunder) {
    console.error('  SKIP: EXPO_PUBLIC_HAPTIX_FUNDER_KEY not set in environment or .env')
    process.exit(1)
  }

  let funder: Keypair
  try {
    funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawFunder)))
  } catch (err) {
    console.error('  SKIP: Could not parse funder keypair:', err)
    process.exit(1)
  }

  const funderBal = await connection.getBalance(funder.publicKey)
  assert(funderBal >= 0.05 * LAMPORTS_PER_SOL, 'funder has enough Devnet SOL for rent and fees')

  // Generate test wallet with 2 distinct P-256 keypairs
  const primaryPrivate = p256.utils.randomPrivateKey()
  const secondaryPrivate = p256.utils.randomPrivateKey()
  const primaryPublic = p256.getPublicKey(primaryPrivate, true)
  const secondaryPublic = p256.getPublicKey(secondaryPrivate, true)

  const [walletPda] = getWalletPda(primaryPublic)
  console.log(`  Test Wallet PDA: ${walletPda.toBase58()}`)

  const initialThreshold = 100_000_000n // 0.1 SOL
  const initIx = createInitializeWalletInstruction({
    payer: funder.publicKey,
    walletPda,
    primaryPasskey: primaryPublic,
    secondaryPasskey: secondaryPublic,
    guardian: funder.publicKey,
    spendThresholdLamports: initialThreshold,
    recoveryTimelockSeconds: 3600n,
  })

  const initResult = await send(connection, funder, [initIx])
  assert(initResult.ok, 'initializes wallet with 0.1 SOL spending limit', initResult.message)

  const onChainInitial = await fetchHaptixWallet(connection, walletPda)
  assert(onChainInitial !== null, 'reads created wallet from Devnet')
  assert(
    onChainInitial?.spendThresholdLamports === initialThreshold,
    'on-chain threshold matches initial 0.1 SOL',
  )

  // 1. Proves single-passkey attempt fails
  const newThreshold = 500_000_000n // 0.5 SOL
  const thresholdMessage = getSetSpendThresholdSignedMessage(newThreshold)
  const primaryAssertion = buildAssertion(primaryPrivate, thresholdMessage)

  const singlePrecompile = createWebAuthnSecp256r1Instruction({
    ...primaryAssertion,
  })
  // Attempt with same signature index for secondary -> should fail signature verification for secondary key
  const invalidIx = createSetSpendThresholdInstruction({
    walletPda,
    newThresholdLamports: newThreshold,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 0,
  })

  const failResult = await send(connection, funder, [singlePrecompile, invalidIx])
  assert(!failResult.ok, 'rejects threshold update lacking valid secondary signature')

  // 2. Proves valid 2-of-2 passkey quorum succeeds
  const secondaryAssertion = buildAssertion(secondaryPrivate, thresholdMessage)
  const primaryPrecompile = createWebAuthnSecp256r1Instruction({
    ...primaryAssertion,
  })
  const secondaryPrecompile = createWebAuthnSecp256r1Instruction({
    ...secondaryAssertion,
  })

  const validIx = createSetSpendThresholdInstruction({
    walletPda,
    newThresholdLamports: newThreshold,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 1,
  })

  const updateResult = await send(connection, funder, [primaryPrecompile, secondaryPrecompile, validIx])
  assert(updateResult.ok, 'updates threshold to 0.5 SOL with 2-of-2 quorum', updateResult.message)

  const onChainUpdated = await fetchHaptixWallet(connection, walletPda)
  assert(
    onChainUpdated?.spendThresholdLamports === newThreshold,
    'on-chain threshold verified as 0.5 SOL',
  )

  // 3. Proves lowering threshold works as well
  const loweredThreshold = 50_000_000n // 0.05 SOL
  const lowerMessage = getSetSpendThresholdSignedMessage(loweredThreshold)
  const lowerPrimaryAssertion = buildAssertion(primaryPrivate, lowerMessage)
  const lowerSecondaryAssertion = buildAssertion(secondaryPrivate, lowerMessage)

  const lowerPrimaryPrecompile = createWebAuthnSecp256r1Instruction({
    ...lowerPrimaryAssertion,
  })
  const lowerSecondaryPrecompile = createWebAuthnSecp256r1Instruction({
    ...lowerSecondaryAssertion,
  })

  const lowerIx = createSetSpendThresholdInstruction({
    walletPda,
    newThresholdLamports: loweredThreshold,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 1,
  })

  const lowerResult = await send(connection, funder, [lowerPrimaryPrecompile, lowerSecondaryPrecompile, lowerIx])
  assert(lowerResult.ok, 'lowers threshold to 0.05 SOL with 2-of-2 quorum', lowerResult.message)

  const onChainLowered = await fetchHaptixWallet(connection, walletPda)
  assert(
    onChainLowered?.spendThresholdLamports === loweredThreshold,
    'on-chain threshold verified as 0.05 SOL',
  )

  console.log(`\n  SPEND THRESHOLD TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
