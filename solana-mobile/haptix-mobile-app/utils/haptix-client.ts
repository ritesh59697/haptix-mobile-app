import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js'
import { Buffer } from 'buffer'

export const HAPTIX_PROGRAM_ID = new PublicKey(
  'YTdPGhiX7wgA9mQPJpUXqXRFzRvMBLwRAJBWdTVUHWL'
)

export const WALLET_SEED = Buffer.from('haptix_wallet')

export interface WalletState {
  pda: PublicKey
  bump: number
  primaryPasskey: Uint8Array // 33 bytes
  secondaryPasskey: Uint8Array // 33 bytes
  spendThresholdLamports: bigint
  guardian: PublicKey
  recoveryTimelock: bigint
  recoveryInitiatedAt: bigint
  isFrozen: boolean
  agents: AgentSessionState[]
  balanceLamports: number
}

export interface AgentSessionState {
  agentPubkey: PublicKey
  validUntil: bigint
  allowanceLamports: bigint
  allowedProgram: PublicKey
}

/**
 * Derives the Haptix Wallet PDA for a 33-byte compressed Secp256r1 public key.
 * The seed uses the 32-byte slice (indices 1..33), matching &primary_passkey[1..33] on-chain.
 */
export function getWalletPda(primaryPasskey: Uint8Array): [PublicKey, number] {
  const seedSlice = primaryPasskey.length === 33 ? primaryPasskey.subarray(1, 33) : primaryPasskey
  return PublicKey.findProgramAddressSync(
    [WALLET_SEED, Buffer.from(seedSlice)],
    HAPTIX_PROGRAM_ID
  )
}

/**
 * Fetches and deserializes live on-chain Anchor state for a Haptix Wallet PDA.
 */
export async function fetchHaptixWallet(
  connection: Connection,
  walletPda: PublicKey
): Promise<WalletState | null> {
  try {
    const accountInfo = await connection.getAccountInfo(walletPda)
    if (!accountInfo || !accountInfo.data || accountInfo.data.length < 150) {
      return null
    }
    if (!accountInfo.owner.equals(HAPTIX_PROGRAM_ID)) {
      return null
    }

    const data = accountInfo.data
    // 8 bytes Anchor discriminator
    let offset = 8
    const bump = data[offset++]
    const primaryPasskey = new Uint8Array(data.subarray(offset, offset + 33))
    offset += 33
    const secondaryPasskey = new Uint8Array(data.subarray(offset, offset + 33))
    offset += 33

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const spendThresholdLamports = view.getBigUint64(offset, true)
    offset += 8

    const guardian = new PublicKey(data.subarray(offset, offset + 32))
    offset += 32

    const recoveryTimelock = view.getBigInt64(offset, true)
    offset += 8

    const recoveryInitiatedAt = view.getBigInt64(offset, true)
    offset += 8

    // Skip pending keys: 33 + 33 = 66 bytes
    offset += 66

    const isFrozen = data[offset++] === 1

    // Agent vector: 4-byte length prefix
    const agentCount = view.getUint32(offset, true)
    offset += 4

    const agents: AgentSessionState[] = []
    for (let i = 0; i < agentCount && i < 4; i++) {
      const agentPubkey = new PublicKey(data.subarray(offset, offset + 32))
      offset += 32
      const validUntil = view.getBigInt64(offset, true)
      offset += 8
      const allowanceLamports = view.getBigUint64(offset, true)
      offset += 8
      const allowedProgram = new PublicKey(data.subarray(offset, offset + 32))
      offset += 32

      agents.push({
        agentPubkey,
        validUntil,
        allowanceLamports,
        allowedProgram,
      })
    }

    return {
      pda: walletPda,
      bump,
      primaryPasskey,
      secondaryPasskey,
      spendThresholdLamports,
      guardian,
      recoveryTimelock,
      recoveryInitiatedAt,
      isFrozen,
      agents,
      balanceLamports: accountInfo.lamports,
    }
  } catch (err) {
    console.error('[Haptix Client] Error fetching wallet state:', err)
    return null
  }
}

