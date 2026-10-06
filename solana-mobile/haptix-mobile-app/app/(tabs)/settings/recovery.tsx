import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Clipboard from '@/utils/clipboard'
const bs58: any = require('bs58')

import { useAuth } from '@/components/auth/auth-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { HaptixPolicySheet, PolicyLinkButton } from '@/components/haptix/haptix-policy-sheet'
import { DepthOutlineButton, HoldToConfirmButton, PrismDepthButton } from '@/components/ui'
import { useGuardianSigner } from '@/hooks/use-guardian-signer'
import { ellipsify } from '@/utils/ellipsify'
import { parseRecipientInput } from '@/utils/solana-address'
import { describeTimelock, formatRemainingTime } from '@/utils/recovery-timelock'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { getFundedDevnetPayer, isDevnetFunder } from '@/utils/haptix-funder'
import { getHaptixAddressLookupTable, buildOptimalTransaction } from '@/utils/haptix-lookup-table'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import {
  StagedRecoveryKeys,
  commitStagedRecoveryKeys,
  discardStagedRecoveryKeys,
  loadStagedRecoveryKeys,
  signWithPasskey,
  stageRecoveryKeys,
} from '@/utils/haptix-passkey'
import {
  WalletState,
  createCancelRecoveryInstruction,
  createExecuteRecoveryInstruction,
  createInitiateRecoveryInstruction,
  createSetGuardianInstruction,
  fetchHaptixWallet,
  getCancelRecoverySignedMessage,
  getSetGuardianSignedMessage,
} from '@/utils/haptix-client'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'

/**
 * Recovery
 *
 * Guardian recovery is the answer to "what happens when I lose this phone", which makes
 * it a property of the wallet rather than a daily destination. It lived behind a dock
 * tab next to Wallet and Activity, where a card that only matters on the worst day
 * competed with the two that matter every day. Settings is where a user goes
 * deliberately, which is the right amount of friction for handing recovery to an
 * address you do not control.
 *
 * The screen is self-contained: it reads the wallet's on-chain state itself rather than
 * borrowing it from the wallet screen, so an in-flight recovery is visible here without
 * the wallet screen having to be mounted first.
 */
