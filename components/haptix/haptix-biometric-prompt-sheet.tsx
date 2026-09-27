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
import * as Haptics from 'expo-haptics'
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
  tokenSymbol?: string
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
  tokenSymbol = 'SOL',
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

  // Subtle breathing animation for the sensor aura
  const pulseAnim = useRef(new Animated.Value(1)).current
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (visible) {
      setPhase('idle')
      setErrorMessage(null)
      setCurrentStep(1)

      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
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
      }, 1000)
    } catch (err: any) {
      console.warn('[HaptixBiometricPromptSheet] Auth error:', err)
      setPhase('error')
      setErrorMessage(err?.message || 'Authorization cancelled')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    }
  }

  if (!visible) return null

  const isAuthenticating =
    phase === 'verifying_primary' || phase === 'verifying_secondary' || phase === 'broadcasting'

  // Clean, focused values
  const heroAmount =
    actionType === 'transfer' && amountSol !== undefined
      ? tokenSymbol === 'SKR'
        ? `${amountSol.toFixed(2)} SKR`
        : `${amountSol.toFixed(4)} SOL`
      : actionType === 'agent_session'
      ? `${(agentAllowanceSol || 0.25).toFixed(2)} SOL`
      : 'Security Action'

  const heroTitle =
    actionType === 'transfer'
      ? recipientAddress
        ? `Transfer to ${recipientLabel || ellipsify(recipientAddress, 4)}`
        : 'Confirm transfer'
      : actionType === 'agent_session'
      ? `AI agent session (${agentValidHours || 24}h)`
      : title || 'Authorize action'

  const sheetContent = (
    <View style={asModal ? styles.backdrop : styles.overlayBackdrop}>
      <View style={styles.sheetContainer}>
        {/* Drag handle */}
        <View style={styles.dragHandle} />

        {/* Center Biometric Sensor Disc with soft aura */}
        <View style={styles.sensorContainer}>
          <Animated.View
            style={[
              styles.sensorAura,
              {
                transform: [{ scale: pulseAnim }],
                borderColor: phase === 'confirmed' ? theme.emerald : theme.accent,
              },
            ]}
          />
          <TouchableOpacity
            style={[
              styles.sensorDisc,
              {
                backgroundColor: theme.bgElevated,
                borderColor: phase === 'confirmed' ? theme.emerald : theme.borderDefault,
              },
            ]}
            onPress={handleStartAuth}
            disabled={isAuthenticating}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Touch sensor to authorize"
          >
            {phase === 'confirmed' ? (
              <MaterialIcons name="check" size={38} color={theme.emerald} />
            ) : phase === 'broadcasting' ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : phase === 'verifying_secondary' && securityMode === 'vault' ? (
              <MaterialIcons name="laptop-mac" size={38} color={theme.accent} />
            ) : (
              <MaterialIcons name="fingerprint" size={42} color={theme.accent} />
            )}
          </TouchableOpacity>
        </View>

        {/* Big Clean Hero Amount & Title */}
        <View style={styles.heroTextContainer}>
          <Text style={[styles.heroAmount, { color: theme.textPrimary }]}>{heroAmount}</Text>
          <Text style={[styles.heroTitle, { color: theme.textSecondary }]}>{heroTitle}</Text>
        </View>

        {/* Single Subtle Subtext */}
        <View style={styles.pillRow}>
          <Text style={[{ color: theme.textMuted, fontSize: 12 }]}>
            {isQuorumRequired ? 'Both passkeys · Solana devnet' : 'Hardware passkey · Solana devnet'}
          </Text>
        </View>

        {/* Dynamic 1-Line Status Helper */}
        <Text style={[styles.statusText, { color: phase === 'error' ? theme.roseText : theme.textMuted }]}>
          {phase === 'verifying_primary'
            ? 'Scanning fingerprint…'
            : phase === 'verifying_secondary'
            ? currentStep === 2 && securityMode === 'vault'
              ? 'Touch Mac Touch ID to approve…'
              : 'Confirm with backup key…'
            : phase === 'broadcasting'
            ? 'Submitting to Solana…'
            : phase === 'confirmed'
            ? 'Confirmed on-chain'
            : phase === 'error'
            ? errorMessage || 'Verification cancelled'
            : 'Touch sensor or tap below'}
        </Text>

        {/* Single Clean Action Button */}
        {phase !== 'confirmed' && (
          <View style={styles.actionRow}>
            <PrismDepthButton
              title={
                isAuthenticating
                  ? 'Verifying…'
                  : phase === 'error'
                  ? 'Try Again'
                  : isQuorumRequired
                  ? 'Authorize (2 Passkeys)'
                  : 'Authorize'
              }
              size="large"
              loading={isAuthenticating}
              disabled={isAuthenticating}
              onPress={handleStartAuth}
            />
          </View>
        )}

        {/* Cancel */}
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onClose}
          disabled={isAuthenticating}
          activeOpacity={0.6}
        >
          <Text style={[styles.cancelText, { color: theme.textMuted }]}>
            {phase === 'confirmed' ? 'Done' : 'Cancel'}
          </Text>
        </TouchableOpacity>
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
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 36 : 24,
      alignItems: 'center',
    },
    dragHandle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: theme.borderDefault,
      marginBottom: 20,
    },
    sensorContainer: {
      width: 90,
      height: 90,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    sensorAura: {
      position: 'absolute',
      width: 86,
      height: 86,
      borderRadius: 43,
      borderWidth: 1.5,
      opacity: 0.6,
    },
    sensorDisc: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      ...Platform.select({
        ios: {
          shadowColor: '#6366F1',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
        },
        android: {
          elevation: 3,
        },
      }),
    },
    heroTextContainer: {
      alignItems: 'center',
      marginBottom: 10,
    },
    heroAmount: {
      fontSize: 34,
      fontWeight: '800',
      letterSpacing: -0.8,
    },
    heroTitle: {
      fontSize: typeScale.body,
      marginTop: 2,
    },
    pillRow: {
      marginBottom: 14,
    },
    subtlePill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    subtlePillText: {
      fontSize: typeScale.micro,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
    statusText: {
      fontSize: typeScale.footnote,
      marginBottom: 18,
      textAlign: 'center',
    },
    actionRow: {
      width: '100%',
      marginBottom: 8,
    },
    cancelBtn: {
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    cancelText: {
      fontSize: typeScale.body,
      fontWeight: '600',
    },
  })