/**
 * Builds the `initialize_wallet` instruction.
 * Discriminator: [213, 0, 239, 240, 73, 100, 188, 193]
 */
export function createInitializeWalletInstruction({
  payer,
  walletPda,
  primaryPasskey,
  secondaryPasskey,
  spendThresholdLamports,
  guardian,
}: {
  payer: PublicKey
  walletPda: PublicKey
  primaryPasskey: Uint8Array
  secondaryPasskey: Uint8Array
  spendThresholdLamports?: bigint
  guardian?: PublicKey
}): TransactionInstruction {
  if (primaryPasskey.length !== 33 || secondaryPasskey.length !== 33) {
    throw new Error('Both passkeys must be 33-byte compressed Secp256r1 keys.')
  }

  // Calculate buffer size:
  // 8 (disc) + 33 (primary) + 33 (secondary) + 1 + (spendThreshold ? 8 : 0) + 1 + (guardian ? 32 : 0)
  const spendOptionSize = spendThresholdLamports !== undefined ? 9 : 1
  const guardianOptionSize = guardian ? 33 : 1
  const totalSize = 8 + 33 + 33 + spendOptionSize + guardianOptionSize

  const buffer = Buffer.alloc(totalSize)
  let offset = 0

  // Discriminator: [213, 0, 239, 240, 73, 100, 188, 193]
  buffer.set([213, 0, 239, 240, 73, 100, 188, 193], offset)
  offset += 8

  // primary_passkey: [u8; 33]
  buffer.set(primaryPasskey, offset)
  offset += 33

  // secondary_passkey: [u8; 33]
  buffer.set(secondaryPasskey, offset)
  offset += 33

  // spend_threshold_lamports: Option<u64>
  if (spendThresholdLamports !== undefined) {
    buffer.writeUInt8(1, offset++)
    buffer.writeBigUInt64LE(spendThresholdLamports, offset)
    offset += 8
  } else {
    buffer.writeUInt8(0, offset++)
  }

  // guardian: Option<Pubkey>
  if (guardian) {
    buffer.writeUInt8(1, offset++)
    buffer.set(guardian.toBytes(), offset)
    offset += 32
  } else {
    buffer.writeUInt8(0, offset++)
  }

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buffer,
  })
}

/**
 * Computes the canonical message payload required for transfer authorization:
 * recipient (32 bytes) || amount (8 bytes in little endian) = 40 bytes total.
 */
export function getTransferSignedMessage(recipient: PublicKey, amountLamports: bigint): Uint8Array {
  const msg = new Uint8Array(40)
  msg.set(recipient.toBytes(), 0)
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength)
  view.setBigUint64(32, amountLamports, true)
  return msg
}

/**
 * Builds the `execute_transfer` instruction.
 * Discriminator: [233, 126, 160, 184, 235, 206, 31, 119]
 */
export function createExecuteTransferInstruction({
  walletPda,
  recipient,
  amountLamports,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  recipient: PublicKey
  amountLamports: bigint
  primarySigIxIndex: number
  secondarySigIxIndex?: number
}): TransactionInstruction {
  const hasSecondary = secondarySigIxIndex !== undefined
  const totalSize = 8 + 8 + 2 + (hasSecondary ? 3 : 1)
  const buffer = Buffer.alloc(totalSize)
  let offset = 0

  // Discriminator
  buffer.set([233, 126, 160, 184, 235, 206, 31, 119], offset)
  offset += 8

  // amount: u64
  buffer.writeBigUInt64LE(amountLamports, offset)
  offset += 8

  // primary_sig_ix_index: u16
  buffer.writeUInt16LE(primarySigIxIndex, offset)
  offset += 2

  // secondary_sig_ix_index: Option<u16>
  if (hasSecondary) {
    buffer.writeUInt8(1, offset++)
    buffer.writeUInt16LE(secondarySigIxIndex, offset)
    offset += 2
  } else {
    buffer.writeUInt8(0, offset++)
  }

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buffer,
  })
}

