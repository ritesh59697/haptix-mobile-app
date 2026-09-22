import React, { useState, useEffect } from 'react'
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
  HeroSplashArt,
  PasskeyCardsArt,
  AgentStackArt,
  MultiChainArt,
  BiometricScanGraphic,
  WalletSuccessGraphic,
  PhantomLogo,
  SolflareLogo,
  MetaMaskLogo,
  OtherWalletLogo,
} from '@/components/haptix/haptix-onboarding-graphics'
import { StepPlayer } from '@/components/ui'

// 8 Distinct Screens from the Approved Reference Design + Sign In Option:
// Screens 1-4: Feature Carousel / Value Propositions
// Screens 5-7: Passkey Smart Wallet Setup & Ready Confirmation
// Screen 8: Connect / Import Existing Wallet
// Screen 9: Sign In to Existing Wallet (Passkey / Address Restore)
export type OnboardingScreen =
  | 'slide_hero' // Screen 1: Dark Glassmorphic Splash
  | 'slide_passkey' // Screen 2: No seed phrase. Just your passkey.
  | 'slide_agents' // Screen 3: Give agents spending power
  | 'slide_multichain' // Screen 4: One wallet. More possibilities.
  | 'step_overview' // Screen 5: Create your wallet (3-step overview)
  | 'step_biometrics' // Screen 6: Create a passkey (Face ID scanner)
  | 'step_ready' // Screen 7: Your wallet is ready! (PDA & checklist)
  | 'step_connect' // Screen 8: Or connect an existing wallet
  | 'step_signin' // Screen 9: Sign In to Existing Wallet with Passkey

const CAROUSEL_SLIDES: OnboardingScreen[] = ['slide_hero', 'slide_passkey', 'slide_agents', 'slide_multichain']

