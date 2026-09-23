import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  ContactEntry,
  MAX_SAVED_CONTACTS,
  parseStoredContacts,
  removeContact,
  sanitizeContactLabel,
  upsertContact,
} from './contact-list'

/**
 * Persistence for the address book.
 *
 * Keyed per device rather than per wallet, unlike the transaction history: a contact
 * is a person, not a property of one account, and a second wallet on the same phone
 * should not have to be re-taught the same recipients. The pure list operations live in
 * `contact-list` so they can be tested without React Native in the process.
 */

const STORAGE_KEY = '@haptix_contacts'

export async function loadContacts(): Promise<ContactEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return parseStoredContacts(JSON.parse(raw))
  } catch (err) {
    // A corrupt or unreadable book must not stop the wallet from sending.
    console.error('[Haptix Contacts] Failed to load the address book', err)
    return []
  }
}

async function persist(entries: ContactEntry[]): Promise<ContactEntry[]> {
  const next = entries.slice(0, MAX_SAVED_CONTACTS)
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (err) {
    console.error('[Haptix Contacts] Failed to save the address book', err)
  }
  return next
}

export async function saveContact(address: string, label?: string | null, at?: number): Promise<ContactEntry[]> {
  const entries = await loadContacts()
  return persist(upsertContact(entries, { address, label, lastUsedAt: at }))
}

export async function deleteContact(address: string): Promise<ContactEntry[]> {
  const entries = await loadContacts()
  return persist(removeContact(entries, address))
}

/** Records that a contact was used, without touching its label. */
export async function touchContact(address: string, at?: number): Promise<ContactEntry[]> {
  const entries = await loadContacts()
  if (!entries.some((entry) => entry.address === address)) return entries
  return persist(upsertContact(entries, { address, lastUsedAt: at }))
}

export { sanitizeContactLabel }
