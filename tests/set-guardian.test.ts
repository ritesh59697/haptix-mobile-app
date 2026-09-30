/**
 * The guardian could never be changed, and the threshold could never be moved.
 *
 * Both were write-once: set by `initialize_wallet` and then only ever read back. The app
 * displayed the spend threshold it fetched from chain, and offered no control at all for
 * the guardian, so a wallet was permanently pointed at whoever was configured first --
 * on Devnet, the funder key that ships inside the app bundle. That is the difference
 * between testing recovery and testing *guardian* recovery: while the same build holds
 * the guardian key, the guardian and the owner are the same party and the veto proves
 * nothing.
 *
 * These are the client-side facts those two instructions depend on. The discriminators
 * are compared against the checked-in IDL because a wrong one fails as
 * "instruction not found" with nothing pointing at the cause, and the signed message
 * layouts are pinned because the program compares them byte-for-byte: a signature over
 * the wrong bytes is rejected on-chain after the user has already done the biometrics.
 */
import { PublicKey } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import {
  createSetGuardianInstruction,
  createSetSpendThresholdInstruction,
  getSetGuardianSignedMessage,
  getSetSpendThresholdSignedMessage,
} from '../utils/haptix-client'
import idl from '../constants/haptix_program_idl.json'

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

function equals(actual: unknown, expected: unknown, name: string) {
  // u64 values arrive as BigInt, which JSON.stringify refuses outright.
  const show = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? `${item}n` : item))
  const a = show(actual)
  const b = show(expected)
  assert(a === b, name, a === b ? undefined : `expected ${b}, got ${a}`)
}

/** Anchor derives an instruction discriminator from its name the same way every build. */
function anchorDiscriminator(name: string): number[] {
  return [...createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)]
}

function idlDiscriminator(name: string): number[] {
  const instruction = idl.instructions.find((candidate) => candidate.name === name)
  assert(!!instruction, `${name} is still in the checked-in IDL`)
  return instruction?.discriminator ?? []
}

const walletPda = new PublicKey('D6R74Cd433mgSUzazeSn97SMAoiyZp5o11tErm3GmDvu')
const newGuardian = new PublicKey('F2KbEr684c41WjtwqhWkKWbXfBWaZ49nG3A6vbVVrLgK')

console.log('\n--- SET GUARDIAN ---')

const setGuardianIx = createSetGuardianInstruction({
  walletPda,
  newGuardian,
  primarySigIxIndex: 0,
  secondarySigIxIndex: 1,
})

equals(
  [...setGuardianIx.data.subarray(0, 8)],
  idlDiscriminator('set_guardian'),
  'set_guardian discriminator matches the IDL',
)
equals(
  [...setGuardianIx.data.subarray(0, 8)],
  anchorDiscriminator('set_guardian'),
  'and matches sha256(global:set_guardian)',
)

equals(
  new PublicKey(setGuardianIx.data.subarray(8, 40)).toBase58(),
  newGuardian.toBase58(),
  'the new guardian is written into the arguments, not the accounts',
)
equals(setGuardianIx.data.readUInt16LE(40), 0, 'primary signature index is little-endian at byte 40')
equals(setGuardianIx.data.readUInt16LE(42), 1, 'secondary signature index is little-endian at byte 42')
equals(setGuardianIx.data.length, 44, 'argument block is exactly 44 bytes')

equals(
  setGuardianIx.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable]),
  [
    [walletPda.toBase58(), false, true],
    ['Sysvar1nstructions1111111111111111111111111', false, false],
  ],
  'accounts are the wallet plus the instructions sysvar - the quorum is proved by index, not by a signer',
)

// The address is inside the signed bytes, so a signature collected to appoint one
// guardian cannot be replayed to appoint another.
const message = getSetGuardianSignedMessage(newGuardian, 0n)
equals(
  Buffer.from(message.subarray(0, 13)).toString('utf8'),
  'SET_GUARDIAN:',
  'message is prefixed so it cannot collide with another action',
)
equals(message.length, 53, 'message is the prefix, an 8-byte nonce, and the 32-byte address')
equals(Buffer.from(message).readBigUInt64LE(13), 0n, 'the nonce sits immediately after the prefix')
assert(
  !Buffer.from(message).equals(Buffer.from(getSetGuardianSignedMessage(walletPda, 0n))),
  'a signature for a different guardian produces different bytes',
)
assert(
  !Buffer.from(message).equals(Buffer.from(getSetGuardianSignedMessage(newGuardian, 1n))),
  'a signature at a different nonce produces different bytes',
)

console.log('\n--- SET SPEND THRESHOLD ---')

const thresholdIx = createSetSpendThresholdInstruction({
  walletPda,
  newThresholdLamports: 250_000_000n,
  primarySigIxIndex: 2,
  secondarySigIxIndex: 3,
})

equals(
  [...thresholdIx.data.subarray(0, 8)],
  idlDiscriminator('set_spend_threshold'),
  'set_spend_threshold discriminator matches the IDL',
)
equals(
  [...thresholdIx.data.subarray(0, 8)],
  anchorDiscriminator('set_spend_threshold'),
  'and matches sha256(global:set_spend_threshold)',
)
equals(thresholdIx.data.readBigUInt64LE(8), 250_000_000n, 'the threshold is a little-endian u64 at byte 8')
equals(thresholdIx.data.readUInt16LE(16), 2, 'primary index at byte 16')
equals(thresholdIx.data.readUInt16LE(18), 3, 'secondary index at byte 18')
equals(thresholdIx.data.length, 20, 'argument block is exactly 20 bytes')

// Boundary values are where a threshold bug would live: 0 makes everything a quorum, and
// the maximum is what a user gets when they try to disable the quorum entirely.
equals(
  thresholdIx.data.length,
  createSetSpendThresholdInstruction({
    walletPda,
    newThresholdLamports: 0n,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 0,
  }).data.length,
  'a zero threshold encodes to the same width as any other',
)
equals(
  createSetSpendThresholdInstruction({
    walletPda,
    newThresholdLamports: 0n,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 0,
  }).data.readBigUInt64LE(8),
  0n,
  'a zero threshold survives the round trip',
)
equals(
  createSetSpendThresholdInstruction({
    walletPda,
    newThresholdLamports: 18_446_744_073_709_551_615n,
    primarySigIxIndex: 0,
    secondarySigIxIndex: 0,
  }).data.readBigUInt64LE(8),
  18_446_744_073_709_551_615n,
  'u64::MAX survives the round trip',
)

const thresholdMessage = getSetSpendThresholdSignedMessage(250_000_000n, 7n)
equals(
  Buffer.from(thresholdMessage.subarray(0, 14)).toString('utf8'),
  'SET_THRESHOLD:',
  'threshold message carries its own prefix',
)
equals(thresholdMessage.length, 30, 'threshold message is the prefix, an 8-byte nonce, and a u64')
equals(Buffer.from(thresholdMessage).readBigUInt64LE(14), 7n, 'the nonce is little-endian after the prefix')
equals(
  Buffer.from(thresholdMessage).readBigUInt64LE(22),
  250_000_000n,
  'the amount is little-endian after the nonce, as the program reads it',
)

console.log(`\n  SET GUARDIAN TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
