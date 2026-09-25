import React, { useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'
import { ellipsify } from '@/utils/ellipsify'
import { formatRemainingTime } from '@/utils/recovery-timelock'
import { StagedRecoveryKeys } from '@/utils/haptix-passkey'
import { PrismDepthButton, DepthOutlineButton, HoldToConfirmButton } from '@/components/ui'
import {
  LucideShieldCheck,
  LucideKeyRound,
  LucideFingerprint,
  Lock1Bold,
} from '@/components/haptix/haptix-icons'

// ============================================================================
// 1. TIMELOCK COUNTDOWN CARD (IN-FLIGHT GUARDIAN RECOVERY)
// ============================================================================

export interface HaptixTimelockCountdownCardProps {
  secondsLeft: number
  totalTimelockSeconds: number
  recoveryInitiatedAt: number
  stagedRecovery: StagedRecoveryKeys | null
  isBusy: boolean
  busyAction: null | 'initiate' | 'cancel' | 'execute'
  onVeto: () => void
  onExecute: () => void
  explorerUrl?: string
}

export function HaptixTimelockCountdownCard({
  secondsLeft,
  totalTimelockSeconds,
  recoveryInitiatedAt,
  stagedRecovery,
  isBusy,
  busyAction,
  onVeto,
  onExecute,
  explorerUrl,
}: HaptixTimelockCountdownCardProps) {
  const { theme, isDark } = useAppTheme()
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark])

  // Calculation of elapsed progress
  const progressPercent = useMemo(() => {
    if (totalTimelockSeconds <= 0) return 100
    const elapsed = totalTimelockSeconds - secondsLeft
    const pct = Math.min(100, Math.max(0, Math.round((elapsed / totalTimelockSeconds) * 100)))
    return pct
  }, [totalTimelockSeconds, secondsLeft])

  // Digital countdown components
  const s = Math.max(0, secondsLeft)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60

  const pad = (n: number) => n.toString().padStart(2, '0')

  const isElapsed = secondsLeft <= 0

  return (
    <View style={[styles.timelockCard, { borderColor: isElapsed ? theme.emeraldBorder : theme.amberBorder }]}>
      {/* Warning Status Banner */}
      <View style={styles.timelockHeader}>
        <View style={styles.timelockPill}>
          <View style={[styles.pulseDot, { backgroundColor: isElapsed ? theme.emeraldText : theme.amberText }]} />
          <Text style={[styles.timelockPillText, { color: isElapsed ? theme.emeraldText : theme.amberText }]}>
            {isElapsed ? 'TIMELOCK ELAPSED · READY TO ROTATE' : 'RECOVERY TIMELOCK ACTIVE'}
          </Text>
        </View>

        <View style={[styles.frozenBadge, { backgroundColor: theme.roseBg, borderColor: theme.roseBorder }]}>
          <Lock1Bold size={12} color={theme.roseText} />
          <Text style={[styles.frozenBadgeText, { color: theme.roseText }]}>WALLET FROZEN</Text>
        </View>
      </View>

      {/* Main Digital Ticker */}
      <View style={styles.tickerContainer}>
        <View style={styles.tickerCell}>
          <Text style={[styles.tickerNumber, { color: theme.textPrimary }]}>{pad(hours)}</Text>
          <Text style={[styles.tickerLabel, { color: theme.textMuted }]}>HOURS</Text>
        </View>
        <Text style={[styles.tickerDivider, { color: theme.textMuted }]}>:</Text>
        <View style={styles.tickerCell}>
          <Text style={[styles.tickerNumber, { color: theme.textPrimary }]}>{pad(minutes)}</Text>
          <Text style={[styles.tickerLabel, { color: theme.textMuted }]}>MINUTES</Text>
        </View>
        <Text style={[styles.tickerDivider, { color: theme.textMuted }]}>:</Text>
        <View style={styles.tickerCell}>
          <Text style={[styles.tickerNumber, { color: theme.textPrimary }]}>{pad(seconds)}</Text>
          <Text style={[styles.tickerLabel, { color: theme.textMuted }]}>SECONDS</Text>
        </View>
      </View>

      {/* Live Animated Progress Bar */}
      <View style={styles.progressSection}>
        <View style={[styles.progressTrack, { backgroundColor: theme.bgInput }]}>
          <View
            style={[
              styles.progressBar,
              {
                width: `${progressPercent}%`,
                backgroundColor: isElapsed ? theme.emeraldText : theme.amberText,
              },
            ]}
          />
        </View>
        <View style={styles.progressLabels}>
          <Text style={[styles.progressLabelText, { color: theme.textMuted }]}>
            {progressPercent}% elapsed
          </Text>
          <Text style={[styles.progressLabelText, { color: theme.textMuted }]}>
            {isElapsed ? 'Window Complete' : `${formatRemainingTime(secondsLeft)} left`}
          </Text>
        </View>
      </View>

      {/* Staged Key Fingerprints (What will be installed if not vetoed) */}
      {stagedRecovery && (
        <View style={[styles.stagedCard, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
          <View style={styles.stagedHeader}>
            <LucideKeyRound size={14} color={theme.accent} />
            <Text style={[styles.stagedTitle, { color: theme.textPrimary }]}>
              Staged Replacement Passkeys
            </Text>
          </View>
          <Text style={[styles.stagedDesc, { color: theme.textSecondary }]}>
            Generated securely for this device. If approved, these keys will replace your lost passkeys.
          </Text>

          <View style={styles.fingerprintRow}>
            <Text style={[styles.fingerprintLabel, { color: theme.textMuted }]}>Primary Key:</Text>
            <Text style={[styles.fingerprintValue, { color: theme.textPrimary }]} numberOfLines={1}>
              {ellipsify(stagedRecovery.primaryPublicKeyHex, 8)}
            </Text>
          </View>
          <View style={styles.fingerprintRow}>
            <Text style={[styles.fingerprintLabel, { color: theme.textMuted }]}>Secondary Key:</Text>
            <Text style={[styles.fingerprintValue, { color: theme.textPrimary }]} numberOfLines={1}>
              {ellipsify(stagedRecovery.secondaryPublicKeyHex, 8)}
            </Text>
          </View>
        </View>
      )}

      {/* Explanatory Safety Warning */}
      <View style={[styles.safetyCallout, { backgroundColor: theme.amberBg, borderColor: theme.amberBorder }]}>
        <MaterialIcons name="security" size={16} color={theme.amberText} />
        <Text style={[styles.safetyCalloutText, { color: theme.amberText }]}>
          If you did not request this recovery, touch &quot;Keep My Keys&quot; immediately to veto with both passkeys and preserve control.
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionColumn}>
        <PrismDepthButton
          title={busyAction === 'cancel' ? 'Vetoing & Keeping Keys…' : 'Keep My Keys (Veto Recovery)'}
          size="default"
          disabled={isBusy}
          onPress={onVeto}
        />

        {isElapsed ? (
          <HoldToConfirmButton
            variant="danger"
            label={busyAction === 'execute' ? 'Executing Rotation…' : 'Hold to Execute Key Rotation'}
            confirmingLabel="Keep holding…"
            completedLabel="Executing Rotation…"
            holdDurationMs={1200}
            onConfirm={onExecute}
          />
        ) : (
          <DepthOutlineButton
            title={`Execute Unlocks in ${formatRemainingTime(secondsLeft)}`}
            size="default"
            disabled
          />
        )}
      </View>
    </View>
  )
}

