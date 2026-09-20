import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'

export const SECP256R1_PRECOMPILE_PROGRAM_ID = new PublicKey(
  'Secp256r1SigVerify1111111111111111111111111'
)

export interface Secp256r1VerifyInstructionParams {
  signature: Uint8Array // 64-byte compact signature [r (32B), s (32B)] with canonical low-s
  publicKey: Uint8Array // 33-byte compressed Secp256r1 public key (0x02 or 0x03 prefix)
  message: Uint8Array // Raw message bytes that was signed
}

/**
 * Constructs an authentic Solana Secp256r1SigVerify precompile instruction.
 *
 * SIMD-0075 / Solana Secp256r1 instruction layout:
 * - [0..1]:   num_signatures (u8 = 1)
 * - [1..2]:   padding (u8 = 0)
 * - [2..4]:   signature_offset (u16 LE = 16)
 * - [4..6]:   signature_instruction_index (u16 LE = 0xFFFF for current instruction)
 * - [6..8]:   public_key_offset (u16 LE = 80)
 * - [8..10]:  public_key_instruction_index (u16 LE = 0xFFFF)
 * - [10..12]: message_data_offset (u16 LE = 113)
 * - [12..14]: message_data_size (u16 LE = message.length)
 * - [14..16]: message_instruction_index (u16 LE = 0xFFFF)
 * - [16..80]: raw signature (64 bytes)
 * - [80..113]: compressed public key (33 bytes)
 * - [113..113+N]: message data (N bytes)
 */
export function createSecp256r1Instruction({
  signature,
  publicKey,
  message,
}: Secp256r1VerifyInstructionParams): TransactionInstruction {
  if (signature.length !== 64) {
    throw new Error(`Invalid Secp256r1 signature length: expected 64, got ${signature.length}`)
  }
  if (publicKey.length !== 33) {
    throw new Error(`Invalid Secp256r1 public key length: expected 33, got ${publicKey.length}`)
  }

  const HEADER_SIZE = 16
  const SIGNATURE_OFFSET = HEADER_SIZE // 16
  const PUBKEY_OFFSET = SIGNATURE_OFFSET + 64 // 80
  const MESSAGE_OFFSET = PUBKEY_OFFSET + 33 // 113
  const TOTAL_SIZE = MESSAGE_OFFSET + message.length

  const buffer = new Uint8Array(TOTAL_SIZE)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // Header
  buffer[0] = 1 // 1 signature
  buffer[1] = 0 // padding

  // Offsets
  view.setUint16(2, SIGNATURE_OFFSET, true)
  view.setUint16(4, 0xffff, true) // current instruction

  view.setUint16(6, PUBKEY_OFFSET, true)
  view.setUint16(8, 0xffff, true) // current instruction

  view.setUint16(10, MESSAGE_OFFSET, true)
  view.setUint16(12, message.length, true)
  view.setUint16(14, 0xffff, true) // current instruction

  // Signature bytes [16..80]
  buffer.set(signature, SIGNATURE_OFFSET)

  // Compressed public key bytes [80..113]
  buffer.set(publicKey, PUBKEY_OFFSET)

  // Message bytes [113..]
  buffer.set(message, MESSAGE_OFFSET)

  return new TransactionInstruction({
    programId: SECP256R1_PRECOMPILE_PROGRAM_ID,
    keys: [],
    data: Buffer.from(buffer),
  })
}
