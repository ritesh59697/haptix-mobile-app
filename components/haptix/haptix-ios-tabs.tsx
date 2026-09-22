import React, { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform, LayoutChangeEvent } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export interface IosTabItem<T extends string = string> {
  id: T
  label: string
  badge?: string | number
}

interface HaptixIosTabsProps<T extends string = string> {
  tabs: IosTabItem<T>[]
  activeTab: T
  onChange: (tab: T) => void
  containerStyle?: object
}

/**
 * HaptixIosTabs
 * Implements the exact iOS segmented tabs from Uiverse.io by lawson_5090:
 * - .cc-ios-tabs__control with pill capsule geometry and subtle inset border
 * - .cc-ios-tabs__thumb animated with cubic-bezier(0.22, 1, 0.36, 1) over 420ms
 * - Drop shadow: 0 1px 2px rgba(15,23,42,0.2), 0 8px 20px rgba(15,23,42,0.16)
 * - Tactile micro-scale bounce on tab change
 */
export function HaptixIosTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  containerStyle,
}: HaptixIosTabsProps<T>) {
  const { theme, isDark } = useAppTheme()
  const [controlWidth, setControlWidth] = useState(0)

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTab),
  )

  const thumbAnim = useRef(new Animated.Value(activeIndex)).current
  const scaleAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(thumbAnim, {
        toValue: activeIndex,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.96,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 320,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
      ]),
    ]).start()
  }, [activeIndex])

  const handlePress = (id: T) => {
    Haptics.selectionAsync()
    onChange(id)
  }

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    if (w > 0 && Math.abs(w - controlWidth) > 1) {
      setControlWidth(w)
    }
  }

  const PADDING = 4
  const availableWidth = Math.max(0, controlWidth - PADDING * 2)
  const tabWidth = tabs.length > 0 ? availableWidth / tabs.length : 0

  const translateX = thumbAnim.interpolate({
    inputRange: tabs.map((_, i) => i),
    outputRange: tabs.map((_, i) => i * tabWidth),
  })

  // Shared surface tokens instead of the hand-rolled iOS grey ramp. The old light track
  // was rgba(255,255,255,0.72), which was invisible on the white app background.
  const controlBg = theme.bgElevated
  const controlBorder = theme.borderSubtle
  const thumbBg = theme.accent
  const activeColor = theme.accentForeground
  const inactiveColor = theme.textSecondary

  return (
    <View
      style={[
        styles.control,
        {
          backgroundColor: controlBg,
          borderColor: controlBorder,
        },
        containerStyle,
      ]}
      onLayout={handleLayout}
    >
      {/* Sliding Thumb (.cc-ios-tabs__thumb) */}
      {tabWidth > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: tabWidth,
              backgroundColor: thumbBg,
              transform: [{ translateX }, { scale: scaleAnim }],
            },
            isDark ? styles.darkThumbShadow : styles.lightThumbShadow,
          ]}
        />
      )}

      {/* Tab Items (.cc-ios-tabs__item) */}
      {tabs.map((tab, idx) => {
        const isActive = idx === activeIndex
        const color = isActive ? activeColor : inactiveColor

        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.item, { width: tabWidth > 0 ? tabWidth : undefined }]}
            onPress={() => handlePress(tab.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.itemText, { color }, isActive && styles.itemTextActive]} numberOfLines={1}>
              {tab.label}
            </Text>
            {tab.badge !== undefined && (
              <View style={[styles.badge, { backgroundColor: isActive ? theme.accentForeground : theme.borderSubtle }]}>
                <Text style={[styles.badgeText, { color: isActive ? theme.accent : theme.textSecondary }]}>
                  {tab.badge}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  control: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: 4,
    left: 4,
    height: 36,
    borderRadius: radius.pill,
    zIndex: 0,
  },
  lightThumbShadow: {
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(15, 23, 42, 1)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.16,
        shadowRadius: 10,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  darkThumbShadow: {
    ...Platform.select({
      ios: {
        shadowColor: '#FFFFFF',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  item: {
    position: 'relative',
    zIndex: 1,
    height: 36,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'transparent',
  },
  itemText: {
    fontSize: typeScale.body,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  itemTextActive: {
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: typeScale.micro,
    fontWeight: '700',
  },
})
