import React, { memo } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import Clipboard from '@/utils/clipboard'
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'
import { ellipsify } from '@/utils/ellipsify'
import { AgentSessionState } from '@/utils/haptix-client'
import { TransactionRecord } from '@/utils/haptix-tx-history'
import {
  AGENT_TYPES,
  activityAmountFor,
  activityIconFor,
  activitySecurityLabelFor,
  activityTitleFor,
  activityToneFor,
} from '@/utils/haptix-activity-display'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixCountdown } from './haptix-countdown'
import { useWalletStyles } from './haptix-wallet-styles'

/**
 * The wallet's repeating rows, as components rather than `map()` bodies.
 *
 * These were inlined in `haptix-wallet-screen.tsx`, which meant every state change the
 * screen owned -- an incoming price, a `nowSeconds` tick, a keystroke in a modal far
 * away -- re-ran the JSX for every row on every page, because the rows were part of
 * the screen's own render output. Each row now takes its data as props and is wrapped
 * in `memo`, so it repaints when its own transaction or session changes and stays put
 * otherwise.
 *
 * The props are deliberately small: the row reads the theme and the style sheet from
 * context instead of receiving them as props, because both are stable objects now
 * (see `haptix-wallet-styles.ts` and the note on `useAppTheme`), and passing them down
 * would have meant two more things to keep referentially equal.
 */

export type ActivityRowVariant = 'compact' | 'detail'

interface ActivityRowProps {
  tx: TransactionRecord
  /**
   * `compact` is the three-row preview on the home page: icon, title, time, amount.
   * `detail` is the full Activity list, which adds the security-type chip and the
   * confirmation badge. The preview is deliberately plumbing-free -- a "Finalized"
   * badge on every row turned the home page into a status dashboard.
   */
  variant: ActivityRowVariant
  /** Opens the detail sheet. Must be referentially stable or `memo` below does nothing. */
  onSelect: (tx: TransactionRecord) => void
}

