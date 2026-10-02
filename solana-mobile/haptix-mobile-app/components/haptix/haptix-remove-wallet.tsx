import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'

interface RemoveWalletContextValue {
  confirmRemoveWallet: (
    address: string | null | undefined,
    onConfirm: () => void | Promise<void>,
  ) => void
}

const RemoveWalletContext = createContext<RemoveWalletContextValue>({
  confirmRemoveWallet: () => {},
})

/**
 * Hook to trigger the custom "Remove Wallet from Device" confirmation modal.
 * The modal enforces copying the wallet address before allowing removal.
 */
export function useConfirmRemoveWallet() {
  const context = useContext(RemoveWalletContext)
  return context.confirmRemoveWallet
}

export function RemoveWalletModalProvider({ children }: { children: React.ReactNode }) {
  const { isDark } = useAppTheme()
  const [visible, setVisible] = useState(false)
  const [address, setAddress] = useState('')
  const [hasCopied, setHasCopied] = useState(false)
  const onConfirmRef = useRef<(() => void | Promise<void>) | null>(null)

  const confirmRemoveWallet = useCallback(
    (targetAddress: string | null | undefined, onConfirm: () => void | Promise<void>) => {
      setAddress(targetAddress || '')
      setHasCopied(false)
      onConfirmRef.current = onConfirm
      setVisible(true)
    },
    [],
  )

  const handleCopy = () => {
    if (!address) return
    Clipboard.setString(address)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setHasCopied(true)
  }

  const handleClose = () => {
    setVisible(false)
    setHasCopied(false)
    onConfirmRef.current = null
  }

  const handleConfirm = () => {
    if (!hasCopied) return
    const callback = onConfirmRef.current
    handleClose()
    if (callback) {
      void callback()
    }
  }

  const addressLines = React.useMemo(() => {
    if (!address) return []
    const mid = Math.ceil(address.length / 2)
    return [address.slice(0, mid), address.slice(mid)]
  }, [address])

  const styles = createStyles(isDark)

  return (
    <RemoveWalletContext.Provider value={{ confirmRemoveWallet }}>
      {children}

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <Pressable style={styles.modalBackdrop} onPress={handleClose}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            {/* Red Alert Circle */}
            <View style={styles.iconCircle}>
              <MaterialIcons name="error-outline" size={26} color="#D9284A" />
            </View>

            {/* Title & Reassurance */}
            <Text style={styles.title}>Remove wallet from this device?</Text>
            <Text style={styles.subtitle}>
              Nothing is deleted on-chain and your funds stay put. This device only forgets your passkeys.
            </Text>

            {/* Save Address Card */}
            <View style={styles.addressCard}>
              <View style={styles.addressCardHeader}>
                <Text style={styles.addressCardTitle}>Save your wallet address</Text>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={handleCopy}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={hasCopied ? 'check' : 'content-copy'}
                    size={14}
                    color={hasCopied ? '#10B981' : '#5A6EE6'}
                  />
                  <Text style={[styles.copyButtonText, hasCopied && styles.copiedButtonText]}>
                    {hasCopied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.addressCardSubtitle}>
                Signing back in asks for it, and a passkey can't hand it back.
              </Text>

              <TouchableOpacity
                style={[
                  styles.addressBox,
                  hasCopied && styles.addressBoxCopied,
                ]}
                onPress={handleCopy}
                activeOpacity={0.8}
              >
                {addressLines.map((line, idx) => (
                  <Text key={idx} selectable style={styles.addressText}>
                    {line}
                  </Text>
                ))}
              </TouchableOpacity>
            </View>

            {/* Side-by-Side Action Buttons */}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.removeBtn,
                  hasCopied ? styles.removeBtnEnabled : styles.removeBtnDisabled,
                ]}
                onPress={handleConfirm}
                disabled={!hasCopied}
                activeOpacity={hasCopied ? 0.85 : 1}
              >
                <Text
                  style={[
                    styles.removeBtnText,
                    hasCopied ? styles.removeBtnTextEnabled : styles.removeBtnTextDisabled,
                  ]}
                >
                  Remove wallet
                </Text>
              </TouchableOpacity>
            </View>

            {/* Helper Text when not copied */}
            {!hasCopied && (
              <Text style={styles.helperText}>Copy your address to continue</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </RemoveWalletContext.Provider>
  )
}

const createStyles = (isDark: boolean) =>
  StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: isDark ? '#141416' : '#FFFFFF',
      borderRadius: 24,
      padding: 24,
      paddingHorizontal: 18,
      paddingBottom: 18,
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: isDark ? 0.45 : 0.25,
      shadowRadius: 28,
      elevation: 16,
    },
    iconCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: 'rgba(217, 40, 74, 0.10)',
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
      marginBottom: 14,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      lineHeight: 22,
      marginBottom: 8,
      textAlign: 'center',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      color: isDark ? '#8A8985' : '#6B6A64',
      marginBottom: 18,
    },
    addressCard: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      borderRadius: 14,
      padding: 14,
      marginBottom: 16,
      backgroundColor: isDark ? '#18181A' : '#FAFAF8',
    },
    addressCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    addressCardTitle: {
      fontSize: 13.5,
      fontWeight: '600',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    copyButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#5A6EE6',
    },
    copiedButtonText: {
      color: '#10B981',
    },
    addressCardSubtitle: {
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
      marginBottom: 10,
      color: isDark ? '#8A8985' : '#6B6A64',
    },
    addressBox: {
      backgroundColor: isDark ? '#1C1C1E' : '#F4F3F1',
      borderWidth: 1,
      borderColor: 'transparent',
      borderRadius: 10,
      padding: 10,
      paddingHorizontal: 12,
    },
    addressBoxCopied: {
      borderColor: isDark ? 'rgba(16, 185, 129, 0.50)' : 'rgba(16, 185, 129, 0.40)',
    },
    addressText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      lineHeight: 18,
      color: isDark ? '#F2F1EE' : '#181714',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 8,
    },
    cancelBtn: {
      flex: 1,
      backgroundColor: isDark ? '#1F1F23' : '#EFEEEA',
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    removeBtn: {
      flex: 1.2,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeBtnDisabled: {
      backgroundColor: isDark ? 'rgba(217, 40, 74, 0.12)' : 'rgba(217, 40, 74, 0.08)',
      borderWidth: 0.5,
      borderColor: isDark ? 'rgba(217, 40, 74, 0.22)' : 'rgba(217, 40, 74, 0.16)',
    },
    removeBtnEnabled: {
      backgroundColor: '#D9284A',
      borderWidth: 0.5,
      borderColor: '#D9284A',
    },
    removeBtnText: {
      fontSize: 14,
      fontWeight: '600',
    },
    removeBtnTextDisabled: {
      color: isDark ? 'rgba(248, 113, 113, 0.55)' : 'rgba(217, 40, 74, 0.50)',
    },
    removeBtnTextEnabled: {
      color: '#FFFFFF',
    },
    helperText: {
      fontSize: 11.5,
      textAlign: 'center',
      marginTop: 8,
      color: isDark ? '#73726E' : '#8C8A83',
    },
  })