/**
 * Computes the message payload required for granting an agent session:
 * b"GRANT_AGENT:" (12B) || agent_pubkey (32B) || allowance (8B LE) || valid_for (8B LE) = 60 bytes.
 */
export function getGrantAgentSignedMessage(
  agentPubkey: PublicKey,
  allowanceLamports: bigint,
  validForSeconds: bigint
): Uint8Array {
  const prefix = Buffer.from('GRANT_AGENT:')
  const msg = new Uint8Array(prefix.length + 32 + 8 + 8)
  msg.set(prefix, 0)
  msg.set(agentPubkey.toBytes(), prefix.length)
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength)
  view.setBigUint64(prefix.length + 32, allowanceLamports, true)
  view.setBigInt64(prefix.length + 32 + 8, validForSeconds, true)
  return msg
}

/**
 * Builds the `grant_agent_session` instruction.
 * Discriminator: [28, 3, 173, 47, 227, 192, 15, 76]
 */
export function createGrantAgentSessionInstruction({
  walletPda,
  agentPubkey,
  validForSeconds,
  allowanceLamports,
  allowedProgram,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  agentPubkey: PublicKey
  validForSeconds: bigint
  allowanceLamports: bigint
  allowedProgram: PublicKey
  primarySigIxIndex: number
  secondarySigIxIndex: number
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 32 + 8 + 8 + 32 + 2 + 2)
  let offset = 0

  // Discriminator
  buffer.set([28, 3, 173, 47, 227, 192, 15, 76], offset)
  offset += 8

  // agent_pubkey: Pubkey
  buffer.set(agentPubkey.toBytes(), offset)
  offset += 32

  // valid_for_seconds: i64
  buffer.writeBigInt64LE(validForSeconds, offset)
  offset += 8

  // allowance_lamports: u64
  buffer.writeBigUInt64LE(allowanceLamports, offset)
  offset += 8

  // allowed_program: Pubkey
  buffer.set(allowedProgram.toBytes(), offset)
  offset += 32

  // primary_sig_ix_index: u16
  buffer.writeUInt16LE(primarySigIxIndex, offset)
  offset += 2

  // secondary_sig_ix_index: u16
  buffer.writeUInt16LE(secondarySigIxIndex, offset)
  offset += 2

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: buffer,
  })
}

/**
 * Builds the `agent_execute` instruction for autonomous trading/execution.
 * Discriminator: [133, 29, 92, 254, 69, 92, 252, 191]
 */
export function createAgentExecuteInstruction({
  walletPda,
  agentPubkey,
  recipient,
  amountLamports,
}: {
  walletPda: PublicKey
  agentPubkey: PublicKey
  recipient: PublicKey
  amountLamports: bigint
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 8)
  buffer.set([133, 29, 92, 254, 69, 92, 252, 191], 0)
  buffer.writeBigUInt64LE(amountLamports, 8)

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: agentPubkey, isSigner: true, isWritable: false },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buffer,
  })
}

/**
 * Builds the `panic_freeze` instruction.
 * Discriminator: [171, 11, 80, 253, 113, 173, 145, 2]
 */
export function createPanicFreezeInstruction({
  walletPda,
  guardianSigner,
}: {
  walletPda: PublicKey
  guardianSigner: PublicKey
}): TransactionInstruction {
  const buffer = Buffer.from([171, 11, 80, 253, 113, 173, 145, 2])

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: guardianSigner, isSigner: true, isWritable: false },
    ],
    data: buffer,
  })
}

/**
 * Builds the `unfreeze` instruction.
 * Requires 2-of-2 Hardware Passkey Quorum on message b"UNFREEZE_WALLET".
 * Discriminator: [133, 160, 68, 253, 80, 232, 218, 247]
 */
export function createUnfreezeInstruction({
  walletPda,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  primarySigIxIndex: number
  secondarySigIxIndex: number
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 2 + 2)
  buffer.set([133, 160, 68, 253, 80, 232, 218, 247], 0)
  buffer.writeUInt16LE(primarySigIxIndex, 8)
  buffer.writeUInt16LE(secondarySigIxIndex, 10)

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: buffer,
  })
}
