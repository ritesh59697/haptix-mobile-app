import React, { useState, useEffect, useMemo } from 'react'
import { router } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  Modal,
  Pressable,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import Clipboard from '@/utils/clipboard'
import { Connection, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { HaptixWalletAccount, saveWallet, getSavedWallet, createSmartWalletRecord } from '@/utils/haptix-wallet-storage'
import {
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  promptBiometricAuth,
  authenticatePasskey,
} from '@/utils/haptix-passkey'
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

/**
 * Palette for the pre-auth flow.
 *
 * The hero keeps its own indigo identity rather than using the monochrome app
 * tokens, but it is still driven by the appearance preference so light/dark
 * both work: `useAppTheme().isDark` picks the palette, and every colour in the
 * style sheet below comes from it.
 */
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

// Four screens:
// 1. slide_hero       - light hero splash (entry point)
// 2. step_create_wallet - name the wallet + the two quorum passkeys
// 3. step_ready       - wallet created confirmation
// 4. step_signin      - sign in / restore an existing wallet
export type OnboardingScreen = 'slide_hero' | 'step_create_wallet' | 'step_ready' | 'step_signin'

export default function SignIn() {
  const insets = useSafeAreaInsets()
  const { updateWallet } = useAuth()
  const { themePreference, setThemePreference, isDark } = useAppTheme()

  // The onboarding flow follows the appearance preference: the light palette is
  // the approved mock, the dark palette is its counterpart.
  const p = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(p), [p])

  // Navigation state across screens
  const [currentScreen, setCurrentScreen] = useState<OnboardingScreen>('slide_hero')
  const [showThemeSheet, setShowThemeSheet] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [creationStep, setCreationStep] = useState<0 | 1 | 2 | 3>(0)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [createdWallet, setCreatedWallet] = useState<HaptixWalletAccount | null>(null)
  const [hasCopiedAddress, setHasCopiedAddress] = useState(false)

  const [walletName, setWalletName] = useState('My Haptix Wallet')
  const [primaryKeyName, setPrimaryKeyName] = useState('Primary Passkey')
  const [secondaryKeyName, setSecondaryKeyName] = useState('Backup Quorum Passkey')

  // Sign In / Restore States
  const [savedWallet, setSavedWallet] = useState<HaptixWalletAccount | null>(null)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [restoreAddress, setRestoreAddress] = useState('')
  const [showAddressInput, setShowAddressInput] = useState(false)

  useEffect(() => {
    getSavedWallet()
      .then((w) => {
        if (w) setSavedWallet(w)
      })
      .catch(() => {})
  }, [currentScreen])

  // --------------------------------------------------------------------------
  // Creation Flow Handlers
  // --------------------------------------------------------------------------
  const handleExecutePasskeyCreation = async () => {
    try {
      setIsCreating(true)
      setCreationStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const finalName = walletName.trim() || 'My Haptix Wallet'

      // 1. Generate a device-bound Secp256r1 (P-256) key
      const primary = await getOrCreatePrimaryPasskey(primaryKeyName.trim() || 'Primary Passkey')

      setCreationStep(2)
      await new Promise((r) => setTimeout(r, 600)) // UI delay before next prompt blocks thread

      // 2. Generate secondary quorum key
      const secondary = await getOrCreateSecondaryPasskey(secondaryKeyName.trim() || 'Backup Quorum Passkey')

      setCreationStep(3)

      // 3. Derive real on-chain Anchor PDA from Secp256r1 public key
      const [walletPda] = getWalletPda(primary.publicKey)

      // 4. Create persistent record
      const newAccount = await createSmartWalletRecord({
        name: finalName,
        primaryPasskeyHex: primary.publicKeyHex,
        secondaryPasskeyHex: secondary.publicKeyHex,
        primaryLabel: primary.label,
        secondaryLabel: secondary.label,
        spendThreshold: 0.1,
        network: 'devnet',
      })
      newAccount.isInitializedOnChain = false
      await saveWallet(newAccount)
      await updateWallet(newAccount)

      // Non-blocking background sync on Devnet
      ;(async () => {
        try {
          const connection = new Connection('https://api.devnet.solana.com', {
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
        } catch {
          // Devnet rate limit / offline: counterfactual wallet remains ready
        }
      })()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setCreatedWallet(newAccount)
      setCurrentScreen('step_ready')
    } catch (err: any) {
      console.error('[Haptix Passkey] Setup error:', err)
      Alert.alert(
        'Passkey Setup Error',
        err?.message || 'Biometric authentication was cancelled or failed. Please try again.',
      )
    } finally {
      setIsCreating(false)
      setCreationStep(0)
    }
  }

  // --------------------------------------------------------------------------
  // Sign In / Restore Flow Handlers (Already have a wallet)
  // --------------------------------------------------------------------------
  const handleSignInWithPasskey = async () => {
    try {
      setIsSigningIn(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      // 1. Check if we already have a saved wallet in storage (Normal Sign In)
      const saved = await getSavedWallet()
      if (saved) {
        const auth = await promptBiometricAuth('Authenticate with biometric passkey to sign in')
        if (!auth.success) {
          Alert.alert('Authentication Failed', auth.error || 'Biometric verification was not completed.')
          return
        }

        if (showAddressInput && restoreAddress.trim()) {
          saved.address = restoreAddress.trim()
          await saveWallet(saved)
        }
        await updateWallet(saved)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        router.replace('/(tabs)')
        return
      }

      // 2. Otherwise, we are RESTORING a wallet on a new device/browser
      const primaryAuth = await authenticatePasskey('Select your Haptix passkey to restore your wallet')

      const targetAddress = showAddressInput && restoreAddress.trim() ? restoreAddress.trim() : ''
      if (!targetAddress) {
        Alert.alert(
          'Address Required',
          'Since this is a new device/browser, we need your Solana smart wallet address to restore your account. Please enter it below.',
        )
        setShowAddressInput(true)
        return
      }

      // Fetch on-chain state to get the public keys
      const connection = new Connection('https://api.devnet.solana.com', { commitment: 'confirmed' })
      let pda: any
      try {
        const { PublicKey } = require('@solana/web3.js')
        pda = new PublicKey(targetAddress)
      } catch {
        Alert.alert('Invalid Address', 'Please enter a valid Solana address.')
        return
      }

      const onchainState = await fetchHaptixWallet(connection, pda)
      if (!onchainState) {
        Alert.alert('Wallet Not Found', 'Could not find a Haptix smart wallet at this address on Devnet.')
        return
      }

      const restored = await createSmartWalletRecord({
        name: 'My Haptix Wallet',
        primaryPasskeyHex: Buffer.from(onchainState.primaryPasskey).toString('hex'),
        secondaryPasskeyHex: Buffer.from(onchainState.secondaryPasskey).toString('hex'),
        primaryLabel: primaryAuth.label,
        secondaryLabel: 'Backup quorum key (device secure storage)',
        spendThreshold: 0.1,
        network: 'devnet',
      })
      restored.address = targetAddress
      restored.isInitializedOnChain = true

      // Save credential ID for future sign-ins
      const AsyncStorage = require('@react-native-async-storage/async-storage').default
      await AsyncStorage.setItem('@haptix_passkey_credential_primary', primaryAuth.credentialId)
      await AsyncStorage.setItem('@haptix_passkey_pubkey_primary', restored.primaryPasskeyHex)

      await saveWallet(restored)
      await updateWallet(restored)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.replace('/(tabs)')
    } catch (err: any) {
      console.error('[Haptix Passkey] Sign in error:', err)
      Alert.alert('Sign In Error', err?.message || 'Could not verify passkey account')
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
    } catch {
      // ignore
    }
  }

  // Finalize onboarding and navigate into main wallet dashboard
  const handleFinishOnboarding = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      if (createdWallet) {
        await updateWallet(createdWallet)
      }
      router.replace('/(tabs)')
    } catch (err: any) {
      router.replace('/(tabs)')
    }
  }

  // Copy wallet address helper with haptic feedback
  const handleCopyAddress = async () => {
    if (!createdWallet?.address) return
    await Clipboard.setString(createdWallet.address)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setHasCopiedAddress(true)
    setTimeout(() => setHasCopiedAddress(false), 2000)
  }

  // --------------------------------------------------------------------------
  // SCREEN 1: LIGHT HERO
  // --------------------------------------------------------------------------
  if (currentScreen === 'slide_hero') {
    return (
      <View
        style={[
          styles.heroContainer,
          { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom + 16, 32) },
        ]}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />

        {/* Decorative background: soft glow, faint orbit arc, two satellites */}
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
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Appearance settings"
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
              setCurrentScreen('step_create_wallet')
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
              setCurrentScreen('step_signin')
            }}
            activeOpacity={0.9}
          >
            <Text style={[styles.heroButtonText, { color: p.heroInk }]}>Sign In to Existing Wallet</Text>
            <MaterialIcons name="arrow-forward" size={20} color={p.heroInk} style={styles.heroButtonArrow} />
          </TouchableOpacity>
        </View>

        <Modal
          visible={showThemeSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setShowThemeSheet(false)}
        >
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

  // --------------------------------------------------------------------------
  // SCREEN 2: SETUP & CREATE WALLET
  // --------------------------------------------------------------------------
  if (currentScreen === 'step_create_wallet') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        {/* Top Header */}
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.stepBackButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('slide_hero')
            }}
          >
            <MaterialIcons name="chevron-left" size={28} color={p.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitleCentered}>Create Wallet</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepMainTitle}>Name your setup</Text>
          <Text style={styles.stepMainSubtitle}>Customize your wallet and passkey names.</Text>

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
            <Text style={styles.inputLabel}>Passkey 1 Name (Device Auth)</Text>
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
            <Text style={styles.inputLabel}>Passkey 2 Name (Backup Auth)</Text>
            <TextInput
              style={styles.textInputField}
              value={secondaryKeyName}
              onChangeText={setSecondaryKeyName}
              placeholder="e.g., Backup Quorum Passkey"
              placeholderTextColor={p.inkMuted}
              autoCorrect={false}
            />
          </View>
        </ScrollView>

        <View style={styles.stepBottomBar}>
          <TouchableOpacity
            style={styles.primaryDarkButton}
            onPress={handleExecutePasskeyCreation}
            disabled={isCreating}
            activeOpacity={0.85}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialIcons name="fingerprint" size={20} color={p.onPrimary} />
              <Text style={styles.primaryDarkButtonText}>Start Setup</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Guided Creation Modal */}
        <Modal visible={creationStep > 0} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ActivityIndicator size="large" color={p.link} style={{ marginBottom: 20 }} />
              <Text style={styles.modalTitle}>Setting up your wallet</Text>

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
          </View>
        </Modal>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 3: YOUR WALLET IS READY
  // --------------------------------------------------------------------------
  if (currentScreen === 'step_ready') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        {/* Top Header */}
        <View style={[styles.stepHeader, { justifyContent: 'center' }]}>
          <Text style={styles.headerTitleCentered}>Success</Text>
        </View>

        <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 16 }}>
            <WalletSuccessGraphic size={76} dark={isDark} />
          </View>

          <Text style={[styles.stepMainTitle, { textAlign: 'center' }]}>Your wallet is ready!</Text>
          <Text style={[styles.stepMainSubtitle, { textAlign: 'center', marginBottom: 28 }]}>
            You can now send, receive, swap
            {`
`}
            and manage AI agents.
          </Text>

          {/* Wallet Address Display Card */}
          <View style={styles.walletReadyCard}>
            <View style={styles.walletReadyAvatar}>
              <HaptixBrandMark size={20} color={p.onPrimary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.walletReadyName}>{createdWallet?.name || walletName || 'My Haptix Wallet'}</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}
                onPress={handleCopyAddress}
                activeOpacity={0.7}
              >
                <Text style={styles.walletReadyAddress}>
                  {hasCopiedAddress
                    ? 'Copied to clipboard!'
                    : ellipsify(createdWallet?.address || '7xQp3a9FDevnetAddress', 4)}
                </Text>
                <CopyChipIcon size={12} color={hasCopiedAddress ? p.link : p.inkMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Verification Checklist */}
          <View style={styles.checklistContainer}>
            <View style={styles.checklistItem}>
              <MaterialIcons name="check-circle" size={20} color={p.success} />
              <Text style={styles.checklistItemText}>Passkeys secured</Text>
            </View>
            <View style={styles.checklistItem}>
              <MaterialIcons name="check-circle" size={20} color={p.success} />
              <Text style={styles.checklistItemText}>Smart account ready</Text>
            </View>
            <View style={styles.checklistItem}>
              <MaterialIcons name="check-circle" size={20} color={p.success} />
              <Text style={styles.checklistItemText}>AI agent controls enabled</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.stepBottomBar}>
          <TouchableOpacity style={styles.primaryDarkButton} onPress={handleFinishOnboarding} activeOpacity={0.85}>
            <Text style={styles.primaryDarkButtonText}>Go to wallet →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 4: SIGN IN / RESTORE WALLET WITH PASSKEY
  // --------------------------------------------------------------------------
  if (currentScreen === 'step_signin') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        {/* Top Header */}
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.stepBackButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('slide_hero')
            }}
          >
            <MaterialIcons name="chevron-left" size={28} color={p.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitleCentered}>Sign In</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 16 }}>
            <BiometricScanGraphic size={96} dark={isDark} />
          </View>

          <Text style={[styles.stepMainTitle, { textAlign: 'center' }]}>Welcome back</Text>
          <Text style={[styles.stepMainSubtitle, { textAlign: 'center', marginBottom: 24 }]}>
            Authenticate with your device biometric passkey to access your Haptix wallet.
          </Text>

          {/* Feature details card */}
          <View style={styles.signinCard}>
            <View style={styles.signinCardHeader}>
              <MaterialIcons name="fingerprint" size={22} color={p.link} />
              <Text style={styles.signinCardTitle}>Passkey Authentication</Text>
            </View>
            <Text style={styles.signinCardDesc}>
              {
                "No seed phrase required. Your key is held in this device's secure storage, and every signature is confirmed with your biometrics."
              }
            </Text>
          </View>

          {/* Optional custom address toggle */}
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
                  onPress={() => {
                    setRestoreAddress('')
                    Haptics.selectionAsync()
                  }}
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

          <View style={[styles.privacyCalloutCard, { alignSelf: 'center', marginTop: 16 }]}>
            <MaterialIcons name="lock" size={18} color={p.inkBody} />
            <Text style={styles.privacyCalloutText}>Your passkey never leaves your device.</Text>
          </View>
        </ScrollView>

        <View style={styles.stepBottomBar}>
          <TouchableOpacity
            style={[styles.primaryDarkButton, isSigningIn && { opacity: 0.8 }]}
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

          <TouchableOpacity
            style={styles.secondaryLinkButton}
            onPress={() => {
              Haptics.selectionAsync()
              setCurrentScreen('step_create_wallet')
            }}
          >
            <Text style={styles.secondaryLinkText}>{"Don't have a wallet? Create one"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return null
}

