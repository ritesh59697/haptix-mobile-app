import React, { useState, useEffect, useMemo } from 'react'
import { router } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
  Modal,
  Pressable,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import Clipboard from '@/utils/clipboard'
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { AppConfig } from '@/constants/app-config'
import { HaptixWalletAccount, saveWallet, getSavedWallet, createSmartWalletRecord } from '@/utils/haptix-wallet-storage'
import {
  bindHardwarePasskey,
  credentialIdForRecord,
  getDiscoverablePlatformAssertion,
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  matchLocalSoftwareKey,
  promptBiometricAuth,
} from '@/utils/haptix-passkey'
import { matchWebAuthnAssertion } from '@/utils/secp256r1-instruction'
import { getWalletPda, createInitializeWalletInstruction, fetchHaptixWallet } from '@/utils/haptix-client'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { HaptixBrandMark, CopyChipIcon, FingerScanBold } from '@/components/haptix/haptix-icons'
import { ellipsify } from '@/utils/ellipsify'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  HeroOrbLight,
  BiometricScanGraphic,
  WalletSuccessGraphic,
} from '@/components/haptix/haptix-onboarding-graphics'
import { StatusBar } from 'expo-status-bar'

interface OnboardingPalette {
  heroBg: string
  heroInk: string
  heroAccent: string
  onPrimary: string
  primaryBg: string
  actionBg: string
  secondaryBg: string
  controlBg: string
  decorGlow: string
  decorArc: string
  decorDotStrong: string
  decorDotSoft: string
  sheetBackdrop: string
  sheetBg: string
  screenBg: string
  surface: string
  surfaceAlt: string
  border: string
  ink: string
  inkBody: string
  inkSecondary: string
  inkMuted: string
  link: string
  linkSoftBg: string
  success: string
  shadow: string
}

const lightPalette: OnboardingPalette = {
  heroBg: '#F5F4F9',
  heroInk: '#131217',
  heroAccent: '#6C6AF3',
  onPrimary: '#FFFFFF',
  primaryBg: '#1B1A20',
  actionBg: '#0F172A',
  secondaryBg: '#E9E8EF',
  controlBg: '#EBEAF0',
  decorGlow: 'rgba(108,106,243,0.055)',
  decorArc: 'rgba(108,106,243,0.10)',
  decorDotStrong: 'rgba(108,106,243,0.16)',
  decorDotSoft: 'rgba(108,106,243,0.13)',
  sheetBackdrop: 'rgba(12,10,26,0.35)',
  sheetBg: '#FFFFFF',
  screenBg: '#FFFFFF',
  surface: '#F8FAFC',
  surfaceAlt: '#F1F5F9',
  border: '#E2E8F0',
  ink: '#0F172A',
  inkBody: '#475569',
  inkSecondary: '#64748B',
  inkMuted: '#94A3B8',
  link: '#2563EB',
  linkSoftBg: '#EFF6FF',
  success: '#10B981',
  shadow: 'rgba(0,0,0,0.5)',
}

const darkPalette: OnboardingPalette = {
  heroBg: '#08070F',
  heroInk: '#F4F4F7',
  heroAccent: '#9C93FF',
  onPrimary: '#0A0A0F',
  primaryBg: '#FFFFFF',
  actionBg: '#FFFFFF',
  secondaryBg: '#1C1B23',
  controlBg: '#1C1B23',
  decorGlow: 'rgba(140,130,255,0.06)',
  decorArc: 'rgba(140,130,255,0.18)',
  decorDotStrong: 'rgba(140,130,255,0.30)',
  decorDotSoft: 'rgba(140,130,255,0.22)',
  sheetBackdrop: 'rgba(0,0,0,0.6)',
  sheetBg: '#141419',
  screenBg: '#0A0A0F',
  surface: '#141419',
  surfaceAlt: '#18181F',
  border: 'rgba(255,255,255,0.10)',
  ink: '#F2F2F5',
  inkBody: '#B4B4BE',
  inkSecondary: '#A0A0AC',
  inkMuted: '#74747F',
  link: '#8FA8FF',
  linkSoftBg: 'rgba(108,140,255,0.14)',
  success: '#34D399',
  shadow: 'rgba(0,0,0,0.6)',
}

