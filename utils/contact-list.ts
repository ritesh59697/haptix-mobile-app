import { isSolanaAddress } from './solana-address'

/**
 * Saved recipients, plus the ranking that turns them into the send sheet's shortcuts.
 *
 * Pure on purpose (no storage, no React Native imports) so the ordering rules can be
 * exercised directly, the way `haptix-tx-parser` is kept free of RN dependencies and
 * `haptix-tx-history` does the persistence.
 *
 * The send sheet used to derive its shortcuts from transaction history alone, which
 * meant a recipient only reappeared if you had already paid them, and never carried a
 * name. Saved contacts now win over history, history fills the rest, and both are
 * capped to one row.
 */

export interface ContactEntry {
  address: string
  /** Optional human label. Null means "show the address". */
  label: string | null
  /** Ms since epoch; used only to keep the newest first when nothing else separates two. */
  lastUsedAt: number
}

export interface RankedRecipient {
  address: string
  label: string | null
  /** True when the entry came from the address book rather than from history. */
  saved: boolean
}

/** One row of chips fits this many; more would push the amount field off screen. */
export const MAX_VISIBLE_RECIPIENTS = 3

/** Keeps the stored book small enough to load in one AsyncStorage read. */
export const MAX_SAVED_CONTACTS = 24

const MAX_LABEL_LENGTH = 32

/** Strips control characters and caps the length, or null when nothing usable is left. */
export function sanitizeContactLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, MAX_LABEL_LENGTH)
}

/**
 * Adds or updates a contact, newest first, capped at {@link MAX_SAVED_CONTACTS}.
 * Invalid addresses are ignored: the book must never be a way to smuggle in a bad one.
 */
export function upsertContact(
  entries: ContactEntry[],
  next: { address: string; label?: string | null; lastUsedAt?: number },
): ContactEntry[] {
  if (!isSolanaAddress(next.address)) return entries
  const address = next.address.trim()
  const existing = entries.find((entry) => entry.address === address)
  const label = sanitizeContactLabel(next.label) ?? existing?.label ?? null
  const lastUsedAt = next.lastUsedAt ?? Date.now()
  const withoutAddress = entries.filter((entry) => entry.address !== address)
  return [{ address, label, lastUsedAt }, ...withoutAddress].slice(0, MAX_SAVED_CONTACTS)
}

export function removeContact(entries: ContactEntry[], address: string): ContactEntry[] {
  return entries.filter((entry) => entry.address !== address)
}

export function findContact(entries: ContactEntry[], address: string | null): ContactEntry | null {
  if (!address) return null
  return entries.find((entry) => entry.address === address) ?? null
}

/**
 * Saved contacts first (they were named on purpose), then addresses this wallet has
 * paid, deduplicated by address. `self` is excluded so the sheet never offers to send
 * to the wallet's own account.
 */
export function rankRecipients(
  contacts: ContactEntry[],
  recentAddresses: string[],
  limit: number = MAX_VISIBLE_RECIPIENTS,
  self?: string | null,
): RankedRecipient[] {
  const ranked: RankedRecipient[] = []
  const seen = new Set<string>()

  const accept = (address: string, label: string | null, saved: boolean) => {
    if (!isSolanaAddress(address)) return
    if (self && address === self) return
    if (seen.has(address)) return
    seen.add(address)
    ranked.push({ address, label, saved })
  }

  for (const contact of [...contacts].sort((a, b) => b.lastUsedAt - a.lastUsedAt)) {
    accept(contact.address, sanitizeContactLabel(contact.label), true)
  }
  for (const address of recentAddresses) {
    accept(address.trim(), null, false)
  }

  return ranked.slice(0, Math.max(0, limit))
}

/** Drops malformed records that a previous build may have written. */
export function parseStoredContacts(raw: unknown): ContactEntry[] {
  if (!Array.isArray(raw)) return []
  const parsed: ContactEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { address, label, lastUsedAt } = item as Partial<ContactEntry>
    if (typeof address !== 'string' || !isSolanaAddress(address)) continue
    parsed.push({
      address: address.trim(),
      label: sanitizeContactLabel(typeof label === 'string' ? label : null),
      lastUsedAt: typeof lastUsedAt === 'number' && Number.isFinite(lastUsedAt) ? lastUsedAt : 0,
    })
  }
  return parsed.slice(0, MAX_SAVED_CONTACTS)
}
