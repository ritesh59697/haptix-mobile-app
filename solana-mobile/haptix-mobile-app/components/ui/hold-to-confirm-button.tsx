import React, { useState, useRef } from 'react'
import { Pressable, View, Text, StyleSheet, Animated, Platform, StyleProp, ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export interface HoldToConfirmButtonProps {
  label?: string
  confirmingLabel?: string
  completedLabel?: string
  holdDurationMs?: number
  onConfirm: () => void
  style?: StyleProp<ViewStyle>
  variant?: 'danger' | 'warning' | 'primary'
}

/**
 * OpenSourceUI HoldToConfirmButton (Hold to Delete / Destructive Action)
 * Press and hold fill sweep prevents accidental destructive taps.
 * https://opensourceui.in/components/hold-to-delete-button
 */
export function HoldToConfirmButton({
  label = 'Hold to Confirm',
  confirmingLabel = 'Keep holding...',
  completedLabel = 'Confirmed',
  holdDurationMs = 1500,
  onConfirm,
  style,
  variant = 'danger',
}: HoldToConfirmButtonProps) {
  const { theme, isDark } = useAppTheme()
  const [isHolding, setIsHolding] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const progressAnim = useRef(new Animated.Value(0)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)

  const handlePressIn = () => {
    if (isCompleted) return
    setIsHolding(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})

    animationRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: holdDurationMs,
      useNativeDriver: false,
    })

    animationRef.current.start(({ finished }) => {
      if (finished) {
        setIsCompleted(true)
        setIsHolding(false)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        onConfirm()
        setTimeout(() => {
          setIsCompleted(false)
          progressAnim.setValue(0)
        }, 2000)
      }
    })
  }

  const handlePressOut = () => {
    if (isCompleted) return
    if (animationRef.current) {
      animationRef.current.stop()
    }
    setIsHolding(false)
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start()
  }

  const widthInterpolation = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  })

  const isDanger = variant === 'danger'
  const isWarning = variant === 'warning'

  const variantColor = isDanger ? theme.rose : isWarning ? theme.amber : theme.accent
  const fillColor = variantColor
  const borderColor = isDanger || isWarning ? variantColor : theme.borderDefault
  const surfaceColor = isDanger ? theme.roseSurface : isWarning ? theme.amberBg : theme.bgElevated
  // Text colour once the fill has swept under it. A white fill needs dark text,
  // otherwise the label vanishes mid-hold — exactly when it must stay readable.
  const fillForeground = isDanger || isWarning ? theme.onTone : theme.accentForeground

  return (
    <View style={[styles.wrapper, style]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.container,
          {
            backgroundColor: surfaceColor,
            borderColor,
          },
          Platform.OS === 'web'
            ? {
                boxShadow: isDark
                  ? '0 1px 2px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.05)'
                  : '0 1px 2px rgba(0,0,0,0.05), inset 0 1px 1px rgba(255,255,255,0.8)',
              }
            : null,
        ]}
      >
        {/* Animated fill progress */}
        <Animated.View
          style={[
            styles.progressBar,
            {
              width: widthInterpolation,
              backgroundColor: fillColor,
            },
          ]}
        />

        {/* Text and Icon */}
        <View style={styles.content}>
          <MaterialIcons
            name={isCompleted ? 'check-circle' : isDanger || isWarning ? 'warning' : 'lock'}
            size={18}
            color={
              isCompleted || isHolding
                ? fillForeground
                : isDanger
                  ? theme.rose
                  : isWarning
                    ? theme.amber
                    : theme.textPrimary
            }
          />
          <Text
            style={[
              styles.label,
              {
                color: isHolding || isCompleted ? fillForeground : theme.textPrimary,
              },
            ]}
          >
            {isCompleted ? completedLabel : isHolding ? confirmingLabel : label}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  container: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 1,
  },
  label: {
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
})
