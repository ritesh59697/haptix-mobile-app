/**
 * Reads the recovery timelock a user typed, in seconds.
 *
 * The timelock is the owner's veto window: it is the whole reason a guardian can be
 * trusted with the ability to *start* a recovery. On Devnet a 24h wait makes the
 * execute leg untestable, so the window is configurable at creation -- but only through
 * a deliberate value, because a short window is a weaker policy rather than a debug flag.
 *
 * Suffixes are accepted because "3s" and "24h" are how the window is actually discussed;
 * a bare number is read as seconds.
 */

export const DEFAULT_RECOVERY_TIMELOCK_SECONDS = 86_400n

/** A month. Past this, an owner who loses a device has effectively lost the wallet. */
const MAX_TIMELOCK_SECONDS = 30n * 24n * 60n * 60n

const UNIT_SECONDS: Record<string, bigint> = {
  s: 1n,
  m: 60n,
  h: 3_600n,
  d: 86_400n,
}

export interface TimelockParseResult {
  /** The configured window, or null when the input was empty (use the default). */
  seconds: bigint | null
  /** Actionable reason the value was rejected, or null when it parsed cleanly. */
  error: string | null
}

export function parseTimelockInput(raw: string): TimelockParseResult {
  const value = (raw ?? '').trim().toLowerCase()
  if (!value) return { seconds: null, error: null }

  const match = value.match(/^(\d+)\s*([smhd])?$/)
  if (!match) {
    return { seconds: null, error: 'Use seconds, or a number with s, m, h or d — for example 30s or 24h.' }
  }

  const amount = BigInt(match[1])
  const multiplier = match[2] ? UNIT_SECONDS[match[2]] : 1n
  const seconds = amount * multiplier

  if (seconds > MAX_TIMELOCK_SECONDS) {
    return { seconds: null, error: 'That is longer than 30 days, which would make a lost device unrecoverable.' }
  }

  return { seconds, error: null }
}

/** Human label for a configured window, e.g. "24h" or "3s". */
export function describeTimelock(seconds: bigint): string {
  if (seconds <= 0n) return 'no timelock'
  if (seconds % 86_400n === 0n) return `${seconds / 86_400n}d`
  if (seconds % 3_600n === 0n) return `${seconds / 3_600n}h`
  if (seconds % 60n === 0n) return `${seconds / 60n}m`
  return `${seconds}s`
}

/**
 * Counts a recovery window down, e.g. "23h 4m 12s".
 *
 * Lives here rather than in a screen because two of them show the same deadline now:
 * the wallet's freeze banner and the recovery screen. A second copy would be the one
 * that drifts.
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return 'Expired'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}
