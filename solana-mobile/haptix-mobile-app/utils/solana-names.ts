import { Connection } from '@solana/web3.js'
import { resolve } from '@bonfida/spl-name-service'

/**
 * Solana Name Service (`.sns`, and legacy `.sol`) forward resolution.
 *
 * The SDK is the source of truth on purpose: the domain root is a hashed-name PDA
 * under the SNS program, and a hand-rolled derivation that drifted by one seed would
 * resolve a name to a *different* owner -- the one failure mode a wallet cannot have.
 *
 * Two details the caller has to live with, both encoded below:
 * - `.sol` is being retired. The SDK checks the live finalized slot against
 *   `SOL_TLD_CUTOFF_SLOT` (452_825_395, expected mid-October 2026) and then refuses to
 *   resolve `.sol` at all, so a name that works today starts failing with
 *   `UnsupportedTld`. That is reported as `retired` rather than as a network error,
 *   because "ask them for their .sns name" is the actionable advice.
 * - Errors are matched on the SDK's stable `type` string rather than with `instanceof`,
 *   because the package ships both a CJS and an ESM build and Metro can end up holding
 *   classes from one while the SDK throws from the other.
 */

/** Suffixes this wallet will attempt to resolve, newest format first. */
export const SOL_NAME_SUFFIXES = ['.sns', '.sol'] as const

const DEFAULT_TIMEOUT_MS = 12_000

export type SolNameLookupStatus =
  /** The name exists and its owner was returned. */
  | 'resolved'
  /** The name does not exist on this cluster (or the cluster has no SNS program). */
  | 'not-found'
  /** `.sol` has passed its retirement slot and can no longer be resolved. */
  | 'retired'
  /** Not a Solana name at all. */
  | 'unsupported'
  /** Transport failure: timeout, RPC error, malformed response. */
  | 'error'

export interface SolNameLookup {
  /** Lower-cased name including its suffix, e.g. `ritesh.sns`. */
  name: string
  status: SolNameLookupStatus
  address: string | null
  /** Message worth showing verbatim; composed here so the wording is testable. */
  message: string
}

/** True when the input is exactly one name with a suffix this wallet can resolve. */
export function looksLikeSolName(input: string): boolean {
  return extractSolName(input) !== null
}

/**
 * Normalizes a pasted name, or returns null when the input is not one.
 *
 * Accepts `ritesh.sns`, `Ritesh.SOL`, surrounding whitespace/quotes, invisible
 * characters, and the `solana:` URI prefix, because all of those arrive from chats and
 * explorers. Anything longer (a sentence, a link with a path) is rejected: a wrong
 * guess here would automatically send funds to whatever the resolution returned.
 */
export function extractSolName(input: string): string | null {
  if (!input) return null
  let candidate = input.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  candidate = candidate.replace(/^["'<([]|["'>)\]]$/g, '')
  candidate = candidate.replace(/^solana:/i, '').split(/[/?#]/)[0]
  const lower = candidate.toLowerCase()
  const suffix = SOL_NAME_SUFFIXES.find((s) => lower.endsWith(s))
  if (!suffix) return null

  const label = lower.slice(0, -suffix.length)
  if (!label) return null
  // SNS labels are DNS-like: letters, digits and inner hyphens, up to 63 characters.
  // Subdomains (`pay.ritesh.sns`) are supported by the SDK and allowed here.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label.replace(/\./g, '-'))) return null
  if (label.split('.').some((part) => part.length > 63 || part.length === 0)) return null
  return `${label}${suffix}`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`Name lookup timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      (err) => {
        clearTimeout(timer)
        rejectPromise(err)
      },
    )
  })
}

/** The SNS SDK's stable error category, read defensively across its dual builds. */
function sdkErrorType(err: unknown): string | null {
  const type = (err as { type?: unknown })?.type
  return typeof type === 'string' ? type : null
}

/**
 * Resolves a name against the given cluster.
 *
 * Never throws: every outcome is a status the sheet can render, because a failed
 * lookup must not be mistaken for a valid recipient.
 */
export async function resolveSolName(
  connection: Connection,
  rawName: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SolNameLookup> {
  const name = extractSolName(rawName)
  if (!name) {
    return {
      name: rawName.trim().toLowerCase(),
      status: 'unsupported',
      address: null,
      message: 'That is not a Solana name. Names end in .sns or .sol.',
    }
  }

  try {
    const owner = await withTimeout(resolve(connection, name), timeoutMs)
    const address = owner.toBase58()
    return { name, status: 'resolved', address, message: `${name} resolved to ${address}.` }
  } catch (err) {
    const type = sdkErrorType(err)
    const reason = err instanceof Error ? err.message : String(err)

    if (type === 'UnsupportedTld') {
      return {
        name,
        status: 'retired',
        address: null,
        message:
          ".sol names are being retired and can no longer be resolved. Ask for the owner's .sns name, or paste the address.",
      }
    }
    if (type === 'DomainDoesNotExist' || type === 'AccountDoesNotExist' || /does not exist/i.test(reason)) {
      return {
        name,
        status: 'not-found',
        address: null,
        message: `${name} is not registered on this network. Names are registered on mainnet - check the network in the header.`,
      }
    }
    return {
      name,
      status: 'error',
      address: null,
      message: `Could not look up ${name}: ${reason}`,
    }
  }
}