// ============================================================================
// STYLES
// ============================================================================
const createStyles = (p: OnboardingPalette) =>
  StyleSheet.create({
    // SCREEN 1: HERO (LIGHT)
    heroContainer: {
      flex: 1,
      backgroundColor: p.heroBg,
      paddingHorizontal: 24,
    },
    heroDecor: {
      ...StyleSheet.absoluteFillObject,
      overflow: 'hidden',
    },
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
    heroTopRow: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    heroSettings: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: p.controlBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroLogoBlock: {
      alignItems: 'center',
      marginTop: 16,
    },
    heroWordmark: {
      color: p.heroInk,
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 5,
      marginTop: 12,
    },
    heroCenterArt: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroBottomBlock: {
      width: '100%',
    },
    heroTitleText: {
      color: p.heroInk,
      fontSize: 34,
      fontWeight: '700',
      lineHeight: 41,
      letterSpacing: -0.9,
      marginBottom: 26,
    },
    heroTitleAccent: {
      color: p.heroAccent,
    },
    heroButton: {
      width: '100%',
      height: 56,
      borderRadius: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    heroButtonPrimary: {
      backgroundColor: p.primaryBg,
    },
    heroButtonSecondary: {
      backgroundColor: p.secondaryBg,
    },
    heroButtonText: {
      fontSize: 16.5,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    heroButtonArrow: {
      position: 'absolute',
      right: 22,
    },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: p.sheetBackdrop,
      justifyContent: 'flex-end',
    },
    sheetCard: {
      backgroundColor: p.sheetBg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 24,
      paddingTop: 22,
    },
    sheetTitle: {
      color: p.heroInk,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 6,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 15,
    },
    sheetRowText: {
      color: p.heroInk,
      fontSize: 16,
    },

    // SCREENS 2-4: SHARED STEP LAYOUT (LIGHT)
    lightContainer: {
      flex: 1,
      backgroundColor: p.screenBg,
      justifyContent: 'space-between',
    },
    primaryDarkButton: {
      width: '100%',
      height: 52,
      borderRadius: 26,
      backgroundColor: p.actionBg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryDarkButtonText: {
      color: p.onPrimary,
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: -0.2,
    },

    // SCREENS 2-4: STEP HEADER, INPUTS, BOTTOM BAR
    stepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    stepBackButton: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitleCentered: {
      color: p.ink,
      fontSize: 17,
      fontWeight: '700',
    },
    stepScrollContent: {
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 24,
    },
    stepMainTitle: {
      color: p.ink,
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: -0.4,
      marginBottom: 6,
    },
    stepMainSubtitle: {
      color: p.inkSecondary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 24,
    },
    stepBottomBar: {
      paddingHorizontal: 24,
      paddingBottom: 24,
      gap: 12,
    },

    privacyCalloutCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      maxWidth: 320,
      width: '100%',
      justifyContent: 'center',
    },
    privacyCalloutText: {
      color: p.inkBody,
      fontSize: 13,
      fontWeight: '500',
    },
    secondaryLinkButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
    },
    secondaryLinkText: {
      color: p.link,
      fontSize: 14,
      fontWeight: '600',
    },

    // SCREEN 3: READY SPECIFIC
    walletReadyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 24,
    },
    walletReadyAvatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: p.actionBg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    walletReadyName: {
      color: p.ink,
      fontSize: 15,
      fontWeight: '600',
    },
    walletReadyAddress: {
      color: p.inkSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
    checklistContainer: {
      gap: 14,
      paddingHorizontal: 4,
    },
    checklistItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    checklistItemText: {
      color: p.ink,
      fontSize: 14,
      fontWeight: '500',
    },

    // SCREEN 4: SIGN IN SPECIFIC
    signinCard: {
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    signinCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    signinCardTitle: {
      color: p.ink,
      fontSize: 15,
      fontWeight: '600',
    },
    signinCardDesc: {
      color: p.inkSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    customAddressToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    customAddressToggleText: {
      color: p.inkSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
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
    addressInput: {
      flex: 1,
      color: p.ink,
      fontSize: 13,
      padding: 0,
    },
    pasteBadgeButton: {
      backgroundColor: p.linkSoftBg,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    pasteBadgeText: {
      color: p.link,
      fontSize: 11,
      fontWeight: '600',
    },

    inputGroup: {
      marginBottom: 16,
    },
    inputLabel: {
      color: p.ink,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    textInputField: {
      color: p.ink,
      fontSize: 15,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: p.shadow,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalContent: {
      width: '100%',
      backgroundColor: p.sheetBg,
      borderRadius: 20,
      padding: 24,
      alignItems: 'center',
    },
    modalTitle: {
      color: p.ink,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 20,
    },
    modalStepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      gap: 12,
      marginBottom: 16,
    },
    modalStepText: {
      color: p.inkBody,
      fontSize: 15,
      fontWeight: '500',
    },
  })
