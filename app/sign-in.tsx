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
import { describeRecipientSource, parseRecipientInput } from '@/utils/solana-address'
import { describeTimelock, parseTimelockInput } from '@/utils/recovery-timelock'
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
  danger: '#F87171',
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
  const [guardianInput, setGuardianInput] = useState('')

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

  const handleExecutePasskeyCreation = async () => {
    try {
      setIsCreating(true)
      setCreationStep(1)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const finalName = walletName.trim() || 'My Haptix Wallet'
      const primaryName = primaryKeyName.trim() || 'Primary Passkey'
      const secondaryName = secondaryKeyName.trim() || 'Backup Quorum Passkey'

      if (guardianInput.trim() && !guardianPublicKey) {
        dialog.alert('Check the guardian address', guardianParse.error || 'That is not a Solana address.')
        return
      }
      if (timelockParse.error) {
        dialog.alert('Check the recovery timelock', timelockParse.error)
        return
      }

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
        guardianAddress: guardianPublicKey?.toBase58(),
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
              guardian: guardianPublicKey ?? undefined,
              recoveryTimelockSeconds: timelockParse.seconds ?? undefined,
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

      // What the user typed, if anything, kept apart from the address it parsed to. A
      // paste the parser could not read has to be reported rather than treated as "no
      // address given": the saved-wallet branch below reads an empty value as "use the
      // wallet already on this device", so a typo would silently sign in as that one.
      const typedInput = showAddressInput ? restoreAddress.trim() : ''
      const typedAddress = typedInput ? (restoreParse.address ?? '') : ''

      const saved = await getSavedWallet()
      if (saved) {
        // Typing a *different* address means "bring that wallet onto this device", not
        // "rename this one". The old code overwrote the saved record's address, which left
        // the app pointing at an account whose keys are not on this device: every balance
        // was read from an address it could never sign for. Falling through to recovery
        // instead means the account is only trusted once a passkey has been checked
        // against it.
        if (!typedInput || typedAddress === saved.address) {
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

      const targetAddress = typedAddress
      if (!targetAddress) {
        dialog.alert(
          'Address Required',
          // The parser's own diagnosis is far more useful than a generic message: it names
          // the wrong chain, the `.sol` name, or the truncated copy that was actually the
          // problem. The fallback explains why the address cannot come from the passkey.
          restoreParse.error ??
            'Your passkey is on this device, but the address it belongs to is not. A passkey never hands back the public key it was created with, so there is nothing here to work your wallet out from - the address has to come to us from you, and the passkey is then checked against it.\n\nPaste the smart wallet address below.',
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
          `That passkey does not belong to ${ellipsify(targetAddress, 6)}.\n\nPick the passkey you created for this wallet and try again.`,
          undefined,
          { status: 'error' },
        )
        return
      }
      if (primaryAttempt.role !== 'primary') {
        dialog.alert(
          "That's The Backup Key",
          `The passkey you picked is this wallet's Backup quorum key. It can identify the account, but it ` +
            'cannot authorize anything on its own: every transfer, unfreeze and recovery veto is signed by ' +
            'the Primary key, and the Backup only ever adds to it.\n\n' +
            `Pick the Primary passkey for ${ellipsify(targetAddress, 6)} instead.\n\n` +
            'If the Primary passkey is gone for good, this wallet has to be recovered through its guardian.',
          undefined,
          { status: 'warning' },
        )
        return
      }

      // The second key is optional in the sense that the wallet still works without it --
      // but only up to the spending limit. Said in those terms rather than as "needs both
      // keys for high-value transfers", which reads as a nice-to-have and got declined.
      const bound: { primary?: string; secondary?: string } = { primary: primaryAttempt.credentialId }
      const wantsSecondKey = await confirmDialog(
        'Add The Backup Key?',
        `Primary key bound.\n\nThis wallet holds a second, Backup quorum key. Without it you can still send up to ${spendLimitSol} SOL, but anything above that, unfreezing the wallet, and cancelling a recovery all need both keys.\n\nAdd the Backup key now?`,
        'Select Backup Passkey',
      )
      if (wantsSecondKey) {
        const second = await bindOne('secondary')
        if (second?.role === 'secondary') {
          bound.secondary = second.credentialId
        } else if (second) {
          dialog.alert(
            'Backup Key Not Bound',
            'You picked the Primary passkey again, so the Backup key was not bound. You can add it later from Settings.',
            undefined,
            { status: 'warning' },
          )
        } else {
          dialog.alert(
            'Backup Key Not Bound',
            "That passkey is not this wallet's Backup key, so it was not bound. You can add it later from Settings.",
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
    const saved = await getSavedWallet().catch(() => null)
    setDeviceHasWallet(!!saved)
    if (saved) return

    setShowAddressInput(true)
    await fillFromClipboard()
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
            openSignInSheet()
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

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Recovery Guardian (optional)</Text>
                  <TextInput
                    style={[
                      styles.textInputField,
                      guardianInput.trim() && !guardianPublicKey ? styles.textInputFieldInvalid : null,
                    ]}
                    value={guardianInput}
                    onChangeText={setGuardianInput}
                    placeholder="A Solana address you trust"
                    placeholderTextColor={p.inkMuted}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  <Text style={[styles.inputHint, guardianInput.trim() && !guardianPublicKey && styles.inputHintError]}>
                    {guardianInput.trim()
                      ? guardianPublicKey
                        ? `Only ${ellipsify(guardianPublicKey.toBase58(), 4)} can start a recovery, and a ` +
                          '24h timelock means you can still veto it. It can never move funds.'
                        : guardianParse.error
                      : 'Leave blank to use the dev guardian bundled with this build - the only key it can sign ' +
                        'a recovery with.'}
                  </Text>
                </View>

                {/* Dev-only: a 24h veto window cannot be waited out while testing, and the
                    execute leg is the half of recovery that rotates the keys. Hidden
                    outside dev mode so it cannot quietly weaken a real wallet. */}
                {AppConfig.devMode && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Recovery Timelock (dev only)</Text>
                    <TextInput
                      style={[styles.textInputField, timelockParse.error ? styles.textInputFieldInvalid : null]}
                      value={timelockInput}
                      onChangeText={setTimelockInput}
                      placeholder="Blank for 24h, or e.g. 3s"
                      placeholderTextColor={p.inkMuted}
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                    <Text style={[styles.inputHint, timelockParse.error && styles.inputHintError]}>
                      {timelockParse.error
                        ? timelockParse.error
                        : timelockParse.seconds !== null
                          ? `The owner gets ${describeTimelock(timelockParse.seconds)} to veto a recovery before it can be executed.`
                          : 'How long the owner has to veto a recovery. Shorten it to test the execute leg.'}
                    </Text>
                  </View>
                )}

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
                  {showAddressInput
                    ? 'Hide custom address'
                    : deviceHasWallet === false
                      ? 'Wallet address required on this device'
                      : 'Specify custom wallet address (Optional)'}
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

              {showAddressInput && restoreHint && (
                <View style={styles.addressHintRow}>
                  <MaterialIcons
                    name={restoreHint.tone === 'error' ? 'error-outline' : 'check-circle-outline'}
                    size={14}
                    color={restoreHint.tone === 'error' ? p.danger : p.inkSecondary}
                  />
                  <Text
                    style={[
                      styles.addressHintText,
                      { color: restoreHint.tone === 'error' ? p.danger : p.inkSecondary },
                    ]}
                  >
                    {restoreHint.text}
                  </Text>
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
    // Pulled up into the input's own trailing margin, so the hint sits under the field
    // rather than opening a second, wider gap below it.
    addressHintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: -6,
      marginBottom: 12,
      paddingHorizontal: 2,
    },
    addressHintText: { flex: 1, fontSize: 12, lineHeight: 16 },
    pasteBadgeButton: { backgroundColor: p.linkSoftBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    pasteBadgeText: { color: p.link, fontSize: 11, fontWeight: '600' },
  })
