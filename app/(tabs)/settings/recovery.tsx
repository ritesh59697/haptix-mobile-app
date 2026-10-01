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
import Clipboard from '@/utils/clipboard'

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
  const [guardianBusy, setGuardianBusy] = useState(false)
  const [showPolicySheet, setShowPolicySheet] = useState(false)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

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
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latestBlockhash.blockhash }).add(
        precompilePrimary,
        precompileSecondary,
        cancelIx,
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })

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
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latestBlockhash.blockhash }).add(
        precompilePrimary,
        precompileSecondary,
        setGuardianIx,
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })

      // The record carries the guardian so a wallet that is re-initialized from this
      // device is created with the one just installed, rather than the old default.
      await updateWallet({ ...activeWallet, guardianAddress: parsed.address })
      setGuardianDraft('')
      setShowGuardianEditor(false)
      await refreshOnChain()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      dialog.alert(
        'Guardian Updated',
        `Verified with both passkeys and set the guardian to ${ellipsify(parsed.address, 6)}.\n\n` +
          `That address can now start a recovery and nothing else. It cannot move funds, and this device ` +
          `no longer can \u2014 the button above will go dead unless the new guardian key is held here.\n\nTx: ${ellipsify(
            sig,
            8,
          )}`,
      )
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

  const handleSetGuardian = () => {
    const parsed = guardianDraftParse
    if (!parsed.address || !onChainWallet) {
      dialog.alert('Check the guardian address', parsed.error ?? 'Enter the address that should guard this wallet.')
      return
    }
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
  const renderGuardianCard = (isLocked: boolean) => (
    <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Guardian</Text>
        <View
          style={[
            styles.tag,
            { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
          ]}
        >
          <MaterialIcons
            name={isGuardianConfigured ? 'check' : 'shield'}
            size={14}
            color={isGuardianConfigured ? theme.emeraldText : theme.textMuted}
          />
          <Text
            style={[
              styles.tagText,
              { color: isGuardianConfigured ? theme.emeraldText : theme.textMuted, fontWeight: '400' },
            ]}
          >
            {isGuardianConfigured ? 'Active' : 'Not configured'}
          </Text>
        </View>
      </View>

      <View style={styles.detailRow}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[styles.detailTitle, { color: theme.textPrimary }]}>
            {isGuardianConfigured ? '1 guardian' : '0 guardians'}
          </Text>
          <Text style={[styles.detailDesc, { color: theme.textMuted }]}>
            {isGuardianConfigured
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

      <View style={[styles.guardianRow, { backgroundColor: theme.bgInput, borderColor: theme.borderDefault }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.guardianLabel, { color: theme.textMuted }]}>Guardian address</Text>
            <Text
              style={[
                styles.guardianValue,
                { color: isGuardianConfigured ? theme.textPrimary : theme.textMuted },
              ]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {isGuardianConfigured && onChainWallet
                ? ellipsify(onChainWallet.guardian.toBase58(), 6)
                : 'None (tap below to configure)'}
            </Text>
          </View>
          {isGuardianConfigured && onChainWallet ? (
            <TouchableOpacity
              onPress={() => {
                Clipboard.setString(onChainWallet.guardian.toBase58())
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ justifyContent: 'center', paddingLeft: 8 }}
            >
              <MaterialIcons name="content-copy" size={16} color={theme.textMuted} />
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
      ) : onChainWallet ? (
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
              {showGuardianEditor ? 'Cancel' : (isGuardianConfigured ? 'Change guardian' : 'Set recovery guardian')}
            </Text>
            <MaterialIcons
              name={showGuardianEditor ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
              size={18}
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
                {guardianDraft.trim().length === 0
                  ? 'A pasted link or message is read the same way a bare address is. Requires both passkeys.'
                  : (guardianDraftParse.error ??
                    `Guardian will become ${ellipsify(guardianDraftParse.address ?? '', 6)}.`)}
              </Text>

              <TouchableOpacity
                style={[
                  styles.updateGuardianBtn,
                  guardianDraftParse.address
                    ? { backgroundColor: '#5E81FF' }
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
                    Update guardian
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : null}
    </View>
  )

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

            {/* 2. Recovery Flow Card (Promoted to Top during emergency) */}
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
      borderWidth: 1,
      borderRadius: radius.lg,
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
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
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
      alignItems: 'center',
      paddingVertical: 4,
    },
    detailTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    detailDesc: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    guardianRow: {
      marginTop: 14,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    guardianLabel: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginBottom: 3,
    },
    guardianValue: {
      fontSize: typeScale.body,
      fontWeight: '600',
    },
    guardianNote: {
      fontSize: typeScale.caption,
      lineHeight: 15,
      marginTop: 4,
    },
    guardianToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    guardianToggleText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    guardianEditor: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 4,
    },
    guardianInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    guardianInput: {
      flex: 1,
      fontSize: typeScale.caption,
      padding: 0,
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
  })
