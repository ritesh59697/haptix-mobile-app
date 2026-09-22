import React, { useState, useRef } from 'react'
import { Pressable, View, Text, StyleSheet, Animated, Platform, StyleProp, ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'

export interface BookmarkSaveButtonProps {
  label?: string
  savedLabel?: string
  defaultSaved?: boolean
  saved?: boolean
  onToggle?: (saved: boolean) => void
  style?: StyleProp<ViewStyle>
  compact?: boolean
}

/**
 * OpenSourceUI BookmarkSaveButton
 * Tactile raised 3D key with soft top lip highlight, press sink, and amber bookmark transition.
 * https://opensourceui.in/components/bookmark-save-button
 */
export function BookmarkSaveButton({
  label = 'Save',
  savedLabel = 'Saved',
  defaultSaved = false,
  saved: controlledSaved,
  onToggle,
  style,
  compact = false,
}: BookmarkSaveButtonProps) {
  const { theme, isDark } = useAppTheme()
  const [internalSaved, setInternalSaved] = useState(defaultSaved)
  const isControlled = controlledSaved !== undefined
  const isSaved = isControlled ? controlledSaved : internalSaved

  const scaleAnim = useRef(new Animated.Value(1)).current
  const iconScaleAnim = useRef(new Animated.Value(isSaved ? 1.12 : 1)).current

  const handlePress = () => {
    const next = !isSaved
    if (!isControlled) {
      setInternalSaved(next)
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

    // Icon pop animation
    Animated.sequence([
      Animated.timing(iconScaleAnim, {
        toValue: 1.25,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.spring(iconScaleAnim, {
        toValue: next ? 1.12 : 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start()

    onToggle?.(next)
  }

  const handlePressIn = () => {
    Animated.timing(scaleAnim, {
      toValue: 0.96,
      duration: 80,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start()
  }

  const bgColor = isSaved ? theme.amberBg : isDark ? '#0F172A' : '#F8FAFC'

  const borderColor = isSaved ? (isDark ? 'rgba(245, 158, 11, 0.35)' : '#FDE68A') : isDark ? '#1E293B' : '#E2E8F0'

  const textColor = isSaved ? theme.amberText : theme.textSecondary
  const iconColor = isSaved ? theme.amber : theme.textMuted

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityState={{ selected: isSaved }}
        accessibilityLabel={isSaved ? savedLabel : label}
        style={[
          styles.container,
          compact && styles.containerCompact,
          {
            backgroundColor: bgColor,
            borderColor,
          },
          Platform.OS === 'web' && isDark
            ? {
                boxShadow: isSaved
                  ? '0 1px 2px rgba(245, 158, 11, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.08)'
                  : '0 1px 2px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.05)',
              }
            : Platform.OS === 'web'
              ? {
                  boxShadow: isSaved
                    ? '0 1px 2px rgba(217, 119, 6, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.6)'
                    : '0 1px 2px rgba(0, 0, 0, 0.05), inset 0 1px 1px rgba(255, 255, 255, 0.8)',
                }
              : styles.nativeShadow,
        ]}
      >
        {/* Soft top highlight lip for tactile 3D look */}
        <View
          style={[
            styles.topLip,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.65)' },
          ]}
        />

        <Animated.View style={{ transform: [{ scale: iconScaleAnim }] }}>
          <MaterialIcons name={isSaved ? 'bookmark' : 'bookmark-border'} size={compact ? 16 : 18} color={iconColor} />
        </Animated.View>

        <Text style={[styles.label, compact && styles.labelCompact, { color: textColor }]}>
          {isSaved ? savedLabel : label}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  containerCompact: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 8,
    gap: 5,
  },
  topLip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelCompact: {
    fontSize: 12,
  },
  nativeShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
})
