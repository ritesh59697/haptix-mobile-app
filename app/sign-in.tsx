import React, { useState, useEffect, useMemo, useRef } from 'react'
import { router } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
  ImageBackground,
  Image,
  Animated,
  PanResponder,
  Platform,
  Linking,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import Clipboard from '@/utils/clipboard'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { AppConfig } from '@/constants/app-config'
import { saveWallet, getSavedWallet, createSmartWalletRecord, loadWallets, HaptixWalletAccount } from '@/utils/haptix-wallet-storage'
import { hexToBytes } from '@noble/curves/abstract/utils'
import {
  bindHardwarePasskey,
  credentialIdForRecord,
  getDiscoverablePlatformAssertion,
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  registerDevicePasskey,
  matchLocalSoftwareKey,
  promptBiometricAuth,
  PasskeyInfo,
} from '@/utils/haptix-passkey'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  matchWebAuthnAssertion,
  assertionMatchesPublicKey,
  prepareAssertionVerification,
  preparedAssertionMatchesPublicKey,
} from '@/utils/secp256r1-instruction'
import { getWalletPda, createInitializeWalletInstruction, fetchHaptixWallet, HAPTIX_PROGRAM_ID } from '@/utils/haptix-client'
import { describeRecipientSource, parseRecipientInput } from '@/utils/solana-address'
import { DEFAULT_RECOVERY_TIMELOCK_SECONDS, describeTimelock, parseTimelockInput } from '@/utils/recovery-timelock'
import { getFundedDevnetPayer, getDevnetFunderPublicKey, isDevnetFunder } from '@/utils/haptix-funder'
import { HaptixLogoText, TablerFingerprintIcon } from '@/components/haptix/haptix-icons'
import { ellipsify } from '@/utils/ellipsify'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  HeroOrbLight,
  HeroSplashArt,
  SuperlistDoodleArt,
  BiometricScanGraphic,
} from '@/components/haptix/haptix-onboarding-graphics'
import { HaptixAppLoader } from '@/components/haptix/haptix-app-loader'
import { HaptixRecoveryFlowSheet } from '@/components/haptix/haptix-recovery-flow-sheet'
import { HaptixWalletCreatedContent } from '@/components/haptix/haptix-wallet-created-sheet'
import { HaptixFeatureGuideModal, HAPTIX_GUIDE_STORAGE_KEY } from '@/components/haptix/haptix-feature-guide-modal'
import { StatusBar } from 'expo-status-bar'

type ProgramAccountsPromise = ReturnType<Connection['getProgramAccounts']>

let cachedAccountsPromise: ProgramAccountsPromise | null = null
let cachedAccountsTimestamp = 0
const ACCOUNTS_CACHE_TTL_MS = 60_000

function getCachedOrFetchProgramAccounts(connection: Connection): ProgramAccountsPromise {
  const now = Date.now()
  if (cachedAccountsPromise && now - cachedAccountsTimestamp < ACCOUNTS_CACHE_TTL_MS) {
    return cachedAccountsPromise
  }
  cachedAccountsTimestamp = now
  const p = connection
    .getProgramAccounts(HAPTIX_PROGRAM_ID, {
      dataSlice: { offset: 9, length: 66 },
    })
    .catch((err) => {
      cachedAccountsPromise = null
      throw err
    })
  cachedAccountsPromise = p
  return p
}

const ONBOARDING_BG = require('@/assets/images/onboarding-bg.png')
const FINGERPRINT_HERO_WHITE = require('@/assets/images/fingerprint-hero-white.png')
const FINGERPRINT_HERO_DARK = require('@/assets/images/fingerprint-hero.png')
const FINGERPRINT_HERO_BLUE = require('@/assets/images/fingerprint-hero-blue.png')

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
  danger: string
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
  danger: '#C2413A',
  shadow: 'rgba(0,0,0,0.5)',
}

const darkPalette: OnboardingPalette = {
  heroBg: '#000000',
  heroInk: '#F4F4F7',
  heroAccent: '#9C93FF',
  onPrimary: '#000000',
  primaryBg: '#FFFFFF',
  actionBg: '#FFFFFF',
  secondaryBg: '#111114',
  controlBg: '#111114',
  decorGlow: 'rgba(140,130,255,0.06)',
  decorArc: 'rgba(140,130,255,0.18)',
  decorDotStrong: 'rgba(140,130,255,0.30)',
  decorDotSoft: 'rgba(140,130,255,0.22)',
  sheetBackdrop: 'rgba(0,0,0,0.75)',
  sheetBg: '#0A0A0D',
  screenBg: '#000000',
  surface: '#0D0D10',
  surfaceAlt: '#050507',
  border: '#222226',
  ink: '#F2F2F5',
  inkBody: '#B4B4BE',
  inkSecondary: '#8E8E93',
  inkMuted: '#636366',
  link: '#4F6BFF',
  linkSoftBg: 'rgba(79, 107, 255, 0.12)',
  success: '#34D399',
  danger: '#F87171',
  shadow: 'rgba(0,0,0,0.8)',
}

interface BackupKeyDialogContentProps {
  spendLimitSol: number | string
  isDark: boolean
  textPrimary: string
  textSecondary: string
}

function BackupKeyDialogContent({ spendLimitSol, isDark, textPrimary, textSecondary }: BackupKeyDialogContentProps) {
  const cardBorder = isDark ? '#2A2A28' : '#E5E5EA'
  const cardBg = isDark ? '#141416' : '#F9F9FB'
  const rowDivider = isDark ? '#201F1D' : '#ECECEE'
  const mutedText = isDark ? '#8A8985' : textSecondary
  const bodyText = isDark ? '#F2F1EE' : textPrimary
  const isZeroThreshold = Number(spendLimitSol) === 0

  return (
    <View style={{ gap: 10, marginTop: 4, marginBottom: 2 }}>
      {/* Key Status Card */}
      <View
        style={{
          borderWidth: 1,
          borderColor: cardBorder,
          backgroundColor: cardBg,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 2,
        }}
      >
        {/* Row 1: Primary key added */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 11,
            borderBottomWidth: 1,
            borderBottomColor: rowDivider,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: 'rgba(95, 191, 122, 0.14)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialIcons name="check" size={13} color="#5FBF7A" />
          </View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: bodyText }}>
            Primary key added (This phone)
          </Text>
        </View>

        {/* Row 2: Backup / Co-signer key */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 11,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: isZeroThreshold ? '#4F6BFF' : isDark ? '#3A3A37' : '#C7C7CC',
              backgroundColor: isZeroThreshold ? 'rgba(79, 107, 255, 0.12)' : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isZeroThreshold && <MaterialIcons name="devices" size={12} color="#4F6BFF" />}
          </View>
          <Text style={{ flex: 1, fontSize: 13, color: isZeroThreshold ? bodyText : mutedText }}>
            {isZeroThreshold ? 'Co-signer key' : 'Backup key'}
          </Text>
          <Text style={{ fontSize: 12, color: isZeroThreshold ? '#4F6BFF' : mutedText }}>
            {isZeroThreshold ? 'Second device (Laptop)' : 'Not added yet'}
          </Text>
        </View>
      </View>

      {/* Permissions Breakdown Card */}
      <View
        style={{
          borderWidth: 1,
          borderColor: cardBorder,
          backgroundColor: cardBg,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 2,
        }}
      >
        {isZeroThreshold ? (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 12,
                paddingVertical: 11,
                borderBottomWidth: 1,
                borderBottomColor: rowDivider,
              }}
            >
              <Text style={{ width: 85, fontSize: 13, color: mutedText, fontWeight: '500' }}>
                This phone
              </Text>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: bodyText }}>
                Initiates transfers & signs with primary passkey
              </Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 12,
                paddingVertical: 11,
              }}
            >
              <Text style={{ width: 85, fontSize: 13, color: mutedText, fontWeight: '500' }}>
                Second device
              </Text>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: bodyText }}>
                Approves transactions via Web Vault (Touch ID / Hardware passkey)
              </Text>
            </View>
          </>
        ) : (
          <>
            {/* Row 1: One key */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 12,
                paddingVertical: 11,
                borderBottomWidth: 1,
                borderBottomColor: rowDivider,
              }}
            >
              <Text style={{ width: 68, fontSize: 13, color: mutedText, fontWeight: '500' }}>
                One key
              </Text>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: bodyText }}>
                Send up to {spendLimitSol} SOL
              </Text>
            </View>

            {/* Row 2: Both keys */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 12,
                paddingVertical: 11,
              }}
            >
              <Text style={{ width: 68, fontSize: 13, color: mutedText, fontWeight: '500' }}>
                Both keys
              </Text>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: bodyText }}>
                Larger sends, unlocking the wallet, and cancelling a recovery
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  )
}

