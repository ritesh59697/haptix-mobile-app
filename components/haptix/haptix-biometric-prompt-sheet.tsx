import React, { useState, useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale, space, ThemeTokens } from '@/theme/tokens'
import { ellipsify } from '@/utils/ellipsify'
import {
  LucideFingerprint,
  LucideShieldCheck,
  LucideKeyRound,
  LucideCheck,
  LucideSmartphone,
} from '@/components/haptix/haptix-icons'
import { BiometricScanGraphic } from '@/components/haptix/haptix-onboarding-graphics'

export type BiometricActionType = 'transfer' | 'agent_session' | 'policy_update'

export interface HaptixBiometricPromptSheetProps {
  visible: boolean
  onClose: () => void
  actionType: BiometricActionType
  title?: string
  subtitle?: string
  amountSol?: number
  solPriceUsd?: number
  recipientAddress?: string
  recipientLabel?: string | null
  agentAllowanceSol?: number
  agentValidHours?: number
  isQuorumRequired: boolean
  securityMode?: 'phone' | 'vault' | 'everyday'
  asModal?: boolean
  onAuthorize: (onStepChange: (step: 1 | 2) => void) => Promise<void>
}

type AuthPhase = 'idle' | 'verifying_primary' | 'verifying_secondary' | 'broadcasting' | 'confirmed' | 'error'

