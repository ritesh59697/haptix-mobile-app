/**
 * Recipient parsing for the send sheet.
 *
 * The sheet used to store whatever was on the clipboard, so a Solscan link, a chat line
 * or a `.sol` name landed in the recipient slot and only failed later inside
 * `new PublicKey()`. Two of these cases are the dangerous ones: a run that is truncated
 * at an invalid character can still decode to a *different* valid address, and text
 * carrying two addresses must never be resolved by picking one.
 */
import { describeRecipientSource, isSolanaAddress, parseRecipientInput } from '../utils/solana-address'

const ADDRESS = 'D6R74Cd433mgSUzazeSn97SMAo1yZp5o11tErm3GmDvu'
const OTHER_ADDRESS = 'So11111111111111111111111111111111111111112'

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

function rejects(name: string, input: string, expectedFragment: string) {
  const result = parseRecipientInput(input)
  assert(result.address === null, `${name}: rejected`, `parsed as ${result.address}`)
  assert(
    !!result.error && result.error.includes(expectedFragment),
    `${name}: explains why`,
    `error was ${JSON.stringify(result.error)}`,
  )
}

console.log('\nSolana recipient parsing\n')

assert(isSolanaAddress(ADDRESS), 'a 32-byte base58 address is accepted')
assert(!isSolanaAddress(ADDRESS.slice(0, 31)), 'a truncated address is rejected')
assert(!isSolanaAddress(`${ADDRESS.slice(0, -1)}O`), 'an address containing a non-base58 character is rejected')
assert(!isSolanaAddress('z'.repeat(32)), 'a base58 string of the right length but the wrong byte count is rejected')

// Accepted input -----------------------------------------------------------
const bare = parseRecipientInput(ADDRESS)
assert(bare.address === ADDRESS && bare.source === 'raw', 'a bare address is accepted as-is')

const wrapped = parseRecipientInput(`  ${ADDRESS.slice(0, 20)}\n${ADDRESS.slice(20)}  `)
assert(wrapped.address === ADDRESS, 'an address wrapped over two lines is rejoined')

const zeroWidth = parseRecipientInput(`D6R74Cd433mg\u200bSUzazeSn97SMAo1yZp5o11tErm3GmDvu`)
assert(zeroWidth.address === ADDRESS, 'an invisible character inside the address is stripped')

const link = parseRecipientInput(`https://solscan.io/account/${ADDRESS}`)
assert(link.address === ADDRESS && link.source === 'link', 'an explorer link yields its address')

const explorer = parseRecipientInput(`https://explorer.solana.com/address/${ADDRESS}?cluster=devnet`)
assert(explorer.address === ADDRESS, 'an explorer link with a query string still yields its address')

const pay = parseRecipientInput(`solana:${ADDRESS}?amount=0.5&spl-token=USDC`)
assert(pay.address === ADDRESS && pay.source === 'solana-pay', 'a Solana Pay URI yields its address')

const prose = parseRecipientInput(`hey, send 2 SOL to ${ADDRESS} when you get a chance`)
assert(prose.address === ADDRESS && prose.source === 'text', 'an address inside a chat line is extracted')

assert(
  !!describeRecipientSource('link')?.startsWith('Address extracted'),
  'an extracted address gets an explanation for the user',
)

// Rejected input -----------------------------------------------------------
// An empty field is "empty", not "wrong": the sheet shows no error until something
// has actually been typed or pasted.
assert(parseRecipientInput('   ').error === null, 'a blank field is not an error, it is simply empty')

rejects('two addresses', `${ADDRESS} ${OTHER_ADDRESS}`, 'more than one')
rejects('EVM address', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'Ethereum')
rejects('.sol domain', 'ritesh.sol', 'Name Service')
rejects('truncated address', 'D6R74Cd433mgSUzazeSn97SMA', 'too short')
rejects('over-long address', `${ADDRESS}AAAA`, 'longer than')
rejects('non-base58 character', `${ADDRESS.slice(0, -1)}O`, 'Base58 never contains')
rejects('any other link', 'https://x.com/someone/status/1234', 'does not contain a Solana address')

// The truncation trap: splitting on the base58 alphabet would leave `...GmDv`, which
// decodes to a valid 32-byte key -- a silently different recipient.
assert(
  parseRecipientInput(`${ADDRESS.slice(0, -1)}O`).address === null,
  'a typo at the end of an address is never salvaged into a different valid address',
)

// A pasted secret key must not be mistaken for a recipient.
const secretKey = '4NMwxntFZ1FhhcCqqaGk5Wt3m8JEqhE87iToXbfrEhhM9VCku9nfjhHY9bTsWmpmX9pcXJdKRSFViP6SmUffk'
assert(parseRecipientInput(secretKey).address === null, 'a 64-byte secret key is refused')
assert(
  !!parseRecipientInput(secretKey).error?.toLowerCase().includes('key'),
  'a 64-byte secret key is named as a key rather than generically invalid',
)

console.log(`\n  SOLANA ADDRESS TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
