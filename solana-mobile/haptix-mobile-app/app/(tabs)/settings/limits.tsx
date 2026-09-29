import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { PublicKey, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'

import { useAuth } from '@/components/auth/auth-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { PrismDepthButton } from '@/components/ui'
import { LucideSmartphone, LucideShieldCheck, LucideCheck, Lock1Bold } from '@/components/haptix/haptix-icons'
import { ellipsify } from '@/utils/ellipsify'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import { signWithPasskey } from '@/utils/haptix-passkey'
import {
  fetchHaptixWallet,
  createSetSpendThresholdInstruction,
  getSetSpendThresholdSignedMessage,
  WalletState,
} from '@/utils/haptix-client'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'

const PRESET_LIMITS_ROW_1 = [0.05, 0.1, 0.25]
const PRESET_LIMITS_ROW_2 = [0.5, 1.0]

export default function SpendingLimitsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const dialog = useHaptixDialog()
  const { theme } = useAppTheme()
  const { activeWallet, updateWallet } = useAuth()
  const { connection, getExplorerUrl } = useCluster()

  const styles = useMemo(() => createStyles(theme), [theme])
  const scrollViewRef = useRef<ScrollView>(null)

  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [selectedLimit, setSelectedLimit] = useState<number>(() => activeWallet?.spendThreshold ?? 0.1)
  const [customInput, setCustomInput] = useState('')
  const [isCustomMode, setIsCustomMode] = useState(false)

  const walletAddress = activeWallet?.address ?? null

  const refreshOnChain = useCallback(async () => {
    if (!walletAddress) {
      setOnChainWallet(null)
      setIsLoading(false)
      return
    }
    try {
      const state = await fetchHaptixWallet(connection, new PublicKey(walletAddress))
      setOnChainWallet(state)
      if (state) {
        const thresholdSol = Number(state.spendThresholdLamports) / LAMPORTS_PER_SOL
        setSelectedLimit(thresholdSol)
      }
    } catch (err) {
      console.error('[Haptix Limits] Read error:', formatChainErrorForLog(err))
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress, connection])

  useEffect(() => {
    void refreshOnChain()
  }, [refreshOnChain])

  // Scroll to bottom when keyboard opens in custom mode so input and Save button are never hidden
  useEffect(() => {
    const keyboardSub = Keyboard.addListener('keyboardDidShow', () => {
      if (isCustomMode) {
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }, 80)
      }
    })
    return () => keyboardSub.remove()
  }, [isCustomMode])

  const handleBack = () => {
    Haptics.selectionAsync()
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)/settings')
    }
  }

  const effectiveLimit = useMemo(() => {
    if (isCustomMode) {
      const parsed = parseFloat(customInput)
      return isNaN(parsed) || parsed <= 0 ? 0 : parsed
    }
    return selectedLimit
  }, [isCustomMode, customInput, selectedLimit])

  const currentOnChainLimitSol = onChainWallet
    ? Number(onChainWallet.spendThresholdLamports) / LAMPORTS_PER_SOL
    : (activeWallet?.spendThreshold ?? 0.1)

  const isUnchanged = Math.abs(effectiveLimit - currentOnChainLimitSol) < 0.000001

  const handleSelectPreset = (val: number) => {
    Haptics.selectionAsync()
    Keyboard.dismiss()
    setIsCustomMode(false)
    setSelectedLimit(val)
  }

  const handleSelectCustom = () => {
    Haptics.selectionAsync()
    setIsCustomMode(true)
    if (!customInput) {
      setCustomInput(selectedLimit.toString())
    }
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true })
    }, 120)
  }

  const handleSaveLimit = async () => {
    Keyboard.dismiss()
    if (!activeWallet?.address || !onChainWallet) return

    if (effectiveLimit <= 0) {
      dialog.alert('Invalid Limit', 'Spending limit must be greater than 0 SOL.')
      return
    }

    if (isUnchanged) {
      dialog.alert('Unchanged', `Your spending limit is already ${effectiveLimit} SOL.`)
      return
    }

    dialog.alert(
      'Update Spending Limit?',
      `Changing your single-key spending limit to ${effectiveLimit} SOL is enforced directly on-chain.\n\n` +
        'This governance action requires approval from BOTH your Primary Passkey and your Backup Key.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve (2-of-2)', onPress: () => void executeThresholdUpdate() },
      ],
    )
  }

  const executeThresholdUpdate = async () => {
    if (!activeWallet?.address || !onChainWallet) return

    setIsUpdating(true)
    try {
      const walletPda = new PublicKey(activeWallet.address)
      const newThresholdLamports = BigInt(Math.round(effectiveLimit * LAMPORTS_PER_SOL))
      const message = getSetSpendThresholdSignedMessage(newThresholdLamports)

      // 1. Sign with Primary Passkey
      const primarySig = await signWithPasskey(
        'primary',
        message,
        `Set single-key spend limit to ${effectiveLimit} SOL`,
      )

      // 2. Sign with Secondary / Vault Passkey
      const secondarySig = await signWithPasskey(
        'secondary',
        message,
        activeWallet.securityMode === 'vault'
          ? 'Confirm new limit with your Vault Key (Macbook / Security Key)'
          : 'Confirm the new spending limit with your backup key',
      )

      const precompilePrimary = createSecp256r1Instruction({ ...primarySig, message })
      const precompileSecondary = createSecp256r1Instruction({ ...secondarySig, message })
      const setThresholdIx = createSetSpendThresholdInstruction({
        walletPda,
        newThresholdLamports,
        primarySigIxIndex: 0,
        secondarySigIxIndex: 1,
      })

      const payer = await getFundedDevnetPayer(connection)
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(precompilePrimary, precompileSecondary, setThresholdIx)

      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })

      // Update local wallet record
      await updateWallet({
        ...activeWallet,
        spendThreshold: effectiveLimit,
      })

      await refreshOnChain()
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      dialog.alert(
        'Spending Limit Updated',
        `Your single-key spending limit is now ${effectiveLimit} SOL.\n\n` +
          `• Sends ≤ ${effectiveLimit} SOL: Instant 1-tap FaceID\n` +
          `• Sends > ${effectiveLimit} SOL: Requires both passkeys\n\nTx: ${ellipsify(sig, 8)}`,
        [
          { text: 'View on Explorer', onPress: () => Linking.openURL(getExplorerUrl(`tx/${sig}`)) },
          { text: 'Done', style: 'default' },
        ],
      )
    } catch (err: any) {
      console.error('[Haptix Limits] Update error:', formatChainErrorForLog(err))
      dialog.alert(
        'Limit Not Updated',
        describeChainError(err, 'Could not update spending limit on-chain. Please try again.'),
      )
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'android' ? 12 : 6) }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Back to Settings"
        >
          <MaterialIcons name="arrow-back-ios-new" size={17} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Spending Limits</Text>
          <Text style={styles.headerSubtitle}>One-Key Fast Lane vs. Vault Quorum</Text>
        </View>
        <View style={styles.headerRightSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + (isCustomMode ? 280 : 36) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Status Card */}
          <View style={styles.card}>
            <View style={styles.statusHeader}>
              <View>
                <Text style={styles.cardLabel}>ACTIVE ON-CHAIN LIMIT</Text>
                <Text style={styles.currentLimitNumber}>
                  {isLoading ? '...' : `${currentOnChainLimitSol} SOL`}
                </Text>
              </View>
              <View style={styles.activeBadge}>
                <LucideCheck size={12} color="#34C759" strokeWidth={2.6} />
                <Text style={styles.activeBadgeText}>Live Policy</Text>
              </View>
            </View>
            <Text style={styles.statusExplainer}>
              Sends up to this limit run with a single biometric prompt. Any transfer exceeding this amount will
              automatically escalate to require both your Primary and Backup keys.
            </Text>
          </View>

          {/* How It Works Diagram Card */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>How Protection Works</Text>
            <View style={styles.ruleRow}>
              <View style={styles.ruleIconContainer}>
                <LucideSmartphone size={18} color={theme.textPrimary} strokeWidth={1.8} />
              </View>
              <View style={styles.ruleTextContainer}>
                <Text style={styles.ruleTitle}>Daily Fast Lane (≤ {effectiveLimit} SOL)</Text>
                <Text style={styles.ruleSubtitle}>
                  Instant execution with your primary passkey on this phone.
                </Text>
              </View>
            </View>

            <View style={styles.ruleDivider} />

            <View style={styles.ruleRow}>
              <View style={styles.ruleIconContainer}>
                <LucideShieldCheck size={18} color={theme.textPrimary} strokeWidth={1.8} />
              </View>
              <View style={styles.ruleTextContainer}>
                <Text style={styles.ruleTitle}>Vault Quorum (&gt; {effectiveLimit} SOL)</Text>
                <Text style={styles.ruleSubtitle}>
                  {activeWallet?.securityMode === 'vault'
                    ? 'Requires both this phone and your secondary device or hardware key.'
                    : 'Requires both your Primary and Backup keys to authorize.'}
                </Text>
              </View>
            </View>
          </View>

          {/* Limit Selector Card */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Set New Single-Key Limit</Text>
            <Text style={styles.cardSubtitle}>
              Select a preset limit or enter a custom amount in SOL.
            </Text>

            {/* Row 1 */}
            <View style={styles.presetsRow}>
              {PRESET_LIMITS_ROW_1.map((preset) => {
                const isSelected = !isCustomMode && selectedLimit === preset
                return (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => handleSelectPreset(preset)}
                    style={[
                      styles.presetChip,
                      isSelected && styles.presetChipActive,
                    ]}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        isSelected && styles.presetChipTextActive,
                      ]}
                    >
                      {preset} SOL
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* Row 2 */}
            <View style={[styles.presetsRow, { marginBottom: isCustomMode ? 12 : 16 }]}>
              {PRESET_LIMITS_ROW_2.map((preset) => {
                const isSelected = !isCustomMode && selectedLimit === preset
                return (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => handleSelectPreset(preset)}
                    style={[
                      styles.presetChip,
                      isSelected && styles.presetChipActive,
                    ]}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        isSelected && styles.presetChipTextActive,
                      ]}
                    >
                      {preset} SOL
                    </Text>
                  </TouchableOpacity>
                )
              })}
              <TouchableOpacity
                onPress={handleSelectCustom}
                style={[
                  styles.presetChip,
                  isCustomMode && styles.presetChipActive,
                ]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    isCustomMode && styles.presetChipTextActive,
                  ]}
                >
                  Custom
                </Text>
              </TouchableOpacity>
            </View>

            {isCustomMode && (
              <View style={styles.customInputContainer}>
                <Text style={styles.customInputLabel}>Custom Amount (SOL)</Text>
                <View style={styles.customInputRow}>
                  <TextInput
                    style={styles.customTextInput}
                    value={customInput}
                    onChangeText={setCustomInput}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    placeholder="0.25"
                    placeholderTextColor={theme.textMuted}
                    autoFocus
                    onFocus={() => {
                      setTimeout(() => {
                        scrollViewRef.current?.scrollToEnd({ animated: true })
                      }, 120)
                    }}
                  />
                  <View style={styles.customInputRightGroup}>
                    <Text style={styles.solSuffix}>SOL</Text>
                    <TouchableOpacity
                      onPress={() => Keyboard.dismiss()}
                      style={styles.keyboardDismissBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Dismiss Keyboard"
                    >
                      <LucideCheck size={13} color="#6C8CFF" strokeWidth={2.4} />
                      <Text style={styles.keyboardDismissText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {/* Security Guarantee Banner */}
            <View style={styles.guaranteeBanner}>
              <View style={styles.guaranteeIconWrap}>
                <Lock1Bold size={16} color="#6C8CFF" />
              </View>
              <Text style={styles.guaranteeText}>
                Raising or lowering this limit requires authorization from{' '}
                <Text style={{ fontWeight: '700', color: theme.textPrimary }}>both passkeys</Text>. A compromised device
                cannot silently raise this threshold.
              </Text>
            </View>

            {/* Action Button */}
            <View style={styles.actionContainer}>
              <PrismDepthButton
                title={
                  isUpdating
                    ? 'Verifying On-Chain Quorum...'
                    : isUnchanged
                    ? 'Limit Unchanged'
                    : `Save Limit (${effectiveLimit} SOL)`
                }
                onPress={handleSaveLimit}
                disabled={isUpdating || isUnchanged || effectiveLimit <= 0}
                icon={
                  isUpdating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialIcons name="verified-user" size={18} color="#fff" />
                  )
                }
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bgApp,
    },
    keyboardContainer: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.borderSubtle,
      backgroundColor: theme.bgApp,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
      borderWidth: 0,
    },
    headerTitleWrap: {
      flex: 1,
      alignItems: 'center',
      marginHorizontal: 8,
    },
    headerTitle: {
      fontSize: typeScale.heading,
      color: theme.textPrimary,
      fontWeight: '700',
    },
    headerSubtitle: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
      marginTop: 2,
    },
    headerRightSpacer: {
      width: 40,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      gap: 16,
    },
    card: {
      backgroundColor: theme.bgCard,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.isDark ? '#222226' : theme.borderDefault,
      padding: 18,
    },
    statusHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 10,
    },
    cardLabel: {
      fontSize: 12,
      color: theme.textMuted,
      fontWeight: '700',
      letterSpacing: 0.6,
    },
    currentLimitNumber: {
      fontSize: 34,
      fontWeight: '800',
      color: theme.textPrimary,
      marginTop: 4,
      letterSpacing: -0.5,
    },
    activeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 0,
      gap: 5,
    },
    activeBadgeText: {
      fontSize: typeScale.caption,
      color: theme.textSecondary,
      fontWeight: '600',
    },
    statusExplainer: {
      fontSize: typeScale.footnote,
      color: theme.textSecondary,
      lineHeight: 20,
    },
    sectionTitle: {
      fontSize: typeScale.title,
      color: theme.textPrimary,
      fontWeight: '700',
      marginBottom: 4,
    },
    cardSubtitle: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
      marginBottom: 16,
    },
    ruleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 12,
    },
    ruleIconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
      borderWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ruleTextContainer: {
      flex: 1,
    },
    ruleTitle: {
      fontSize: typeScale.body,
      color: theme.textPrimary,
      fontWeight: '600',
    },
    ruleSubtitle: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
      marginTop: 2,
    },
    ruleDivider: {
      height: 1,
      backgroundColor: theme.isDark ? '#1C1C1E' : theme.borderSubtle,
      marginLeft: 52,
      marginVertical: 4,
    },
    presetsRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    presetChip: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 6,
      borderRadius: 14,
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
      borderWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    presetChipActive: {
      backgroundColor: theme.accent,
      borderWidth: 0,
    },
    presetChipText: {
      fontSize: 14,
      color: theme.textPrimary,
      fontWeight: '600',
    },
    presetChipTextActive: {
      color: '#FFFFFF',
      fontWeight: '700',
    },
    customInputContainer: {
      backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? '#26262B' : theme.borderDefault,
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 16,
    },
    customInputLabel: {
      fontSize: typeScale.caption,
      color: theme.textMuted,
      marginBottom: 6,
      fontWeight: '600',
    },
    customInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    customTextInput: {
      flex: 1,
      fontSize: 22,
      fontWeight: '700',
      color: theme.textPrimary,
      padding: 0,
    },
    customInputRightGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    solSuffix: {
      fontSize: typeScale.body,
      color: theme.textMuted,
      fontWeight: '600',
    },
    keyboardDismissBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
    },
    keyboardDismissText: {
      fontSize: 12,
      color: '#6C8CFF',
      fontWeight: '700',
    },
    guaranteeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
      padding: 14,
      borderRadius: 16,
      borderWidth: 0,
      marginBottom: 16,
    },
    guaranteeIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.isDark ? 'rgba(108, 140, 255, 0.14)' : 'rgba(79, 107, 255, 0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    guaranteeText: {
      fontSize: typeScale.caption,
      color: theme.textSecondary,
      flex: 1,
      lineHeight: 18,
    },
    actionContainer: {
      marginTop: 4,
    },
  })
}

