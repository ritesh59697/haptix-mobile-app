import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha2'

export const SECP256R1_PRECOMPILE_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111')

/**
 * Mode selector written into the precompile instruction's `padding` byte.
 *
 * The runtime's Secp256r1 precompile explicitly does not read or validate this byte,
 * which makes it a free discriminator for the program's own parser.
 */
export const MODE_LEGACY = 0x00
export const MODE_WEBAUTHN = 0x01

/** A WebAuthn assertion exactly as the platform authenticator returns it. */
export interface WebAuthnAssertion {
  /** DER-encoded, as the authenticator returns it (normalised before verification). */
  signature: Uint8Array
  authenticatorData: Uint8Array
  clientDataJSON: Uint8Array
}

/**
 * The bytes a platform authenticator signs for an assertion.
 *
 * A passkey never signs an arbitrary payload: the signature covers
 * `authenticatorData || sha256(clientDataJSON)`. The precompile hashes whichever byte
 * range the message offsets point at, so pointing that range here is what makes the
 * digest it verifies the digest the authenticator produced.
 */
export function webAuthnSignedRegion(authenticatorData: Uint8Array, clientDataJSON: Uint8Array): Uint8Array {
  const clientDataHash = sha256(clientDataJSON)
  const region = new Uint8Array(authenticatorData.length + clientDataHash.length)
  region.set(authenticatorData, 0)
  region.set(clientDataHash, authenticatorData.length)
  return region
}

/**
 * True when `assertion` was produced by the credential holding `compressedPublicKey`.
 *
 * Mirrors what the runtime precompile does -- sha256 the signed region, then verify with
 * ES256 -- so a "match" here means the chain would accept this credential for that key.
 * The DER signature the authenticator returns is normalised to the compact low-S form
 * the precompile requires, so a high-S assertion the chain accepts is not rejected here.
 *
 * Malformed input answers "no match" instead of throwing: this is an identity question,
 * and the caller treats a non-match as an ordinary outcome (it tries the next candidate
 * key, then reports that the passkey does not belong to the wallet).
 */
export function assertionMatchesPublicKey(assertion: WebAuthnAssertion, compressedPublicKey: Uint8Array): boolean {
  if (compressedPublicKey.length !== 33) return false
  try {
    const signature = p256.Signature.fromDER(assertion.signature).normalizeS().toCompactRawBytes()
    const digest = sha256(webAuthnSignedRegion(assertion.authenticatorData, assertion.clientDataJSON))
    return p256.verify(signature, digest, compressedPublicKey, { lowS: true })
  } catch {
    return false
  }
}

/**
 * Which of a wallet's two on-chain keys signed this assertion, if either.
 *
 * Recovery has no other way to tell which credential the user just picked: an assertion
 * carries a credential id and a signature, never a public key. Verifying against the keys
 * the account already holds turns "is this the right passkey?" into a fact rather than a
 * guess -- binding the wrong credential produced a wallet whose every 2-of-2 action
 * failed the precompile's signature check, with nothing on screen to explain why.
 */
export function matchWebAuthnAssertion(
  assertion: WebAuthnAssertion,
  keys: { primary: Uint8Array; secondary: Uint8Array },
): 'primary' | 'secondary' | null {
  if (assertionMatchesPublicKey(assertion, keys.primary)) return 'primary'
  if (assertionMatchesPublicKey(assertion, keys.secondary)) return 'secondary'
  return null
}

