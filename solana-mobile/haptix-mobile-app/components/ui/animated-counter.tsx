import React, { useEffect, useRef, memo } from 'react'
import { View, Text, StyleSheet, Animated, Easing, TextStyle, StyleProp } from 'react-native'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

interface AnimatedDigitProps {
  digit: number
  lineHeight: number
  textStyle?: StyleProp<TextStyle>
  duration?: number
}

const AnimatedDigit = memo(function AnimatedDigit({
  digit,
  lineHeight,
  textStyle,
  duration = 380,
}: AnimatedDigitProps) {
  const anim = useRef(new Animated.Value(digit)).current

  useEffect(() => {
    Animated.timing(anim, {
      toValue: digit,
      duration,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start()
  }, [digit, duration])

  const translateY = anim.interpolate({
    inputRange: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    outputRange: DIGITS.map((d) => -d * lineHeight),
  })

  return (
    <View style={[styles.digitWindow, { height: lineHeight }]}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        {DIGITS.map((d) => (
          <Text key={d} style={[styles.digitText, { height: lineHeight, lineHeight }, textStyle]}>
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  )
})

export interface AnimatedCounterProps {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  duration?: number
  textStyle?: StyleProp<TextStyle>
  containerStyle?: object
}

/**
 * AnimatedCounter
 * Inspired by swamimalode07/rare-ui/animated-counter
 * A number that smoothly counts to its new value on a wheel of digits, like an odometer.
 */
export function AnimatedCounter({
  value,
  decimals = 2,
  prefix = '',
  suffix = '',
  duration = 420,
  textStyle,
  containerStyle,
}: AnimatedCounterProps) {
  // Extract line height from textStyle or fallback to 28
  const flatStyle = StyleSheet.flatten(textStyle) || {}
  const fontSize = flatStyle.fontSize || 20
  const lineHeight = flatStyle.lineHeight || Math.round(fontSize * 1.25)

  // Format value to string
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  const chars = formatted.split('')

  return (
    <View style={[styles.container, containerStyle]}>
      {prefix ? <Text style={[styles.digitText, { height: lineHeight, lineHeight }, textStyle]}>{prefix}</Text> : null}

      <View style={styles.numberRow}>
        {chars.map((char, index) => {
          const isNum = char >= '0' && char <= '9'
          if (!isNum) {
            return (
              <Text key={`char-${index}`} style={[styles.digitText, { height: lineHeight, lineHeight }, textStyle]}>
                {char}
              </Text>
            )
          }

          return (
            <AnimatedDigit
              key={`digit-${chars.length - index}`}
              digit={parseInt(char, 10)}
              lineHeight={lineHeight}
              textStyle={textStyle}
              duration={duration}
            />
          )
        })}
      </View>

      {suffix ? <Text style={[styles.digitText, { height: lineHeight, lineHeight }, textStyle]}>{suffix}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  digitWindow: {
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  digitText: {
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
})

export default AnimatedCounter