export default function SignIn() {
  const insets = useSafeAreaInsets()
  const { updateWallet } = useAuth()
  const { theme, isDark } = useAppTheme()

  // Navigation state across screens
  const [currentScreen, setCurrentScreen] = useState<OnboardingScreen>('slide_hero')
  const [isCreating, setIsCreating] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [createdWallet, setCreatedWallet] = useState<HaptixWalletAccount | null>(null)
  const [hasCopiedAddress, setHasCopiedAddress] = useState(false)

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
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const finalName = 'My Haptix Wallet'

      // 1. Generate a device-bound Secp256r1 (P-256) key, held in OS secure
      // storage behind a biometric prompt. Software key, not a secure element.
      const primary = await getOrCreatePrimaryPasskey(finalName)

      // 2. Derive real on-chain Anchor PDA from Secp256r1 public key
      const [walletPda] = getWalletPda(primary.publicKey)

      // 3. Generate secondary quorum key
      const secondary = await getOrCreateSecondaryPasskey()

      // 4. Create persistent record
      const newAccount = await createSmartWalletRecord({
        name: finalName,
        primaryPasskeyHex: primary.publicKeyHex,
        secondaryPasskeyHex: secondary.publicKeyHex,
        primaryLabel: primary.label,
        secondaryLabel: 'Backup quorum key (device secure storage)',
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
      // Advance to Screen 7: "Your wallet is ready!"
      setCurrentScreen('step_ready')
    } catch (err: any) {
      console.error('[Haptix Passkey] Setup error:', err)
      Alert.alert(
        'Passkey Setup Error',
        err?.message || 'Biometric authentication was cancelled or failed. Please try again.',
      )
    } finally {
      setIsCreating(false)
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

  // External wallet connectors. Wallet Standard / MWA deeplinking is not wired
  // up in this build, so we say so instead of showing a success alert for a
  // connection that never happened.
  const handleConnectProvider = async (provider: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Alert.alert(
      `${provider} Not Supported Yet`,
      `${provider} connections are not wired up in this build. Haptix currently signs with device passkeys, so you can create or restore a passkey wallet instead.`,
    )
  }

  // Helper for 4-segment progress bar on setup screens (5, 6, 7, 8)
  const renderProgressBar = (activeStep: 1 | 2 | 3 | 4) => (
    <View style={styles.progressTrackRow}>
      <StepPlayer steps={4} value={activeStep - 1} showControl={false} seekable={false} size={24} />
    </View>
  )

  // --------------------------------------------------------------------------
  // SCREEN 1: DARK GLASSMORPHIC HERO SPLASH
  // --------------------------------------------------------------------------
  if (currentScreen === 'slide_hero') {
    return (
      <View
        style={[
          styles.heroContainer,
          { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom + 16, 32) },
        ]}
      >
        <View style={styles.heroTopBar}>
          <HaptixBrandMark size={32} color="#FFFFFF" />
        </View>

        <View style={styles.heroCenterArt}>
          <HeroSplashArt size={300} />
        </View>

        <View style={styles.heroBottomBlock}>
          <Text style={styles.heroBrandText}>HAPTIX</Text>
          <Text style={styles.heroTitleText}>A smarter way{'\n'}to own crypto</Text>
          <Text style={styles.heroSubtitleText}>Passkey-secured. Agent-ready.{'\n'}No seed phrase required.</Text>

          {/* StepPlayer Interactive Stepped Progress (swamimalode07/rare-ui/step-player) */}
          <View style={styles.stepPlayerRow}>
            <StepPlayer
              steps={4}
              value={0}
              onValueChange={(idx) => setCurrentScreen(CAROUSEL_SLIDES[idx])}
              duration={4000}
              showControl={true}
              seekable={true}
              size={34}
              onComplete={() => setCurrentScreen('step_overview')}
            />
          </View>

          {/* CTA: Get started */}
          <TouchableOpacity
            style={styles.heroButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('slide_passkey')
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.heroButtonText}>Get started →</Text>
          </TouchableOpacity>

          {/* Already have a wallet? Sign in */}
          <TouchableOpacity
            style={styles.heroSecondaryLink}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_signin')
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.heroSecondaryLinkText}>
              Already have a wallet? <Text style={styles.heroSecondaryLinkHighlight}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 2: NO SEED PHRASE. JUST YOUR PASSKEY.
  // --------------------------------------------------------------------------
  if (currentScreen === 'slide_passkey') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        <View style={styles.carouselHeader}>
          <HaptixBrandMark size={28} color="#0F172A" />
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync()
              setCurrentScreen('step_overview')
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.carouselArtArea}>
          <PasskeyCardsArt size={260} />
        </View>

        <View style={styles.carouselTextBlock}>
          <Text style={styles.categoryBadgeText}>SECURE BY DESIGN</Text>
          <Text style={styles.carouselTitleText}>No seed phrase.{'\n'}Just your passkey.</Text>
          <Text style={styles.carouselBodyText}>
            Your wallet is secured with your biometrics and device passkeys. Simple, safe, and built for the next
            generation.
          </Text>

          {/* StepPlayer Interactive Stepped Progress */}
          <View style={styles.stepPlayerRow}>
            <StepPlayer
              steps={4}
              value={1}
              onValueChange={(idx) => setCurrentScreen(CAROUSEL_SLIDES[idx])}
              duration={4000}
              showControl={true}
              seekable={true}
              size={34}
              onComplete={() => setCurrentScreen('step_overview')}
            />
          </View>

          <TouchableOpacity
            style={styles.primaryDarkButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('slide_agents')
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryDarkButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 3: GIVE AGENTS SPENDING POWER (WITHIN YOUR RULES).
  // --------------------------------------------------------------------------
  if (currentScreen === 'slide_agents') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        <View style={styles.carouselHeader}>
          <HaptixBrandMark size={28} color="#0F172A" />
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync()
              setCurrentScreen('step_overview')
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.carouselArtArea}>
          <AgentStackArt size={260} />
        </View>

        <View style={styles.carouselTextBlock}>
          <Text style={styles.categoryBadgeText}>BUILT FOR AI AGENTS</Text>
          <Text style={styles.carouselTitleText}>
            Give agents{'\n'}spending power{'\n'}(within your rules).
          </Text>
          <Text style={styles.carouselBodyText}>
            Set limits, approve actions, and keep control. Your agents work for you, not the other way around.
          </Text>

          {/* StepPlayer Interactive Stepped Progress */}
          <View style={styles.stepPlayerRow}>
            <StepPlayer
              steps={4}
              value={2}
              onValueChange={(idx) => setCurrentScreen(CAROUSEL_SLIDES[idx])}
              duration={4000}
              showControl={true}
              seekable={true}
              size={34}
              onComplete={() => setCurrentScreen('step_overview')}
            />
          </View>

          <TouchableOpacity
            style={styles.primaryDarkButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('slide_multichain')
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryDarkButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 4: ONE WALLET. MORE POSSIBILITIES.
  // --------------------------------------------------------------------------
  if (currentScreen === 'slide_multichain') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        <View style={styles.carouselHeader}>
          <HaptixBrandMark size={28} color="#0F172A" />
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync()
              setCurrentScreen('step_overview')
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.carouselArtArea}>
          <MultiChainArt size={260} />
        </View>

        <View style={styles.carouselTextBlock}>
          <Text style={styles.categoryBadgeText}>MULTI-CHAIN READY</Text>
          <Text style={styles.carouselTitleText}>One wallet.{'\n'}More possibilities.</Text>
          <Text style={styles.carouselBodyText}>
            Use Haptix across major chains, starting with Solana. More coming soon.
          </Text>

          {/* StepPlayer Interactive Stepped Progress */}
          <View style={styles.stepPlayerRow}>
            <StepPlayer
              steps={4}
              value={3}
              onValueChange={(idx) => setCurrentScreen(CAROUSEL_SLIDES[idx])}
              duration={4000}
              showControl={true}
              seekable={true}
              size={34}
              onComplete={() => setCurrentScreen('step_overview')}
            />
          </View>

          <TouchableOpacity
            style={styles.primaryDarkButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_overview')
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryDarkButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 5: CREATE YOUR WALLET (3-STEP OVERVIEW)
  // --------------------------------------------------------------------------
  if (currentScreen === 'step_overview') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        {/* Top Header with Back and Progress Segment 1 */}
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.stepBackButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('slide_multichain')
            }}
          >
            <MaterialIcons name="chevron-left" size={28} color="#0F172A" />
          </TouchableOpacity>
          <View style={styles.stepProgressArea}>{renderProgressBar(1)}</View>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepMainTitle}>Create your wallet</Text>
          <Text style={styles.stepMainSubtitle}>Set up your Haptix wallet with a passkey.</Text>

          {/* 3 Step Cards */}
          <View style={styles.cardsStack}>
            {/* Step 1: Create a passkey */}
            <View style={styles.featureRowCard}>
              <View style={styles.featureIconWrap}>
                <MaterialIcons name="fingerprint" size={24} color="#2563EB" />
              </View>
              <View style={styles.featureTextGroup}>
                <Text style={styles.featureCardTitle}>Create a passkey</Text>
                <Text style={styles.featureCardSubtitle}>Use Face ID, Touch ID or your device lock.</Text>
              </View>
            </View>

            {/* Step 2: Secure your account */}
            <View style={styles.featureRowCard}>
              <View style={styles.featureIconWrap}>
                <MaterialIcons name="security" size={24} color="#2563EB" />
              </View>
              <View style={styles.featureTextGroup}>
                <Text style={styles.featureCardTitle}>Secure your account</Text>
                <Text style={styles.featureCardSubtitle}>Protected by advanced encryption.</Text>
              </View>
            </View>

            {/* Step 3: You're ready */}
            <View style={styles.featureRowCard}>
              <View style={styles.featureIconWrap}>
                <MaterialIcons name="check-circle" size={24} color="#2563EB" />
              </View>
              <View style={styles.featureTextGroup}>
                <Text style={styles.featureCardTitle}>{"You're ready"}</Text>
                <Text style={styles.featureCardSubtitle}>Start using your wallet in seconds.</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={styles.stepBottomBar}>
          <TouchableOpacity
            style={styles.primaryDarkButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_biometrics')
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryDarkButtonText}>Create wallet →</Text>
          </TouchableOpacity>

          {/* Already have a wallet? Sign in */}
          <TouchableOpacity
            style={styles.stepSecondaryLink}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_signin')
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.stepSecondaryLinkText}>
              Already have a wallet? <Text style={styles.stepSecondaryLinkHighlight}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 6: CREATE A PASSKEY (BIOMETRIC SCANNER HERO)
  // --------------------------------------------------------------------------
  if (currentScreen === 'step_biometrics') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        {/* Top Header with Back and Progress Segment 2 */}
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.stepBackButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_overview')
            }}
          >
            <MaterialIcons name="chevron-left" size={28} color="#0F172A" />
          </TouchableOpacity>
          <View style={styles.stepProgressArea}>{renderProgressBar(2)}</View>
          <View style={{ width: 32 }} />
        </View>

        <View style={styles.biometricsContent}>
          {/* Centered Large Biometric Scan Graphic */}
          <BiometricScanGraphic size={96} />

          <Text style={styles.bioTitleText}>Create a passkey</Text>
          <Text style={styles.bioSubtitleText}>
            Use Face ID to create a secure passkey{'\n'}for your Haptix wallet.
          </Text>

          {/* Privacy Note Callout */}
          <View style={styles.privacyCalloutCard}>
            <MaterialIcons name="lock" size={18} color="#475569" />
            <Text style={styles.privacyCalloutText}>Your passkey never leaves your device.</Text>
          </View>
        </View>

        <View style={styles.stepBottomBar}>
          {/* Continue with Face ID button */}
          <TouchableOpacity
            style={[styles.primaryDarkButton, isCreating && { opacity: 0.8 }]}
            onPress={handleExecutePasskeyCreation}
            disabled={isCreating}
            activeOpacity={0.85}
          >
            {isCreating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="fingerprint" size={20} color="#FFFFFF" />
                <Text style={styles.primaryDarkButtonText}>Continue with Face ID</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Link: Use another method */}
          <TouchableOpacity
            style={styles.secondaryLinkButton}
            onPress={() => {
              Haptics.selectionAsync()
              setCurrentScreen('step_connect')
            }}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
          >
            <Text style={styles.secondaryLinkText}>Use another method</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 7: YOUR WALLET IS READY!
  // --------------------------------------------------------------------------
  if (currentScreen === 'step_ready') {
    return (
      <SafeAreaView style={styles.lightContainer}>
        {/* Top Header with Back and Progress Segment 3 */}
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.stepBackButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_biometrics')
            }}
          >
            <MaterialIcons name="chevron-left" size={28} color="#0F172A" />
          </TouchableOpacity>
          <View style={styles.stepProgressArea}>{renderProgressBar(3)}</View>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 16 }}>
            <WalletSuccessGraphic size={76} />
          </View>

          <Text style={[styles.stepMainTitle, { textAlign: 'center' }]}>Your wallet is ready!</Text>
          <Text style={[styles.stepMainSubtitle, { textAlign: 'center', marginBottom: 28 }]}>
            You can now send, receive, swap{'\n'}and manage AI agents.
          </Text>

          {/* Wallet Address Display Card */}
          <View style={styles.walletReadyCard}>
            <View style={styles.walletReadyAvatar}>
              <HaptixBrandMark size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.walletReadyName}>{createdWallet?.name || 'My Haptix Wallet'}</Text>
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
                <CopyChipIcon size={12} color={hasCopiedAddress ? '#2563EB' : '#94A3B8'} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Verification Checklist */}
          <View style={styles.checklistContainer}>
            <View style={styles.checklistItem}>
              <MaterialIcons name="check-circle" size={20} color="#10B981" />
              <Text style={styles.checklistItemText}>Passkey secured</Text>
            </View>
            <View style={styles.checklistItem}>
              <MaterialIcons name="check-circle" size={20} color="#10B981" />
              <Text style={styles.checklistItemText}>Smart account ready</Text>
            </View>
            <View style={styles.checklistItem}>
              <MaterialIcons name="check-circle" size={20} color="#10B981" />
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
  // SCREEN 9: SIGN IN / RESTORE WALLET WITH PASSKEY
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
            <MaterialIcons name="chevron-left" size={28} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitleCentered}>Sign In</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 16 }}>
            <BiometricScanGraphic size={96} />
          </View>

          <Text style={[styles.stepMainTitle, { textAlign: 'center' }]}>Welcome back</Text>
          <Text style={[styles.stepMainSubtitle, { textAlign: 'center', marginBottom: 24 }]}>
            Authenticate with your device biometric passkey to access your Haptix wallet.
          </Text>

          {/* Feature details card */}
          <View style={styles.signinCard}>
            <View style={styles.signinCardHeader}>
              <MaterialIcons name="fingerprint" size={22} color="#2563EB" />
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
              color="#64748B"
            />
          </TouchableOpacity>

          {showAddressInput && (
            <View style={styles.addressInputContainer}>
              <TextInput
                style={styles.addressInput}
                value={restoreAddress}
                onChangeText={setRestoreAddress}
                placeholder="Paste Solana smart wallet address"
                placeholderTextColor="#94A3B8"
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
                  <MaterialIcons name="cancel" size={18} color="#94A3B8" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pasteBadgeButton} onPress={handlePasteAddress}>
                  <Text style={styles.pasteBadgeText}>Paste</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={[styles.privacyCalloutCard, { alignSelf: 'center', marginTop: 16 }]}>
            <MaterialIcons name="lock" size={18} color="#475569" />
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
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="fingerprint" size={20} color="#FFFFFF" />
                <Text style={styles.primaryDarkButtonText}>Sign in with Biometrics</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryLinkButton}
            onPress={() => {
              Haptics.selectionAsync()
              setCurrentScreen('step_overview')
            }}
          >
            <Text style={styles.secondaryLinkText}>{"Don't have a wallet? Create one"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // --------------------------------------------------------------------------
  // SCREEN 8: OR CONNECT AN EXISTING WALLET
  // --------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.lightContainer}>
      {/* Top Header with Back and Progress Segment 4 */}
      <View style={styles.stepHeader}>
        <TouchableOpacity
          style={styles.stepBackButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setCurrentScreen('step_biometrics')
          }}
        >
          <MaterialIcons name="chevron-left" size={28} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.stepProgressArea}>{renderProgressBar(4)}</View>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.stepScrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.stepMainTitle}>Or connect an existing wallet</Text>
        <Text style={styles.stepMainSubtitle}>Import or link your wallet to use with Haptix.</Text>

        {/* Provider List */}
        <View style={styles.providerList}>
          {/* Haptix Passkey (Biometrics) */}
          <TouchableOpacity
            style={[styles.providerRow, { borderColor: '#93C5FD', backgroundColor: '#EFF6FF' }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setCurrentScreen('step_signin')
            }}
            activeOpacity={0.75}
          >
            <View style={styles.providerLeft}>
              <View style={styles.providerPasskeyBadge}>
                <HaptixBrandMark size={20} color="#FFFFFF" />
              </View>
              <View>
                <Text style={[styles.providerNameText, { color: '#1E40AF' }]}>Haptix Passkey</Text>
                <Text style={styles.providerSubText}>Sign in with device biometrics</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#2563EB" />
          </TouchableOpacity>

          {/* Phantom */}
          <TouchableOpacity
            style={styles.providerRow}
            onPress={() => handleConnectProvider('Phantom')}
            activeOpacity={0.75}
          >
            <View style={styles.providerLeft}>
              <PhantomLogo size={36} />
              <View>
                <Text style={styles.providerNameText}>Phantom</Text>
                <Text style={styles.providerSubText}>Solana wallet</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#94A3B8" />
          </TouchableOpacity>

          {/* Solflare */}
          <TouchableOpacity
            style={styles.providerRow}
            onPress={() => handleConnectProvider('Solflare')}
            activeOpacity={0.75}
          >
            <View style={styles.providerLeft}>
              <SolflareLogo size={36} />
              <View>
                <Text style={styles.providerNameText}>Solflare</Text>
                <Text style={styles.providerSubText}>Solana native wallet</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#94A3B8" />
          </TouchableOpacity>

          {/* MetaMask */}
          <TouchableOpacity
            style={styles.providerRow}
            onPress={() => handleConnectProvider('MetaMask')}
            activeOpacity={0.75}
          >
            <View style={styles.providerLeft}>
              <MetaMaskLogo size={36} />
              <View>
                <Text style={styles.providerNameText}>MetaMask</Text>
                <Text style={styles.providerSubText}>Multi-chain wallet</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#94A3B8" />
          </TouchableOpacity>

          {/* Other wallet */}
          <TouchableOpacity
            style={styles.providerRow}
            onPress={() => handleConnectProvider('Other Wallet')}
            activeOpacity={0.75}
          >
            <View style={styles.providerLeft}>
              <OtherWalletLogo size={36} />
              <View>
                <Text style={styles.providerNameText}>Other wallet</Text>
                <Text style={styles.providerSubText}>Mobile Wallet Adapter</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.stepBottomBar}>
        <TouchableOpacity
          style={styles.secondaryLinkButton}
          onPress={() => {
            Haptics.selectionAsync()
            setCurrentScreen('step_overview')
          }}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
        >
          <Text style={styles.maybeLaterText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  // SCREEN 1: HERO DARK
  heroContainer: {
    flex: 1,
    backgroundColor: '#07090E',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  heroTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  heroCenterArt: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  heroBottomBlock: {
    width: '100%',
  },
  heroBrandText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 2.5,
    marginBottom: 8,
  },
  heroTitleText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroSubtitleText: {
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  heroButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heroSecondaryLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  heroSecondaryLinkText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  heroSecondaryLinkHighlight: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  stepPlayerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dotPill: {
    width: 22,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
  },
  dotPillActive: {
    backgroundColor: '#FFFFFF',
  },
  dotCircle: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
  },

  // SCREENS 2, 3, 4: CAROUSEL LIGHT
  lightContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
  },
  carouselHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  skipButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  carouselArtArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  carouselTextBlock: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  categoryBadgeText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  carouselTitleText: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 33,
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  carouselBodyText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 24,
  },
  dotsRowLight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dotPillLight: {
    width: 22,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  dotPillActiveLight: {
    backgroundColor: '#0F172A',
  },
  dotCircleLight: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  primaryDarkButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryDarkButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // SCREENS 5, 6, 7, 8, 9: STEP SCREENS
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
  stepProgressArea: {
    flex: 1,
    marginHorizontal: 16,
  },
  progressTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  progressSegmentActive: {
    backgroundColor: '#1E40AF',
  },
  progressSegmentInactive: {
    backgroundColor: '#E2E8F0',
  },
  headerTitleCentered: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '700',
  },
  stepScrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  stepMainTitle: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  stepMainSubtitle: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  cardsStack: {
    gap: 12,
  },
  featureRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 14,
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureTextGroup: {
    flex: 1,
  },
  featureCardTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  featureCardSubtitle: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  stepBottomBar: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  stepSecondaryLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  stepSecondaryLinkText: {
    color: '#64748B',
    fontSize: 14,
  },
  stepSecondaryLinkHighlight: {
    color: '#2563EB',
    fontWeight: '700',
  },

  // SCREEN 6: BIOMETRICS SPECIFIC
  biometricsContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bioTitleText: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 6,
  },
  bioSubtitleText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  privacyCalloutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    maxWidth: 320,
    width: '100%',
    justifyContent: 'center',
  },
  privacyCalloutText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '500',
  },
  secondaryLinkButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  secondaryLinkText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  maybeLaterText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },

  // SCREEN 7: READY SPECIFIC
  walletReadyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  walletReadyAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  walletReadyName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
  },
  walletReadyAddress: {
    color: '#64748B',
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
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '500',
  },

  // SCREEN 9: SIGN IN SPECIFIC
  signinCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
  },
  signinCardDesc: {
    color: '#64748B',
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
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  addressInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  addressInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    padding: 0,
  },
  pasteBadgeButton: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pasteBadgeText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '600',
  },

  // SCREEN 8: CONNECT PROVIDERS SPECIFIC
  providerList: {
    gap: 12,
  },
  providerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  providerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  providerPasskeyBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerNameText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
  },
  providerSubText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 1,
  },
})