export interface Secp256r1VerifyInstructionParams {
  signature: Uint8Array // 64-byte compact signature [r (32B), s (32B)] with canonical low-s
  publicKey: Uint8Array // 33-byte compressed Secp256r1 public key (0x02 or 0x03 prefix)
  message: Uint8Array // Raw message bytes that was signed
  /**
   * Present for hardware (WebAuthn) passkeys. The authenticator signed
   * `authenticatorData || sha256(clientDataJSON)`, so those bytes — not `message` —
   * have to fill the precompile's message region.
   */
  authenticatorData?: Uint8Array
  clientDataJSON?: Uint8Array
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
  authenticatorData,
  clientDataJSON,
}: Secp256r1VerifyInstructionParams): TransactionInstruction {
  if (signature.length !== 64) {
    throw new Error(`Invalid Secp256r1 signature length: expected 64, got ${signature.length}`)
  }
  if (publicKey.length !== 33) {
    throw new Error(`Invalid Secp256r1 public key length: expected 33, got ${publicKey.length}`)
  }

  if (authenticatorData && clientDataJSON) {
    return createWebAuthnSecp256r1Instruction({ signature, publicKey, authenticatorData, clientDataJSON })
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
  buffer[1] = MODE_LEGACY // padding: the runtime ignores it, our program reads it

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

export interface WebAuthnSecp256r1InstructionParams {
  signature: Uint8Array // 64-byte compact low-S signature over authenticatorData || sha256(clientDataJSON)
  publicKey: Uint8Array // 33-byte compressed Secp256r1 public key
  authenticatorData: Uint8Array // raw authenticatorData from the WebAuthn assertion
  clientDataJSON: Uint8Array // raw clientDataJSON from the WebAuthn assertion
}

/**
 * Constructs a Secp256r1SigVerify precompile instruction for a hardware passkey.
 *
 * A platform authenticator never signs an arbitrary payload: it signs
 * `authenticatorData || sha256(clientDataJSON)`. The precompile hashes whatever
 * byte range the message offsets point at, so pointing the message region at exactly
 * those bytes makes the digest it verifies the digest the authenticator produced.
 *
 * The program then has to validate the assertion itself, because that region is now
 * caller-supplied rather than computed on-chain. It needs the clientDataJSON to do
 * that, so the assertion travels alongside the message rather than being thrown away:
 *
 * - [0]       num_signatures = 1
 * - [1]       mode = 0x01 (WebAuthn)  — ignored by the runtime precompile
 * - [2..4]    signature_offset = 18
 * - [4..6]    signature_instruction_index = 0xFFFF (this instruction)
 * - [6..8]    public_key_offset = 82
 * - [8..10]   public_key_instruction_index = 0xFFFF
 * - [10..12]  message_data_offset = 115
 * - [12..14]  message_data_size = A + 32   (the *signed* region only)
 * - [14..16]  message_instruction_index = 0xFFFF
 * - [16..18]  clientDataJSON length (u16 LE)  — sits in the gap the precompile ignores
 * - [18..82]  signature (64 bytes)
 * - [82..115] compressed public key (33 bytes)
 * - [115..115+A+32]  authenticatorData || sha256(clientDataJSON)   ← hashed & verified
 * - [115+A+32..115+A+32+C]  clientDataJSON                        ← carried, not signed
 *
 * `clientDataJSON` deliberately sits *outside* `message_data_size`. Including it in the
 * hashed region would change the digest the precompile computes and no longer match what
 * the authenticator signed. It is not lost: the on-chain parser reads the length at
 * `[16..18]`, checks the total instruction length is exactly
 * `115 + (A + 32) + C`, and re-hashes the clientDataJSON to confirm it matches the
 * 32-byte trailer inside the signed region — so the two cannot be decoupled.
 */
export function createWebAuthnSecp256r1Instruction({
  signature,
  publicKey,
  authenticatorData,
  clientDataJSON,
}: WebAuthnSecp256r1InstructionParams): TransactionInstruction {
  if (signature.length !== 64) {
    throw new Error(`Invalid Secp256r1 signature length: expected 64, got ${signature.length}`)
  }
  if (publicKey.length !== 33) {
    throw new Error(`Invalid Secp256r1 public key length: expected 33, got ${publicKey.length}`)
  }
  if (authenticatorData.length === 0) {
    throw new Error('WebAuthn assertion is missing authenticatorData')
  }
  if (clientDataJSON.length === 0) {
    throw new Error('WebAuthn assertion is missing clientDataJSON')
  }

  const HEADER_SIZE = 16
  const CDJ_LENGTH_OFFSET = HEADER_SIZE // 16
  const SIGNATURE_OFFSET = CDJ_LENGTH_OFFSET + 2 // 18
  const PUBKEY_OFFSET = SIGNATURE_OFFSET + 64 // 82
  const MESSAGE_OFFSET = PUBKEY_OFFSET + 33 // 115

  // The signed region is `authenticatorData || sha256(clientDataJSON)` and nothing else.
  // Appending the clientDataJSON here would change the digest the precompile computes,
  // and the authenticator never signed those bytes.
  const message = webAuthnSignedRegion(authenticatorData, clientDataJSON)

  if (message.length > 0xffff) {
    throw new Error(`WebAuthn assertion is too large for the precompile: ${message.length} bytes`)
  }

  // `message` is the hashed region; the clientDataJSON is carried after it, outside
  // `message_data_size`, so it is available for on-chain validation without being signed.
  const buffer = new Uint8Array(MESSAGE_OFFSET + message.length + clientDataJSON.length)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  buffer[0] = 1 // 1 signature
  buffer[1] = MODE_WEBAUTHN

  view.setUint16(2, SIGNATURE_OFFSET, true)
  view.setUint16(4, 0xffff, true) // current instruction

  view.setUint16(6, PUBKEY_OFFSET, true)
  view.setUint16(8, 0xffff, true) // current instruction

  view.setUint16(10, MESSAGE_OFFSET, true)
  view.setUint16(12, message.length, true)
  view.setUint16(14, 0xffff, true) // current instruction

  view.setUint16(CDJ_LENGTH_OFFSET, clientDataJSON.length, true)

  buffer.set(signature, SIGNATURE_OFFSET)
  buffer.set(publicKey, PUBKEY_OFFSET)
  buffer.set(message, MESSAGE_OFFSET)
  buffer.set(clientDataJSON, MESSAGE_OFFSET + message.length)

  return new TransactionInstruction({
    programId: SECP256R1_PRECOMPILE_PROGRAM_ID,
    keys: [],
    data: Buffer.from(buffer),
  })
}
