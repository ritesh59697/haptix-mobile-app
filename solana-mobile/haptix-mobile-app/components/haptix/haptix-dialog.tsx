import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export type HaptixDialogStatus = 'neutral' | 'success' | 'warning' | 'error'
export type HaptixDialogButtonStyle = 'default' | 'cancel' | 'destructive' | 'secondary' | 'plain'

export interface HaptixDialogButton {
  text: string
  subtext?: string
  onPress?: () => void
  /** `default` renders as the accent action, `cancel` as a quiet text action. */
  style?: HaptixDialogButtonStyle
  flex?: number
}

export interface HaptixDialogOptions {
  cancelable?: boolean
  onDismiss?: () => void
  /** Draws a status icon above the title. */
  status?: HaptixDialogStatus
  /** Explicit icon override above the title. */
  icon?: keyof typeof MaterialIcons.glyphMap
  /** Runs the given node between the message and the actions for whatever a string cannot carry. */
  content?: React.ReactNode
  /** Force rendering buttons side-by-side in a row. */
  forceRow?: boolean
}

interface DialogRequest {
  title: string
  message?: string
  content?: React.ReactNode
  buttons: HaptixDialogButton[]
  cancelable: boolean
  onDismiss?: () => void
  status: HaptixDialogStatus
  icon?: keyof typeof MaterialIcons.glyphMap
  forceRow?: boolean
}

interface HaptixDialogContextValue {
  /** Drop-in replacement for `Alert.alert` that honours the active theme. */
  alert: (title: string, message?: string, buttons?: HaptixDialogButton[], options?: HaptixDialogOptions) => void
  dismiss: () => void
}

const HaptixDialogContext = createContext<HaptixDialogContextValue>({
  alert: () => {},
  dismiss: () => {},
})

export function useHaptixDialog() {
  return useContext(HaptixDialogContext)
}

const STATUS_ICON: Record<HaptixDialogStatus, keyof typeof MaterialIcons.glyphMap | null> = {
  neutral: null,
  success: 'check-circle-outline',
  warning: 'warning-amber',
  error: 'error-outline',
}

/**
 * HaptixDialogProvider
 *
 * React Native's `Alert.alert` is drawn by the platform rather than by React, so it
 * can never match the app: the surface, type, corner radius and button colours all
 * come from Android's Material dialog. This provider renders those same flows as an
 * in-app modal built from the app's own tokens.
 *
 * Requests queue instead of replacing one another, so an alert raised while another
 * is on screen still reaches the user.
 */
