/**
 * 24-hour spend window quorum test suite
 *
 * Verifies that the client's quorum decision (`utils/haptix-spend-window.ts`) matches
 * `execute_transfer` in the Anchor program:
 * 1. The client's window length equals `VELOCITY_WINDOW_SECONDS` in the Rust source
 * 2. Single amount over the threshold needs both passkeys
 * 3. The rolling 24h one-passkey total over the threshold needs both passkeys
 * 4. A lapsed or never-started window counts as empty
 * 5. Remaining one-passkey allowance never goes negative
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  HAPTIX_VELOCITY_WINDOW_SECONDS,
  SpendWindowState,
  effectiveWindowSpent,
  isTransferQuorumRequired,
  remainingOneTapLamports,
} from '../utils/haptix-spend-window'

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

console.log('\n--- 24H SPEND WINDOW QUORUM SUITE ---\n')

// 1. The window length must match the program, read from the source rather than retyped.
const rustPath = join(
  __dirname,
  '..',
  'haptix_program',
  'programs',
  'haptix_program',
  'src',
  'instructions',
  'execute_transfer.rs',
)
const rust = readFileSync(rustPath, 'utf8')
const match = rust.match(/VELOCITY_WINDOW_SECONDS:\s*i64\s*=\s*([\d_]+)/)
const programWindow = match ? BigInt(match[1].replace(/_/g, '')) : null
assert(programWindow !== null, 'execute_transfer.rs declares VELOCITY_WINDOW_SECONDS')
assert(
  programWindow === HAPTIX_VELOCITY_WINDOW_SECONDS,
  'client window length matches the program',
  `program=${programWindow} client=${HAPTIX_VELOCITY_WINDOW_SECONDS}`,
)

// The program's own rule, quoted from the source, so a change there fails this suite.
assert(
  /amount > ctx\.accounts\.wallet\.spend_threshold_lamports\s*\|\|\s*cumulative_spent > ctx\.accounts\.wallet\.spend_threshold_lamports/.test(
    rust,
  ),
  'program rule is still "amount OR cumulative over threshold"',
)

// Fixtures are derived from the threshold so the suite does not depend on one value.
const threshold = 100_000_000n
const now = 1_800_000_000n
const window = HAPTIX_VELOCITY_WINDOW_SECONDS
const state = (windowStart: bigint, windowSpent: bigint): SpendWindowState => ({
  spendThresholdLamports: threshold,
  windowStart,
  windowSpent,
})

// 2. Single amount
assert(
  !isTransferQuorumRequired(state(0n, 0n), threshold, now),
  'exactly the threshold with an empty window: 1 passkey',
)
assert(isTransferQuorumRequired(state(0n, 0n), threshold + 1n, now), 'one lamport over the threshold: 2 passkeys')

// 3. Rolling cumulative total (the bug: the old check only looked at the amount)
const half = threshold / 2n
const activeStart = now - window / 2n
assert(
  isTransferQuorumRequired(state(activeStart, half + 1n), half, now),
  'small send that pushes the 24h total over the threshold: 2 passkeys',
)
assert(
  !isTransferQuorumRequired(state(activeStart, half), half, now),
  'small send that lands exactly on the threshold: 1 passkey',
)

// 4. Window lapse, matching `current_time - window_start >= VELOCITY_WINDOW_SECONDS`
assert(
  !isTransferQuorumRequired(state(now - window, threshold), half, now),
  'window exactly 24h old has lapsed: total resets',
)
assert(
  isTransferQuorumRequired(state(now - window + 1n, threshold), half, now),
  'window one second short of 24h is still active',
)
assert(effectiveWindowSpent(state(0n, threshold), now) === 0n, 'a never-started window counts as empty')

// 5. Remaining allowance
assert(
  remainingOneTapLamports(state(activeStart, half), now) === threshold - half,
  'remaining allowance in an active window',
)
assert(
  remainingOneTapLamports(state(activeStart, threshold + 5n), now) === 0n,
  'remaining allowance never goes negative',
)
assert(
  remainingOneTapLamports(state(now - window, threshold), now) === threshold,
  'full allowance after the window lapses',
)

console.log(`\n  SPEND WINDOW TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
