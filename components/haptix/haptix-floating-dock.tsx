import React, { memo, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform, useWindowDimensions } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { DockHomeIcon, DockAgentIcon, DockActivityIcon, DockSecurityIcon } from './haptix-icons'
import { radius, typeScale } from '@/theme/tokens'

export type DockTabId = 'home' | 'agent' | 'activity' | 'security'

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
  { id: 'home', label: 'Wallet', Icon: DockHomeIcon },
  { id: 'agent', label: 'Agents', Icon: DockAgentIcon },
  { id: 'activity', label: 'Activity', Icon: DockActivityIcon },
  { id: 'security', label: 'Security', Icon: DockSecurityIcon },
]

// ── Dock geometry ───────────────────────────────────────────────────────────
// Hoisted out of the StyleSheet so the fade band's gradient stops can be derived
// from the dock's real height rather than a magic number that drifts when the
// tab height changes. Verified against a device screenshot: the pill renders
// 57.8dp tall, which is this sum.
const DOCK_ITEM_HEIGHT = 48
const DOCK_PADDING = 4
const DOCK_BORDER = 1
const DOCK_HEIGHT = DOCK_ITEM_HEIGHT + DOCK_PADDING * 2 + DOCK_BORDER * 2

// The fade band used to stop dead 36dp above the dock and reach full bgApp
// opacity at its own bottom edge. Anything continuing below that edge — a card,
// a divider, a list row — snapped back to full strength along a dead straight
// horizontal line sitting a few dp above the pill's rounded caps. Since the
// dock's own surface is the same tone as a card, the two then merged into one
// boxy shape and the pill lost its circular silhouette. The band now runs the
// dock's whole height and ramps out below it, so the part of the band wide
// enough to be noticed is the part hidden by the opaque pill, and the band
// never terminates inside visible content.
const DOCK_FADE_ABOVE = 36
const DOCK_FADE_BELOW = 16
const DOCK_FADE_HEIGHT = DOCK_FADE_ABOVE + DOCK_HEIGHT + DOCK_FADE_BELOW
const DOCK_FADE_STOPS: readonly [number, number, ...number[]] = [
  0,
  DOCK_FADE_ABOVE / DOCK_FADE_HEIGHT,
  (DOCK_FADE_ABOVE + DOCK_HEIGHT) / DOCK_FADE_HEIGHT,
  1,
]

/**
 * HaptixFloatingDock
 * Compressed 4-tab floating navigation dock
 * - Synchronous window-width calculation (clean, centered, balanced)
 * - Fluid sliding thumb transition with tactile haptic feedback
 *
 * Memoized because it is on screen for the whole session and takes part in no screen
 * state: without this it was redrawn -- and its width arithmetic re-run -- every time a
 * price arrived, a countdown fired, or a keystroke landed in a modal. It only re-renders
 * for a real tab change, which is what the thumb animation is keyed to anyway.
 */
export const HaptixFloatingDock = memo(function HaptixFloatingDock({
  activeTab,
  onSelectTab,
}: HaptixFloatingDockProps) {
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()
  const { width: windowWidth } = useWindowDimensions()

  // Calculate pixel-perfect compressed dock width (300-320px)
  const dockWidth = Math.min(Math.max(windowWidth * 0.86, 280), 320)
  const availableWidth = dockWidth - DOCK_PADDING * 2
  const tabWidth = availableWidth / DOCK_TABS.length

  // Find index of current active tab
  const activeIndex = Math.max(
    0,
    DOCK_TABS.findIndex((t) => t.id === activeTab),
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
  // Near-opaque: at 0.82 alpha, scrolled list text used to ghost straight through the dock.
  const controlBg = theme.scrim
  const controlBorder = theme.borderDefault
  const thumbBg = theme.accent
  const activeTextColor = theme.accentForeground
  // Was #9CA3AF / #6B7280, a second grey ramp that did not match the segmented control
  // (#8E8E93) or the app's own tokens.
  const inactiveTextColor = theme.textSecondary

  // Elevated bottom offset so it floats comfortably above Android gesture bar / iOS home indicator
  const bottomOffset = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16) + 8

  return (
    <View style={[styles.dockOuterWrapper, { bottom: bottomOffset }]} pointerEvents="box-none">
      {/* Fade band: dissolves scrolled content into the dock instead of bleeding through it */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', theme.bgApp, theme.bgApp, 'transparent']}
        locations={DOCK_FADE_STOPS}
        style={styles.dockFade}
      />
      {/* Outer shadow container (prevents Android/iOS shadow clipping from overflow:hidden) */}
      <View style={[styles.dockShadowContainer, { width: dockWidth }, isDark ? styles.darkShadow : styles.lightShadow]}>
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
                  transform: [{ translateX }, { scale: scaleAnim }],
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
                <tab.Icon size={18} color={itemColor} />
                <Text
                  style={[styles.dockItemText, { color: itemColor }, isActive && styles.dockItemTextActive]}
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
})

const styles = StyleSheet.create({
  dockOuterWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },

  dockFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -DOCK_FADE_ABOVE,
    bottom: -DOCK_FADE_BELOW,
  },

  // The shadow lives on this wrapper, but the wrapper had no corner radius, so
  // both platforms cast it from the view's rectangular bounds: iOS drew a soft
  // black rectangle around the pill (opacity 0.5, radius 20) and Android's
  // elevation outline was a plain rectangle. That is the square shoulder poking
  // out from behind the dock's border. Matching the pill radius makes the
  // shadow follow the capsule instead.
  dockShadowContainer: {
    borderRadius: radius.pill,
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
    padding: DOCK_PADDING,
    borderRadius: radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
  },

  /* cc-ios-tabs__thumb */
  dockThumb: {
    position: 'absolute',
    top: DOCK_PADDING,
    left: DOCK_PADDING,
    height: DOCK_ITEM_HEIGHT,
    borderRadius: radius.pill,
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
    height: DOCK_ITEM_HEIGHT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: 'transparent',
  },

  dockItemText: {
    fontSize: typeScale.micro,
    fontWeight: '500',
    letterSpacing: -0.1,
  },

  dockItemTextActive: {
    fontWeight: '700',
  },
})
