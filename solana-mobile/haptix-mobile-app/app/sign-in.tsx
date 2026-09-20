import React, { useState } from 'react'
import { router } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import Clipboard from '@/utils/clipboard'
import { Connection, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { HaptixWalletAccount, saveWallet, createSmartWalletRecord } from '@/utils/haptix-wallet-storage'
import {
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  promptBiometricAuth,
} from '@/utils/haptix-passkey'
import {
  getWalletPda,
  createInitializeWalletInstruction,
  fetchHaptixWallet,
} from '@/utils/haptix-client'
import { getFundedDevnetPayer, airdropToWalletPda } from '@/utils/haptix-funder'
import { HaptixBrandMark } from '@/components/haptix/haptix-icons'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  PrismDepthButton,
  DepthOutlineButton,
  BookmarkSaveButton,
  CopyActionButton,
  ThemeToggleButton,
} from '@/components/ui'

type OnboardingStep =
  | 'welcome'
  | 'setup_name'
  | 'progress'
  | 'backup_passkey'
  | 'success'
  | 'restore'

export default function SignIn() {
  const { updateWallet, signIn } = useAuth()
  const { theme, isDark } = useAppTheme()
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [walletName, setWalletName] = useState('My Haptix Wallet')
  const [restoreAddress, setRestoreAddress] = useState('')
  const [showAddressInput, setShowAddressInput] = useState(false)
  const [isLearnMoreOpen, setIsLearnMoreOpen] = useState(false)
  const [createdWallet, setCreatedWallet] = useState<HaptixWalletAccount | null>(null)
  const [creationStep, setCreationStep] = useState(0)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [isAddingBackup, setIsAddingBackup] = useState(false)

  // Step 1: Create Authentic Passkey Smart Wallet Flow
  const handleStartCreation = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      const finalName = walletName.trim() || 'My Haptix Wallet'

      // On Native Mobile: enforce physical sensor prompt before starting
      if (Platform.OS !== 'web') {
        const auth = await promptBiometricAuth('Touch fingerprint sensor to create Secp256r1 passkey')
        if (!auth.success) {
          Alert.alert(
            'Biometric Passkey Required',
            auth.error || 'Fingerprint verification was not completed. A verified device passkey is required to create your smart wallet.'
          )
          return
        }
      }

      await executeCreateWallet(finalName)
    } catch (err: any) {
      Alert.alert('Authentication Error', err?.message || 'Biometric authentication failed')
      setStep('setup_name')
    }
  }

  const executeCreateWallet = async (customName?: string) => {
    try {
      const finalName = customName || walletName.trim() || 'My Haptix Wallet'
      setStep('progress')
      setCreationStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      // Step 1: Generate Secp256r1 key in device hardware enclave (on Web: invokes navigator.credentials.create with Touch ID & iCloud Keychain)
      const primary = await getOrCreatePrimaryPasskey(finalName)

      setCreationStep(2)
      // Step 2: Derive real on-chain Anchor PDA from Secp256r1 public key
      const [walletPda] = getWalletPda(primary.publicKey)

      setCreationStep(3)
      // Step 3: Setup spending protection policy & secondary key
      const secondary = await getOrCreateSecondaryPasskey()

      const newAccount = await createSmartWalletRecord({
        name: finalName,
        primaryPasskeyHex: primary.publicKeyHex,
        secondaryPasskeyHex: secondary.publicKeyHex,
        primaryLabel: primary.label,
        secondaryLabel: 'Hardware Security Key (2-of-2 Quorum)',
        spendThreshold: 0.1,
        network: 'devnet',
      })
      newAccount.isInitializedOnChain = false
      await saveWallet(newAccount)
      await updateWallet(newAccount)

      // Non-blocking background sync for Devnet on-chain status (never hangs onboarding)
      ;(async () => {
        try {
          const connection = new Connection('https://api.devnet.solana.com', {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true,
          })
          const existing = await fetchHaptixWallet(connection, walletPda).catch(() => null)
          if (existing) {
            newAccount.isInitializedOnChain = true
            await saveWallet(newAccount)
            await updateWallet(newAccount)
          }
        } catch {
          // Devnet rate limit or network offline: counterfactual wallet remains ready
        }
      })()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setCreatedWallet(newAccount)
      // Progress naturally into introducing Backup Passkey (Passkey #2)
      setStep('backup_passkey')
    } catch (err: any) {
      Alert.alert('Setup Error', err?.message || 'Failed to create passkey smart wallet')
      setStep('welcome')
    }
  }

  // Step 2: Add Backup Passkey Flow
  const handleAddBackupPasskey = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      const auth = await promptBiometricAuth('Verify biometric passkey to pair backup hardware key')
      if (!auth.success) {
        Alert.alert(
          'Authentication Required',
          auth.error || 'Biometric verification was not completed.'
        )
        return
      }

      await executeAddBackupPasskey()
    } catch (err: any) {
      Alert.alert('Authentication Error', err?.message || 'Biometric authentication failed')
    }
  }

  const executeAddBackupPasskey = async () => {
    try {
      setIsAddingBackup(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const secondary = await getOrCreateSecondaryPasskey()

      if (createdWallet) {
        const updated: HaptixWalletAccount = {
          ...createdWallet,
          secondaryPasskeyHex: secondary.publicKeyHex,
          secondaryPasskeyLabel: 'Hardware Security Key (Configured)',
        }
        await saveWallet(updated)
        await updateWallet(updated)
        setCreatedWallet(updated)
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStep('success')
    } catch (err: any) {
      Alert.alert(
        'Backup Notice',
        err?.message || 'Could not register backup passkey. You can configure one anytime in Settings.'
      )
      setStep('success')
    } finally {
      setIsAddingBackup(false)
    }
  }

  // Step 2 Skip: Do this later
  const handleSkipBackup = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setStep('success')
  }

  // Restore existing account using hardware passkey
  const handleRestore = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      const auth = await promptBiometricAuth('Touch fingerprint sensor to unlock Haptix passkey')
      if (!auth.success) {
        Alert.alert(
          'Authentication Required',
          auth.error || 'Biometric verification was not completed.'
        )
        return
      }

      await executeRestore()
    } catch (err: any) {
      Alert.alert('Authentication Error', err?.message || 'Biometric authentication failed')
    }
  }

  const executeRestore = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

      const primary = await getOrCreatePrimaryPasskey()
      const secondary = await getOrCreateSecondaryPasskey()
      const [walletPda] = getWalletPda(primary.publicKey)

      const targetAddress = showAddressInput && restoreAddress.trim() ? restoreAddress.trim() : walletPda.toBase58()

      const restored = await createSmartWalletRecord({
        name: 'Personal Smart Wallet',
        primaryPasskeyHex: primary.publicKeyHex,
        secondaryPasskeyHex: secondary.publicKeyHex,
        primaryLabel: primary.label,
        secondaryLabel: secondary.label,
        spendThreshold: 0.1,
        network: 'devnet',
      })

      restored.address = targetAddress

      // Check on-chain Devnet status gracefully
      const connection = new Connection('https://api.devnet.solana.com', {
        commitment: 'confirmed',
        disableRetryOnRateLimit: true,
      })
      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      restored.isInitializedOnChain = Boolean(onChain)

      await saveWallet(restored)
      await updateWallet(restored)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setCreatedWallet(restored)
      setStep('success')
    } catch (err: any) {
      Alert.alert('Sign In Failed', err?.message || 'Could not verify passkey account')
    }
  }

  // Paste from clipboard helper
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

  // Connect via Solana Mobile Wallet Adapter
  const handleExternalWallet = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      await signIn()
      router.replace('/(tabs)/account')
    } catch {
      Alert.alert(
        'External Wallet',
        'Could not connect via Mobile Wallet Adapter.\n\nYou can create and use your Haptix Smart Wallet directly with your device passkey.',
        [
          { text: 'Create New Wallet', onPress: () => setStep('setup_name') },
          { text: 'Cancel', style: 'cancel' },
        ]
      )
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bgApp }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.contentContainer}>
          {/* ========================================================= */}
          {/* SCREEN: WELCOME                                           */}
          {/* ========================================================= */}
          {step === 'welcome' && (
            <View style={styles.welcomeWrapper}>
              {/* TOP: Brand logo and Quick Theme Toggle */}
              <View style={styles.topSection}>
                <View style={styles.welcomeHeaderRow}>
                  <View style={[styles.brandIconContainer, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
                    <HaptixBrandMark size={32} color={theme.accent} />
                  </View>
                  <ThemeToggleButton size="default" showLabel={false} />
                </View>
              </View>

              {/* CENTER: Strict typographic hierarchy & negative space */}
              <View style={styles.centerSection}>
                <Text style={[styles.wordmark, { color: theme.textPrimary }]}>HAPTIX</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Passkey-secured smart wallet</Text>

                <View style={[styles.supportingRow, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
                  <View style={[styles.securityDot, { backgroundColor: theme.accent }]} />
                  <Text style={[styles.supportingText, { color: theme.textSecondary }]}>No seed phrase required</Text>
                </View>
              </View>

              {/* BOTTOM / ACTIONS: OpenSourceUI Tactile Depth Buttons */}
              <View style={styles.actionSection}>
                {/* Primary CTA: OpenSourceUI PrismDepthButton */}
                <PrismDepthButton
                  size="large"
                  title="Create new wallet"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setStep('setup_name')
                  }}
                />

                {/* Secondary Action: OpenSourceUI DepthOutlineButton */}
                <DepthOutlineButton
                  size="large"
                  title="Already have a wallet? Sign in"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setShowAddressInput(false)
                    setStep('restore')
                  }}
                />

                {/* Tertiary Action */}
                <Pressable
                  style={({ pressed }) => [
                    styles.tertiaryButton,
                    pressed && styles.tertiaryPressed,
                  ]}
                  onPress={handleExternalWallet}
                  accessibilityRole="button"
                  accessibilityLabel="Connect existing wallet with Phantom or Solflare"
                >
                  <Text style={[styles.tertiaryLabel, { color: theme.textSecondary }]}>Connect existing wallet</Text>
                  <Text style={[styles.tertiaryProviders, { color: theme.textMuted }]}>Phantom · Solflare</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ========================================================= */}
          {/* SCREEN 1: CREATE NEW WALLET (setup_name)                   */}
          {/* ========================================================= */}
          {step === 'setup_name' && (
            <View style={styles.flowWrapper}>
              <View style={styles.contentCluster}>
                <Pressable
                  style={styles.navBackButton}
                  onPress={() => setStep('welcome')}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                  accessibilityRole="button"
                  accessibilityLabel="Back to welcome screen"
                >
                  <MaterialIcons name="arrow-back" size={20} color={theme.textSecondary} />
                  <Text style={[styles.navBackText, { color: theme.textSecondary }]}>Back</Text>
                </Pressable>

                <View style={styles.stepHeader}>
                  <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>Name your smart wallet</Text>
                  <Text style={[styles.stepSubtitle, { color: theme.textSecondary }]}>
                    Your wallet will be secured by this device's passkey.
                  </Text>
                  <Text style={[styles.stepSupportingLine, { color: theme.textMuted }]}>
                    Your private credential stays protected by your device.
                  </Text>
                </View>

                {/* Wallet Name Card */}
                <View
                  style={[
                    styles.cardContainer,
                    {
                      backgroundColor: theme.bgCard,
                      borderColor: isInputFocused ? theme.borderFocus : theme.borderDefault,
                    },
                  ]}
                >
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>WALLET NAME</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={[styles.textInput, { color: theme.textPrimary }]}
                      value={walletName}
                      onChangeText={setWalletName}
                      placeholder="My Haptix Wallet"
                      placeholderTextColor={theme.textMuted}
                      selectionColor={theme.accent}
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={() => setIsInputFocused(false)}
                      autoCapitalize="words"
                      autoCorrect={false}
                    />
                    {walletName.length > 0 && (
                      <Pressable
                        onPress={() => {
                          setWalletName('')
                          Haptics.selectionAsync()
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={styles.clearInputButton}
                      >
                        <MaterialIcons name="cancel" size={18} color={theme.textMuted} />
                      </Pressable>
                    )}
                  </View>
                </View>

                {/* Security Card */}
                <View style={[styles.securityCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
                  <View style={styles.securityCardHeader}>
                    <MaterialIcons name="lock-outline" size={17} color={theme.accent} />
                    <Text style={[styles.securityCardTitle, { color: theme.textPrimary }]}>Protected by your device</Text>
                  </View>
                  <Text style={[styles.securityCardDesc, { color: theme.textSecondary }]}>
                    Your passkey stays protected on your device. Haptix verifies your authorization on-chain.
                  </Text>

                  {/* Expandable Technical Detail */}
                  <Pressable
                    style={styles.learnMoreToggle}
                    onPress={() => {
                      Haptics.selectionAsync()
                      setIsLearnMoreOpen(!isLearnMoreOpen)
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.learnMoreText, { color: theme.textSecondary }]}>
                      {isLearnMoreOpen ? 'Hide details' : 'Learn more'}
                    </Text>
                    <MaterialIcons
                      name={isLearnMoreOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                      size={16}
                      color={theme.textMuted}
                    />
                  </Pressable>

                  {isLearnMoreOpen && (
                    <View style={[styles.technicalDetailsBlock, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
                      <Text style={[styles.technicalDetailsText, { color: theme.textSecondary }]}>
                        Haptix uses W3C WebAuthn standards and native Solana Secp256r1 precompile verification. Cryptographic keys remain isolated inside hardware security boundaries and are never exposed to apps, servers, or cloud storage.
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Bottom Actions */}
              <View style={styles.actionCluster}>
                <PrismDepthButton
                  size="large"
                  title="Create passkey"
                  onPress={handleStartCreation}
                />
                <Text style={[styles.buttonHintText, { color: theme.textMuted }]}>
                  You will be prompted to authenticate with biometrics or screen lock.
                </Text>
              </View>
            </View>
          )}

          {/* ========================================================= */}
          {/* STEP: CREATION PROGRESS                                   */}
          {/* ========================================================= */}
          {step === 'progress' && (
            <View style={[styles.flowWrapper, styles.progressWrapper]}>
              <View style={styles.progressHeader}>
                <ActivityIndicator size="small" color={theme.accent} style={{ marginBottom: 22 }} />
                <Text style={styles.stepTitle}>Creating passkey</Text>
                <Text style={styles.stepSubtitleCentered}>
                  Communicating with your device's passkey provider...
                </Text>
              </View>

              <View style={styles.progressCard}>
                <View style={styles.progressRow}>
                  <View
                    style={[
                      styles.stepIndicatorDot,
                      creationStep >= 1 && styles.stepIndicatorDotComplete,
                    ]}
                  >
                    {creationStep >= 1 ? (
                      <MaterialIcons name="check" size={14} color={theme.accentForeground} />
                    ) : (
                      <View style={styles.stepPendingDot} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.progressLabel,
                      creationStep >= 1 && styles.progressLabelActive,
                    ]}
                  >
                    Generating device passkey
                  </Text>
                </View>

                <View style={styles.stepConnectorLine} />

                <View style={styles.progressRow}>
                  <View
                    style={[
                      styles.stepIndicatorDot,
                      creationStep >= 2 && styles.stepIndicatorDotComplete,
                    ]}
                  >
                    {creationStep >= 2 ? (
                      <MaterialIcons name="check" size={14} color="#050811" />
                    ) : (
                      <View style={styles.stepPendingDot} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.progressLabel,
                      creationStep >= 2 && styles.progressLabelActive,
                    ]}
                  >
                    Deriving smart wallet on Solana
                  </Text>
                </View>

                <View style={styles.stepConnectorLine} />

                <View style={styles.progressRow}>
                  <View
                    style={[
                      styles.stepIndicatorDot,
                      creationStep >= 3 && styles.stepIndicatorDotComplete,
                    ]}
                  >
                    {creationStep >= 3 ? (
                      <MaterialIcons name="check" size={14} color="#050811" />
                    ) : (
                      <View style={styles.stepPendingDot} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.progressLabel,
                      creationStep >= 3 && styles.progressLabelActive,
                    ]}
                  >
                    Setting up spending protection
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* ========================================================= */}
          {/* STEP: ADD BACKUP PASSKEY (Passkey #2)                     */}
          {/* ========================================================= */}
          {step === 'backup_passkey' && (
            <View style={styles.flowWrapper}>
              <View style={styles.contentCluster}>
                <View style={styles.stepHeader}>
                  <View style={styles.backupIconWrap}>
                    <MaterialIcons name="shield" size={26} color={theme.accent} />
                  </View>
                  <Text style={styles.stepTitle}>Add a backup passkey</Text>
                  <Text style={styles.stepSubtitle}>
                    Protect high-value actions and recover your wallet if you lose your primary device.
                  </Text>
                </View>

                {/* Multi-device context card */}
                <View style={styles.backupInfoCard}>
                  <View style={styles.backupInfoRow}>
                    <MaterialIcons name="devices" size={18} color="#94A3B8" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.backupInfoTitle}>Multi-device security</Text>
                      <Text style={styles.backupInfoBody}>
                        A backup passkey can live on another device such as another phone, computer, or a hardware security key (e.g. YubiKey).
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardInnerDivider} />

                  <View style={styles.backupInfoRow}>
                    <MaterialIcons name="verified-user" size={18} color="#94A3B8" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.backupInfoTitle}>High-value protection</Text>
                      <Text style={styles.backupInfoBody}>
                        Daily transfers execute with a single tap. Large transfers or policy modifications require 2-of-2 passkey quorum.
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Actions */}
              <View style={styles.actionCluster}>
                <PrismDepthButton
                  size="large"
                  title="Add backup passkey"
                  onPress={handleAddBackupPasskey}
                  loading={isAddingBackup}
                />

                <DepthOutlineButton
                  size="large"
                  title="Do this later"
                  onPress={handleSkipBackup}
                />
              </View>
            </View>
          )}

          {/* ========================================================= */}
          {/* STEP: WALLET READY                                        */}
          {/* ========================================================= */}
          {step === 'success' && createdWallet && (
            <View style={styles.flowWrapper}>
              <View style={styles.contentCluster}>
                <View style={styles.successHeader}>
                  <View style={[styles.successIconBadge, { backgroundColor: theme.accentLight, borderColor: theme.accentGlow }]}>
                    <MaterialIcons name="check" size={24} color={theme.accent} />
                  </View>
                  <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>Wallet ready</Text>
                  <Text style={[styles.stepSubtitleCentered, { color: theme.textSecondary }]}>
                    Your passkey smart wallet is active on Solana Devnet.
                  </Text>
                </View>

                <View style={[styles.summaryCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
                  <View style={styles.summaryRowHeader}>
                    <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>WALLET NAME</Text>
                    <Text style={[styles.summaryValueName, { color: theme.textPrimary }]}>{createdWallet.name}</Text>
                  </View>

                  <View style={[styles.summaryDivider, { backgroundColor: theme.borderSubtle }]} />

                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryKey, { color: theme.textSecondary }]}>Account Address</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.summaryAddressText, { color: theme.textPrimary }]}>
                        {createdWallet.address.slice(0, 6)}...{createdWallet.address.slice(-6)}
                      </Text>
                      <CopyActionButton value={createdWallet.address} compact showLabel={false} />
                    </View>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryKey, { color: theme.textSecondary }]}>Primary Passkey</Text>
                    <Text style={[styles.summaryValActive, { color: theme.accent }]}>This device (Active)</Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryKey, { color: theme.textSecondary }]}>Backup Passkey</Text>
                    <Text style={createdWallet.secondaryPasskeyLabel?.includes('Configured') ? [styles.summaryValActive, { color: theme.accent }] : [styles.summaryVal, { color: theme.textMuted }]}>
                      {createdWallet.secondaryPasskeyLabel?.includes('Configured') ? 'Configured' : 'Not added'}
                    </Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryKey, { color: theme.textSecondary }]}>Fast-Lane Threshold</Text>
                    <Text style={[styles.summaryVal, { color: theme.textSecondary }]}>≤ {createdWallet.spendThreshold} SOL</Text>
                  </View>
                </View>

                {/* OpenSourceUI BookmarkSaveButton */}
                <View style={{ marginTop: 14, alignItems: 'center' }}>
                  <BookmarkSaveButton
                    label="Bookmark smart wallet"
                    savedLabel="Smart wallet bookmarked"
                  />
                </View>
              </View>

              <View style={styles.actionCluster}>
                <PrismDepthButton
                  size="large"
                  title="Open wallet"
                  onPress={() => router.replace('/(tabs)/account')}
                />
              </View>
            </View>
          )}

          {/* ========================================================= */}
          {/* SCREEN 2: SIGN IN TO WALLET (restore)                     */}
          {/* ========================================================= */}
          {step === 'restore' && (
            <View style={styles.flowWrapper}>
              <View style={styles.contentCluster}>
                <Pressable
                  style={({ pressed }) => [
                    styles.navBackButton,
                    pressed && styles.tertiaryPressed,
                  ]}
                  onPress={() => {
                    if (showAddressInput) {
                      setShowAddressInput(false)
                    } else {
                      setStep('welcome')
                    }
                  }}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                >
                  <MaterialIcons name="arrow-back" size={20} color="#94A3B8" />
                  <Text style={styles.navBackText}>Back</Text>
                </Pressable>

                <View style={styles.stepHeader}>
                  <Text style={styles.stepTitle}>
                    {showAddressInput ? 'Sign in with address' : 'Sign in to wallet'}
                  </Text>
                  <Text style={styles.stepSubtitle}>
                    {showAddressInput
                      ? 'Enter your smart wallet address to access your account.'
                      : 'Use your registered passkey to access your Haptix wallet.'}
                  </Text>
                </View>

                {/* Passkey Primary Path (Default) */}
                {!showAddressInput ? (
                  <View style={styles.securityCard}>
                    <View style={styles.securityCardHeader}>
                      <MaterialIcons name="fingerprint" size={20} color={theme.accent} />
                      <Text style={styles.securityCardTitle}>Passkey authentication</Text>
                    </View>
                    <Text style={styles.securityCardDesc}>
                      Sign in securely with Touch ID, Face ID, or your device screen lock. No passwords or seed phrases required.
                    </Text>
                  </View>
                ) : (
                  /* Progressive Disclosure: Address Input */
                  <View
                    style={[
                      styles.cardContainer,
                      isInputFocused && styles.cardContainerFocused,
                    ]}
                  >
                    <Text style={styles.inputLabel}>SMART ACCOUNT ADDRESS</Text>
                    <View style={styles.inputRow}>
                      <TextInput
                        style={styles.textInput}
                        value={restoreAddress}
                        onChangeText={setRestoreAddress}
                        placeholder="Paste wallet address"
                        placeholderTextColor="#475569"
                        selectionColor={theme.accent}
                        onFocus={() => setIsInputFocused(true)}
                        onBlur={() => setIsInputFocused(false)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {restoreAddress.length > 0 ? (
                        <Pressable
                          onPress={() => {
                            setRestoreAddress('')
                            Haptics.selectionAsync()
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          style={styles.clearInputButton}
                        >
                          <MaterialIcons name="cancel" size={18} color="#64748B" />
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={handlePasteAddress}
                          style={styles.pasteBadgeButton}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.pasteBadgeText}>Paste</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>

              {/* Actions Section */}
              <View style={styles.actionCluster}>
                {!showAddressInput ? (
                  <>
                    <PrismDepthButton
                      size="large"
                      title="Sign in with passkey"
                      onPress={handleRestore}
                    />

                    <DepthOutlineButton
                      size="large"
                      title="Use wallet address instead"
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        setShowAddressInput(true)
                      }}
                    />
                  </>
                ) : (
                  <>
                    <PrismDepthButton
                      size="large"
                      title="Continue"
                      onPress={handleRestore}
                    />

                    <DepthOutlineButton
                      size="large"
                      title="Sign in with passkey instead"
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        setShowAddressInput(false)
                      }}
                    />
                  </>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050811',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  contentContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },

  /* ------------------------------------------------------------- */
  /* WELCOME SCREEN STYLES                                         */
  /* ------------------------------------------------------------- */
  welcomeWrapper: {
    flex: 1,
    justifyContent: 'space-between',
    minHeight: 480,
    paddingVertical: 16,
  },
  topSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  welcomeHeaderRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  brandIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },

  centerSection: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  wordmark: {
    fontSize: 34,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 2.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16.5,
    fontWeight: '400',
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center',
    letterSpacing: 0.15,
  },
  supportingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
  },
  securityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  supportingText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7E8FA6',
    letterSpacing: 0.2,
  },

  actionSection: {
    width: '100%',
    gap: 12,
    paddingTop: 16,
  },

  /* ------------------------------------------------------------- */
  /* BUTTON STYLES & INTERACTIONS                                  */
  /* ------------------------------------------------------------- */
  primaryButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    paddingVertical: 15,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  buttonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.985 }],
  },
  tertiaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  tertiaryLabel: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  tertiaryProviders: {
    color: '#475569',
    fontSize: 12,
    marginTop: 3,
    letterSpacing: 0.3,
  },
  tertiaryPressed: {
    opacity: 0.65,
  },

  /* ------------------------------------------------------------- */
  /* FLOW SCREENS (Setup, Progress, Backup, Success, Restore)       */
  /* ------------------------------------------------------------- */
  flowWrapper: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 8,
  },
  contentCluster: {
    width: '100%',
  },
  actionCluster: {
    width: '100%',
    paddingTop: 24,
    gap: 12,
  },
  buttonHintText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },

  navBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 16,
  },
  navBackText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },

  stepHeader: {
    marginBottom: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 0.2,
  },
  stepSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 6,
    lineHeight: 20,
  },
  stepSupportingLine: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  stepSubtitleCentered: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },

  /* Cards & Inputs */
  cardContainer: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  cardContainerFocused: {
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  inputLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  textInput: {
    flex: 1,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '500',
  },
  clearInputButton: {
    padding: 4,
  },
  pasteBadgeButton: {
    backgroundColor: '#141414',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#262626',
  },
  pasteBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '600',
  },

  /* Security Card */
  securityCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 16,
  },
  securityCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  securityCardTitle: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '600',
  },
  securityCardDesc: {
    color: '#7E8FA6',
    fontSize: 12.5,
    lineHeight: 18,
  },
  learnMoreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 2,
  },
  learnMoreText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '500',
  },
  technicalDetailsBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#262626',
  },
  technicalDetailsText: {
    color: '#64748B',
    fontSize: 11.5,
    lineHeight: 17,
  },

  /* Backup Passkey Styles */
  backupIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  backupInfoCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  backupInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  backupInfoTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  backupInfoBody: {
    color: '#7E8FA6',
    fontSize: 12,
    lineHeight: 17,
  },
  cardInnerDivider: {
    height: 1,
    backgroundColor: '#262626',
  },

  /* Progress Styles */
  progressWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  progressHeader: {
    alignItems: 'center',
    marginBottom: 36,
  },
  progressCard: {
    width: '100%',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 16,
    padding: 24,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stepIndicatorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepIndicatorDotComplete: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  stepPendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#475569',
  },
  stepConnectorLine: {
    width: 2,
    height: 20,
    backgroundColor: '#262626',
    marginLeft: 11,
    marginVertical: 4,
  },
  progressLabel: {
    color: '#64748B',
    fontSize: 13.5,
    fontWeight: '500',
  },
  progressLabelActive: {
    color: '#F8FAFC',
    fontWeight: '600',
  },

  /* Success Screen */
  successHeader: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  successIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    padding: 18,
  },
  summaryRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  summaryValueName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  summaryKey: {
    color: '#64748B',
    fontSize: 12.5,
  },
  summaryAddressText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  summaryVal: {
    color: '#7E8FA6',
    fontSize: 12.5,
    fontWeight: '500',
  },
  summaryValActive: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
})
