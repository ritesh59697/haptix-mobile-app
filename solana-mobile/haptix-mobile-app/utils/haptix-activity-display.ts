import type { ComponentProps } from 'react'
import type MaterialIcons from '@expo/vector-icons/MaterialIcons'
import type { ThemeTokens } from '../theme/tokens'
import type { TransactionRecord, TransactionType } from './haptix-tx-parser'

/**
 * How an activity record is described, in one place.
 *
 * These used to be closures inside `haptix-wallet-screen.tsx`, so the row list, the
 * transaction-detail sheet and the activity filters each reached back into the screen
 * for answers the screen had no business owning. Moving them here means the memoized
 * rows can derive their own appearance instead of the screen handing them a fresh
 * closure on every render, which is what made `React.memo` useless.
 */

export type MaterialIconName = ComponentProps<typeof MaterialIcons>['name']

/**
 * Which transaction types belong to which family. They sit next to the presentation
 * helpers because "is this a security event" is the same question the icon, the title
 * and the activity filter all ask, and answering it in two places let them drift.
 */
export const SECURITY_TYPES: TransactionType[] = ['freeze', 'unfreeze', 'init', 'recovery', 'policy']
export const AGENT_TYPES: TransactionType[] = ['agent_trade', 'agent_session']
export const MOVEMENT_TYPES: TransactionType[] = ['transfer', 'airdrop', 'swap']

export function activityTitleFor(tx: TransactionRecord): string {
  // "Emergency Freeze" and "Smart Wallet Unlocked" described the mechanism. A row in a
  // history list is a thing that happened to the wallet, so it says what the wallet is
  // now: locked, or unlocked. The lock icon already carries the rest.
  if (tx.type === 'freeze') return 'Wallet Locked'
  if (tx.type === 'unfreeze') return 'Wallet Unlocked'
  if (tx.type === 'init') return 'On-Chain Setup'
  if (tx.type === 'airdrop') return 'Devnet Faucet'
  if (tx.type === 'agent_trade') return 'Agent Auto-Trade'
  if (tx.type === 'agent_session') return 'Agent Session Granted'
  if (tx.type === 'recovery') return 'Guardian Recovery'
  if (tx.type === 'policy') return 'Policy Updated'
  if (tx.type === 'swap') return 'Token Swap'
  return tx.direction === 'receive' ? 'Received SOL' : 'Transfer SOL'
}

// Rows derive their icon, colour and amount from the parsed on-chain data, so
// a failed or no-value transaction can never render as a completed transfer.
export function activityIconFor(tx: TransactionRecord): MaterialIconName {
  if (tx.type === 'freeze') return 'lock'
  if (tx.type === 'unfreeze') return 'lock-open'
  if (tx.type === 'init') return 'verified-user'
  if (tx.type === 'recovery') return 'health-and-safety'
  if (tx.type === 'policy') return 'tune'
  if (tx.type === 'agent_trade') return 'smart-toy'
  if (tx.type === 'agent_session') return 'vpn-key'
  if (tx.direction === 'receive') return 'arrow-downward'
  if (tx.direction === 'send') return 'arrow-outward'
  return 'receipt-long'
}

export interface ActivityTone {
  color: string
  background: string
  border: string
}

// Icon chips share one surface and carry their meaning in the icon colour. Tinting
// every inflow emerald turned the list into a grid of muddy green circles, and a
// tinted chip stopped meaning anything once most rows had one. Only the alarmed
// states fill their chip, so a filled chip is now the thing worth noticing.
export function activityToneFor(tx: TransactionRecord, theme: ThemeTokens): ActivityTone {
  const negative = tx.status === 'failed' || tx.type === 'freeze'
  const positive = tx.status !== 'failed' && (tx.direction === 'receive' || tx.type === 'unfreeze')
  if (negative) {
    return { color: theme.roseText, background: theme.roseBg, border: theme.roseBorder }
  }
  return {
    color: positive ? theme.emeraldText : theme.textPrimary,
    background: theme.bgElevated,
    border: theme.borderDefault,
  }
}

export function activityAmountFor(tx: TransactionRecord): string {
  if (tx.direction === 'none' || tx.amount <= 0) return '\u2014'
  return `${tx.direction === 'receive' ? '+' : '-'}${tx.amount.toFixed(4)} ${tx.tokenSymbol}`
}

/**
 * The badge under an activity row's title.
 *
 * Activity history is persisted to AsyncStorage, so a row written by an older build
 * keeps whatever wording shipped with that build. Changing the copy therefore only
 * reaches rows written from then on, and a device in continuous use ends up showing
 * "2-of-2 Key Quorum" and "Both passkeys" in the same list, which reads as two
 * different levels of security rather than one renamed concept. Rewriting the known
 * old strings on read repairs history that already exists.
 */
const LEGACY_SECURITY_LABELS: Record<string, string> = {
  '2-of-2 Key Quorum': 'Both passkeys',
  '2-of-2 Passkey Quorum': 'Both passkeys',
  'On-Chain Policy Setup': 'Wallet setup',
  'Secp256r1 Passkey': 'Passkey signature',
  'Guardian Panic Freeze': 'Guardian lock',
  'Emergency Freeze': 'Guardian lock',
}

export function activitySecurityLabelFor(tx: TransactionRecord): string {
  const raw = tx.securityType
  // A record whose type was never carried (an optimistic local write, or a parse that
  // only recovered the instruction) still lands on something true for the wallet as a
  // whole: every action here needed a passkey.
  if (!raw) return AGENT_TYPES.includes(tx.type) ? 'Agent session' : 'Passkey signature'
  return LEGACY_SECURITY_LABELS[raw] ?? raw
}