export default function SignIn() {
  const insets = useSafeAreaInsets()
  const { activeWallet, isLoading, updateWallet } = useAuth()
  const { themePreference, setThemePreference, isDark } = useAppTheme()
  const dialog = useHaptixDialog()

  // Guard: If the wallet is already authenticated, redirect straight to tabs
  useEffect(() => {
    if (!isLoading && activeWallet) {
      router.replace('/(tabs)')
    }
  }, [isLoading, activeWallet])

  /**
   * Async `confirm`, because the recovery flow has to branch on the answer.
   */
  const confirmBackupKeyDialog = (spendLimit: number | string) =>
    new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const isZeroThreshold = Number(spendLimit) === 0
      dialog.alert(
        isZeroThreshold ? 'Dual-Device Hardware Vault' : 'Add the backup key?',
        undefined,
        isZeroThreshold
          ? [
              { text: 'Log in as Vault (Second device)', style: 'default', onPress: () => finish(false) },
              { text: 'Add local backup key instead', style: 'plain', onPress: () => finish(true) },
            ]
          : [
              { text: 'Add backup key', style: 'default', onPress: () => finish(true) },
              { text: 'Not now', style: 'plain', onPress: () => finish(false) },
            ],
        {
          cancelable: true,
          onDismiss: () => finish(false),
          content: (
            <BackupKeyDialogContent
              spendLimitSol={spendLimit}
              isDark={isDark}
              textPrimary={p.ink}
              textSecondary={p.inkSecondary}
            />
          ),
        },
      )
    })

  const p = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(p, isDark), [p, isDark])

  const [showThemeSheet, setShowThemeSheet] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSignInModal, setShowSignInModal] = useState(false)
  const [showRecoveryModal, setShowRecoveryModal] = useState(false)
  const [showGuideModal, setShowGuideModal] = useState(false)
  const [createdAccount, setCreatedAccount] = useState<{
    name: string
    address: string
    securityMode: 'everyday' | 'vault'
    spendThreshold: number
  } | null>(null)

  // Auto-launch guide once for brand new users
  useEffect(() => {
    async function checkGuide() {
      try {
        const seen = await AsyncStorage.getItem(HAPTIX_GUIDE_STORAGE_KEY)
        if (!seen) {
          setShowGuideModal(true)
        }
      } catch {}
    }
    if (!isLoading && !activeWallet) {
      void checkGuide()
    }
  }, [isLoading, activeWallet])

  // Fluid pull-down gesture to dismiss sign-in bottom sheet
  const panYSignIn = useRef(new Animated.Value(0)).current
  const panResponderSignIn = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 4,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            panYSignIn.setValue(gestureState.dy)
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.8) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
            Animated.timing(panYSignIn, {
              toValue: 600,
              duration: 220,
              useNativeDriver: true,
            }).start(() => {
              panYSignIn.setValue(0)
              setShowSignInModal(false)
            })
          } else {
            Animated.spring(panYSignIn, {
              toValue: 0,
              bounciness: 4,
              useNativeDriver: true,
            }).start()
          }
        },
      }),
    [panYSignIn],
  )

  useEffect(() => {
    if (!showSignInModal) {
      panYSignIn.setValue(0)
    }
  }, [showSignInModal, panYSignIn])

  // Fluid pull-down gesture to dismiss create wallet bottom sheet
  const panYCreate = useRef(new Animated.Value(0)).current
  const panResponderCreate = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 4,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            panYCreate.setValue(gestureState.dy)
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.8) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
            Animated.timing(panYCreate, {
              toValue: 600,
              duration: 220,
              useNativeDriver: true,
            }).start(() => {
              panYCreate.setValue(0)
              setShowCreateModal(false)
            })
          } else {
            Animated.spring(panYCreate, {
              toValue: 0,
              bounciness: 4,
              useNativeDriver: true,
            }).start()
          }
        },
      }),
    [panYCreate],
  )

  useEffect(() => {
    if (!showCreateModal) {
      panYCreate.setValue(0)
      setCreatedAccount(null)
    }
  }, [showCreateModal, panYCreate])

  const [isCreating, setIsCreating] = useState(false)
  const [creationStep, setCreationStep] = useState<0 | 1 | 2 | 3>(0)

  const [walletName, setWalletName] = useState('My Haptix Wallet')
  const [securityMode, setSecurityMode] = useState<'everyday' | 'vault'>('everyday')
  const [primaryKeyName, setPrimaryKeyName] = useState('Primary Passkey')
  const [secondaryKeyName, setSecondaryKeyName] = useState('Backup Key')
  const [guardianInput, setGuardianInput] = useState('')
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
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

  // The guardian is the one address that can ever start a recovery, so it is validated
  // the same way a recipient is: a pasted explorer link or message gets its address
  // extracted, and anything that is not a 32-byte base58 key is named as the mistake it
  // is instead of being stored.
  const guardianParse = useMemo(() => parseRecipientInput(guardianInput), [guardianInput])
  const guardianPublicKey = useMemo(
    () => (guardianParse.address ? new PublicKey(guardianParse.address) : null),
    [guardianParse.address],
  )
  const [timelockInput, setTimelockInput] = useState('')
  const timelockParse = useMemo(() => parseTimelockInput(timelockInput), [timelockInput])

  const [isSigningIn, setIsSigningIn] = useState(false)
  const [restoreAddress, setRestoreAddress] = useState('')
  const [showAddressInput, setShowAddressInput] = useState(false)
  const [isEditingAddress, setIsEditingAddress] = useState(false)
  const [savedWallets, setSavedWallets] = useState<HaptixWalletAccount[]>([])
  const [showGuardianLookup, setShowGuardianLookup] = useState(false)
  const [guardianLookupInput, setGuardianLookupInput] = useState('')
  const [isSearchingGuardian, setIsSearchingGuardian] = useState(false)
  /**
   * Whether this app container already holds a wallet record. `null` until the first
   * read. Drives the wording of the address field: the record lives in AsyncStorage,
   * which is per-container, so a passkey carried in the OS authenticator can outlive it
   * and leave the sheet with nothing that names the wallet.
   */
  const [deviceHasWallet, setDeviceHasWallet] = useState<boolean | null>(null)

  /**
   * What the pasted text actually resolves to.
   *
   * The field used to hand its raw contents to `new PublicKey()`, so an explorer link or
   * a chat line that wrapped the address was rejected as an invalid address rather than
   * being read. `parseRecipientInput` is the same parser the send sheet uses, so a link,
   * a Solana Pay URI and a bare key all land on the same address - or on a reason.
   */
  const restoreParse = useMemo(() => parseRecipientInput(restoreAddress), [restoreAddress])

  const restoreHint = useMemo((): { tone: 'ok' | 'error'; text: string } | null => {
    const raw = restoreAddress.trim()
    if (!raw) return null

    if (restoreParse.address) {
      // Naming the source matters: a pasted link is reduced to just its address here, and
      // without this line the field would look as though it had swallowed the whole paste.
      return {
        tone: 'ok',
        text: describeRecipientSource(restoreParse.source) ?? `Wallet address: ${ellipsify(restoreParse.address, 6)}`,
      }
    }

    // A key being typed is a *prefix* of a valid key until its 32nd character, so
    // reporting "too short" on the way through turns ordinary typing into a wall of red.
    // Anything already shaped wrong - a scheme, a `.sol` name, a 0x block - still reports
    // immediately, because no amount of further typing fixes those.
    if (/^[1-9A-HJ-NP-Za-km-z]{1,31}$/.test(raw)) return null

    return restoreParse.error ? { tone: 'error', text: restoreParse.error } : null
  }, [restoreAddress, restoreParse])

  useEffect(() => {
    getSavedWallet()
      .then((w) => {
        // Just prefetch, we don't automatically route here to let them enjoy the hero,
        // but if they click sign in we can route immediately if it exists.
        setDeviceHasWallet(!!w)
      })
      .catch(() => setDeviceHasWallet(null))
  }, [])

  useEffect(() => {
    if (showSignInModal && savedWallets.length === 0) {
      // Warm up the Solana program accounts cache as soon as the modal is opened
      const connection = new Connection(AppConfig.devnetRpcUrl, { commitment: 'confirmed' })
      getCachedOrFetchProgramAccounts(connection).catch(() => {})
    }
  }, [showSignInModal, savedWallets.length])

  const handleExecutePasskeyCreation = async () => {
    try {
      setIsCreating(true)
      setCreationStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const finalName = walletName.trim() || 'My Haptix Wallet'
      const primaryName = primaryKeyName.trim() || 'Primary Passkey'
      const secondaryName = secondaryKeyName.trim() || 'Backup Key'

      let guardian = guardianPublicKey
      if (!guardian) {
        if (guardianInput.trim()) {
          setShowAdvancedOptions(true)
          dialog.alert(
            'Invalid Guardian Address',
            guardianParse.error || 'Please enter a valid Solana address or leave it blank to auto-generate a recovery key.',
          )
          return
        }
        // Auto-generate a secure backup recovery keypair
        const autoGuardian = Keypair.generate()
        guardian = autoGuardian.publicKey
        try {
          await AsyncStorage.setItem(
            `@haptix_auto_guardian_${autoGuardian.publicKey.toBase58()}`,
            Buffer.from(autoGuardian.secretKey).toString('hex'),
          )
        } catch (e) {
          console.warn('[Haptix] Failed to store auto guardian:', e)
        }
      } else if (isDevnetFunder(guardian)) {
        dialog.alert(
          'Independent Guardian Required',
          'The recovery guardian cannot be a key held by this app or the devnet funder. Please enter an independent external address (e.g. Phantom, Solflare), or leave blank to auto-generate.',
        )
        return
      }
      if (timelockParse.error) {
        dialog.alert('Check the recovery timelock', timelockParse.error)
        return
      }

      // 1. Generate Primary
      const primary = await getOrCreatePrimaryPasskey(primaryName, { forceNew: true })

      setCreationStep(2)
      await new Promise((r) => setTimeout(r, 600))

      // 2. Generate Secondary (Mac Touch ID vs. Security Key vs. Everyday Platform)
      let secondary: PasskeyInfo
      if (securityMode === 'vault' && vaultKeySource === 'mac') {
        const cleanHex = macVaultKeyHex.trim().startsWith('0x')
          ? macVaultKeyHex.trim().slice(2)
          : macVaultKeyHex.trim()
        if (!cleanHex || cleanHex.length !== 66 || (!cleanHex.startsWith('02') && !cleanHex.startsWith('03'))) {
          dialog.alert(
            'Second Device Public Key Required',
            `Please open ${AppConfig.vaultWebUrl} on your second device (laptop, tablet, or 2nd phone), tap "Enroll", and paste the 33-byte public key hex below.`,
          )
          setIsCreating(false)
          setCreationStep(0)
          return
        }
        secondary = {
          id: 'secondary',
          credentialId: 'mac_vault_' + cleanHex.slice(0, 16),
          publicKey: hexToBytes(cleanHex),
          publicKeyHex: cleanHex,
          label: 'Second Device (Vault Key)',
          hasBiometrics: true,
          mode: 'hardware',
          hardwareBacked: true,
        }
        await bindHardwarePasskey('secondary', secondary.credentialId, secondary.publicKeyHex)
      } else if (securityMode === 'vault') {
        secondary = await getOrCreateSecondaryPasskey(secondaryName, {
          forceNew: true,
          attachment: 'securityKey',
        })
      } else {
        // Everyday Mode: Both Primary and Backup are hardware passkeys saved in Google Password Manager!
        // Challenge is SHA-256 hashed on-chain so 2-of-2 transactions stay safely under Solana's 1,232-byte MTU limit.
        secondary = await getOrCreateSecondaryPasskey(secondaryName, {
          forceNew: true,
          attachment: 'platform',
        })
      }

      setCreationStep(3)

      const [walletPda] = getWalletPda(primary.publicKey)

      if (guardian.equals(walletPda)) {
        setShowAdvancedOptions(true)
        dialog.alert(
          'Invalid Recovery Guardian',
          'A smart wallet cannot be its own recovery guardian. Please provide a separate Solana address.',
        )
        setIsCreating(false)
        setCreationStep(0)
        return
      }

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
        guardianAddress: guardian.toBase58(),
        spendThreshold: 0.1,
        network: 'devnet',
        securityMode,
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
              guardian: guardian,
              recoveryTimelockSeconds: timelockParse.seconds ?? undefined,
            })
            const dripIx = SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: walletPda,
              lamports: BigInt(Math.round(0.05 * LAMPORTS_PER_SOL)),
            })
            const tx = new Transaction({
              feePayer: payer.publicKey,
              recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
            }).add(initIx, dripIx)
            await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })
          }
          newAccount.isInitializedOnChain = true
          await saveWallet(newAccount)
          await updateWallet(newAccount)
        } catch {}
      })()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setCreatedAccount({
        name: finalName,
        address: newAccount.address,
        securityMode,
        spendThreshold: 0.1,
      })
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

      // What the user typed, if anything, kept apart from the address it parsed to. A
      // paste the parser could not read has to be reported rather than treated as "no
      // address given": the saved-wallet branch below reads an empty value as "use the
      // wallet already on this device", so a typo would silently sign in as that one.
      const typedInput = restoreAddress.trim()
      const typedAddress = typedInput ? (restoreParse.address ?? '') : ''

      const allWallets = await loadWallets().catch(() => [])
      const saved = await getSavedWallet().catch(() => null)
      const targetSearch = typedAddress || restoreAddress.trim()
      const matchingSaved = (!typedInput && saved)
        ? saved
        : (allWallets.find((w) => w.address === targetSearch) ?? (saved?.address === targetSearch ? saved : null))

      if (matchingSaved) {
        const auth = await promptBiometricAuth('Authenticate with biometric passkey to sign in')
        if (!auth.success) {
          dialog.alert('Authentication Failed', auth.error || 'Biometric verification was not completed.')
          return
        }

        await updateWallet(matchingSaved)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setShowSignInModal(false)
        router.replace('/(tabs)')
        return
      }

      let targetAddress = typedAddress
      if (!targetAddress) {
        // Zero-Input Passkey Discovery:
        // Concurrently kick off on-chain program accounts fetch in parallel with biometric prompt,
        // so network time is completely masked while user scans their fingerprint.
        const connection = new Connection(AppConfig.devnetRpcUrl, { commitment: 'confirmed' })
        const accountsPromise = getCachedOrFetchProgramAccounts(connection)

        let picked: { credentialId: string; assertion: any }
        try {
          picked = await getDiscoverablePlatformAssertion()
        } catch (err: any) {
          dialog.alert('Authentication Cancelled', err?.message || 'Biometric verification was not completed.')
          return
        }

        const prepared = prepareAssertionVerification(picked.assertion)
        if (!prepared) {
          dialog.alert('Authentication Error', 'Could not parse biometric passkey signature.')
          return
        }

        let matchedPda: PublicKey | null = null
        let matchedKeyHex: string | null = null
        let matchedRole: 'primary' | 'secondary' = 'primary'

        // 1. Instant Fast Path: If this credential ID was mapped on this device previously, verify directly!
        const cachedPdaStr = await AsyncStorage.getItem(`@haptix_passkey_pda_${picked.credentialId}`).catch(() => null)
        if (cachedPdaStr) {
          try {
            const cachedPda = new PublicKey(cachedPdaStr)
            const cachedOnchainState = await fetchHaptixWallet(connection, cachedPda)
            if (cachedOnchainState) {
              if (preparedAssertionMatchesPublicKey(prepared, cachedOnchainState.primaryPasskey)) {
                matchedPda = cachedPda
                matchedKeyHex = Buffer.from(cachedOnchainState.primaryPasskey).toString('hex')
                matchedRole = 'primary'
              } else if (preparedAssertionMatchesPublicKey(prepared, cachedOnchainState.secondaryPasskey)) {
                matchedPda = cachedPda
                matchedKeyHex = Buffer.from(cachedOnchainState.secondaryPasskey).toString('hex')
                matchedRole = 'secondary'
              }
            }
          } catch {
            // Fall through to program accounts scan
          }
        }

        // 2. Full scan path: Scan accounts using pre-computed signature digest & fast prefix checks
        if (!matchedPda) {
          const accounts = (await accountsPromise) ?? []

          for (const acc of accounts) {
            const primaryKey = acc.account.data.subarray(0, 33)
            const secondaryKey = acc.account.data.subarray(33, 66)
            if (preparedAssertionMatchesPublicKey(prepared, primaryKey)) {
              matchedPda = acc.pubkey
              matchedKeyHex = Buffer.from(primaryKey).toString('hex')
              matchedRole = 'primary'
              break
            }
            if (preparedAssertionMatchesPublicKey(prepared, secondaryKey)) {
              matchedPda = acc.pubkey
              matchedKeyHex = Buffer.from(secondaryKey).toString('hex')
              matchedRole = 'secondary'
              break
            }
          }
        }

        if (!matchedPda) {
          dialog.alert(
            'Wallet Not Found On-Chain',
            'Your passkey was authenticated, but no smart wallet matching this passkey was found on Devnet.\n\nIf you created this wallet on another network or with a custom address, please paste your wallet address or search by Guardian.',
          )
          setShowAddressInput(true)
          return
        }

        // Persist credentialId -> PDA mapping for instant sub-second logins next time
        await AsyncStorage.setItem(`@haptix_passkey_pda_${picked.credentialId}`, matchedPda.toBase58()).catch(() => {})

        const onchainState = await fetchHaptixWallet(connection, matchedPda)
        if (!onchainState) {
          dialog.alert('Wallet Error', 'Found wallet PDA, but could not load its on-chain account state.')
          return
        }

        await bindHardwarePasskey(matchedRole, picked.credentialId, matchedKeyHex!)

        const spendThresholdSol = Number(onchainState.spendThresholdLamports) / LAMPORTS_PER_SOL
        const isVault = matchedRole === 'primary' && (!onchainState.secondaryPasskey || spendThresholdSol === 0)
        const restored = await createSmartWalletRecord({
          name: isVault ? 'Hardware Vault' : 'Personal Smart Wallet',
          primaryPasskeyHex: Buffer.from(onchainState.primaryPasskey).toString('hex'),
          secondaryPasskeyHex: Buffer.from(onchainState.secondaryPasskey).toString('hex'),
          primaryCredentialId: matchedRole === 'primary' ? picked.credentialId : undefined,
          secondaryCredentialId: matchedRole === 'secondary' ? picked.credentialId : undefined,
          primaryLabel: 'Primary passkey (Phone)',
          secondaryLabel: isVault ? 'Co-signer key (Second device)' : 'Platform passkey (backup)',
          spendThreshold: spendThresholdSol,
          network: 'devnet',
          securityMode: isVault ? 'vault' : 'everyday',
        })
        restored.address = matchedPda.toBase58()
        restored.isInitializedOnChain = true
        await saveWallet(restored)
        await updateWallet(restored)

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setShowSignInModal(false)
        router.replace('/(tabs)')
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

      // Named in the prompts below, because "high-value" is not a number the user can weigh.
      const spendLimitSol = Number(onchainState.spendThresholdLamports) / LAMPORTS_PER_SOL

      /**
       * Presents one passkey and reports which of the wallet's two keys it turned out to
       * be, *including* when that is not the role that was asked for.
       *
       * The two keys are not interchangeable, so "wrong passkey" is the wrong answer for
       * someone who simply picked the other one. On-chain, every instruction verifies the
       * primary signature first and the secondary is only ever an extra requirement on top
       * of it (`execute_transfer.rs`, `governance.rs`, `recovery.rs`): the backup can
       * identify the account but authorizes nothing by itself. Naming the key that was
       * presented is what lets the flow say that instead of dead-ending.
       */
      const bindOne = async (expectedRole: 'primary' | 'secondary') => {
        // A legacy software key never appears in the OS picker, so the scalar this device
        // already holds is checked first. It needs no binding: the existing pointers are
        // already correct, which is why no credential id is recorded for it.
        const localRole = await matchLocalSoftwareKey(onChainKeys)
        if (localRole) return { role: localRole, credentialId: undefined }

        const picked = await getDiscoverablePlatformAssertion()
        const matched = matchWebAuthnAssertion(picked.assertion, onChainKeys)
        if (!matched) return null
        // Recognised as one of this wallet's keys, but not the one being asked for. Returned
        // rather than bound, so the caller can explain and re-ask.
        if (matched !== expectedRole) return { role: matched, credentialId: undefined }

        const key = matched === 'primary' ? onChainKeys.primary : onChainKeys.secondary
        await bindHardwarePasskey(matched, picked.credentialId, Buffer.from(key).toString('hex'))
        return { role: matched, credentialId: picked.credentialId }
      }

      // The primary is asked for first, and by name. Accepting whichever passkey the user
      // happened to pick let a restore finish with only the backup bound, which is a wallet
      // that unlocks the app and then fails every send, unfreeze and veto.
      const primaryAttempt = await bindOne('primary')
      if (!primaryAttempt) {
        dialog.alert(
          'Wrong Passkey',
          `That passkey does not belong to ${ellipsify(targetAddress, 6)}.\n\nIf the device with your original passkey was lost or stolen, you can recover this wallet through its Guardian.`,
          [
            { text: 'Try Again', style: 'cancel' },
            {
              text: 'Recover Lost Wallet',
              style: 'default',
              onPress: () => {
                setShowSignInModal(false)
                setShowRecoveryModal(true)
              },
            },
          ],
          { status: 'error' },
        )
        return
      }
      if (primaryAttempt.role !== 'primary') {
        dialog.alert(
          "That's The Backup Key",
          `The passkey you picked is this wallet's backup key. It can identify the account, but it ` +
            'cannot authorize anything on its own: transfers, unlocking, and recovery are all signed by ' +
            'the primary key, and the backup only ever adds to it.\n\n' +
            `Pick the Primary passkey for ${ellipsify(targetAddress, 6)} instead.\n\n` +
            'If the primary passkey is gone for good, this wallet has to be recovered through its guardian.',
          [
            { text: 'Try Again', style: 'cancel' },
            {
              text: 'Recover Lost Wallet',
              style: 'default',
              onPress: () => {
                setShowSignInModal(false)
                setShowRecoveryModal(true)
              },
            },
          ],
          { status: 'warning' },
        )
        return
      }

      // The second key is optional in the sense that the wallet still works without it --
      // but only up to the spending limit. Said in those terms rather than as "needs both
      // keys for high-value transfers", which reads as a nice-to-have and got declined.
      const bound: { primary?: string; secondary?: string } = { primary: primaryAttempt.credentialId }
      let wantsSecondKey = await confirmBackupKeyDialog(spendLimitSol)

      while (wantsSecondKey && !bound.secondary) {
        const second = await bindOne('secondary')
        if (second?.role === 'secondary') {
          bound.secondary = second.credentialId
          break
        }

        const isPrimaryKey = second?.role === 'primary'
        const title = isPrimaryKey ? 'Choose a different passkey' : 'Unrecognized passkey'
        const reason = isPrimaryKey
          ? "That's already your primary passkey. Your backup key has to be a different one."
          : "That passkey does not match this wallet's Backup key."

        const choice = await new Promise<'retry' | 'skip' | 'cancel'>((resolve) => {
          let settled = false
          const finish = (val: 'retry' | 'skip' | 'cancel') => {
            if (settled) return
            settled = true
            resolve(val)
          }
          dialog.alert(
            title,
            reason,
            [
              { text: 'Try again', style: 'default', onPress: () => finish('retry') },
              {
                text: 'Continue without a backup key',
                style: 'secondary',
                subtext: `Sends stay limited to ${spendLimitSol} SOL.`,
                onPress: () => finish('skip'),
              },
              { text: 'Cancel', style: 'plain', onPress: () => finish('cancel') },
            ],
            { onDismiss: () => finish('cancel'), status: 'warning' },
          )
        })

        if (choice === 'retry') {
          continue
        } else if (choice === 'skip') {
          break
        } else {
          return
        }
      }

      const isVault = !bound.secondary || Number(spendLimitSol) === 0
      const restored = await createSmartWalletRecord({
        name: isVault ? 'Hardware Vault' : 'Personal Smart Wallet',
        primaryPasskeyHex: Buffer.from(onChainKeys.primary).toString('hex'),
        secondaryPasskeyHex: Buffer.from(onChainKeys.secondary).toString('hex'),
        primaryCredentialId: bound.primary,
        secondaryCredentialId: bound.secondary,
        primaryLabel: 'Primary passkey (Phone)',
        secondaryLabel: isVault ? 'Co-signer key (Second device)' : 'Backup quorum passkey',
        spendThreshold: spendLimitSol,
        network: 'devnet',
        securityMode: isVault ? 'vault' : 'everyday',
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

  /**
   * Fills the field from the clipboard, when the clipboard holds something that reads as
   * a Solana address. Returns that address, or null.
   *
   * The raw text is what goes in the field, not the extracted address, so that the hint
   * underneath can say where the address came from - silently replacing a pasted link
   * with a bare key looks like the app lost part of the paste.
   */
  const fillFromClipboard = async (): Promise<string | null> => {
    try {
      const text = await Clipboard.getString()
      const parsed = parseRecipientInput(text ?? '')
      if (!parsed.address) return null
      setRestoreAddress((text ?? '').trim())
      setIsEditingAddress(false)
      return parsed.address
    } catch {
      return null
    }
  }

  const handlePasteAddress = async () => {
    if (await fillFromClipboard()) Haptics.selectionAsync()
  }

  /**
   * Opens the sign-in sheet, and on a container that holds no wallet record opens the
   * address field straight away with the clipboard already tried.
   *
   * The address is the one input a passkey can never supply, so on a fresh container it
   * is not optional. Leaving it collapsed behind an "(Optional)" disclosure made the
   * sheet look as though the passkey alone would do, and the tap that followed failed
   * with nothing on screen explaining the missing piece.
   */
  const openSignInSheet = async () => {
    setShowSignInModal(true)
    setIsEditingAddress(false)
    setShowAddressInput(true)
    const wallets = await loadWallets().catch(() => [])
    setSavedWallets(wallets)
    const saved = await getSavedWallet().catch(() => null)
    setDeviceHasWallet(!!saved || wallets.length > 0)
    if (saved) {
      setRestoreAddress(saved.address)
      return
    }
    if (wallets.length > 0) {
      setRestoreAddress(wallets[0].address)
      return
    }
    setRestoreAddress('')
  }

  const handleSearchByGuardian = async () => {
    const raw = guardianLookupInput.trim()
    if (!raw) return
    try {
      setIsSearchingGuardian(true)
      const guardianKey = new PublicKey(raw)
      const connection = new Connection(AppConfig.devnetRpcUrl, 'confirmed')
      // On-chain Wallet account layout: guardian is at byte offset 83
      const accounts = await connection.getProgramAccounts(HAPTIX_PROGRAM_ID, {
        filters: [
          {
            memcmp: {
              offset: 83,
              bytes: guardianKey.toBase58(),
            },
          },
        ],
      })
      if (!accounts.length) {
        dialog.alert('No Wallets Found', 'No Haptix smart wallet was found with this guardian on Devnet.')
        return
      }
      const foundAddress = accounts[0].pubkey.toBase58()
      setRestoreAddress(foundAddress)
      setIsEditingAddress(false)
      setShowAddressInput(true)
      setShowGuardianLookup(false)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      dialog.alert(
        'Wallet Found!',
        `Found smart wallet:\n${ellipsify(foundAddress, 6)} (${foundAddress})\n\nAddress has been filled. Tap "Sign in with Biometrics" to unlock.`,
      )
    } catch (err: any) {
      dialog.alert('Search Error', err?.message || 'Invalid guardian address')
    } finally {
      setIsSearchingGuardian(false)
    }
  }

  if (isLoading || activeWallet) {
    return <HaptixAppLoader message={activeWallet ? 'Entering wallet…' : 'Loading smart wallet…'} />
  }

  return (
    <ImageBackground
      source={ONBOARDING_BG}
      style={[
        styles.heroContainer,
        { paddingTop: Math.max(insets.top + 8, 28), paddingBottom: Math.max(insets.bottom + 12, 24) },
      ]}
      resizeMode="cover"
    >
      <StatusBar style={showGuideModal ? 'dark' : 'light'} />

      {/* 1. TOP BAR: Haptix Logo Text in Left Corner + How it Works pill on Right */}
      <View style={styles.topBrandRow}>
        <HaptixLogoText height={26} />
        <TouchableOpacity
          style={styles.guideTopPill}
          onPress={() => {
            void Haptics.selectionAsync()
            setShowGuideModal(true)
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons name="auto-awesome" size={13} color="#60A5FA" />
          <Text style={styles.guideTopPillText}>How it works</Text>
        </TouchableOpacity>
      </View>

      {/* 2. MIDDLE SECTION: Clean Hero Headline + Value Proposition */}
      <View style={styles.superMiddleSection}>
        <View style={styles.superTaglineWrap}>
          <Text style={styles.superHeroHeadline}>
            A smarter way{'\n'}to own <Text style={{ color: '#60A5FA' }}>crypto</Text>
          </Text>

          <Text style={styles.superTaglineSub}>
            Hardware-backed passkeys on Solana.{'\n'}No seed phrases to write down or lose.
          </Text>
        </View>
      </View>

      {/* 3. BOTTOM BUTTON STACK: 2 Action Pills + Previous Lost Device Link */}
      <View style={styles.superButtonStack}>
        {/* PRIMARY CTA: Create New Wallet */}
        <TouchableOpacity
          style={[styles.superButton, styles.superButtonDark]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setShowCreateModal(true)
          }}
          activeOpacity={0.9}
        >
          <Text style={[styles.superBtnText, { color: '#FFFFFF' }]}>Create New Wallet</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" style={styles.superBtnArrow} />
        </TouchableOpacity>

        {/* SECONDARY CTA: I already have a wallet */}
        <TouchableOpacity
          style={[styles.superButton, styles.superButtonLight]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            openSignInSheet()
          }}
          activeOpacity={0.85}
        >
          <Text style={[styles.superBtnText, { color: '#09080F' }]}>I already have a wallet</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#09080F" style={styles.superBtnArrow} />
        </TouchableOpacity>

        {/* RESCUE / LOST DEVICE: Previous design with shield icon & guardian recovery link */}
        <TouchableOpacity
          style={styles.heroRecoveryLink}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setShowRecoveryModal(true)
          }}
          activeOpacity={0.7}
        >
          <MaterialIcons name="security" size={15} color="#1D4ED8" />
          <Text style={styles.heroRecoveryText}>
            Lost device? <Text style={styles.heroRecoveryHighlight}>Recover with Guardian</Text>
          </Text>
        </TouchableOpacity>


      </View>

      {/* CREATE WALLET MODAL */}
      <Modal visible={showCreateModal} animationType="slide" transparent={true}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowCreateModal(false)} />
          <Animated.View
            style={[
              styles.sheetCard,
              { paddingBottom: Math.max(insets.bottom, 24), transform: [{ translateY: panYCreate }] },
            ]}
          >
            {/* DRAG HANDLE */}
            <View style={styles.dragHandleTouchZone} {...panResponderCreate.panHandlers}>
              <View style={styles.sheetHandle} />
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
                  setShowCreateModal(false)
                  router.replace('/(tabs)')
                }}
              />
            ) : (
              <>
                <View
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}
                >
                  <Text style={styles.sheetTitle}>Create wallet</Text>
                  <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                    <MaterialIcons name="close" size={24} color={p.heroInk} />
                  </TouchableOpacity>
                </View>

            {creationStep === 0 ? (
              <>
                <ScrollView
                  style={{ flexShrink: 1 }}
                  contentContainerStyle={{ paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={[styles.sheetDesc, { textAlign: 'left' }]}>Choose your security model and customize passkey names.</Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Security architecture</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.selectionAsync()
                          setSecurityMode('everyday')
                          setSecondaryKeyName('Backup Key')
                        }}
                        style={[
                          styles.modeCard,
                          securityMode === 'everyday' && styles.modeCardActive,
                        ]}
                      >
                        <MaterialIcons
                          name="smartphone"
                          size={22}
                          color={securityMode === 'everyday' ? p.heroInk : p.inkMuted}
                        />
                        <Text
                          style={[
                            styles.modeCardTitle,
                            securityMode === 'everyday' && styles.modeCardTitleActive,
                          ]}
                        >
                          Everyday
                        </Text>
                        <Text style={styles.modeCardDesc}>Both keys on this device</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => {
                          Haptics.selectionAsync()
                          setSecurityMode('vault')
                          setSecondaryKeyName('Vault Key (Hardware / Laptop)')
                        }}
                        style={[
                          styles.modeCard,
                          securityMode === 'vault' && styles.modeCardActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="safe"
                          size={22}
                          color={securityMode === 'vault' ? p.heroInk : p.inkMuted}
                        />
                        <Text
                          style={[
                            styles.modeCardTitle,
                            securityMode === 'vault' && styles.modeCardTitleActive,
                          ]}
                        >
                          Vault mode
                        </Text>
                        <Text style={styles.modeCardDesc}>Key 2 on laptop or OneKey</Text>
                      </TouchableOpacity>
                    </View>

                    {securityMode === 'vault' && (
                      <View style={{ marginTop: 10 }}>
                        <View style={styles.vaultExplainer}>
                          <MaterialIcons name="info-outline" size={16} color={p.heroInk} />
                          <Text style={styles.vaultExplainerText}>
                            <Text style={{ fontWeight: '700' }}>Vault mode</Text>: daily spends use fingerprint on this phone. Sends above your limit will require approval on your second device (laptop, 2nd phone, or tablet).
                          </Text>
                        </View>

                        <Text style={[styles.inputLabel, { marginTop: 14, marginBottom: 6 }]}>Vault key device</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            onPress={() => {
                              Haptics.selectionAsync()
                              setVaultKeySource('mac')
                              setSecondaryKeyName('Second Device (Vault Key)')
                            }}
                            style={[
                              styles.vaultSourceCard,
                              vaultKeySource === 'mac' && styles.vaultSourceCardActive,
                            ]}
                          >
                            <MaterialIcons
                              name="devices"
                              size={20}
                              color={vaultKeySource === 'mac' ? p.heroInk : p.inkMuted}
                            />
                            <Text
                              style={[
                                styles.vaultSourceTitle,
                                vaultKeySource === 'mac' && styles.vaultSourceTitleActive,
                              ]}
                            >
                              Second Device
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => {
                              Haptics.selectionAsync()
                              setVaultKeySource('hardware')
                              setSecondaryKeyName('Vault Key (Security Key)')
                            }}
                            style={[
                              styles.vaultSourceCard,
                              vaultKeySource === 'hardware' && styles.vaultSourceCardActive,
                            ]}
                          >
                            <MaterialIcons
                              name="usb"
                              size={20}
                              color={vaultKeySource === 'hardware' ? p.heroInk : p.inkMuted}
                            />
                            <Text
                              style={[
                                styles.vaultSourceTitle,
                                vaultKeySource === 'hardware' && styles.vaultSourceTitleActive,
                              ]}
                            >
                              USB / NFC key
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {vaultKeySource === 'mac' && (
                          <View style={styles.macVaultBox}>
                            {/* Step 1 Header */}
                            <View style={styles.macVaultStepHeader}>
                              <View style={styles.macVaultStepBadge}>
                                <Text style={styles.macVaultStepBadgeText}>1</Text>
                              </View>
                              <Text style={styles.macVaultStepTitle}>
                                Open on laptop or second phone browser
                              </Text>
                            </View>

                            {/* Step 1 URL Box */}
                            <View style={styles.macVaultUrlWrap}>
                              <View style={styles.macVaultUrlLeft}>
                                <MaterialIcons name="link" size={16} color="#4F6BFF" style={{ marginRight: 6 }} />
                                <Text
                                  style={styles.macVaultUrlText}
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
                                    copiedVaultUrl && styles.macVaultActionBtnCopied,
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
                                    color={copiedVaultUrl ? '#10B981' : p.inkSecondary}
                                    style={{ marginRight: 3 }}
                                  />
                                  <Text
                                    style={[
                                      styles.macVaultActionBtnText,
                                      copiedVaultUrl && { color: '#10B981' },
                                    ]}
                                  >
                                    {copiedVaultUrl ? 'Copied' : 'Copy'}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.macVaultActionBtnOpen}
                                  onPress={() => Linking.openURL(AppConfig.vaultWebUrl)}
                                  activeOpacity={0.7}
                                >
                                  <MaterialIcons name="open-in-new" size={13} color="#4F6BFF" />
                                </TouchableOpacity>
                              </View>
                            </View>

                            {/* Step 2 Header */}
                            <View style={[styles.macVaultStepHeader, { marginTop: 14 }]}>
                              <View style={styles.macVaultStepBadge}>
                                <Text style={styles.macVaultStepBadgeText}>2</Text>
                              </View>
                              <Text style={styles.macVaultStepTitle}>
                                Tap "Enroll" on that device, then paste key below
                              </Text>
                            </View>

                            {/* Step 2 Key Input Container */}
                            <View
                              style={[
                                styles.macKeyInputContainer,
                                isValidVaultHex && styles.macKeyInputContainerValid,
                                isVaultInputFocused && !isValidVaultHex && styles.macKeyInputContainerFocused,
                              ]}
                            >
                              <TextInput
                                style={styles.macKeyInput}
                                value={macVaultKeyHex}
                                onChangeText={setMacVaultKeyHex}
                                onFocus={() => setIsVaultInputFocused(true)}
                                onBlur={() => setIsVaultInputFocused(false)}
                                placeholder="33-byte public key (02...)"
                                placeholderTextColor={p.inkMuted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                multiline={false}
                                numberOfLines={1}
                                textAlignVertical="center"
                              />
                              {cleanVaultHex.length > 0 ? (
                                <View style={styles.keyActionRow}>
                                  {isValidVaultHex ? (
                                    <View style={styles.validKeyBadge}>
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
                                    <MaterialIcons name="cancel" size={18} color={p.inkMuted} />
                                  </TouchableOpacity>
                                </View>
                              ) : (
                                <TouchableOpacity
                                  style={styles.macPasteBadgeButton}
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
                        )}
                      </View>
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Wallet name</Text>
                    <TextInput
                      style={styles.textInputField}
                      value={walletName}
                      onChangeText={setWalletName}
                      placeholder="e.g., My Haptix Wallet"
                      placeholderTextColor={p.inkMuted}
                      autoCorrect={false}
                    />
                  </View>

                  {/* Recovery Guardian (Optional with Auto-Backup) */}
                  <View style={styles.inputGroup}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={styles.inputLabel}>Recovery guardian (Optional)</Text>
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 6,
                          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '500', color: p.inkMuted }}>
                          {guardianInput.trim() ? 'External key' : 'Auto-backup'}
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.addressInputContainer,
                        isGuardianInputFocused && { borderColor: '#4F6BFF', borderWidth: 1.5 },
                        guardianInput.trim() && (!guardianPublicKey || isDevnetFunder(guardianPublicKey)) ? styles.textInputFieldInvalid : null,
                      ]}
                    >
                      <TextInput
                        style={styles.addressInput}
                        value={guardianInput}
                        onChangeText={setGuardianInput}
                        onFocus={() => setIsGuardianInputFocused(true)}
                        onBlur={() => setIsGuardianInputFocused(false)}
                        placeholder="Auto-generate or paste address"
                        placeholderTextColor={p.inkMuted}
                        autoCorrect={false}
                        autoCapitalize="none"
                        multiline={false}
                        numberOfLines={1}
                      />
                      {guardianInput.trim() ? (
                        <TouchableOpacity
                          style={styles.pasteBadgeButton}
                          onPress={() => {
                            setGuardianInput('')
                            Haptics.selectionAsync()
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <MaterialIcons name="close" size={16} color={p.inkMuted} />
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.pasteBadgeButton}
                          onPress={async () => {
                            const text = await Clipboard.getString()
                            if (text) {
                              setGuardianInput(text.trim())
                              Haptics.selectionAsync()
                            }
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <MaterialIcons name="content-paste" size={14} color="#6C8CFF" style={{ marginRight: 2 }} />
                          <Text style={[styles.pasteBadgeText, { color: '#6C8CFF' }]}>Paste</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.inputHint,
                        guardianInput.trim() && (!guardianPublicKey || isDevnetFunder(guardianPublicKey)) ? styles.inputHintError : null,
                      ]}
                    >
                      {guardianInput.trim()
                        ? guardianPublicKey
                          ? isDevnetFunder(guardianPublicKey)
                            ? 'Cannot use the devnet funder. Guardian must be an external key.'
                            : `Can rescue wallet after 1d timelock. Cannot move funds.`
                          : (guardianParse.error ?? 'Invalid Solana address.')
                        : 'Leave blank for 1-tap setup. An encrypted recovery key will be generated for you.'}
                    </Text>
                  </View>

                  {/* Advanced Options Toggle */}
                  <TouchableOpacity
                    style={styles.advancedOptionsToggle}
                    onPress={() => {
                      Haptics.selectionAsync()
                      setShowAdvancedOptions((prev) => !prev)
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="tune" size={18} color={p.heroInk} />
                      <Text style={styles.advancedOptionsToggleText}>
                        {showAdvancedOptions ? 'Hide passkey labels' : 'Advanced passkey labels'}
                      </Text>
                    </View>
                    <MaterialIcons
                      name={showAdvancedOptions ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                      size={20}
                      color={p.inkSecondary}
                    />
                  </TouchableOpacity>

                  {showAdvancedOptions && (
                    <>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Passkey 1 name, primary</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={primaryKeyName}
                          onChangeText={setPrimaryKeyName}
                          placeholder="e.g., Primary passkey"
                          placeholderTextColor={p.inkMuted}
                          autoCorrect={false}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Passkey 2 name, backup</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={secondaryKeyName}
                          onChangeText={setSecondaryKeyName}
                          placeholder="e.g., Backup key"
                          placeholderTextColor={p.inkMuted}
                          autoCorrect={false}
                        />
                      </View>
                    </>
                  )}
                </ScrollView>

                {/* PINNED ACTION BUTTON - Always visible without scrolling */}
                <View style={{ paddingTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.primaryDarkButton, { backgroundColor: '#5E81FF' }, isCreating && { opacity: 0.6 }]}
                    onPress={handleExecutePasskeyCreation}
                    disabled={isCreating}
                    activeOpacity={0.85}
                  >
                    {isCreating ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <MaterialIcons name="fingerprint" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={[styles.primaryDarkButtonText, { color: '#FFFFFF' }]}>
                      {securityMode === 'vault' ? 'Start Vault setup' : 'Start setup'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
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
                  <Text style={styles.modalStepText}>
                    {securityMode === 'vault'
                      ? `Pairing ${secondaryKeyName || 'Vault Key'} (Cross-Device)...`
                      : `Creating ${secondaryKeyName || 'Backup Key'}...`}
                  </Text>
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
              </>
            )}
          </Animated.View>
        </View>
      </Modal>

      {/* SIGN IN MODAL */}
      <Modal visible={showSignInModal} animationType="slide" transparent={true}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSignInModal(false)} />
          <Animated.View
            style={[
              styles.sheetCard,
              { paddingBottom: Math.max(insets.bottom, 24), transform: [{ translateY: panYSignIn }] },
            ]}
          >
            {/* DRAG HANDLE */}
            <View style={styles.dragHandleTouchZone} {...panResponderSignIn.panHandlers}>
              <View style={styles.sheetHandle} />
            </View>

            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Sign in</Text>
              <TouchableOpacity
                onPress={() => setShowSignInModal(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={20} color={p.inkSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 12 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.heroBiometricRing}>
                <View style={styles.heroBiometricInnerCircle}>
                  <Image
                    source={FINGERPRINT_HERO_BLUE}
                    style={{ width: 34, height: 34 }}
                    resizeMode="contain"
                  />
                </View>
              </View>
              <Text style={styles.sheetDesc}>Authenticate with your biometric passkey</Text>

              {/* SAVED WALLETS ON THIS DEVICE */}
              {savedWallets.length > 0 && (
                <View style={styles.savedWalletsContainer}>
                  <Text style={styles.savedWalletsHeader}>Saved Wallets on this Device</Text>
                  {savedWallets.map((w) => {
                    const isSelected = restoreAddress === w.address
                    return (
                      <TouchableOpacity
                        key={w.address}
                        style={[
                          styles.savedWalletCard,
                          isSelected && styles.savedWalletCardActive,
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync()
                          setRestoreAddress(w.address)
                          setIsEditingAddress(false)
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.savedWalletName, isSelected && styles.savedWalletNameActive]}>
                            {w.name || 'Haptix Smart Wallet'}
                          </Text>
                          <Text style={styles.savedWalletAddress}>{ellipsify(w.address, 6)}</Text>
                        </View>
                        <MaterialIcons
                          name={isSelected ? 'check-circle' : 'radio-button-unchecked'}
                          size={20}
                          color={isSelected ? '#6C8CFF' : p.inkMuted}
                        />
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}

              {/* ADDRESS AREA - Fixed min-height area swapping between Input & Wallet Found */}
              <View style={styles.addressAreaWrap}>
                <Text style={styles.addressAreaLabel}>Wallet address</Text>

                {restoreParse.address && !isEditingAddress ? (
                  /* STATE B: WALLET FOUND ROW */
                  <View style={styles.walletFoundCard}>
                    <View style={styles.walletFoundLeft}>
                      <View style={styles.walletFoundBadge}>
                        <MaterialIcons name="check" size={16} color="#5FBF7A" />
                      </View>
                      <View>
                        <Text style={styles.walletFoundSubtitle}>Wallet found</Text>
                        <Text style={styles.walletFoundAddress}>
                          {ellipsify(restoreParse.address, 6)}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.selectionAsync()
                        setIsEditingAddress(true)
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.walletFoundChangeText}>Change</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* STATE A: EMPTY / EDITING INPUT */
                  <View>
                    <View style={styles.addressInputContainer}>
                      <TextInput
                        style={styles.addressInput}
                        value={restoreAddress}
                        onChangeText={setRestoreAddress}
                        placeholder="Paste Solana smart wallet address"
                        placeholderTextColor="#5F5E5A"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {restoreAddress.length > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {restoreParse.address ? (
                            <TouchableOpacity
                              onPress={() => {
                                Haptics.selectionAsync()
                                setIsEditingAddress(false)
                              }}
                              style={styles.doneBadgeButton}
                            >
                              <Text style={styles.doneBadgeText}>Done</Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            onPress={() => {
                              setRestoreAddress('')
                              setIsEditingAddress(true)
                              Haptics.selectionAsync().catch(() => {})
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <MaterialIcons name="cancel" size={18} color="#8A8985" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.pasteBadgeButton}
                          onPress={async () => {
                            const addr = await fillFromClipboard()
                            if (addr) {
                              Haptics.selectionAsync()
                              setIsEditingAddress(false)
                            }
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="content-paste" size={14} color="#6C8CFF" />
                          <Text style={styles.pasteBadgeText}>Paste</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* FORGOT ADDRESS: GUARDIAN SEARCH */}
                    <TouchableOpacity
                      style={styles.guardianSearchToggle}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setShowGuardianLookup((prev) => !prev)
                      }}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="search" size={14} color="#8A8985" />
                      <Text style={styles.guardianSearchToggleText}>
                        {showGuardianLookup ? 'Hide guardian lookup' : 'Forgot address? Search on-chain by guardian'}
                      </Text>
                      <MaterialIcons
                        name={showGuardianLookup ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                        size={14}
                        color="#8A8985"
                      />
                    </TouchableOpacity>

                    {showGuardianLookup && (
                      <View style={styles.guardianSearchBox}>
                        <Text style={styles.guardianSearchHelp}>
                          Enter your guardian's Solana address, for example your Phantom or a friend's wallet, to find your smart wallet.
                        </Text>
                        <View style={[styles.addressInputContainer, { marginTop: 10, marginBottom: 10, height: 46 }]}>
                          <TextInput
                            style={styles.addressInput}
                            value={guardianLookupInput}
                            onChangeText={setGuardianLookupInput}
                            placeholder="Guardian Solana address"
                            placeholderTextColor="#5F5E5A"
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                        </View>
                        <TouchableOpacity
                          style={[styles.guardianSearchBtn, isSearchingGuardian && { opacity: 0.7 }]}
                          onPress={handleSearchByGuardian}
                          disabled={isSearchingGuardian || !guardianLookupInput.trim()}
                        >
                          {isSearchingGuardian ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.guardianSearchBtnText}>Find my wallet on-chain</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.primaryAccentButton, isSigningIn && { opacity: 0.8 }]}
                onPress={handleSignInWithPasskey}
                disabled={isSigningIn}
                activeOpacity={0.85}
              >
                {isSigningIn ? (
                  <ActivityIndicator color="#0C0C0D" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TablerFingerprintIcon size={18} color="#0C0C0D" strokeWidth={2.2} />
                    <Text style={styles.primaryAccentButtonText}>Sign in with biometrics</Text>
                  </View>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
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

      {/* RECOVER LOST WALLET MODAL */}
      <HaptixRecoveryFlowSheet
        visible={showRecoveryModal}
        initialTargetAddress=""
        onClose={() => setShowRecoveryModal(false)}
        onRecoveryComplete={async (recovered) => {
          setShowRecoveryModal(false)
          await updateWallet(recovered)
          router.replace('/(tabs)')
        }}
      />

      {/* FEATURE WALKTHROUGH & SLIDES */}
      <HaptixFeatureGuideModal
        visible={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        onCreateWallet={() => {
          setShowGuideModal(false)
          setShowCreateModal(true)
        }}
        onSignIn={() => {
          setShowGuideModal(false)
          openSignInSheet()
        }}
      />
    </ImageBackground>
  )
}

const createStyles = (p: OnboardingPalette, isDark: boolean) =>
  StyleSheet.create({
    heroContainer: {
      flex: 1,
      backgroundColor: '#000000',
      paddingHorizontal: 24,
      justifyContent: 'space-between',
    },
    topBrandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
      marginBottom: 8,
    },
    guideTopPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: 'rgba(96, 165, 250, 0.12)',
      borderWidth: 1,
      borderColor: 'rgba(96, 165, 250, 0.28)',
    },
    guideTopPillText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: '#93C5FD',
      letterSpacing: -0.1,
    },
    superMiddleSection: {
      flex: 1,
      minHeight: 160,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 8,
    },
    superTaglineWrap: {
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    superHeroHeadline: {
      color: '#FFFFFF',
      fontSize: 36,
      fontWeight: '800',
      lineHeight: 44,
      letterSpacing: -1.0,
      textAlign: 'center',
    },
    superTaglineSub: {
      color: 'rgba(255, 255, 255, 0.85)',
      fontSize: 14.5,
      lineHeight: 22,
      marginTop: 12,
      textAlign: 'center',
      maxWidth: 320,
    },
    superButtonStack: {
      width: '100%',
    },
    superButton: {
      width: '100%',
      height: 52,
      borderRadius: 26,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    superButtonDark: {
      backgroundColor: '#09080F',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 3,
    },
    superButtonLight: {
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.85)',
      marginBottom: 8,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 6,
      elevation: 2,
    },
    superBtnIcon: {
      marginRight: 8,
    },
    superBtnArrow: {
      position: 'absolute',
      right: 20,
    },
    superBtnText: {
      fontSize: 15.5,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    heroRecoveryLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      marginTop: 2,
      marginBottom: 12,
    },
    heroRecoveryText: {
      fontSize: 13,
      color: '#1E293B',
    },
    heroRecoveryHighlight: {
      color: '#1D4ED8',
      fontWeight: '700',
    },
    superLegalText: {
      fontSize: 11,
      color: 'rgba(15, 23, 42, 0.70)',
      textAlign: 'center',
      lineHeight: 16,
    },
    superLegalLink: {
      textDecorationLine: 'underline',
      color: '#0F172A',
      fontWeight: '600',
    },
    sheetBackdrop: { flex: 1, backgroundColor: p.sheetBackdrop, justifyContent: 'flex-end' },
    sheetCard: {
      backgroundColor: p.sheetBg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: p.border,
      paddingHorizontal: 20,
      paddingTop: 12,
      maxHeight: '92%',
    },
    dragHandleTouchZone: {
      width: '100%',
      paddingTop: 0,
      paddingBottom: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: isDark ? '#3a3a37' : '#D1D1D6',
      alignSelf: 'center',
    },
    sheetHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    heroBiometricRing: {
      width: 76,
      height: 76,
      borderRadius: 38,
      borderWidth: 1.5,
      borderColor: '#6C8CFF',
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
      marginTop: 4,
      marginBottom: 12,
    },
    heroBiometricInnerCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: isDark ? '#17171A' : '#F4F3F1',
      justifyContent: 'center',
      alignItems: 'center',
    },
    sheetTitle: { color: p.heroInk, fontSize: 19, fontWeight: '700' },
    sheetDesc: { color: p.inkSecondary, fontSize: 13, marginBottom: 14, textAlign: 'center' },
    sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15 },
    sheetRowText: { color: p.heroInk, fontSize: 16 },
    primaryDarkButton: {
      width: '100%',
      height: 52,
      borderRadius: 14,
      backgroundColor: isDark ? '#FFFFFF' : '#000000',
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
    },
    primaryAccentButton: {
      width: '100%',
      height: 50,
      borderRadius: 14,
      backgroundColor: '#6C8CFF',
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      marginTop: 8,
    },
    primaryAccentButtonText: {
      color: '#0C0C0D',
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    primaryDarkButtonText: { color: isDark ? '#000000' : '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
    addressAreaWrap: {
      minHeight: 104,
      marginBottom: 16,
    },
    addressAreaLabel: {
      color: '#8A8985',
      fontSize: 11.5,
      marginBottom: 6,
    },
    walletFoundCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDark ? '#141416' : '#FFFFFF',
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E5E7EB',
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    walletFoundLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    walletFoundBadge: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(95, 191, 122, 0.12)',
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 0,
    },
    walletFoundSubtitle: {
      fontSize: 11.5,
      color: '#8A8985',
      marginBottom: 2,
    },
    walletFoundAddress: {
      fontSize: 13,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#181714',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    walletFoundChangeBtn: {
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    walletFoundChangeText: {
      fontSize: 13,
      fontWeight: '500',
      color: '#6C8CFF',
    },
    doneBadgeButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(79, 107, 255, 0.18)' : 'rgba(79, 107, 255, 0.12)',
    },
    doneBadgeText: {
      color: '#4F6BFF',
      fontSize: 12,
      fontWeight: '600',
    },
    inputGroup: { marginBottom: 16 },
    inputLabel: { color: p.heroInk, fontSize: 14, fontWeight: '600', marginBottom: 8 },
    inputHint: { color: p.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
    inputHintError: { color: p.danger },
    textInputFieldInvalid: { borderColor: p.danger },
    textInputField: {
      color: p.heroInk,
      fontSize: 15,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: 48,
      includeFontPadding: false,
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
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: isDark ? '#141416' : '#FFFFFF',
      borderWidth: 1,
      borderColor: isDark ? '#2A2A28' : '#D1D5DB',
      borderRadius: 12,
      paddingHorizontal: 12,
      height: 48,
    },
    addressInput: { flex: 1, color: isDark ? '#F2F1EE' : '#111827', fontSize: 13, padding: 0 },
    // Pulled up into the input's own trailing margin, so the hint sits under the field
    // rather than opening a second, wider gap below it.
    addressHintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 6,
      marginBottom: 10,
      paddingHorizontal: 2,
    },
    addressHintText: { flex: 1, fontSize: 12, lineHeight: 16 },
    pasteBadgeButton: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, paddingHorizontal: 4, paddingVertical: 4 },
    pasteBadgeText: { color: '#6C8CFF', fontSize: 13, fontWeight: '500' },
    modeCard: {
      flex: 1,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1.5,
      borderColor: p.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
    },
    modeCardActive: {
      borderColor: '#6C8CFF',
      backgroundColor: p.surface,
    },
    modeCardTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: p.inkMuted,
      marginTop: 6,
    },
    modeCardTitleActive: {
      color: '#6C8CFF',
      fontWeight: '700',
    },
    modeCardDesc: {
      fontSize: 10.5,
      color: p.inkMuted,
      textAlign: 'center',
      marginTop: 2,
    },
    vaultExplainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 10,
      padding: 10,
      marginTop: 10,
    },
    vaultExplainerText: {
      flex: 1,
      fontSize: 11.5,
      color: p.inkSecondary,
      lineHeight: 16,
    },
    advancedOptionsToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: p.surfaceAlt,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      marginTop: 4,
      marginBottom: 16,
    },
    advancedOptionsToggleText: {
      fontSize: 13,
      fontWeight: '600',
      color: p.heroInk,
    },
    autoDiscoverNotice: {
      backgroundColor: isDark ? '#141416' : '#F4F3F1',
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 14,
    },
    autoDiscoverNoticeText: {
      color: isDark ? '#A1A1AA' : '#6B6A64',
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    savedWalletsContainer: {
      marginBottom: 14,
    },
    savedWalletsHeader: {
      color: p.heroInk,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    savedWalletCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: p.surfaceAlt,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: p.border,
      marginBottom: 8,
    },
    savedWalletCardActive: {
      borderColor: p.heroAccent,
      backgroundColor: p.surface,
    },
    savedWalletName: {
      color: p.heroInk,
      fontSize: 14,
      fontWeight: '600',
    },
    savedWalletNameActive: {
      color: p.heroAccent,
    },
    savedWalletAddress: {
      color: p.inkMuted,
      fontSize: 12,
      marginTop: 2,
    },
    guardianSearchToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 14,
      marginBottom: 6,
    },
    guardianSearchToggleText: {
      color: '#8A8985',
      fontSize: 12.5,
      fontWeight: '400',
    },
    guardianSearchBox: {
      backgroundColor: p.surfaceAlt,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: p.border,
      marginBottom: 12,
    },
    guardianSearchHelp: {
      color: p.inkSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginBottom: 2,
    },
    guardianSearchBtn: {
      backgroundColor: isDark ? '#161619' : p.actionBg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
    },
    guardianSearchBtnText: {
      color: isDark ? '#FFFFFF' : p.onPrimary,
      fontSize: 13.5,
      fontWeight: '600',
    },
    vaultSourceCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1.5,
      borderColor: p.border,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 8,
    },
    vaultSourceCardActive: {
      borderColor: '#6C8CFF',
      backgroundColor: p.surface,
    },
    vaultSourceTitle: {
      fontSize: 12.5,
      fontWeight: '600',
      color: p.inkMuted,
    },
    vaultSourceTitleActive: {
      color: '#6C8CFF',
      fontWeight: '700',
    },
    macVaultBox: {
      backgroundColor: isDark ? '#18181B' : '#F8FAFC',
      borderWidth: 1,
      borderColor: isDark ? '#27272A' : '#E2E8F0',
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
      backgroundColor: isDark ? 'rgba(79, 107, 255, 0.2)' : 'rgba(79, 107, 255, 0.12)',
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
      color: isDark ? '#F4F4F5' : '#1E293B',
      flex: 1,
    },
    macVaultUrlWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDark ? '#101012' : '#FFFFFF',
      borderWidth: 1,
      borderColor: isDark ? '#27272F' : '#CBD5E1',
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
      color: isDark ? '#93C5FD' : '#2563EB',
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
      backgroundColor: isDark ? '#222228' : '#F1F5F9',
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 6,
    },
    macVaultActionBtnCopied: {
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5',
    },
    macVaultActionBtnText: {
      fontSize: 11.5,
      fontWeight: '600',
      color: isDark ? '#D4D4D8' : '#475569',
    },
    macVaultActionBtnOpen: {
      backgroundColor: isDark ? 'rgba(79, 107, 255, 0.16)' : '#EFF6FF',
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 6,
    },
    macKeyInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#101012' : '#FFFFFF',
      borderWidth: 1.5,
      borderColor: isDark ? '#33333E' : '#94A3B8',
      borderRadius: 12,
      paddingHorizontal: 12,
      height: 52,
      marginTop: 2,
    },
    macKeyInputContainerFocused: {
      borderWidth: 2,
      borderColor: '#4F6BFF',
    },
    macKeyInputContainerValid: {
      borderWidth: 2,
      borderColor: '#10B981',
    },
    macKeyInput: {
      flex: 1,
      fontSize: 13,
      color: isDark ? '#FFFFFF' : '#0F172A',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      paddingVertical: 8,
      paddingHorizontal: 0,
      marginRight: 8,
    },
    macPasteBadgeButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(79, 107, 255, 0.18)' : '#EEF2FF',
      borderColor: isDark ? 'rgba(79, 107, 255, 0.3)' : '#C7D2FE',
      borderWidth: 1,
      width: 34,
      height: 34,
      borderRadius: 8,
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
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5',
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
  })
