import React from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'

export type ThemeOptionMode = 'system' | 'light' | 'dark'

interface HaptixThemeModalProps {
  visible: boolean
  onClose: () => void
  selectedTheme: ThemeOptionMode
  onSelectTheme: (theme: ThemeOptionMode) => void
}

interface ThemeOptionItem {
  id: ThemeOptionMode
  name: string
  description: string
  icon: keyof typeof MaterialIcons.glyphMap
}

const THEME_OPTIONS: ThemeOptionItem[] = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Pitch black & sleek dark surfaces',
    icon: 'dark-mode',
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light surfaces and high contrast',
    icon: 'light-mode',
  },
  {
    id: 'system',
    name: 'System',
    description: 'Automatically match phone appearance',
    icon: 'brightness-medium',
  },
]

export function HaptixThemeModal({
  visible,
  onClose,
  selectedTheme,
  onSelectTheme,
}: HaptixThemeModalProps) {
  const { theme, isDark } = useAppTheme()

  const handleSelect = (mode: ThemeOptionMode) => {
    Haptics.selectionAsync().catch(() => {})
    onSelectTheme(mode)
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#141416' : '#FFFFFF',
              borderColor: isDark ? '#2A2A28' : '#E6E4DE',
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text
              style={[
                styles.title,
                { color: isDark ? '#F2F1EE' : '#181714' },
              ]}
            >
              Color theme
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: isDark ? '#8A8985' : '#6B6A64' },
              ]}
            >
              Choose how Haptix looks on your device
            </Text>
          </View>

          {/* Options List */}
          <View style={styles.list}>
            {THEME_OPTIONS.map((opt) => {
              const isSelected = opt.id === selectedTheme

              return (
                <TouchableOpacity
                  key={opt.id}
                  activeOpacity={0.7}
                  onPress={() => handleSelect(opt.id)}
                  style={[
                    styles.optionItem,
                    {
                      backgroundColor: isSelected
                        ? isDark
                          ? 'rgba(108, 140, 255, 0.08)'
                          : 'rgba(0, 82, 255, 0.05)'
                        : isDark
                        ? '#1A1A1D'
                        : '#FAFAFA',
                      borderColor: isSelected
                        ? isDark
                          ? '#6C8CFF'
                          : theme.accent
                        : isDark
                        ? '#2A2A28'
                        : '#E6E4DE',
                      borderWidth: isSelected ? 1.5 : 0.5,
                    },
                  ]}
                >
                  {/* Left Icon */}
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: isSelected
                          ? isDark
                            ? 'rgba(108, 140, 255, 0.15)'
                            : 'rgba(0, 82, 255, 0.10)'
                          : isDark
                          ? '#222226'
                          : '#EEECE8',
                      },
                    ]}
                  >
                    <MaterialIcons
                      name={opt.icon}
                      size={18}
                      color={
                        isSelected
                          ? isDark
                            ? '#6C8CFF'
                            : theme.accent
                          : isDark
                          ? '#8A8985'
                          : '#6B6A64'
                      }
                    />
                  </View>

                  {/* Option Details */}
                  <View style={styles.optionInfo}>
                    <Text
                      style={[
                        styles.optionName,
                        { color: isDark ? '#F2F1EE' : '#181714' },
                      ]}
                    >
                      {opt.name}
                    </Text>
                    <Text
                      style={[
                        styles.optionDesc,
                        { color: isDark ? '#8A8985' : '#6B6A64' },
                      ]}
                    >
                      {opt.description}
                    </Text>
                  </View>

                  {/* Radio Indicator */}
                  <View
                    style={[
                      styles.radioCircle,
                      {
                        borderColor: isSelected
                          ? isDark
                            ? '#6C8CFF'
                            : theme.accent
                          : isDark
                          ? '#3A3A37'
                          : '#D8D5CE',
                      },
                    ]}
                  >
                    {isSelected && (
                      <View
                        style={[
                          styles.radioDot,
                          {
                            backgroundColor: isDark ? '#6C8CFF' : theme.accent,
                          },
                        ]}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Done Button */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onClose}
            style={[
              styles.doneButton,
              {
                backgroundColor: isDark ? '#6C8CFF' : theme.accent,
              },
            ]}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 22,
    borderWidth: 0.5,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.6,
    shadowRadius: 36,
    elevation: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
  },
  list: {
    marginBottom: 8,
  },
  optionItem: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  optionInfo: {
    flex: 1,
  },
  optionName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  optionDesc: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  doneButton: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0C0C0D',
  },
})
