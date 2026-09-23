import { PublicKey } from '@solana/web3.js'

/**
 * Recipient input handling for the send sheet.
 *
 * The field used to accept whatever was on the clipboard (`setSendRecipient(text.trim())`),
 * so pasting a Solscan link, a chat line, or a `.sol` name put junk into the recipient slot
 * that only failed much later inside `new PublicKey()`. Everything here is pure and
 * Node-testable so the parsing rules can be exercised directly.
 */

/** Base58 is 32-44 characters for a 32-byte key. */
export const MIN_SOLANA_ADDRESS_LENGTH = 32
export const MAX_SOLANA_ADDRESS_LENGTH = 44

const BASE58_ONLY = /^[1-9A-HJ-NP-Za-km-z]+$/
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g
const ALL_WHITESPACE = /[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g
const ADDRESS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const SOLANA_PAY = /^solana:([1-9A-HJ-NP-Za-km-z]{32,44})/i
const OTHER_CHAIN_SCHEME = /^(ethereum|bitcoin|bchtest|litecoin|tron|ton|cosmos|polkadot):/i

/**
 * True only for a canonical 32-byte base58 address.
 *
 * A length/charset regex is not enough: every one of these decodes to something other
 * than 32 bytes, and `new PublicKey` is the only check that actually agrees with the
 * RPC. Returning `false` here means the address would be rejected at signing time.
 */
export function isSolanaAddress(value: string): boolean {
  const candidate = (value ?? '').trim()
  if (!candidate || candidate.length < MIN_SOLANA_ADDRESS_LENGTH) return false
  if (candidate.length > MAX_SOLANA_ADDRESS_LENGTH) return false
  if (!BASE58_ONLY.test(candidate)) return false
  try {
    return new PublicKey(candidate).toBuffer().length === 32
  } catch {
    return false
  }
}

export type RecipientSource = 'raw' | 'solana-pay' | 'link' | 'text'

export interface RecipientParseResult {
  /** The address to use, or null when the input did not contain one. */
  address: string | null
  /** Where the address came from, so the sheet can explain what it did. */
  source: RecipientSource | null
  /** Actionable reason the input was rejected, or null when it parsed cleanly. */
  error: string | null
}

function stripInvisible(raw: string): string {
  return (raw ?? '').replace(ZERO_WIDTH, '').trim()
}

/**
 * Every alphanumeric run in a blob of text, split on URL, punctuation and whitespace
 * boundaries.
 *
 * The split is deliberately *not* on the base58 alphabet: splitting there turns
 * `...GmDvO` (a typo) into the 37-character `...GmDv`, which is itself a perfectly
 * decodable 32-byte key. The sheet would then have silently accepted a different
 * address than the one that was pasted. Keeping the run intact lets the character
 * check reject it instead.
 */
function candidateTokens(text: string): string[] {
  return text
    .split(/[^0-9A-Za-z]+/)
    .filter((token) => token.length >= MIN_SOLANA_ADDRESS_LENGTH && token.length <= MAX_SOLANA_ADDRESS_LENGTH)
}

function found(address: string, source: RecipientSource): RecipientParseResult {
  return { address, source, error: null }
}

function rejected(error: string): RecipientParseResult {
  return { address: null, source: null, error }
}

/**
 * Explains why a string is not an address, in terms of what the user probably pasted.
 * The generic "invalid address" toast that used to appear after the tap did not tell
 * anyone which character was wrong or which chain they had copied from.
 */
function diagnose(cleaned: string): string {
  const compact = cleaned.replace(ALL_WHITESPACE, '')

  if (/^0x[a-fA-F0-9]{40}$/.test(compact)) {
    return 'That is an Ethereum / EVM address (0x…). Solana addresses are base58 and never start with 0x.'
  }
  if (/^0x/.test(compact)) {
    return 'That looks like a hex address from another chain. Solana addresses are base58, 32-44 characters.'
  }
  if (/(^|[^a-z0-9])[a-z0-9-]+\.sol$/i.test(cleaned)) {
    return 'Solana Name Service (.sol) domains cannot be resolved here yet. Paste the base58 address instead.'
  }
  if (/^[0-9a-fA-F]{128}$/.test(compact)) {
    return 'That is a 64-byte key, not an address. Never paste a private key into a recipient field.'
  }
  if (BASE58_ONLY.test(compact) && compact.length > MAX_SOLANA_ADDRESS_LENGTH) {
    return 'That is longer than a Solana address (44 characters). If it is a key or a signature, it is not a recipient.'
  }
  if (ADDRESS_SCHEME.test(cleaned) || OTHER_CHAIN_SCHEME.test(cleaned)) {
    return 'That link does not contain a Solana address.'
  }
  if (compact.length > 0 && compact.length < MIN_SOLANA_ADDRESS_LENGTH) {
    return 'That address is too short - check that the copy was complete.'
  }
  if (compact.length > MAX_SOLANA_ADDRESS_LENGTH) {
    return 'That is longer than a Solana address (44 characters).'
  }
  if (BASE58_ONLY.test(compact)) {
    return 'That decodes to the wrong number of bytes for a Solana address. Check for a missing or extra character.'
  }
  if (/[0OIl]/.test(compact)) {
    return 'Base58 never contains 0, O, I or l - check for a 0 instead of O, or an l instead of 1.'
  }
  return 'Not a valid Solana address. Check for missing or pasted-over characters.'
}

/**
 * Turns anything a user might paste into an address, or an explanation of why it is not one.
 *
 * Accepted: a bare address, an address wrapped over several lines, a Solana Pay URI
 * (`solana:<address>?amount=…`), an explorer link, and text with one address inside it.
 */
export function parseRecipientInput(raw: string): RecipientParseResult {
  const cleaned = stripInvisible(raw)
  if (!cleaned) return { address: null, source: null, error: null }

  if (isSolanaAddress(cleaned)) return found(cleaned, 'raw')

  // Line-wrapped or space-separated copies of an address (explorer UIs, email, chat).
  const compact = cleaned.replace(ALL_WHITESPACE, '')
  if (isSolanaAddress(compact)) return found(compact, 'raw')

  const payMatch = cleaned.match(SOLANA_PAY)
  if (payMatch && isSolanaAddress(payMatch[1])) return found(payMatch[1], 'solana-pay')

  // Any base58-shaped token, whether it arrived inside a URL path, a query string or prose.
  const tokens = Array.from(new Set(candidateTokens(cleaned)))
  const valid = tokens.filter(isSolanaAddress)

  if (valid.length === 1) {
    return found(valid[0], ADDRESS_SCHEME.test(cleaned) ? 'link' : 'text')
  }
  if (valid.length > 1) {
    return rejected('That text contains more than one Solana address. Paste only the recipient you want.')
  }

  return rejected(diagnose(cleaned))
}

/**
 * Short confirmation for the send sheet after a paste, so the user can see that the
 * sheet picked the address out of a link or a message instead of storing the whole paste.
 */
export function describeRecipientSource(source: RecipientSource | null): string | null {
  switch (source) {
    case 'solana-pay':
      return 'Address read from the Solana Pay link you pasted.'
    case 'link':
      return 'Address extracted from the link you pasted.'
    case 'text':
      return 'Address found in the text you pasted.'
    default:
      return null
  }
}
