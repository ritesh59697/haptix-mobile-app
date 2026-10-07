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

export interface HaptixRevokeAgentSuccessModalProps {
  visible: boolean
  onClose: () => void
  agentPubkey: string
  signature: string
  network?: 'devnet' | 'mainnet'
}

export function HaptixRevokeAgentSuccessModal({
  visible,
  onClose,
  agentPubkey,
  signature,
  network = 'devnet',
}: HaptixRevokeAgentSuccessModalProps) {
  const { isDark } = useAppTheme()
  const [copiedSig, setCopiedSig] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  const handleCopySig = () => {
    if (!signature) return
    Clipboard.setString(signature)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopiedSig(true)
    setTimeout(() => setCopiedSig(false), 2000)
  }

  const handleCopyKey = () => {
    if (!agentPubkey) return
    Clipboard.setString(agentPubkey)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
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
              Agent session revoked
            </Text>
            <Text style={[styles.heroTitle, { color: isDark ? '#F2F1EE' : '#181714' }]}>
              Session Inactive
            </Text>
            <Text style={[styles.explainSub, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
              The program no longer accepts signatures from this agent.
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
            {/* Session Key Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Session key
              </Text>
              <TouchableOpacity
                style={styles.copyWrap}
                onPress={handleCopyKey}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.monoValue, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                  {ellipsify(agentPubkey || '', 6)}
                </Text>
                <MaterialIcons
                  name={copiedKey ? 'check' : 'content-copy'}
                  size={13}
                  color={copiedKey ? '#5FBF7A' : isDark ? '#8A8985' : '#6B6A64'}
                />
              </TouchableOpacity>
            </View>

            {/* Signature Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Signature
              </Text>
              <TouchableOpacity
                style={styles.copyWrap}
                onPress={handleCopySig}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.monoValue, { color: isDark ? '#F2F1EE' : '#181714' }]}>
                  {ellipsify(signature || '', 8)}
                </Text>
                <MaterialIcons
                  name={copiedSig ? 'check' : 'content-copy'}
                  size={13}
                  color={copiedSig ? '#5FBF7A' : isDark ? '#8A8985' : '#6B6A64'}
                />
              </TouchableOpacity>
            </View>

            {/* Status Row */}
            <View style={styles.tableRow}>
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B6A64' }]}>
                Status
              </Text>
              <Text style={[styles.statusValue, { color: '#5FBF7A' }]}>
                Permanently revoked
              </Text>
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
  heroTitle: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  explainSub: {
    fontSize: 12.5,
    marginTop: 4,
    lineHeight: 18,
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
    paddingVertical: 11,
  },
  rowBorder: {
    borderBottomWidth: 0.5,
  },
  rowLabel: {
    fontSize: 13,
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
  statusValue: {
    fontSize: 13,
    fontWeight: '500',
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
