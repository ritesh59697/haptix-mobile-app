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

  const colors = useMemo(
    () => ({
      card: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
      title: { color: theme.textPrimary },
      message: { color: theme.textSecondary },
      divider: { backgroundColor: theme.borderSubtle },
      accentButton: { backgroundColor: theme.accent, borderColor: theme.accent },
      accentButtonText: { color: theme.accentForeground },
      cancelButtonText: { color: theme.textMuted },
      secondaryButton: { backgroundColor: theme.bgApp, borderColor: theme.borderSubtle },
      secondaryButtonText: { color: theme.textPrimary },
      destructiveButton: { backgroundColor: theme.roseBg, borderColor: theme.rose },
      destructiveButtonText: { color: theme.roseText },
    }),
    [theme],
  )

  const statusColor =
    active?.status === 'success'
      ? theme.emerald
      : active?.status === 'warning'
        ? theme.amber
        : active?.status === 'error'
          ? theme.rose
          : theme.textMuted

  const statusIcon = active ? STATUS_ICON[active.status] : null
  const isButtonRow = active?.buttons.length === 2

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
                <MaterialIcons name={statusIcon} size={26} color={statusColor} style={layout.statusIcon} />
              )}

              <Text style={[layout.title, colors.title]}>{active.title}</Text>

              {!!active.message && (
                <ScrollView style={layout.messageScroll} bounces={false}>
                  <Text style={[layout.message, colors.message]}>{active.message}</Text>
                </ScrollView>
              )}

              {active.content}

              <View style={[layout.divider, colors.divider]} />

              <View style={isButtonRow ? layout.buttonRow : layout.buttonColumn}>
                {active.buttons.map((button, index) => {
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
                        variant === 'cancel' && layout.buttonGhost,
                      ]}
                    >
                      <Text
                        // Two lines rather than one: a pair of actions like
                        // "View on Explorer" + "Done" splits the card evenly, and the
                        // first label truncated to "View on Explo..." at one line.
                        numberOfLines={2}
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
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  statusIcon: {
    alignSelf: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: typeScale.heading,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  messageScroll: {
    maxHeight: 260,
    marginTop: 10,
  },
  message: {
    fontSize: typeScale.bodyLg,
    lineHeight: 21,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 18,
    marginBottom: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonColumn: {
    gap: 10,
  },
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  buttonText: {
    fontSize: typeScale.title,
    fontWeight: '600',
    textAlign: 'center',
  },
})
