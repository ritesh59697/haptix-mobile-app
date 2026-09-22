import React, { useState, useRef, useEffect } from 'react'
import { View, Text, StyleSheet, Animated, Platform, Pressable } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export interface HaptixTooltipProps {
  tip: string
  position?: 'top' | 'bottom'
  children?: React.ReactNode
  iconSize?: number
  iconColor?: string
}

/**
 * HaptixTooltip
 * DaisyUI / modern wallet style tooltip with hover (web) and tap-to-inspect (mobile).
 * - Smooth fade & scale spring animation
 * - Built-in triangle pointer arrow
 * - Accessible info icon default when no children supplied
 */
export function HaptixTooltip({ tip, position = 'top', children, iconSize = 18, iconColor }: HaptixTooltipProps) {
  const { isDark, theme } = useAppTheme()
  const [visible, setVisible] = useState(false)
  const anim = useRef(new Animated.Value(0)).current
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    }).start()

    if (visible) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setVisible(false)
      }, 3500)
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [visible])

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setVisible((prev) => !prev)
  }

  const handleHoverIn = () => {
    setVisible(true)
  }

  const handleHoverOut = () => {
    setVisible(false)
  }

  const isTop = position === 'top'
  // Zinc, to match the neutral scale the rest of the theme is built on.
  const bubbleBg = isDark ? '#27272A' : '#18181B'
  const textColor = '#F8FAFC'
  const arrowBorderColor = bubbleBg

  return (
    <View style={styles.anchorWrapper}>
      <Pressable
        onPress={handleToggle}
        onHoverIn={Platform.OS === 'web' ? handleHoverIn : undefined}
        onHoverOut={Platform.OS === 'web' ? handleHoverOut : undefined}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.triggerContainer}
        accessibilityRole="button"
        accessibilityLabel={`Info: ${tip}`}
      >
        {children ? (
          children
        ) : (
          <View style={styles.infoBadge}>
            <MaterialIcons
              name="info-outline"
              size={iconSize}
              color={iconColor || (isDark ? theme.textMuted : '#64748B')}
            />
          </View>
        )}
      </Pressable>

      {visible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tooltipBubbleWrapper,
            isTop ? styles.positionTop : styles.positionBottom,
            {
              opacity: anim,
              transform: [
                {
                  translateY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [isTop ? 6 : -6, 0],
                  }),
                },
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.bubbleContent, { backgroundColor: bubbleBg }]}>
            <Text style={[styles.bubbleText, { color: textColor }]}>{tip}</Text>
          </View>
          <View
            style={[
              styles.triangleArrow,
              isTop ? styles.arrowBottom : styles.arrowTop,
              {
                borderTopColor: isTop ? arrowBorderColor : 'transparent',
                borderBottomColor: !isTop ? arrowBorderColor : 'transparent',
              },
            ]}
          />
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  anchorWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  triggerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBadge: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tooltipBubbleWrapper: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 99999,
    width: 230,
    ...(Platform.OS === 'web' ? { pointerEvents: 'none' as any } : {}),
  },
  positionTop: {
    bottom: '100%',
    marginBottom: 8,
  },
  positionBottom: {
    top: '100%',
    marginTop: 8,
  },
  bubbleContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  bubbleText: {
    fontSize: typeScale.footnote,
    lineHeight: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  triangleArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  arrowBottom: {
    borderTopWidth: 5,
  },
  arrowTop: {
    borderBottomWidth: 5,
  },
})
