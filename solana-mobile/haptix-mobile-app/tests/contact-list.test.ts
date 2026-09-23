/**
 * Address book rules.
 *
 * The send sheet's shortcut row is the only place these run, so the ordering and the
 * rejection rules are pinned here: a name the user typed must outrank an address that
 * merely appeared in history, and nothing may enter the book that the recipient parser
 * would refuse to send to.
 */
import {
  MAX_SAVED_CONTACTS,
  MAX_VISIBLE_RECIPIENTS,
  findContact,
  parseStoredContacts,
  rankRecipients,
  removeContact,
  sanitizeContactLabel,
  upsertContact,
} from '../utils/contact-list'
import { extractSolName, looksLikeSolName } from '../utils/solana-names'

const A = 'D6R74Cd433mgSUzazeSn97SMAo1yZp5o11tErm3GmDvu'
const B = 'So11111111111111111111111111111111111111112'
const C = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'

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

console.log('\nAddress book\n')

// Saving -------------------------------------------------------------------
let book = upsertContact([], { address: A, label: '  Amit  ', lastUsedAt: 1 })
assert(book.length === 1 && book[0].label === 'Amit', 'a label is trimmed before it is stored')

book = upsertContact(book, { address: A, label: null, lastUsedAt: 2 })
assert(book.length === 1 && book[0].label === 'Amit', 're-saving without a label keeps the existing one')

book = upsertContact(book, { address: A, label: 'Amit Shah', lastUsedAt: 3 })
assert(book[0].label === 'Amit Shah' && book.length === 1, 'the newest name wins and does not duplicate')

assert(
  upsertContact(book, { address: 'not-an-address' }).length === book.length,
  'an invalid address is refused by the book',
)
assert(
  upsertContact(book, { address: A, label: 'a'.repeat(80) })[0].label?.length === 32,
  'an over-long label is capped',
)
assert(sanitizeContactLabel('   ') === null, 'a whitespace-only label becomes null')
assert(sanitizeContactLabel('bad\u0000name') === 'badname', 'control characters are stripped from labels')

let big: typeof book = []
for (let i = 0; i < MAX_SAVED_CONTACTS + 5; i++) {
  big = upsertContact(big, { address: A, label: `n${i}`, lastUsedAt: i })
}
assert(big.length === 1, 'the same address never fills the book')

book = removeContact(book, A)
assert(book.length === 0, 'a contact can be removed')
assert(
  findContact(upsertContact([], { address: B, label: 'Bo' }), B)?.label === 'Bo',
  'findContact locates a saved entry',
)
assert(findContact([], null) === null, 'findContact tolerates a null address')

// Ranking ------------------------------------------------------------------
const contacts = [
  { address: B, label: 'Bo', lastUsedAt: 10 },
  { address: A, label: null, lastUsedAt: 20 },
]
const ranked = rankRecipients(contacts, [C, B], MAX_VISIBLE_RECIPIENTS, null)
assert(ranked.length === 3, 'ranking fills the visible row from saved contacts and history')
assert(ranked[0].address === A && ranked[1].address === B, 'saved contacts keep their own recency order')
assert(ranked[2].address === C && !ranked[2].saved, 'history fills the remaining slots')
assert(
  ranked.filter((entry) => entry.address === B).length === 1,
  'an address that is both saved and recent appears once',
)

const selfFiltered = rankRecipients(contacts, [C], MAX_VISIBLE_RECIPIENTS, C)
assert(!selfFiltered.some((entry) => entry.address === C), 'the wallet never offers itself as a recipient')

const capped = rankRecipients(contacts, [C, A, B, C], MAX_VISIBLE_RECIPIENTS, null)
assert(capped.length === MAX_VISIBLE_RECIPIENTS, 'the visible row is capped')
assert(
  rankRecipients([{ address: 'garbage', label: 'x', lastUsedAt: 1 }], [], 3, null).length === 0,
  'a malformed stored entry is never offered',
)

// Stored records written by an older build ----------------------------------
assert(parseStoredContacts(null).length === 0, 'a missing book parses to an empty book')
assert(parseStoredContacts('nope' as unknown).length === 0, 'a corrupt book parses to an empty book')
assert(
  parseStoredContacts([{ address: A, label: 5, lastUsedAt: 'soon' }])[0].label === null,
  'a stored record with the wrong label type degrades to no label',
)
assert(
  parseStoredContacts([{ address: 'not-an-address' }, { address: A }]).length === 1,
  'stored records are validated on read',
)

// Solana names ---------------------------------------------------------------
assert(looksLikeSolName('Ritesh.SNS'), 'a .sns name is recognised regardless of case')
assert(looksLikeSolName('  ritesh.sol  '), 'a legacy .sol name is recognised')
assert(extractSolName('solana:ritesh.sns') === 'ritesh.sns', 'a solana: URI prefix is stripped')
assert(extractSolName('"ritesh.sns"') === 'ritesh.sns', 'surrounding quotes are stripped')
assert(extractSolName('pay.ritesh.sns') === 'pay.ritesh.sns', 'subdomains are supported')
assert(extractSolName('ritesh.eth') === null, 'a non-Solana name is not a name this wallet resolves')
assert(extractSolName('send to ritesh.sns now') === null, 'a sentence is not a name')
assert(extractSolName('.sns') === null, 'a bare suffix is not a name')
assert(extractSolName('https://example.com/ritesh.sns') === null, 'a URL is not a name')

console.log(`\n  CONTACT LIST TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
