import React, { useState } from 'react'
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import Clipboard from '@/utils/clipboard'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { ellipsify } from '@/utils/ellipsify'

export interface HaptixAgentTradeSuccessModalProps {
  visible: boolean
  onClose: () => void
  amountSol: number
  recipientAddress: string
  tradeSig: string
  network?: 'devnet' | 'mainnet'
}

export function HaptixAgentTradeSuccessModal({
  visible,
  onClose,
  amountSol,
  recipientAddress,
  tradeSig,
  network = 'devnet',
}: HaptixAgentTradeSuccessModalProps) {
  const { isDark } = useAppTheme()
  const [copiedRecipient, setCopiedRecipient] = useState(false)
  const [copiedSig, setCopiedSig] = useState(false)

  const handleCopyRecipient = () => {
    if (!recipientAddress) return
    Clipboard.setString(recipientAddress)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopiedRecipient(true)
    setTimeout(() => setCopiedRecipient(false), 2000)
  }

  const handleCopySig = () => {
    if (!tradeSig) return
    Clipboard.setString(tradeSig)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopiedSig(true)
    setTimeout(() => setCopiedSig(false), 2000)
  }

  const handleViewSolscan = () => {
    if (!tradeSig) return
    const clusterParam = network === 'devnet' ? '?cluster=devnet' : ''
    Linking.openURL(`https://solscan.io/tx/${tradeSig}${clusterParam}`).catch(() => {})
  }

  const handleDone = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    onClose()
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={handleDone}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#0C0C0D' : '#FFFFFF',
              borderColor: isDark ? '#2A2A28' : '#E6E4DE',
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Top Sheet Drag Handle */}
          <View
            style={[
              styles.dragHandle,
              { backgroundColor: isDark ? '#3A3A37' : '#D8D5CE' },
            ]}
          />

          {/* Success Ring & Hero Text */}
          <View style={styles.heroSection}>
            <View style={styles.ringOuter}>
              <View style={styles.ringInner}>
                <MaterialIcons name="check" size={28} color="#5FBF7A" />
              </View>
            </View>

            <Text style={[styles.statusSubtitle, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
              Agent trade executed
            </Text>
            <Text style={[styles.heroAmount, { color: isDark ? '#F2F1EE' : '#181714' }]}>
              {`−${amountSol.toFixed(2)} SOL`}
            </Text>
            <Text style={[styles.networkSub, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
              {`Sent on Solana ${network}`}
            </Text>
          </View>

          {/* Details Table */}
          <View
            style={[
              styles.tableCard,
              {
                borderColor: isDark ? '#2A2A28' : '#E6E4DE',
                backgroundColor: isDark ? 'transparent' : '#FAFAF9',
              },
            ]}
          >
            {/* Recipient Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                To
              </Text>
              <TouchableOpacity
                style={styles.copyWrap}
                onPress={handleCopyRecipient}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.monoValue, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                  {ellipsify(recipientAddress || '', 6)}
                </Text>
                <MaterialIcons
                  name={copiedRecipient ? 'check' : 'content-copy'}
                  size={13}
                  color={copiedRecipient ? '#5FBF7A' : isDark ? '#8A8985' : '#6B6A64'}
                />
              </TouchableOpacity>
            </View>

            {/* Signed By Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Signed by
              </Text>
              <View style={styles.badgeRow}>
                <MaterialIcons name="smart-toy" size={14} color={isDark ? '#6C8CFF' : '#5A6EE6'} />
                <Text style={[styles.rowValue, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                  Agent session key
                </Text>
              </View>
            </View>

            {/* Biometric Prompt Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Biometric prompt
              </Text>
              <Text style={[styles.rowValue, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                None (Autonomous)
              </Text>
            </View>

            {/* Trade Tx Row */}
            <View style={styles.tableRow}>
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Trade tx
              </Text>
              <TouchableOpacity
                style={styles.copyWrap}
                onPress={handleCopySig}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.monoValue, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                  {ellipsify(tradeSig || '', 8)}
                </Text>
                <MaterialIcons
                  name={copiedSig ? 'check' : 'content-copy'}
                  size={13}
                  color={copiedSig ? '#5FBF7A' : isDark ? '#8A8985' : '#6B6A64'}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Action Buttons */}
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={handleDone}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.solscanBtn,
              {
                borderColor: isDark ? '#2A2A28' : '#D1D5DB',
                backgroundColor: isDark ? 'transparent' : '#F9FAFB',
              },
            ]}
            onPress={handleViewSolscan}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="View on Solscan"
          >
            <MaterialIcons
              name="open-in-new"
              size={15}
              color={isDark ? '#8A8985' : '#6B6A64'}
            />
            <Text style={[styles.solscanBtnText, { color: isDark ? '#F2F1EE' : '#181714' }]}>
              View on Solscan
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 22,
    borderWidth: 0.5,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.65,
    shadowRadius: 28,
    elevation: 20,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 18,
  },
  ringOuter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(95, 191, 122, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  ringInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(95, 191, 122, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusSubtitle: {
    fontSize: 12,
    marginBottom: 4,
    textAlign: 'center',
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  networkSub: {
    fontSize: 12.5,
    marginTop: 4,
    textAlign: 'center',
  },
  tableCard: {
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    marginBottom: 18,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowBorder: {
    borderBottomWidth: 0.5,
  },
  rowLabel: {
    fontSize: 13,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  copyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  monoValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  doneBtn: {
    backgroundColor: '#6C8CFF',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0C0C0D',
  },
  solscanBtn: {
    borderWidth: 0.5,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  solscanBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
})
