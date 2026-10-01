import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
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
import Clipboard from '@/utils/clipboard'

import { useAuth } from '@/components/auth/auth-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { LucideSmartphone, LucideShieldCheck, LucideCheck, Lock1Bold, LucideArrowRight } from '@/components/haptix/haptix-icons'
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
import { getHaptixAddressLookupTable, buildOptimalTransaction } from '@/utils/haptix-lookup-table'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'

const PRESET_LIMITS_ROW_1 = [0.05, 0.1, 0.25]
const PRESET_LIMITS_ROW_2 = [0.5, 1.0]

interface LimitUpdatedSuccessState {
  newLimit: number
  previousLimit: number
  signature: string
}

export default function SpendingLimitsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const dialog = useHaptixDialog()
  const { theme, isDark } = useAppTheme()
  const { activeWallet, updateWallet } = useAuth()
  const { connection, getExplorerUrl } = useCluster()

  const styles = useMemo(() => createStyles(theme), [theme])
  const scrollViewRef = useRef<ScrollView>(null)

  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState<LimitUpdatedSuccessState | null>(null)
  const [copiedSig, setCopiedSig] = useState(false)

  // Separated: savedLimit (on-chain truth) vs draftLimit (active selection)
  const [draftLimit, setDraftLimit] = useState<number>(() => activeWallet?.spendThreshold ?? 0.1)
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
        setDraftLimit(thresholdSol)
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

  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // Track keyboard show/hide and auto-scroll to input
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardVisible(true)
      const kh = e.endCoordinates?.height || 320
      setKeyboardHeight(kh)
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
      }, 100)
    })

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false)
      setKeyboardHeight(0)
    })

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  const handleBack = () => {
    Haptics.selectionAsync()
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)/settings')
    }
  }

  // Active saved limit on-chain
  const savedLimit = useMemo(() => {
    if (onChainWallet) {
      return Number(onChainWallet.spendThresholdLamports) / LAMPORTS_PER_SOL
    }
    return activeWallet?.spendThreshold ?? 0.1
  }, [onChainWallet, activeWallet?.spendThreshold])

  // Effective draft limit
  const effectiveDraftLimit = useMemo(() => {
    if (isCustomMode) {
      const parsed = parseFloat(customInput)
      return isNaN(parsed) || parsed <= 0 ? 0 : parsed
    }
    return draftLimit
  }, [isCustomMode, customInput, draftLimit])

  const isUnchanged = Math.abs(effectiveDraftLimit - savedLimit) < 0.000001
  const isSaveEnabled = !isUnchanged && effectiveDraftLimit > 0 && !isUpdating

  const handleSelectPreset = (val: number) => {
    Haptics.selectionAsync()
    Keyboard.dismiss()
    setIsCustomMode(false)
    setDraftLimit(val)
  }

  const handleSelectCustom = () => {
    Haptics.selectionAsync()
    setIsCustomMode(true)
    if (!customInput) {
      setCustomInput(draftLimit.toString())
    }
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true })
    }, 120)
  }

  const handleSaveLimit = async () => {
    Keyboard.dismiss()
    if (!activeWallet?.address || !onChainWallet) return

    if (effectiveDraftLimit <= 0) {
      dialog.alert('Invalid Limit', 'Spending limit must be greater than 0 SOL.')
      return
    }

    if (isUnchanged) {
      dialog.alert('Unchanged', `Your spending limit is already ${effectiveDraftLimit} SOL.`)
      return
    }

    const isRaise = effectiveDraftLimit > savedLimit
    const title = isRaise ? 'Raise the spending limit?' : 'Lower the spending limit?'
    const subtitle = isRaise
      ? `One key will be able to send up to ${effectiveDraftLimit} SOL without the second key.`
      : `One key will only be able to send up to ${effectiveDraftLimit} SOL. Larger sends will need both keys.`

    const content = (
      <View style={{ width: '100%', marginTop: 8 }}>
        {/* Current vs New comparison table */}
        <View
          style={{
            borderWidth: 0.5,
            borderColor: theme.isDark ? '#2A2A28' : '#E6E4DE',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 2,
            marginBottom: 14,
            backgroundColor: theme.isDark ? '#18181B' : '#FFFFFF',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 11,
              borderBottomWidth: 0.5,
              borderBottomColor: theme.isDark ? '#201F1D' : '#EEECE7',
            }}
          >
            <Text style={{ color: theme.isDark ? '#8A8985' : '#6B6A64', fontSize: 13 }}>Current</Text>
            <Text style={{ color: theme.isDark ? '#D4D4D8' : '#111827', fontSize: 13, fontWeight: '500' }}>
              {savedLimit} SOL
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 11,
            }}
          >
            <Text style={{ color: theme.isDark ? '#8A8985' : '#6B6A64', fontSize: 13 }}>New</Text>
            <Text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: '600' }}>
              {effectiveDraftLimit} SOL
            </Text>
          </View>
        </View>

        {/* Requirements List */}
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <MaterialIcons
              name="fingerprint"
              size={18}
              color={theme.isDark ? '#8A8985' : '#6B6A64'}
              style={{ marginTop: 1 }}
            />
            <Text style={{ color: theme.isDark ? '#B4B3AE' : '#4A4944', fontSize: 12.5, lineHeight: 18, flex: 1 }}>
              Needs both keys to approve.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <MaterialIcons
              name="link"
              size={18}
              color={theme.isDark ? '#8A8985' : '#6B6A64'}
              style={{ marginTop: 1 }}
            />
            <Text style={{ color: theme.isDark ? '#B4B3AE' : '#4A4944', fontSize: 12.5, lineHeight: 18, flex: 1 }}>
              The limit is enforced directly on-chain.
            </Text>
          </View>
        </View>
      </View>
    )

    dialog.alert(
      title,
      subtitle,
      [
        { text: 'Cancel', style: 'cancel', flex: 1 },
        { text: 'Approve with both keys', style: 'default', flex: 1.5, onPress: () => void executeThresholdUpdate() },
      ],
      {
        status: isRaise ? 'warning' : 'neutral',
        icon: isRaise ? 'warning' : 'shield',
        forceRow: true,
        content,
      },
    )
  }

  const executeThresholdUpdate = async () => {
    if (!activeWallet?.address || !onChainWallet) return

    setIsUpdating(true)
    try {
      const walletPda = new PublicKey(activeWallet.address)
      const fresh = await fetchHaptixWallet(connection, walletPda)
      if (!fresh) {
        dialog.alert('Wallet not on-chain', 'Activate the wallet before changing the spending limit.')
        return
      }
      const newThresholdLamports = BigInt(Math.round(effectiveDraftLimit * LAMPORTS_PER_SOL))
      const message = getSetSpendThresholdSignedMessage(walletPda, newThresholdLamports, fresh.authNonce)

      // 1. Sign with Primary Passkey
      const primarySig = await signWithPasskey(
        'primary',
        message,
        `Set single-key spend limit to ${effectiveDraftLimit} SOL`,
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
      const lookupTable = await getHaptixAddressLookupTable(connection, walletPda, payer).catch(() => null)
      const { rawTx } = buildOptimalTransaction({
        payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [precompilePrimary, precompileSecondary, setThresholdIx],
        lookupTable,
      })

      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )

      const previousLimit = savedLimit

      // Update local wallet record
      await updateWallet({
        ...activeWallet,
        spendThreshold: effectiveDraftLimit,
      })

      await refreshOnChain()
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      setUpdateSuccess({
        newLimit: effectiveDraftLimit,
        previousLimit,
        signature: sig,
      })
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

  // Change delta summary feedback
  const deltaSummary = useMemo(() => {
    if (isCustomMode && (!customInput.trim() || effectiveDraftLimit <= 0)) {
      return { isPrompt: true, text: 'Enter a custom amount in SOL.' }
    }
    if (isUnchanged) {
      return null
    }
    const deltaImpact =
      effectiveDraftLimit > savedLimit
        ? 'This lets one key send more.'
        : 'This lowers what one key can send.'
    return {
      isPrompt: false,
      from: savedLimit,
      to: effectiveDraftLimit,
      impact: deltaImpact,
    }
  }, [isCustomMode, customInput, isUnchanged, effectiveDraftLimit, savedLimit])

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Centered, Balanced Header matching Haptix Settings */}
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

        {/* Scroll Content Area */}
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: keyboardVisible ? Math.max(keyboardHeight + 60, 360) : 24 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Active On-Chain Limit Card (Unified Explainer strictly on savedLimit) */}
          <View style={styles.card}>
            <View style={styles.statusHeader}>
              <View>
                <Text style={styles.cardLabel}>ACTIVE ON-CHAIN LIMIT</Text>
                <Text style={styles.currentLimitNumber}>
                  {isLoading ? '...' : `${savedLimit} SOL`}
                </Text>
              </View>
              <View style={styles.activeBadge}>
                <LucideCheck size={12} color="#34C759" strokeWidth={2.6} />
                <Text style={styles.activeBadgeText}>Live Policy</Text>
              </View>
            </View>

            {/* Rule Row 1: Up to limit */}
            <View style={styles.ruleRow}>
              <View style={styles.ruleIconContainer}>
                <LucideSmartphone size={18} color={theme.textPrimary} strokeWidth={1.8} />
              </View>
              <View style={styles.ruleTextContainer}>
                <Text style={styles.ruleTitle}>Up to {savedLimit} SOL</Text>
                <Text style={styles.ruleSubtitle}>
                  Instant execution with your primary passkey on this phone.
                </Text>
              </View>
            </View>

            <View style={styles.ruleDivider} />

            {/* Rule Row 2: Above limit */}
            <View style={styles.ruleRow}>
              <View style={styles.ruleIconContainer}>
                <LucideShieldCheck size={18} color={theme.textPrimary} strokeWidth={1.8} />
              </View>
              <View style={styles.ruleTextContainer}>
                <Text style={styles.ruleTitle}>Above {savedLimit} SOL</Text>
                <Text style={styles.ruleSubtitle}>
                  {activeWallet?.securityMode === 'vault'
                    ? 'Requires both this phone and your secondary device or hardware key.'
                    : 'Requires both your Primary and Backup keys to authorize.'}
                </Text>
              </View>
            </View>
          </View>

          {/* Change Limit Selection Card */}
          <View style={styles.card}>
            <View style={styles.changeHeader}>
              <Text style={styles.sectionTitle}>Set New Single-Key Limit</Text>
              <Text style={styles.metaCurrent}>Current: {savedLimit} SOL</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Select a preset limit or enter a custom amount in SOL.
            </Text>

            {/* Row 1 Presets */}
            <View style={styles.presetsRow}>
              {PRESET_LIMITS_ROW_1.map((preset) => {
                const isSelected = !isCustomMode && draftLimit === preset
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

            {/* Row 2 Presets + Custom */}
            <View style={[styles.presetsRow, { marginBottom: isCustomMode ? 12 : 14 }]}>
              {PRESET_LIMITS_ROW_2.map((preset) => {
                const isSelected = !isCustomMode && draftLimit === preset
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

            {/* Custom Input Container */}
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
                  <Text style={styles.solSuffix}>SOL</Text>
                </View>
              </View>
            )}

            {/* Dynamic Delta Summary Banner with Vector Arrow */}
            {deltaSummary && (
              <View style={styles.deltaBanner}>
                {deltaSummary.isPrompt ? (
                  <Text style={styles.deltaBannerText}>{deltaSummary.text}</Text>
                ) : (
                  <View style={styles.deltaRow}>
                    <View style={styles.deltaTransitionGroup}>
                      <Text style={styles.deltaAmountText}>{deltaSummary.from} SOL</Text>
                      <LucideArrowRight
                        size={15}
                        color={theme.isDark ? '#F2F1EE' : '#181714'}
                        strokeWidth={2.4}
                      />
                      <Text style={styles.deltaAmountText}>{deltaSummary.to} SOL.</Text>
                    </View>
                    <Text style={styles.deltaImpactText}>{deltaSummary.impact}</Text>
                  </View>
                )}
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
          </View>
        </ScrollView>

        {/* Pinned Bottom Footer (Always visible, Protected above Gesture Bar) */}
        <View
          style={[
            styles.pinnedFooter,
            {
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.saveButton,
              isSaveEnabled ? styles.saveButtonActive : styles.saveButtonDisabled,
            ]}
            onPress={handleSaveLimit}
            disabled={!isSaveEnabled || isUpdating}
            activeOpacity={0.85}
          >
            {isUpdating ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text
                style={[
                  styles.saveButtonText,
                  isSaveEnabled ? styles.saveButtonTextActive : styles.saveButtonTextDisabled,
                ]}
              >
                Save limit
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* SPENDING LIMIT UPDATED CONFIRMATION SHEET */}
      <Modal
        visible={updateSuccess !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setUpdateSuccess(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setUpdateSuccess(null)} />
          {updateSuccess && (
            <View
              style={[
                styles.modalSheet,
                {
                  backgroundColor: isDark ? '#141416' : '#FFFFFF',
                  borderColor: isDark ? '#2A2A28' : '#E6E4DE',
                  paddingBottom: Math.max(insets.bottom, 20),
                },
              ]}
            >
              {/* Drag Handle */}
              <View
                style={{
                  width: 36,
                  height: 4,
                  backgroundColor: isDark ? '#3A3A37' : '#D8D5CE',
                  borderRadius: 2,
                  alignSelf: 'center',
                  marginBottom: 20,
                }}
              />

              {/* Header with Emerald Checkmark Ring */}
              <View style={{ alignItems: 'center', marginBottom: 22 }}>
                <View
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: 34,
                    backgroundColor: 'rgba(31, 138, 76, 0.10)',
                    borderWidth: 8,
                    borderColor: 'rgba(31, 138, 76, 0.05)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 18,
                  }}
                >
                  <MaterialIcons name="check" size={30} color="#1F8A4C" />
                </View>

                <Text style={{ color: isDark ? '#8A8985' : '#6B6A64', fontSize: 12, marginBottom: 4 }}>
                  Spending limit updated
                </Text>
                <Text
                  style={{
                    fontSize: 32,
                    fontWeight: '600',
                    letterSpacing: -0.6,
                    color: isDark ? '#F2F1EE' : '#181714',
                  }}
                >
                  {updateSuccess.newLimit} SOL
                </Text>
                <Text style={{ color: isDark ? '#8A8985' : '#6B6A64', fontSize: 13, marginTop: 4 }}>
                  Changed from {updateSuccess.previousLimit} SOL
                </Text>
              </View>

              {/* Detail Box */}
              <View
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: isDark ? '#2A2A28' : '#E6E4DE',
                  backgroundColor: isDark ? '#141416' : '#FFFFFF',
                  paddingHorizontal: 14,
                  paddingVertical: 2,
                  marginBottom: 16,
                }}
              >
                {/* Row 1: Up to X SOL */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 11,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: isDark ? '#201F1D' : '#EEECE7',
                  }}
                >
                  <Text style={{ color: isDark ? '#8A8985' : '#6B6A64', fontSize: 13 }}>
                    Up to {updateSuccess.newLimit} SOL
                  </Text>
                  <Text style={{ color: isDark ? '#F2F1EE' : '#181714', fontSize: 13, fontWeight: '500' }}>
                    One biometric prompt
                  </Text>
                </View>

                {/* Row 2: Above X SOL */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 11,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: isDark ? '#201F1D' : '#EEECE7',
                  }}
                >
                  <Text style={{ color: isDark ? '#8A8985' : '#6B6A64', fontSize: 13 }}>
                    Above {updateSuccess.newLimit} SOL
                  </Text>
                  <Text style={{ color: isDark ? '#F2F1EE' : '#181714', fontSize: 13, fontWeight: '500' }}>
                    Both keys
                  </Text>
                </View>

                {/* Row 3: Signature */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 11,
                  }}
                >
                  <Text style={{ color: isDark ? '#8A8985' : '#6B6A64', fontSize: 13 }}>Signature</Text>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    onPress={() => {
                      Clipboard.setString(updateSuccess.signature)
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                      setCopiedSig(true)
                      setTimeout(() => setCopiedSig(false), 2000)
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={{
                        color: isDark ? '#F2F1EE' : '#181714',
                        fontSize: 12,
                        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
                      }}
                    >
                      {ellipsify(updateSuccess.signature, 8)}
                    </Text>
                    <MaterialIcons
                      name={copiedSig ? 'check' : 'content-copy'}
                      size={13}
                      color={copiedSig ? '#1F8A4C' : isDark ? '#8A8985' : '#8C8A83'}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Done Action */}
              <TouchableOpacity
                style={{
                  backgroundColor: '#5A6EE6',
                  borderRadius: 12,
                  paddingVertical: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
                onPress={() => setUpdateSuccess(null)}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '500' }}>Done</Text>
              </TouchableOpacity>

              {/* View on Solscan Button */}
              <TouchableOpacity
                style={{
                  borderWidth: 1,
                  borderColor: isDark ? '#2A2A28' : '#E0DDD6',
                  borderRadius: 12,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  backgroundColor: isDark ? 'transparent' : '#FFFFFF',
                }}
                onPress={() => {
                  Linking.openURL(getExplorerUrl(`tx/${updateSuccess.signature}`))
                }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="open-in-new" size={15} color={isDark ? '#8A8985' : '#8C8A83'} />
                <Text style={{ color: isDark ? '#F2F1EE' : '#181714', fontSize: 14, fontWeight: '500' }}>
                  View on Solscan
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
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
    changeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    metaCurrent: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.accent,
    },
    sectionTitle: {
      fontSize: typeScale.title,
      color: theme.textPrimary,
      fontWeight: '700',
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
      shadowColor: theme.accent,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 3,
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
      marginBottom: 14,
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
    deltaBanner: {
      backgroundColor: theme.isDark ? '#1C1C1E' : '#F4F3F1',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
    },
    deltaBannerText: {
      fontSize: 13.5,
      color: theme.isDark ? '#F2F1EE' : '#181714',
      lineHeight: 19,
    },
    deltaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 6,
      rowGap: 2,
    },
    deltaTransitionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    deltaAmountText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: theme.isDark ? '#F2F1EE' : '#181714',
      lineHeight: 19,
    },
    deltaImpactText: {
      fontSize: 13.5,
      color: theme.isDark ? '#8A8985' : '#6B6A64',
      lineHeight: 19,
    },
    guaranteeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
      padding: 14,
      borderRadius: 16,
      borderWidth: 0,
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
    pinnedFooter: {
      paddingHorizontal: 16,
      paddingTop: 10,
      backgroundColor: theme.bgApp,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderSubtle,
    },
    saveButton: {
      borderRadius: 12,
      paddingVertical: 13.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveButtonActive: {
      backgroundColor: '#5A6EE6',
    },
    saveButtonDisabled: {
      backgroundColor: theme.isDark ? '#1C1C1E' : '#E9E8E4',
    },
    saveButtonText: {
      fontSize: 15,
      fontWeight: '500',
    },
    saveButtonTextActive: {
      color: '#FFFFFF',
    },
    saveButtonTextDisabled: {
      color: theme.isDark ? '#5C5B57' : '#A8A6A0',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
  })
}

