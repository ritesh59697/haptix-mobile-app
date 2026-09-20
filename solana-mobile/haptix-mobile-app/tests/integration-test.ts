import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js'
import { p256 } from '@noble/curves/p256'
import {
  HAPTIX_PROGRAM_ID,
  getWalletPda,
  createInitializeWalletInstruction,
  createExecuteTransferInstruction,
  getTransferSignedMessage,
  createGrantAgentSessionInstruction,
  getGrantAgentSignedMessage,
  createAgentExecuteInstruction,
  createPanicFreezeInstruction,
  createUnfreezeInstruction,
} from '../utils/haptix-client'
import {
  createSecp256r1Instruction,
  SECP256R1_PRECOMPILE_PROGRAM_ID,
} from '../utils/secp256r1-instruction'

async function runTests() {
  console.log('\n===============================================================')
  console.log('  HAPTIX SMART WALLET — REAL OPTION A INTEGRATION TEST SUITE   ')
  console.log('===============================================================\n')

  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  PASS: ${testName}`)
      passed++
    } else {
      console.error(`  FAIL: ${testName}`)
      if (detail) console.error(`        Detail: ${detail}`)
      failed++
    }
  }

  // TEST 1: Secp256r1 Keypair Generation and Properties
  console.log('--- TEST GROUP 1: SECP256R1 CRYPTOGRAPHY ---')
  const privateKey1 = p256.utils.randomPrivateKey()
  const publicKey1 = p256.getPublicKey(privateKey1, true) // compressed 33 bytes
  assert(privateKey1.length === 32, 'Primary private key seed is exactly 32 bytes')
  assert(publicKey1.length === 33, 'Primary compressed public key is exactly 33 bytes')
  assert(
    publicKey1[0] === 0x02 || publicKey1[0] === 0x03,
    'Public key prefix is 0x02 or 0x03 SEC1 format'
  )

  const privateKey2 = p256.utils.randomPrivateKey()
  const publicKey2 = p256.getPublicKey(privateKey2, true)
  assert(publicKey2.length === 33, 'Secondary compressed public key is exactly 33 bytes')

  // TEST 2: Deterministic Anchor PDA Derivation
  console.log('\n--- TEST GROUP 2: ANCHOR PDA DERIVATION ---')
  const [walletPda, bump] = getWalletPda(publicKey1)
  assert(PublicKey.isOnCurve(walletPda.toBytes()) === false, 'Wallet address is off-curve PDA')
  assert(bump >= 0 && bump <= 255, `Valid canonical bump derived: ${bump}`)
  console.log(`      Derived Smart Wallet PDA: ${walletPda.toBase58()}`)

  // TEST 3: Solana Secp256r1 Precompile Instruction Construction
  console.log('\n--- TEST GROUP 3: SECP256R1 PRECOMPILE INSTRUCTION ---')
  const recipient = Keypair.generate().publicKey
  const amountLamports = 50_000_000n // 0.05 SOL
  const transferMsg = getTransferSignedMessage(recipient, amountLamports)
  assert(transferMsg.length === 40, 'Transfer payload is exactly 40 bytes (32B pubkey + 8B amount)')

  // Sign with noble p256 low-S
  const sig1 = p256.sign(transferMsg, privateKey1, { lowS: true })
  const compactSig1 = sig1.toCompactRawBytes()
  assert(compactSig1.length === 64, 'Compact signature is exactly 64 bytes [r (32B), s (32B)]')
  assert(sig1.hasHighS() === false, 'Signature enforces canonical low-S (s <= n/2)')

  const precompileIx = createSecp256r1Instruction({
    signature: compactSig1,
    publicKey: publicKey1,
    message: transferMsg,
  })

  assert(
    precompileIx.programId.equals(SECP256R1_PRECOMPILE_PROGRAM_ID),
    'Precompile instruction targets Secp256r1SigVerify1111111111111111111111111'
  )
  const expectedPrecompileLen = 16 + 64 + 33 + 40 // 153 bytes
  assert(
    precompileIx.data.length === expectedPrecompileLen,
    `Precompile instruction data length is ${expectedPrecompileLen} bytes`
  )
  assert(precompileIx.data[0] === 1, 'Header num_signatures is 1')

  const view = new DataView(
    precompileIx.data.buffer,
    precompileIx.data.byteOffset,
    precompileIx.data.byteLength
  )
  assert(view.getUint16(2, true) === 16, 'Signature offset is 16')
  assert(view.getUint16(6, true) === 80, 'Public key offset is 80 (16 + 64)')
  assert(view.getUint16(10, true) === 113, 'Message offset is 113 (80 + 33)')
  assert(view.getUint16(12, true) === 40, 'Message size is 40 bytes')

  // TEST 4: Anchor Instruction Discriminators and Account Layouts
  console.log('\n--- TEST GROUP 4: ANCHOR INSTRUCTION ENCODING ---')
  const payer = Keypair.generate().publicKey

  // 4a. initialize_wallet
  const initIx = createInitializeWalletInstruction({
    payer,
    walletPda,
    primaryPasskey: publicKey1,
    secondaryPasskey: publicKey2,
    spendThresholdLamports: 100_000_000n,
  })
  const initDisc = Array.from(initIx.data.subarray(0, 8))
  assert(
    JSON.stringify(initDisc) === JSON.stringify([213, 0, 239, 240, 73, 100, 188, 193]),
    'initialize_wallet discriminator matches on-chain Anchor IDL'
  )
  assert(initIx.keys.length === 3, 'initialize_wallet accounts count is 3 (payer, wallet, system)')

  // 4b. execute_transfer (1-sig low-risk)
  const transferIx1 = createExecuteTransferInstruction({
    walletPda,
    recipient,
    amountLamports,
    primarySigIxIndex: 0,
    secondarySigIxIndex: undefined,
  })
  const transferDisc = Array.from(transferIx1.data.subarray(0, 8))
  assert(
    JSON.stringify(transferDisc) === JSON.stringify([233, 126, 160, 184, 235, 206, 31, 119]),
    'execute_transfer discriminator matches on-chain Anchor IDL'
  )
  assert(transferIx1.data[18] === 0, 'execute_transfer Option<secondary_sig> is None (0) for low-risk')

  // 4c. execute_transfer (2-of-2 high-risk quorum)
  const transferIx2 = createExecuteTransferInstruction({
    walletPda,
    recipient,
    amountLamports: 200_000_000n, // 0.2 SOL > 0.1 SOL threshold
    primarySigIxIndex: 0,
    secondarySigIxIndex: 1,
  })
  assert(transferIx2.data[18] === 1, 'execute_transfer Option<secondary_sig> is Some (1) for quorum')
  assert(
    transferIx2.data.readUInt16LE(19) === 1,
    'execute_transfer secondary_sig_ix_index is 1'
  )

  // 4d. grant_agent_session
  const agentPubkey = Keypair.generate().publicKey
  const grantIx = createGrantAgentSessionInstruction({
    walletPda,
    agentPubkey,
    validForSeconds: 86400n,
    allowanceLamports: 250_000_000n,
    allowedProgram: Keypair.generate().publicKey,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 1,
  })
  const grantDisc = Array.from(grantIx.data.subarray(0, 8))
  assert(
    JSON.stringify(grantDisc) === JSON.stringify([28, 3, 173, 47, 227, 192, 15, 76]),
    'grant_agent_session discriminator matches on-chain Anchor IDL'
  )

  // 4e. agent_execute
  const agentExecIx = createAgentExecuteInstruction({
    walletPda,
    agentPubkey,
    recipient,
    amountLamports: 20_000_000n,
  })
  const agentExecDisc = Array.from(agentExecIx.data.subarray(0, 8))
  assert(
    JSON.stringify(agentExecDisc) === JSON.stringify([133, 29, 92, 254, 69, 92, 252, 191]),
    'agent_execute discriminator matches on-chain Anchor IDL'
  )
  assert(agentExecIx.keys[1].isSigner === true, 'agent_execute agent is designated transaction signer')

  // 4f. panic_freeze
  const freezeIx = createPanicFreezeInstruction({
    walletPda,
    guardianSigner: payer,
  })
  const freezeDisc = Array.from(freezeIx.data.subarray(0, 8))
  assert(
    JSON.stringify(freezeDisc) === JSON.stringify([171, 11, 80, 253, 113, 173, 145, 2]),
    'panic_freeze discriminator matches on-chain Anchor IDL'
  )

  // 4g. unfreeze
  const unfreezeIx = createUnfreezeInstruction({
    walletPda,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 1,
  })
  const unfreezeDisc = Array.from(unfreezeIx.data.subarray(0, 8))
  assert(
    JSON.stringify(unfreezeDisc) === JSON.stringify([133, 160, 68, 253, 80, 232, 218, 247]),
    'unfreeze discriminator matches on-chain Anchor IDL'
  )

  // TEST 5: Live Solana Devnet Connection & On-Chain Program Verification
  console.log('\n--- TEST GROUP 5: LIVE SOLANA DEVNET ON-CHAIN VERIFICATION ---')
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
  try {
    const programInfo = await connection.getAccountInfo(HAPTIX_PROGRAM_ID)
    assert(programInfo !== null, `Program account exists on Devnet (${HAPTIX_PROGRAM_ID.toBase58()})`)
    assert(programInfo?.executable === true, 'Program account is executable on Devnet')
    console.log(`      On-chain program data size: ${programInfo?.data.length} bytes`)
    console.log(`      On-chain program owner: ${programInfo?.owner.toBase58()}`)
  } catch (rpcErr: any) {
    console.warn('Devnet RPC query warning:', rpcErr?.message)
  }

  console.log('\n===============================================================')
  console.log(`  TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log('===============================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
