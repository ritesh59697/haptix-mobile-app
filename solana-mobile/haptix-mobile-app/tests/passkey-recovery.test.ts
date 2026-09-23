/**
 * Recovery binding: proving a picked passkey belongs to a wallet.
 *
 * A WebAuthn assertion carries a credential id and a signature, never a public key, so
 * the only way to tell whether the passkey the user selected is the one an on-chain
 * account expects is to verify its signature against the keys that account already
 * holds. Binding on a guess is what produced the earlier failure mode: a wallet whose
 * every 2-of-2 action failed the precompile's signature check with nothing on screen to
 * explain it.
 *
 * No network, no authenticator and no device: the assertions here are built exactly the
 * way a platform authenticator builds them (signing `authenticatorData ||
 * sha256(clientDataJSON)`), which is also the byte range the precompile hashes.
 */
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha2'
import {
  WebAuthnAssertion,
  assertionMatchesPublicKey,
  createWebAuthnSecp256r1Instruction,
  matchWebAuthnAssertion,
  webAuthnSignedRegion,
} from '../utils/secp256r1-instruction'

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** The 33-byte compressed public key an authenticator would have registered. */
function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, true)
}

/** Builds an assertion the way a platform authenticator does. */
function makeAssertion(privateKey: Uint8Array, challenge: string, clientDataJSON: string): WebAuthnAssertion {
  const authenticatorData = new Uint8Array(37)
  authenticatorData.fill(0x42, 0, 32) // rpIdHash
  authenticatorData[32] = 0x05 // UP | UV
  new DataView(authenticatorData.buffer).setUint32(33, 7, false) // signCount

  const clientDataBytes = new TextEncoder().encode(clientDataJSON)
  const signedRegion = webAuthnSignedRegion(authenticatorData, clientDataBytes)
  const signature = p256.sign(sha256(signedRegion), privateKey, { lowS: true })

  return {
    signature: signature.toDERRawBytes(),
    authenticatorData,
    clientDataJSON: clientDataBytes,
  }
}

console.log('\n--- PASSKEY RECOVERY: ASSERTION MATCHING ---')

const primaryKey = p256.utils.randomPrivateKey()
const secondaryKey = p256.utils.randomPrivateKey()
const strangerKey = p256.utils.randomPrivateKey()

const primaryPublic = publicKeyOf(primaryKey)
const secondaryPublic = publicKeyOf(secondaryKey)
const strangerPublic = publicKeyOf(strangerKey)

const challenge = 'Y2hhbGxlbmdlLWJ5dGVzLWZvci10aGUtdGVzdA'
const clientDataJSON = JSON.stringify({
  type: 'webauthn.get',
  challenge,
  origin: 'https://haptix-passkeys.vercel.app',
})

const primaryAssertion = makeAssertion(primaryKey, challenge, clientDataJSON)
const secondaryAssertion = makeAssertion(secondaryKey, challenge, clientDataJSON)
const strangerAssertion = makeAssertion(strangerKey, challenge, clientDataJSON)
const keys = { primary: primaryPublic, secondary: secondaryPublic }

assert(
  matchWebAuthnAssertion(primaryAssertion, keys) === 'primary',
  'the primary credential is identified as the primary key',
)
assert(
  matchWebAuthnAssertion(secondaryAssertion, keys) === 'secondary',
  'the backup credential is identified as the secondary key',
)
assert(
  matchWebAuthnAssertion(strangerAssertion, keys) === null,
  'a passkey from another wallet matches neither key',
  'recovery must refuse to bind an unrelated credential',
)
assert(
  assertionMatchesPublicKey(primaryAssertion, primaryPublic) &&
    !assertionMatchesPublicKey(primaryAssertion, secondaryPublic),
  'a match is specific to one key, not merely "a valid signature"',
)

// A signature that does not cover the served clientDataJSON must not match: this is what
// stops a relaying authenticator from binding a key it cannot actually use.
const tamperedClientData = JSON.stringify({
  type: 'webauthn.get',
  challenge: 'YS1kaWZmZXJlbnQtY2hhbGxlbmdl',
  origin: 'https://haptix-passkeys.vercel.app',
})
assert(
  matchWebAuthnAssertion(
    { ...primaryAssertion, clientDataJSON: new TextEncoder().encode(tamperedClientData) },
    keys,
  ) === null,
  'a swapped clientDataJSON breaks the match',
)

const corruptedSignature = Uint8Array.from(primaryAssertion.signature)
corruptedSignature[corruptedSignature.length - 1] ^= 0x01
assert(
  matchWebAuthnAssertion({ ...primaryAssertion, signature: corruptedSignature }, keys) === null,
  'a single flipped signature byte breaks the match',
)
assert(
  matchWebAuthnAssertion({ ...primaryAssertion, signature: new Uint8Array([1, 2, 3, 4]) }, keys) === null,
  'malformed DER answers "no match" instead of throwing',
)
assert(
  matchWebAuthnAssertion({ ...primaryAssertion, signature: new Uint8Array(0) }, keys) === null,
  'an empty signature answers "no match"',
)
assert(
  assertionMatchesPublicKey(primaryAssertion, primaryPublic.subarray(1)) === false,
  'a key of the wrong length is rejected rather than misinterpreted',
)

// The verification digest must be the digest the chain checks. If the instruction
// builder and this matcher ever disagreed about the signed region, a bound credential
// would pass here and fail on-chain.
const instruction = createWebAuthnSecp256r1Instruction({
  signature: p256.Signature.fromDER(primaryAssertion.signature).normalizeS().toCompactRawBytes(),
  publicKey: primaryPublic,
  authenticatorData: primaryAssertion.authenticatorData,
  clientDataJSON: primaryAssertion.clientDataJSON,
})
const view = new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength)
const messageOffset = view.getUint16(10, true)
const messageSize = view.getUint16(12, true)
const onChainRegion = new Uint8Array(instruction.data.subarray(messageOffset, messageOffset + messageSize))
assert(
  bytesEqual(onChainRegion, webAuthnSignedRegion(primaryAssertion.authenticatorData, primaryAssertion.clientDataJSON)),
  'the precompile message region is exactly the region the matcher verifies',
)

console.log(`\n  PASSKEY RECOVERY TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