export const ActivityRow = memo(function ActivityRow({ tx, variant, onSelect }: ActivityRowProps) {
  const { theme } = useAppTheme()
  const styles = useWalletStyles()
  const tone = activityToneFor(tx, theme)
  const failed = tx.status === 'failed'
  const received = tx.direction === 'receive'

  const amount = (
    <Text
      style={[
        styles.activityAmount,
        failed
          ? { color: theme.roseText, fontWeight: '700' }
          : received
            ? { color: theme.emeraldText, fontWeight: '700' }
            : styles.textPrimary,
      ]}
    >
      {failed ? 'Failed' : activityAmountFor(tx)}
    </Text>
  )

  return (
    <TouchableOpacity
      style={styles.activityRow}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onSelect(tx)
      }}
      activeOpacity={0.7}
    >
      <View style={styles.activityLeft}>
        <View style={[styles.activityIconCircle, { backgroundColor: tone.background, borderColor: tone.border }]}>
          <MaterialIcons name={activityIconFor(tx)} size={18} color={tone.color} />
        </View>
        <View style={variant === 'detail' ? { flexShrink: 1 } : undefined}>
          <Text style={[styles.activityItemTitle, styles.textPrimary]}>{activityTitleFor(tx)}</Text>
          {variant === 'compact' ? (
            <Text style={[styles.activityItemDate, styles.textMuted]}>
              {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Text style={[styles.activityItemDate, styles.textMuted]}>
                {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <Text style={styles.textMuted}>·</Text>
              <Text
                style={[
                  styles.activitySecurityBadge,
                  { color: AGENT_TYPES.includes(tx.type) ? theme.accent : theme.textMuted },
                ]}
                numberOfLines={1}
              >
                {activitySecurityLabelFor(tx)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* The compact row places the amount straight into the row, as it always has; only
          the detail row wraps it, so the two lists keep the exact trees they had before
          they were folded into one component. */}
      {variant === 'compact' ? (
        amount
      ) : (
        <View style={styles.activityRight}>
          {amount}
          <View style={styles.confirmedBadgeRow}>
            <MaterialIcons
              name={failed ? 'error-outline' : 'check'}
              size={11}
              color={failed ? theme.roseText : theme.textMuted}
            />
            <Text style={[styles.confirmedBadgeText, { color: failed ? theme.roseText : theme.textMuted }]}>
              {failed ? 'Failed' : tx.status === 'finalized' ? 'Finalized' : 'Confirmed'}
            </Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  )
})

interface AgentSessionRowProps {
  session: AgentSessionState
  /**
   * Computed by the screen from its own deadline timer rather than by a clock in here:
   * the screen already re-renders when a session runs out (it has to, to drop the row
   * from the active count), so a second timer per row would only have bought the same
   * answer at the cost of a repaint a second.
   */
  isExpired: boolean
  isRevoking: boolean
  /** Must be referentially stable or `memo` below does nothing. */
  onRevoke: (session: AgentSessionState) => void
}

export const AgentSessionRow = memo(function AgentSessionRow({
  session,
  isExpired,
  isRevoking,
  onRevoke,
}: AgentSessionRowProps) {
  const { theme, isDark } = useAppTheme()
  const styles = useWalletStyles()
  const sessionKey = session.agentPubkey.toBase58()
  const remainingAllowance = Number(session.allowanceLamports) / LAMPORTS_PER_SOL

  const handleCopySessionKey = () => {
    Clipboard.setString(sessionKey)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  }

  return (
    <View style={styles.agentCompactRow}>
      <View
        style={[
          styles.agentCompactIcon,
          {
            backgroundColor: isExpired ? theme.roseBg : theme.bgElevated,
            borderColor: isExpired ? theme.roseBorder : theme.borderDefault,
          },
        ]}
      >
        <MaterialIcons
          name={isExpired ? 'timer-off' : 'vpn-key'}
          size={18}
          color={isExpired ? theme.rose : theme.emerald}
        />
      </View>
      <View style={{ flex: 1, paddingRight: 4 }}>
        <TouchableOpacity
          onPress={handleCopySessionKey}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Copy agent session key"
          activeOpacity={0.7}
        >
          <Text style={[styles.agentCompactName, styles.textPrimary]}>{ellipsify(sessionKey, 6)}</Text>
          <MaterialIcons name="content-copy" size={12} color={theme.textMuted} />
        </TouchableOpacity>

        {/* Live Status & Countdown Badge */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: isExpired ? theme.roseBg : theme.emeraldBg,
            borderColor: isExpired ? theme.roseBorder : theme.emeraldBorder,
            borderWidth: 1,
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 6,
            alignSelf: 'flex-start',
            marginTop: 4,
            marginBottom: 4,
          }}
        >
          <View
            style={{
              width: 5,
              height: 5,
              borderRadius: 3,
              backgroundColor: isExpired ? theme.rose : theme.emerald,
            }}
          />
          {isExpired ? (
            <Text style={{ fontSize: 11, color: theme.roseText, fontWeight: '600' }}>Expired</Text>
          ) : (
            <HaptixCountdown
              until={Number(session.validUntil)}
              suffix=" left"
              style={{ fontSize: 11, color: theme.emeraldText, fontWeight: '600' }}
            />
          )}
        </View>

        <Text style={[styles.agentCompactSub, styles.textMuted]}>
          {remainingAllowance.toFixed(4)} SOL delegated ·{' '}
          {session.allowedProgram.equals(SystemProgram.programId)
            ? 'SOL transfers'
            : `Program ${ellipsify(session.allowedProgram.toBase58(), 4)}`}
        </Text>

        {/* Allowance Mini Progress Bar */}
        <View
          style={[
            styles.agentMiniProgressBar,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
          ]}
        >
          <View
            style={[
              styles.agentMiniProgressFill,
              {
                width: isExpired ? '0%' : '100%',
                backgroundColor: isExpired ? theme.rose : theme.accent,
              },
            ]}
          />
        </View>
      </View>
      <TouchableOpacity
        style={[styles.agentRevokeBtn, { borderColor: theme.roseBorder }]}
        onPress={() => onRevoke(session)}
        disabled={isRevoking}
        accessibilityRole="button"
        accessibilityLabel={`Revoke agent session ${ellipsify(sessionKey, 4)}`}
      >
        {isRevoking ? (
          <ActivityIndicator size="small" color={theme.roseText} />
        ) : (
          <Text style={styles.agentRevokeBtnText}>Revoke</Text>
        )}
      </TouchableOpacity>
    </View>
  )
})
