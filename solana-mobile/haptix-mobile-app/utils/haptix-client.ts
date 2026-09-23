import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js'
import { Buffer } from 'buffer'

export const HAPTIX_PROGRAM_ID = new PublicKey('9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke')

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
  /** Candidate keys proposed by an in-flight recovery; all zero when none is active. */
  pendingPrimaryPasskey: Uint8Array // 33 bytes
  pendingSecondaryPasskey: Uint8Array // 33 bytes
  isFrozen: boolean
  agents: AgentSessionState[]
  /**
   * The 32 bytes this account's address was derived from, pinned at creation.
   *
   * A recovery rotation rewrites `primaryPasskey`, so deriving the address from that
   * field after a rotation lands on an account that does not exist. This is the seed to
   * derive from once a wallet has been recovered; all zeroes means the wallet has never
   * been rotated, and `primaryPasskey` is still the seed.
   */
  walletSeed: Uint8Array // 32 bytes
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
  return PublicKey.findProgramAddressSync([WALLET_SEED, Buffer.from(seedSlice)], HAPTIX_PROGRAM_ID)
}

/**
 * The PDA seed for a wallet whose on-chain state is known.
 *
 * `getWalletPda` derives from a passkey, which is only correct while the passkey is the
 * one the account was created with. After a recovery rotation the account keeps its
 * address but its primary passkey is a different key, so anything that needs to re-derive
 * (or explain) the address has to go through the pinned seed instead.
 */
export function getWalletSeedFromState(state: { walletSeed: Uint8Array; primaryPasskey: Uint8Array }): Uint8Array {
  const allZero = state.walletSeed.every((b) => b === 0)
  if (!allZero) return state.walletSeed
  return state.primaryPasskey.length === 33 ? state.primaryPasskey.subarray(1, 33) : state.primaryPasskey
}

/**
 * Reads a guardian address stored on a wallet record.
 *
 * Returns null rather than throwing: a record written by an older build, or one whose
 * guardian was mistyped before validation existed, must not make every on-chain action
 * fail. Null simply leaves the program's own default in place.
 */
export function parseGuardianAddress(value?: string | null): PublicKey | null {
  const candidate = (value ?? '').trim()
  if (!candidate) return null
  try {
    return new PublicKey(candidate)
  } catch {
    return null
  }
}

/**
 * Fetches and deserializes live on-chain Anchor state for a Haptix Wallet PDA.
 */
