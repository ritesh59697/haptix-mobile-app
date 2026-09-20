import React, { useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  useWindowDimensions,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  DockHomeIcon,
  DockMarketsIcon,
  DockSwapIcon,
  DockAgentIcon,
  DockSecurityIcon,
} from './haptix-icons'

export type DockTabId = 'home' | 'markets' | 'swap' | 'agent' | 'security'

interface HaptixFloatingDockProps {
  activeTab: DockTabId
  onSelectTab: (tab: DockTabId) => void
}

interface DockTabDef {
  id: DockTabId
  label: string
  Icon: React.ComponentType<{ size?: number; color?: string }>
}

const DOCK_TABS: DockTabDef[] = [
  { id: 'home', label: 'Home', Icon: DockHomeIcon },
  { id: 'markets', label: 'Markets', Icon: DockMarketsIcon },
  { id: 'swap', label: 'Swap', Icon: DockSwapIcon },
  { id: 'agent', label: 'Agent', Icon: DockAgentIcon },
  { id: 'security', label: 'Shield', Icon: DockSecurityIcon },
]

/**
 * HaptixFloatingDock
 * Styled from Uiverse.io by lawson_5090 (.cc-ios-tabs)
 * - 420ms cubic-bezier(0.22, 1, 0.36, 1) sliding thumb transition
 * - BlurView glassmorphism (backdrop-filter: blur(12px))
 * - Synchronous window-width calculation (zero layout delay / flicker on Android)
 * - Elevated bottom floating offset above gesture bar
 * - Tactile squish & snap scale micro-interaction
 */
export function HaptixFloatingDock({ activeTab, onSelectTab }: HaptixFloatingDockProps) {
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const { width: windowWidth } = useWindowDimensions()

  // Calculate pixel-perfect dock and tab dimensions synchronously
  const dockWidth = Math.min(Math.max(windowWidth * 0.92, 310), 356)
  const PADDING = 4
  const availableWidth = dockWidth - PADDING * 2
  const tabWidth = availableWidth / DOCK_TABS.length

  // Find index of current active tab
  const activeIndex = Math.max(
    0,
    DOCK_TABS.findIndex((t) => t.id === activeTab)
  )

  // Fluid sliding thumb position animated with cubic-bezier(0.22, 1, 0.36, 1) over 420ms
  const thumbAnim = useRef(new Animated.Value(activeIndex)).current
  // Subtle tactile scale bounce during slide
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
          toValue: 0.95,
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

  const handlePress = (tab: DockTabId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onSelectTab(tab)
  }

  // Interpolate translateX for the sliding thumb across the tab positions
  const translateX = thumbAnim.interpolate({
    inputRange: DOCK_TABS.map((_, i) => i),
    outputRange: DOCK_TABS.map((_, i) => i * tabWidth),
  })

  // Theme-aware colors matching .cc-ios-tabs specification
  const controlBg = isDark ? 'rgba(16, 16, 20, 0.82)' : 'rgba(255, 255, 255, 0.78)'
  const controlBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.08)'
  const thumbBg = isDark ? '#FFFFFF' : '#0B1220'
  const activeTextColor = isDark ? '#000000' : '#FFFFFF'
  const inactiveTextColor = isDark ? '#8E8E93' : '#6B7280'

  // Elevated bottom offset so it floats comfortably above Android gesture bar / iOS home indicator
  const bottomOffset = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16) + 8

  return (
    <View
      style={[
        styles.dockOuterWrapper,
        { bottom: bottomOffset },
      ]}
      pointerEvents="box-none"
    >
      {/* Outer shadow container (prevents Android/iOS shadow clipping from overflow:hidden) */}
      <View style={[{ width: dockWidth }, isDark ? styles.darkShadow : styles.lightShadow]}>
        <BlurView
          intensity={isDark ? 36 : 60}
          tint={isDark ? 'dark' : 'light'}
          style={[
            styles.dockControl,
            {
              backgroundColor: controlBg,
              borderColor: controlBorder,
            },
          ]}
        >
          {/* SLIDING THUMB (.cc-ios-tabs__thumb) */}
          {tabWidth > 0 && (
            <Animated.View
              style={[
                styles.dockThumb,
                {
                  width: tabWidth,
                  backgroundColor: thumbBg,
                  transform: [
                    { translateX },
                    { scale: scaleAnim },
                  ],
                },
                isDark ? styles.darkThumbShadow : styles.lightThumbShadow,
              ]}
            />
          )}

          {/* TAB ITEMS (.cc-ios-tabs__item) */}
          {DOCK_TABS.map((tab, idx) => {
            const isActive = idx === activeIndex
            const itemColor = isActive ? activeTextColor : inactiveTextColor

            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.dockItem, { width: tabWidth }]}
                onPress={() => handlePress(tab.id)}
                activeOpacity={0.8}
              >
                <tab.Icon size={15} color={itemColor} />
                <Text
                  style={[
                    styles.dockItemText,
                    { color: itemColor },
                    isActive && styles.dockItemTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </BlurView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dockOuterWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },

  lightShadow: {
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(15, 23, 42, 1)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  darkShadow: {
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
      android: {
        elevation: 12,
      },
    }),
  },

  /* cc-ios-tabs__control */
  dockControl: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },

  /* cc-ios-tabs__thumb */
  dockThumb: {
    position: 'absolute',
    top: 4,
    left: 4,
    height: 38,
    borderRadius: 999,
    zIndex: 0,
  },
  lightThumbShadow: {
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(15, 23, 42, 1)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  darkThumbShadow: {
    ...Platform.select({
      ios: {
        shadowColor: '#FFFFFF',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },

  /* cc-ios-tabs__item */
  dockItem: {
    position: 'relative',
    zIndex: 1,
    height: 38,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: 'transparent',
  },

  dockItemText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.2,
  },

  dockItemTextActive: {
    fontWeight: '700',
  },
})