export default function RecoverySettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const dialog = useHaptixDialog()
  const { theme, isDark } = useAppTheme()
  const { activeWallet, updateWallet } = useAuth()
  const { connection, getExplorerUrl } = useCluster()

  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark])

  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [recoveryBusy, setRecoveryBusy] = useState<null | 'initiate' | 'cancel' | 'execute'>(null)
  const [stagedRecovery, setStagedRecovery] = useState<StagedRecoveryKeys | null>(null)
  const [guardianDraft, setGuardianDraft] = useState('')
  const [showGuardianEditor, setShowGuardianEditor] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [guardianSuccess, setGuardianSuccess] = useState<{
    newGuardian: string
    previousGuardian: string | null
    signature: string
  } | null>(null)
  const [copiedSig, setCopiedSig] = useState(false)
  const [guardianBusy, setGuardianBusy] = useState(false)
  const [showPolicySheet, setShowPolicySheet] = useState(false)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const [autoGuardianKey, setAutoGuardianKey] = useState<string | null>(null)
  const [showRevealModal, setShowRevealModal] = useState(false)
  const [hasRevealedSecret, setHasRevealedSecret] = useState(false)
  const [copiedPrivateKey, setCopiedPrivateKey] = useState(false)
  const [copiedPublicAddress, setCopiedPublicAddress] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [hasSavedKeyChecked, setHasSavedKeyChecked] = useState(false)

  // 30-second auto-hide countdown for revealed private key
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    if (showRevealModal && hasRevealedSecret) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setHasRevealedSecret(false)
            return 30
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [showRevealModal, hasRevealedSecret])

  useEffect(() => {
    let cancelled = false
    const checkAutoGuardian = async () => {
      const guardianPubkey = onChainWallet?.guardian?.toBase58() || activeWallet?.guardianAddress
      if (!guardianPubkey) {
        if (!cancelled) setAutoGuardianKey(null)
        return
      }
      try {
        const storedHex = await AsyncStorage.getItem(`@haptix_auto_guardian_${guardianPubkey}`)
        if (storedHex && !cancelled) {
          const secretBytes = Buffer.from(storedHex, 'hex')
          const base58Secret = bs58.encode(secretBytes)
          setAutoGuardianKey(base58Secret)
        } else if (!cancelled) {
          setAutoGuardianKey(null)
        }
      } catch {
        if (!cancelled) setAutoGuardianKey(null)
      }
    }
    void checkAutoGuardian()
    return () => {
      cancelled = true
    }
  }, [onChainWallet?.guardian, activeWallet?.guardianAddress])

  const walletAddress = activeWallet?.address ?? null

  /**
   * `fetchHaptixWallet` answers `null` for both "no account yet" and "the read failed",
   * which the wallet screen treats as simply not-initialized. That is the right reading
   * for the badge below, so it is kept -- but a failed read must not be reported as a
   * policy that does not exist, so the two are separated by asking the chain directly.
   */
  const refreshOnChain = useCallback(async () => {
    if (!walletAddress) {
      setOnChainWallet(null)
      setIsLoading(false)
      return
    }
    try {
      setOnChainWallet(await fetchHaptixWallet(connection, new PublicKey(walletAddress)))
    } catch (err) {
      console.error('[Haptix Recovery] Read error:', formatChainErrorForLog(err))
    } finally {
      setIsLoading(false)
    }
  }, [walletAddress, connection])

  useEffect(() => {
    void refreshOnChain()
  }, [refreshOnChain])

  const rawGuardianAddress = onChainWallet?.guardian.toBase58() ?? null
  const isGuardianConfigured = Boolean(
    rawGuardianAddress &&
      !isDevnetFunder(rawGuardianAddress) &&
      rawGuardianAddress !== walletAddress &&
      rawGuardianAddress !== PublicKey.default.toBase58() &&
      activeWallet?.guardianAddress &&
      !isDevnetFunder(activeWallet.guardianAddress),
  )
  const guardianAddress = isGuardianConfigured ? rawGuardianAddress : null
  const guardianSigner = useGuardianSigner(connection, isGuardianConfigured ? guardianAddress : null)

  // The recovery in flight may have been started in an earlier session; the keys it
  // proposed live in the OS secure store, not in component state.
  useEffect(() => {
    let cancelled = false
    void loadStagedRecoveryKeys().then((keys) => {
      if (!cancelled) setStagedRecovery(keys)
    })
    return () => {
      cancelled = true
    }
  }, [onChainWallet?.recoveryInitiatedAt, walletAddress])

  // Ticking is scoped to a recovery actually being on screen: running a 1s interval for
  // the whole app would re-render this screen once a second for no reason.
  const recoveryInitiatedAt = onChainWallet?.recoveryInitiatedAt ?? 0n
  useEffect(() => {
    if (recoveryInitiatedAt === 0n) return
    setNowSeconds(Math.floor(Date.now() / 1000))
    const interval = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [recoveryInitiatedAt])

  const recoveryWindow = useMemo(() => {
    if (!onChainWallet || onChainWallet.recoveryInitiatedAt === 0n) return null
    const unlockAt = Number(onChainWallet.recoveryInitiatedAt) + Number(onChainWallet.recoveryTimelock)
    return { unlockAt, secondsLeft: Math.max(0, unlockAt - nowSeconds) }
  }, [onChainWallet, nowSeconds])

  const guardianDraftParse = useMemo(() => parseRecipientInput(guardianDraft), [guardianDraft])

  const handleBack = () => {
    Haptics.selectionAsync()
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)/settings')
    }
  }

  // --- Guardian-started recovery ------------------------------------------
  // The guardian can start a recovery and nothing else: executing waits out the
  // timelock, and a veto is signed by the very keys being replaced, so a compromised
  // guardian cannot finish a takeover.
  const runInitiateRecovery = async () => {
    if (!onChainWallet || !walletAddress) return

    const guardian = guardianSigner
    if (!guardian) {
      dialog.alert(
        'Guardian Not On This Device',
        'Starting a recovery is signed by this wallet\u2019s guardian, and this device does not hold that key. Ask the guardian to start it from their own device.',
      )
      return
    }
    if (!guardian.publicKey.equals(onChainWallet.guardian)) {
      dialog.alert(
        'Not the Guardian',
        `Only ${ellipsify(onChainWallet.guardian.toBase58(), 6)} can start a recovery for this wallet.`,
      )
      return
    }

    setRecoveryBusy('initiate')
    try {
      // Generated before the transaction so the keys written on-chain are the keys this
      // device will actually hold if the recovery is executed.
      const staged = await stageRecoveryKeys()
      setStagedRecovery(staged)

      const walletPda = new PublicKey(walletAddress)
      const initiateIx = createInitiateRecoveryInstruction({
        walletPda,
        guardian: guardian.publicKey,
        newPrimaryPasskey: new Uint8Array(Buffer.from(staged.primaryPublicKeyHex, 'hex')),
        newSecondaryPasskey: new Uint8Array(Buffer.from(staged.secondaryPublicKeyHex, 'hex')),
      })
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: guardian.publicKey, recentBlockhash: latestBlockhash.blockhash }).add(
        initiateIx,
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [guardian], { commitment: 'confirmed' })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      await refreshOnChain()
      dialog.alert(
        'Recovery Started',
        `The guardian proposed a new key pair and the wallet is frozen for ${describeTimelock(
          onChainWallet.recoveryTimelock,
        )}. You can veto it with both passkeys, or execute it once the window passes.\n\nTx: ${ellipsify(sig, 8)}`,
        [
          { text: 'View on Explorer', onPress: () => Linking.openURL(getExplorerUrl(`tx/${sig}`)) },
          { text: 'Done', style: 'default' },
        ],
      )
    } catch (err: any) {
      console.error('[Haptix Recovery] Initiate error:', formatChainErrorForLog(err))
      dialog.alert(
        'Recovery Not Started',
        describeChainError(err, 'The guardian could not start a recovery on-chain. Please try again.'),
      )
    } finally {
      setRecoveryBusy(null)
    }
  }

  const handleStartRecovery = () => {
    if (!onChainWallet) return
    dialog.alert(
      'Start Guardian Recovery?',
      'This is the flow to use when the device holding your passkeys is gone. The guardian ' +
        `proposes a new key pair, this wallet freezes for ${describeTimelock(
          onChainWallet.recoveryTimelock,
        )}, and you can still veto it with the current passkeys during that window.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start Recovery', style: 'destructive', onPress: () => void runInitiateRecovery() },
      ],
    )
  }

  const runCancelRecovery = async () => {
    if (!walletAddress) return
    setRecoveryBusy('cancel')
    try {
      const walletPda = new PublicKey(walletAddress)
      const fresh = await fetchHaptixWallet(connection, walletPda)
      if (!fresh) {
        dialog.alert('Wallet not on-chain', 'There is no on-chain wallet to veto a recovery for.')
        return
      }
      const message = getCancelRecoverySignedMessage(walletPda, fresh.authNonce)

      const primarySig = await signWithPasskey('primary', message, 'Veto Guardian Recovery (Primary)')
      const secondarySig = await signWithPasskey(
        'secondary',
        message,
        'Confirm cancelling the recovery with your backup key',
      )

      const precompilePrimary = createSecp256r1Instruction({ ...primarySig, message })
      const precompileSecondary = createSecp256r1Instruction({ ...secondarySig, message })
      const cancelIx = createCancelRecoveryInstruction({ walletPda, primarySigIxIndex: 0, secondarySigIxIndex: 1 })

      const payer = await getFundedDevnetPayer(connection)
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const lookupTable = await getHaptixAddressLookupTable(connection, walletPda, payer).catch(() => null)
      const { rawTx } = buildOptimalTransaction({
        payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [precompilePrimary, precompileSecondary, cancelIx],
        lookupTable,
      })

      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )

      // The proposed pair is dead the moment the veto lands; keeping it staged would
      // leave this device ready to execute a recovery that no longer exists.
      await discardStagedRecoveryKeys()
      setStagedRecovery(null)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await refreshOnChain()
      dialog.alert(
        'Recovery Cancelled',
        `Verified with both passkeys and discarded the guardian\u2019s proposed keys. The wallet is unfrozen.\n\nTx: ${ellipsify(
          sig,
          8,
        )}`,
      )
    } catch (err: any) {
      console.error('[Haptix Recovery] Cancel error:', formatChainErrorForLog(err))
      dialog.alert(
        'Veto Failed',
        describeChainError(err, 'The recovery could not be cancelled on-chain. Please try again.'),
      )
    } finally {
      setRecoveryBusy(null)
    }
  }

  const runExecuteRecovery = async () => {
    if (!activeWallet?.address || !onChainWallet) return
    setRecoveryBusy('execute')
    try {
      const walletPda = new PublicKey(activeWallet.address)
      const payer = await getFundedDevnetPayer(connection)
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latestBlockhash.blockhash }).add(
        createExecuteRecoveryInstruction({ walletPda }),
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })

      // The program now expects the staged pair, so this device has to start signing with
      // it -- otherwise the recovery succeeds on-chain and leaves the owner holding a
      // wallet none of their keys can spend from.
      const committed = await commitStagedRecoveryKeys()
      if (committed) {
        const updated = {
          ...activeWallet,
          primaryPasskeyHex: committed.primaryPublicKeyHex,
          secondaryPasskeyHex: committed.secondaryPublicKeyHex,
          // The old credential ids point at the keys that were just replaced.
          primaryCredentialId: undefined,
          secondaryCredentialId: undefined,
          primaryPasskeyLabel: 'Recovered key 1 (this device)',
          secondaryPasskeyLabel: 'Recovered key 2 (this device)',
        }
        await updateWallet(updated)
        setStagedRecovery(null)
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await refreshOnChain()

      if (committed) {
        dialog.alert(
          'Wallet Recovered',
          `The replacement keys are now in force and this device signs with them. The address is unchanged, so ` +
            `any funds sent to it are still yours.\n\nTx: ${ellipsify(sig, 8)}`,
        )
      } else {
        // Executing is permissionless, so this device may not hold the keys it just
        // installed -- saying so is the only way the next step makes sense.
        dialog.alert(
          'Recovery Executed',
          'The proposed keys are now in force, but they were staged on another device. This device ' +
            'cannot sign for this wallet until you restore it there.',
        )
      }
    } catch (err: any) {
      console.error('[Haptix Recovery] Execute error:', formatChainErrorForLog(err))
      dialog.alert(
        'Recovery Not Executed',
        describeChainError(err, 'The recovery could not be executed on-chain. Please try again.'),
      )
    } finally {
      setRecoveryBusy(null)
    }
  }

  const handleExecuteRecovery = () => {
    const stagedNote = stagedRecovery
      ? 'The keys this device staged will be installed and start signing for the wallet.'
      : 'The keys staged on the other device will be installed; this device will not be able to sign afterwards.'
    dialog.alert(
      'Execute Recovery?',
      `This installs the replacement passkeys and unfreezes the wallet. ${stagedNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Execute', style: 'destructive', onPress: () => void runExecuteRecovery() },
      ],
    )
  }

  // --- Guardian configuration ---------------------------------------------
  const runSetGuardian = async () => {
    if (!activeWallet?.address || !onChainWallet) return

    const parsed = guardianDraftParse
    if (!parsed.address) {
      dialog.alert('Check the guardian address', parsed.error ?? 'That is not a Solana address.')
      return
    }

    const newGuardian = new PublicKey(parsed.address)
    if (newGuardian.equals(onChainWallet.guardian)) {
      dialog.alert('Already The Guardian', `${ellipsify(parsed.address, 6)} is already this wallet's guardian.`)
      return
    }
    if (newGuardian.equals(new PublicKey(activeWallet.address))) {
      dialog.alert(
        'That Is This Wallet',
        'The wallet cannot be its own guardian \u2014 a recovery would then need the wallet to authorize itself.',
      )
      return
    }

    setGuardianBusy(true)
    try {
      const walletPda = new PublicKey(activeWallet.address)
      if (newGuardian.equals(walletPda)) {
        dialog.alert('Invalid Guardian', 'The wallet cannot be its own recovery guardian. Please enter a different address.')
        return
      }
      const fresh = await fetchHaptixWallet(connection, walletPda)
      if (!fresh) {
        dialog.alert('Wallet not on-chain', 'Activate the wallet before changing its guardian.')
        return
      }
      const message = getSetGuardianSignedMessage(walletPda, newGuardian, fresh.authNonce)

      const primarySig = await signWithPasskey('primary', message, 'Change Guardian (Primary)')
      const secondarySig = await signWithPasskey('secondary', message, 'Confirm the new guardian with your backup key')

      const precompilePrimary = createSecp256r1Instruction({ ...primarySig, message })
      const precompileSecondary = createSecp256r1Instruction({ ...secondarySig, message })
      const setGuardianIx = createSetGuardianInstruction({
        walletPda,
        newGuardian,
        primarySigIxIndex: 0,
        secondarySigIxIndex: 1,
      })

      const payer = await getFundedDevnetPayer(connection)
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const lookupTable = await getHaptixAddressLookupTable(connection, walletPda, payer).catch(() => null)
      const { rawTx } = buildOptimalTransaction({
        payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [precompilePrimary, precompileSecondary, setGuardianIx],
        lookupTable,
      })

      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )

      const prevGuardian = onChainWallet?.guardian?.toBase58() ?? activeWallet?.guardianAddress ?? null

      // The record carries the guardian so a wallet that is re-initialized from this
      // device is created with the one just installed, rather than the old default.
      await updateWallet({ ...activeWallet, guardianAddress: parsed.address })
      setGuardianDraft('')
      setShowGuardianEditor(false)
      await refreshOnChain()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setGuardianSuccess({
        newGuardian: parsed.address,
        previousGuardian: prevGuardian && prevGuardian !== parsed.address ? prevGuardian : null,
        signature: sig,
      })
    } catch (err: any) {
      console.error('[Haptix Guardian] Set error:', formatChainErrorForLog(err))
      dialog.alert(
        'Guardian Not Updated',
        describeChainError(err, 'The guardian could not be changed on-chain. Please try again.'),
      )
    } finally {
      setGuardianBusy(false)
    }
  }

  const handleSetGuardian = async () => {
    const parsed = guardianDraftParse
    if (!parsed.address) {
      dialog.alert('Check the guardian address', parsed.error ?? 'Enter the address that should guard this wallet.')
      return
    }
    if (isDevnetFunder(parsed.address)) {
      dialog.alert(
        'Independent Guardian Required',
        'The recovery guardian cannot be a key held by this app or the devnet funder. Please enter an independent external address (e.g. Phantom, Solflare, or a hardware wallet).',
      )
      return
    }

    // If the wallet is not yet initialized on-chain, save the guardian address to the local wallet profile
    if (!onChainWallet) {
      if (!activeWallet) return
      try {
        setGuardianBusy(true)
        await updateWallet({
          ...activeWallet,
          guardianAddress: parsed.address,
        })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        dialog.alert(
          'Guardian Address Saved',
          `Your guardian address has been saved as ${ellipsify(parsed.address, 6)}. It will be registered on-chain when the wallet is initialized.`,
        )
        setGuardianDraft('')
        setShowGuardianEditor(false)
      } catch (err: any) {
        dialog.alert('Error', err?.message || 'Failed to save guardian address.')
      } finally {
        setGuardianBusy(false)
      }
      return
    }

    // On-chain wallet: show passkey confirmation modal to execute on-chain tx
    setShowConfirmModal(true)
  }

  // Same inset maths as the settings header, so the two screens' headers sit at the same
  // height when you move between them.
  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

  const timelockLabel = onChainWallet ? describeTimelock(onChainWallet.recoveryTimelock) : '24h'

  // Safety Reassurance Callout ("A recovery never moves the wallet...")
  const renderReassuranceBox = (extraStyle?: object) => (
    <View
      style={[
        styles.reassuranceBox,
        {
          backgroundColor: isDark ? '#161619' : '#F5F5F7',
          borderColor: isDark ? '#26262C' : theme.borderDefault,
        },
        extraStyle,
      ]}
    >
      <MaterialIcons name="gpp-good" size={16} color={theme.textMuted} style={{ marginTop: 2, flexShrink: 0 }} />
      <Text style={[styles.reassuranceText, { color: theme.textSecondary }]}>
        A recovery never moves the wallet. The address stays the same, so anything sent to it during the window is still yours afterward.
      </Text>
    </View>
  )

  // Guardian Card (locked during an active recovery)
  const renderGuardianCard = (isLocked: boolean) => {
    const guardianPubkey = onChainWallet?.guardian?.toBase58() || activeWallet?.guardianAddress || null
    return (
      <>
        {/* Card 1: Guardian Card */}
        <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Guardian</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={[
                  styles.statusCircleDot,
                  { borderColor: isGuardianConfigured ? '#5FBF7A' : '#8A8985' },
                ]}
              />
              <Text
                style={{
                  fontSize: 12,
                  color: isGuardianConfigured ? '#5FBF7A' : '#8A8985',
                  fontWeight: '400',
                }}
              >
                {autoGuardianKey
                  ? (isGuardianConfigured ? 'Active' : 'Set on first use')
                  : (isGuardianConfigured ? 'Active' : 'Not configured')}
              </Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[styles.detailTitle, { color: theme.textPrimary }]}>
                {autoGuardianKey
                  ? '1 recovery key'
                  : isGuardianConfigured
                  ? '1 guardian'
                  : '0 guardians'}
              </Text>
              <Text style={[styles.detailDesc, { color: theme.textMuted }]}>
                {autoGuardianKey
                  ? 'Created on this phone'
                  : isGuardianConfigured
                  ? 'Can only start a recovery, never move funds'
                  : 'Add a trusted address to protect against device loss'}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end', paddingLeft: 8 }}>
              <Text style={[styles.detailTitle, { color: theme.textPrimary }]}>
                {timelockLabel.toLowerCase()} timelock
              </Text>
              <Text style={[styles.detailDesc, { color: theme.textMuted, textAlign: 'right' }]}>
                Both passkeys can cancel it
              </Text>
            </View>
          </View>

          <View style={[styles.guardianRow, { backgroundColor: isDark ? '#1A1A18' : theme.bgInput, borderColor: theme.borderDefault }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.guardianLabel, { color: theme.textMuted }]}>
                  {autoGuardianKey ? 'Recovery key address' : 'Guardian address'}
                </Text>
                <Text
                  style={[
                    styles.guardianValue,
                    { color: guardianPubkey ? theme.textPrimary : theme.textMuted },
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {guardianPubkey
                    ? ellipsify(guardianPubkey, 8)
                    : 'None (tap below to configure)'}
                </Text>
              </View>
              {guardianPubkey ? (
                <TouchableOpacity
                  onPress={() => {
                    Clipboard.setString(guardianPubkey)
                    setCopiedPublicAddress(true)
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                    setTimeout(() => setCopiedPublicAddress(false), 2000)
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={{ justifyContent: 'center', paddingLeft: 8 }}
                >
                  <MaterialIcons
                    name={copiedPublicAddress ? 'check' : 'content-copy'}
                    size={16}
                    color={copiedPublicAddress ? '#5FBF7A' : theme.textMuted}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {isLocked ? (
            <View style={[styles.guardianToggle, { opacity: 0.45 }]}>
              <MaterialIcons name="lock" size={14} color={theme.textMuted} />
              <Text style={[styles.guardianToggleText, { color: theme.textMuted }]}>
                Change guardian locked during recovery
              </Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.guardianToggle}
                onPress={() => {
                  Haptics.selectionAsync()
                  setShowGuardianEditor((prev) => !prev)
                }}
                disabled={guardianBusy}
                accessibilityRole="button"
              >
                <Text style={[styles.guardianToggleText, { color: theme.textSecondary }]}>
                  {showGuardianEditor
                    ? 'Cancel'
                    : autoGuardianKey
                    ? 'Use a different guardian'
                    : isGuardianConfigured
                    ? 'Change guardian'
                    : 'Set recovery guardian'}
                </Text>
                <MaterialIcons
                  name={showGuardianEditor ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={16}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {showGuardianEditor && (
                <View style={[styles.guardianEditor, { borderColor: theme.borderDefault }]}>
                  <View
                    style={[
                      styles.guardianInputRow,
                      { backgroundColor: theme.bgInput, borderColor: theme.borderDefault },
                    ]}
                  >
                    <TextInput
                      style={[styles.guardianInput, { color: theme.textPrimary, flex: 1 }]}
                      value={guardianDraft}
                      onChangeText={setGuardianDraft}
                      placeholder="Paste the new guardian's address"
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!guardianBusy}
                    />
                    {guardianDraft.length > 0 ? (
                      <TouchableOpacity
                        onPress={() => setGuardianDraft('')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Clear guardian address"
                      >
                        <MaterialIcons name="cancel" size={18} color={theme.textMuted} />
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={async () => {
                          const text = await Clipboard.getString()
                          if (text) setGuardianDraft(text)
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <MaterialIcons name="content-paste" size={14} color={theme.accent} />
                        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }}>Paste</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text
                    style={[
                      styles.guardianHint,
                      {
                        color:
                          guardianDraft.length > 0 && !guardianDraftParse.address ? theme.roseText : theme.textMuted,
                      },
                    ]}
                  >
                    {guardianDraft.length > 0 && !guardianDraftParse.address
                      ? (guardianDraftParse.error ?? 'Enter a valid Solana address or domain.')
                      : !onChainWallet
                      ? (guardianDraftParse.address
                          ? `Guardian will become ${ellipsify(guardianDraftParse.address, 6)}. It will be registered on-chain when initialized.`
                          : 'The guardian will be officially registered on-chain when the account is deployed.')
                      : guardianDraft.trim().length === 0
                      ? 'Requires 2-of-2 passkeys. Guardian can only start recovery.'
                      : (guardianDraftParse.error ??
                        `Guardian will become ${ellipsify(guardianDraftParse.address ?? '', 6)}.`)}
                  </Text>

                  <TouchableOpacity
                    style={[
                      styles.updateGuardianBtn,
                      guardianDraftParse.address
                        ? { backgroundColor: '#6C8CFF' }
                        : { backgroundColor: isDark ? '#1C1C20' : '#E5E5EA' },
                      (guardianBusy || !guardianDraftParse.address) && { opacity: guardianBusy ? 0.7 : 0.6 },
                    ]}
                    disabled={guardianBusy || !guardianDraftParse.address}
                    onPress={handleSetGuardian}
                    activeOpacity={0.85}
                  >
                    {guardianBusy ? (
                      <ActivityIndicator size="small" color={guardianDraftParse.address ? '#080C1E' : theme.textMuted} />
                    ) : (
                      <Text
                        style={[
                          styles.updateGuardianBtnText,
                          {
                            color: guardianDraftParse.address ? '#080C1E' : (isDark ? '#71717A' : '#8E8E93'),
                          },
                        ]}
                      >
                        {onChainWallet ? 'Update guardian' : 'Save guardian'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* Card 2: Back up your recovery key */}
        {autoGuardianKey && (
          <View style={[styles.card, styles.backupCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
            <View style={styles.backupCardHeader}>
              <View style={styles.backupIconRing}>
                <MaterialIcons name="vpn-key" size={18} color={isDark ? '#D99A2B' : '#B45309'} />
              </View>
              <Text style={[styles.backupCardTitle, { color: theme.textPrimary }]}>
                Back up your recovery key
              </Text>
            </View>
            <Text style={[styles.backupCardDesc, { color: theme.textSecondary }]}>
              This wallet's recovery key was created on this phone during setup. Save a copy in a password manager or on paper so you can rescue your funds if you lose this phone.
            </Text>
            <TouchableOpacity
              style={styles.backupActionBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                setHasRevealedSecret(false)
                setCopiedPrivateKey(false)
                setHasSavedKeyChecked(false)
                setCountdown(30)
                setShowRevealModal(true)
              }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="visibility" size={17} color="#0C0C0D" style={{ marginRight: 7 }} />
              <Text style={styles.backupActionBtnText}>View recovery key</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bgApp }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.bgApp, borderBottomColor: theme.borderSubtle, paddingTop: headerPaddingTop },
        ]}
      >
        <View style={styles.pageTitleRow}>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
            onPress={handleBack}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back to settings"
          >
            <MaterialIcons name="arrow-back" size={18} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.pageTitleText}>
            <View style={styles.titleWithPolicyRow}>
              <Text style={[styles.pageTitle, { color: theme.textPrimary }]}>Recovery</Text>
              <PolicyLinkButton onPress={() => setShowPolicySheet(true)} />
            </View>
            <Text style={[styles.pageSubtitle, { color: theme.textMuted }]}>
              Who can rescue this wallet if you lose this device
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.textMuted} />
            <Text style={[styles.loadingText, { color: theme.textMuted }]}>Reading on-chain policy…</Text>
          </View>
        ) : null}

        {recoveryWindow ? (
          <>
            {/* 1. Amber Hero Countdown Banner */}
            <View
              style={[
                styles.heroCountdownBanner,
                {
                  backgroundColor: isDark ? 'rgba(217, 154, 43, 0.10)' : '#FEF3C7',
                  borderColor: isDark ? 'rgba(217, 154, 43, 0.35)' : '#FDE68A',
                },
              ]}
            >
              <View style={styles.bannerHeaderRow}>
                <MaterialIcons name="schedule" size={18} color={isDark ? '#D99A2B' : '#D97706'} />
                <Text style={[styles.bannerHeaderTitle, { color: isDark ? '#D99A2B' : '#D97706' }]}>
                  Recovery in progress
                </Text>
              </View>
              <Text
                style={[
                  styles.heroCountdownText,
                  { color: isDark ? '#FFFFFF' : '#111827' },
                ]}
              >
                {recoveryWindow.secondsLeft > 0 ? formatRemainingTime(recoveryWindow.secondsLeft) : 'Timelock elapsed'}
              </Text>
              <Text style={[styles.bannerSubtitle, { color: isDark ? '#A1A1AA' : '#6B7280' }]}>
                {recoveryWindow.secondsLeft > 0
                  ? 'left in the dispute window. The wallet is frozen while this is in progress.'
                  : 'The dispute window has passed. You can finalize recovery or veto with your passkeys.'}
              </Text>
            </View>

            {/* 2. Proposed Pending Replacement Keys Card */}
            {onChainWallet && (
              <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: isDark ? 'rgba(217, 154, 43, 0.35)' : '#FDE68A', marginBottom: 16 }]}>
                <View style={styles.cardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialIcons name="vpn-key" size={18} color={isDark ? '#D99A2B' : '#D97706'} />
                    <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Proposed replacement keys</Text>
                  </View>
                  <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(217, 154, 43, 0.15)' : '#FEF3C7', borderColor: isDark ? 'rgba(217, 154, 43, 0.4)' : '#FDE68A' }]}>
                    <Text style={[styles.tagText, { color: isDark ? '#D99A2B' : '#D97706', fontWeight: '600' }]}>Pending</Text>
                  </View>
                </View>

                <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 12, lineHeight: 18 }}>
                  The guardian proposed these new public keys to replace your current passkeys. If not vetoed before the timelock expires, these keys will gain full control of this wallet:
                </Text>

                <View style={{ backgroundColor: isDark ? '#161619' : '#F5F5F7', borderColor: isDark ? '#26262C' : theme.borderDefault, borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 }}>
                  <View>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: theme.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>
                      Candidate Primary Passkey
                    </Text>
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: theme.textPrimary }} numberOfLines={1} ellipsizeMode="middle">
                      {onChainWallet.pendingPrimaryPasskey && onChainWallet.pendingPrimaryPasskey.some((b) => b !== 0)
                        ? Buffer.from(onChainWallet.pendingPrimaryPasskey).toString('hex')
                        : 'None set'}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: theme.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>
                      Candidate Backup Passkey
                    </Text>
                    <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: theme.textPrimary }} numberOfLines={1} ellipsizeMode="middle">
                      {onChainWallet.pendingSecondaryPasskey && onChainWallet.pendingSecondaryPasskey.some((b) => b !== 0)
                        ? Buffer.from(onChainWallet.pendingSecondaryPasskey).toString('hex')
                        : 'None set'}
                    </Text>
                  </View>
                </View>

                <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 10, lineHeight: 17 }}>
                  If you still control your passkeys, tap <Text style={{ fontWeight: '600', color: theme.textPrimary }}>Veto and keep my keys</Text> below to immediately cancel this rotation and unfreeze your wallet.
                </Text>
              </View>
            )}

            {/* 3. Recovery Flow Card (Promoted to Top during emergency) */}
            <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Recovery flow</Text>
              </View>

              {renderReassuranceBox()}

              <View style={styles.actionColumn}>
                <PrismDepthButton
                  title="Veto and keep my keys"
                  variant="primary"
                  size="large"
                  loading={recoveryBusy === 'cancel'}
                  disabled={recoveryBusy !== null}
                  onPress={() => void runCancelRecovery()}
                  icon={
                    <MaterialIcons
                      name="gpp-good"
                      size={20}
                      color={recoveryBusy !== null && recoveryBusy !== 'cancel' ? theme.textMuted : theme.accentForeground}
                    />
                  }
                />
                <Text style={[styles.actionCaption, { color: theme.textMuted, marginBottom: 12 }]}>
                  Requires both passkeys
                </Text>

                {recoveryWindow.secondsLeft > 0 ? (
                  <>
                    <View
                      style={[
                        styles.disabledFinalizeBtn,
                        {
                          backgroundColor: isDark ? '#1C1C1F' : '#F4F5F7',
                          borderColor: isDark ? '#26262C' : '#E2E4E9',
                        },
                      ]}
                    >
                      <Text style={[styles.disabledFinalizeText, { color: theme.textMuted }]}>
                        Finalize recovery
                      </Text>
                    </View>
                    <Text style={[styles.actionCaption, { color: theme.textMuted }]}>
                      Unlocks when the dispute window ends
                    </Text>
                  </>
                ) : (
                  <>
                    <HoldToConfirmButton
                      variant="danger"
                      label={recoveryBusy === 'execute' ? 'Finalizing…' : 'Hold to Finalize Recovery'}
                      confirmingLabel="Keep holding…"
                      completedLabel="Finalizing…"
                      holdDurationMs={1200}
                      onConfirm={() => {
                        if (recoveryBusy === null) handleExecuteRecovery()
                      }}
                    />
                    <Text style={[styles.actionCaption, { color: theme.roseText }]}>
                      Dispute window ended. Irreversibly installs proposed keys.
                    </Text>
                  </>
                )}
              </View>
            </View>

            {/* 3. Guardian Card (Demoted to bottom and locked during recovery) */}
            {renderGuardianCard(true)}
          </>
        ) : (
          <>
            {/* IDLE STATE: 1. Guardian Card leads */}
            {renderGuardianCard(false)}

            {/* IDLE STATE: 2. Recovery Flow Card */}
            <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Recovery flow</Text>
              </View>

              <Text style={[styles.bodyText, { color: theme.textSecondary, marginBottom: 12 }]}>
                {!onChainWallet
                  ? 'The guardian is recorded when the account is first created on-chain, so there is nothing to recover yet.'
                  : guardianSigner
                  ? 'Your guardian can start a recovery from their own wallet or web portal if you lose this device. You can veto it here at any point during the dispute window.'
                  : 'Recovery is started by the guardian from their own device. This build cannot sign as it.'}
              </Text>

              {renderReassuranceBox({ marginBottom: onChainWallet && guardianSigner ? 14 : 0 })}

              {onChainWallet && guardianSigner && isGuardianConfigured ? (
                <View
                  style={[
                    styles.testSimulationBox,
                    {
                      backgroundColor: isDark ? '#141416' : '#FAFAFA',
                      borderColor: isDark ? '#323238' : '#D1D5DB',
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <MaterialIcons name="science" size={16} color={theme.textSecondary} />
                    <Text style={[styles.testSimulationTitle, { color: theme.textPrimary }]}>
                      Devnet simulation
                    </Text>
                  </View>
                  <Text style={[styles.testSimulationDesc, { color: theme.textSecondary }]}>
                    Simulate losing this phone by broadcasting an on-chain freeze with your devnet guardian keypair. You can test the dispute window and veto it with your passkeys.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.simulateBtn,
                      {
                        backgroundColor: isDark ? '#1E1E22' : '#FFFFFF',
                        borderColor: isDark ? '#2E2E36' : theme.borderDefault,
                      },
                      recoveryBusy !== null && { opacity: 0.6 },
                    ]}
                    onPress={handleStartRecovery}
                    disabled={recoveryBusy !== null}
                    activeOpacity={0.85}
                  >
                    {recoveryBusy === 'initiate' ? (
                      <ActivityIndicator size="small" color="#5E81FF" />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="lock-outline" size={16} color={isDark ? '#E4E4E7' : theme.textPrimary} />
                        <Text style={[styles.simulateBtnText, { color: isDark ? '#E4E4E7' : theme.textPrimary }]}>
                          Simulate lost phone recovery
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      {/* Recovery Policy Sheet */}
      <HaptixPolicySheet
        topic={showPolicySheet ? 'recovery' : null}
        onClose={() => setShowPolicySheet(false)}
      />

      {/* Change / Set Guardian Confirmation Modal */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowConfirmModal(false)}
        >
          <Pressable style={styles.confirmDialogCard} onPress={(e) => e.stopPropagation()}>
            {/* Header Alert Circle Icon */}
            <View style={styles.confirmDialogIconCircle}>
              <MaterialIcons name="error-outline" size={26} color="#E5484D" />
            </View>

            {/* Header Title & Subtitle */}
            <Text style={styles.confirmDialogTitle}>
              {isGuardianConfigured ? 'Change the guardian?' : 'Set a guardian?'}
            </Text>
            <Text style={styles.confirmDialogSubtitle}>
              The new guardian will be able to start a recovery of this wallet.
            </Text>

            {/* Address Comparison Card */}
            <View style={styles.confirmAddressTable}>
              {isGuardianConfigured && onChainWallet ? (
                <View style={styles.confirmAddressRowBorder}>
                  <Text style={styles.confirmAddressLabel}>Current</Text>
                  <Text style={styles.confirmAddressValueMono}>
                    {ellipsify(onChainWallet.guardian.toBase58(), 6)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.confirmAddressRow}>
                <Text style={styles.confirmAddressLabel}>
                  {isGuardianConfigured ? 'New' : 'Guardian'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.confirmAddressNewValue}>
                    {ellipsify(guardianDraftParse.address ?? '', 6)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      if (guardianDraftParse.address) {
                        Clipboard.setString(guardianDraftParse.address)
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                      }
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="content-copy" size={13} color="#8A8985" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Three Consequences */}
            <View style={styles.confirmConsequencesList}>
              <View style={styles.confirmConsequenceRow}>
                <MaterialIcons name="warning-amber" size={16} color="#8A8985" style={{ marginTop: 1, flexShrink: 0 }} />
                <Text style={styles.confirmConsequenceText}>
                  Handing recovery to an address you don't control is the same as giving your wallet away.
                </Text>
              </View>
              <View style={styles.confirmConsequenceRow}>
                <MaterialIcons name="fingerprint" size={16} color="#8A8985" style={{ marginTop: 1, flexShrink: 0 }} />
                <Text style={styles.confirmConsequenceText}>
                  Needs both passkeys to confirm.
                </Text>
              </View>
              <View style={styles.confirmConsequenceRow}>
                <MaterialIcons name="replay" size={16} color="#8A8985" style={{ marginTop: 1, flexShrink: 0 }} />
                <Text style={styles.confirmConsequenceText}>
                  You can undo this later, but only with both passkeys.
                </Text>
              </View>
            </View>

            {/* Bottom Actions */}
            <View style={styles.confirmButtonsRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setShowConfirmModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmActionBtn}
                onPress={() => {
                  setShowConfirmModal(false)
                  void runSetGuardian()
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmActionText}>
                  {isGuardianConfigured ? 'Change guardian' : 'Set guardian'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Guardian Updated Success Modal */}
      <Modal
        visible={guardianSuccess !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setGuardianSuccess(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setGuardianSuccess(null)}>
          {guardianSuccess && (
            <Pressable
              style={styles.successSheetCard}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Drag Handle */}
              <View style={styles.successHandle} />

              {/* Header with Emerald Checkmark Ring */}
              <View style={styles.successHeader}>
                <View style={styles.successRing}>
                  <MaterialIcons name="check" size={28} color="#5FBF7A" />
                </View>

                <Text style={styles.successLabel}>Guardian updated</Text>
                <Text style={styles.successHeroAddress}>
                  {ellipsify(guardianSuccess.newGuardian, 6)}
                </Text>
                {guardianSuccess.previousGuardian ? (
                  <Text style={styles.successPrevious}>
                    Changed from {ellipsify(guardianSuccess.previousGuardian, 6)}
                  </Text>
                ) : null}
              </View>

              {/* Detail Box */}
              <View style={styles.successDetailBox}>
                <View style={styles.successDetailRow}>
                  <Text style={styles.successDetailLabel}>Approved with</Text>
                  <Text style={styles.successDetailValue}>Both passkeys</Text>
                </View>
                <View style={styles.successDetailRow}>
                  <Text style={styles.successDetailLabel}>Can</Text>
                  <Text style={styles.successDetailValue}>Start a recovery</Text>
                </View>
                <View style={styles.successDetailRow}>
                  <Text style={styles.successDetailLabel}>Cannot</Text>
                  <Text style={styles.successDetailValue}>Move funds</Text>
                </View>
                <View style={styles.successDetailRowLast}>
                  <Text style={styles.successDetailLabel}>Signature</Text>
                  <TouchableOpacity
                    onPress={() => {
                      Clipboard.setString(guardianSuccess.signature)
                      setCopiedSig(true)
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                      setTimeout(() => setCopiedSig(false), 2000)
                    }}
                    style={styles.successSigWrap}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.successSigMono}>
                      {ellipsify(guardianSuccess.signature, 8)}
                    </Text>
                    <MaterialIcons
                      name={copiedSig ? 'check' : 'content-copy'}
                      size={13}
                      color={copiedSig ? '#5FBF7A' : '#8A8985'}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Done Button */}
              <TouchableOpacity
                style={styles.successDoneBtn}
                onPress={() => setGuardianSuccess(null)}
                activeOpacity={0.8}
              >
                <Text style={styles.successDoneText}>Done</Text>
              </TouchableOpacity>

              {/* View on Solscan Button */}
              <TouchableOpacity
                style={styles.successExplorerBtn}
                onPress={() => {
                  const url = getExplorerUrl(`tx/${guardianSuccess.signature}`)
                  Linking.openURL(url)
                }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="open-in-new" size={15} color={isDark ? '#8A8985' : '#6B6A64'} />
                <Text style={styles.successExplorerText}>View on Solscan</Text>
              </TouchableOpacity>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* Auto Guardian Reveal & Backup Modal */}
      <Modal
        visible={showRevealModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowRevealModal(false)
          setHasRevealedSecret(false)
        }}
      >
        <Pressable
          style={styles.revealModalBackdrop}
          onPress={() => {
            setShowRevealModal(false)
            setHasRevealedSecret(false)
          }}
        >
          <Pressable style={styles.revealModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.revealHandle} />

            <View style={styles.revealModalHeader}>
              <View style={styles.revealIconRing}>
                <MaterialIcons name="vpn-key" size={19} color={isDark ? '#D99A2B' : '#B45309'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.revealModalTitle}>Recovery key</Text>
                <Text style={styles.revealModalSubtitle}>Created on this phone during setup</Text>
              </View>
            </View>

            {/* Warning Box (No truncation, full message, accessible contrast) */}
            <View style={styles.revealWarningBox}>
              <MaterialIcons
                name="security"
                size={17}
                color={isDark ? '#E5484D' : '#DC2626'}
                style={{ marginTop: 1, flexShrink: 0 }}
              />
              <Text style={styles.revealWarningText}>
                Never share this key. Anyone who has it can start a recovery of your wallet. Store it in a password manager.
              </Text>
            </View>

            {/* Public Address */}
            <Text style={styles.revealSectionLabel}>Public address</Text>
            <View style={styles.revealAddressRow}>
              <Text style={styles.revealAddressText} numberOfLines={1} ellipsizeMode="middle">
                {onChainWallet?.guardian.toBase58() || activeWallet?.guardianAddress || '--'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  const addr = onChainWallet?.guardian.toBase58() || activeWallet?.guardianAddress
                  if (addr) {
                    Clipboard.setString(addr)
                    setCopiedPublicAddress(true)
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                    setTimeout(() => setCopiedPublicAddress(false), 2000)
                  }
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons
                  name={copiedPublicAddress ? 'check' : 'content-copy'}
                  size={15}
                  color={copiedPublicAddress ? '#5FBF7A' : '#8A8985'}
                />
              </TouchableOpacity>
            </View>

            {/* Private Key Header */}
            <View style={styles.revealSecretHeaderRow}>
              <Text style={styles.revealSectionLabel}>Private key</Text>
              <Text style={styles.revealCompatLabel}>Works in Phantom and Solflare</Text>
            </View>

            {/* Reveal Box */}
            <TouchableOpacity
              style={[
                styles.revealSecretDashedBox,
                hasRevealedSecret && styles.revealSecretDashedBoxRevealed,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                if (hasRevealedSecret) {
                  setHasRevealedSecret(false)
                } else {
                  setHasRevealedSecret(true)
                  setCountdown(30)
                }
              }}
              activeOpacity={0.8}
            >
              {hasRevealedSecret ? (
                <Text style={styles.revealSecretMonoText} selectable>
                  {autoGuardianKey}
                </Text>
              ) : (
                <View style={styles.revealTapRow}>
                  <MaterialIcons name="visibility" size={17} color={theme.textPrimary} />
                  <Text style={styles.revealTapText}>Tap to reveal</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Auto-hide countdown */}
            {hasRevealedSecret ? (
              <Text style={styles.revealCountdownText}>
                Hides in {countdown}s
              </Text>
            ) : (
              <View style={{ height: 10 }} />
            )}

            {/* Secondary Copy Button */}
            <TouchableOpacity
              style={styles.revealSecondaryCopyBtn}
              onPress={() => {
                if (autoGuardianKey) {
                  Clipboard.setString(autoGuardianKey)
                  setCopiedPrivateKey(true)
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                  setTimeout(() => setCopiedPrivateKey(false), 2500)
                }
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={copiedPrivateKey ? 'check' : 'content-copy'}
                size={16}
                color={copiedPrivateKey ? '#5FBF7A' : '#8A8985'}
                style={{ marginRight: 7 }}
              />
              <Text style={[styles.revealSecondaryCopyText, copiedPrivateKey && { color: '#5FBF7A' }]}>
                {copiedPrivateKey ? 'Copied' : 'Copy private key'}
              </Text>
            </TouchableOpacity>
            {copiedPrivateKey && (
              <Text style={styles.revealClipboardNote}>
                Paste it into your password manager, then clear your clipboard.
              </Text>
            )}

            {/* Checkbox confirmation */}
            <TouchableOpacity
              style={styles.revealCheckboxRow}
              onPress={() => {
                Haptics.selectionAsync()
                setHasSavedKeyChecked((prev) => !prev)
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.customCheckbox, hasSavedKeyChecked && styles.customCheckboxChecked]}>
                {hasSavedKeyChecked && <MaterialIcons name="check" size={13} color="#0C0C0D" />}
              </View>
              <Text style={styles.revealCheckboxLabel}>I've saved it somewhere safe</Text>
            </TouchableOpacity>

            {/* Done Action Button */}
            <TouchableOpacity
              style={styles.revealDoneBtn}
              onPress={() => {
                setShowRevealModal(false)
                setHasRevealedSecret(false)
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.revealDoneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const createStyles = (theme: ThemeTokens, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
    },
    pageTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    titleWithPolicyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    pageTitleText: {
      flex: 1,
    },
    pageTitle: {
      fontSize: typeScale.display,
      fontWeight: '700',
      letterSpacing: -0.4,
    },
    pageSubtitle: {
      fontSize: typeScale.body,
      lineHeight: 18,
      marginTop: 2,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingBottom: 14,
    },
    loadingText: {
      fontSize: typeScale.footnote,
    },
    card: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      borderRadius: 14,
      padding: 16,
      marginBottom: 14,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    cardHeading: {
      fontSize: 15,
      fontWeight: '500',
      letterSpacing: -0.2,
    },
    tag: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    tagText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 14,
      paddingVertical: 2,
      marginBottom: 6,
    },
    detailTitle: {
      fontSize: 13.5,
      fontWeight: '500',
    },
    detailDesc: {
      fontSize: 11.5,
      lineHeight: 16,
      marginTop: 2,
    },
    guardianRow: {
      marginTop: 10,
      marginBottom: 8,
      borderWidth: 0.5,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    guardianLabel: {
      fontSize: 11.5,
      fontWeight: '400',
      marginBottom: 3,
    },
    guardianValue: {
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 12.5,
      fontWeight: '500',
    },
    guardianNote: {
      fontSize: 11.5,
      lineHeight: 15,
      marginTop: 4,
    },
    guardianToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 6,
    },
    guardianToggleText: {
      fontSize: 12.5,
      fontWeight: '400',
      color: isDark ? '#8A8985' : '#6B6A64',
    },
    guardianEditor: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      borderRadius: 12,
      padding: 12,
      marginTop: 4,
      marginBottom: 4,
    },
    guardianInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 48,
    },
    guardianInput: {
      flex: 1,
      fontSize: 14,
      padding: 0,
      includeFontPadding: false,
    },
    guardianHint: {
      fontSize: typeScale.caption,
      lineHeight: 15,
      marginTop: 8,
      marginBottom: 12,
    },
    bodyText: {
      fontSize: typeScale.body,
      lineHeight: 19,
    },
    actionColumn: {
      gap: 0,
      marginTop: 4,
    },
    actionCaption: {
      fontSize: 11.5,
      textAlign: 'center',
      marginTop: 6,
    },
    disabledFinalizeBtn: {
      width: '100%',
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabledFinalizeText: {
      fontSize: 14,
      fontWeight: '600',
    },
    heroCountdownBanner: {
      borderWidth: 1,
      borderRadius: 14,
      padding: 16,
      marginBottom: 14,
    },
    bannerHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    bannerHeaderTitle: {
      fontSize: 14,
      fontWeight: '600',
    },
    heroCountdownText: {
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: -0.2,
      marginVertical: 3,
    },
    bannerSubtitle: {
      fontSize: 12.5,
      lineHeight: 18,
      marginTop: 2,
    },
    reassuranceBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
      marginBottom: 14,
    },
    reassuranceText: {
      flex: 1,
      fontSize: 12.5,
      lineHeight: 17,
    },
    footnote: {
      fontSize: typeScale.caption,
      lineHeight: 16,
      paddingHorizontal: 4,
    },
    updateGuardianBtn: {
      width: '100%',
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    updateGuardianBtnText: {
      fontSize: 14.5,
      fontWeight: '600',
    },
    testSimulationBox: {
      borderRadius: 12,
      borderWidth: 1,
      borderStyle: 'dashed',
      padding: 14,
      marginTop: 14,
    },
    testSimulationTitle: {
      fontSize: 14,
      fontWeight: '600',
    },
    testSimulationDesc: {
      fontSize: 12.5,
      lineHeight: 18,
      marginBottom: 12,
    },
    simulateBtn: {
      width: '100%',
      height: 46,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    simulateBtnText: {
      fontSize: 13.5,
      fontWeight: '600',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    confirmDialogCard: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: isDark ? '#141416' : '#FFFFFF',
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E5E7EB',
      borderRadius: 22,
      padding: 22,
      paddingHorizontal: 18,
      paddingBottom: 18,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.45,
      shadowRadius: 28,
      elevation: 16,
    },
    confirmDialogIconCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: 'rgba(229, 72, 77, 0.12)',
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
      marginBottom: 14,
    },
    confirmDialogTitle: {
      fontSize: 17,
      fontWeight: '600',
      lineHeight: 22,
      marginBottom: 6,
      textAlign: 'center',
      color: isDark ? '#F2F1EE' : '#111827',
    },
    confirmDialogSubtitle: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
      color: isDark ? '#8A8985' : '#6B7280',
      marginBottom: 16,
    },
    confirmAddressTable: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E5E7EB',
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 2,
      backgroundColor: isDark ? '#18181B' : '#F9FAFB',
      marginBottom: 14,
    },
    confirmAddressRowBorder: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      borderBottomWidth: 0.5,
      borderBottomColor: isDark ? '#201F1D' : '#E5E7EB',
    },
    confirmAddressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
    },
    confirmAddressLabel: {
      fontSize: 13,
      color: isDark ? '#8A8985' : '#6B7280',
    },
    confirmAddressValueMono: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      color: isDark ? '#8A8985' : '#6B7280',
    },
    confirmAddressNewValue: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      fontWeight: '600',
      color: isDark ? '#F2F1EE' : '#111827',
    },
    confirmConsequencesList: {
      flexDirection: 'column',
      gap: 11,
      marginBottom: 18,
    },
    confirmConsequenceRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
    },
    confirmConsequenceText: {
      flex: 1,
      fontSize: 12.5,
      lineHeight: 18,
      color: isDark ? '#B4B3AE' : '#4B5563',
    },
    confirmButtonsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    confirmCancelBtn: {
      flex: 1,
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#D1D5DB',
      backgroundColor: isDark ? '#18181A' : '#F3F4F6',
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmCancelText: {
      fontSize: 14,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#374151',
    },
    confirmActionBtn: {
      flex: 1.25,
      backgroundColor: '#DC3D55',
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmActionText: {
      fontSize: 14,
      fontWeight: '500',
      color: '#FFFFFF',
    },
    successSheetCard: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: isDark ? '#0C0C0D' : '#FFFFFF',
      borderRadius: 18,
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 18,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.6,
      shadowRadius: 36,
      elevation: 24,
    },
    successHandle: {
      width: 36,
      height: 4,
      backgroundColor: isDark ? '#3A3A37' : '#D8D5CE',
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20,
    },
    successHeader: {
      alignItems: 'center',
      marginBottom: 22,
    },
    successRing: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: 'rgba(95, 191, 122, 0.12)',
      borderWidth: 8,
      borderColor: 'rgba(95, 191, 122, 0.06)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 18,
    },
    successLabel: {
      fontSize: 12,
      color: isDark ? '#8A8985' : '#6B6A64',
      marginBottom: 6,
    },
    successHeroAddress: {
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 22,
      fontWeight: '600',
      letterSpacing: -0.2,
      color: isDark ? '#F2F1EE' : '#181714',
    },
    successPrevious: {
      fontSize: 12.5,
      color: isDark ? '#8A8985' : '#6B6A64',
      marginTop: 6,
    },
    successDetailBox: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 2,
      backgroundColor: isDark ? '#141416' : '#FAFAFA',
      marginBottom: 16,
    },
    successDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      borderBottomWidth: 0.5,
      borderBottomColor: isDark ? '#201F1D' : '#EEECE7',
    },
    successDetailRowLast: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
    },
    successDetailLabel: {
      fontSize: 13,
      color: isDark ? '#8A8985' : '#6B6A64',
    },
    successDetailValue: {
      fontSize: 13,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    successSigWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    successSigMono: {
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 12,
      color: isDark ? '#F2F1EE' : '#181714',
    },
    successDoneBtn: {
      backgroundColor: isDark ? '#6C8CFF' : theme.accent,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    successDoneText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#0C0C0D',
    },
    successExplorerBtn: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      borderRadius: 12,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    successExplorerText: {
      fontSize: 13,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    statusCircleDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      borderWidth: 1.5,
    },
    backupCard: {
      marginTop: 0,
    },
    backupCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 10,
    },
    backupIconRing: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: 'rgba(217, 154, 43, 0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    backupCardTitle: {
      fontSize: 15,
      fontWeight: '500',
    },
    backupCardDesc: {
      fontSize: 12.5,
      lineHeight: 19,
      marginBottom: 14,
    },
    backupActionBtn: {
      backgroundColor: '#6C8CFF',
      borderRadius: 12,
      paddingVertical: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    backupActionBtnText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: '#0C0C0D',
    },
    revealModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      justifyContent: 'flex-end',
      paddingHorizontal: 0,
    },
    revealModalCard: {
      backgroundColor: isDark ? '#0C0C0D' : '#FFFFFF',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingBottom: 28,
      paddingTop: 12,
      maxHeight: '92%',
      width: '100%',
      borderTopWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
    },
    revealHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: isDark ? '#3A3A37' : '#D1D5DB',
      alignSelf: 'center',
      marginBottom: 16,
    },
    revealModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    revealIconRing: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: 'rgba(217, 154, 43, 0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    revealModalTitle: {
      fontSize: 17,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#181714',
      marginBottom: 2,
    },
    revealModalSubtitle: {
      fontSize: 12,
      color: isDark ? '#8A8985' : '#6B6A64',
    },
    revealWarningBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 0.5,
      borderColor: isDark ? 'rgba(229, 72, 77, 0.35)' : 'rgba(220, 38, 38, 0.25)',
      backgroundColor: isDark ? 'rgba(229, 72, 77, 0.10)' : 'rgba(239, 68, 68, 0.08)',
      marginBottom: 16,
    },
    revealWarningText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      color: isDark ? '#EBA0A3' : '#991B1B',
      fontWeight: isDark ? '400' : '500',
    },
    revealSectionLabel: {
      fontSize: 11.5,
      color: isDark ? '#8A8985' : '#6B6A64',
      marginBottom: 6,
    },
    revealAddressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDark ? '#1A1A18' : '#F4F4F5',
      borderRadius: 12,
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#E6E4DE',
      paddingHorizontal: 12,
      paddingVertical: 11,
      marginBottom: 16,
    },
    revealAddressText: {
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 12,
      color: isDark ? '#F2F1EE' : '#181714',
      flex: 1,
      marginRight: 8,
    },
    revealSecretHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    revealCompatLabel: {
      fontSize: 11.5,
      color: isDark ? '#8A8985' : '#6B6A64',
      marginBottom: 6,
    },
    revealSecretDashedBox: {
      borderWidth: 0.5,
      borderColor: isDark ? '#3A3A37' : '#D1D5DB',
      borderStyle: 'dashed',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
      backgroundColor: isDark ? '#141416' : '#FAFAFA',
    },
    revealSecretDashedBoxRevealed: {
      borderStyle: 'solid',
      alignItems: 'flex-start',
    },
    revealTapRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    revealTapText: {
      fontSize: 13,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    revealSecretMonoText: {
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 12.5,
      lineHeight: 18,
      color: isDark ? '#F2F1EE' : '#181714',
      width: '100%',
    },
    revealCountdownText: {
      fontSize: 12,
      color: isDark ? '#8A8985' : '#6B6A64',
      marginBottom: 10,
    },
    revealSecondaryCopyBtn: {
      borderWidth: 0.5,
      borderColor: isDark ? '#2A2A28' : '#D1D5DB',
      borderRadius: 12,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    revealSecondaryCopyText: {
      fontSize: 13,
      fontWeight: '500',
      color: isDark ? '#F2F1EE' : '#181714',
    },
    revealClipboardNote: {
      fontSize: 12,
      lineHeight: 16,
      color: isDark ? '#8A8985' : '#6B6A64',
      textAlign: 'center',
      marginTop: 8,
    },
    revealCheckboxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginVertical: 16,
    },
    customCheckbox: {
      width: 18,
      height: 18,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: isDark ? '#3A3A37' : '#D1D5DB',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    customCheckboxChecked: {
      backgroundColor: '#6C8CFF',
      borderColor: '#6C8CFF',
    },
    revealCheckboxLabel: {
      fontSize: 13,
      color: isDark ? '#F2F1EE' : '#181714',
    },
    revealDoneBtn: {
      backgroundColor: '#6C8CFF',
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    revealDoneText: {
      fontSize: 13.5,
      fontWeight: '500',
      color: '#0C0C0D',
    },
  })
