import React, { useState, useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  ActivityIndicator,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import Svg, { Path } from 'react-native-svg'
import { Connection, PublicKey } from '@solana/web3.js'
import Clipboard from '@/utils/clipboard'
import { ellipsify } from '@/utils/ellipsify'
import { AppConfig } from '@/constants/app-config'
import { fundDevnetWallet } from '@/utils/haptix-funder'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixFeatureGuideModal } from '@/components/haptix/haptix-feature-guide-modal'

export interface HaptixWalletCreatedContentProps {
  walletName: string
  walletAddress: string
  securityMode: 'everyday' | 'vault'
  spendThreshold?: number
  showHandle?: boolean
  onClose: () => void
  onDevnetSolFunded?: () => void
}

export interface HaptixWalletCreatedSheetProps extends HaptixWalletCreatedContentProps {
  visible: boolean
}

/**
 * Visual content for the Wallet Created confirmation.
 * Renders the animated checkmark ring, hero wallet name, mode badge,
 * summary card (address, network, quorum), next steps (airdrop, guardian),
 * and primary 'Done' action.
 */
export function HaptixWalletCreatedContent({
  walletName,
  walletAddress,
  securityMode,
  spendThreshold,
  showHandle = true,
  onClose,
  onDevnetSolFunded,
}: HaptixWalletCreatedContentProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()

  const [copied, setCopied] = useState(false)
  const [isFunding, setIsFunding] = useState(false)
  const [isFunded, setIsFunded] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const autoFundAttemptedRef = useRef(false)

  // Spring animation for checkmark ring
  const ringScale = useRef(new Animated.Value(0.5)).current
  const ringOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.parallel([
      Animated.spring(ringScale, {
        toValue: 1,
        tension: 70,
        friction: 6,
        useNativeDriver: true,
      }),
      Animated.timing(ringOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start()
  }, [ringScale, ringOpacity])

  // Automatically request Devnet starter SOL upon creation so users never land on an empty wallet
  useEffect(() => {
    if (!walletAddress || autoFundAttemptedRef.current || isFunded || isFunding) return
    autoFundAttemptedRef.current = true
    handleFundDevnetSol()
  }, [walletAddress])

  const handleCopyAddress = async () => {
    if (!walletAddress) return
    Clipboard.setString(walletAddress)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleFundDevnetSol = async () => {
    if (!walletAddress || isFunding || isFunded) return
    try {
      setIsFunding(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const connection = new Connection(AppConfig.devnetRpcUrl, 'confirmed')
      const pda = new PublicKey(walletAddress)

      try {
        await fundDevnetWallet(connection, pda, 0.1)
      } catch {
        // Fallback to standard requestAirdrop if funder key is not set or drained
        const sig = await connection.requestAirdrop(pda, 0.1 * 1e9)
        await connection.confirmTransaction(sig, 'confirmed')
      }

      await AsyncStorage.setItem(`@haptix_devnet_autofunded_${walletAddress}`, 'true').catch(() => {})
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setIsFunded(true)
      onDevnetSolFunded?.()
    } catch (err) {
      console.warn('[Haptix] Devnet funding error:', err)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } finally {
      setIsFunding(false)
    }
  }

  const handleAddGuardian = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onClose()
    router.push('/(tabs)/settings/recovery')
  }

  const handleDone = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onClose()
  }

  const thresholdSol =
    spendThreshold !== undefined ? spendThreshold : securityMode === 'vault' ? 0.0 : 0.1

  const cardBg = isDark ? '#121213' : (theme.bgElevated ?? '#F6F6F8')
  const cardBorder = isDark ? '#2a2a28' : theme.borderDefault
  const dividerBg = isDark ? '#201f1d' : theme.borderSubtle
  const iconBoxBg = isDark ? '#1a1a18' : (theme.isDark ? '#1a1a18' : '#E8E8ED')

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 16) + 12 },
      ]}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {/* Handle indicator */}
      {showHandle && (
        <View style={[styles.handle, { backgroundColor: isDark ? '#3a3a37' : '#D1D1D6' }]} />
      )}

      {/* Hero Header with Animated Ring */}
      <View style={styles.header}>
        <Animated.View
          style={[
            styles.ringWrapper,
            { transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        >
          <View style={[styles.ringOuter, { backgroundColor: isDark ? 'rgba(95, 191, 122, 0.08)' : 'rgba(5, 150, 105, 0.10)' }]}>
            <View style={[styles.ringInner, { backgroundColor: isDark ? 'rgba(95, 191, 122, 0.16)' : 'rgba(5, 150, 105, 0.18)' }]}>
              <Svg viewBox="0 0 24 24" width={30} height={30} fill="none">
                <Path
                  d="M5 12.5L9.5 17L19 7.5"
                  stroke={isDark ? '#5fbf7a' : '#059669'}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          </View>
        </Animated.View>

        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>Wallet created</Text>
        <Text style={[styles.heroName, { color: theme.textPrimary }]} numberOfLines={1}>
          {walletName || 'Hardware Vault'}
        </Text>
        <Text style={[styles.modeSubtitle, { color: theme.textMuted }]}>
          {securityMode === 'vault' ? 'Vault mode' : 'Everyday mode'}
        </Text>
      </View>

      {/* Summary Card */}
      <View style={[styles.summaryCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        {/* Address Row */}
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Address</Text>
          <TouchableOpacity
            style={styles.addressPill}
            onPress={handleCopyAddress}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.addressText, { color: theme.textPrimary }]}>
              {walletAddress ? ellipsify(walletAddress, 4, '..') : '—'}
            </Text>
            <MaterialIcons
              name={copied ? 'check' : 'content-copy'}
              size={13}
              color={copied ? (isDark ? '#5fbf7a' : theme.emerald) : (isDark ? '#8a8985' : theme.textMuted)}
            />
            {copied && (
              <Text style={[styles.copiedText, { color: isDark ? '#5fbf7a' : theme.emeraldText }]}>
                Copied
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: dividerBg }]} />

        {/* Network Row */}
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Network</Text>
          <View style={styles.networkBadge}>
            <View style={[styles.networkDot, { backgroundColor: isDark ? '#5fbf7a' : theme.emerald }]} />
            <Text style={[styles.networkText, { color: theme.textPrimary }]}>Solana devnet</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: dividerBg }]} />

        {/* Quorum / Spending Threshold Row */}
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]} numberOfLines={1}>
            Sends above {thresholdSol.toFixed(2)} SOL
          </Text>
          <Text style={[styles.quorumValue, { color: theme.textPrimary }]} numberOfLines={1}>
            {securityMode === 'vault'
              ? 'Need this phone and second device'
              : 'Need this phone and backup key'}
          </Text>
        </View>
      </View>

      {/* Next Steps Section */}
      <Text style={[styles.sectionHeading, { color: theme.textMuted }]}>Next steps</Text>
      <View style={[styles.nextStepsCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        {/* Step 1: Devnet SOL */}
        <TouchableOpacity
          style={styles.stepRow}
          onPress={handleFundDevnetSol}
          disabled={isFunding || isFunded}
          activeOpacity={0.7}
        >
          <View style={[styles.stepIconBox, { backgroundColor: iconBoxBg }]}>
            <MaterialIcons name="local-gas-station" size={17} color={isDark ? '#f2f1ee' : theme.textPrimary} />
          </View>
          <View style={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>Get devnet SOL</Text>
            <Text
              style={[
                styles.stepSubtitle,
                { color: theme.textMuted },
                isFunded && { color: isDark ? '#5fbf7a' : theme.emerald, fontWeight: '500' },
                isFunding && { color: theme.accent },
              ]}
            >
              {isFunding
                ? 'Funding 0.1 devnet SOL...'
                : isFunded
                ? '0.1 SOL received!'
                : 'Your balance is empty'}
            </Text>
          </View>
          {isFunding ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : isFunded ? (
            <MaterialIcons name="check" size={18} color={isDark ? '#5fbf7a' : theme.emerald} />
          ) : (
            <MaterialIcons name="chevron-right" size={20} color={isDark ? '#8a8985' : theme.textMuted} />
          )}
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: dividerBg }]} />

        {/* Step 2: Recovery Guardian */}
        <TouchableOpacity
          style={styles.stepRow}
          onPress={handleAddGuardian}
          activeOpacity={0.7}
        >
          <View style={[styles.stepIconBox, { backgroundColor: iconBoxBg }]}>
            <MaterialIcons name="group" size={17} color={isDark ? '#f2f1ee' : theme.textPrimary} />
          </View>
          <View style={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>Add a recovery guardian</Text>
            <Text style={[styles.stepSubtitle, { color: theme.textMuted }]}>
              Someone who can help if you lose this device
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={isDark ? '#8a8985' : theme.textMuted} />
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: dividerBg }]} />

        {/* Step 3: Feature Guide */}
        <TouchableOpacity
          style={styles.stepRow}
          onPress={() => {
            void Haptics.selectionAsync()
            setShowGuide(true)
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.stepIconBox, { backgroundColor: iconBoxBg }]}>
            <MaterialIcons name="auto-awesome" size={17} color={isDark ? '#f2f1ee' : theme.textPrimary} />
          </View>
          <View style={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>How Haptix works</Text>
            <Text style={[styles.stepSubtitle, { color: theme.textMuted }]}>
              Explore 100% self-custody, 1-tap signing &amp; AI agents
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={isDark ? '#8a8985' : theme.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Primary Action Button */}
      <TouchableOpacity
        style={[styles.doneButton, { backgroundColor: theme.accent }]}
        onPress={handleDone}
        activeOpacity={0.85}
      >
        <Text style={[styles.doneButtonText, { color: '#FFFFFF' }]}>Done</Text>
      </TouchableOpacity>

      <HaptixFeatureGuideModal
        visible={showGuide}
        onClose={() => setShowGuide(false)}
        persistDismissal={false}
      />
    </ScrollView>
  )
}