export function HaptixDialogProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme()
  const [queue, setQueue] = useState<DialogRequest[]>([])
  const active = queue[0] ?? null

  // `onDismiss` has to fire for whichever request was on screen when the dismissal
  // happened, which is not necessarily the one a callback closed over.
  const activeRef = useRef<DialogRequest | null>(null)
  activeRef.current = active

  const alert = useCallback(
    (title: string, message?: string, buttons?: HaptixDialogButton[], options?: HaptixDialogOptions) => {
      setQueue((prev) => [
        ...prev,
        {
          title,
          message,
          content: options?.content,
          buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
          cancelable: options?.cancelable ?? true,
          onDismiss: options?.onDismiss,
          status: options?.status ?? 'neutral',
          icon: options?.icon,
          forceRow: options?.forceRow,
        },
      ])
    },
    [],
  )

  const pop = useCallback(() => setQueue((prev) => prev.slice(1)), [])
  const dismiss = useCallback(() => pop(), [pop])

  const handleButton = useCallback(
    (button: HaptixDialogButton) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      pop()
      button.onPress?.()
    },
    [pop],
  )

  const handleBackdropDismiss = useCallback(() => {
    const request = activeRef.current
    if (!request) return

    // Android's back button maps to the cancel action when one exists, and only
    // falls through to a plain dismissal when the dialog allows it.
    const cancelButton = request.buttons.find((button) => button.style === 'cancel' || button.style === 'plain')
    if (cancelButton) {
      pop()
      cancelButton.onPress?.()
      return
    }
    if (!request.cancelable) return
    pop()
    request.onDismiss?.()
  }, [pop])

  const shouldStackButtons =
    (active?.buttons.length ?? 0) > 2 ||
    Boolean(active?.buttons.some((b) => b.text.length > 12))

  const isButtonRow =
    active?.buttons.length === 2 &&
    (active.forceRow || (!shouldStackButtons && !active.buttons.some((b) => b.subtext)))

  // In vertical stack: place affirmative/action buttons first, and 'cancel' at the very bottom
  const displayButtons = useMemo(() => {
    if (!active) return []
    if (isButtonRow) return active.buttons
    const nonCancel = active.buttons.filter((b) => b.style !== 'cancel' && b.style !== 'plain')
    const cancel = active.buttons.filter((b) => b.style === 'cancel' || b.style === 'plain')
    return [...nonCancel, ...cancel]
  }, [active, isButtonRow])

  const colors = useMemo(
    () => ({
      card: {
        backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
        borderColor: theme.isDark ? '#2A2A28' : theme.borderDefault,
      },
      title: { color: theme.isDark ? '#F2F1EE' : theme.textPrimary },
      message: { color: theme.isDark ? '#D4D4D8' : theme.textSecondary },
      bulletBox: {
        backgroundColor: theme.isDark ? '#141418' : '#F5F5F7',
        borderColor: theme.isDark ? '#26262F' : '#E5E5EA',
      },
      accentButton: {
        backgroundColor: '#6C8CFF',
        borderColor: '#6C8CFF',
      },
      accentButtonText: { color: '#FFFFFF' },
      cancelButton: {
        backgroundColor: theme.isDark ? '#1C1C21' : '#EFEFF0',
        borderColor: theme.isDark ? '#2C2C35' : 'transparent',
      },
      cancelButtonText: { color: theme.isDark ? '#F4F4F5' : theme.textPrimary },
      secondaryButton: {
        backgroundColor: theme.isDark ? 'transparent' : '#FFFFFF',
        borderColor: theme.isDark ? '#2A2A28' : '#E6E4DE',
        borderWidth: 1,
      },
      secondaryButtonText: { color: theme.isDark ? '#F2F1EE' : theme.textPrimary, fontWeight: '500' },
      destructiveButton: {
        backgroundColor: '#E11D48',
        borderColor: '#E11D48',
      },
      destructiveButtonText: { color: '#FFFFFF' },
      plainButton: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        height: 38,
      },
      plainButtonText: {
        color: theme.isDark ? '#8A8985' : theme.textMuted,
        fontWeight: '500',
        fontSize: 14,
      },
    }),
    [theme],
  )

  const statusBadgeBg =
    active?.status === 'success'
      ? (theme.isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.12)')
      : active?.status === 'warning'
        ? (theme.isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.12)')
        : active?.status === 'error'
          ? (theme.isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.12)')
          : (theme.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)')

  const statusBadgeBorder =
    active?.status === 'success'
      ? 'rgba(16, 185, 129, 0.3)'
      : active?.status === 'warning'
        ? 'rgba(245, 158, 11, 0.3)'
        : active?.status === 'error'
          ? 'rgba(239, 68, 68, 0.3)'
          : 'rgba(255, 255, 255, 0.12)'

  const statusColor =
    active?.status === 'success'
      ? theme.emerald
      : active?.status === 'warning'
        ? theme.amber
        : active?.status === 'error'
          ? theme.rose
          : theme.textMuted

  const statusIcon = active
    ? (active.icon ?? (active.status === 'warning' ? 'warning' : STATUS_ICON[active.status]))
    : null

  // A fresh object here re-rendered every consumer in the tree on any provider render,
  // and made `dialog` useless as a `useCallback` dependency for callers -- their
  // handlers were rebuilt whenever a queued dialog moved, which in turn re-rendered the
  // memoized wallet rows those handlers were passed to.
  const contextValue = useMemo(() => ({ alert, dismiss }), [alert, dismiss])

  return (
    <HaptixDialogContext.Provider value={contextValue}>
      {children}
      <Modal
        visible={active !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleBackdropDismiss}
      >
        <View style={layout.root}>
          {/* Sibling rather than parent of the card, so taps on the card never
              race the dismissal handler. */}
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
            onPress={handleBackdropDismiss}
            accessibilityLabel="Dismiss dialog"
          />

          {active && (
            <View style={[layout.card, colors.card]} accessibilityViewIsModal accessibilityLiveRegion="polite">
              {statusIcon && (
                <View style={[layout.statusBadge, { backgroundColor: statusBadgeBg, borderColor: statusBadgeBorder }]}>
                  <MaterialIcons name={statusIcon} size={26} color={statusColor} />
                </View>
              )}

              <Text style={[layout.title, colors.title]}>{active.title}</Text>

              {!!active.message && (
                <ScrollView style={layout.messageScroll} bounces={false} showsVerticalScrollIndicator={false}>
                  {active.message.includes('•') ? (
                    <View style={{ gap: 10 }}>
                      {active.message.split('\n\n').map((block, bIdx) => {
                        if (block.includes('•')) {
                          return (
                            <View
                              key={bIdx}
                              style={[
                                {
                                  borderWidth: 1,
                                  borderRadius: 14,
                                  padding: 12,
                                  gap: 8,
                                },
                                colors.bulletBox,
                              ]}
                            >
                              {block.split('\n').map((line, lIdx) => {
                                const trimmed = line.trim()
                                const isBullet = trimmed.startsWith('•') || trimmed.startsWith('-')
                                const isHeader = trimmed.startsWith('⚠️') || trimmed.includes('Important') || trimmed.includes('Notice')
                                return (
                                  <View key={lIdx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                                    {isBullet && (
                                      <Text style={{ color: active.status === 'warning' ? '#F59E0B' : '#4F6BFF', fontSize: 13, lineHeight: 18 }}>•</Text>
                                    )}
                                    <Text
                                      style={[
                                        layout.message,
                                        colors.message,
                                        { textAlign: 'left', flex: 1, fontSize: 12.5, lineHeight: 18 },
                                        isHeader && { fontWeight: '700', color: theme.isDark ? '#FFFFFF' : '#111827', fontSize: 13 },
                                      ]}
                                    >
                                      {isBullet ? trimmed.replace(/^[•-]\s*/, '') : trimmed}
                                    </Text>
                                  </View>
                                )
                              })}
                            </View>
                          )
                        }
                        return (
                          <Text key={bIdx} style={[layout.message, colors.message]}>
                            {block}
                          </Text>
                        )
                      })}
                    </View>
                  ) : (
                    <Text style={[layout.message, colors.message]}>{active.message}</Text>
                  )}
                </ScrollView>
              )}

              {active.content}

              <View style={isButtonRow ? layout.buttonRow : layout.buttonColumn}>
                {displayButtons.map((button, index) => {
                  const variant = button.style ?? 'default'
                  const buttonElement = (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => handleButton(button)}
                      accessibilityRole="button"
                      style={[
                        layout.button,
                        isButtonRow && (button.flex ? { flex: button.flex } : layout.buttonFlex),
                        variant === 'default' && colors.accentButton,
                        variant === 'secondary' && colors.secondaryButton,
                        variant === 'destructive' && colors.destructiveButton,
                        variant === 'cancel' && colors.cancelButton,
                        variant === 'plain' && colors.plainButton,
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          layout.buttonText,
                          variant === 'default' && colors.accentButtonText,
                          variant === 'secondary' && colors.secondaryButtonText,
                          variant === 'destructive' && colors.destructiveButtonText,
                          variant === 'cancel' && colors.cancelButtonText,
                          variant === 'plain' && colors.plainButtonText,
                        ]}
                      >
                        {button.text}
                      </Text>
                    </TouchableOpacity>
                  )

                  if (button.subtext) {
                    return (
                      <View key={`${button.text}-${index}`} style={isButtonRow ? layout.buttonFlex : { width: '100%' }}>
                        {buttonElement}
                        <Text style={[layout.buttonSubtext, { color: theme.isDark ? '#8A8985' : theme.textMuted }]}>
                          {button.subtext}
                        </Text>
                      </View>
                    )
                  }

                  return (
                    <React.Fragment key={`${button.text}-${index}`}>
                      {buttonElement}
                    </React.Fragment>
                  )
                })}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </HaptixDialogContext.Provider>
  )
}

// Geometry only. Colour lives in the memo above so it tracks the active theme.
const layout = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 345,
    borderRadius: 24,
    borderWidth: 1.2,
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 16,
  },
  statusBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.2,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 10,
  },
  messageScroll: {
    maxHeight: 260,
    marginBottom: 4,
  },
  message: {
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  buttonColumn: {
    gap: 10,
    marginTop: 20,
  },
  button: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonText: {
    fontSize: 14.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonSubtext: {
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 2,
    lineHeight: 16,
  },
})
