import React, { useState, useRef } from 'react'
import {
  Animated,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export interface HaptixCopyableIdentifierProps {
  value: string
  displayText?: string
  numberOfLines?: number
  containerStyle?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  iconSize?: number
  accessibilityLabel?: string
}

export function HaptixCopyableIdentifier({
  value,
  displayText,
  numberOfLines = 1,
  containerStyle,
  textStyle,
  iconSize = 16,
  accessibilityLabel = 'Copy identifier',
}: HaptixCopyableIdentifierProps) {
  const { theme, isDark } = useAppTheme()
  const [copied, setCopied] = useState(false)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const iconScaleAnim = useRef(new Animated.Value(1)).current
  const timeoutRef = useRef<any>(null)

  const handleCopy = () => {
    if (!value) return

    Clipboard.setString(value)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})

    setCopied(true)

    // Tactile bounce animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.97,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start()

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

  const shownText = displayText ?? value

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={handleCopy}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Copied to clipboard' : accessibilityLabel}
        style={[
          styles.container,
          {
            backgroundColor: copied
              ? isDark
                ? 'rgba(52, 211, 153, 0.12)'
                : 'rgba(16, 185, 129, 0.08)'
              : theme.bgInput,
            borderColor: copied ? theme.emeraldBorder : theme.borderDefault,
          },
          containerStyle,
        ]}
      >
        <Text
          style={[
            styles.text,
            { color: copied ? theme.emeraldText : theme.textPrimary },
            textStyle,
          ]}
          numberOfLines={numberOfLines}
          ellipsizeMode="middle"
        >
          {shownText}
        </Text>

        <View style={styles.actionGroup}>
          {copied && (
            <Text style={[styles.copiedLabel, { color: theme.emeraldText }]}>Copied</Text>
          )}
          <Animated.View style={{ transform: [{ scale: iconScaleAnim }] }}>
            <MaterialIcons
              name={copied ? 'check' : 'content-copy'}
              size={iconSize}
              color={copied ? theme.emerald : theme.textMuted}
            />
          </Animated.View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  text: {
    fontSize: typeScale.footnote,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
    marginRight: 8,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  copiedLabel: {
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
})