export async function fetchHaptixWallet(connection: Connection, walletPda: PublicKey): Promise<WalletState | null> {
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

    // Candidate keys proposed while a recovery is in flight. These are the keys the
    // guardian asked to install, so they are what a veto is rejecting; zeroes mean no
    // recovery is pending.
    const pendingPrimaryPasskey = new Uint8Array(data.subarray(offset, offset + 33))
    offset += 33
    const pendingSecondaryPasskey = new Uint8Array(data.subarray(offset, offset + 33))
    offset += 33

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
      pendingPrimaryPasskey,
      pendingSecondaryPasskey,
      isFrozen,
      agents,
      // Accounts created before the seed field existed leave this all zeroes, which is
      // also the "never rotated" marker, so both cases read the same.
      walletSeed: offset + 32 <= data.length ? new Uint8Array(data.subarray(offset, offset + 32)) : new Uint8Array(32),
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
  recoveryTimelockSeconds,
}: {
  payer: PublicKey
  walletPda: PublicKey
  primaryPasskey: Uint8Array
  secondaryPasskey: Uint8Array
  spendThresholdLamports?: bigint
  guardian?: PublicKey
  recoveryTimelockSeconds?: bigint
}): TransactionInstruction {
  if (primaryPasskey.length !== 33 || secondaryPasskey.length !== 33) {
    throw new Error('Both passkeys must be 33-byte compressed Secp256r1 keys.')
  }

  // Calculate buffer size:
  // 8 (disc) + 33 + 33 + Option<u64> + Option<Pubkey> + Option<i64>, each option costing
  // a 1-byte tag plus its payload when present.
  const spendOptionSize = spendThresholdLamports !== undefined ? 9 : 1
  const guardianOptionSize = guardian ? 33 : 1
  const timelockOptionSize = recoveryTimelockSeconds !== undefined ? 9 : 1
  const totalSize = 8 + 33 + 33 + spendOptionSize + guardianOptionSize + timelockOptionSize

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

  // recovery_timelock_seconds: Option<i64>
  if (recoveryTimelockSeconds !== undefined) {
    buffer.writeUInt8(1, offset++)
    buffer.writeBigInt64LE(recoveryTimelockSeconds, offset)
    offset += 8
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
  validForSeconds: bigint,
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
 * Computes the message payload required for revoking an agent session:
 * b"REVOKE_AGENT:" (13B) || agent_pubkey (32B) = 45 bytes.
 */
export function getRevokeAgentSignedMessage(agentPubkey: PublicKey): Uint8Array {
  const prefix = Buffer.from('REVOKE_AGENT:')
  const msg = new Uint8Array(prefix.length + 32)
  msg.set(prefix, 0)
  msg.set(agentPubkey.toBytes(), prefix.length)
  return msg
}

/**
 * Builds the `revoke_agent_session` instruction.
 * Discriminator: [233, 61, 198, 225, 102, 73, 225, 49]
 */
export function createRevokeAgentSessionInstruction({
  walletPda,
  agentPubkey,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  agentPubkey: PublicKey
  primarySigIxIndex: number
  secondarySigIxIndex: number
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 32 + 2 + 2)
  buffer.set([233, 61, 198, 225, 102, 73, 225, 49], 0)
  buffer.set(agentPubkey.toBytes(), 8)
  buffer.writeUInt16LE(primarySigIxIndex, 40)
  buffer.writeUInt16LE(secondarySigIxIndex, 42)

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
 * Requires a 2-of-2 passkey quorum on message b"UNFREEZE_WALLET".
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

/**
 * The payload a 2-of-2 quorum signs to point the wallet at a new guardian.
 *
 * The address is inside the signed bytes, so a signature collected for one guardian
 * cannot be replayed to install a different one.
 */
export function getSetGuardianSignedMessage(newGuardian: PublicKey): Uint8Array {
  const prefix = new TextEncoder().encode('SET_GUARDIAN:')
  const message = new Uint8Array(prefix.length + 32)
  message.set(prefix, 0)
  message.set(new Uint8Array(newGuardian.toBuffer()), prefix.length)
  return message
}

/**
 * The payload a 2-of-2 quorum signs to move the spending threshold.
 */
export function getSetSpendThresholdSignedMessage(newThresholdLamports: bigint): Uint8Array {
  const prefix = new TextEncoder().encode('SET_THRESHOLD:')
  const message = new Uint8Array(prefix.length + 8)
  message.set(prefix, 0)
  // Written straight into the message rather than through a Buffer: the program reads
  // this as a little-endian u64, so the byte order is the whole point.
  new DataView(message.buffer).setBigUint64(prefix.length, newThresholdLamports, true)
  return message
}

/**
 * Builds the `set_guardian` instruction.
 *
 * The guardian is the one address that can start a recovery, and it is fixed when the
 * account is created -- there was no way to move it afterwards, which left every wallet
 * pointing at whoever was configured first. Changing it needs the full 2-of-2 owner
 * quorum, so a guardian cannot appoint its own successor.
 *
 * Discriminator: [147, 243, 50, 121, 154, 164, 50, 30]
 */
export function createSetGuardianInstruction({
  walletPda,
  newGuardian,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  newGuardian: PublicKey
  primarySigIxIndex: number
  secondarySigIxIndex: number
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 32 + 2 + 2)
  buffer.set([147, 243, 50, 121, 154, 164, 50, 30], 0)
  buffer.set(new Uint8Array(newGuardian.toBuffer()), 8)
  buffer.writeUInt16LE(primarySigIxIndex, 40)
  buffer.writeUInt16LE(secondarySigIxIndex, 42)

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
 * Builds the `set_spend_threshold` instruction.
 *
 * Like the guardian, the threshold was write-once: the app read it from chain and showed
 * it, but nothing ever wrote a new one, so the quorum boundary was stuck at whatever the
 * wallet was created with. Also 2-of-2.
 *
 * Discriminator: [174, 99, 85, 154, 250, 74, 170, 124]
 */
export function createSetSpendThresholdInstruction({
  walletPda,
  newThresholdLamports,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  newThresholdLamports: bigint
  primarySigIxIndex: number
  secondarySigIxIndex: number
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 8 + 2 + 2)
  buffer.set([174, 99, 85, 154, 250, 74, 170, 124], 0)
  buffer.writeBigUInt64LE(newThresholdLamports, 8)
  buffer.writeUInt16LE(primarySigIxIndex, 16)
  buffer.writeUInt16LE(secondarySigIxIndex, 18)

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
 * The payload a 2-of-2 quorum signs to veto an in-flight recovery.
 *
 * The program compares this byte-for-byte against the base64url-decoded
 * `clientDataJSON.challenge`, so the veto cannot be replayed from a signature the
 * owner made for some other action.
 */
export function getCancelRecoverySignedMessage(): Uint8Array {
  return new TextEncoder().encode('CANCEL_RECOVERY')
}

/**
 * Builds the `initiate_recovery` instruction.
 *
 * Only the stored guardian may call this, so a compromised passkey alone cannot
 * redirect the wallet. The instruction proposes the replacement keys; it does not
 * install them, and it freezes the wallet so the account cannot be drained while the
 * owner still has time to veto.
 *
 * Discriminator: [132, 148, 60, 74, 49, 178, 235, 187]
 */
export function createInitiateRecoveryInstruction({
  walletPda,
  guardian,
  newPrimaryPasskey,
  newSecondaryPasskey,
}: {
  walletPda: PublicKey
  guardian: PublicKey
  newPrimaryPasskey: Uint8Array
  newSecondaryPasskey: Uint8Array
}): TransactionInstruction {
  if (newPrimaryPasskey.length !== 33 || newSecondaryPasskey.length !== 33) {
    throw new Error('Both replacement passkeys must be 33-byte compressed Secp256r1 keys.')
  }

  const buffer = Buffer.alloc(8 + 33 + 33)
  buffer.set([132, 148, 60, 74, 49, 178, 235, 187], 0)
  buffer.set(newPrimaryPasskey, 8)
  buffer.set(newSecondaryPasskey, 41)

  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [
      { pubkey: walletPda, isSigner: false, isWritable: true },
      { pubkey: guardian, isSigner: true, isWritable: false },
    ],
    data: buffer,
  })
}

/**
 * Builds the `cancel_recovery` instruction.
 *
 * Cancels a guardian's in-flight recovery. Requires a 2-of-2 passkey quorum on
 * `b"CANCEL_RECOVERY"`, which is why the guardian cannot unilaterally take over an
 * account: the owner keeps the last word, and the veto needs both hardware keys.
 *
 * The signature instruction indices must point at the two `Secp256r1SigVerify`
 * instructions in the same transaction, which the program reads back through the
 * instructions sysvar rather than trusting.
 *
 * Discriminator: [176, 23, 203, 37, 121, 251, 227, 83]
 */
export function createCancelRecoveryInstruction({
  walletPda,
  primarySigIxIndex,
  secondarySigIxIndex,
}: {
  walletPda: PublicKey
  primarySigIxIndex: number
  secondarySigIxIndex: number
}): TransactionInstruction {
  const buffer = Buffer.alloc(8 + 2 + 2)
  buffer.set([176, 23, 203, 37, 121, 251, 227, 83], 0)
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

/**
 * Builds the `execute_recovery` instruction.
 *
 * Installs the pending keys and unfreezes the wallet. The program refuses this until
 * `recovery_timelock` seconds have elapsed since initiation, which is the window the
 * owner gets to cancel. Needs no signature of its own: the timelock and the stored
 * pending keys are the authorization.
 *
 * Discriminator: [203, 133, 133, 228, 153, 121, 182, 237]
 */
export function createExecuteRecoveryInstruction({ walletPda }: { walletPda: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: HAPTIX_PROGRAM_ID,
    keys: [{ pubkey: walletPda, isSigner: false, isWritable: true }],
    data: Buffer.from([203, 133, 133, 228, 153, 121, 182, 237]),
  })
}
