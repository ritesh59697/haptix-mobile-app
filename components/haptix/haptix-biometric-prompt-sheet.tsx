import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'
import { ellipsify } from '@/utils/ellipsify'
import { PrismDepthButton } from '@/components/ui'

const FINGERPRINT_HERO_WHITE = require('@/assets/images/fingerprint-hero-white.png')
const FINGERPRINT_HERO_DARK = require('@/assets/images/fingerprint-hero.png')

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

  // Fluid pull-down gesture to dismiss bottom sheet
  const panY = useRef(new Animated.Value(0)).current

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 4,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            panY.setValue(gestureState.dy)
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.8) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
            Animated.timing(panY, {
              toValue: 600,
              duration: 220,
              useNativeDriver: true,
            }).start(() => {
              panY.setValue(0)
              onClose()
            })
          } else {
            Animated.spring(panY, {
              toValue: 0,
              bounciness: 4,
              useNativeDriver: true,
            }).start()
          }
        },
      }),
    [onClose, panY],
  )

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
      panY.setValue(0)
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop()
      }
    }
  }, [visible, panY])

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
      <Animated.View
        style={[
          styles.sheetContainer,
          { transform: [{ translateY: panY }] },
        ]}
      >
        {/* Functional Drag handle */}
        <View style={styles.dragHandleTouchZone} {...panResponder.panHandlers}>
          <View style={[styles.dragHandle, { backgroundColor: isDark ? '#3a3a37' : '#D1D1D6' }]} />
        </View>

        {/* Center Biometric Sensor Disc with soft aura */}
        <View style={styles.sensorContainer}>
          <Animated.View
            style={[
              styles.sensorAura,
              {
                transform: [{ scale: pulseAnim }],
                borderColor:
                  phase === 'confirmed'
                    ? theme.emerald
                    : isDark
                    ? 'rgba(255, 255, 255, 0.16)'
                    : 'rgba(0, 0, 0, 0.08)',
              },
            ]}
          />
          <TouchableOpacity
            style={[
              styles.sensorDisc,
              phase === 'confirmed' && {
                borderColor: theme.emerald,
                backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#E6F9F0',
              },
              phase === 'error' && {
                borderColor: theme.rose,
                backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#FEF2F2',
              },
            ]}
            onPress={handleStartAuth}
            disabled={isAuthenticating}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Touch sensor to authorize"
          >
            {phase === 'confirmed' ? (
              <MaterialIcons name="check" size={44} color={theme.emerald} />
            ) : phase === 'broadcasting' ? (
              <ActivityIndicator size="small" color={isDark ? '#FFFFFF' : '#000000'} />
            ) : phase === 'verifying_secondary' && securityMode === 'vault' ? (
              <MaterialIcons name="laptop-mac" size={40} color={theme.textPrimary} />
            ) : (
              <Image
                source={isDark ? FINGERPRINT_HERO_WHITE : FINGERPRINT_HERO_DARK}
                style={styles.sensorImage}
                resizeMode="contain"
              />
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
      </Animated.View>
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
    dragHandleTouchZone: {
      width: '100%',
      paddingTop: 0,
      paddingBottom: 14,
      alignItems: 'center',
      justifyContent: 'center',
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
    },
    sensorContainer: {
      width: 104,
      height: 104,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      marginBottom: 16,
    },
    sensorAura: {
      position: 'absolute',
      width: 118,
      height: 118,
      borderRadius: 59,
      borderWidth: 1.5,
      opacity: 0.6,
    },
    sensorDisc: {
      width: 104,
      height: 104,
      borderRadius: 52,
      borderWidth: 1,
      backgroundColor: isDark ? '#141418' : '#F4F5F7',
      borderColor: isDark ? '#26262C' : '#E2E4E9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sensorImage: {
      width: 76,
      height: 76,
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
