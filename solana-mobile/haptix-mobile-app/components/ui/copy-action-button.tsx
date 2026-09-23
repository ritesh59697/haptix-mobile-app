import React, { useState, useRef } from 'react'
import { Pressable, View, Text, StyleSheet, Animated, Platform, StyleProp, ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { typeScale } from '@/theme/tokens'

export interface CopyActionButtonProps {
  value: string
  label?: string
  copiedLabel?: string
  style?: StyleProp<ViewStyle>
  compact?: boolean
  showLabel?: boolean
}

/**
 * OpenSourceUI CopyButton
 * Copies text to clipboard, cross-fades copy icon to emerald check, and swaps label.
 * https://opensourceui.in/components/copy-button
 */
export function CopyActionButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  style,
  compact = false,
  showLabel = true,
}: CopyActionButtonProps) {
  const { theme, isDark } = useAppTheme()
  const [copied, setCopied] = useState(false)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const iconScaleAnim = useRef(new Animated.Value(1)).current
  const timeoutRef = useRef<any>(null)

  const handleCopy = () => {
    if (copied) return

    Clipboard.setString(value)
    setCopied(true)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})

    // Icon bounce
    Animated.sequence([
      Animated.timing(iconScaleAnim, {
        toValue: 1.25,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(iconScaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start()

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  const handlePressIn = () => {
    Animated.timing(scaleAnim, {
      toValue: 0.95,
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

  const bgColor = copied ? theme.emeraldBg : theme.bgElevated

  const borderColor = copied ? theme.emeraldBorder : theme.borderDefault

  const iconColor = copied ? theme.emerald : theme.textSecondary
  const textColor = copied ? theme.emeraldText : theme.textSecondary

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={handleCopy}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={copied ? copiedLabel : label}
        style={[
          styles.container,
          compact && styles.containerCompact,
          !showLabel && styles.containerIconOnly,
          {
            backgroundColor: bgColor,
            borderColor,
          },
          Platform.OS === 'web'
            ? {
                boxShadow: isDark
                  ? '0 1px 2px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.05)'
                  : '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 1px rgba(255,255,255,0.8)',
              }
            : styles.nativeShadow,
        ]}
      >
        <Animated.View style={{ transform: [{ scale: iconScaleAnim }] }}>
          <MaterialIcons name={copied ? 'check' : 'content-copy'} size={compact ? 14 : 16} color={iconColor} />
        </Animated.View>

        {showLabel && (
          <Text style={[styles.label, compact && styles.labelCompact, { color: textColor }]}>
            {copied ? copiedLabel : label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    overflow: 'hidden',
  },
  containerCompact: {
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 7,
    gap: 4,
  },
  containerIconOnly: {
    paddingHorizontal: 8,
    width: 36,
  },
  label: {
    fontSize: typeScale.body,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  labelCompact: {
    fontSize: typeScale.caption,
  },
  nativeShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 1.5,
    elevation: 1,
  },
})