export default function SignIn() {
  const insets = useSafeAreaInsets()
  const { updateWallet } = useAuth()
  const { themePreference, setThemePreference, isDark } = useAppTheme()
  const dialog = useHaptixDialog()

  /**
   * Async `confirm`, because the recovery flow has to branch on the answer.
   *
   * `onDismiss` settles the promise as well: a dialog dismissed with the Android back
   * gesture calls neither button, and a promise that never settles would leave the sign-in
   * button spinning forever.
   */
  const confirmDialog = (title: string, message: string, confirmText: string) =>
    new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      dialog.alert(
        title,
        message,
        [
          { text: 'Not Now', style: 'cancel', onPress: () => finish(false) },
          { text: confirmText, onPress: () => finish(true) },
        ],
        { onDismiss: () => finish(false) },
      )
    })

  const p = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(p), [p])

  const [showThemeSheet, setShowThemeSheet] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSignInModal, setShowSignInModal] = useState(false)

  const [isCreating, setIsCreating] = useState(false)
  const [creationStep, setCreationStep] = useState<0 | 1 | 2 | 3>(0)

  const [walletName, setWalletName] = useState('My Haptix Wallet')
  const [primaryKeyName, setPrimaryKeyName] = useState('Primary Passkey')
  const [secondaryKeyName, setSecondaryKeyName] = useState('Backup Quorum Passkey')

  const [isSigningIn, setIsSigningIn] = useState(false)
  const [restoreAddress, setRestoreAddress] = useState('')
  const [showAddressInput, setShowAddressInput] = useState(false)

  useEffect(() => {
    getSavedWallet()
      .then((w) => {
        // Just prefetch, we don't automatically route here to let them enjoy the hero,
        // but if they click sign in we can route immediately if it exists.
      })
      .catch(() => {})
  }, [])

  const handleExecutePasskeyCreation = async () => {
    try {
      setIsCreating(true)
      setCreationStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const finalName = walletName.trim() || 'My Haptix Wallet'
      const primaryName = primaryKeyName.trim() || 'Primary Passkey'
      const secondaryName = secondaryKeyName.trim() || 'Backup Quorum Passkey'

      // 1. Generate Primary
      const primary = await getOrCreatePrimaryPasskey(primaryName)

      setCreationStep(2)
      await new Promise((r) => setTimeout(r, 600))

      // 2. Generate Secondary
      const secondary = await getOrCreateSecondaryPasskey(secondaryName)

      setCreationStep(3)

      const [walletPda] = getWalletPda(primary.publicKey)

      const newAccount = await createSmartWalletRecord({
        name: finalName,
        primaryPasskeyHex: primary.publicKeyHex,
        secondaryPasskeyHex: secondary.publicKeyHex,
        // Recorded so the wallet can be switched back to later: a switch re-points the
        // signing path from these ids, and a record without them is a wallet the app can
        // list but cannot sign for. Software keys are excluded on purpose -- see
        // `credentialIdForRecord`.
        primaryCredentialId: credentialIdForRecord(primary),
        secondaryCredentialId: credentialIdForRecord(secondary),
        primaryLabel: primary.label,
        secondaryLabel: secondary.label,
        spendThreshold: 0.1,
        network: 'devnet',
      })
      newAccount.isInitializedOnChain = false
      await saveWallet(newAccount)
      await updateWallet(newAccount)

      // Background Initialization
      ;(async () => {
        try {
          const connection = new Connection(AppConfig.devnetRpcUrl, {
            commitment: 'confirmed',
          })
          const payer = await getFundedDevnetPayer(connection)
          const existing = await fetchHaptixWallet(connection, walletPda).catch(() => null)
          if (!existing && payer && newAccount.primaryPasskeyHex && newAccount.secondaryPasskeyHex) {
            const primaryPasskey = new Uint8Array(Buffer.from(newAccount.primaryPasskeyHex, 'hex'))
            const secondaryPasskey = new Uint8Array(Buffer.from(newAccount.secondaryPasskeyHex, 'hex'))
            const initIx = createInitializeWalletInstruction({
              payer: payer.publicKey,
              walletPda,
              primaryPasskey,
              secondaryPasskey,
            })
            const tx = new Transaction({
              feePayer: payer.publicKey,
              recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
            }).add(initIx)
            await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })
          }
          newAccount.isInitializedOnChain = true
          await saveWallet(newAccount)
          await updateWallet(newAccount)
        } catch {}
      })()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setShowCreateModal(false)
      router.replace('/(tabs)')
    } catch (err: any) {
      console.error('[Haptix Passkey] Setup error:', err)
      dialog.alert(
        'Passkey Setup Error',
        err?.message || 'Biometric authentication was cancelled or failed. Please try again.',
      )
    } finally {
      setIsCreating(false)
      setCreationStep(0)
    }
  }

  const handleSignInWithPasskey = async () => {
    try {
      setIsSigningIn(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const saved = await getSavedWallet()
      if (saved) {
        const typedAddress = showAddressInput && restoreAddress.trim() ? restoreAddress.trim() : ''

        // Typing a *different* address means "bring that wallet onto this device", not
        // "rename this one". The old code overwrote the saved record's address, which left
        // the app pointing at an account whose keys are not on this device: every balance
        // was read from an address it could never sign for. Falling through to recovery
        // instead means the account is only trusted once a passkey has been checked
        // against it.
        if (!typedAddress || typedAddress === saved.address) {
          const auth = await promptBiometricAuth('Authenticate with biometric passkey to sign in')
          if (!auth.success) {
            dialog.alert('Authentication Failed', auth.error || 'Biometric verification was not completed.')
            return
          }

          await updateWallet(saved)
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          setShowSignInModal(false)
          router.replace('/(tabs)')
          return
        }
      }

      const targetAddress = showAddressInput && restoreAddress.trim() ? restoreAddress.trim() : ''
      if (!targetAddress) {
        dialog.alert(
          'Address Required',
          'Since this is a new device/browser, we need your Solana smart wallet address to restore your account. Please enter it below.',
        )
        setShowAddressInput(true)
        return
      }

      const connection = new Connection(AppConfig.devnetRpcUrl, { commitment: 'confirmed' })
      let pda: PublicKey
      try {
        pda = new PublicKey(targetAddress)
      } catch {
        dialog.alert('Invalid Address', 'Please enter a valid Solana address.')
        return
      }

      const onchainState = await fetchHaptixWallet(connection, pda)
      if (!onchainState) {
        dialog.alert('Wallet Not Found', 'Could not find a Haptix smart wallet at this address on Devnet.')
        return
      }

      // Recovery. An assertion carries a credential id and a signature but never a public
      // key, so no address can be derived from a passkey: the address comes from the user
      // and the credential is then *proven* to belong to it by verifying its signature
      // against the keys the account already holds. The previous flow skipped that proof
      // and copied the on-chain keys into the device record, which silently produced a
      // wallet whose every 2-of-2 action failed the precompile with nothing on screen.
      const onChainKeys = {
        primary: onchainState.primaryPasskey,
        secondary: onchainState.secondaryPasskey,
      }

      const bindOne = async (expectedRole: 'primary' | 'secondary' | null) => {
        // A legacy software key never appears in the OS picker, so the scalar this device
        // already holds is checked first. It needs no binding: the existing pointers are
        // already correct, which is why no credential id is recorded for it.
        const localRole = await matchLocalSoftwareKey(onChainKeys)
        if (localRole && (!expectedRole || localRole === expectedRole)) {
          return { role: localRole, credentialId: undefined }
        }

        const picked = await getDiscoverablePlatformAssertion()
        const matched = matchWebAuthnAssertion(picked.assertion, onChainKeys)
        if (!matched || (expectedRole && matched !== expectedRole)) {
          return null
        }
        const key = matched === 'primary' ? onChainKeys.primary : onChainKeys.secondary
        await bindHardwarePasskey(matched, picked.credentialId, Buffer.from(key).toString('hex'))
        return { role: matched, credentialId: picked.credentialId }
      }

      const first = await bindOne(null)
      if (!first) {
        dialog.alert(
          'Wrong Passkey',
          `That passkey does not belong to ${ellipsify(targetAddress, 6)}.\n\nPick the passkey you created for this wallet and try again.`,
          undefined,
          { status: 'error' },
        )
        return
      }

      // A 2-of-2 wallet needs both keys. The other one is usually on the same device, so
      // offer it now rather than leaving the user with a wallet that cannot unfreeze or
      // send above its spending threshold.
      const otherRole = first.role === 'primary' ? 'secondary' : 'primary'
      const bound: { primary?: string; secondary?: string } = { [first.role]: first.credentialId }
      const wantsSecondKey = await confirmDialog(
        'Bind The Second Key?',
        `${first.role === 'primary' ? 'Primary' : 'Backup'} key bound.\n\nThis wallet needs both keys for high-value transfers and unfreezing. Add the ${otherRole} key now?`,
        `Select ${otherRole} passkey`,
      )
      if (wantsSecondKey) {
        const second = await bindOne(otherRole)
        if (second) {
          bound[second.role] = second.credentialId
        } else {
          dialog.alert(
            'Key Not Bound',
            `That passkey is not this wallet's ${otherRole} key, so it was not bound. You can add it later from Settings.`,
            undefined,
            { status: 'warning' },
          )
        }
      }

      const restored = await createSmartWalletRecord({
        name: 'My Haptix Wallet',
        primaryPasskeyHex: Buffer.from(onChainKeys.primary).toString('hex'),
        secondaryPasskeyHex: Buffer.from(onChainKeys.secondary).toString('hex'),
        primaryCredentialId: bound.primary,
        secondaryCredentialId: bound.secondary,
        primaryLabel: 'Primary passkey',
        secondaryLabel: 'Backup quorum passkey',
        spendThreshold: Number(onchainState.spendThresholdLamports) / LAMPORTS_PER_SOL,
        network: 'devnet',
      })
      restored.address = targetAddress
      restored.isInitializedOnChain = true
      await saveWallet(restored)
      await updateWallet(restored)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setShowSignInModal(false)
      router.replace('/(tabs)')
    } catch (err: any) {
      console.error('[Haptix Passkey] Sign in error:', err)
      dialog.alert('Sign In Error', err?.message || 'Could not verify passkey account')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handlePasteAddress = async () => {
    try {
      const text = await Clipboard.getString()
      if (text) {
        setRestoreAddress(text.trim())
        Haptics.selectionAsync()
      }
    } catch {}
  }

  return (
    <View
      style={[
        styles.heroContainer,
        { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom + 16, 32) },
      ]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Decorative background */}
      <View pointerEvents="none" style={styles.heroDecor}>
        <View style={styles.heroDecorGlow} />
        <View style={styles.heroDecorArc} />
        <View style={styles.heroDecorDotLeft} />
        <View style={styles.heroDecorDotRight} />
      </View>

      <View style={styles.heroTopRow}>
        <TouchableOpacity
          style={styles.heroSettings}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setShowThemeSheet(true)
          }}
        >
          <MaterialIcons name="settings" size={19} color={p.heroInk} />
        </TouchableOpacity>
      </View>

      <View style={styles.heroLogoBlock}>
        <HaptixBrandMark size={44} color={p.heroInk} />
        <Text style={styles.heroWordmark}>HAPTIX</Text>
      </View>

      <View style={styles.heroCenterArt}>
        <HeroOrbLight size={316} />
      </View>

      <View style={styles.heroBottomBlock}>
        <Text style={styles.heroTitleText}>
          A smarter way{'\n'}to own <Text style={styles.heroTitleAccent}>crypto</Text>
        </Text>

        <TouchableOpacity
          style={[styles.heroButton, styles.heroButtonPrimary]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setShowCreateModal(true)
          }}
          activeOpacity={0.9}
        >
          <Text style={[styles.heroButtonText, { color: p.onPrimary }]}>Create New Wallet</Text>
          <MaterialIcons name="arrow-forward" size={20} color={p.onPrimary} style={styles.heroButtonArrow} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.heroButton, styles.heroButtonSecondary]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setShowSignInModal(true)
          }}
          activeOpacity={0.9}
        >
          <Text style={[styles.heroButtonText, { color: p.heroInk }]}>Sign In to Existing Wallet</Text>
          <MaterialIcons name="arrow-forward" size={20} color={p.heroInk} style={styles.heroButtonArrow} />
        </TouchableOpacity>
      </View>

      {/* CREATE WALLET MODAL */}
      <Modal visible={showCreateModal} animationType="slide" transparent={true}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}
            >
              <Text style={styles.sheetTitle}>Create Wallet</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <MaterialIcons name="close" size={24} color={p.heroInk} />
              </TouchableOpacity>
            </View>

            {creationStep === 0 ? (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetDesc}>Customize your wallet and passkey names.</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Wallet Name</Text>
                  <TextInput
                    style={styles.textInputField}
                    value={walletName}
                    onChangeText={setWalletName}
                    placeholder="e.g., My Haptix Wallet"
                    placeholderTextColor={p.inkMuted}
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Passkey 1 Name (Primary)</Text>
                  <TextInput
                    style={styles.textInputField}
                    value={primaryKeyName}
                    onChangeText={setPrimaryKeyName}
                    placeholder="e.g., Primary Passkey"
                    placeholderTextColor={p.inkMuted}
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Passkey 2 Name (Backup)</Text>
                  <TextInput
                    style={styles.textInputField}
                    value={secondaryKeyName}
                    onChangeText={setSecondaryKeyName}
                    placeholder="e.g., Backup Quorum Passkey"
                    placeholderTextColor={p.inkMuted}
                    autoCorrect={false}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.primaryDarkButton, { marginTop: 12 }]}
                  onPress={handleExecutePasskeyCreation}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="fingerprint" size={20} color={p.onPrimary} style={{ marginRight: 8 }} />
                  <Text style={styles.primaryDarkButtonText}>Start Setup</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={p.link} style={{ marginBottom: 24 }} />
                <View style={styles.modalStepRow}>
                  <MaterialIcons
                    name={creationStep > 1 ? 'check-circle' : 'radio-button-unchecked'}
                    size={24}
                    color={creationStep > 1 ? p.success : p.inkMuted}
                  />
                  <Text style={styles.modalStepText}>Creating {primaryKeyName || 'Primary Passkey'}...</Text>
                </View>
                <View style={styles.modalStepRow}>
                  <MaterialIcons
                    name={creationStep > 2 ? 'check-circle' : 'radio-button-unchecked'}
                    size={24}
                    color={creationStep > 2 ? p.success : p.inkMuted}
                  />
                  <Text style={styles.modalStepText}>Creating {secondaryKeyName || 'Backup Passkey'}...</Text>
                </View>
                <View style={styles.modalStepRow}>
                  <MaterialIcons
                    name={creationStep > 2 ? 'check-circle' : 'radio-button-unchecked'}
                    size={24}
                    color={creationStep > 2 ? p.success : p.inkMuted}
                  />
                  <Text style={styles.modalStepText}>Finalizing Smart Account...</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* SIGN IN MODAL */}
      <Modal visible={showSignInModal} animationType="slide" transparent={true}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
            >
              <Text style={styles.sheetTitle}>Sign In</Text>
              <TouchableOpacity onPress={() => setShowSignInModal(false)}>
                <MaterialIcons name="close" size={24} color={p.heroInk} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <BiometricScanGraphic size={72} dark={isDark} />
              </View>
              <Text style={styles.sheetDesc}>Authenticate with your biometric passkey.</Text>

              <TouchableOpacity
                style={styles.customAddressToggle}
                onPress={() => {
                  Haptics.selectionAsync()
                  setShowAddressInput((prev) => !prev)
                }}
              >
                <Text style={styles.customAddressToggleText}>
                  {showAddressInput ? 'Hide custom address' : 'Specify custom wallet address (Optional)'}
                </Text>
                <MaterialIcons
                  name={showAddressInput ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={18}
                  color={p.inkSecondary}
                />
              </TouchableOpacity>

              {showAddressInput && (
                <View style={styles.addressInputContainer}>
                  <TextInput
                    style={styles.addressInput}
                    value={restoreAddress}
                    onChangeText={setRestoreAddress}
                    placeholder="Paste Solana smart wallet address"
                    placeholderTextColor={p.inkMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {restoreAddress.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => setRestoreAddress('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="cancel" size={18} color={p.inkMuted} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.pasteBadgeButton} onPress={handlePasteAddress}>
                      <Text style={styles.pasteBadgeText}>Paste</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryDarkButton, { marginTop: 16 }, isSigningIn && { opacity: 0.8 }]}
                onPress={handleSignInWithPasskey}
                disabled={isSigningIn}
                activeOpacity={0.85}
              >
                {isSigningIn ? (
                  <ActivityIndicator color={p.onPrimary} />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialIcons name="fingerprint" size={20} color={p.onPrimary} />
                    <Text style={styles.primaryDarkButtonText}>Sign in with Biometrics</Text>
                  </View>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showThemeSheet} transparent animationType="fade" onRequestClose={() => setShowThemeSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowThemeSheet(false)}>
          <Pressable style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
            <Text style={styles.sheetTitle}>Appearance</Text>
            {(
              [
                ['system', 'Match system'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ] as const
            ).map(([value, label]) => (
              <TouchableOpacity
                key={value}
                style={styles.sheetRow}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setThemePreference(value)
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.sheetRowText}>{label}</Text>
                {themePreference === value && <MaterialIcons name="check" size={20} color={p.heroAccent} />}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const createStyles = (p: OnboardingPalette) =>
  StyleSheet.create({
    heroContainer: { flex: 1, backgroundColor: p.heroBg, paddingHorizontal: 24 },
    heroDecor: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
    heroDecorGlow: {
      position: 'absolute',
      top: -70,
      right: -130,
      width: 380,
      height: 380,
      borderRadius: 190,
      backgroundColor: p.decorGlow,
    },
    heroDecorArc: {
      position: 'absolute',
      top: 90,
      left: -170,
      width: 420,
      height: 420,
      borderRadius: 210,
      borderWidth: 1.5,
      borderColor: p.decorArc,
    },
    heroDecorDotLeft: {
      position: 'absolute',
      top: '25%',
      left: 26,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: p.decorDotStrong,
    },
    heroDecorDotRight: {
      position: 'absolute',
      top: '31%',
      right: 22,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: p.decorDotSoft,
    },
    heroTopRow: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    heroSettings: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: p.controlBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroLogoBlock: { alignItems: 'center', marginTop: 16 },
    heroWordmark: { color: p.heroInk, fontSize: 15, fontWeight: '700', letterSpacing: 5, marginTop: 12 },
    heroCenterArt: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    heroBottomBlock: { width: '100%' },
    heroTitleText: {
      color: p.heroInk,
      fontSize: 34,
      fontWeight: '700',
      lineHeight: 41,
      letterSpacing: -0.9,
      marginBottom: 26,
    },
    heroTitleAccent: { color: p.heroAccent },
    heroButton: {
      width: '100%',
      height: 56,
      borderRadius: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    heroButtonPrimary: { backgroundColor: p.primaryBg },
    heroButtonSecondary: { backgroundColor: p.secondaryBg },
    heroButtonText: { fontSize: 16.5, fontWeight: '600', letterSpacing: -0.2 },
    heroButtonArrow: { position: 'absolute', right: 22 },
    sheetBackdrop: { flex: 1, backgroundColor: p.sheetBackdrop, justifyContent: 'flex-end' },
    sheetCard: {
      backgroundColor: p.sheetBg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 24,
      paddingTop: 22,
    },
    sheetTitle: { color: p.heroInk, fontSize: 19, fontWeight: '700' },
    sheetDesc: { color: p.inkSecondary, fontSize: 15, marginBottom: 20, textAlign: 'center' },
    sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15 },
    sheetRowText: { color: p.heroInk, fontSize: 16 },
    primaryDarkButton: {
      width: '100%',
      height: 52,
      borderRadius: 26,
      backgroundColor: p.actionBg,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
    },
    primaryDarkButtonText: { color: p.onPrimary, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
    inputGroup: { marginBottom: 16 },
    inputLabel: { color: p.heroInk, fontSize: 14, fontWeight: '600', marginBottom: 8 },
    textInputField: {
      color: p.heroInk,
      fontSize: 15,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    modalStepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      gap: 12,
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    modalStepText: { color: p.heroInk, fontSize: 15, fontWeight: '500' },
    customAddressToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    customAddressToggleText: { color: p.inkSecondary, fontSize: 13, fontWeight: '500' },
    addressInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginTop: 4,
      marginBottom: 12,
    },
    addressInput: { flex: 1, color: p.heroInk, fontSize: 13, padding: 0 },
    pasteBadgeButton: { backgroundColor: p.linkSoftBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    pasteBadgeText: { color: p.link, fontSize: 11, fontWeight: '600' },
  })
