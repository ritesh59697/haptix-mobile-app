import React, { useRef } from 'react'
import { Pressable, View, Text, StyleSheet, Animated, Platform, StyleProp, ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'

export interface ThemeToggleButtonProps {
  style?: StyleProp<ViewStyle>
  showLabel?: boolean
  size?: 'default' | 'compact'
}

/**
 * Tactile Theme Toggle Button
 * Switches smoothly between Dark and Light mode.
 */
export function ThemeToggleButton({ style, showLabel = false, size = 'default' }: ThemeToggleButtonProps) {
  const { theme, isDark, toggleTheme } = useAppTheme()
  const scaleAnim = useRef(new Animated.Value(1)).current
  const rotateAnim = useRef(new Animated.Value(0)).current

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

    Animated.sequence([
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start()

    toggleTheme()
  }

  const handlePressIn = () => {
    Animated.timing(scaleAnim, {
      toValue: 0.92,
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

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  })

  const isCompact = size === 'compact'
  const dimension = isCompact ? 32 : 38

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        style={[
          styles.container,
          {
            height: dimension,
            minWidth: dimension,
            borderRadius: dimension / 2,
            backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
            borderColor: isDark ? '#1E293B' : '#E2E8F0',
          },
          Platform.OS === 'web'
            ? {
                boxShadow: isDark
                  ? '0 1px 2px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05)'
                  : '0 1px 2px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.9)',
              }
            : styles.nativeShadow,
        ]}
      >
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <MaterialIcons
            name={isDark ? 'light-mode' : 'dark-mode'}
            size={isCompact ? 16 : 18}
            color={isDark ? '#F59E0B' : '#0F172A'}
          />
        </Animated.View>

        {showLabel && <Text style={[styles.label, { color: theme.textSecondary }]}>{isDark ? 'Light' : 'Dark'}</Text>}
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
    paddingHorizontal: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  nativeShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1.5,
    elevation: 1,
  },
})
