import React, { useRef } from 'react'
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Platform,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'

export interface PrismDepthButtonProps {
  children?: React.ReactNode
  title?: string
  onPress?: () => void
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  variant?: 'primary' | 'danger' | 'success'
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  size?: 'default' | 'large' | 'compact'
  accessibilityLabel?: string
}

/**
 * OpenSourceUI PrismDepthButton
 * Dark depth button with cyan edge flare, top rim highlight, and tactile press-sink.
 * https://opensourceui.in/components/prism-depth-button
 */
export function PrismDepthButton({
  children,
  title,
  onPress,
  disabled = false,
  loading = false,
  icon,
  variant = 'primary',
  style,
  textStyle,
  size = 'default',
  accessibilityLabel,
}: PrismDepthButtonProps) {
  const { theme, isDark } = useAppTheme()
  const scaleAnim = useRef(new Animated.Value(1)).current

  const handlePressIn = () => {
    if (disabled || loading) return
    Animated.timing(scaleAnim, {
      toValue: 0.97,
      duration: 70,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start()
  }

  const handlePress = () => {
    if (disabled || loading) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    onPress?.()
  }

  // Base heights
  const height = size === 'large' ? 52 : size === 'compact' ? 38 : 46
  const borderRadius = size === 'large' ? 14 : size === 'compact' ? 9 : 12

  // Color tokens depending on variant and theme
  let mainBg = theme.accent
  let textColor = theme.accentForeground
  let glowColor = theme.accentGlow

  if (variant === 'danger') {
    mainBg = theme.rose
    textColor = '#FFFFFF'
    glowColor = theme.roseBg
  } else if (variant === 'success') {
    mainBg = theme.emerald
    textColor = '#FFFFFF'
    glowColor = theme.emeraldBg
  }

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || (typeof children === 'string' ? children : title)}
        style={[
          styles.container,
          {
            height,
            borderRadius,
            backgroundColor: disabled ? (isDark ? '#1F1F1F' : '#E2E8F0') : mainBg,
            borderColor: disabled
              ? (isDark ? '#262626' : '#CBD5E1')
              : isDark
                ? 'rgba(255, 255, 255, 0.22)'
                : 'rgba(0, 0, 0, 0.15)',
          },
          Platform.OS === 'web'
            ? {
                boxShadow: disabled
                  ? 'none'
                  : isDark
                    ? `0 2px 6px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.3)`
                    : `0 1px 3px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.4)`,
              }
            : styles.nativeShadow,
        ]}
      >
        {/* Soft top rim highlight (tactile depth bevel) */}
        {!disabled && (
          <View
            style={[
              styles.topLip,
              {
                backgroundColor: 'rgba(255, 255, 255, 0.35)',
              },
            ]}
          />
        )}

        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          <View style={styles.contentRow}>
            {icon && <View style={styles.iconContainer}>{icon}</View>}
            {children ? (
              typeof children === 'string' ? (
                <Text style={[styles.title, { color: textColor }, textStyle]}>
                  {children}
                </Text>
              ) : (
                children
              )
            ) : title ? (
              <Text style={[styles.title, { color: textColor }, textStyle]}>
                {title}
              </Text>
            ) : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  topLip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  nativeShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
})
