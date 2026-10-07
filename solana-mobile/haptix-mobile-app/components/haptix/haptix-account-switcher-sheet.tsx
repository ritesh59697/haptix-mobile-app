import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  Animated,
  PanResponder,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import * as Haptics from 'expo-haptics'
import { Keypair } from '@solana/web3.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Buffer } from 'buffer'
import { useAuth } from '@/components/auth/auth-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { ellipsify } from '@/utils/ellipsify'
import { parseGuardianAddress } from '@/utils/haptix-client'
import { isSolanaAddress } from '@/utils/solana-address'
import { loadCachedBalance } from '@/utils/haptix-tx-history'
import Clipboard from '@/utils/clipboard'
import { radius, typeScale } from '@/theme/tokens'
import { getDevnetFunderPublicKey, isDevnetFunder } from '@/utils/haptix-funder'
import { useCluster, ClusterNetwork } from '@/components/cluster/cluster-provider'
import { HaptixWalletCreatedContent } from '@/components/haptix/haptix-wallet-created-sheet'
import { AppConfig } from '@/constants/app-config'

interface HaptixAccountSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  isBalanceHidden?: boolean
}

export function HaptixAccountSwitcherSheet({ visible, onClose, isBalanceHidden }: HaptixAccountSwitcherSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const { activeWallet, wallets, switchWallet, createWallet, removeAccount } = useAuth()
  const { selectedCluster } = useCluster()
  const network = selectedCluster?.network === ClusterNetwork.Mainnet ? 'mainnet' : 'devnet'

  const listScrollRef = useRef<ScrollView>(null)
  const createScrollRef = useRef<ScrollView>(null)

  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [creationStep, setCreationStep] = useState<0 | 1 | 2 | 3>(0)
  const [isManageMode, setIsManageMode] = useState(false)

  // Account creation form state
  const [newAccountName, setNewAccountName] = useState('')
  const [selectedMode, setSelectedMode] = useState<'everyday' | 'vault'>('everyday')
  const [createdAccount, setCreatedAccount] = useState<{
    name: string
    address: string
    securityMode: 'everyday' | 'vault'
    spendThreshold: number
  } | null>(null)
  const [vaultKeySource, setVaultKeySource] = useState<'mac' | 'hardware'>('mac')
  const [macVaultKeyHex, setMacVaultKeyHex] = useState('')
  const [copiedVaultUrl, setCopiedVaultUrl] = useState(false)
  const [isVaultInputFocused, setIsVaultInputFocused] = useState(false)
  const [isGuardianInputFocused, setIsGuardianInputFocused] = useState(false)

  const cleanVaultHex = useMemo(() => {
    const raw = macVaultKeyHex.trim()
    return raw.startsWith('0x') ? raw.slice(2) : raw
  }, [macVaultKeyHex])

  const isValidVaultHex = useMemo(() => {
    return cleanVaultHex.length === 66 && (cleanVaultHex.startsWith('02') || cleanVaultHex.startsWith('03'))
  }, [cleanVaultHex])

  // Advanced settings state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [primaryKeyLabel, setPrimaryKeyLabel] = useState('')
  const [secondaryKeyLabel, setSecondaryKeyLabel] = useState('')
  const [guardianAddress, setGuardianAddress] = useState('')

  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [balances, setBalances] = useState<Record<string, number>>({})

  // Fluid pull-down gesture to dismiss bottom sheet
  const panY = useRef(new Animated.Value(0)).current

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 4,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            panY.setValue(gestureState.dy)
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.8) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { })
            Animated.timing(panY, {
              toValue: 600,
              duration: 220,
              useNativeDriver: true,
            }).start(() => {
              panY.setValue(0)
              onClose()
            })
          } else {
            Animated.spring(panY, {
              toValue: 0,
              bounciness: 4,
              useNativeDriver: true,
            }).start()
          }
        },
      }),
    [onClose, panY],
  )

  useEffect(() => {
    if (!visible) {
      panY.setValue(0)
      setCreatedAccount(null)
      setIsManageMode(false)
    }
  }, [visible, panY])

  useEffect(() => {
    if (wallets.length <= 1 && isManageMode) {
      setIsManageMode(false)
    }
  }, [wallets.length, isManageMode])

  // Load balances for all accounts
  useEffect(() => {
    if (!visible) return
    let mounted = true
    async function fetchBalances() {
      const results: Record<string, number> = {}
      for (const w of wallets) {
        try {
          const cached = await loadCachedBalance(w.address, network)
          if (cached !== null) {
            results[w.address] = cached
          }
        } catch { }
      }
      if (mounted) setBalances(results)
    }
    fetchBalances()
    return () => {
      mounted = false
    }
  }, [visible, wallets, network])

  // Reset scroll to top whenever the sheet opens
  useEffect(() => {
    if (visible) {
      listScrollRef.current?.scrollTo({ y: 0, animated: false })
      createScrollRef.current?.scrollTo({ y: 0, animated: false })
    }
  }, [visible])

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
    setIsManageMode(false)
    setSelectedMode('everyday')
    const defaultName = `Everyday Account ${wallets.length + 1}`
    setNewAccountName(defaultName)
    setVaultKeySource('mac')
    setMacVaultKeyHex('')
    setPrimaryKeyLabel('Device Biometrics (Primary)')
    setSecondaryKeyLabel('Device Biometrics (Backup)')
    setGuardianAddress('')
    setShowAdvanced(false)
    setIsCreating(true)
    setTimeout(() => {
      createScrollRef.current?.scrollTo({ y: 0, animated: false })
    }, 30)
  }

  const handlePromptRemove = (wallet: (typeof wallets)[0]) => {
    const rawLamports = balances[wallet.address]
    const solBalance =
      rawLamports !== undefined && rawLamports !== null ? rawLamports / 1e9 : 0
    const hasFunds = solBalance > 0.0001
    const isActive = wallet.address === activeWallet?.address

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    dialog.alert(
      `Remove "${wallet.name}"?`,
      hasFunds
        ? `This wallet holds ${solBalance.toFixed(4)} SOL ($${(solBalance * 120.7).toFixed(2)}). Its passkey will be removed from this phone.\n\nMake sure your recovery guardian or backup keys are saved before proceeding.`
        : `This passkey will be removed from this phone. Nothing is deleted on-chain, and you can re-import this passkey anytime.${
            isActive ? '\n\nThe app will automatically switch to your next account.' : ''
          }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Wallet',
          style: 'destructive',
          onPress: async () => {
            try {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
              await removeAccount(wallet.address)
            } catch (err: any) {
              dialog.alert('Removal Failed', err?.message || 'Could not remove wallet.')
            }
          },
        },
      ],
      {
        status: 'error',
        icon: 'delete-outline',
      },
    )
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
    if (mode === 'vault') {
      setSecondaryKeyLabel(
        vaultKeySource === 'mac'
          ? 'Second Device (Vault Key)'
          : 'Vault Key (Security Key)'
      )
    } else {
      setSecondaryKeyLabel('Device Biometrics (Backup)')
    }
  }

  const handleSelectVaultSource = (source: 'mac' | 'hardware') => {
    Haptics.selectionAsync()
    setVaultKeySource(source)
    if (selectedMode === 'vault') {
      setSecondaryKeyLabel(
        source === 'mac'
          ? 'Second Device (Vault Key)'
          : 'Vault Key (Security Key)'
      )
    }
  }

  const handleCancelCreate = () => {
    if (creationStep > 0) return
    Haptics.selectionAsync()
    Keyboard.dismiss()
    setIsCreating(false)
    setCreationStep(0)
    setNewAccountName('')
    setMacVaultKeyHex('')
    setShowAdvanced(false)
    setTimeout(() => {
      listScrollRef.current?.scrollTo({ y: 0, animated: false })
    }, 30)
  }

  const handleConfirmCreate = async () => {
    Keyboard.dismiss()
    const finalName =
      newAccountName.trim() ||
      (selectedMode === 'vault' ? 'Hardware Vault' : 'Everyday Account')

    let parsedGuardian = parseGuardianAddress(guardianAddress)
    if (!parsedGuardian) {
      if (guardianAddress.trim()) {
        setShowAdvanced(true)
        dialog.alert(
          'Invalid Guardian Address',
          'That is not a valid Solana address. Please enter a valid 32-byte public key or leave blank to auto-generate.',
          undefined,
          { status: 'warning' },
        )
        return
      }
      const autoKeypair = Keypair.generate()
      parsedGuardian = autoKeypair.publicKey
      try {
        await AsyncStorage.setItem(
          `@haptix_auto_guardian_${autoKeypair.publicKey.toBase58()}`,
          Buffer.from(autoKeypair.secretKey).toString('hex'),
        )
      } catch (e) {
        console.warn('[Haptix] Failed to store auto guardian:', e)
      }
    } else if (isDevnetFunder(parsedGuardian)) {
      setShowAdvanced(true)
      dialog.alert(
        'Independent Guardian Required',
        'The recovery guardian cannot be a key held by this app or the devnet funder. Please enter an independent external address (e.g. Phantom, Solflare), or leave blank to auto-generate.',
        undefined,
        { status: 'warning' },
      )
      return
    }

    if (selectedMode === 'vault' && vaultKeySource === 'mac') {
      const cleanHex = macVaultKeyHex.trim().startsWith('0x')
        ? macVaultKeyHex.trim().slice(2)
        : macVaultKeyHex.trim()
      if (!cleanHex || cleanHex.length !== 66 || (!cleanHex.startsWith('02') && !cleanHex.startsWith('03'))) {
        dialog.alert(
          'Second Device Public Key Required',
          `Please open ${AppConfig.vaultWebUrl} on your second device (laptop, tablet, or 2nd phone), tap "Enroll", and paste the 33-byte public key hex below.`,
          undefined,
          { status: 'warning' },
        )
        return
      }
    }

    try {
      setIsSubmittingCreate(true)
      setCreationStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      const newAccount = await createWallet(finalName, {
        mode: selectedMode,
        spendThreshold: selectedMode === 'vault' ? 0.0 : 0.1,
        primaryLabel: primaryKeyLabel.trim() || undefined,
        secondaryLabel: secondaryKeyLabel.trim() || undefined,
        guardianAddress: parsedGuardian.toBase58(),
        vaultKeySource: selectedMode === 'vault' ? vaultKeySource : undefined,
        macVaultKeyHex:
          selectedMode === 'vault' && vaultKeySource === 'mac'
            ? (macVaultKeyHex.trim().startsWith('0x') ? macVaultKeyHex.trim().slice(2) : macVaultKeyHex.trim())
            : undefined,
        onProgress: (step) => setCreationStep(step),
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setIsCreating(false)
      setCreationStep(0)
      setNewAccountName('')
      setMacVaultKeyHex('')
      setShowAdvanced(false)

      setCreatedAccount({
        name: finalName,
        address: newAccount.address,
        securityMode: selectedMode,
        spendThreshold: selectedMode === 'vault' ? 0.0 : 0.1,
      })
    } catch (err: any) {
      setCreationStep(0)
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
      setCreationStep(0)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bgCard,
              borderColor: theme.isDark ? '#222226' : theme.borderDefault,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
              transform: [{ translateY: panY }],
            },
          ]}
        >
          {/* Top Drag Handle */}
          <View style={styles.dragHandleTouchZone} {...panResponder.panHandlers}>
            <View style={[styles.dragHandle, { backgroundColor: theme.isDark ? '#3a3a37' : '#D1D1D6' }]} />
          </View>

          {createdAccount ? (
            <HaptixWalletCreatedContent
              walletName={createdAccount.name}
              walletAddress={createdAccount.address}
              securityMode={createdAccount.securityMode}
              spendThreshold={createdAccount.spendThreshold}
              showHandle={false}
              onClose={() => {
                setCreatedAccount(null)
                onClose()
              }}
            />
          ) : (
            <>
              {/* Header */}
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: theme.textPrimary }]}>
                    {creationStep > 0
                      ? 'Create wallet'
                      : isCreating
                      ? 'Create wallet'
                      : isManageMode
                      ? 'Manage accounts'
                      : 'Smart Accounts'}
                  </Text>
                  <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                    {creationStep > 0
                      ? 'Registering biometric credentials on-chain...'
                      : isCreating
                      ? 'Choose your security model and customize passkey names.'
                      : isManageMode
                      ? 'Remove unwanted passkeys from this device'
                      : `${wallets.length} ${wallets.length === 1 ? 'account' : 'accounts'} on this device`}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {!isCreating && wallets.length > 1 && (
                    <TouchableOpacity
                      style={[
                        styles.editBtn,
                        {
                          backgroundColor: isManageMode
                            ? (theme.isDark ? '#2A2A2E' : '#E0E0E6')
                            : (theme.isDark ? '#1C1C1E' : '#EFEFF0'),
                        },
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setIsManageMode((prev) => !prev)
                      }}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text
                        style={[
                          styles.editBtnText,
                          { color: isManageMode ? '#6C8CFF' : theme.textPrimary },
                        ]}
                      >
                        {isManageMode ? 'Done' : 'Edit'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.closeBtn, { backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0' }]}
                    onPress={isCreating ? handleCancelCreate : onClose}
                    disabled={creationStep > 0}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Close"
                  >
                    <MaterialIcons
                      name="close"
                      size={18}
                      color={creationStep > 0 ? theme.textMuted : theme.textPrimary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

          {!isCreating ? (
            /* ================================================================ */
            /* 1. ACCOUNT LIST VIEW (ELEVATED NEUTRAL SURFACES)                 */
            /* ================================================================ */
            <ScrollView
              key="account-list-scroll"
              ref={listScrollRef}
              style={styles.scrollList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
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
                        backgroundColor: isActive
                          ? (theme.isDark ? '#1C1C1E' : '#EFEFF0')
                          : theme.bgCard,
                        borderColor: isActive
                          ? (theme.isDark ? 'rgba(79, 107, 255, 0.45)' : '#6C8CFF')
                          : (theme.isDark ? '#222226' : theme.borderSubtle),
                        borderWidth: isActive ? 1.5 : 1,
                      },
                    ]}
                    onPress={() => {
                      if (isManageMode) {
                        handlePromptRemove(wallet)
                      } else {
                        handleSelectAccount(wallet.address)
                      }
                    }}
                    activeOpacity={0.75}
                    disabled={isSwitching}
                  >
                    {/* Left Icon Badge */}
                    <View
                      style={[
                        styles.accountAvatar,
                        {
                          backgroundColor: theme.isDark ? '#26262A' : '#E5E5EA',
                        },
                      ]}
                    >
                      {isVault ? (
                        <MaterialCommunityIcons name="safe" size={18} color={theme.textPrimary} />
                      ) : (
                        <MaterialIcons name="smartphone" size={18} color={theme.textPrimary} />
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

                    {/* Right Column (Balance or Trash button in Manage Mode) */}
                    {isManageMode ? (
                      <TouchableOpacity
                        style={[
                          styles.removeTrashBtn,
                          {
                            backgroundColor: theme.isDark ? 'rgba(255, 69, 58, 0.15)' : '#FEECEB',
                          },
                        ]}
                        onPress={() => handlePromptRemove(wallet)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={`Remove ${wallet.name}`}
                      >
                        <MaterialIcons name="delete-outline" size={20} color="#FF453A" />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.accountRightCol}>
                        {isSwitching ? (
                          <ActivityIndicator size="small" color={theme.accent} />
                        ) : (
                          <>
                            <Text style={[styles.balanceText, { color: theme.textPrimary }]}>
                              {solBalance !== null ? (isBalanceHidden ? '•••• SOL' : `${solBalance.toFixed(4)} SOL`) : '—'}
                            </Text>

                            {isActive ? (
                              <View style={styles.activeBadge}>
                                <MaterialIcons name="check" size={11} color="#FFFFFF" />
                                <Text style={styles.activeBadgeText}>Active</Text>
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
                    )}
                  </TouchableOpacity>
                )
              })}

              {/* Add New Account Trigger (Solid Elevated Surface, No Dashes) */}
              {!isManageMode && (
                <TouchableOpacity
                  style={[
                    styles.addAccountBtn,
                    {
                      backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                    },
                  ]}
                  onPress={handleStartCreate}
                  activeOpacity={0.75}
                >
                  <View
                    style={[
                      styles.addAccountIconBox,
                      { backgroundColor: theme.isDark ? '#26262A' : '#E0E0E6' },
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
              )}
            </ScrollView>
          ) : creationStep > 0 ? (
            /* ================================================================ */
            /* 2. CREATION STEP PROGRESS ANIMATION                              */
            /* ================================================================ */
            <View style={styles.creationProgressContainer}>
              <ActivityIndicator size="large" color="#4F6BFF" style={{ marginBottom: 28 }} />
              <View style={styles.modalStepRow}>
                <MaterialIcons
                  name={creationStep > 1 ? 'check-circle' : 'radio-button-unchecked'}
                  size={24}
                  color={creationStep > 1 ? '#10B981' : theme.textMuted}
                />
                <Text
                  style={[
                    styles.modalStepText,
                    {
                      color: creationStep > 1 ? (theme.isDark ? '#F4F4F5' : '#111827') : theme.textPrimary,
                      fontWeight: creationStep === 1 ? '600' : '500',
                    },
                  ]}
                >
                  Creating {primaryKeyLabel.trim() || 'Primary Passkey'}...
                </Text>
              </View>
              <View style={styles.modalStepRow}>
                <MaterialIcons
                  name={creationStep > 2 ? 'check-circle' : 'radio-button-unchecked'}
                  size={24}
                  color={creationStep > 2 ? '#10B981' : theme.textMuted}
                />
                <Text
                  style={[
                    styles.modalStepText,
                    {
                      color: creationStep > 2
                        ? (theme.isDark ? '#F4F4F5' : '#111827')
                        : creationStep === 2
                        ? theme.textPrimary
                        : theme.textMuted,
                      fontWeight: creationStep === 2 ? '600' : '500',
                    },
                  ]}
                >
                  {selectedMode === 'vault'
                    ? `Pairing ${secondaryKeyLabel.trim() || (vaultKeySource === 'mac' ? 'Second Device' : 'Vault Key')} (Cross-Device)...`
                    : `Creating ${secondaryKeyLabel.trim() || 'Backup Key'}...`}
                </Text>
              </View>
              <View style={styles.modalStepRow}>
                <MaterialIcons
                  name={creationStep > 2 ? 'check-circle' : 'radio-button-unchecked'}
                  size={24}
                  color={creationStep > 2 ? '#10B981' : theme.textMuted}
                />
                <Text
                  style={[
                    styles.modalStepText,
                    {
                      color: creationStep === 3 ? theme.textPrimary : theme.textMuted,
                      fontWeight: creationStep === 3 ? '600' : '500',
                    },
                  ]}
                >
                  Finalizing Smart Account...
                </Text>
              </View>
            </View>
          ) : (
            /* ================================================================ */
            /* 3. RICH, TRANSPARENT ACCOUNT CREATION EXPERIENCE                */
            /* ================================================================ */
            <ScrollView
              key="account-create-scroll"
              ref={createScrollRef}
              style={styles.scrollList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: 24 },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {/* Security policy */}
              <View style={styles.formGroup}>
                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Security architecture</Text>
                <View style={styles.modeCardsRow}>
                  {/* Everyday Mode Card */}
                  <TouchableOpacity
                    style={[
                      styles.modeCard,
                      {
                        backgroundColor:
                          selectedMode === 'everyday'
                            ? (theme.isDark ? '#1C1C1E' : '#FFFFFF')
                            : (theme.isDark ? '#141416' : '#F5F5F7'),
                        borderColor:
                          selectedMode === 'everyday' ? '#5E81FF' : (theme.isDark ? '#26262A' : theme.borderSubtle),
                        borderWidth: selectedMode === 'everyday' ? 1.5 : 1,
                      },
                    ]}
                    onPress={() => handleSelectMode('everyday')}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.modeCardIconBox,
                        {
                          backgroundColor:
                            selectedMode === 'everyday'
                              ? (theme.isDark ? 'rgba(94, 129, 255, 0.16)' : 'rgba(94, 129, 255, 0.10)')
                              : (theme.isDark ? '#222226' : '#E5E5EA'),
                        },
                      ]}
                    >
                      <MaterialIcons
                        name="smartphone"
                        size={19}
                        color={selectedMode === 'everyday' ? '#5E81FF' : theme.textPrimary}
                      />
                    </View>
                    <View style={styles.modeCardTextCol}>
                      <Text style={[styles.modeCardTitle, { color: theme.textPrimary }]}>
                        Everyday mode
                      </Text>
                      <Text style={[styles.modeCardDesc, { color: theme.textSecondary }]}>
                        Both keys on this device
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.radioOuter,
                        {
                          borderColor:
                            selectedMode === 'everyday' ? '#5E81FF' : (theme.isDark ? '#3A3A3C' : '#D1D1D6'),
                        },
                      ]}
                    >
                      {selectedMode === 'everyday' && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>

                  {/* Vault Mode Card */}
                  <TouchableOpacity
                    style={[
                      styles.modeCard,
                      {
                        backgroundColor:
                          selectedMode === 'vault'
                            ? (theme.isDark ? '#1C1C1E' : '#FFFFFF')
                            : (theme.isDark ? '#141416' : '#F5F5F7'),
                        borderColor:
                          selectedMode === 'vault' ? '#5E81FF' : (theme.isDark ? '#26262A' : theme.borderSubtle),
                        borderWidth: selectedMode === 'vault' ? 1.5 : 1,
                      },
                    ]}
                    onPress={() => handleSelectMode('vault')}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.modeCardIconBox,
                        {
                          backgroundColor:
                            selectedMode === 'vault'
                              ? (theme.isDark ? 'rgba(94, 129, 255, 0.16)' : 'rgba(94, 129, 255, 0.10)')
                              : (theme.isDark ? '#222226' : '#E5E5EA'),
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="safe"
                        size={19}
                        color={selectedMode === 'vault' ? '#5E81FF' : theme.textPrimary}
                      />
                    </View>
                    <View style={styles.modeCardTextCol}>
                      <Text style={[styles.modeCardTitle, { color: theme.textPrimary }]}>
                        Vault mode
                      </Text>
                      <Text style={[styles.modeCardDesc, { color: theme.textSecondary }]}>
                        Key 2 on laptop or OneKey
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.radioOuter,
                        {
                          borderColor:
                            selectedMode === 'vault' ? '#5E81FF' : (theme.isDark ? '#3A3A3C' : '#D1D1D6'),
                        },
                      ]}
                    >
                      {selectedMode === 'vault' && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Vault Mode Device Selection & Enrollment */}
              {selectedMode === 'vault' && (
                <View style={{ marginBottom: 14 }}>
                  <View
                    style={[
                      styles.vaultExplainerBox,
                      {
                        backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                        borderColor: theme.isDark ? '#222226' : theme.borderSubtle,
                      },
                    ]}
                  >
                    <MaterialIcons name="info-outline" size={16} color="#6C8CFF" style={{ marginTop: 2 }} />
                    <Text style={[styles.vaultExplainerText, { color: theme.textSecondary }]}>
                      <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Vault mode</Text>: daily spends use fingerprint on this phone. Sends above your limit will require approval on your second device (laptop, 2nd phone, or tablet).
                    </Text>
                  </View>

                  <Text style={[styles.sectionLabel, { color: theme.textMuted, marginTop: 14, marginBottom: 8 }]}>
                    Vault key device
                  </Text>
                  <View style={styles.vaultDeviceRow}>
                    <TouchableOpacity
                      onPress={() => handleSelectVaultSource('mac')}
                      style={[
                        styles.vaultDeviceCard,
                        {
                          backgroundColor:
                            vaultKeySource === 'mac'
                              ? (theme.isDark ? '#1C1C1E' : '#FFFFFF')
                              : (theme.isDark ? '#141416' : '#F5F5F7'),
                          borderColor:
                            vaultKeySource === 'mac' ? '#4F6BFF' : (theme.isDark ? '#222226' : theme.borderSubtle),
                          borderWidth: vaultKeySource === 'mac' ? 1.5 : 1,
                        },
                      ]}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons
                        name="devices"
                        size={19}
                        color={vaultKeySource === 'mac' ? '#4F6BFF' : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.vaultDeviceText,
                          {
                            color: vaultKeySource === 'mac' ? '#4F6BFF' : theme.textPrimary,
                            fontWeight: vaultKeySource === 'mac' ? '700' : '600',
                          },
                        ]}
                      >
                        Second Device
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleSelectVaultSource('hardware')}
                      style={[
                        styles.vaultDeviceCard,
                        {
                          backgroundColor:
                            vaultKeySource === 'hardware'
                              ? (theme.isDark ? '#1C1C1E' : '#FFFFFF')
                              : (theme.isDark ? '#141416' : '#F5F5F7'),
                          borderColor:
                            vaultKeySource === 'hardware' ? '#4F6BFF' : (theme.isDark ? '#222226' : theme.borderSubtle),
                          borderWidth: vaultKeySource === 'hardware' ? 1.5 : 1,
                        },
                      ]}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons
                        name="usb"
                        size={19}
                        color={vaultKeySource === 'hardware' ? '#4F6BFF' : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.vaultDeviceText,
                          {
                            color: vaultKeySource === 'hardware' ? '#4F6BFF' : theme.textPrimary,
                            fontWeight: vaultKeySource === 'hardware' ? '700' : '600',
                          },
                        ]}
                      >
                        USB / NFC key
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {vaultKeySource === 'mac' ? (
                    <View
                      style={[
                        styles.macVaultBox,
                        {
                          backgroundColor: theme.isDark ? '#18181B' : '#F8FAFC',
                          borderColor: theme.isDark ? '#27272A' : '#E2E8F0',
                        },
                      ]}
                    >
                      {/* Step 1 Header */}
                      <View style={styles.macVaultStepHeader}>
                        <View
                          style={[
                            styles.macVaultStepBadge,
                            { backgroundColor: theme.isDark ? 'rgba(79, 107, 255, 0.2)' : 'rgba(79, 107, 255, 0.12)' },
                          ]}
                        >
                          <Text style={styles.macVaultStepBadgeText}>1</Text>
                        </View>
                        <Text style={[styles.macVaultStepTitle, { color: theme.isDark ? '#F4F4F5' : '#1E293B' }]}>
                          Open on laptop or second phone browser
                        </Text>
                      </View>

                      {/* Step 1 URL Box */}
                      <View
                        style={[
                          styles.macVaultUrlWrap,
                          {
                            backgroundColor: theme.isDark ? '#101012' : '#FFFFFF',
                            borderColor: theme.isDark ? '#27272F' : '#CBD5E1',
                          },
                        ]}
                      >
                        <View style={styles.macVaultUrlLeft}>
                          <MaterialIcons name="link" size={16} color="#4F6BFF" style={{ marginRight: 6 }} />
                          <Text
                            style={[styles.macVaultUrlText, { color: theme.isDark ? '#93C5FD' : '#2563EB' }]}
                            numberOfLines={1}
                            ellipsizeMode="middle"
                          >
                            {AppConfig.vaultWebUrl}
                          </Text>
                        </View>
                        <View style={styles.macVaultUrlActions}>
                          <TouchableOpacity
                            style={[
                              styles.macVaultActionBtn,
                              {
                                backgroundColor: copiedVaultUrl
                                  ? (theme.isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5')
                                  : (theme.isDark ? '#222228' : '#F1F5F9'),
                              },
                            ]}
                            onPress={async () => {
                              await Clipboard.setString(AppConfig.vaultWebUrl)
                              setCopiedVaultUrl(true)
                              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                              setTimeout(() => setCopiedVaultUrl(false), 2000)
                            }}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons
                              name={copiedVaultUrl ? 'check' : 'content-copy'}
                              size={13}
                              color={copiedVaultUrl ? '#10B981' : (theme.isDark ? '#D4D4D8' : '#475569')}
                              style={{ marginRight: 3 }}
                            />
                            <Text
                              style={[
                                styles.macVaultActionBtnText,
                                { color: copiedVaultUrl ? '#10B981' : (theme.isDark ? '#D4D4D8' : '#475569') },
                              ]}
                            >
                              {copiedVaultUrl ? 'Copied' : 'Copy'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.macVaultActionBtn,
                              { backgroundColor: theme.isDark ? 'rgba(79, 107, 255, 0.16)' : '#EFF6FF' },
                            ]}
                            onPress={() => Linking.openURL(AppConfig.vaultWebUrl)}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons name="open-in-new" size={13} color="#4F6BFF" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Step 2 Header */}
                      <View style={[styles.macVaultStepHeader, { marginTop: 14 }]}>
                        <View
                          style={[
                            styles.macVaultStepBadge,
                            { backgroundColor: theme.isDark ? 'rgba(79, 107, 255, 0.2)' : 'rgba(79, 107, 255, 0.12)' },
                          ]}
                        >
                          <Text style={styles.macVaultStepBadgeText}>2</Text>
                        </View>
                        <Text style={[styles.macVaultStepTitle, { color: theme.isDark ? '#F4F4F5' : '#1E293B' }]}>
                          Tap "Enroll" on that device, then paste key below
                        </Text>
                      </View>

                      {/* Step 2 Key Input Container */}
                      <View
                        style={[
                          styles.macKeyInputContainer,
                          {
                            backgroundColor: theme.isDark ? '#101012' : '#FFFFFF',
                            borderColor: isValidVaultHex
                              ? '#10B981'
                              : isVaultInputFocused
                              ? '#4F6BFF'
                              : (theme.isDark ? '#33333E' : '#94A3B8'),
                            borderWidth: (isVaultInputFocused || isValidVaultHex) ? 2 : 1.5,
                          },
                        ]}
                      >
                        <TextInput
                          style={[
                            styles.macKeyInput,
                            {
                              color: theme.isDark ? '#FFFFFF' : '#0F172A',
                              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                            },
                          ]}
                          value={macVaultKeyHex}
                          onChangeText={setMacVaultKeyHex}
                          onFocus={() => setIsVaultInputFocused(true)}
                          onBlur={() => setIsVaultInputFocused(false)}
                          placeholder="33-byte public key (02...)"
                          placeholderTextColor={theme.isDark ? '#71717A' : '#64748B'}
                          autoCapitalize="none"
                          autoCorrect={false}
                          multiline={false}
                          numberOfLines={1}
                          textAlignVertical="center"
                        />
                        {cleanVaultHex.length > 0 ? (
                          <View style={styles.keyActionRow}>
                            {isValidVaultHex ? (
                              <View
                                style={[
                                  styles.validKeyBadge,
                                  { backgroundColor: theme.isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5' },
                                ]}
                              >
                                <MaterialIcons name="check" size={12} color="#10B981" />
                                <Text style={styles.validKeyText}>Valid</Text>
                              </View>
                            ) : null}
                            <TouchableOpacity
                              style={styles.clearKeyBtn}
                              onPress={() => {
                                setMacVaultKeyHex('')
                                Haptics.selectionAsync()
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <MaterialIcons name="cancel" size={18} color={theme.isDark ? '#71717A' : '#94A3B8'} />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.macPasteBadgeButton,
                              {
                                backgroundColor: theme.isDark ? 'rgba(79, 107, 255, 0.18)' : '#EEF2FF',
                                borderColor: theme.isDark ? 'rgba(79, 107, 255, 0.3)' : '#C7D2FE',
                              },
                            ]}
                            onPress={async () => {
                              const text = await Clipboard.getString()
                              if (text) {
                                const clean = text.trim().startsWith('0x') ? text.trim().slice(2) : text.trim()
                                setMacVaultKeyHex(clean)
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                              }
                            }}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Paste public key"
                          >
                            <MaterialIcons name="content-paste" size={18} color="#4F6BFF" />
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Status indicator below input */}
                      {cleanVaultHex.length > 0 && (
                        <View style={styles.keyStatusWrap}>
                          {isValidVaultHex ? (
                            <Text style={[styles.keyStatusText, { color: '#10B981' }]}>
                              ✓ 33-byte compressed P-256 public key verified
                            </Text>
                          ) : (
                            <Text style={[styles.keyStatusText, { color: '#EF4444' }]}>
                              Must be a 66-character hex string starting with 02 or 03 ({cleanVaultHex.length}/66)
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.vaultPolicyNotice,
                        {
                          backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                          marginTop: 10,
                        },
                      ]}
                    >
                      <View style={styles.vaultPolicyIconWrap}>
                        <MaterialIcons name="usb" size={16} color="#6C8CFF" />
                      </View>
                      <Text style={[styles.vaultPolicyNoticeText, { color: theme.textSecondary }]}>
                        During setup, your device will prompt you to insert or tap your FIDO2 / YubiKey hardware key over USB or NFC.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Wallet Name (Directly visible, matching onboarding) */}
              <View style={styles.formGroup}>
                <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                  Wallet name
                </Text>
                <TextInput
                  style={[
                    styles.inputField,
                    {
                      backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                      color: theme.textPrimary,
                      borderColor: theme.isDark ? '#2A2A2E' : '#D1D5DB',
                    },
                  ]}
                  value={newAccountName}
                  onChangeText={setNewAccountName}
                  placeholder={selectedMode === 'vault' ? 'My Vault Account' : 'My Haptix Wallet'}
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              {/* Collapsible Advanced Settings (Key Names, Guardian) */}
              {/* Recovery Guardian Address (Optional with Auto-Backup) */}
              <View style={styles.formGroup}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                    Recovery guardian (Optional)
                  </Text>
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 6,
                      backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '500', color: theme.textMuted }}>
                      {guardianAddress.trim() ? 'External key' : 'Auto-backup'}
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.guardianInputContainer,
                    {
                      backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                      borderWidth: isGuardianInputFocused ? 1.5 : 1,
                      borderColor:
                        guardianAddress.trim() && (!isSolanaAddress(guardianAddress.trim()) || isDevnetFunder(guardianAddress.trim()))
                          ? theme.rose
                          : isGuardianInputFocused
                          ? '#4F6BFF'
                          : (theme.isDark ? '#2A2A2E' : '#D1D5DB'),
                      marginTop: 0,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.macKeyInput, { color: theme.textPrimary, marginRight: 8 }]}
                    value={guardianAddress}
                    onChangeText={setGuardianAddress}
                    onFocus={() => setIsGuardianInputFocused(true)}
                    onBlur={() => setIsGuardianInputFocused(false)}
                    placeholder="Auto-generate or paste address"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline={false}
                    numberOfLines={1}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                  />
                  {guardianAddress.trim() ? (
                    <TouchableOpacity
                      style={styles.pasteBadgeButton}
                      onPress={() => {
                        setGuardianAddress('')
                        Haptics.selectionAsync()
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="close" size={16} color={theme.textMuted} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.pasteBadgeButton}
                      onPress={async () => {
                        const text = await Clipboard.getString()
                        if (text) {
                          setGuardianAddress(text.trim())
                          Haptics.selectionAsync()
                        }
                      }}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="content-paste" size={14} color="#6C8CFF" style={{ marginRight: 2 }} />
                      <Text style={styles.pasteBadgeText}>Paste</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={[styles.fieldHint, { color: isDevnetFunder(guardianAddress.trim()) ? theme.rose : theme.textMuted, marginTop: 4 }]}>
                  {isDevnetFunder(guardianAddress.trim())
                    ? 'Cannot use the devnet funder. Guardian must be an external key.'
                    : guardianAddress.trim()
                    ? 'Can rescue your wallet if passkeys are lost. Cannot move funds.'
                    : 'Leave blank to auto-generate a recovery key. You can link Phantom anytime in Settings.'}
                </Text>
                {guardianAddress.trim() && !isSolanaAddress(guardianAddress.trim()) && (
                  <Text style={[styles.fieldError, { color: theme.roseText }]}>
                    Invalid Solana address
                  </Text>
                )}
              </View>

              {/* Advanced Options Toggle */}
              <TouchableOpacity
                style={[
                  styles.advancedToggleBtn,
                  {
                    backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                  },
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
                    {showAdvanced ? 'Hide passkey labels' : 'Advanced passkey labels'}
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
                  {/* Primary Key Label */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      Passkey 1 name, primary
                    </Text>
                    <TextInput
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                          color: theme.textPrimary,
                          borderColor: theme.isDark ? '#222226' : theme.borderDefault,
                        },
                      ]}
                      value={primaryKeyLabel}
                      onChangeText={setPrimaryKeyLabel}
                      placeholder="Device Biometrics (Primary)"
                      placeholderTextColor={theme.textMuted}
                      returnKeyType="next"
                    />
                  </View>

                  {/* Secondary Key Label */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      {selectedMode === 'vault' ? 'Passkey 2 name, vault key' : 'Passkey 2 name, backup'}
                    </Text>
                    <TextInput
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                          color: theme.textPrimary,
                          borderColor: theme.isDark ? '#222226' : theme.borderDefault,
                        },
                      ]}
                      value={secondaryKeyLabel}
                      onChangeText={setSecondaryKeyLabel}
                      placeholder={
                        selectedMode === 'vault'
                          ? (vaultKeySource === 'mac' ? 'Second Device (Vault Key)' : 'Vault Key (Security Key)')
                          : 'Device Biometrics (Backup)'
                      }
                      placeholderTextColor={theme.textMuted}
                      returnKeyType="next"
                    />
                  </View>
                </View>
              )}

              {/* Hardware Biometric / Security Notice */}
              <View
                style={[
                  styles.biometricNoticeBox,
                  {
                    backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                  },
                ]}
              >
                <MaterialIcons
                  name={selectedMode === 'vault' ? 'devices' : 'fingerprint'}
                  size={20}
                  color={theme.textMuted}
                  style={{ marginTop: 2 }}
                />
                <Text style={[styles.biometricNoticeText, { color: theme.textSecondary }]}>
                  {selectedMode === 'vault'
                    ? (vaultKeySource === 'mac'
                      ? 'Key 1 is on this phone. Key 2 is on your second device (laptop or 2nd phone) and required for all sends (0 SOL limit). Survives a lost phone.'
                      : 'Key 1 is on this phone. Key 2 is on your USB / NFC security key. Survives a lost phone.')
                    : "Two keys held in this phone chip. Both are required above your 0.1 SOL limit. If this phone is lost, both keys are lost and your Recovery Guardian is the only way back."}
                </Text>
              </View>

            </ScrollView>
          )}

          {/* Pinned Action Footer (Always visible without scrolling) */}
          {isCreating && creationStep === 0 && (
            <View
              style={[
                styles.pinnedFooter,
                {
                  backgroundColor: theme.bgCard,
                  borderTopColor: theme.isDark ? '#201f1d' : theme.borderSubtle,
                  paddingBottom: Math.max(insets.bottom, 14),
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  {
                    backgroundColor: theme.isDark ? '#1A1A18' : '#EFEFF0',
                    borderColor: theme.isDark ? '#2A2A28' : theme.borderSubtle,
                  },
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
                  { backgroundColor: '#5E81FF', opacity: isSubmittingCreate ? 0.7 : 1 },
                ]}
                onPress={handleConfirmCreate}
                disabled={isSubmittingCreate}
                activeOpacity={0.85}
              >
                {isSubmittingCreate ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <MaterialIcons name="fingerprint" size={18} color="#FFFFFF" />
                    <Text style={styles.submitPrimaryBtnText}>
                      {selectedMode === 'vault' ? 'Start Vault setup' : 'Start setup'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  dragHandleTouchZone: {
    width: '100%',
    paddingTop: 0,
    paddingBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingTop: 10,
    maxHeight: '92%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    opacity: 0.8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.02,
  },
  subtitle: {
    fontSize: 12.5,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  removeTrashBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollList: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 24,
    gap: 12,
  },

  /* Card Layout: 3 Columns (Avatar, Middle, Right) */
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 12,
  },
  accountAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountMiddleCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  accountName: {
    fontSize: 15,
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
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.02,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: '#4F6BFF',
  },
  activeBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /* Add button */
  addAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    gap: 12,
    marginTop: 4,
  },
  addAccountIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addAccountTextGroup: {
    flex: 1,
  },
  addAccountTitle: {
    fontSize: 15,
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
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: '500',
  },
  fieldHint: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 2,
    marginBottom: 10,
  },
  fieldError: {
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
  },

  /* Mode selection cards */
  modeCardsRow: {
    gap: 8,
    marginBottom: 14,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    gap: 12,
  },
  modeCardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  modeCardTextCol: {
    flex: 1,
  },
  modeCardTitle: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  modeCardDesc: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5E81FF',
  },


  /* Vault policy notice */
  vaultPolicyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
  },
  vaultPolicyIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(79, 107, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vaultPolicyNoticeText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },

  /* Vault explainer & devices */
  vaultExplainerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  vaultExplainerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  vaultDeviceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  vaultDeviceCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  vaultDeviceText: {
    fontSize: 13,
  },
  macVaultBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  macVaultStepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  macVaultStepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  macVaultStepBadgeText: {
    color: '#4F6BFF',
    fontSize: 11,
    fontWeight: '700',
  },
  macVaultStepTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  macVaultUrlWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  macVaultUrlLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  macVaultUrlText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  macVaultUrlActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  macVaultActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  macVaultActionBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  guardianInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 50,
  },
  macKeyInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 52,
    marginTop: 2,
  },
  macKeyInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 8,
    paddingHorizontal: 0,
    marginRight: 8,
  },
  macPasteBadgeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
  },
  pasteBadgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  pasteBadgeText: {
    color: '#4F6BFF',
    fontSize: 12,
    fontWeight: '700',
  },
  keyActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  validKeyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  validKeyText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
  },
  clearKeyBtn: {
    padding: 2,
  },
  keyStatusWrap: {
    marginTop: 6,
    paddingHorizontal: 4,
  },
  keyStatusText: {
    fontSize: 11.5,
    fontWeight: '500',
  },

  /* Advanced Accordion Toggle */
  advancedToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 2,
    marginBottom: 10,
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
    marginBottom: 12,
  },

  /* Biometric notice box */
  biometricNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
  },
  biometricNoticeText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },

  /* Creation progress animation */
  creationProgressContainer: {
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    width: '100%',
  },
  modalStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 14,
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  modalStepText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },

  /* Form actions */
  pinnedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 0.5,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  submitPrimaryBtn: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
})
