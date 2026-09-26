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
import { loadCachedBalance } from '@/utils/haptix-tx-history'
import { LucideShieldCheck, LucideSmartphone, LucideCheck } from './haptix-icons'
import { PrismDepthButton } from '@/components/ui'
import { radius, typeScale } from '@/theme/tokens'

interface HaptixAccountSwitcherSheetProps {
  visible: boolean
  onClose: () => void
}

export function HaptixAccountSwitcherSheet({ visible, onClose }: HaptixAccountSwitcherSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const { activeWallet, wallets, switchWallet, createWallet } = useAuth()

  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const [selectedMode, setSelectedMode] = useState<'everyday' | 'vault'>('everyday')
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
    setNewAccountName(selectedMode === 'vault' ? `Vault Account ${wallets.length + 1}` : `Account ${wallets.length + 1}`)
    setIsCreating(true)
  }

  const handleCancelCreate = () => {
    Haptics.selectionAsync()
    setIsCreating(false)
    setNewAccountName('')
  }

  const handleConfirmCreate = async () => {
    const finalName = newAccountName.trim() || (selectedMode === 'vault' ? 'Hardware Vault' : 'Everyday Account')
    try {
      setIsSubmittingCreate(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      await createWallet(finalName, {
        mode: selectedMode,
        spendThreshold: selectedMode === 'vault' ? 0.0 : 0.1,
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setIsCreating(false)
      setNewAccountName('')
      onClose()

      dialog.alert(
        'Account Created',
        `"${finalName}" is now active in ${selectedMode === 'vault' ? 'Vault (2-of-2 Hardware)' : 'Everyday'} mode.`,
        undefined,
        { status: 'success' },
      )
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
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
                {isCreating ? 'Create New Account' : 'Smart Accounts'}
              </Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                {isCreating
                  ? 'Backed by Apple/Android Hardware Passkeys'
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
            /* --- 1. ACCOUNT LIST VIEW --- */
            <ScrollView
              style={styles.scrollList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {wallets.map((wallet) => {
                const isActive = wallet.address === activeWallet?.address
                const isSwitching = switchingTo === wallet.address
                const isVault = wallet.securityMode === 'vault'
                const balance = balances[wallet.address]

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

                    {/* Middle Info */}
                    <View style={styles.accountInfo}>
                      <View style={styles.nameRow}>
                        <Text
                          style={[styles.accountName, { color: theme.textPrimary }]}
                          numberOfLines={1}
                        >
                          {wallet.name}
                        </Text>
                        {isActive && (
                          <View
                            style={[
                              styles.activeChip,
                              { backgroundColor: theme.accent, borderColor: theme.borderDefault },
                            ]}
                          >
                            <LucideCheck size={10} color={theme.accentForeground} />
                            <Text style={[styles.activeChipText, { color: theme.accentForeground }]}>
                              Active
                            </Text>
                          </View>
                        )}
                      </View>

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
                          {isVault ? '2-of-2 Vault' : 'Everyday'}
                        </Text>
                      </View>
                    </View>

                    {/* Right: Balance / Switching Spinner */}
                    <View style={styles.accountTrailing}>
                      {isSwitching ? (
                        <ActivityIndicator size="small" color={theme.accent} />
                      ) : (
                        <View style={styles.balanceCol}>
                          {balance !== undefined ? (
                            <Text style={[styles.balanceText, { color: theme.textPrimary }]}>
                              {balance.toFixed(3)} SOL
                            </Text>
                          ) : null}
                          <MaterialIcons
                            name={isActive ? 'check' : 'chevron-right'}
                            size={18}
                            color={isActive ? theme.accent : theme.textMuted}
                          />
                        </View>
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
                    Create an Everyday or Hardware Vault account
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            /* --- 2. CREATE ACCOUNT FORM --- */
            <View style={styles.createFormContainer}>
              {/* Account Name Field */}
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
                  placeholder="e.g. Savings Vault or Trading"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="words"
                  autoFocus={true}
                />
              </View>

              {/* Mode Selection Tiles */}
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
                      Fast 1-fingerprint biometrics up to 0.1 SOL. Ideal for daily sends & dApps.
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
                      Vault Mode
                    </Text>
                    <Text style={[styles.modeTileDesc, { color: theme.textSecondary }]}>
                      2-of-2 multisig with your Mac Secure Enclave. Ultra-secure for savings.
                    </Text>
                  </TouchableOpacity>
                </View>
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
                    Back
                  </Text>
                </TouchableOpacity>

                <View style={styles.submitBtnWrap}>
                  <PrismDepthButton
                    title={isSubmittingCreate ? 'Generating Passkey…' : 'Create Account'}
                    onPress={handleConfirmCreate}
                    disabled={isSubmittingCreate}
                    loading={isSubmittingCreate}
                  />
                </View>
              </View>
            </View>
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
    maxHeight: '85%',
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
    gap: 10,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  accountAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.01,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  activeChipText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
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
  accountTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  balanceCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  balanceText: {
    fontFamily: 'JetBrains Mono',
    fontSize: 12.5,
    fontWeight: '600',
  },
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
  createFormContainer: {
    paddingHorizontal: 20,
    paddingTop: 4,
    gap: 16,
  },
  formGroup: {
    gap: 8,
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
    fontSize: 15,
    fontWeight: '500',
  },
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
