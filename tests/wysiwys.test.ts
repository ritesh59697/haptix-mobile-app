import assert from 'assert'
import { PublicKey } from '@solana/web3.js'
import { verifyWysiwysPayload } from '../utils/haptix-wysiwys'
import {
  getTransferSignedMessage,
  getGrantAgentSignedMessage,
  getRevokeAgentSignedMessage,
  getSetGuardianSignedMessage,
  getSetSpendThresholdSignedMessage,
  getUnfreezeSignedMessage,
  getCancelRecoverySignedMessage,
  CLUSTER_DEVNET,
} from '../utils/haptix-client'

console.log('Testing WYSIWYS (What You See Is What You Sign) Payload Verification...')

const walletPda = new PublicKey('11111111111111111111111111111111')
const recipient = new PublicKey('9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke')
const rogueRecipient = new PublicKey('F2KbEr684c41WjtwqhWkKWbXfBWaZ49nG3A6vbVVrLgK')
const amountLamports = 100_000_000n // 0.1 SOL

// 1. Valid Transfer Payload
const transferMsg = getTransferSignedMessage(walletPda, recipient, amountLamports, 0n, CLUSTER_DEVNET)
assert.equal(transferMsg.length, 97)
const parsed = verifyWysiwysPayload(transferMsg, {
  expectedRecipient: recipient.toBase58(),
  expectedAmountLamports: amountLamports,
})
assert.equal(parsed.action, 'Transfer')
assert.equal(parsed.recipient, recipient.toBase58())
console.log('  PASS: valid transfer payload with recipient cross-validation')

// 2. Reject Recipient Mismatch (Screen vs Byte attack)
assert.throws(() => {
  verifyWysiwysPayload(transferMsg, {
    expectedRecipient: rogueRecipient.toBase58(),
  })
}, /recipient mismatch/)
console.log('  PASS: rejects payload with recipient mismatch')

// 3. Reject Amount Mismatch
assert.throws(() => {
  verifyWysiwysPayload(transferMsg, {
    expectedAmountLamports: 500_000_000n,
  })
}, /amount mismatch/)
console.log('  PASS: rejects payload with amount mismatch')

// 4. Reject short payload
assert.throws(() => {
  verifyWysiwysPayload(new Uint8Array([1, 2, 3]))
}, /WYSIWYS violation/)
console.log('  PASS: rejects truncated payload')

// 5. Reject unknown arbitrary payload (blind signing protection)
assert.throws(() => {
  verifyWysiwysPayload(Buffer.from('SOME_ARBITRARY_UNRECOGNIZED_PAYLOAD_BYTES_HERE_FOR_TESTING'))
}, /WYSIWYS violation/)
console.log('  PASS: rejects unrecognized arbitrary payload')

// 6. Valid Set Guardian (93 bytes) & reject malformed length
const guardianMsg = getSetGuardianSignedMessage(walletPda, recipient, 0n, CLUSTER_DEVNET)
assert.equal(guardianMsg.length, 93)
const parsedGuardian = verifyWysiwysPayload(guardianMsg)
assert.equal(parsedGuardian.action, 'Set Guardian')
assert.throws(() => {
  const bad = new Uint8Array(80)
  bad.set(Buffer.from('SET_GUARDIAN:'))
  verifyWysiwysPayload(bad)
}, /malformed SET_GUARDIAN payload/)
console.log('  PASS: verifies SET_GUARDIAN exact 93 bytes & rejects malformed')

// 7. Valid Set Spend Threshold (70 bytes) & reject malformed length
const thresholdMsg = getSetSpendThresholdSignedMessage(walletPda, 500_000_000n, 0n, CLUSTER_DEVNET)
assert.equal(thresholdMsg.length, 70)
const parsedThreshold = verifyWysiwysPayload(thresholdMsg)
assert.equal(parsedThreshold.action, 'Set Spend Threshold')
assert.throws(() => {
  const bad = new Uint8Array(65)
  bad.set(Buffer.from('SET_THRESHOLD:'))
  verifyWysiwysPayload(bad)
}, /malformed SET_THRESHOLD payload/)
console.log('  PASS: verifies SET_THRESHOLD exact 70 bytes & rejects malformed')

// 8. Valid Grant Agent (140 bytes) & reject malformed length
const grantMsg = getGrantAgentSignedMessage(
  walletPda,
  recipient,
  100_000_000n,
  3600n,
  0n,
  new PublicKey('11111111111111111111111111111111'),
  CLUSTER_DEVNET,
)
assert.equal(grantMsg.length, 140)
const parsedGrant = verifyWysiwysPayload(grantMsg)
assert.equal(parsedGrant.action, 'Grant Agent Session')
assert.throws(() => {
  const bad = new Uint8Array(100)
  bad.set(Buffer.from('GRANT_AGENT:'))
  verifyWysiwysPayload(bad)
}, /malformed GRANT_AGENT payload/)
console.log('  PASS: verifies GRANT_AGENT exact 140 bytes & rejects malformed')

// 9. Valid Revoke Agent (93 bytes) & reject malformed length
const revokeMsg = getRevokeAgentSignedMessage(walletPda, recipient, 0n, CLUSTER_DEVNET)
assert.equal(revokeMsg.length, 93)
const parsedRevoke = verifyWysiwysPayload(revokeMsg)
assert.equal(parsedRevoke.action, 'Revoke Agent Session')
assert.throws(() => {
  const bad = new Uint8Array(90)
  bad.set(Buffer.from('REVOKE_AGENT:'))
  verifyWysiwysPayload(bad)
}, /malformed REVOKE_AGENT payload/)
console.log('  PASS: verifies REVOKE_AGENT exact 93 bytes & rejects malformed')

// 10. Valid Unfreeze Wallet (64 bytes) & reject malformed length
const unfreezeMsg = getUnfreezeSignedMessage(walletPda, 0n, CLUSTER_DEVNET)
assert.equal(unfreezeMsg.length, 64)
const parsedUnfreeze = verifyWysiwysPayload(unfreezeMsg)
assert.equal(parsedUnfreeze.action, 'Unfreeze Wallet')
assert.throws(() => {
  const bad = new Uint8Array(60)
  bad.set(Buffer.from('UNFREEZE_WALLET:'))
  verifyWysiwysPayload(bad)
}, /malformed UNFREEZE_WALLET payload/)
console.log('  PASS: verifies UNFREEZE_WALLET exact 64 bytes & rejects malformed')

// 11. Valid Cancel Recovery (64 bytes) & reject malformed length
const cancelMsg = getCancelRecoverySignedMessage(walletPda, 0n, CLUSTER_DEVNET)
assert.equal(cancelMsg.length, 64)
const parsedCancel = verifyWysiwysPayload(cancelMsg)
assert.equal(parsedCancel.action, 'Cancel Recovery')
assert.throws(() => {
  const bad = new Uint8Array(50)
  bad.set(Buffer.from('CANCEL_RECOVERY:'))
  verifyWysiwysPayload(bad)
}, /malformed CANCEL_RECOVERY payload/)
console.log('  PASS: verifies CANCEL_RECOVERY exact 64 bytes & rejects malformed')

console.log('\n  ALL WYSIWYS TESTS PASSED!\n')
