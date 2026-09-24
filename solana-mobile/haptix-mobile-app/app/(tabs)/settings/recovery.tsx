import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
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

import { useAuth } from '@/components/auth/auth-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { HaptixAlert } from '@/components/haptix/haptix-alert'
import { DepthOutlineButton, HoldToConfirmButton, PrismDepthButton } from '@/components/ui'
import { useGuardianSigner } from '@/hooks/use-guardian-signer'
import { ellipsify } from '@/utils/ellipsify'
import { parseRecipientInput } from '@/utils/solana-address'
import { describeTimelock, formatRemainingTime } from '@/utils/recovery-timelock'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
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
  const { theme } = useAppTheme()
  const { activeWallet, updateWallet } = useAuth()
  const { connection, getExplorerUrl } = useCluster()

  const styles = useMemo(() => createStyles(theme), [theme])

  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [recoveryBusy, setRecoveryBusy] = useState<null | 'initiate' | 'cancel' | 'execute'>(null)
  const [stagedRecovery, setStagedRecovery] = useState<StagedRecoveryKeys | null>(null)
  const [guardianDraft, setGuardianDraft] = useState('')
  const [showGuardianEditor, setShowGuardianEditor] = useState(false)
  const [guardianBusy, setGuardianBusy] = useState(false)
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

  const guardianAddress = onChainWallet?.guardian.toBase58() ?? null
  const guardianSigner = useGuardianSigner(connection, guardianAddress)

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
      const message = getCancelRecoverySignedMessage()

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
      const message = getSetGuardianSignedMessage(newGuardian)

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
    dialog.alert(
      'Change The Guardian?',
      `Recovery would be started by ${ellipsify(parsed.address, 6)} instead of ${ellipsify(
        onChainWallet.guardian.toBase58(),
        6,
      )}.\n\n` +
        'This needs both passkeys, because handing recovery to an address you do not control is the same as giving ' +
        'your wallet away. It cannot be undone without both passkeys either.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change Guardian', style: 'destructive', onPress: () => void runSetGuardian() },
      ],
      { status: 'warning' },
    )
  }

  // Same inset maths as the settings header, so the two screens' headers sit at the same
  // height when you move between them.
  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

  const timelockLabel = onChainWallet ? describeTimelock(onChainWallet.recoveryTimelock) : '24h'

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
            <Text style={[styles.pageTitle, { color: theme.textPrimary }]}>Recovery</Text>
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

        {/* An in-flight recovery is the one thing on this screen that is time-critical, so
            it sits above the configuration it would otherwise be buried under. */}
        {recoveryWindow ? (
          <HaptixAlert
            status="warning"
            icon="lock-clock"
            title={
              recoveryWindow.secondsLeft > 0
                ? `Recovery in flight · ${formatRemainingTime(recoveryWindow.secondsLeft)} left`
                : 'Recovery in flight · timelock elapsed'
            }
            message={
              recoveryWindow.secondsLeft > 0
                ? 'The wallet is frozen. Veto with both passkeys, or wait out the window and execute.'
                : 'Executing installs the proposed keys and unfreezes the wallet.'
            }
          />
        ) : null}

        {/* 1. Guardian */}
        <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Guardian</Text>
            <View
              style={[
                styles.tag,
                onChainWallet
                  ? { backgroundColor: theme.emeraldBg, borderColor: theme.emeraldBorder }
                  : { backgroundColor: theme.amberBg, borderColor: theme.amberBorder },
              ]}
            >
              <Text style={[styles.tagText, { color: onChainWallet ? theme.emeraldText : theme.amberText }]}>
                {onChainWallet ? 'Active' : 'Not on-chain yet'}
              </Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.detailTitle, { color: theme.textPrimary }]}>1 Guardian</Text>
              <Text style={[styles.detailDesc, { color: theme.textMuted }]}>Cannot spend funds</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={[styles.detailTitle, { color: theme.textPrimary }]}>{timelockLabel} Timelock</Text>
              <Text style={[styles.detailDesc, { color: theme.textMuted }]}>Both passkeys can cancel it</Text>
            </View>
          </View>

          {/* The program stores exactly one guardian and gives it no spending authority,
              so show who it actually is rather than a capability badge. */}
          <View style={[styles.guardianRow, { backgroundColor: theme.bgInput, borderColor: theme.borderDefault }]}>
            <Text style={[styles.guardianLabel, { color: theme.textMuted }]}>GUARDIAN</Text>
            <Text style={[styles.guardianValue, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="middle">
              {onChainWallet ? ellipsify(onChainWallet.guardian.toBase58(), 6) : 'Set on first on-chain activation'}
            </Text>
            <Text style={[styles.guardianNote, { color: theme.textMuted }]}>
              Can start a recovery and nothing else — it cannot move funds.
            </Text>
          </View>

          {onChainWallet ? (
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
                  {showGuardianEditor ? 'Cancel guardian change' : 'Change guardian'}
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
                      style={[styles.guardianInput, { color: theme.textPrimary }]}
                      value={guardianDraft}
                      onChangeText={setGuardianDraft}
                      placeholder="Paste the new guardian's Solana address"
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!guardianBusy}
                    />
                    {guardianDraft.length > 0 && (
                      <TouchableOpacity
                        onPress={() => setGuardianDraft('')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Clear guardian address"
                      >
                        <MaterialIcons name="cancel" size={18} color={theme.textMuted} />
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
                      ? 'A link or a message containing an address is read the same way a bare address is. Needs both passkeys.'
                      : (guardianDraftParse.error ??
                        `Guardian will become ${ellipsify(guardianDraftParse.address ?? '', 6)}.`)}
                  </Text>

                  <DepthOutlineButton
                    title={guardianBusy ? 'Changing…' : 'Update Guardian'}
                    size="compact"
                    disabled={guardianBusy || !guardianDraftParse.address}
                    onPress={handleSetGuardian}
                  />
                </View>
              )}
            </>
          ) : null}
        </View>

        {/* 2. The recovery itself. Without this the program could rotate keys all day and
            no owner would ever be able to ask it to. */}
        <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardHeading, { color: theme.textPrimary }]}>Recovery</Text>
          </View>

          <Text style={[styles.bodyText, { color: theme.textSecondary }]}>
            {!onChainWallet
              ? 'The guardian is recorded when the account is first created on-chain, so there is nothing to recover yet.'
              : recoveryWindow
                ? 'A recovery is in flight. Veto it with both passkeys to keep your current keys, or execute it once the timelock has passed.'
                : guardianSigner
                  ? 'This build holds the guardian key, so it can start and veto a recovery — that is what makes the flow testable end to end.'
                  : 'Recovery is started by the guardian from their own device. This build cannot sign as it.'}
          </Text>

          {recoveryWindow ? (
            <View style={styles.actionColumn}>
              {/* The owner's own answer, and the only one that leaves the wallet where it
                  is. It leads because the alternative is a one-way door: executing installs
                  keys this device may not hold, and nothing here can undo it. */}
              <PrismDepthButton
                title={recoveryBusy === 'cancel' ? 'Keeping your keys…' : 'Keep My Keys'}
                size="compact"
                disabled={recoveryBusy !== null}
                onPress={() => void runCancelRecovery()}
              />

              {/* Executing is permissionless and irreversible, so once the window closes it
                  is a hold rather than a tap. Inside the window the row carries only the
                  deadline, disabled — and the disabled styling is what keeps an inert
                  control from rendering like a live one. */}
              {recoveryWindow.secondsLeft > 0 ? (
                <DepthOutlineButton
                  title={`Execute unlocks in ${formatRemainingTime(recoveryWindow.secondsLeft)}`}
                  size="compact"
                  disabled
                />
              ) : (
                <HoldToConfirmButton
                  variant="danger"
                  label={recoveryBusy === 'execute' ? 'Executing…' : 'Hold to Execute Recovery'}
                  confirmingLabel="Keep holding…"
                  completedLabel="Executing…"
                  holdDurationMs={1200}
                  onConfirm={() => {
                    if (recoveryBusy === null) handleExecuteRecovery()
                  }}
                />
              )}
            </View>
          ) : onChainWallet && guardianSigner ? (
            <View style={styles.actionColumn}>
              <DepthOutlineButton
                title={recoveryBusy === 'initiate' ? 'Starting…' : 'Start Recovery (Guardian)'}
                size="compact"
                disabled={recoveryBusy !== null}
                onPress={handleStartRecovery}
              />
            </View>
          ) : null}
        </View>

        <Text style={[styles.footnote, { color: theme.textMuted }]}>
          A recovery never moves the wallet: the address stays the same, so anything sent to it during the window is
          still yours afterwards.
        </Text>
      </ScrollView>
    </View>
  )
}

const createStyles = (theme: ThemeTokens) =>
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
      // Stacked, not side by side: both buttons are full width with clipped labels, so
      // sharing a row made the pair wider than the box it sits in and "Execute Recovery"
      // hung over the border. Full-width rows also survive a large system font.
      gap: 10,
      marginTop: 14,
    },
    footnote: {
      fontSize: typeScale.caption,
      lineHeight: 16,
      paddingHorizontal: 4,
    },
  })
