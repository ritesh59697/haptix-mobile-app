/**
 * How an activity record is described on screen.
 *
 * The wallet renders the same transaction twice -- once as a compact row in the home
 * preview, once in the full Activity list -- and the detail sheet describes it a third
 * time. These rules used to live inside the screen as three separate closures, so the
 * amount colour was written out twice with the branches in a different order, and the
 * icon/colour/amount answers could only be exercised by rendering the screen.
 *
 * This suite pins the parts that must not drift: a failed transaction can never read as
 * a completed transfer, the un-amount is a dash rather than "0.0000", and the alarm
 * colours are reserved for the states that are actually alarming.
 */
import { darkTokens, lightTokens } from '../theme/tokens'
import { TransactionRecord } from '../utils/haptix-tx-parser'
import {
  AGENT_TYPES,
  MOVEMENT_TYPES,
  SECURITY_TYPES,
  activityAmountFor,
  activityIconFor,
  activitySecurityLabelFor,
  activityTitleFor,
  activityToneFor,
} from '../utils/haptix-activity-display'

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

function record(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    signature: 'sig',
    type: 'transfer',
    direction: 'send',
    amount: 0.05,
    tokenSymbol: 'SOL',
    recipientOrSender: 'recipient',
    timestamp: 1_700_000_000_000,
    status: 'confirmed',
    ...overrides,
  }
}

console.log('\nActivity display rules\n')

// --- Titles ---------------------------------------------------------------------------
assert(activityTitleFor(record({ type: 'freeze' })) === 'Wallet locked', 'a freeze reads as the wallet being locked in sentence case')
assert(activityTitleFor(record({ type: 'agent_trade' })) === 'Agent auto-trade', 'an agent trade names the agent in sentence case')
assert(
  activityTitleFor(record({ type: 'transfer', direction: 'receive' })) === 'Received SOL',
  'an inflow is "Received SOL"',
)
assert(activityTitleFor(record({ type: 'transfer', direction: 'send' })) === 'Transfer SOL', 'an outflow is "Transfer SOL"')

// --- Amounts --------------------------------------------------------------------------
assert(
  activityAmountFor(record({ direction: 'receive', amount: 1.5 })) === '+1.5000 SOL',
  'an inflow is signed positive',
)
assert(
  activityAmountFor(record({ direction: 'send', amount: 0.25 })) === '-0.2500 SOL',
  'an outflow is signed negative',
)
assert(
  activityAmountFor(record({ direction: 'none', amount: 0 })) === '',
  'a transaction that moved nothing shows empty string (omitted), not a placeholder',
)
assert(
  activityAmountFor(record({ direction: 'send', amount: 0, type: 'agent_session' })) === '',
  'a zero-value agent session shows empty string too',
)

// --- Icons ----------------------------------------------------------------------------
assert(activityIconFor(record({ type: 'freeze' })) === 'lock', 'the freeze icon is a lock')
assert(activityIconFor(record({ type: 'unfreeze' })) === 'lock-open', 'the unfreeze icon is an open lock')
assert(activityIconFor(record({ direction: 'receive' })) === 'arrow-downward', 'an inflow points down into the wallet')
assert(
  activityIconFor(record({ direction: 'none', type: 'policy' })) === 'tune',
  'a type with its own icon does not fall through to the direction rules',
)

// --- Colour ---------------------------------------------------------------------------
// The failure case is the one that matters: a failed transfer must never be dressed as a
// completed one, whichever list happens to render it.
const failedTone = activityToneFor(record({ status: 'failed' }), darkTokens)
assert(failedTone.color === darkTokens.roseText, 'a failed transaction carries the alarm colour')
assert(failedTone.background === darkTokens.roseBg, 'and fills its chip, so it is the thing worth noticing')

const failedReceiveTone = activityToneFor(record({ status: 'failed', direction: 'receive' }), darkTokens)
assert(
  failedReceiveTone.color === darkTokens.roseText,
  'a failed inflow is still an alarm, not a success',
  failedReceiveTone.color,
)

const frozenTone = activityToneFor(record({ type: 'freeze' }), darkTokens)
assert(frozenTone.color === darkTokens.roseText, 'a freeze is alarmed even though its status is "confirmed"')

const receivedTone = activityToneFor(record({ direction: 'receive' }), darkTokens)
assert(receivedTone.color === darkTokens.emeraldText, 'an inflow reads as positive')
assert(
  receivedTone.background === darkTokens.bgElevated,
  'but its chip stays unfilled, so a filled chip keeps meaning "alarm"',
)

const sentTone = activityToneFor(record({ direction: 'send' }), darkTokens)
assert(sentTone.color === darkTokens.textPrimary, 'an ordinary outflow is plain text, not a warning')

// The sheet and the rows resolve every colour through the theme, so a light-mode wallet
// must not be handed dark-mode hexes.
const sentToneLight = activityToneFor(record({ direction: 'send' }), lightTokens)
assert(
  sentToneLight.background === lightTokens.bgElevated && sentToneLight.background !== darkTokens.bgElevated,
  'the chip surface follows the active theme rather than a hard-coded dark value',
)

// --- Families -------------------------------------------------------------------------
assert(AGENT_TYPES.includes('agent_trade') && !AGENT_TYPES.includes('transfer'), 'agent ops are their own family')
assert(MOVEMENT_TYPES.includes('transfer') && MOVEMENT_TYPES.includes('swap'), 'transfers and swaps are movements')
assert(SECURITY_TYPES.includes('recovery') && !SECURITY_TYPES.includes('transfer'), 'recoveries are security events')
assert(
  AGENT_TYPES.every((type) => !MOVEMENT_TYPES.includes(type)) &&
    SECURITY_TYPES.every((type) => !MOVEMENT_TYPES.includes(type)),
  'no type belongs to two families, or one row would appear under two filters',
)

// --- Security badges --------------------------------------------------------------------
// Activity history is persisted, so rows written by an older build outlive the copy change
// that renamed them. Without these rewrites a single list shows "2-of-2 Key Quorum" next to
// "Both passkeys" for the same kind of event.
assert(
  activitySecurityLabelFor(record({ securityType: '2-of-2 Key Quorum' })) === 'Both passkeys',
  'a badge written by an older build is rewritten to the current wording',
)
assert(
  activitySecurityLabelFor(record({ securityType: 'On-Chain Policy Setup' })) === 'Wallet setup',
  'the retired setup badge does not survive as a second name for one thing',
)
assert(
  activitySecurityLabelFor(record({ securityType: 'Both passkeys' })) === 'Both passkeys',
  'a badge already in the current wording is left alone',
)
assert(
  activitySecurityLabelFor(record({ type: 'agent_session' })) === 'Agent session' &&
    activitySecurityLabelFor(record({ type: 'transfer' })) === 'Passkey signature',
  'a record with no stored badge still says how it was approved rather than rendering blank',
)

console.log(`\n  ACTIVITY DISPLAY TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
