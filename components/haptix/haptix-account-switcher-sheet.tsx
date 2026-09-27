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

  const handleSelectMode = (mode: 'everyday' | 'vault') => {
    Haptics.selectionAsync()
    setSelectedMode(mode)
    const isDefaultEveryday = newAccountName.startsWith('Everyday Account')
    const isDefaultVault = newAccountName.startsWith('Hardware Vault')
    if (!newAccountName || isDefaultEveryday || isDefaultVault) {
      setNewAccountName(
        mode === 'vault'
          ? `Hardware Vault ${wallets.length + 1}`
          : `Everyday Account ${wallets.length + 1}`
      )
    }
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
                {isCreating ? 'Create account' : 'Smart Accounts'}
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                {isCreating
                  ? 'Configure security, policy, and hardware keys'
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
                          backgroundColor: theme.isDark ? '#201f1d' : '#F4F4F5',
                          borderColor: theme.isDark ? '#2a2a28' : '#E4E4E7',
                        },
                      ]}
                    >
                      {isVault ? (
                        <MaterialIcons name="security" size={18} color="#8a8985" />
                      ) : (
                        <MaterialIcons name="smartphone" size={18} color="#8a8985" />
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
                      <Text style={[styles.modeTag, { color: theme.textMuted }]}>
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
                              <MaterialIcons name="check" size={11} color={theme.accentForeground} />
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
              {/* Security policy */}
              <View style={styles.formGroup}>
                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Security policy</Text>
                <View style={styles.modeCardsRow}>
                  {/* Everyday Mode Tile */}
                  <TouchableOpacity
                    style={[
                      styles.modeTile,
                      {
                        backgroundColor:
                          selectedMode === 'everyday' ? (theme.isDark ? '#141418' : '#FAFAFA') : theme.bgCard,
                        borderColor:
                          selectedMode === 'everyday' ? theme.accent : theme.borderDefault,
                        borderWidth: selectedMode === 'everyday' ? 1.5 : 1,
                      },
                    ]}
                    onPress={() => handleSelectMode('everyday')}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.modeTileIconBox,
                        { backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
                      ]}
                    >
                      <MaterialIcons name="smartphone" size={18} color={theme.textPrimary} />
                    </View>
                    <Text style={[styles.modeTileTitle, { color: theme.textPrimary }]}>
                      Everyday mode
                    </Text>
                    <Text style={[styles.modeTileDesc, { color: theme.textSecondary }]}>
                      Fast single-fingerprint biometrics. Ideal for daily micro-sends and dApps.
                    </Text>
                  </TouchableOpacity>

                  {/* Vault Mode Tile */}
                  <TouchableOpacity
                    style={[
                      styles.modeTile,
                      {
                        backgroundColor:
                          selectedMode === 'vault' ? (theme.isDark ? '#141418' : '#FAFAFA') : theme.bgCard,
                        borderColor:
                          selectedMode === 'vault' ? theme.accent : theme.borderDefault,
                        borderWidth: selectedMode === 'vault' ? 1.5 : 1,
                      },
                    ]}
                    onPress={() => handleSelectMode('vault')}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.modeTileIconBox,
                        { backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
                      ]}
                    >
                      <MaterialIcons name="security" size={18} color={theme.textPrimary} />
                    </View>
                    <Text style={[styles.modeTileTitle, { color: theme.textPrimary }]}>
                      Vault mode, 2-of-2
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
                  <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                    One-key biometric threshold
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
                              backgroundColor: theme.isDark ? '#141418' : '#FAFAFA',
                              borderColor: isSelected ? theme.accent : theme.borderDefault,
                              borderWidth: isSelected ? 1.5 : 1,
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
                              {
                                color: isSelected ? theme.accent : theme.textPrimary,
                                fontWeight: isSelected ? '700' : '600',
                              },
                            ]}
                          >
                            {val}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                    Transfers exceeding {spendLimit} SOL will automatically require 2-of-2 quorum.
                  </Text>
                </View>
              )}

              {/* Collapsible Advanced Settings */}
              <TouchableOpacity
                style={[
                  styles.advancedToggleBtn,
                  { backgroundColor: theme.isDark ? '#141418' : '#FAFAFA', borderColor: theme.borderDefault },
                ]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setShowAdvanced((prev) => !prev)
                }}
                activeOpacity={0.8}
              >
                <View style={styles.advancedToggleLeft}>
                  <MaterialIcons name="tune" size={18} color={theme.textMuted} />
                  <Text style={[styles.advancedToggleText, { color: theme.textPrimary }]}>
                    Advanced settings, key labels, guardian
                  </Text>
                </View>
                <MaterialIcons
                  name={showAdvanced ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={20}
                  color={theme.textMuted}
                />
              </TouchableOpacity>

              {showAdvanced && (
                <View style={styles.advancedGroup}>
                  {/* Account Name */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      Account name
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
                      value={newAccountName}
                      onChangeText={setNewAccountName}
                      placeholder="e.g. Savings Vault or Trading"
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="words"
                    />
                  </View>

                  {/* Primary Key Label */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      Primary key label
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
                      Backup / secondary key label
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
                      Recovery guardian address (optional)
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
                  { backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.03)' : '#F8FAFC', borderColor: theme.borderSubtle },
                ]}
              >
                <MaterialIcons name="fingerprint" size={20} color={theme.textMuted} style={{ marginTop: 2 }} />
                <Text style={[styles.biometricNoticeText, { color: theme.textSecondary }]}>
                  Creating this account will prompt your fingerprint sensor to mint a hardware-backed Secp256r1 passkey inside the secure enclave.
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.createActionsRow}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    { backgroundColor: theme.isDark ? '#141418' : '#FAFAFA', borderColor: theme.borderDefault },
                  ]}
                  onPress={handleCancelCreate}
                  disabled={isSubmittingCreate}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cancelBtnText, { color: theme.textPrimary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.submitPrimaryBtn,
                    { backgroundColor: theme.accent },
                  ]}
                  onPress={handleConfirmCreate}
                  disabled={isSubmittingCreate}
                  activeOpacity={0.85}
                >
                  {isSubmittingCreate ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitPrimaryBtnText}>Create with biometrics</Text>
                  )}
                </TouchableOpacity>
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputField: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '500',
  },
  fieldHint: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 2,
    marginBottom: 14,
  },
  fieldError: {
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
  },

  /* Mode selection tiles */
  modeCardsRow: {
    gap: 12,
    marginBottom: 16,
  },
  modeTile: {
    padding: 16,
    borderRadius: 16,
    gap: 4,
  },
  modeTileIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  modeTileTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  modeTileDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  /* Threshold Pills */
  thresholdChipsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  thresholdChip: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thresholdChipText: {
    fontSize: 14,
  },

  /* Advanced Accordion Toggle */
  advancedToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 2,
    marginBottom: 14,
  },
  advancedToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  advancedToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  advancedGroup: {
    gap: 12,
    marginBottom: 14,
  },

  /* Biometric notice box */
  biometricNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 18,
  },
  biometricNoticeText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },

  /* Form actions */
  createActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  cancelBtn: {
    height: 50,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  submitPrimaryBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitPrimaryBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
})
