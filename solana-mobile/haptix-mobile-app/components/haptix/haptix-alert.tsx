import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, StyleProp, ViewStyle } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, space, typeScale } from '@/theme/tokens'

export type AlertStatus = 'info' | 'success' | 'warning' | 'error' | 'neutral'

export interface HaptixAlertProps {
  status?: AlertStatus
  title?: string
  message: string
  icon?: keyof typeof MaterialIcons.glyphMap
  action?: {
    label: string
    onPress: () => void
    loading?: boolean
    variant?: 'primary' | 'ghost'
  }
  style?: StyleProp<ViewStyle>
}

/**
 * HaptixAlert
 * DaisyUI Alert Component adapted for React Native / Expo.
 * Reference: https://daisyui.com/components/alert/
 *
 * Supports status variants: 'info' | 'success' | 'warning' | 'error' | 'neutral'
 * Responsive flex layout with standard icon, title, description, and action button.
 */
export function HaptixAlert({ status = 'info', title, message, icon, action, style }: HaptixAlertProps) {
  const { theme } = useAppTheme()

  // Each status resolves to one tone from theme/tokens.ts instead of the local
  // five-shade palette this file used to carry: the tints, hairlines and title
  // colours were picked independently per variant (0.12 and 0.28 here, 0.10 and
  // 0.30 elsewhere), so an alert never matched the badge reporting the same
  // state. Body copy is the shared secondary text colour for every tone, which
  // is what removes the fifth hand-picked shade per variant.
  const config = useMemo(() => {
    switch (status) {
      case 'success':
        return {
          bg: theme.emeraldBg,
          border: theme.emeraldBorder,
          iconColor: theme.emerald,
          titleColor: theme.emeraldText,
          defaultIcon: 'check-circle-outline' as const,
        }
      case 'warning':
        return {
          bg: theme.amberBg,
          border: theme.amberBorder,
          iconColor: theme.amber,
          titleColor: theme.amberText,
          defaultIcon: 'warning-amber' as const,
        }
      case 'error':
        return {
          bg: theme.roseBg,
          border: theme.roseBorder,
          iconColor: theme.rose,
          titleColor: theme.roseText,
          defaultIcon: 'error-outline' as const,
        }
      case 'neutral':
        return {
          bg: theme.accentLight,
          border: theme.borderDefault,
          iconColor: theme.textMuted,
          titleColor: theme.textPrimary,
          defaultIcon: 'shield' as const,
        }
      default:
        return {
          bg: theme.infoBg,
          border: theme.infoBorder,
          iconColor: theme.info,
          titleColor: theme.infoText,
          defaultIcon: 'info-outline' as const,
        }
    }
  }, [status, theme])

  const iconName = icon || config.defaultIcon

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.alertContainer,
        {
          backgroundColor: config.bg,
          borderColor: config.border,
        },
        style,
      ]}
    >
      <View style={styles.iconWrap}>
        <MaterialIcons name={iconName} size={20} color={config.iconColor} />
      </View>

      <View style={styles.contentWrap}>
        {title ? <Text style={[styles.alertTitle, { color: config.titleColor }]}>{title}</Text> : null}
        <Text style={[styles.alertMessage, { color: theme.textSecondary }]}>{message}</Text>
      </View>

      {action ? (
        <TouchableOpacity
          style={[
            styles.actionButton,
            action.variant === 'ghost' ? { backgroundColor: 'transparent' } : { backgroundColor: config.iconColor },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            action.onPress()
          }}
          disabled={action.loading}
          activeOpacity={0.75}
        >
          {action.loading ? (
            <ActivityIndicator size="small" color={theme.accentForeground} />
          ) : (
            <Text
              style={[
                styles.actionButtonText,
                { color: action.variant === 'ghost' ? config.titleColor : theme.accentForeground },
              ]}
            >
              {action.label}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  alertContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.md,
    marginBottom: 14,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  contentWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  alertTitle: {
    fontSize: typeScale.body,
    fontWeight: '700',
    letterSpacing: -0.1,
    marginBottom: space.xxs,
  },
  alertMessage: {
    fontSize: typeScale.footnote,
    lineHeight: 16,
    fontWeight: '500',
  },
  actionButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: typeScale.footnote,
    fontWeight: '700',
  },
})
