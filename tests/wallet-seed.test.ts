/**
 * The address a wallet lives at has to survive a recovery rotation.
 *
 * `initialize_wallet` derives the PDA from the primary passkey, and recovery replaces
 * that passkey -- so the seed has to be pinned separately or the account is stranded at
 * an address nothing can derive again. This is the client half of that rule: anything
 * that re-derives an address (or explains which address a wallet is at) must read the
 * pinned seed once one exists, and fall back to the primary passkey only for a wallet
 * that has never been rotated.
 *
 * Also covered: a guardian address is validated the same way a recipient is, because a
 * pasted explorer link or an EVM address in that field is a wallet whose only recovery
 * path is permanently broken.
 */
import { PublicKey } from '@solana/web3.js'
import { p256 } from '@noble/curves/p256'
import { getWalletPda, getWalletSeedFromState, parseGuardianAddress } from '../utils/haptix-client'
import { describeTimelock, formatRemainingTime, parseTimelockInput } from '../utils/recovery-timelock'

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

const primary = p256.getPublicKey(p256.utils.randomSecretKey(), true)
const rotatedPrimary = p256.getPublicKey(p256.utils.randomSecretKey(), true)
const [address] = getWalletPda(primary)

// --- A wallet that has never been rotated ---------------------------------
const freshSeed = getWalletSeedFromState({ walletSeed: new Uint8Array(32), primaryPasskey: primary })
assert(bytesEqual(freshSeed, primary.subarray(1, 33)), 'an unrotated wallet seeds from its primary passkey')
assert(
  getWalletPda(new Uint8Array([0, ...freshSeed]))[0].equals(address),
  'the fallback seed re-derives the address the wallet was created at',
)

// --- A wallet mid-recovery -------------------------------------------------
// The account keeps its original address while the passkey it now verifies against is
// the replacement one. Deriving from the rotated key would point at an empty account.
const pinned = primary.subarray(1, 33)
const rotatedState = { walletSeed: new Uint8Array(pinned), primaryPasskey: rotatedPrimary }
const rotatedSeed = getWalletSeedFromState(rotatedState)
assert(bytesEqual(rotatedSeed, pinned), 'a rotated wallet keeps seeding from the pinned bytes')
assert(
  getWalletPda(new Uint8Array([0, ...rotatedSeed]))[0].equals(address),
  'a rotated wallet still derives its original address',
)
assert(
  !getWalletPda(rotatedPrimary)[0].equals(address),
  'deriving from the replacement passkey would land on a different account',
)

// --- Guardian addresses ---------------------------------------------------
// Any 32-byte key is a valid guardian address, including the wallet's own.
const guardian = address
assert(parseGuardianAddress(guardian.toBase58())?.equals(guardian) === true, 'a base58 address is accepted')
assert(parseGuardianAddress(`  ${guardian.toBase58()}  `)?.equals(guardian) === true, 'surrounding space is trimmed')

// Every one of these is something a user could paste into the guardian field. Accepting
// any of them would store an address no recovery could ever be signed by.
for (const [label, input] of [
  ['an empty string', ''],
  ['a truncated address', guardian.toBase58().slice(0, 20)],
  ['an explorer link with no address', 'https://explorer.solana.com/address/'],
  ['an EVM address', '0x1234567890abcdef1234567890abcdef12345678'],
  ['a .sol name', 'guardian.sol'],
  ['whitespace', '   '],
] as const) {
  assert(parseGuardianAddress(input) === null, `rejects ${label}`)
}

if (failed > 0) process.exit(1)

// --- Recovery timelock input ----------------------------------------------
// The window is a spending policy, not a preference: an unparseable or absurd value has
// to be refused rather than coerced, because whatever lands on-chain is what the owner
// gets for the life of the wallet.
assert(
  parseTimelockInput('').seconds === null && parseTimelockInput('').error === null,
  'an empty timelock keeps the program default',
)
assert(parseTimelockInput('3s').seconds === 3n, 'seconds are accepted')
assert(parseTimelockInput('10m').seconds === 600n, 'minutes are converted')
assert(parseTimelockInput('24h').seconds === 86_400n, 'hours are converted')
assert(parseTimelockInput('2d').seconds === 172_800n, 'days are converted')
assert(parseTimelockInput(' 30 ').seconds === 30n, 'a bare number is seconds, and trimmed')

for (const [label, input] of [
  ['a negative window', '-1'],
  ['prose', 'tomorrow'],
  ['an unknown unit', '5w'],
  ['a value past a month', '31d'],
  ['a lone unit', 'h'],
] as const) {
  assert(parseTimelockInput(input).error !== null, `rejects ${label}`)
}

assert(describeTimelock(86_400n) === '1d', 'the default window collapses to its largest exact unit')
assert(describeTimelock(3n) === '3s', 'a short window keeps its unit')

// --- Recovery countdown ----------------------------------------------------
// The wallet banner and the recovery screen both read this, and both switch their copy
// on `secondsLeft > 0`, so an elapsed window has to be a word rather than "0s" -- the
// screen would otherwise sit on "0s left" instead of saying the window is over.
assert(formatRemainingTime(0) === 'Expired', 'an elapsed window says so rather than reading as zero')
assert(formatRemainingTime(-5) === 'Expired', 'a negative window is expired, not garbled')
assert(formatRemainingTime(42) === '42s', 'under a minute is seconds only')
assert(formatRemainingTime(8 * 60 + 9) === '8m 9s', 'minutes carry seconds')
assert(formatRemainingTime(5 * 3600 + 6 * 60 + 7) === '5h 6m 7s', 'hours carry minutes and seconds')
assert(formatRemainingTime(2 * 86_400 + 3 * 3600 + 4 * 60) === '2d 3h 4m', 'days carry hours and minutes')
assert(formatRemainingTime(3600) === '1h 0m 0s', 'an exact hour still reports its smaller units')

console.log(`\n  WALLET SEED TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