// ============================================================================
// 2. GUARDIAN SECURITY STATUS CARD
// ============================================================================

export interface HaptixGuardianStatusCardProps {
  guardianAddress: string | null
  isOnChain: boolean
  isGuardianOnThisDevice: boolean
  timelockLabel: string
  onToggleEditor: () => void
  isEditorOpen: boolean
  isBusy: boolean
  clusterUrl?: string
}

export function HaptixGuardianStatusCard({
  guardianAddress,
  isOnChain,
  isGuardianOnThisDevice,
  timelockLabel,
  onToggleEditor,
  isEditorOpen,
  isBusy,
  clusterUrl,
}: HaptixGuardianStatusCardProps) {
  const { theme, isDark } = useAppTheme()
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark])

  const [hasCopied, setHasCopied] = React.useState(false)

  const handleCopy = async () => {
    if (!guardianAddress) return
    await Clipboard.setString(guardianAddress)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setHasCopied(true)
    setTimeout(() => setHasCopied(false), 2000)
  }

  const handleOpenExplorer = () => {
    if (!guardianAddress) return
    Haptics.selectionAsync()
    Linking.openURL(clusterUrl || `https://solscan.io/account/${guardianAddress}?cluster=devnet`)
  }

  return (
    <View style={[styles.guardianCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
      {/* Header with Verified Shield */}
      <View style={styles.cardHeader}>
        <View style={styles.headingWithIcon}>
          <LucideShieldCheck size={18} color={theme.accent} />
          <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Smart Account Guardian</Text>
        </View>

        <View
          style={[
            styles.tag,
            isOnChain
              ? { backgroundColor: theme.emeraldBg, borderColor: theme.emeraldBorder }
              : { backgroundColor: theme.amberBg, borderColor: theme.amberBorder },
          ]}
        >
          <Text style={[styles.tagText, { color: isOnChain ? theme.emeraldText : theme.amberText }]}>
            {isOnChain ? 'Active On-Chain' : 'Not On-Chain Yet'}
          </Text>
        </View>
      </View>

      {/* Address & Chips */}
      <View style={[styles.addressBox, { backgroundColor: theme.bgInput, borderColor: theme.borderDefault }]}>
        <View style={styles.addressTopRow}>
          <Text style={[styles.addressLabel, { color: theme.textMuted }]}>GUARDIAN ADDRESS</Text>
          {isGuardianOnThisDevice && (
            <View style={[styles.deviceChip, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
              <Text style={[styles.deviceChipText, { color: theme.accent }]}>On This Device</Text>
            </View>
          )}
        </View>

        <Text style={[styles.addressText, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="middle">
          {guardianAddress ? ellipsify(guardianAddress, 8) : 'Configured on first activation'}
        </Text>

        {guardianAddress ? (
          <View style={styles.addressActions}>
            <TouchableOpacity
              style={[styles.addressChipBtn, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <MaterialIcons name={hasCopied ? 'check' : 'content-copy'} size={13} color={hasCopied ? theme.emeraldText : theme.textSecondary} />
              <Text style={[styles.addressChipText, { color: hasCopied ? theme.emeraldText : theme.textSecondary }]}>
                {hasCopied ? 'Copied' : 'Copy'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.addressChipBtn, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
              onPress={handleOpenExplorer}
              activeOpacity={0.7}
            >
              <MaterialIcons name="open-in-new" size={13} color={theme.textSecondary} />
              <Text style={[styles.addressChipText, { color: theme.textSecondary }]}>Explorer</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Guardian Permissions Matrix */}
      <View style={styles.permissionsMatrix}>
        <View style={styles.permissionItem}>
          <MaterialIcons name="check-circle" size={15} color={theme.emeraldText} />
          <Text style={[styles.permissionText, { color: theme.textPrimary }]}>
            Can initiate passkey recovery if device is lost
          </Text>
        </View>

        <View style={styles.permissionItem}>
          <MaterialIcons name="schedule" size={15} color={theme.accent} />
          <Text style={[styles.permissionText, { color: theme.textPrimary }]}>
            Bound by {timelockLabel} timelock with owner veto window
          </Text>
        </View>

        <View style={styles.permissionItem}>
          <MaterialIcons name="block" size={15} color={theme.roseText} />
          <Text style={[styles.permissionText, { color: theme.textSecondary }]}>
            Zero spending authority — cannot move funds
          </Text>
        </View>

        <View style={styles.permissionItem}>
          <MaterialIcons name="block" size={15} color={theme.roseText} />
          <Text style={[styles.permissionText, { color: theme.textSecondary }]}>
            Cannot modify spend thresholds or sign transfers
          </Text>
        </View>
      </View>

      {/* Change Guardian Trigger */}
      {isOnChain && (
        <TouchableOpacity
          style={styles.changeGuardianToggle}
          onPress={() => {
            Haptics.selectionAsync()
            onToggleEditor()
          }}
          disabled={isBusy}
          activeOpacity={0.7}
        >
          <Text style={[styles.changeGuardianToggleText, { color: theme.accent }]}>
            {isEditorOpen ? 'Cancel guardian change' : 'Change Guardian Address'}
          </Text>
          <MaterialIcons
            name={isEditorOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={18}
            color={theme.accent}
          />
        </TouchableOpacity>
      )}
    </View>
  )
}

// ============================================================================
// 3. RECOVERY PIPELINE 3-STEP EXPLAINER
// ============================================================================

export function HaptixRecoveryPipelineExplainer({ timelockLabel = '24h' }: { timelockLabel?: string }) {
  const { theme, isDark } = useAppTheme()
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark])

  return (
    <View style={[styles.pipelineCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
      <Text style={[styles.pipelineTitle, { color: theme.textPrimary }]}>
        How Autonomous Recovery Works
      </Text>
      <Text style={[styles.pipelineDesc, { color: theme.textMuted }]}>
        Recover access to your wallet address without seed phrases or central backdoors.
      </Text>

      <View style={styles.stepsContainer}>
        {/* Step 1 */}
        <View style={styles.stepRow}>
          <View style={[styles.stepCircle, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
            <Text style={[styles.stepNumber, { color: theme.accent }]}>1</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={[styles.stepName, { color: theme.textPrimary }]}>Guardian Proposes New Keys</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              If your phone is lost, your trusted guardian initiates recovery on Solana with new passkey seeds.
            </Text>
          </View>
        </View>

        <View style={[styles.stepLine, { backgroundColor: theme.borderDefault }]} />

        {/* Step 2 */}
        <View style={styles.stepRow}>
          <View style={[styles.stepCircle, { backgroundColor: theme.amberBg, borderColor: theme.amberBorder }]}>
            <Text style={[styles.stepNumber, { color: theme.amberText }]}>2</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={[styles.stepName, { color: theme.textPrimary }]}>
              {timelockLabel} Timelock & Owner Veto
            </Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              The wallet freezes instantly. If unauthorized, the owner has {timelockLabel} to veto using both passkeys.
            </Text>
          </View>
        </View>

        <View style={[styles.stepLine, { backgroundColor: theme.borderDefault }]} />

        {/* Step 3 */}
        <View style={styles.stepRow}>
          <View style={[styles.stepCircle, { backgroundColor: theme.emeraldBg, borderColor: theme.emeraldBorder }]}>
            <Text style={[styles.stepNumber, { color: theme.emeraldText }]}>3</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={[styles.stepName, { color: theme.textPrimary }]}>Permissionless Execution</Text>
            <Text style={[styles.stepSub, { color: theme.textSecondary }]}>
              Once the timelock expires without a veto, replacement passkeys become active. Wallet address and tokens stay 100% intact.
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}

// ============================================================================
// STYLES
// ============================================================================

const createStyles = (theme: ThemeTokens, isDark: boolean) =>
  StyleSheet.create({
    // Timelock Card
    timelockCard: {
      borderWidth: 1.5,
      borderRadius: radius.lg,
      padding: 18,
      marginBottom: 16,
      backgroundColor: isDark ? '#14120C' : '#FFFDF5',
      ...Platform.select({
        ios: {
          shadowColor: '#F59E0B',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    timelockHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    timelockPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pulseDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    timelockPillText: {
      fontSize: typeScale.caption,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    frozenBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    frozenBadgeText: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.4,
    },

    // Digital Ticker
    tickerContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 14,
      gap: 10,
    },
    tickerCell: {
      alignItems: 'center',
      minWidth: 70,
      paddingVertical: 10,
      paddingHorizontal: 8,
      backgroundColor: isDark ? '#1E1B15' : '#F9F5EB',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: isDark ? '#2D281E' : '#E8E0CE',
    },
    tickerNumber: {
      fontSize: 28,
      fontWeight: '800',
      letterSpacing: 1,
      fontVariant: ['tabular-nums'],
    },
    tickerLabel: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginTop: 2,
    },
    tickerDivider: {
      fontSize: 24,
      fontWeight: '700',
      alignSelf: 'center',
      marginBottom: 12,
    },

    // Progress Section
    progressSection: {
      marginTop: 8,
      marginBottom: 16,
    },
    progressTrack: {
      height: 7,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      borderRadius: radius.pill,
    },
    progressLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
    },
    progressLabelText: {
      fontSize: typeScale.micro,
      fontWeight: '600',
    },

    // Staged Passkey Details
    stagedCard: {
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 14,
    },
    stagedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    stagedTitle: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    stagedDesc: {
      fontSize: typeScale.micro,
      lineHeight: 14,
      marginBottom: 8,
    },
    fingerprintRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 2,
    },
    fingerprintLabel: {
      fontSize: typeScale.micro,
      fontWeight: '600',
    },
    fingerprintValue: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    },

    // Safety Callout
    safetyCallout: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 10,
      borderRadius: radius.md,
      borderWidth: 1,
      marginBottom: 16,
    },
    safetyCalloutText: {
      flex: 1,
      fontSize: typeScale.micro,
      lineHeight: 14,
      fontWeight: '600',
    },

    // Actions
    actionColumn: {
      gap: 10,
    },

    // Guardian Status Card
    guardianCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    headingWithIcon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    cardHeading: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    tag: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    tagText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    addressBox: {
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 14,
    },
    addressTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    addressLabel: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.6,
    },
    deviceChip: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    deviceChipText: {
      fontSize: typeScale.micro,
      fontWeight: '700',
    },
    addressText: {
      fontSize: typeScale.body,
      fontWeight: '700',
      letterSpacing: 0.2,
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    },
    addressActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
    },
    addressChipBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    addressChipText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    permissionsMatrix: {
      gap: 8,
      paddingVertical: 4,
      marginBottom: 8,
    },
    permissionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    permissionText: {
      flex: 1,
      fontSize: typeScale.caption,
      lineHeight: 16,
    },
    changeGuardianToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: theme.borderSubtle,
      marginTop: 8,
    },
    changeGuardianToggleText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },

    // Pipeline Explainer
    pipelineCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 14,
    },
    pipelineTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
      letterSpacing: -0.2,
      marginBottom: 2,
    },
    pipelineDesc: {
      fontSize: typeScale.caption,
      lineHeight: 16,
      marginBottom: 14,
    },
    stepsContainer: {
      gap: 0,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    stepCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 2,
    },
    stepNumber: {
      fontSize: typeScale.caption,
      fontWeight: '800',
    },
    stepContent: {
      flex: 1,
      paddingBottom: 4,
    },
    stepName: {
      fontSize: typeScale.body,
      fontWeight: '700',
      marginBottom: 2,
    },
    stepSub: {
      fontSize: typeScale.caption,
      lineHeight: 16,
    },
    stepLine: {
      width: 2,
      height: 14,
      marginLeft: 12,
      marginVertical: 2,
    },
  })
