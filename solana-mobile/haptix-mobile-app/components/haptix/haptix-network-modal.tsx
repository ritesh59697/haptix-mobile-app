import React, { useState, useEffect } from 'react'
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
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'

interface HaptixNetworkModalProps {
  visible: boolean
  onClose: () => void
  clusters: Cluster[]
  selectedCluster: Cluster
  onSelectCluster: (cluster: Cluster) => void
}

const NETWORK_DESCRIPTIONS: Record<string, string> = {
  Mainnet: 'Real funds',
  Devnet: 'Test funds, faucet available',
  Testnet: 'Test funds',
}

export function HaptixNetworkModal({
  visible,
  onClose,
  clusters,
  selectedCluster,
  onSelectCluster,
}: HaptixNetworkModalProps) {
  const { theme, isDark } = useAppTheme()
  const [pendingCluster, setPendingCluster] = useState<Cluster>(selectedCluster)

  // Sync state whenever modal opens
  useEffect(() => {
    if (visible) {
      setPendingCluster(selectedCluster)
    }
  }, [visible, selectedCluster])

  const isDifferent = pendingCluster.name !== selectedCluster.name
  const isMainnetSwitch =
    pendingCluster.network === ClusterNetwork.Mainnet &&
    selectedCluster.network !== ClusterNetwork.Mainnet

  const handleConfirmSwitch = () => {
    if (!isDifferent) {
      onClose()
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onSelectCluster(pendingCluster)
    onClose()
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
              Solana network
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: isDark ? '#8A8985' : '#6B6A64' },
              ]}
            >
              Choose which network to connect to
            </Text>
          </View>

          {/* Network Selection List */}
          <View style={styles.list}>
            {clusters.map((cluster) => {
              const isSelected = cluster.name === pendingCluster.name
              const isCurrent = cluster.name === selectedCluster.name
              const description =
                NETWORK_DESCRIPTIONS[cluster.name] ?? 'Solana cluster'

              return (
                <TouchableOpacity
                  key={cluster.name}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                    setPendingCluster(cluster)
                  }}
                  style={[
                    styles.networkItem,
                    {
                      backgroundColor: isSelected
                        ? isDark
                          ? 'rgba(108, 140, 255, 0.08)'
                          : 'rgba(0, 82, 255, 0.05)'
                        : isDark
                          ? '#141416'
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

                  {/* Network Details */}
                  <View style={styles.networkInfo}>
                    <Text
                      style={[
                        styles.networkName,
                        { color: isDark ? '#F2F1EE' : '#181714' },
                      ]}
                    >
                      {cluster.name}
                    </Text>
                    <Text
                      style={[
                        styles.networkDesc,
                        { color: isDark ? '#8A8985' : '#6B6A64' },
                      ]}
                    >
                      {description}
                    </Text>
                  </View>

                  {/* Current Active Badge */}
                  {isCurrent && (
                    <Text
                      style={[
                        styles.currentBadge,
                        { color: isDark ? '#8A8985' : '#6B6A64' },
                      ]}
                    >
                      Current
                    </Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Warning Banner if Switching to Mainnet */}
          {isMainnetSwitch && (
            <View style={styles.warningCard}>
              <MaterialIcons
                name="warning-amber"
                size={18}
                color="#D99A2B"
                style={{ marginTop: 1, flexShrink: 0 }}
              />
              <Text style={styles.warningText}>Mainnet uses real funds.</Text>
            </View>
          )}

          {/* Primary Action Button */}
          <TouchableOpacity
            activeOpacity={isDifferent ? 0.78 : 1}
            disabled={!isDifferent}
            onPress={handleConfirmSwitch}
            style={[
              styles.switchButton,
              {
                backgroundColor: isDifferent
                  ? isDark
                    ? '#6C8CFF'
                    : theme.accent
                  : isDark
                    ? '#201F1D'
                    : '#EAE8E3',
              },
            ]}
          >
            <Text
              style={[
                styles.switchButtonText,
                {
                  color: isDifferent
                    ? '#0C0C0D'
                    : isDark
                      ? '#5F5E5A'
                      : '#94928C',
                },
              ]}
            >
              {isDifferent ? `Switch to ${pendingCluster.name}` : 'Switch network'}
            </Text>
          </TouchableOpacity>

          {/* Cancel Button */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onClose}
            style={styles.cancelButton}
          >
            <Text
              style={[
                styles.cancelButtonText,
                { color: isDark ? '#8A8985' : '#6B6A64' },
              ]}
            >
              Cancel
            </Text>
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
  networkItem: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  radioCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  networkInfo: {
    flex: 1,
  },
  networkName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  networkDesc: {
    fontSize: 12,
  },
  currentBadge: {
    fontSize: 12,
    fontWeight: '400',
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(217, 154, 43, 0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(217, 154, 43, 0.35)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  warningText: {
    color: '#D99A2B',
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '400',
    flex: 1,
  },
  switchButton: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  switchButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
})
