import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
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

interface HaptixAccountSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  isBalanceHidden?: boolean
}

export function HaptixAccountSwitcherSheet({ visible, onClose, isBalanceHidden }: HaptixAccountSwitcherSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const { activeWallet, wallets, switchWallet, createWallet } = useAuth()
  const { selectedCluster } = useCluster()
  const network = selectedCluster?.network === ClusterNetwork.Mainnet ? 'mainnet' : 'devnet'

  const listScrollRef = useRef<ScrollView>(null)
  const createScrollRef = useRef<ScrollView>(null)

  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Account creation form state
  const [newAccountName, setNewAccountName] = useState('')
  const [selectedMode, setSelectedMode] = useState<'everyday' | 'vault'>('everyday')
  const [vaultKeySource, setVaultKeySource] = useState<'mac' | 'hardware'>('mac')
  const [macVaultKeyHex, setMacVaultKeyHex] = useState('')

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
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
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
    }
  }, [visible, panY])

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
        } catch {}
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
    const defaultName =
      selectedMode === 'vault'
        ? `Hardware Vault ${wallets.length + 1}`
        : `Everyday Account ${wallets.length + 1}`
    setNewAccountName(defaultName)
    setVaultKeySource('mac')
    setMacVaultKeyHex('')
    setPrimaryKeyLabel('Device Biometrics (Primary)')
    setSecondaryKeyLabel('Mac Touch ID (Vault Key)')
    setGuardianAddress('')
    setShowAdvanced(false)
    setIsCreating(true)
    setTimeout(() => {
      createScrollRef.current?.scrollTo({ y: 0, animated: false })
    }, 30)
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
          ? 'Mac Touch ID (Vault Key)'
          : 'Vault Key (Security Key)'
      )
    } else {
      setSecondaryKeyLabel('Backup Passkey')
    }
  }

  const handleSelectVaultSource = (source: 'mac' | 'hardware') => {
    Haptics.selectionAsync()
    setVaultKeySource(source)
    setSecondaryKeyLabel(
      source === 'mac'
        ? 'Mac Touch ID (Vault Key)'
        : 'Vault Key (Security Key)'
    )
  }

  const handleCancelCreate = () => {
    Haptics.selectionAsync()
    Keyboard.dismiss()
    setIsCreating(false)
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

    const parsedGuardian = parseGuardianAddress(guardianAddress)
    if (!parsedGuardian) {
      setShowAdvanced(true)
      dialog.alert(
        'Recovery Guardian Required',
        guardianAddress.trim()
          ? 'That is not a valid Solana address. Please enter a valid 32-byte public key.'
          : 'A recovery guardian is required so this wallet can be recovered if this device is lost. Enter an independent, trusted Solana address (e.g. Phantom, Solflare, or a hardware wallet).',
        undefined,
        { status: 'warning' },
      )
      return
    }
    if (isDevnetFunder(parsedGuardian)) {
      setShowAdvanced(true)
      dialog.alert(
        'Independent Guardian Required',
        'The recovery guardian cannot be a key held by this app or the devnet funder. Please enter an independent external address (e.g. Phantom, Solflare, or a hardware wallet).',
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
          'Mac Touch ID Public Key Required',
          'Please open http://localhost:8081/vault.html on your Mac, tap "Enroll with Touch ID", and paste the 33-byte public key hex into the Mac Key field.',
          undefined,
          { status: 'warning' },
        )
        return
      }
    }

    try {
      setIsSubmittingCreate(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      await createWallet(finalName, {
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
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setIsCreating(false)
      setNewAccountName('')
      setMacVaultKeyHex('')
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

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
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
              style={[styles.closeBtn, { backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0' }]}
              onPress={isCreating ? handleCancelCreate : onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close"
            >
              <MaterialIcons name="close" size={18} color={theme.textPrimary} />
            </TouchableOpacity>
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
                    onPress={() => handleSelectAccount(wallet.address)}
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

                    {/* Right Column (Balance on top, Status / Chevron on bottom) */}
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
                  </TouchableOpacity>
                )
              })}

              {/* Add New Account Trigger (Solid Elevated Surface, No Dashes) */}
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
            </ScrollView>
          ) : (
            /* ================================================================ */
            /* 2. RICH, TRANSPARENT ACCOUNT CREATION EXPERIENCE                */
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
                      <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Vault mode</Text>: daily spends use fingerprint on this phone. Sends above your limit will require your Mac Touch ID.
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
                        name="laptop-mac"
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
                        Mac Touch ID
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
                          backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                          borderColor: theme.isDark ? '#222226' : theme.borderSubtle,
                        },
                      ]}
                    >
                      <Text style={[styles.macVaultStep, { color: theme.textSecondary }]}>
                        1. Open on your Mac browser
                      </Text>
                      <View
                        style={[
                          styles.macVaultUrlWrap,
                          {
                            backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                            borderColor: theme.isDark ? '#222226' : theme.borderDefault,
                          },
                        ]}
                      >
                        <Text style={[styles.macVaultUrlText, { color: '#6C8CFF' }]}>
                          http://localhost:8081/vault.html
                        </Text>
                      </View>
                      <Text style={[styles.macVaultStep, { color: theme.textSecondary }]}>
                        2. Tap "Enroll with Touch ID" on your Mac, then paste the public key below
                      </Text>
                      <View
                        style={[
                          styles.macKeyInputContainer,
                          {
                            backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                            borderColor: theme.isDark ? '#222226' : theme.borderDefault,
                          },
                        ]}
                      >
                        <TextInput
                          style={[styles.macKeyInput, { color: theme.textPrimary }]}
                          value={macVaultKeyHex}
                          onChangeText={setMacVaultKeyHex}
                          placeholder="Paste 33-byte Mac public key (02...)"
                          placeholderTextColor={theme.textMuted}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <TouchableOpacity
                          style={styles.pasteBadgeButton}
                          onPress={async () => {
                            const text = await Clipboard.getString()
                            if (text) {
                              const clean = text.trim().startsWith('0x') ? text.trim().slice(2) : text.trim()
                              setMacVaultKeyHex(clean)
                              Haptics.selectionAsync()
                            }
                          }}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="content-paste" size={14} color="#6C8CFF" style={{ marginRight: 2 }} />
                          <Text style={styles.pasteBadgeText}>Paste</Text>
                        </TouchableOpacity>
                      </View>
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
                      borderColor: theme.isDark ? '#222226' : theme.borderDefault,
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
              {/* Recovery Guardian Address (Visibly required on-chain) */}
              <View style={styles.formGroup}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                    Recovery guardian (Required)
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
                      External key
                    </Text>
                  </View>
                </View>
                <TextInput
                  style={[
                    styles.inputField,
                    {
                      backgroundColor: theme.isDark ? '#141416' : '#FFFFFF',
                      color: theme.textPrimary,
                      borderColor:
                        guardianAddress.trim() && (!isSolanaAddress(guardianAddress.trim()) || isDevnetFunder(guardianAddress.trim()))
                          ? theme.rose
                          : (theme.isDark ? '#222226' : theme.borderDefault),
                    },
                  ]}
                  value={guardianAddress}
                  onChangeText={setGuardianAddress}
                  placeholder="Trusted Solana address (e.g. Phantom)"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <Text style={[styles.fieldHint, { color: isDevnetFunder(guardianAddress.trim()) ? theme.rose : theme.textMuted, marginTop: 4 }]}>
                  {isDevnetFunder(guardianAddress.trim())
                    ? 'Cannot use the devnet funder. Guardian must be an external key.'
                    : 'Can rescue your wallet if passkeys are lost. Cannot move funds.'}
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
                      placeholder="e.g. Primary Passkey"
                      placeholderTextColor={theme.textMuted}
                      returnKeyType="next"
                    />
                  </View>

                  {/* Secondary Key Label */}
                  <View style={styles.formGroup}>
                    <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                      Passkey 2 name, backup
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
                          ? (vaultKeySource === 'mac' ? 'Vault Key (Hardware / Laptop)' : 'Vault Key (Security Key)')
                          : 'Backup Passkey'
                      }
                      placeholderTextColor={theme.textMuted}
                      returnKeyType="next"
                    />
                  </View>
                </View>
              )}

              {/* Hardware Biometric Notice */}
              <View
                style={[
                  styles.biometricNoticeBox,
                  {
                    backgroundColor: theme.isDark ? '#1C1C1E' : '#EFEFF0',
                  },
                ]}
              >
                <MaterialIcons name="fingerprint" size={20} color={theme.textMuted} style={{ marginTop: 2 }} />
                <Text style={[styles.biometricNoticeText, { color: theme.textSecondary }]}>
                  Creating this account will prompt your fingerprint sensor to mint a hardware-backed Secp256r1 passkey inside the secure enclave.
                </Text>
              </View>

            </ScrollView>
          )}

          {/* Pinned Action Footer (Always visible without scrolling) */}
          {isCreating && (
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
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  macVaultStep: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  macVaultUrlWrap: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    marginTop: 2,
  },
  macVaultUrlText: {
    fontSize: 12,
    fontWeight: '600',
  },
  macKeyInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginTop: 4,
  },
  macKeyInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  pasteBadgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pasteBadgeText: {
    color: '#6C8CFF',
    fontSize: 12.5,
    fontWeight: '700',
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
