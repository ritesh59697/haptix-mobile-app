import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'

export type SpinLoaderSize = 'sm' | 'md' | 'lg'

export interface SpinLoaderProps {
  size?: SpinLoaderSize | number
  color?: string
  strokeWidth?: number
  duration?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}

const SIZE_MAP: Record<SpinLoaderSize, number> = {
  sm: 18,
  md: 24,
  lg: 32,
}

/**
 * Lucide Loader SVG Paths (8 radial spokes with round caps)
 * Faithful port of https://opensourceui.in/components/spin-loader
 */
function LucideLoaderSvg({
  size,
  color,
  strokeWidth = 2,
}: {
  size: number
  color: string
  strokeWidth?: number
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2v4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m16.2 7.8 2.9-2.9"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18 12h4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m16.2 16.2 2.9 2.9"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 18v4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m4.9 19.1 2.9-2.9"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2 12h4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m4.9 4.9 2.9 2.9"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/**
 * SpinLoader
 *
 * Minimal spinning loader from Opensource UI.
 * 60/120fps hardware-accelerated linear 360-degree rotation.
 */
export function SpinLoader({
  size = 'md',
  color = '#9C93FF',
  strokeWidth = 2,
  duration = 1000,
  style,
  accessibilityLabel = 'Loading',
}: SpinLoaderProps) {
  const spinAnim = useRef(new Animated.Value(0)).current

  const dimension = typeof size === 'number' ? size : SIZE_MAP[size] ?? 24

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [duration, spinAnim])

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  return (
    <View
      style={[styles.container, { width: dimension, height: dimension }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View
        style={{
          width: dimension,
          height: dimension,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: spin }],
        }}
      >
        <LucideLoaderSvg size={dimension} color={color} strokeWidth={strokeWidth} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
