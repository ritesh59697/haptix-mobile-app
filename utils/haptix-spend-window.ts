/**
 * Client copy of the on-chain quorum rule in `execute_transfer`
 * (`haptix_program/programs/haptix_program/src/instructions/execute_transfer.rs`).
 *
 * The program requires both passkeys when the single amount OR the rolling 24-hour
 * cumulative one-passkey spend exceeds `spend_threshold_lamports`. The send sheet used to
 * compare only the single amount, so once the day's one-passkey spending neared the
 * threshold the app asked for one passkey and the chain rejected it with `QuorumRequired`.
 *
 * Keep this in step with the program. `tests/spend-window.test.ts` pins the boundaries.
 */

/**
 * Length of the rolling window. Mirrors `VELOCITY_WINDOW_SECONDS` in `execute_transfer.rs`.
 * The program does not store it on-chain, so this is the one client-side copy; change both
 * together.
 */
export const HAPTIX_VELOCITY_WINDOW_SECONDS = 86_400n

export interface SpendWindowState {
  /** Threshold above which both passkeys are required (`spend_threshold_lamports`). */
  spendThresholdLamports: bigint
  /** Unix seconds when the current window began; 0 if none has started. */
  windowStart: bigint
  /** Lamports spent with one passkey in the current window. */
  windowSpent: bigint
}

/** The window's spent total as the program will see it at `nowSeconds` (0 once it lapsed). */
export function effectiveWindowSpent(state: SpendWindowState, nowSeconds: bigint): bigint {
  const lapsed = state.windowStart === 0n || nowSeconds - state.windowStart >= HAPTIX_VELOCITY_WINDOW_SECONDS
  return lapsed ? 0n : state.windowSpent
}

/** Whether `execute_transfer` will demand the second passkey for `amountLamports`. */
export function isTransferQuorumRequired(state: SpendWindowState, amountLamports: bigint, nowSeconds: bigint): boolean {
  const cumulative = effectiveWindowSpent(state, nowSeconds) + amountLamports
  return amountLamports > state.spendThresholdLamports || cumulative > state.spendThresholdLamports
}

/** How much more can be sent with one passkey before the window needs both (never negative). */
export function remainingOneTapLamports(state: SpendWindowState, nowSeconds: bigint): bigint {
  const left = state.spendThresholdLamports - effectiveWindowSpent(state, nowSeconds)
  return left > 0n ? left : 0n
}
