import React from 'react'
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
import { useAppTheme } from '@/components/theme/theme-context'
import { ellipsify } from '@/utils/ellipsify'

export interface HaptixAgentTradeConfirmModalProps {
  visible: boolean
  onClose: () => void
  onConfirm: () => void
  amountSol: number
  destinationAddress: string
  networkName?: string
  allowanceSol: number
  expiryHours: number
}

export function HaptixAgentTradeConfirmModal({
  visible,
  onClose,
  onConfirm,
  amountSol,
  destinationAddress,
  networkName = 'Solana devnet',
  allowanceSol,
  expiryHours,
}: HaptixAgentTradeConfirmModalProps) {
  const { isDark } = useAppTheme()

  const handleConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    onConfirm()
  }

  const handleCancel = () => {
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
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#141416' : '#FFFFFF',
              borderColor: isDark ? '#2A2A28' : '#E6E4DE',
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header Amber Caution Icon Circle */}
          <View style={styles.iconCircle}>
            <MaterialIcons name="warning-amber" size={24} color="#D99A2B" />
          </View>

          {/* Title & Subtitle */}
          <Text style={[styles.title, { color: isDark ? '#F2F1EE' : '#111827' }]}>
            Run agent trade?
          </Text>
          <Text style={[styles.subtitle, { color: isDark ? '#8A8985' : '#6B7280' }]}>
            The agent will sign this transfer on its own.
          </Text>

          {/* Details Table */}
          <View
            style={[
              styles.tableContainer,
              {
                borderColor: isDark ? '#2A2A28' : '#E6E4DE',
                backgroundColor: isDark ? 'transparent' : '#FAFAF9',
              },
            ]}
          >
            {/* Amount Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B7280' }]}>
                Amount
              </Text>
              <Text style={[styles.amountValue, { color: isDark ? '#F2F1EE' : '#111827' }]}>
                {`${amountSol} SOL`}
              </Text>
            </View>

            {/* To Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B7280' }]}>
                To
              </Text>
              <Text style={[styles.monoValue, { color: isDark ? '#F2F1EE' : '#111827' }]}>
                {ellipsify(destinationAddress, 6)}
              </Text>
            </View>

            {/* Network Row */}
            <View
              style={[
                styles.tableRow,
                styles.rowBorder,
                { borderBottomColor: isDark ? '#201F1D' : '#E5E7EB' },
              ]}
            >
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B7280' }]}>
                Network
              </Text>
              <Text style={[styles.textValue, { color: isDark ? '#F2F1EE' : '#111827' }]}>
                {networkName}
              </Text>
            </View>

            {/* Agent Allowance Row */}
            <View style={styles.tableRow}>
              <Text style={[styles.rowLabel, { color: isDark ? '#8A8985' : '#6B7280' }]}>
                Agent allowance
              </Text>
              <Text style={[styles.textValue, { color: isDark ? '#F2F1EE' : '#111827' }]}>
                {`${allowanceSol} SOL for ${expiryHours} hours`}
              </Text>
            </View>
          </View>

          {/* Two Consequence Lines */}
          <View style={styles.consequencesList}>
            <View style={styles.consequenceRow}>
              <MaterialIcons
                name="fingerprint"
                size={16}
                color={isDark ? '#8A8985' : '#6B7280'}
                style={styles.consequenceIcon}
              />
              <Text style={[styles.consequenceText, { color: isDark ? '#B4B3AE' : '#4B5563' }]}>
                You'll approve with both passkeys, one after the other.
              </Text>
            </View>

            <View style={styles.consequenceRow}>
              <MaterialIcons
                name="smart-toy"
                size={16}
                color={isDark ? '#8A8985' : '#6B7280'}
                style={styles.consequenceIcon}
              />
              <Text style={[styles.consequenceText, { color: isDark ? '#B4B3AE' : '#4B5563' }]}>
                After that, a temporary agent key signs without a biometric prompt.
              </Text>
            </View>
          </View>

          {/* Action Buttons Row */}
          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={[
                styles.cancelButton,
                {
                  borderColor: isDark ? '#2A2A28' : '#D1D5DB',
                  backgroundColor: isDark ? 'transparent' : '#F3F4F6',
                },
              ]}
              onPress={handleCancel}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.cancelButtonText, { color: isDark ? '#F2F1EE' : '#1F2937' }]}>
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirm}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Approve with both keys"
            >
              <Text style={styles.confirmButtonText}>
                Approve with both keys
              </Text>
            </TouchableOpacity>
          </View>
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
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.65,
    shadowRadius: 28,
    elevation: 20,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(217, 154, 43, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  tableContainer: {
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    marginBottom: 14,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 0.5,
  },
  rowLabel: {
    fontSize: 13,
    flexShrink: 0,
  },
  amountValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  monoValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12.5,
  },
  textValue: {
    fontSize: 13,
    textAlign: 'right',
  },
  consequencesList: {
    flexDirection: 'column',
    gap: 10,
    marginBottom: 18,
  },
  consequenceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  consequenceIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  consequenceText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 0.5,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 13.5,
    fontWeight: '500',
  },
  confirmButton: {
    flex: 1.5,
    backgroundColor: '#6C8CFF',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0C0C0D',
  },
})