/**
 * Standalone Modal Bottom Sheet wrapper for HaptixWalletCreatedContent
 */
export function HaptixWalletCreatedSheet({
  visible,
  walletName,
  walletAddress,
  securityMode,
  spendThreshold,
  onClose,
  onDevnetSolFunded,
}: HaptixWalletCreatedSheetProps) {
  const { theme, isDark } = useAppTheme()
  const panY = useRef(new Animated.Value(0)).current

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          panY.setValue(gesture.dy)
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120 || gesture.vy > 0.8) {
          Animated.timing(panY, {
            toValue: 600,
            duration: 200,
            useNativeDriver: true,
          }).start(onClose)
        } else {
          Animated.spring(panY, {
            toValue: 0,
            bounciness: 4,
            useNativeDriver: true,
          }).start()
        }
      },
    }),
  ).current

  useEffect(() => {
    if (visible) {
      panY.setValue(0)
    }
  }, [visible, panY])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: theme.bgCard,
              borderColor: isDark ? '#2a2a28' : theme.borderDefault,
              transform: [{ translateY: panY }],
            },
          ]}
        >
          <View style={styles.touchArea} {...panResponder.panHandlers}>
            <View style={[styles.handle, { backgroundColor: isDark ? '#3a3a37' : '#D1D1D6' }]} />
          </View>

          <HaptixWalletCreatedContent
            walletName={walletName}
            walletAddress={walletAddress}
            securityMode={securityMode}
            spendThreshold={spendThreshold}
            showHandle={false}
            onClose={onClose}
            onDevnetSolFunded={onDevnetSolFunded}
          />
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#0c0c0d',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 0.5,
    borderColor: '#2a2a28',
    maxHeight: '92%',
  },
  touchArea: {
    paddingTop: 12,
    paddingBottom: 4,
    alignItems: 'center',
  },
  scrollContainer: {
    backgroundColor: 'transparent',
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#3a3a37',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 18,
  },
  ringWrapper: {
    marginBottom: 16,
  },
  ringOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(95, 191, 122, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(95, 191, 122, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: '#8a8985',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
    textAlign: 'center',
  },
  heroName: {
    color: '#f2f1ee',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  modeSubtitle: {
    color: '#8a8985',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  summaryCard: {
    borderWidth: 0.5,
    borderColor: '#2a2a28',
    borderRadius: 14,
    backgroundColor: '#121213',
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: 12,
  },
  summaryLabel: {
    color: '#8a8985',
    fontSize: 13,
    fontWeight: '400',
    flexShrink: 0,
  },
  addressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  addressText: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12.5,
    color: '#f2f1ee',
    fontWeight: '500',
  },
  copiedText: {
    fontSize: 11,
    color: '#5fbf7a',
    fontWeight: '600',
    marginLeft: 2,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#5fbf7a',
  },
  networkText: {
    fontSize: 13,
    color: '#f2f1ee',
    fontWeight: '500',
  },
  quorumValue: {
    fontSize: 13,
    color: '#f2f1ee',
    fontWeight: '400',
    textAlign: 'right',
    flex: 1,
  },
  divider: {
    height: 0.5,
    backgroundColor: '#201f1d',
  },
  sectionHeading: {
    color: '#8a8985',
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  nextStepsCard: {
    borderWidth: 0.5,
    borderColor: '#2a2a28',
    borderRadius: 14,
    backgroundColor: '#121213',
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 12,
  },
  stepIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#1a1a18',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13.5,
    fontWeight: '500',
    color: '#f2f1ee',
    marginBottom: 2,
  },
  stepSubtitle: {
    fontSize: 12,
    color: '#8a8985',
  },
  doneButton: {
    backgroundColor: '#6c8cff',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    color: '#0c0c0d',
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
})