export function HaptixBiometricPromptSheet({
  visible,
  onClose,
  actionType,
  title,
  subtitle,
  amountSol,
  solPriceUsd = 145,
  recipientAddress,
  recipientLabel,
  agentAllowanceSol,
  agentValidHours,
  isQuorumRequired,
  securityMode = 'phone',
  asModal = true,
  onAuthorize,
}: HaptixBiometricPromptSheetProps) {
  const { theme, isDark } = useAppTheme()
  const styles = createStyles(theme, isDark)

  const [phase, setPhase] = useState<AuthPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<1 | 2>(1)

  // Pulsing animation for biometric scanner aura
  const pulseAnim = useRef(new Animated.Value(1)).current
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (visible) {
      setPhase('idle')
      setErrorMessage(null)
      setCurrentStep(1)

      // Start aura animation
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      )
      pulseLoopRef.current.start()
    } else {
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop()
      }
    }
  }, [visible])

  const handleStartAuth = async () => {
    if (phase !== 'idle' && phase !== 'error') return

    try {
      setErrorMessage(null)
      setPhase('verifying_primary')
      setCurrentStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      await onAuthorize((step: 1 | 2) => {
        if (step === 2) {
          setCurrentStep(2)
          setPhase('verifying_secondary')
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
        }
      })

      setPhase('broadcasting')
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPhase('confirmed')

      // Short delay before closing on confirmation
      setTimeout(() => {
        onClose()
      }, 1400)
    } catch (err: any) {
      console.warn('[HaptixBiometricPromptSheet] Auth error:', err)
      setPhase('error')
      setErrorMessage(err?.message || 'Biometric authorization was cancelled or failed.')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    }
  }

  // Header Title & Badge
  const sheetTitle =
    title ||
    (actionType === 'transfer'
      ? 'Authorize Transfer'
      : actionType === 'agent_session'
      ? 'Authorize Agent Session'
      : 'Authorize Security Action')

  const quorumBadgeLabel = isQuorumRequired
    ? securityMode === 'vault'
      ? '2-of-2 Quorum · Vault Key'
      : '2-of-2 Quorum · Both Passkeys'
    : '1-of-1 Passkey · Fast Path'

  const quorumBadgeColor = isQuorumRequired ? theme.amberText : theme.emeraldText
  const quorumBadgeBg = isQuorumRequired ? theme.amberBg : theme.emeraldBg
  const quorumBadgeBorder = isQuorumRequired ? theme.amberBorder : theme.emeraldBorder

  if (!visible) return null

  const sheetContent = (
    <View style={asModal ? styles.backdrop : styles.overlayBackdrop}>
      <View style={styles.sheetContainer}>
        {/* Drag Handle */}
        <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>
              <Text style={styles.sheetSubtitle}>
                {subtitle || 'Cryptographically signed via NIST P-256 hardware passkey'}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              disabled={phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.closeBtn}
            >
              <MaterialIcons name="close" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Quorum Tier Badge */}
          <View style={[styles.quorumBadge, { backgroundColor: quorumBadgeBg, borderColor: quorumBadgeBorder }]}>
            <MaterialIcons
              name={isQuorumRequired ? 'security' : 'verified-user'}
              size={14}
              color={quorumBadgeColor}
            />
            <Text style={[styles.quorumBadgeText, { color: quorumBadgeColor }]}>{quorumBadgeLabel}</Text>
          </View>

          {/* Transaction Summary Card */}
          <View style={styles.summaryCard}>
            {actionType === 'transfer' && amountSol !== undefined ? (
              <View style={styles.amountBlock}>
                <Text style={styles.amountSolText}>{amountSol.toFixed(4)} SOL</Text>
                <Text style={styles.amountFiatText}>≈ ${(amountSol * solPriceUsd).toFixed(2)} USD</Text>
                {recipientAddress ? (
                  <View style={styles.recipientRow}>
                    <Text style={styles.summaryLabel}>Recipient:</Text>
                    <Text style={styles.recipientValue}>
                      {recipientLabel ? `${recipientLabel} (${ellipsify(recipientAddress, 4)})` : ellipsify(recipientAddress, 6)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : actionType === 'agent_session' ? (
              <View style={styles.amountBlock}>
                <Text style={styles.amountSolText}>{(agentAllowanceSol || 0.25).toFixed(2)} SOL Cap</Text>
                <Text style={styles.amountFiatText}>Valid for {agentValidHours || 24} Hours</Text>
                <View style={styles.recipientRow}>
                  <Text style={styles.summaryLabel}>Target:</Text>
                  <Text style={styles.recipientValue}>Autonomous Ephemeral Agent Key</Text>
                </View>
              </View>
            ) : null}

            {/* Network & Fee Details */}
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Network</Text>
                <Text style={styles.metaValue}>Solana Devnet</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Relayer Fee</Text>
                <Text style={[styles.metaValue, { color: theme.emeraldText }]}>0.00 SOL (Sponsored)</Text>
              </View>
            </View>
          </View>

          {/* Biometric Interactive Scanner Area */}
          <View style={styles.scannerWrapper}>
            <Animated.View
              style={[
                styles.scannerAura,
                {
                  transform: [{ scale: pulseAnim }],
                  borderColor:
                    phase === 'confirmed'
                      ? theme.emerald
                      : phase === 'error'
                      ? theme.rose
                      : isDark
                      ? '#9C93FF'
                      : '#7C65C1',
                  backgroundColor:
                    phase === 'confirmed'
                      ? theme.emeraldBg
                      : phase === 'error'
                      ? theme.roseBg
                      : isDark
                      ? 'rgba(156, 147, 255, 0.08)'
                      : 'rgba(124, 101, 193, 0.06)',
                },
              ]}
            >
              {phase === 'confirmed' ? (
                <View style={styles.iconCircle}>
                  <LucideCheck size={36} color={theme.emerald} strokeWidth={3} />
                </View>
              ) : phase === 'broadcasting' ? (
                <ActivityIndicator size="large" color={isDark ? '#9C93FF' : '#7C65C1'} />
              ) : (
                <BiometricScanGraphic size={76} dark={isDark} />
              )}
            </Animated.View>

            {/* Multi-Step Passkey Tracker for 2-of-2 Quorum */}
            {isQuorumRequired ? (
              <View style={styles.quorumStepRow}>
                {/* Step 1: Primary Passkey */}
                <View
                  style={[
                    styles.quorumStepItem,
                    currentStep === 1 && phase !== 'idle' && phase !== 'confirmed' && styles.quorumStepActive,
                    (currentStep === 2 || phase === 'confirmed') && styles.quorumStepComplete,
                  ]}
                >
                  <View style={styles.quorumStepIcon}>
                    {(currentStep === 2 || phase === 'confirmed') ? (
                      <MaterialIcons name="check" size={13} color={theme.emeraldText} />
                    ) : (
                      <LucideFingerprint
                        size={14}
                        color={currentStep === 1 && phase !== 'idle' ? (isDark ? '#9C93FF' : '#7C65C1') : theme.textMuted}
                      />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.quorumStepText,
                      currentStep === 1 && phase !== 'idle' && { color: isDark ? '#9C93FF' : '#7C65C1', fontWeight: '700' },
                      (currentStep === 2 || phase === 'confirmed') && { color: theme.emeraldText, fontWeight: '700' },
                    ]}
                  >
                    1. Primary Key
                  </Text>
                </View>

                {/* Connector Arrow */}
                <MaterialIcons name="chevron-right" size={16} color={theme.borderDefault} />

                {/* Step 2: Secondary Passkey */}
                <View
                  style={[
                    styles.quorumStepItem,
                    currentStep === 2 && phase === 'verifying_secondary' && styles.quorumStepActive,
                    phase === 'confirmed' && styles.quorumStepComplete,
                  ]}
                >
                  <View style={styles.quorumStepIcon}>
                    {phase === 'confirmed' ? (
                      <MaterialIcons name="check" size={13} color={theme.emeraldText} />
                    ) : (
                      <LucideKeyRound
                        size={14}
                        color={currentStep === 2 ? (isDark ? '#9C93FF' : '#7C65C1') : theme.textMuted}
                      />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.quorumStepText,
                      currentStep === 2 && phase === 'verifying_secondary' && { color: isDark ? '#9C93FF' : '#7C65C1', fontWeight: '700' },
                      phase === 'confirmed' && { color: theme.emeraldText, fontWeight: '700' },
                    ]}
                  >
                    {securityMode === 'vault' ? '2. Vault Key' : '2. Backup Key'}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Dynamic Status Instruction */}
            <Text style={styles.statusInstruction}>
              {phase === 'idle'
                ? 'Tap below to authorize with device biometrics'
                : phase === 'verifying_primary'
                ? 'Touch fingerprint sensor or glance at camera…'
                : phase === 'verifying_secondary'
                ? securityMode === 'vault'
                  ? 'Touch Vault Key or secondary device to complete quorum…'
                  : 'Confirm with secondary backup passkey…'
                : phase === 'broadcasting'
                ? 'Signatures verified. Submitting to Solana Devnet…'
                : phase === 'confirmed'
                ? 'Transaction confirmed on-chain!'
                : 'Authentication cancelled or failed'}
            </Text>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <MaterialIcons name="error-outline" size={15} color={theme.roseText} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionGroup}>
            {phase !== 'confirmed' ? (
              <TouchableOpacity
                style={[
                  styles.primaryAuthBtn,
                  {
                    backgroundColor:
                      phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'
                        ? isDark
                          ? 'rgba(156, 147, 255, 0.25)'
                          : 'rgba(124, 101, 193, 0.25)'
                        : isDark
                        ? '#FFFFFF'
                        : '#000000',
                  },
                ]}
                onPress={handleStartAuth}
                disabled={phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'}
                activeOpacity={0.8}
              >
                {phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting' ? (
                  <ActivityIndicator size="small" color={isDark ? '#9C93FF' : '#7C65C1'} />
                ) : (
                  <LucideFingerprint size={20} color={isDark ? '#000000' : '#FFFFFF'} strokeWidth={2.2} />
                )}
                <Text
                  style={[
                    styles.primaryAuthBtnText,
                    {
                      color:
                        phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'
                          ? isDark
                            ? '#9C93FF'
                            : '#7C65C1'
                          : isDark
                          ? '#000000'
                          : '#FFFFFF',
                    },
                  ]}
                >
                  {phase === 'error'
                    ? 'Retry Biometric Authentication'
                    : isQuorumRequired
                    ? 'Authenticate 2-of-2 Passkeys'
                    : 'Authenticate with Passkey'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelBtnText}>{phase === 'confirmed' ? 'Done' : 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
  )

  if (asModal) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        {sheetContent}
      </Modal>
    )
  }

  return sheetContent
}

const createStyles = (theme: ThemeTokens, isDark: boolean) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      justifyContent: 'flex-end',
    },
    overlayBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.76)',
      justifyContent: 'flex-end',
      zIndex: 9999,
      elevation: 20,
    },
    sheetContainer: {
      backgroundColor: theme.bgCard,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      borderColor: theme.borderDefault,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    },
    dragHandle: {
      width: 40,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: theme.borderDefault,
      alignSelf: 'center',
      marginBottom: 16,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    sheetTitle: {
      fontSize: typeScale.title,
      fontWeight: '700',
      color: theme.textPrimary,
      letterSpacing: -0.2,
    },
    sheetSubtitle: {
      fontSize: typeScale.footnote,
      color: theme.textSecondary,
      marginTop: 2,
    },
    closeBtn: {
      padding: 4,
    },
    quorumBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      marginBottom: 14,
    },
    quorumBadgeText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    summaryCard: {
      backgroundColor: theme.bgElevated,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.borderDefault,
      padding: 14,
      marginBottom: 16,
    },
    amountBlock: {
      alignItems: 'center',
      paddingVertical: 4,
    },
    amountSolText: {
      fontSize: 26,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.5,
    },
    amountFiatText: {
      fontSize: typeScale.footnote,
      color: theme.textSecondary,
      marginTop: 2,
    },
    recipientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
    },
    summaryLabel: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
      fontWeight: '600',
    },
    recipientValue: {
      fontSize: typeScale.caption,
      color: theme.textPrimary,
      fontWeight: '600',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: theme.borderSubtle,
      paddingTop: 10,
      marginTop: 10,
    },
    metaItem: {
      alignItems: 'flex-start',
    },
    metaLabel: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
    },
    metaValue: {
      fontSize: typeScale.footnote,
      color: theme.textSecondary,
      fontWeight: '600',
      marginTop: 2,
    },
    scannerWrapper: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    scannerAura: {
      width: 104,
      height: 104,
      borderRadius: 52,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quorumStepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
    },
    quorumStepItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
    },
    quorumStepActive: {
      borderColor: isDark ? '#9C93FF' : '#7C65C1',
      backgroundColor: isDark ? 'rgba(156, 147, 255, 0.12)' : 'rgba(124, 101, 193, 0.10)',
    },
    quorumStepComplete: {
      borderColor: theme.emeraldBorder,
      backgroundColor: theme.emeraldBg,
    },
    quorumStepIcon: {
      width: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quorumStepText: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
      fontWeight: '600',
    },
    statusInstruction: {
      fontSize: typeScale.footnote,
      color: theme.textSecondary,
      textAlign: 'center',
      minHeight: 20,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: theme.roseBg,
      borderColor: theme.roseBorder,
      borderWidth: 1,
      borderRadius: radius.sm,
    },
    errorText: {
      fontSize: typeScale.caption,
      color: theme.roseText,
      fontWeight: '500',
    },
    actionGroup: {
      marginTop: 14,
      gap: 10,
    },
    primaryAuthBtn: {
      height: 50,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryAuthBtnText: {
      fontSize: typeScale.body,
      fontWeight: '700',
    },
    cancelBtn: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      fontSize: typeScale.footnote,
      color: theme.textMuted,
      fontWeight: '600',
    },
  })
