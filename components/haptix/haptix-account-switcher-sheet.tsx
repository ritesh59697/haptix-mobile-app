import React, { useState, useEffect } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useAuth } from '@/components/auth/auth-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { ellipsify } from '@/utils/ellipsify'
import { isSolanaAddress } from '@/utils/solana-address'
import { loadCachedBalance } from '@/utils/haptix-tx-history'
import { LucideShieldCheck, LucideSmartphone, LucideCheck } from './haptix-icons'
import { PrismDepthButton } from '@/components/ui'
import { radius, typeScale } from '@/theme/tokens'

interface HaptixAccountSwitcherSheetProps {
  visible: boolean
  onClose: () => void
}

const THRESHOLD_OPTIONS = [0.05, 0.1, 0.25, 0.5]

export function HaptixAccountSwitcherSheet({ visible, onClose }: HaptixAccountSwitcherSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const { activeWallet, wallets, switchWallet, createWallet } = useAuth()

  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Account creation form state
  const [newAccountName, setNewAccountName] = useState('')
  const [selectedMode, setSelectedMode] = useState<'everyday' | 'vault'>('everyday')
  const [spendLimit, setSpendLimit] = useState(0.1)

  // Advanced settings state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [primaryKeyLabel, setPrimaryKeyLabel] = useState('')
  const [secondaryKeyLabel, setSecondaryKeyLabel] = useState('')
  const [guardianAddress, setGuardianAddress] = useState('')

  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [balances, setBalances] = useState<Record<string, number>>({})

  // Load balances for all accounts
  useEffect(() => {
    if (!visible) return
    let mounted = true
    async function fetchBalances() {
      const results: Record<string, number> = {}
      for (const w of wallets) {
        try {
          const cached = await loadCachedBalance(w.address)
          if (cached !== null) {
            results[w.address] = cached
          }
        } catch {}
      }
      if (mounted) setBalances(results)
    }
    fetchBalances()
    return () => {
      mounted = false
    }
  }, [visible, wallets])

  const handleSelectAccount = async (address: string) => {
    if (address === activeWallet?.address) {
      onClose()
      return
    }
    if (switchingTo) return

    try {
      setSwitchingTo(address)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const success = await switchWallet(address)
      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        onClose()
      } else {
        dialog.alert('Switch Failed', 'That account is no longer saved on this device.', undefined, {
          status: 'error',
        })
      }
    } catch (err: any) {
      dialog.alert('Could Not Switch Account', err?.message || 'Please try again.', undefined, {
        status: 'error',
      })
    } finally {
      setSwitchingTo(null)
    }
  }

  const handleStartCreate = () => {
    Haptics.selectionAsync()
    const defaultName =
      selectedMode === 'vault'
        ? `Hardware Vault ${wallets.length + 1}`
        : `Everyday Account ${wallets.length + 1}`
    setNewAccountName(defaultName)
    setPrimaryKeyLabel('Device Biometrics (Primary)')
    setSecondaryKeyLabel('Mac Secure Enclave / Backup Key')
    setGuardianAddress('')
    setShowAdvanced(false)
    setIsCreating(true)
  }

  const handleCancelCreate = () => {
    Haptics.selectionAsync()
    setIsCreating(false)
    setNewAccountName('')
    setShowAdvanced(false)
  }

  const handleConfirmCreate = async () => {
    const finalName =
      newAccountName.trim() ||
      (selectedMode === 'vault' ? 'Hardware Vault' : 'Everyday Account')

    if (guardianAddress.trim() && !isSolanaAddress(guardianAddress.trim())) {
      dialog.alert(
        'Invalid Guardian Address',
        'Please enter a valid 32-to-44 character base58 Solana address, or leave it blank.',
        undefined,
        { status: 'warning' },
      )
      return
    }

    try {
      setIsSubmittingCreate(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      await createWallet(finalName, {
        mode: selectedMode,
        spendThreshold: selectedMode === 'vault' ? 0.0 : spendLimit,
        primaryLabel: primaryKeyLabel.trim() || undefined,
        secondaryLabel: secondaryKeyLabel.trim() || undefined,
        guardianAddress: guardianAddress.trim() || undefined,
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setIsCreating(false)
      setNewAccountName('')
      setShowAdvanced(false)
      onClose()

      dialog.alert(
        'Account Created',
        `"${finalName}" is now active in ${
          selectedMode === 'vault' ? 'Vault (2-of-2 Hardware)' : 'Everyday'
        } mode.`,
        undefined,
        { status: 'success' },
      )
    } catch (err: any) {
      const msg = err?.message || ''
      if (
        msg.includes('cancelled') ||
        msg.includes('canceled') ||
        msg.includes('User cancelled')
      ) {
        return
      }
      dialog.alert('Creation Failed', msg || 'Could not create account passkey.', undefined, {
        status: 'error',
      })
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bgCard,
              borderColor: theme.borderDefault,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
            },
          ]}
        >
          {/* Top Drag Handle */}
          <View style={[styles.dragHandle, { backgroundColor: theme.borderDefault }]} />

          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.textPrimary }]}>
                {isCreating ? 'Create Account' : 'Smart Accounts'}
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                {isCreating
                  ? 'Configure security, policy and hardware keys'
                  : `${wallets.length} ${wallets.length === 1 ? 'account' : 'accounts'} on this device`}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: theme.accentLight }]}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={17} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          {!isCreating ? (
            /* ================================================================ */
            /* 1. ACCOUNT LIST VIEW (ZERO OVERLAPPING GUARANTEED)               */
            /* ================================================================ */
            <ScrollView
              style={styles.scrollList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {wallets.map((wallet) => {
                const isActive = wallet.address === activeWallet?.address
                const isSwitching = switchingTo === wallet.address
                const isVault = wallet.securityMode === 'vault'
                const rawLamports = balances[wallet.address]
                const solBalance =
                  rawLamports !== undefined && rawLamports !== null
                    ? rawLamports / 1e9
                    : null

                return (
                  <TouchableOpacity
                    key={wallet.address}
                    style={[
                      styles.accountCard,
                      {
                        backgroundColor: isActive ? theme.bgElevated : theme.bgCard,
                        borderColor: isActive ? theme.borderFocus : theme.borderSubtle,
                      },
                    ]}
                    onPress={() => handleSelectAccount(wallet.address)}
                    activeOpacity={0.75}
                    disabled={isSwitching}
                  >
                    {/* Left Icon Badge */}
                    <View
                      style={[
                        styles.accountAvatar,
                        {
                          backgroundColor: isVault ? theme.amberBg : theme.emeraldBg,
                          borderColor: isVault ? theme.amberBorder : theme.emeraldBorder,
                        },
                      ]}
                    >
                      {isVault ? (
                        <LucideShieldCheck size={18} color={theme.amberText} />
                      ) : (
                        <LucideSmartphone size={18} color={theme.emeraldText} />
                      )}
                    </View>

                    {/* Middle Column (Name on top, Meta on bottom) */}
                    <View style={styles.accountMiddleCol}>
                      <Text
                        style={[styles.accountName, { color: theme.textPrimary }]}
                        numberOfLines={1}
                      >
                        {wallet.name}
                      </Text>

                      <View style={styles.metaRow}>
                        <Text style={[styles.accountAddress, { color: theme.textMuted }]}>
                          {ellipsify(wallet.address, 4)}
                        </Text>
                        <Text style={[styles.bulletDot, { color: theme.textMuted }]}>•</Text>
                        <Text
                          style={[
                            styles.modeTag,
                            { color: isVault ? theme.amberText : theme.textSecondary },
                          ]}
                        >
                          {isVault ? 'Vault (2-of-2)' : 'Everyday'}
                        </Text>
                      </View>
                    </View>

                    {/* Right Column (Balance on top, Status / Chevron on bottom) */}
                    <View style={styles.accountRightCol}>
                      {isSwitching ? (
                        <ActivityIndicator size="small" color={theme.accent} />
                      ) : (
                        <>
                          <Text style={[styles.balanceText, { color: theme.textPrimary }]}>
                            {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : '—'}
                          </Text>

                          {isActive ? (
                            <View
                              style={[
                                styles.activeBadge,
                                { backgroundColor: theme.accent, borderColor: theme.borderDefault },
                              ]}
                            >
                              <LucideCheck size={9} color={theme.accentForeground} />
                              <Text
                                style={[
                                  styles.activeBadgeText,
                                  { color: theme.accentForeground },
                                ]}
                              >
                                Active
                              </Text>
                            </View>
                          ) : (
                            <MaterialIcons
                              name="chevron-right"
                              size={16}
                              color={theme.textMuted}
                            />
                          )}
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                )
              })}

              {/* Add New Account Trigger */}
              <TouchableOpacity
                style={[
                  styles.addAccountBtn,
                  { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
                ]}
                onPress={handleStartCreate}
                activeOpacity={0.75}
              >
                <View
                  style={[
                    styles.addAccountIconBox,
                    { backgroundColor: theme.accentLight, borderColor: theme.borderSubtle },
                  ]}
                >
                  <MaterialIcons name="add" size={20} color={theme.textPrimary} />
                </View>
                <View style={styles.addAccountTextGroup}>
                  <Text style={[styles.addAccountTitle, { color: theme.textPrimary }]}>
                    Add New Account
                  </Text>
                  <Text style={[styles.addAccountSubtitle, { color: theme.textMuted }]}>
                    Configure security mode, limits, and hardware keys
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            /* ================================================================ */
            /* 2. RICH, TRANSPARENT ACCOUNT CREATION EXPERIENCE                */
            /* ================================================================ */
            <ScrollView
              style={styles.scrollList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Account Name */}
              <View style={styles.formGroup}>
                <Text style={[styles.inputLabel, { color: theme.textMuted }]}>ACCOUNT NAME</Text>
                <TextInput
                  style={[
                    styles.inputField,
                    {
                      backgroundColor: theme.bgElevated,
                      color: theme.textPrimary,
                      borderColor: theme.borderDefault,
                    },
                  ]}
                  value={newAccountName}
                  onChangeText={setNewAccountName}
                  placeholder="e.g., Savings Vault or Trading"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="words"
                  autoFocus={true}
                />
              </View>

              {/* Security Policy Selector Tiles */}
              <View style={styles.formGroup}>
                <Text style={[styles.inputLabel, { color: theme.textMuted }]}>SECURITY POLICY</Text>
                <View style={styles.modeCardsRow}>
                  {/* Everyday Mode Tile */}
                  <TouchableOpacity
                    style={[
                      styles.modeTile,
                      {
                        backgroundColor:
                          selectedMode === 'everyday' ? theme.bgElevated : theme.bgCard,
                        borderColor:
                          selectedMode === 'everyday' ? theme.accent : theme.borderSubtle,
                      },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync()
                      setSelectedMode('everyday')
                    }}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.modeTileIconBox,
                        { backgroundColor: theme.emeraldBg, borderColor: theme.emeraldBorder },
                      ]}
                    >
                      <LucideSmartphone size={18} color={theme.emeraldText} />
                    </View>
                    <Text style={[styles.modeTileTitle, { color: theme.textPrimary }]}>
                      Everyday Mode
                    </Text>
                    <Text style={[styles.modeTileDesc, { color: theme.textSecondary }]}>
                      Fast single-fingerprint biometrics. Ideal for daily micro-sends & dApps.
                    </Text>
                  </TouchableOpacity>

                  {/* Vault Mode Tile */}
                  <TouchableOpacity
                    style={[
                      styles.modeTile,
                      {
                        backgroundColor:
                          selectedMode === 'vault' ? theme.bgElevated : theme.bgCard,
                        borderColor:
                          selectedMode === 'vault' ? theme.accent : theme.borderSubtle,
                      },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync()
                      setSelectedMode('vault')
                    }}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.modeTileIconBox,
                        { backgroundColor: theme.amberBg, borderColor: theme.amberBorder },
                      ]}
                    >
                      <LucideShieldCheck size={18} color={theme.amberText} />
                    </View>
                    <Text style={[styles.modeTileTitle, { color: theme.textPrimary }]}>
                      Vault Mode (2-of-2)
                    </Text>
                    <Text style={[styles.modeTileDesc, { color: theme.textSecondary }]}>
                      Strict 2-of-2 hardware quorum with your Mac Secure Enclave for maximum cold security.
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Spending Limit Configuration (Everyday Mode Only) */}
              {selectedMode === 'everyday' && (
                <View style={styles.formGroup}>
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                    ONE-KEY BIOMETRIC THRESHOLD
                  </Text>
                  <View style={styles.thresholdChipsRow}>
                    {THRESHOLD_OPTIONS.map((val) => {
                      const isSelected = spendLimit === val
                      return (
                        <TouchableOpacity
                          key={val}
                          style={[
                            styles.thresholdChip,
                            {
                              backgroundColor: isSelected ? theme.accent : theme.bgElevated,
                              borderColor: isSelected ? theme.accent : theme.borderDefault,
                            },
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync()
                            setSpendLimit(val)
                          }}
                          activeOpacity={0.75}
                        >
                          <Text
                            style={[
                              styles.thresholdChipText,
                              { color: isSelected ? theme.accentForeground : theme.textPrimary },
                            ]}
                          >
                            {val} SOL
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  <Text style={[styles.fieldHint, { color: theme.textMuted }]}>
                    Transfers exceeding {spendLimit} SOL will automatically require 2-of-2 quorum.
                  </Text>
                </View>
              )}

              {/* Collapsible Advanced Settings */}
              <TouchableOpacity
                style={[
                  styles.advancedToggleBtn,
                  { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
                ]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setShowAdvanced((prev) => !prev)
                }}
                activeOpacity={0.8}
              >
                <View style={styles.advancedToggleLeft}>
                  <MaterialIcons name="tune" size={17} color={theme.textPrimary} />
                  <Text style={[styles.advancedToggleText, { color: theme.textPrimary }]}>
                    {showAdvanced ? 'Hide Advanced Settings' : 'Advanced Settings (Key Labels, Guardian)'}
                  </Text>
                </View>
                <MaterialIcons
                  name={showAdvanced ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={18}
                  color={theme.textMuted}
                />
              </TouchableOpacity>

              {showAdvanced && (
                <View style={styles.advancedGroup}>
                  {/* Primary Key Label */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      PRIMARY KEY LABEL
                    </Text>
                    <TextInput
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.bgElevated,
                          color: theme.textPrimary,
                          borderColor: theme.borderDefault,
                        },
                      ]}
                      value={primaryKeyLabel}
                      onChangeText={setPrimaryKeyLabel}
                      placeholder="e.g. Device Biometrics"
                      placeholderTextColor={theme.textMuted}
                    />
                  </View>

                  {/* Secondary Key Label */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      BACKUP / SECONDARY KEY LABEL
                    </Text>
                    <TextInput
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.bgElevated,
                          color: theme.textPrimary,
                          borderColor: theme.borderDefault,
                        },
                      ]}
                      value={secondaryKeyLabel}
                      onChangeText={setSecondaryKeyLabel}
                      placeholder="e.g. Mac Secure Enclave"
                      placeholderTextColor={theme.textMuted}
                    />
                  </View>

                  {/* Recovery Guardian Address */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      RECOVERY GUARDIAN ADDRESS (OPTIONAL)
                    </Text>
                    <TextInput
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.bgElevated,
                          color: theme.textPrimary,
                          borderColor:
                            guardianAddress.trim() && !isSolanaAddress(guardianAddress.trim())
                              ? theme.rose
                              : theme.borderDefault,
                        },
                      ]}
                      value={guardianAddress}
                      onChangeText={setGuardianAddress}
                      placeholder="Trusted Solana wallet address for recovery"
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {guardianAddress.trim() && !isSolanaAddress(guardianAddress.trim()) && (
                      <Text style={[styles.fieldError, { color: theme.roseText }]}>
                        Invalid Solana address
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* Hardware Biometric Notice */}
              <View
                style={[
                  styles.biometricNoticeBox,
                  { backgroundColor: theme.bgElevated, borderColor: theme.borderSubtle },
                ]}
              >
                <MaterialIcons name="fingerprint" size={20} color={theme.textPrimary} />
                <Text style={[styles.biometricNoticeText, { color: theme.textSecondary }]}>
                  Tapping "Create Account" will prompt your phone's fingerprint sensor to mint your
                  hardware-backed Secp256r1 passkey inside the secure enclave.
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.createActionsRow}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
                  ]}
                  onPress={handleCancelCreate}
                  disabled={isSubmittingCreate}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cancelBtnText, { color: theme.textSecondary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <View style={styles.submitBtnWrap}>
                  <PrismDepthButton
                    title={isSubmittingCreate ? 'Minting Passkey…' : 'Create with Biometrics'}
                    onPress={handleConfirmCreate}
                    disabled={isSubmittingCreate}
                    loading={isSubmittingCreate}
                  />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingTop: 10,
    maxHeight: '90%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.02,
  },
  subtitle: {
    fontSize: 12.5,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollList: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 16,
    gap: 12,
  },

  /* Card Layout: 3 Columns (Avatar, Middle, Right) */
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  accountAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountMiddleCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  accountName: {
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: -0.01,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  accountAddress: {
    fontFamily: 'JetBrains Mono',
    fontSize: 12,
  },
  bulletDot: {
    fontSize: 10,
  },
  modeTag: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  accountRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  balanceText: {
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.02,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },

  /* Add button */
  addAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 12,
    marginTop: 4,
  },
  addAccountIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addAccountTextGroup: {
    flex: 1,
  },
  addAccountTitle: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  addAccountSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },

  /* Form Elements */
  formGroup: {
    gap: 7,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.05,
  },
  inputField: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14.5,
    fontWeight: '500',
  },
  fieldHint: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  fieldError: {
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
  },

  /* Mode selection tiles */
  modeCardsRow: {
    gap: 10,
  },
  modeTile: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 4,
  },
  modeTileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  modeTileTitle: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  modeTileDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  /* Threshold Pills */
  thresholdChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  thresholdChip: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thresholdChipText: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* Advanced Accordion Toggle */
  advancedToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  advancedToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  advancedToggleText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  advancedGroup: {
    gap: 12,
    paddingTop: 4,
  },

  /* Biometric notice box */
  biometricNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  biometricNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },

  /* Form actions */
  createActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtnWrap: {
    flex: 1,
  },
})
