import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Linking,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { AppQrCode } from '@/components/app-qr-code'
import { HaptixCountdown } from '@/components/haptix/haptix-countdown'
import { AppConfig } from '@/constants/app-config'
import {
  WalletState,
  createInitiateRecoveryInstruction,
  createExecuteRecoveryInstruction,
  fetchHaptixWallet,
} from '@/utils/haptix-client'
import {
  StagedRecoveryKeys,
  stageRecoveryKeys,
  commitStagedRecoveryKeys,
  loadStagedRecoveryKeys,
} from '@/utils/haptix-passkey'
import { createSmartWalletRecord, saveWallet, HaptixWalletAccount } from '@/utils/haptix-wallet-storage'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { ellipsify } from '@/utils/ellipsify'
import { describeTimelock } from '@/utils/recovery-timelock'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { radius, typeScale } from '@/theme/tokens'

interface HaptixRecoveryFlowSheetProps {
  visible: boolean
  initialTargetAddress?: string
  onClose: () => void
  onRecoveryComplete: (recoveredWallet: HaptixWalletAccount) => void
}

type GuardianSigningTab = 'devnet' | 'hardware'

export function HaptixRecoveryFlowSheet({
  visible,
  initialTargetAddress = '',
  onClose,
  onRecoveryComplete,
}: HaptixRecoveryFlowSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()
  const dialog = useHaptixDialog()

  const [walletInput, setWalletInput] = useState(initialTargetAddress)
  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isInspecting, setIsInspecting] = useState(false)
  const [stagedKeys, setStagedKeys] = useState<StagedRecoveryKeys | null>(null)
  const [signingTab, setSigningTab] = useState<GuardianSigningTab>('devnet')
  const [actionBusy, setActionBusy] = useState<null | 'initiate' | 'execute'>(null)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const [copiedPayload, setCopiedPayload] = useState(false)

  const connection = useMemo(() => new Connection(AppConfig.devnetRpcUrl, 'confirmed'), [])

  // Auto-fill initial address if given
  useEffect(() => {
    if (initialTargetAddress && visible) {
      setWalletInput(initialTargetAddress)
      void handleInspectWallet(initialTargetAddress)
    }
  }, [initialTargetAddress, visible])

  // Periodic polling when recovery is in flight
  useEffect(() => {
    if (!visible || !onChainWallet?.recoveryInitiatedAt) return
    const interval = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000))
      // Re-fetch on-chain state every 3s to detect when dispute window closes or veto occurs
      if (onChainWallet.pda) {
        fetchHaptixWallet(connection, onChainWallet.pda).then((updated) => {
          if (updated) setOnChainWallet(updated)
        }).catch(() => {})
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [visible, onChainWallet?.recoveryInitiatedAt, onChainWallet?.pda, connection])

  // Calculate dispute window progress
  const recoveryWindow = useMemo(() => {
    if (!onChainWallet || onChainWallet.recoveryInitiatedAt === 0n) return null
    const unlockAt = Number(onChainWallet.recoveryInitiatedAt) + Number(onChainWallet.recoveryTimelock)
    const secondsLeft = Math.max(0, unlockAt - nowSeconds)
    const totalDuration = Number(onChainWallet.recoveryTimelock)
    const elapsed = Math.max(0, totalDuration - secondsLeft)
    const progressPct = totalDuration > 0 ? Math.min(100, Math.round((elapsed / totalDuration) * 100)) : 100
    return { unlockAt, secondsLeft, isElapsed: secondsLeft === 0, progressPct }
  }, [onChainWallet, nowSeconds])

  // Inspect on-chain wallet
  const handleInspectWallet = async (addressToTest?: string) => {
    const raw = (addressToTest ?? walletInput).trim()
    if (!raw) {
      dialog.alert('Address Required', 'Please enter your Haptix smart wallet address.')
      return
    }

    let pda: PublicKey
    try {
      pda = new PublicKey(raw)
    } catch {
      dialog.alert('Invalid Address', 'The provided string is not a valid Solana public key.')
      return
    }

    setIsInspecting(true)
    try {
      const state = await fetchHaptixWallet(connection, pda)
      if (!state) {
        dialog.alert(
          'Wallet Not Found',
          'Could not find an initialized Haptix smart wallet at this address on Devnet.',
        )
        setOnChainWallet(null)
        return
      }

      setOnChainWallet(state)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Ensure replacement keys are staged for this device
      const existing = await loadStagedRecoveryKeys()
      if (existing) {
        setStagedKeys(existing)
      } else {
        const fresh = await stageRecoveryKeys()
        setStagedKeys(fresh)
      }
    } catch (err: any) {
      console.error('[Haptix Recovery Sheet] Inspect error:', err)
      dialog.alert('Inspection Error', describeChainError(err, 'Failed to read account data from Devnet.'))
    } finally {
      setIsInspecting(false)
    }
  }

  // Handle 1-Tap Devnet Guardian Initiate
  const handleInitiateDevnet = async () => {
    if (!onChainWallet || !stagedKeys) return
    setActionBusy('initiate')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      const payer = await getFundedDevnetPayer(connection)
      const walletPda = onChainWallet.pda

      // Verify the payer matches stored guardian
      if (!payer.publicKey.equals(onChainWallet.guardian)) {
        dialog.alert(
          'Guardian Key Mismatch',
          `This wallet's on-chain guardian is ${ellipsify(onChainWallet.guardian.toBase58(), 6)}. The dev funder is ${ellipsify(payer.publicKey.toBase58(), 6)}.\n\n` +
          'Please authorize the recovery from your custom guardian device (Mac / OneKey / Ledger) using the hardware tab.',
        )
        return
      }

      const initiateIx = createInitiateRecoveryInstruction({
        walletPda,
        guardian: payer.publicKey,
        newPrimaryPasskey: new Uint8Array(Buffer.from(stagedKeys.primaryPublicKeyHex, 'hex')),
        newSecondaryPasskey: new Uint8Array(Buffer.from(stagedKeys.secondaryPublicKeyHex, 'hex')),
      })

      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latestBlockhash.blockhash }).add(
        initiateIx,
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      const updated = await fetchHaptixWallet(connection, walletPda)
      if (updated) setOnChainWallet(updated)

      dialog.alert(
        'Recovery Initiated On-Chain',
        `The lost phone is now frozen for ${describeTimelock(onChainWallet.recoveryTimelock)}. Once the dispute timelock passes, you can finalize recovery on this new device.\n\nTx: ${ellipsify(sig, 8)}`,
      )
    } catch (err: any) {
      console.error('[Haptix Recovery Sheet] Initiate error:', formatChainErrorForLog(err))
      dialog.alert('Initiate Failed', describeChainError(err, 'Could not initiate recovery on-chain.'))
    } finally {
      setActionBusy(null)
    }
  }

  // Handle Execute Recovery once timelock passes
  const handleExecuteRecovery = async () => {
    if (!onChainWallet) return
    setActionBusy('execute')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

    try {
      const payer = await getFundedDevnetPayer(connection)
      const walletPda = onChainWallet.pda

      const executeIx = createExecuteRecoveryInstruction({ walletPda })
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latestBlockhash.blockhash }).add(
        executeIx,
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })

      // Promote the staged keys into this device's active passkey store
      const committed = await commitStagedRecoveryKeys()
      if (!committed) {
        throw new Error('Could not commit recovered keys into local secure store.')
      }

      // Reconstruct and save smart wallet record
      const restored = await createSmartWalletRecord({
        name: 'Recovered Haptix Wallet',
        primaryPasskeyHex: committed.primaryPublicKeyHex,
        secondaryPasskeyHex: committed.secondaryPublicKeyHex,
        primaryLabel: 'Primary passkey (Recovered)',
        secondaryLabel: 'Vault Quorum (Recovered)',
        spendThreshold: Number(onChainWallet.spendThresholdLamports) / LAMPORTS_PER_SOL,
        network: 'devnet',
      })
      restored.address = walletPda.toBase58()
      restored.isInitializedOnChain = true

      await saveWallet(restored)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      dialog.alert(
        'Wallet Recovered Successfully',
        `Your smart wallet keys have been rotated on-chain. Your address (${ellipsify(restored.address, 4)}) and SOL balance are 100% preserved.\n\nTx: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'Open Wallet',
            onPress: () => {
              onRecoveryComplete(restored)
            },
          },
        ],
      )
    } catch (err: any) {
      console.error('[Haptix Recovery Sheet] Execute error:', formatChainErrorForLog(err))
      dialog.alert('Execution Failed', describeChainError(err, 'Could not finalize recovery on-chain.'))
    } finally {
      setActionBusy(null)
    }
  }

  // Format CLI / Mac payload for hardware guardian
  const hardwareCliCommand = useMemo(() => {
    if (!onChainWallet || !stagedKeys) return ''
    return `npm run guardian -- initiate ${onChainWallet.pda.toBase58()}`
  }, [onChainWallet, stagedKeys])

  const handleCopyCliCommand = () => {
    if (!hardwareCliCommand) return
    Clipboard.setString(hardwareCliCommand)
    setCopiedPayload(true)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setTimeout(() => setCopiedPayload(false), 2500)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheetCard, { backgroundColor: theme.bgCard, paddingBottom: Math.max(insets.bottom, 24) }]}>
          
          {/* HEADER */}
          <View style={styles.sheetHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[styles.headerIconWrap, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
                <MaterialIcons name="security" size={20} color="#6366F1" />
              </View>
              <View>
                <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>Recover Lost Wallet</Text>
                <Text style={[styles.sheetSubtitle, { color: theme.textSecondary }]}>Guardian On-Chain Rescue</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={24} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>

            {/* STEP 1: TARGET WALLET INPUT */}
            <View style={styles.sectionBlock}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>1. Lost Wallet Address (PDA)</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.bgElevated,
                      borderColor: theme.borderDefault,
                      color: theme.textPrimary,
                    },
                  ]}
                  value={walletInput}
                  onChangeText={setWalletInput}
                  placeholder="Paste Solana smart wallet address"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.inspectButton, { backgroundColor: theme.textPrimary }]}
                  onPress={() => void handleInspectWallet()}
                  disabled={isInspecting}
                  activeOpacity={0.8}
                >
                  {isInspecting ? (
                    <ActivityIndicator size="small" color={theme.bgApp} />
                  ) : (
                    <Text style={[styles.inspectButtonText, { color: theme.bgApp }]}>Inspect</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Quick Test Wallet Buttons */}
              <View style={styles.quickTestRow}>
                <TouchableOpacity
                  style={[styles.quickChip, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                    setWalletInput('GQyNg1h6tqn1PNjYxYyeyAQ4qYZ7kqQrJBrWyp99J9Lj')
                    void handleInspectWallet('GQyNg1h6tqn1PNjYxYyeyAQ4qYZ7kqQrJBrWyp99J9Lj')
                  }}
                >
                  <Text style={[styles.quickChipText, { color: theme.textSecondary }]}>Load Test (GQyNg...)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickChip, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                    setWalletInput('HziZimWjrC3TZCSPA8EzqJCCnsk7hUxu8QVpxCjs3kNb')
                    void handleInspectWallet('HziZimWjrC3TZCSPA8EzqJCCnsk7hUxu8QVpxCjs3kNb')
                  }}
                >
                  <Text style={[styles.quickChipText, { color: theme.textSecondary }]}>Load Test (HziZi...)</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* STEP 2: ON-CHAIN STATUS DIAGNOSTIC */}
            {onChainWallet && (
              <View style={[styles.diagnosticCard, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: theme.textMuted }]}>Smart Wallet</Text>
                  <Text style={[styles.diagValue, styles.mono, { color: theme.textPrimary }]}>
                    {ellipsify(onChainWallet.pda.toBase58(), 6)}
                  </Text>
                </View>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: theme.textMuted }]}>Balance</Text>
                  <Text style={[styles.diagValue, { color: theme.emerald }]}>
                    {(onChainWallet.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </Text>
                </View>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: theme.textMuted }]}>Guardian</Text>
                  <Text style={[styles.diagValue, styles.mono, { color: theme.textPrimary }]}>
                    {ellipsify(onChainWallet.guardian.toBase58(), 6)}
                  </Text>
                </View>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: theme.textMuted }]}>Dispute Timelock</Text>
                  <Text style={[styles.diagValue, { color: theme.textPrimary }]}>
                    {describeTimelock(onChainWallet.recoveryTimelock)}
                  </Text>
                </View>
                <View style={[styles.diagnosticRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                  <Text style={[styles.diagLabel, { color: theme.textMuted }]}>Status</Text>
                  <Text
                    style={[
                      styles.diagValue,
                      {
                        color:
                          recoveryWindow?.isElapsed
                            ? theme.emerald
                            : onChainWallet.recoveryInitiatedAt > 0n
                              ? theme.amber
                              : theme.emerald,
                      },
                    ]}
                  >
                    {recoveryWindow?.isElapsed
                      ? 'Ready to Finalize'
                      : onChainWallet.recoveryInitiatedAt > 0n
                        ? 'Recovery In Flight (Frozen)'
                        : 'Active · Normal'}
                  </Text>
                </View>
              </View>
            )}

            {/* STEP 3: DISPUTE COUNTDOWN (IF RECOVERY IN FLIGHT) */}
            {recoveryWindow && !recoveryWindow.isElapsed && (
              <View style={[styles.countdownBlock, { backgroundColor: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.25)' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <MaterialIcons name="lock-clock" size={18} color={theme.amber} />
                  <Text style={[styles.countdownTitle, { color: theme.amber }]}>
                    DISPUTE WINDOW IN PROGRESS
                  </Text>
                </View>
                <Text style={[styles.countdownClock, { color: theme.amber }]}>
                  <HaptixCountdown until={recoveryWindow.unlockAt} />
                </Text>
                
                {/* Visual Progress Bar */}
                <View style={[styles.progressBarWrap, { backgroundColor: theme.bgCard }]}>
                  <View style={[styles.progressBarFill, { width: `${recoveryWindow.progressPct}%` }]} />
                </View>

                <Text style={[styles.countdownDesc, { color: theme.textSecondary }]}>
                  The lost phone is frozen on-chain and cannot send funds. Once this dispute timer reaches zero, you can finalize key rotation below.
                </Text>
              </View>
            )}

            {/* STEP 4: GUARDIAN AUTHORIZATION (IF NOT IN FLIGHT) */}
            {onChainWallet && onChainWallet.recoveryInitiatedAt === 0n && (
              <View style={styles.sectionBlock}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>2. Authorize Recovery as Guardian</Text>
                
                {/* Method Tabs */}
                <View style={[styles.tabBar, { backgroundColor: theme.bgElevated }]}>
                  <TouchableOpacity
                    style={[styles.tabBtn, signingTab === 'devnet' && { backgroundColor: theme.bgCard }]}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      setSigningTab('devnet')
                    }}
                  >
                    <MaterialIcons
                      name="bolt"
                      size={15}
                      color={signingTab === 'devnet' ? theme.textPrimary : theme.textMuted}
                    />
                    <Text style={[styles.tabBtnText, { color: signingTab === 'devnet' ? theme.textPrimary : theme.textMuted }]}>
                      Devnet Quick (1-Tap)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.tabBtn, signingTab === 'hardware' && { backgroundColor: theme.bgCard }]}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      setSigningTab('hardware')
                    }}
                  >
                    <MaterialIcons
                      name="vpn-key"
                      size={15}
                      color={signingTab === 'hardware' ? theme.textPrimary : theme.textMuted}
                    />
                    <Text style={[styles.tabBtnText, { color: signingTab === 'hardware' ? theme.textPrimary : theme.textMuted }]}>
                      Mac / Hardware (OneKey)
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Tab 1: 1-Tap Devnet Guardian */}
                {signingTab === 'devnet' && (
                  <View style={[styles.tabContent, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
                    <Text style={[styles.tabDesc, { color: theme.textSecondary }]}>
                      The Devnet Guardian signs initiate_recovery directly. The smart contract freezes your lost phone and stages your new phone's biometric passkeys.
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { backgroundColor: theme.textPrimary }, actionBusy && { opacity: 0.7 }]}
                      onPress={handleInitiateDevnet}
                      disabled={actionBusy !== null}
                      activeOpacity={0.85}
                    >
                      {actionBusy === 'initiate' ? (
                        <ActivityIndicator color={theme.bgApp} />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <MaterialIcons name="flash-on" size={18} color={theme.bgApp} />
                          <Text style={[styles.primaryActionBtnText, { color: theme.bgApp }]}>
                            Authorize as Guardian (1-Tap)
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Tab 2: Hardware Wallet / Mac Signing Ceremony */}
                {signingTab === 'hardware' && (
                  <View style={[styles.tabContent, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
                    <Text style={[styles.tabDesc, { color: theme.textSecondary }]}>
                      Run this command on your Mac (or with OneKey/Ledger connected) to sign initiate_recovery. This phone is actively listening for the transaction:
                    </Text>

                    {/* QR Code for Cross-Device Scan */}
                    <View style={{ alignItems: 'center', marginVertical: 12 }}>
                      <View style={{ padding: 10, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
                        <AppQrCode value={hardwareCliCommand || 'HaptixGuardian'} size={140} showTapHint={false} />
                      </View>
                      <Text style={[styles.qrHint, { color: theme.textMuted }]}>
                        Scan from laptop or copy command below
                      </Text>
                    </View>

                    {/* Copyable CLI Snippet */}
                    <TouchableOpacity
                      style={[styles.codeBox, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}
                      onPress={handleCopyCliCommand}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.codeText, { color: theme.textPrimary }]} numberOfLines={2}>
                        {hardwareCliCommand}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                        <MaterialIcons
                          name={copiedPayload ? 'check' : 'content-copy'}
                          size={14}
                          color={copiedPayload ? theme.emerald : theme.accent}
                        />
                        <Text
                          style={[
                            styles.copyHint,
                            { color: copiedPayload ? theme.emerald : theme.accent },
                          ]}
                        >
                          {copiedPayload ? 'Copied to clipboard' : 'Tap to copy CLI command'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* STEP 5: FINALIZE & UNLOCK (READY TO EXECUTE) */}
            {recoveryWindow?.isElapsed && (
              <View style={[styles.finalizeCard, { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' }]}>
                <View style={{ alignItems: 'center', marginBottom: 12 }}>
                  <View style={styles.emeraldIconWrap}>
                    <MaterialIcons name="check" size={24} color="#10B981" />
                  </View>
                  <Text style={[styles.finalizeTitle, { color: theme.emerald }]}>
                    Dispute Window Passed · Ready to Unlock
                  </Text>
                  <Text style={[styles.finalizeDesc, { color: theme.textSecondary }]}>
                    Click Finalize to install this device's biometric passkeys on-chain and restore full access to your funds.
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.primaryActionBtn, { backgroundColor: theme.emerald }, actionBusy && { opacity: 0.7 }]}
                  onPress={handleExecuteRecovery}
                  disabled={actionBusy !== null}
                  activeOpacity={0.85}
                >
                  {actionBusy === 'execute' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="lock-open" size={20} color="#FFFFFF" />
                      <Text style={[styles.primaryActionBtnText, { color: '#FFFFFF' }]}>
                        Finalize Recovery &amp; Unlock Wallet
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            )}

          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  sectionBlock: {
    marginTop: 12,
  },
  inputLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13.5,
    fontFamily: 'monospace',
  },
  inspectButton: {
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  quickTestRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '500',
  },
  diagnosticCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
  },
  diagnosticRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  diagLabel: {
    fontSize: 12,
  },
  diagValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  mono: {
    fontFamily: 'monospace',
  },
  countdownBlock: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 14,
    alignItems: 'center',
  },
  countdownTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  countdownClock: {
    fontSize: 32,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginVertical: 4,
  },
  progressBarWrap: {
    width: '100%',
    height: 6,
    borderRadius: 99,
    overflow: 'hidden',
    marginVertical: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
  },
  countdownDesc: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginVertical: 8,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tabContent: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 4,
  },
  tabDesc: {
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 12,
  },
  primaryActionBtn: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  codeBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  codeText: {
    fontSize: 11.5,
    fontFamily: 'monospace',
  },
  copyHint: {
    fontSize: 11,
    fontWeight: '600',
  },
  qrHint: {
    fontSize: 11,
    marginTop: 6,
  },
  finalizeCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginTop: 14,
  },
  emeraldIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  finalizeTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  finalizeDesc: {
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 12,
  },
})
