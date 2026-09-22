import React, { useRef } from 'react'
import { Pressable, View, Text, StyleSheet, Animated, Platform, StyleProp, ViewStyle, TextStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'

export interface DepthOutlineButtonProps {
  children?: React.ReactNode
  title?: string
  onPress?: () => void
  disabled?: boolean
  icon?: React.ReactNode
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  size?: 'default' | 'large' | 'compact'
  accessibilityLabel?: string
}

/**
 * OpenSourceUI DepthOutlineButton
 * Premium tactile outline button with layered float depth, soft top lip, and press-in sink.
 * https://opensourceui.in/components/depth-outline-button
 */
export function DepthOutlineButton({
  children,
  title,
  onPress,
  disabled = false,
  icon,
  style,
  textStyle,
  size = 'default',
  accessibilityLabel,
}: DepthOutlineButtonProps) {
  const { theme, isDark } = useAppTheme()
  const scaleAnim = useRef(new Animated.Value(1)).current

  const handlePressIn = () => {
    if (disabled) return
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
    if (disabled) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    onPress?.()
  }

  const height = size === 'large' ? 52 : size === 'compact' ? 36 : 46
  const borderRadius = size === 'large' ? 14 : size === 'compact' ? 9 : 12

  const bgColor = isDark ? '#0B1120' : '#FFFFFF'
  const borderColor = isDark ? '#1E293B' : '#E2E8F0'
  const textColor = theme.textPrimary

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || (typeof children === 'string' ? children : title)}
        style={[
          styles.container,
          {
            height,
            borderRadius,
            backgroundColor: bgColor,
            borderColor,
          },
          Platform.OS === 'web'
            ? {
                boxShadow: isDark
                  ? '0 1px 2px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.05)'
                  : '0 1px 3px rgba(0, 0, 0, 0.05), inset 0 1px 1px rgba(255, 255, 255, 0.8)',
              }
            : styles.nativeShadow,
        ]}
      >
        {/* Soft top highlight rim */}
        <View
          style={[
            styles.topLip,
            {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.9)',
            },
          ]}
        />

        <View style={styles.contentRow}>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          {children ? (
            typeof children === 'string' ? (
              <Text style={[styles.title, { color: textColor }, textStyle]}>{children}</Text>
            ) : (
              children
            )
          ) : title ? (
            <Text style={[styles.title, { color: textColor }, textStyle]}>{title}</Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  topLip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
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
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  nativeShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
})
