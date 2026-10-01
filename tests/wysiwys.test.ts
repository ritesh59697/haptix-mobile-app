import assert from 'assert'
import { PublicKey } from '@solana/web3.js'
import { verifyWysiwysPayload } from '../utils/haptix-wysiwys'
import { getTransferSignedMessage, CLUSTER_DEVNET, CLUSTER_MAINNET } from '../utils/haptix-client'

console.log('Testing WYSIWYS (What You See Is What You Sign) Payload Verification...')

const walletPda = new PublicKey('11111111111111111111111111111111')
const recipient = new PublicKey('9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke')
const amountLamports = 100_000_000n // 0.1 SOL

// 1. Valid Transfer Payload
const transferMsg = getTransferSignedMessage(walletPda, recipient, amountLamports, 0n, CLUSTER_DEVNET)
const parsed = verifyWysiwysPayload(transferMsg)
assert.equal(parsed.action, 'Transfer')
assert.equal(parsed.details, '0.1 SOL')
console.log('  PASS: valid transfer payload verified')

// 2. Reject short payload
assert.throws(() => {
  verifyWysiwysPayload(new Uint8Array([1, 2, 3]))
}, /WYSIWYS violation/)
console.log('  PASS: rejects truncated payload')

// 3. Reject unknown arbitrary payload (blind signing protection)
assert.throws(() => {
  verifyWysiwysPayload(Buffer.from('SOME_ARBITRARY_UNRECOGNIZED_PAYLOAD_BYTES_HERE_FOR_TESTING'))
}, /WYSIWYS violation/)
console.log('  PASS: rejects unrecognized arbitrary payload')

// 4. Reject malformed TRANSFER length
const malformedTransfer = new Uint8Array(50)
malformedTransfer.set(Buffer.from('TRANSFER:'))
assert.throws(() => {
  verifyWysiwysPayload(malformedTransfer)
}, /malformed TRANSFER payload/)
console.log('  PASS: rejects malformed transfer length')

console.log('\n  ALL WYSIWYS TESTS PASSED!\n')
