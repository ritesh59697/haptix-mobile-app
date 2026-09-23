import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export type HaptixSettingsBadgeTone = 'accent' | 'success' | 'danger' | 'muted'

/**
 * Settings section primitives.
 *
 * The wallet screen already had one card geometry, one heading treatment and one row
 * rhythm. Settings was three unrelated template blocks — a 20px "subtitle" heading
 * here, a 16px body line there, three different gaps — so the page read as a stack of
 * separate screens bolted onto the app. These wrap the wallet screen's geometry so a
 * new section is consistent by construction instead of by remembering.
 */

/** One settings section. Matches the wallet screen's `agentSectionCard` exactly. */
export function HaptixSettingsCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme()
  return (
    <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }, style]}>
      {children}
    </View>
  )
}

/** Small status pill. Same box as the wallet screen's "3 Active" count badge. */
export function HaptixSettingsBadge({ label, tone = 'accent' }: { label: string; tone?: HaptixSettingsBadgeTone }) {
  const { theme } = useAppTheme()

  const palette = {
    accent: { backgroundColor: theme.accentLight, color: theme.accent },
    success: { backgroundColor: theme.emeraldBg, color: theme.emeraldText },
    danger: { backgroundColor: theme.roseBg, color: theme.roseText },
    muted: { backgroundColor: theme.accentLight, color: theme.textMuted },
  }[tone]

  return (
    <View style={[styles.badge, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.badgeText, { color: palette.color }]}>{label}</Text>
    </View>
  )
}

/**
 * Section heading, drawn inside the card rather than floating above it. The wallet
 * screen's cards do the same, and it keeps the heading anchored to the content it
 * describes when cards are reordered.
 */
export function HaptixSettingsHeader({
  title,
  badge,
  badgeTone,
  description,
}: {
  title: string
  badge?: string
  badgeTone?: HaptixSettingsBadgeTone
  description?: string
}) {
  const { theme } = useAppTheme()
  return (
    <View style={styles.headerBlock}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>{title}</Text>
        {badge ? <HaptixSettingsBadge label={badge} tone={badgeTone} /> : null}
      </View>
      {description ? <Text style={[styles.headerDescription, { color: theme.textMuted }]}>{description}</Text> : null}
    </View>
  )
}

export interface HaptixSettingsRowProps {
  icon: keyof typeof MaterialIcons.glyphMap
  title: string
  subtitle?: string
  /** Trailing slot: a value pill, chevron, or compact action. */
  trailing?: React.ReactNode
  onPress?: () => void
  /** `danger` swaps the tile and title to the rose ramp for destructive actions. */
  tone?: 'default' | 'danger'
  disabled?: boolean
  accessibilityLabel?: string
  accessibilityHint?: string
}

export function HaptixSettingsRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
  tone = 'default',
  disabled,
  accessibilityLabel,
  accessibilityHint,
}: HaptixSettingsRowProps) {
  const { theme } = useAppTheme()
  const isDanger = tone === 'danger'

  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: isDanger ? theme.roseBg : theme.accentLight }]}>
        <MaterialIcons name={icon} size={18} color={isDanger ? theme.roseText : theme.textSecondary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: isDanger ? theme.roseText : theme.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: theme.textMuted }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  )

  if (!onPress) {
    return <View style={styles.row}>{content}</View>
  }

  return (
    <TouchableOpacity
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      {content}
    </TouchableOpacity>
  )
}

export function HaptixSettingsDivider() {
  const { theme } = useAppTheme()
  return <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
  headerBlock: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: typeScale.title,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headerDescription: {
    fontSize: typeScale.footnote,
    lineHeight: 17,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: typeScale.footnote,
    lineHeight: 16,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
})
