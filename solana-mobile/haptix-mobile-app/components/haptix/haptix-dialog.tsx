import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export type HaptixDialogStatus = 'neutral' | 'success' | 'warning' | 'error'
export type HaptixDialogButtonStyle = 'default' | 'cancel' | 'destructive' | 'secondary'

export interface HaptixDialogButton {
  text: string
  onPress?: () => void
  /** `default` renders as the accent action, `cancel` as a quiet text action. */
  style?: HaptixDialogButtonStyle
}

export interface HaptixDialogOptions {
  cancelable?: boolean
  onDismiss?: () => void
  /** Draws a status icon above the title. */
  status?: HaptixDialogStatus
  /** Runs the given node between the message and the actions for whatever a string cannot carry. */
  content?: React.ReactNode
}

interface DialogRequest {
  title: string
  message?: string
  content?: React.ReactNode
  buttons: HaptixDialogButton[]
  cancelable: boolean
  onDismiss?: () => void
  status: HaptixDialogStatus
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
    const cancelButton = request.buttons.find((button) => button.style === 'cancel')
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

  const isButtonRow = active?.buttons.length === 2 && !shouldStackButtons

  // In vertical stack: place affirmative/action buttons first, and 'cancel' at the very bottom
  const displayButtons = useMemo(() => {
    if (!active) return []
    if (isButtonRow) return active.buttons
    const nonCancel = active.buttons.filter((b) => b.style !== 'cancel')
    const cancel = active.buttons.filter((b) => b.style === 'cancel')
    return [...nonCancel, ...cancel]
  }, [active, isButtonRow])

  const colors = useMemo(
    () => ({
      card: {
        backgroundColor: theme.isDark ? '#1C1C1E' : '#FFFFFF',
        borderColor: theme.isDark ? '#26262C' : theme.borderDefault,
      },
      title: { color: theme.textPrimary },
      message: { color: theme.textSecondary },
      accentButton: {
        backgroundColor: '#4F6BFF',
        borderColor: '#4F6BFF',
      },
      accentButtonText: { color: '#FFFFFF' },
      cancelButton: {
        backgroundColor: theme.isDark ? '#26262A' : '#EFEFF0',
        borderColor: 'transparent',
      },
      cancelButtonText: { color: theme.textPrimary },
      secondaryButton: {
        backgroundColor: theme.isDark ? '#26262A' : '#EFEFF0',
        borderColor: theme.isDark ? '#333338' : theme.borderSubtle,
      },
      secondaryButtonText: { color: theme.textPrimary },
      destructiveButton: {
        backgroundColor: theme.rose,
        borderColor: theme.rose,
      },
      destructiveButtonText: { color: '#FFFFFF' },
    }),
    [theme],
  )

  const statusBadgeBg =
    active?.status === 'success'
      ? (theme.isDark ? 'rgba(16, 185, 129, 0.16)' : 'rgba(16, 185, 129, 0.12)')
      : active?.status === 'warning'
        ? (theme.isDark ? 'rgba(245, 158, 11, 0.16)' : 'rgba(245, 158, 11, 0.12)')
        : active?.status === 'error'
          ? (theme.isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(239, 68, 68, 0.12)')
          : (theme.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)')

  const statusColor =
    active?.status === 'success'
      ? theme.emerald
      : active?.status === 'warning'
        ? theme.amber
        : active?.status === 'error'
          ? theme.rose
          : theme.textMuted

  const statusIcon = active ? STATUS_ICON[active.status] : null

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
                <View style={[layout.statusBadge, { backgroundColor: statusBadgeBg }]}>
                  <MaterialIcons name={statusIcon} size={28} color={statusColor} />
                </View>
              )}

              <Text style={[layout.title, colors.title]}>{active.title}</Text>

              {!!active.message && (
                <ScrollView style={layout.messageScroll} bounces={false} showsVerticalScrollIndicator={false}>
                  <Text style={[layout.message, colors.message]}>{active.message}</Text>
                </ScrollView>
              )}

              {active.content}

              <View style={isButtonRow ? layout.buttonRow : layout.buttonColumn}>
                {displayButtons.map((button, index) => {
                  const variant = button.style ?? 'default'
                  return (
                    <TouchableOpacity
                      key={`${button.text}-${index}`}
                      activeOpacity={0.8}
                      onPress={() => handleButton(button)}
                      accessibilityRole="button"
                      style={[
                        layout.button,
                        isButtonRow && layout.buttonFlex,
                        variant === 'default' && colors.accentButton,
                        variant === 'secondary' && colors.secondaryButton,
                        variant === 'destructive' && colors.destructiveButton,
                        variant === 'cancel' && colors.cancelButton,
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
                        ]}
                      >
                        {button.text}
                      </Text>
                    </TouchableOpacity>
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
    maxWidth: 350,
    borderRadius: 24,
    borderWidth: 1.2,
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  statusBadge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18.5,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 8,
  },
  messageScroll: {
    maxHeight: 220,
    marginBottom: 6,
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
    borderRadius: 15,
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
})
