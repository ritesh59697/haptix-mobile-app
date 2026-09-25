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
} from 'react-native'
import Svg, { Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import * as LocalAuthentication from 'expo-local-authentication'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'
import { ellipsify } from '@/utils/ellipsify'
import { PrismDepthButton } from '@/components/ui'

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

/**
 * Authentic Precision Fingerprint Sensor Graphic
 * Replaces cartoon FaceID with realistic biometric ridges.
 */
function PrecisionFingerprintSensor({ size = 48, color = '#A5B4FC' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 11c0 1.66-1.34 3-3 3-.74 0-1.42-.27-1.95-.72"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M12 7c-2.76 0-5 2.24-5 5 0 2.21-1.79 4-4 4"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M8.5 2.6c1.07-.38 2.24-.6 3.5-.6 5.52 0 10 4.48 10 10 0 2.87-1.22 5.46-3.17 7.27"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M14.5 15.5c-.88.94-2.12 1.5-3.5 1.5-2.21 0-4-1.79-4-4 0-1.66 1.34-3 3-3s3 1.34 3 3c0 3.31-2.69 6-6 6-1.57 0-3-.6-4.08-1.59"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M17.5 10c0-3.04-2.46-5.5-5.5-5.5-1.95 0-3.68 1.02-4.66 2.56"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M19 14.5c-.68 2.88-2.64 5.17-5.26 6.13"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  )
}

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
  const [biometricName, setBiometricName] = useState<'Fingerprint' | 'Face ID' | 'Biometrics'>('Fingerprint')

  // Smooth breathing animation for biometric sensor aura
  const pulseAnim = useRef(new Animated.Value(1)).current
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null)

  // Detect hardware biometric capabilities
  useEffect(() => {
    async function detectBiometrics() {
      try {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
        if (
          Platform.OS === 'ios' &&
          types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) &&
          !types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ) {
          setBiometricName('Face ID')
        } else {
          setBiometricName('Fingerprint')
        }
      } catch {
        setBiometricName('Fingerprint')
      }
    }
    void detectBiometrics()
  }, [])

  useEffect(() => {
    if (visible) {
      setPhase('idle')
      setErrorMessage(null)
      setCurrentStep(1)

      // Start breathing aura animation
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.14,
            duration: 1100,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1100,
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

      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err: any) {
      console.warn('[HaptixBiometricPromptSheet] Auth error:', err)
      setPhase('error')
      setErrorMessage(err?.message || 'Biometric authorization was cancelled or failed.')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    }
  }

  if (!visible) return null

  const isAuthenticating =
    phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'

  // Hero Display Values
  const heroAmount =
    actionType === 'transfer' && amountSol !== undefined
      ? `${amountSol.toFixed(4)} SOL`
      : actionType === 'agent_session'
      ? `${(agentAllowanceSol || 0.25).toFixed(2)} SOL Cap`
      : 'Security Policy'

  const heroSubtitle =
    actionType === 'transfer' && amountSol !== undefined
      ? `≈ $${(amountSol * solPriceUsd).toFixed(2)} USD · Instant Transfer`
      : actionType === 'agent_session'
      ? `Autonomous AI Agent Delegation · ${agentValidHours || 24}h Validity`
      : subtitle || 'Cryptographically signed via hardware passkey'

  const sheetContent = (
    <View style={asModal ? styles.backdrop : styles.overlayBackdrop}>
      <View style={styles.sheetContainer}>
        {/* Drag Handle */}
        <View style={styles.dragHandle} />

        {/* Top Header Row with Subtle Badge and Close */}
        <View style={styles.headerRow}>
          <View style={styles.badgeWrapper}>
            <View
              style={[
                styles.quorumBadge,
                {
                  backgroundColor: isQuorumRequired ? theme.amberBg : theme.accentLight,
                  borderColor: isQuorumRequired ? theme.amberBorder : theme.accent,
                },
              ]}
            >
              <MaterialIcons
                name={isQuorumRequired ? 'security' : 'fingerprint'}
                size={13}
                color={isQuorumRequired ? theme.amberText : theme.accent}
              />
              <Text
                style={[
                  styles.quorumBadgeText,
                  { color: isQuorumRequired ? theme.amberText : theme.accent },
                ]}
              >
                {isQuorumRequired
                  ? securityMode === 'vault'
                    ? '2-of-2 Quorum · Vault Key'
                    : '2-of-2 Hardware Quorum'
                  : '1-of-1 Fast-Path Passkey'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={onClose}
            disabled={isAuthenticating}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close authorization sheet"
          >
            <MaterialIcons name="close" size={20} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Hero Amount & Purpose */}
        <View style={styles.heroSection}>
          <Text style={styles.heroAmountText}>{heroAmount}</Text>
          <Text style={styles.heroSubtitleText}>{heroSubtitle}</Text>
        </View>

        {/* Sleek Horizontal Context Strip */}
        <View style={[styles.contextStrip, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
          <View style={styles.contextItem}>
            <Text style={styles.contextLabel}>Network</Text>
            <Text style={[styles.contextValue, { color: theme.textPrimary }]}>Solana Devnet</Text>
          </View>

          <View style={[styles.contextDivider, { backgroundColor: theme.borderDefault }]} />

          <View style={styles.contextItem}>
            <Text style={styles.contextLabel}>Network Fee</Text>
            <Text style={[styles.contextValue, { color: theme.emeraldText }]}>0.00 SOL (Relayer Sponsored)</Text>
          </View>

          {recipientAddress ? (
            <>
              <View style={[styles.contextDivider, { backgroundColor: theme.borderDefault }]} />
              <View style={styles.contextItem}>
                <Text style={styles.contextLabel}>Recipient</Text>
                <Text style={[styles.contextValue, { color: theme.textPrimary }]} numberOfLines={1}>
                  {recipientLabel || ellipsify(recipientAddress, 4)}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        {/* Centerpiece: Interactive Biometric Sensor Touch Target */}
        <View style={styles.sensorSection}>
          <TouchableOpacity
            style={styles.sensorTouchTarget}
            onPress={handleStartAuth}
            disabled={isAuthenticating}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Authenticate with ${biometricName}`}
          >
            {/* Soft Ambient Breathing Ring */}
            <Animated.View
              style={[
                styles.sensorAuraRing,
                {
                  transform: [{ scale: pulseAnim }],
                  borderColor:
                    phase === 'confirmed'
                      ? theme.emerald
                      : phase === 'error'
                      ? theme.rose
                      : isDark
                      ? '#818CF8'
                      : '#6366F1',
                },
              ]}
            />

            {/* Tactile Hardware Inset Sensor Disc */}
            <View
              style={[
                styles.sensorDisc,
                {
                  backgroundColor: isDark ? '#12121A' : '#F4F5FB',
                  borderColor:
                    phase === 'confirmed'
                      ? theme.emerald
                      : phase === 'error'
                      ? theme.rose
                      : isDark
                      ? 'rgba(255, 255, 255, 0.12)'
                      : 'rgba(0, 0, 0, 0.08)',
                },
              ]}
            >
              {phase === 'confirmed' ? (
                <MaterialIcons name="check" size={38} color={theme.emerald} />
              ) : phase === 'broadcasting' ? (
                <ActivityIndicator size="large" color={theme.accent} />
              ) : (
                <PrecisionFingerprintSensor
                  size={46}
                  color={
                    currentStep === 2
                      ? theme.amberText
                      : isDark
                      ? '#A5B4FC'
                      : '#4F46E5'
                  }
                />
              )}
            </View>
          </TouchableOpacity>

          {/* Minimal 2-Passkey Stepper */}
          {isQuorumRequired ? (
            <View style={styles.stepProgressRow}>
              <View style={styles.stepPill}>
                <View
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor:
                        phase === 'confirmed' || currentStep === 2 ? theme.emerald : theme.accent,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.stepPillText,
                    {
                      color:
                        phase === 'confirmed' || currentStep === 2
                          ? theme.emeraldText
                          : theme.textPrimary,
                    },
                  ]}
                >
                  1. {biometricName}
                </Text>
              </View>

              <View
                style={[
                  styles.stepLine,
                  {
                    backgroundColor:
                      currentStep === 2 || phase === 'confirmed'
                        ? theme.emerald
                        : theme.borderDefault,
                  },
                ]}
              />

              <View style={styles.stepPill}>
                <View
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor:
                        phase === 'confirmed'
                          ? theme.emerald
                          : currentStep === 2
                          ? theme.amberText
                          : theme.borderDefault,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.stepPillText,
                    {
                      color:
                        phase === 'confirmed'
                          ? theme.emeraldText
                          : currentStep === 2
                          ? theme.amberText
                          : theme.textMuted,
                    },
                  ]}
                >
                  2. {securityMode === 'vault' ? 'Vault Key' : 'Backup Key'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Context Helper Status */}
          <Text style={[styles.sensorHintText, { color: theme.textSecondary }]}>
            {phase === 'idle'
              ? `Touch sensor or tap below to sign with ${biometricName}`
              : phase === 'verifying_primary'
              ? `Verifying ${biometricName}…`
              : phase === 'verifying_secondary'
              ? securityMode === 'vault'
                ? 'Touch Vault Key or YubiKey to complete quorum…'
                : 'Confirm with secondary backup key…'
              : phase === 'broadcasting'
              ? 'Broadcasting cryptographic proof to Solana…'
              : phase === 'confirmed'
              ? 'Cryptographic passkey signature verified on-chain!'
              : 'Authentication cancelled or failed'}
          </Text>

          {errorMessage ? (
            <View style={[styles.errorBox, { backgroundColor: theme.roseBg, borderColor: theme.roseBorder }]}>
              <MaterialIcons name="error-outline" size={14} color={theme.roseText} />
              <Text style={[styles.errorBoxText, { color: theme.roseText }]}>{errorMessage}</Text>
            </View>
          ) : null}
        </View>

        {/* Action Button Section */}
        <View style={styles.actionSection}>
          {phase !== 'confirmed' ? (
            <PrismDepthButton
              title={
                isAuthenticating
                  ? 'Verifying Signature…'
                  : phase === 'error'
                  ? `Retry ${biometricName}`
                  : isQuorumRequired
                  ? currentStep === 2
                    ? 'Approve with Backup Key'
                    : `Authorize with ${biometricName}`
                  : `Authorize with ${biometricName}`
              }
              size="large"
              loading={isAuthenticating}
              disabled={isAuthenticating}
              onPress={handleStartAuth}
            />
          ) : null}

          <TouchableOpacity
            style={styles.cancelLink}
            onPress={onClose}
            disabled={isAuthenticating}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelLinkText, { color: theme.textMuted }]}>
              {phase === 'confirmed' ? 'Done' : 'Cancel'}
            </Text>
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
      paddingHorizontal: 22,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    },
    dragHandle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: theme.borderDefault,
      alignSelf: 'center',
      marginBottom: 14,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    badgeWrapper: {
      flex: 1,
    },
    quorumBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    quorumBadgeText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    closeBtn: {
      padding: 4,
    },

    // Hero Section
    heroSection: {
      alignItems: 'center',
      paddingVertical: 6,
      marginBottom: 14,
    },
    heroAmountText: {
      fontSize: 32,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.6,
    },
    heroSubtitleText: {
      fontSize: typeScale.body,
      color: theme.textSecondary,
      marginTop: 3,
      textAlign: 'center',
    },

    // Context Strip (clean, single layer)
    contextStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      borderRadius: radius.md,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 20,
    },
    contextItem: {
      alignItems: 'center',
      flex: 1,
    },
    contextLabel: {
      fontSize: typeScale.micro,
      color: theme.textMuted,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    contextValue: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    contextDivider: {
      width: 1,
      height: 22,
    },

    // Sensor Section
    sensorSection: {
      alignItems: 'center',
      paddingVertical: 8,
      marginBottom: 16,
    },
    sensorTouchTarget: {
      width: 104,
      height: 104,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    sensorAuraRing: {
      position: 'absolute',
      width: 100,
      height: 100,
      borderRadius: 50,
      borderWidth: 1.5,
      opacity: 0.7,
    },
    sensorDisc: {
      width: 82,
      height: 82,
      borderRadius: 41,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      ...Platform.select({
        ios: {
          shadowColor: '#6366F1',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
        },
        android: {
          elevation: 3,
        },
      }),
    },

    // Step Progress Row
    stepProgressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
      gap: 8,
    },
    stepPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    stepDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    stepPillText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    stepLine: {
      width: 20,
      height: 1.5,
    },

    // Hint & Error
    sensorHintText: {
      fontSize: typeScale.footnote,
      textAlign: 'center',
      lineHeight: 18,
      paddingHorizontal: 12,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.sm,
      borderWidth: 1,
    },
    errorBoxText: {
      fontSize: typeScale.micro,
      fontWeight: '600',
    },

    // Action Section
    actionSection: {
      gap: 8,
      marginTop: 4,
    },
    cancelLink: {
      alignItems: 'center',
      paddingVertical: 10,
    },
    cancelLinkText: {
      fontSize: typeScale.body,
      fontWeight: '600',
    },
  })
