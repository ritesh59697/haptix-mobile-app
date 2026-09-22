/**
 * Offline regression tests for the Secp256r1 precompile instruction layouts.
 *
 * These pin the wire contract shared with the on-chain parser in
 * `haptix_program/src/secp256r1.rs`. No network access is required.
 *
 * The layout is subtle enough to have broken twice, so the assertions below
 * reconstruct the expected bytes from the spec independently rather than reusing
 * the builder's own helper constants.
 *
 * Legacy  (mode 0x00): offsets 16 / 80 / 113, message region is the raw payload.
 * WebAuthn (mode 0x01): offsets 18 / 82 / 115, plus a u16 clientDataJSON length at
 * [16..18]. The *signed* message region is `authenticatorData || sha256(clientDataJSON)`;
 * the clientDataJSON itself is carried after that region, outside `message_data_size`,
 * because folding it into the hashed bytes would change the digest the authenticator
 * actually signed.
 */
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha2'
import { createSecp256r1Instruction, createWebAuthnSecp256r1Instruction } from '../utils/secp256r1-instruction'

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

function u16(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(at, true)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex')
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const t =
      (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8) | (i + 2 < bytes.length ? bytes[i + 2] : 0)
    out += B64URL[(t >> 18) & 63] + B64URL[(t >> 12) & 63]
    if (i + 1 < bytes.length) out += B64URL[(t >> 6) & 63]
    if (i + 2 < bytes.length) out += B64URL[t & 63]
  }
  return out
}

/** Builds the assertion exactly as a platform authenticator would for `webauthn.get`. */
function buildAssertion(payload: Uint8Array, rpId = 'haptix.io', origin = 'https://haptix.io') {
  const authData = new Uint8Array(37)
  authData.set(sha256(new TextEncoder().encode(rpId)), 0)
  authData[32] = 0x05 // UP | UV
  new DataView(authData.buffer).setUint32(33, 0, false)

  const clientDataJSON = new TextEncoder().encode(
    `{"type":"webauthn.get","challenge":"${base64url(payload)}","origin":"${origin}","crossOrigin":false}`,
  )
  const clientDataHash = sha256(clientDataJSON)
  const signedRegion = new Uint8Array(authData.length + clientDataHash.length)
  signedRegion.set(authData, 0)
  signedRegion.set(clientDataHash, authData.length)

  return { authData, clientDataJSON, clientDataHash, signedRegion }
}

console.log('\n--- SECP256R1 INSTRUCTION LAYOUT ---')

// ---------------------------------------------------------------- legacy ---
{
  const priv = p256.utils.randomPrivateKey()
  const pub = p256.getPublicKey(priv, true)
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const signature = p256.sign(sha256(payload), priv, { lowS: true }).toCompactRawBytes()

  const ix = createSecp256r1Instruction({ signature, publicKey: pub, message: payload })
  const data = new Uint8Array(ix.data)

  assert(data[0] === 0x01, 'legacy: num_signatures is 1')
  assert(data[1] === 0x00, 'legacy: mode byte is 0x00')
  assert(u16(data, 2) === 16, 'legacy: signature offset is 16')
  assert(u16(data, 6) === 80, 'legacy: pubkey offset is 80')
  assert(u16(data, 10) === 113, 'legacy: message offset is 113')
  assert(u16(data, 12) === payload.length, 'legacy: message size equals payload length')
  assert(
    u16(data, 4) === 0xffff && u16(data, 8) === 0xffff && u16(data, 14) === 0xffff,
    'legacy: all regions bind to this instruction',
  )
  assert(data.length === 113 + payload.length, `legacy: total length is 113 + payload (${data.length})`)
  assert(bytesEqual(data.subarray(16, 80), signature), 'legacy: signature sits at [16..80]')
  assert(bytesEqual(data.subarray(80, 113), pub), 'legacy: pubkey sits at [80..113]')
  assert(bytesEqual(data.subarray(113), payload), 'legacy: message region is the raw payload verbatim')
}

// -------------------------------------------------------------- webauthn ---
{
  const priv = p256.utils.randomPrivateKey()
  const pub = p256.getPublicKey(priv, true)
  const payload = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9])
  const { authData, clientDataJSON, clientDataHash, signedRegion } = buildAssertion(payload)
  const signature = p256.sign(sha256(signedRegion), priv, { lowS: true }).toCompactRawBytes()

  const ix = createWebAuthnSecp256r1Instruction({
    signature,
    publicKey: pub,
    authenticatorData: authData,
    clientDataJSON,
  })
  const data = new Uint8Array(ix.data)

  const A = authData.length
  const C = clientDataJSON.length

  assert(data[0] === 0x01, 'webauthn: num_signatures is 1')
  assert(data[1] === 0x01, 'webauthn: mode byte is 0x01')
  assert(u16(data, 2) === 18, 'webauthn: signature offset is 18')
  assert(u16(data, 6) === 82, 'webauthn: pubkey offset is 82')
  assert(u16(data, 10) === 115, 'webauthn: message offset is 115')
  assert(u16(data, 16) === C, 'webauthn: clientDataJSON length is recorded at [16..18]')
  assert(
    u16(data, 4) === 0xffff && u16(data, 8) === 0xffff && u16(data, 14) === 0xffff,
    'webauthn: all regions bind to this instruction',
  )
  assert(bytesEqual(data.subarray(18, 82), signature), 'webauthn: signature sits at [18..82]')
  assert(bytesEqual(data.subarray(82, 115), pub), 'webauthn: pubkey sits at [82..115]')

  // The signed region excludes the clientDataJSON.
  assert(
    u16(data, 12) === A + 32,
    `webauthn: message size is authData + 32, not including clientDataJSON (${u16(data, 12)})`,
  )
  assert(data.length === 115 + (A + 32) + C, `webauthn: total length is 115 + (A + 32) + C (${data.length})`)

  const region = data.subarray(115, 115 + A + 32)
  assert(bytesEqual(region.subarray(0, A), authData), 'webauthn: signed region opens with the authenticatorData')
  assert(bytesEqual(region.subarray(A), clientDataHash), 'webauthn: signed region ends with sha256(clientDataJSON)')

  const carried = data.subarray(115 + A + 32)
  assert(bytesEqual(carried, clientDataJSON), 'webauthn: clientDataJSON is carried after the signed region')

  // The digest the precompile will compute must equal the digest the authenticator signed.
  assert(
    toHex(sha256(region)) === toHex(sha256(signedRegion)),
    'webauthn: sha256(message region) equals the digest the authenticator signed',
  )

  // Explicitly reject the regression: clientDataJSON folded into the signed region.
  const folded = new Uint8Array(A + 32 + C)
  folded.set(authData, 0)
  folded.set(clientDataHash, A)
  folded.set(clientDataJSON, A + 32)
  assert(
    toHex(sha256(region)) !== toHex(sha256(folded)),
    'webauthn: folding clientDataJSON into the signed region would change the digest (regression guard)',
  )

  // The signature must still verify against the region the precompile hashes.
  const ok = p256.verify(signature, sha256(region), pub, { lowS: true })
  assert(ok, 'webauthn: compact signature verifies over the hashed message region')
}

console.log(`\n================ ${passed} passed, ${failed} failed ================\n`)
if (failed > 0) process.exit(1)
