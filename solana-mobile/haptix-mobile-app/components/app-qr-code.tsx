import React, { useState, useRef, useEffect } from 'react'
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native'
import QRCode from 'react-qr-code'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixBrandMark } from '@/components/haptix/haptix-icons'
import { radius, typeScale } from '@/theme/tokens'

export interface AppQrCodeProps {
  value: string
  size?: number
  showCorners?: boolean
  showTapHint?: boolean
  onCopySuccess?: () => void
  style?: StyleProp<ViewStyle>
}

export function AppQrCode({
  value,
  size = 176,
  showCorners = true,
  showTapHint = true,
  onCopySuccess,
  style,
}: AppQrCodeProps) {
  const { theme, isDark } = useAppTheme()
  const [copied, setCopied] = useState(false)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const hudOpacityAnim = useRef(new Animated.Value(0)).current
  const hudScaleAnim = useRef(new Animated.Value(0.85)).current
  const timerRef = useRef<any>(null)

  const handleCopy = () => {
    if (!value) return
    Clipboard.setString(value)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onCopySuccess?.()

    // Gentle tactile press animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.96,
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

    // Trigger floating HUD
    setCopied(true)
    hudOpacityAnim.setValue(0)
    hudScaleAnim.setValue(0.85)
    Animated.parallel([
      Animated.timing(hudOpacityAnim, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(hudScaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 50,
        useNativeDriver: true,
      }),
    ]).start()

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      Animated.timing(hudOpacityAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setCopied(false)
      })
    }, 1800)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const padding = 14
  const cardSize = size + padding * 2
  const bracketSize = 20
  const bracketThickness = 2.5
  const accentColor = theme.accent

  return (
    <View style={[styles.outerWrapper, style]}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          onPress={handleCopy}
          accessibilityRole="button"
          accessibilityLabel="QR code. Tap to copy address to clipboard."
          style={[
            styles.cardContainer,
            {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
            },
          ]}
        >
          {/* Target Scan Corner Brackets */}
          {showCorners && (
            <>
              <View
                style={[
                  styles.cornerBracket,
                  {
                    top: 5,
                    left: 5,
                    width: bracketSize,
                    height: bracketSize,
                    borderTopWidth: bracketThickness,
                    borderLeftWidth: bracketThickness,
                    borderTopLeftRadius: 6,
                    borderColor: accentColor,
                  },
                ]}
              />
              <View
                style={[
                  styles.cornerBracket,
                  {
                    top: 5,
                    right: 5,
                    width: bracketSize,
                    height: bracketSize,
                    borderTopWidth: bracketThickness,
                    borderRightWidth: bracketThickness,
                    borderTopRightRadius: 6,
                    borderColor: accentColor,
                  },
                ]}
              />
              <View
                style={[
                  styles.cornerBracket,
                  {
                    bottom: 5,
                    left: 5,
                    width: bracketSize,
                    height: bracketSize,
                    borderBottomWidth: bracketThickness,
                    borderLeftWidth: bracketThickness,
                    borderBottomLeftRadius: 6,
                    borderColor: accentColor,
                  },
                ]}
              />
              <View
                style={[
                  styles.cornerBracket,
                  {
                    bottom: 5,
                    right: 5,
                    width: bracketSize,
                    height: bracketSize,
                    borderBottomWidth: bracketThickness,
                    borderRightWidth: bracketThickness,
                    borderBottomRightRadius: 6,
                    borderColor: accentColor,
                  },
                ]}
              />
            </>
          )}

          {/* White Squircle Tile holding high-contrast QR */}
          <View
            style={[
              styles.qrTile,
              {
                width: cardSize,
                height: cardSize,
                padding,
              },
            ]}
          >
            <QRCode value={value || 'HaptixAddress'} size={size} level="Q" />

            {/* Central Brand Badge */}
            <View style={styles.centerBadge}>
              <HaptixBrandMark size={16} color="#FFFFFF" />
            </View>

            {/* Floating Copied HUD Overlay */}
            {copied && (
              <Animated.View
                style={[
                  styles.copiedOverlay,
                  {
                    opacity: hudOpacityAnim,
                    transform: [{ scale: hudScaleAnim }],
                  },
                ]}
              >
                <View style={styles.copiedHudBadge}>
                  <MaterialIcons name="check-circle" size={17} color="#10B981" />
                  <Text style={styles.copiedHudText}>Copied!</Text>
                </View>
              </Animated.View>
            )}
          </View>
        </Pressable>
      </Animated.View>

      {/* Tap-to-copy hint */}
      {showTapHint && (
        <View style={styles.hintRow}>
          <MaterialIcons name="touch-app" size={13} color={theme.textMuted} />
          <Text style={[styles.hintText, { color: theme.textMuted }]}>
            Tap QR code to copy address
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  outerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContainer: {
    padding: 10,
    borderRadius: radius.xl,
    borderWidth: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerBracket: {
    position: 'absolute',
  },
  qrTile: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  centerBadge: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0A0A0F',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copiedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 15, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
  },
  copiedHudBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E1E26',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  copiedHudText: {
    color: '#F4F4F7',
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  hintText: {
    fontSize: typeScale.caption,
    fontWeight: '500',
  },
})
