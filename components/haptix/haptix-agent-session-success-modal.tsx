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

export interface HaptixAgentSessionSuccessModalProps {
  visible: boolean
  onClose: () => void
  signature: string
  allowanceSol: number
  validHours: number
  network?: 'devnet' | 'mainnet'
}

export function HaptixAgentSessionSuccessModal({
  visible,
  onClose,
  signature,
  allowanceSol,
  validHours,
  network = 'devnet',
}: HaptixAgentSessionSuccessModalProps) {
  const { isDark } = useAppTheme()
  const [copied, setCopied] = useState(false)

  const handleCopySignature = () => {
    if (!signature) return
    Clipboard.setString(signature)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleViewSolscan = () => {
    if (!signature) return
    const clusterParam = network === 'devnet' ? '?cluster=devnet' : ''
    Linking.openURL(`https://solscan.io/tx/${signature}${clusterParam}`).catch(() => {})
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
              Agent session granted
            </Text>
            <Text style={[styles.heroAmount, { color: isDark ? '#F2F1EE' : '#181714' }]}>
              {`${allowanceSol.toFixed(2)} SOL`}
            </Text>
            <Text style={[styles.allowanceSub, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
              {`Agent allowance for ${validHours} hours`}
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
            {/* Approved with row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Approved with
              </Text>
              <Text style={[styles.rowValue, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                Both passkeys
              </Text>
            </View>

            {/* Signature row */}
            <View style={styles.tableRow}>
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Signature
              </Text>
              <TouchableOpacity
                style={styles.sigWrap}
                onPress={handleCopySignature}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.sigMono, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                  {ellipsify(signature || '', 8)}
                </Text>
                <MaterialIcons
                  name={copied ? 'check' : 'content-copy'}
                  size={13}
                  color={copied ? '#5FBF7A' : isDark ? '#8A8985' : '#6B6A64'}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Robot consequence note */}
          <View style={styles.robotNoteRow}>
            <MaterialIcons
              name="smart-toy"
              size={16}
              color={isDark ? '#8A8985' : '#6B6A64'}
              style={{ marginTop: 1, flexShrink: 0 }}
            />
            <Text style={[styles.robotNoteText, { color: isDark ? '#B4B3AE' : '#4B5563' }]}>
              The agent can spend up to this amount without a biometric prompt until the session ends.
            </Text>
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
    marginBottom: 20,
  },
  ringOuter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(95, 191, 122, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
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
  allowanceSub: {
    fontSize: 12.5,
    marginTop: 4,
    textAlign: 'center',
  },
  tableCard: {
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    marginBottom: 12,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
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
  sigWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sigMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  robotNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  robotNoteText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
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
