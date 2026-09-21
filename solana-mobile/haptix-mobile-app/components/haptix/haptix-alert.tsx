import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'

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
export function HaptixAlert({
  status = 'info',
  title,
  message,
  icon,
  action,
  style,
}: HaptixAlertProps) {
  const { isDark } = useAppTheme()

  const config = {
    info: {
      bg: isDark ? 'rgba(59, 130, 246, 0.12)' : '#EFF6FF',
      border: isDark ? 'rgba(59, 130, 246, 0.28)' : '#BFDBFE',
      iconColor: '#3B82F6',
      titleColor: isDark ? '#93C5FD' : '#1E40AF',
      textColor: isDark ? '#BFDBFE' : '#1E3A8A',
      defaultIcon: 'info-outline' as const,
    },
    success: {
      bg: isDark ? 'rgba(16, 185, 129, 0.12)' : '#ECFDF5',
      border: isDark ? 'rgba(16, 185, 129, 0.28)' : '#A7F3D0',
      iconColor: '#10B981',
      titleColor: isDark ? '#6EE7B7' : '#065F46',
      textColor: isDark ? '#A7F3D0' : '#064E3B',
      defaultIcon: 'check-circle-outline' as const,
    },
    warning: {
      bg: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FFFBEB',
      border: isDark ? 'rgba(245, 158, 11, 0.28)' : '#FDE68A',
      iconColor: '#F59E0B',
      titleColor: isDark ? '#FCD34D' : '#92400E',
      textColor: isDark ? '#FDE68A' : '#78350F',
      defaultIcon: 'warning-amber' as const,
    },
    error: {
      bg: isDark ? 'rgba(244, 63, 94, 0.12)' : '#FFF1F2',
      border: isDark ? 'rgba(244, 63, 94, 0.28)' : '#FECDD3',
      iconColor: '#F43F5E',
      titleColor: isDark ? '#FDA4AF' : '#9F1239',
      textColor: isDark ? '#FECDD3' : '#881337',
      defaultIcon: 'error-outline' as const,
    },
    neutral: {
      bg: isDark ? 'rgba(255, 255, 255, 0.06)' : '#F4F4F5',
      border: isDark ? 'rgba(255, 255, 255, 0.12)' : '#E4E4E7',
      iconColor: isDark ? '#A1A1AA' : '#71717A',
      titleColor: isDark ? '#FFFFFF' : '#18181B',
      textColor: isDark ? '#D4D4D8' : '#3F3F46',
      defaultIcon: 'shield' as const,
    },
  }[status]

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
        {title ? (
          <Text style={[styles.alertTitle, { color: config.titleColor }]}>
            {title}
          </Text>
        ) : null}
        <Text style={[styles.alertMessage, { color: config.textColor }]}>
          {message}
        </Text>
      </View>

      {action ? (
        <TouchableOpacity
          style={[
            styles.actionButton,
            action.variant === 'ghost'
              ? { backgroundColor: 'transparent' }
              : { backgroundColor: config.iconColor },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            action.onPress()
          }}
          disabled={action.loading}
          activeOpacity={0.75}
        >
          {action.loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.actionButtonText,
                { color: action.variant === 'ghost' ? config.titleColor : '#FFFFFF' },
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
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
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
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  alertMessage: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
})
