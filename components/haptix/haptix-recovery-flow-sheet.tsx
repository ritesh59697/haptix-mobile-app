import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Pressable,
  Share,
  Linking,
  NativeModules,
  Animated,
  PanResponder,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Buffer } from 'buffer'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { AppQrCode } from '@/components/app-qr-code'
import { HaptixCountdown } from '@/components/haptix/haptix-countdown'
import { HaptixIosTabs, IosTabItem } from '@/components/haptix/haptix-ios-tabs'
import { SpinLoader } from '@/components/ui/spin-loader'
import { AppConfig } from '@/constants/app-config'
import {
  WalletState,
  createInitiateRecoveryInstruction,
  createExecuteRecoveryInstruction,
  createCancelRecoveryInstruction,
  getCancelRecoverySignedMessage,
  fetchHaptixWallet,
} from '@/utils/haptix-client'
import {
  StagedRecoveryKeys,
  stageRecoveryKeys,
  commitStagedRecoveryKeys,
  loadStagedRecoveryKeys,
  signWithPasskey,
  discardStagedRecoveryKeys,
  applyWalletCredentials,
  bindHardwarePasskey,
  bindSoftwarePasskey,
  matchLocalSoftwareKey,
  getDiscoverablePlatformAssertion,
} from '@/utils/haptix-passkey'
import { matchWebAuthnAssertion, createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import { createSmartWalletRecord, saveWallet, loadWallets, HaptixWalletAccount } from '@/utils/haptix-wallet-storage'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { ellipsify } from '@/utils/ellipsify'
import { describeTimelock } from '@/utils/recovery-timelock'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'

interface HaptixRecoveryFlowSheetProps {
  visible: boolean
  initialTargetAddress?: string
  onClose: () => void
  onRecoveryComplete: (recoveredWallet: HaptixWalletAccount) => void
}

type GuardianSigningTab = 'devnet' | 'web'

const GUARDIAN_TABS: IosTabItem<GuardianSigningTab>[] = [
  { id: 'devnet', label: 'In-app devnet (1-tap)' },
  { id: 'web', label: 'Guardian web portal and link' },
]

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
  const [actionBusy, setActionBusy] = useState<null | 'initiate' | 'execute' | 'cancel'>(null)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const [copiedPayload, setCopiedPayload] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [showAdvancedCli, setShowAdvancedCli] = useState(false)
  const [showDemoWallets, setShowDemoWallets] = useState(false)
  const [isEditingTarget, setIsEditingTarget] = useState(false)
  const [showFreezeConfirmModal, setShowFreezeConfirmModal] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Fluid pull-down gesture to dismiss bottom sheet
  const panY = useRef(new Animated.Value(0)).current

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return gestureState.dy > 4
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            panY.setValue(gestureState.dy)
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.8) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
            Animated.timing(panY, {
              toValue: 600,
              duration: 220,
              useNativeDriver: true,
            }).start(() => {
              panY.setValue(0)
              onClose()
            })
          } else {
            Animated.spring(panY, {
              toValue: 0,
              bounciness: 4,
              useNativeDriver: true,
            }).start()
          }
        },
      }),
    [onClose, panY],
  )

  useEffect(() => {
    if (!visible) {
      panY.setValue(0)
    }
  }, [visible, panY])

  const connection = useMemo(() => new Connection(AppConfig.devnetRpcUrl, 'confirmed'), [])

  // Auto-fill initial address if explicitly provided
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

  // Explicit user paste action (reads clipboard only on explicit click)
  const handlePasteAddress = async () => {
    try {
      const text = await Clipboard.getString()
      if (text && text.trim()) {
        setWalletInput(text.trim())
        await Haptics.selectionAsync()
      } else {
        dialog.alert('Clipboard Empty', 'No text found on clipboard.')
      }
    } catch {
      dialog.alert('Clipboard Error', 'Could not read from clipboard.')
    }
  }

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
      setIsEditingTarget(false)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Automatically apply credentials if this device already holds this wallet
      const wallets = await loadWallets().catch(() => [])
      const matched = wallets.find((w) => w.address === state.pda.toBase58())
      if (matched) {
        await applyWalletCredentials(matched).catch(() => {})
      } else {
        const onChainKeys = {
          primary: new Uint8Array(state.primaryPasskey),
          secondary: new Uint8Array(state.secondaryPasskey),
        }
        const softwareRole = await matchLocalSoftwareKey(onChainKeys).catch(() => null)
        if (softwareRole === 'primary') {
          await bindSoftwarePasskey('primary', Buffer.from(state.primaryPasskey).toString('hex')).catch(() => {})
        } else if (softwareRole === 'secondary') {
          await bindSoftwarePasskey('secondary', Buffer.from(state.secondaryPasskey).toString('hex')).catch(() => {})
        }
      }

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

  // Handle Guardian Initiate with dedicated mockup confirmation
  const handleInitiateDevnet = async () => {
    if (!onChainWallet || !stagedKeys) return
    setShowFreezeConfirmModal(true)
  }

  const runInitiateDevnet = async () => {
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

  // Handle Veto / Cancel Recovery on-chain with robust credential resolution
  const handleCancelRecovery = async () => {
    if (!onChainWallet) return

    dialog.alert(
      'Veto Recovery & Unfreeze Wallet?',
      'If you have access to your hardware passkeys, you can veto this recovery on-chain right now.\n\n' +
      '• The guardian’s proposed keys will be discarded.\n' +
      '• The freeze will be lifted immediately.\n' +
      '• Your wallet returns to normal active status.\n\n' +
      'Both of your hardware passkeys will be requested to verify your identity as the owner.',
      [
        { text: 'Keep Frozen', style: 'cancel' },
        {
          text: 'Veto & Unfreeze',
          style: 'destructive',
          onPress: () => void runCancelRecovery(),
        },
      ],
      { status: 'warning' },
    )
  }

  const runCancelRecovery = async () => {
    if (!onChainWallet) return
    setActionBusy('cancel')
    try {
      const walletPda = onChainWallet.pda
      const fresh = (await fetchHaptixWallet(connection, walletPda).catch(() => null)) ?? onChainWallet
      const message = getCancelRecoverySignedMessage(walletPda, fresh.authNonce)

      // 1. Ensure local saved credentials for this wallet are bound
      const wallets = await loadWallets().catch(() => [])
      const matched = wallets.find((w) => w.address === walletPda.toBase58())
      if (matched) {
        await applyWalletCredentials(matched).catch(() => {})
      }

      const onChainPrimaryHex = Buffer.from(onChainWallet.primaryPasskey).toString('hex')
      const onChainSecondaryHex = Buffer.from(onChainWallet.secondaryPasskey).toString('hex')
      const onChainKeys = {
        primary: new Uint8Array(onChainWallet.primaryPasskey),
        secondary: new Uint8Array(onChainWallet.secondaryPasskey),
      }

      // 2. Verify or resolve Primary passkey
      let currentPrimary = await AsyncStorage.getItem('@haptix_passkey_pubkey_primary')
      if (!currentPrimary || currentPrimary !== onChainPrimaryHex) {
        // Check if this device holds a local software scalar in SecureStore
        const softwareRole = await matchLocalSoftwareKey(onChainKeys).catch(() => null)
        if (softwareRole === 'primary') {
          await bindSoftwarePasskey('primary', onChainPrimaryHex)
        } else if (matched?.primaryCredentialId) {
          await bindHardwarePasskey('primary', matched.primaryCredentialId, onChainPrimaryHex)
        } else {
          const picked = await getDiscoverablePlatformAssertion()
          const matchedRole = matchWebAuthnAssertion(picked.assertion, onChainKeys)
          if (matchedRole === 'primary') {
            await bindHardwarePasskey('primary', picked.credentialId, onChainPrimaryHex)
          } else if (matchedRole === 'secondary') {
            await bindHardwarePasskey('secondary', picked.credentialId, onChainSecondaryHex)
          } else {
            throw new Error('The passkey selected does not match this wallet.')
          }
        }
      }

      // 3. Verify or resolve Secondary passkey
      let currentSecondary = await AsyncStorage.getItem('@haptix_passkey_pubkey_secondary')
      if (!currentSecondary || currentSecondary !== onChainSecondaryHex) {
        const softwareRole = await matchLocalSoftwareKey(onChainKeys).catch(() => null)
        if (softwareRole === 'secondary') {
          await bindSoftwarePasskey('secondary', onChainSecondaryHex)
        } else if (matched?.secondaryCredentialId) {
          await bindHardwarePasskey('secondary', matched.secondaryCredentialId, onChainSecondaryHex)
        } else if (onChainPrimaryHex === onChainSecondaryHex) {
          // Single-key or reused key setup: duplicate primary's bound credentials
          const primaryCred = await AsyncStorage.getItem('@haptix_passkey_credential_primary')
          if (primaryCred) {
            await bindHardwarePasskey('secondary', primaryCred, onChainSecondaryHex)
          } else {
            await bindSoftwarePasskey('secondary', onChainSecondaryHex)
          }
        } else {
          const picked = await getDiscoverablePlatformAssertion()
          const matchedRole = matchWebAuthnAssertion(picked.assertion, onChainKeys)
          if (matchedRole === 'secondary' || (matchedRole === 'primary' && onChainPrimaryHex === onChainSecondaryHex)) {
            await bindHardwarePasskey('secondary', picked.credentialId, onChainSecondaryHex)
          } else {
            throw new Error("The passkey selected does not match this wallet's Backup Quorum key.")
          }
        }
      }

      // 4. Sign veto with both passkeys
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

      await discardStagedRecoveryKeys()
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      const updated = await fetchHaptixWallet(connection, walletPda)
      if (updated) setOnChainWallet(updated)

      dialog.alert(
        'Recovery Vetoed & Unfrozen',
        `The recovery was successfully cancelled on-chain with your hardware passkeys. Your wallet is now unfrozen and fully active.\n\nTx: ${ellipsify(sig, 8)}`,
        undefined,
        { status: 'success' },
      )
    } catch (err: any) {
      console.error('[Haptix Recovery Sheet] Cancel error:', formatChainErrorForLog(err))
      const msg = err?.message || ''
      if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
        return
      }
      dialog.alert(
        'Veto Failed',
        describeChainError(err, 'Could not cancel recovery on-chain. If you are not on the original device with this wallet\'s passkeys, veto from your original phone in Settings > Recovery.'),
      )
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

  // User-friendly Guardian Web Recovery Link
  const guardianWebUrl = useMemo(() => {
    if (!onChainWallet) return ''
    const pda = onChainWallet.pda.toBase58()
    const p = stagedKeys?.primaryPublicKeyHex ?? ''
    const s = stagedKeys?.secondaryPublicKeyHex ?? ''

    // Resolve local bundler host for immediate local testing if in dev mode
    let devHost = 'localhost:8081'
    const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL
    if (typeof scriptURL === 'string') {
      const match = scriptURL.match(/^https?:\/\/([^/]+)/)
      if (match && match[1]) devHost = match[1]
    }

    if (__DEV__ || AppConfig.devMode) {
      return `http://${devHost}/recover.html?wallet=${pda}&p=${p}&s=${s}`
    }

    return `https://haptix-passkeys.vercel.app/recover.html?wallet=${pda}&p=${p}&s=${s}`
  }, [onChainWallet, stagedKeys])

  const handleCopyWebLink = () => {
    if (!guardianWebUrl) return
    Clipboard.setString(guardianWebUrl)
    setCopiedLink(true)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setTimeout(() => setCopiedLink(false), 2500)
  }

  const handleShareWebLink = async () => {
    if (!guardianWebUrl || !onChainWallet) return
    try {
      await Share.share({
        title: 'Haptix Wallet Recovery Request',
        message: `Emergency Guardian Recovery: My phone was lost or damaged. Please authorize on-chain recovery for my Haptix smart account:\n\n${guardianWebUrl}`,
        url: guardianWebUrl,
      })
    } catch {
      handleCopyWebLink()
    }
  }

  const handleOpenWebPortal = async () => {
    if (!guardianWebUrl) return
    try {
      await Linking.openURL(guardianWebUrl)
    } catch {
      dialog.alert('Error', 'Could not open browser.')
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
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheetCard,
            {
              backgroundColor: isDark ? '#000000' : theme.bgCard,
              borderColor: isDark ? '#222226' : theme.borderDefault,
              borderWidth: 1,
              paddingBottom: Math.max(insets.bottom, 24),
              transform: [{ translateY: panY }],
            },
          ]}
        >
          
          {/* DRAG HANDLE TOUCH ZONE */}
          <View style={styles.dragHandleTouchZone} {...panResponder.panHandlers}>
            <View style={[styles.sheetHandle, { backgroundColor: isDark ? '#3F3F46' : theme.borderDefault }]} />
          </View>

          {/* HEADER */}
          <View style={styles.sheetHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={[
                  styles.headerIconWrap,
                  {
                    backgroundColor: isDark ? '#1C1C20' : theme.accentLight,
                    borderWidth: 1,
                    borderColor: isDark ? '#26262A' : theme.borderSubtle,
                  },
                ]}
              >
                <MaterialIcons name="security" size={22} color={isDark ? '#FFFFFF' : theme.textPrimary} />
              </View>
              <View>
                <Text style={[styles.sheetTitle, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>Recover lost wallet</Text>
                <Text style={[styles.sheetSubtitle, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>Guardian on-chain rescue</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <MaterialIcons name="close" size={20} color={isDark ? '#8E8E93' : theme.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>

            {/* STEP 1: TARGET WALLET (COMPACT SUMMARY WHEN INSPECTED, INPUT WHEN NOT) */}
            {onChainWallet && !isEditingTarget ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.inputLabel, { color: isDark ? '#8E8E93' : theme.textSecondary, marginBottom: 8 }]}>
                  1. Target wallet
                </Text>
                <View
                  style={[
                    styles.inspectedAccountCard,
                    {
                      backgroundColor: isDark ? '#141416' : '#FFFFFF',
                      borderColor: isDark ? '#26262E' : theme.borderDefault,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View style={[styles.targetWalletIconWrap, { backgroundColor: isDark ? '#1E1E22' : '#F4F4F5' }]}>
                      <MaterialIcons name="account-balance-wallet" size={18} color={isDark ? '#FFFFFF' : theme.textPrimary} />
                    </View>
                    <Text style={[styles.inspectedAccountTitle, styles.mono, { color: isDark ? '#FFFFFF' : theme.textPrimary }]} numberOfLines={1}>
                      {ellipsify(onChainWallet.pda.toBase58(), 6)}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => {
                        Clipboard.setString(onChainWallet.pda.toBase58())
                        Haptics.selectionAsync().catch(() => {})
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="content-copy" size={16} color={isDark ? '#8E8E93' : theme.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {})
                        setIsEditingTarget(true)
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.changeTargetText, { color: '#5E81FF' }]}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.sectionBlock}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 }}>
                  <Text style={[styles.inputLabel, { color: isDark ? '#9CA3AF' : theme.textSecondary, marginBottom: 0 }]}>
                    1. Target smart wallet address
                  </Text>
                  {onChainWallet && (
                    <TouchableOpacity onPress={() => setIsEditingTarget(false)}>
                      <Text style={{ fontSize: 13, color: '#5E81FF', fontWeight: '600' }}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* INPUT FIELD */}
                <View
                  style={[
                    styles.inputFieldContainer,
                    {
                      backgroundColor: isDark ? '#141416' : theme.bgElevated,
                      borderColor: isDark ? '#26262E' : theme.borderDefault,
                    },
                  ]}
                >
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        color: isDark ? '#FFFFFF' : theme.textPrimary,
                      },
                    ]}
                    value={walletInput}
                    onChangeText={setWalletInput}
                    placeholder="Paste Solana smart wallet ad..."
                    placeholderTextColor={isDark ? '#52525B' : theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.pasteButton}
                    onPress={handlePasteAddress}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <MaterialIcons name="content-paste" size={15} color="#5E81FF" />
                    <Text style={styles.pasteButtonText}>Paste</Text>
                  </TouchableOpacity>
                </View>

                {/* HINT BELOW INPUT */}
                <Text style={[styles.inputHintText, { color: isDark ? '#71717A' : theme.textMuted }]}>
                  Can't find it? Check past transaction receipts from an exchange or Solana Explorer, or ask your guardian.
                </Text>

                {/* INSPECT WALLET BUTTON */}
                <TouchableOpacity
                  style={[
                    styles.inspectButtonFull,
                    walletInput.trim().length > 0
                      ? { backgroundColor: '#5E81FF' }
                      : { backgroundColor: isDark ? '#1E1E22' : '#EFEFF0' },
                    isInspecting && { opacity: 0.7 },
                  ]}
                  onPress={() => void handleInspectWallet()}
                  disabled={isInspecting || walletInput.trim().length === 0}
                  activeOpacity={0.85}
                >
                  {isInspecting ? (
                    <SpinLoader size="sm" color={walletInput.trim().length > 0 ? '#080C1E' : '#71717A'} strokeWidth={2.4} />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons
                        name="search"
                        size={18}
                        color={walletInput.trim().length > 0 ? '#080C1E' : '#71717A'}
                      />
                      <Text
                        style={[
                          styles.inspectButtonFullText,
                          { color: walletInput.trim().length > 0 ? '#080C1E' : '#71717A' },
                        ]}
                      >
                        Inspect wallet
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* HOW SEEDLESS RECOVERY WORKS (COLLAPSIBLE ACCORDION) */}
                <TouchableOpacity
                  style={[
                    styles.howItWorksToggleCard,
                    {
                      backgroundColor: isDark ? '#161619' : '#FFFFFF',
                      borderColor: isDark ? '#26262E' : theme.borderDefault,
                    },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                    setShowHowItWorks((prev) => !prev)
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <MaterialIcons name="info-outline" size={18} color="#9CA3AF" />
                    <Text style={[styles.howItWorksTitle, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                      How seedless recovery works
                    </Text>
                  </View>
                  <MaterialIcons
                    name={showHowItWorks ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={20}
                    color="#71717A"
                  />
                </TouchableOpacity>

                {showHowItWorks && (
                  <View
                    style={[
                      styles.howItWorksExpandedBox,
                      {
                        backgroundColor: isDark ? '#161619' : '#FFFFFF',
                        borderColor: isDark ? '#26262E' : theme.borderDefault,
                      },
                    ]}
                  >
                    <Text style={[styles.guideIntro, { color: isDark ? '#A1A1AA' : theme.textSecondary }]}>
                      Haptix smart accounts on Solana do not rely on seed phrases. If your device is lost or stolen, your designated guardian rescues your account in 3 steps:
                    </Text>

                    <View style={styles.stepsList}>
                      <View style={styles.stepItem}>
                        <View style={styles.stepNumberBadge}>
                          <Text style={styles.stepNumberText}>1</Text>
                        </View>
                        <View style={styles.stepTextWrap}>
                          <Text style={[styles.stepItemTitle, { color: theme.textPrimary }]}>Enter wallet address</Text>
                          <Text style={[styles.stepItemDesc, { color: isDark ? '#D4D4D8' : theme.textSecondary }]}>
                            Identify your smart account on Solana.
                          </Text>
                        </View>
                      </View>

                      <View style={styles.stepItem}>
                        <View style={styles.stepNumberBadge}>
                          <Text style={styles.stepNumberText}>2</Text>
                        </View>
                        <View style={styles.stepTextWrap}>
                          <Text style={[styles.stepItemTitle, { color: theme.textPrimary }]}>Guardian freezes lost phone</Text>
                          <Text style={[styles.stepItemDesc, { color: isDark ? '#D4D4D8' : theme.textSecondary }]}>
                            Your guardian broadcasts an on-chain freeze transaction to safeguard your balance.
                          </Text>
                        </View>
                      </View>

                      <View style={styles.stepItem}>
                        <View style={styles.stepNumberBadge}>
                          <Text style={styles.stepNumberText}>3</Text>
                        </View>
                        <View style={styles.stepTextWrap}>
                          <Text style={[styles.stepItemTitle, { color: theme.textPrimary }]}>Finalize on new device</Text>
                          <Text style={[styles.stepItemDesc, { color: isDark ? '#D4D4D8' : theme.textSecondary }]}>
                            Once the timelock expires, this device's passkey takes full control.
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}

                {/* TEST WALLET ON DEVNET (COLLAPSIBLE TEXT LINK) */}
                <TouchableOpacity
                  style={styles.devnetToggleBtn}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                    setShowDemoWallets((prev) => !prev)
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.devnetToggleText, { color: isDark ? '#8E8E93' : theme.textMuted }]}>
                    Use a test wallet on devnet
                  </Text>
                  <MaterialIcons
                    name={showDemoWallets ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={18}
                    color={isDark ? '#8E8E93' : theme.textMuted}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>

                {showDemoWallets && (
                  <View style={styles.quickTestRow}>
                    <TouchableOpacity
                      style={[styles.quickChip, { backgroundColor: isDark ? '#1C1C1E' : '#EFEFF0', borderWidth: 1, borderColor: isDark ? '#26262C' : theme.borderDefault }]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {})
                        setWalletInput('GQyNg1h6tqn1PNjYxYyeyAQ4qYZ7kqQrJBrWyp99J9Lj')
                        void handleInspectWallet('GQyNg1h6tqn1PNjYxYyeyAQ4qYZ7kqQrJBrWyp99J9Lj')
                      }}
                    >
                      <Text style={[styles.quickChipText, { color: isDark ? '#A1A1AA' : theme.textSecondary }]}>Load test (GQyNg...)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.quickChip, { backgroundColor: isDark ? '#1C1C1E' : '#EFEFF0', borderWidth: 1, borderColor: isDark ? '#26262C' : theme.borderDefault }]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {})
                        setWalletInput('HziZimWjrC3TZCSPA8EzqJCCnsk7hUxu8QVpxCjs3kNb')
                        void handleInspectWallet('HziZimWjrC3TZCSPA8EzqJCCnsk7hUxu8QVpxCjs3kNb')
                      }}
                    >
                      <Text style={[styles.quickChipText, { color: isDark ? '#A1A1AA' : theme.textSecondary }]}>Load test (HziZi...)</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* STEP 2: ON-CHAIN STATUS DIAGNOSTIC */}
            {onChainWallet && (
              <View style={[styles.diagnosticCard, { backgroundColor: isDark ? '#141416' : '#FFFFFF', borderColor: isDark ? '#26262E' : theme.borderDefault }]}>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>Balance</Text>
                  <Text style={[styles.diagValue, { color: isDark ? '#FFFFFF' : theme.textPrimary, fontWeight: '600' }]}>
                    {(onChainWallet.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </Text>
                </View>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>Guardian</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.diagValue, styles.mono, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                      {ellipsify(onChainWallet.guardian.toBase58(), 6)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        Clipboard.setString(onChainWallet.guardian.toBase58())
                        Haptics.selectionAsync().catch(() => {})
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="content-copy" size={14} color={isDark ? '#8E8E93' : theme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.diagnosticRow}>
                  <Text style={[styles.diagLabel, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>Dispute timelock</Text>
                  <Text style={[styles.diagValue, { color: isDark ? '#FFFFFF' : theme.textPrimary, fontWeight: '600' }]}>
                    {describeTimelock(onChainWallet.recoveryTimelock)}
                  </Text>
                </View>
                <View style={[styles.diagnosticRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                  <Text style={[styles.diagLabel, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>Status</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons
                      name={recoveryWindow?.isElapsed ? 'check-circle' : onChainWallet.recoveryInitiatedAt > 0n ? 'lock-clock' : 'check'}
                      size={15}
                      color={recoveryWindow?.isElapsed ? '#10B981' : onChainWallet.recoveryInitiatedAt > 0n ? '#F59E0B' : '#10B981'}
                    />
                    <Text
                      style={[
                        styles.diagValue,
                        {
                          color: isDark ? '#FFFFFF' : theme.textPrimary,
                          fontWeight: '600',
                        },
                      ]}
                    >
                      {recoveryWindow?.isElapsed
                        ? 'Ready to finalize'
                        : onChainWallet.recoveryInitiatedAt > 0n
                          ? 'Recovery in flight (frozen)'
                          : 'Active, normal'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* STEP 3: DISPUTE COUNTDOWN & VETO OPTION (IF RECOVERY IN FLIGHT) */}
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

                {/* VETO / UNFREEZE ACTION */}
                <View style={[styles.vetoCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <MaterialIcons name="shield" size={16} color={theme.emerald} />
                    <Text style={[styles.vetoTitle, { color: theme.textPrimary }]}>
                      Did you freeze this wallet by mistake?
                    </Text>
                  </View>
                  <Text style={[styles.vetoDesc, { color: theme.textMuted }]}>
                    If you still have your hardware passkeys, you can veto this recovery on-chain right now to unfreeze your wallet.
                  </Text>
                  <TouchableOpacity
                    style={[styles.vetoBtn, { borderColor: theme.emerald, backgroundColor: theme.emeraldBg }]}
                    onPress={handleCancelRecovery}
                    disabled={actionBusy !== null}
                    activeOpacity={0.8}
                  >
                    {actionBusy === 'cancel' ? (
                      <SpinLoader size="sm" color={theme.emeraldText} strokeWidth={2.4} />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="lock-open" size={16} color={theme.emeraldText} />
                        <Text style={[styles.vetoBtnText, { color: theme.emeraldText }]}>
                          Veto Recovery (Unfreeze Wallet Now)
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <Text style={[styles.vetoSubHint, { color: theme.textMuted }]}>
                    Or on your original phone: Settings &gt; Guardian &amp; Recovery &gt; "Keep My Keys"
                  </Text>
                </View>
              </View>
            )}

            {/* STEP 4: GUARDIAN AUTHORIZATION (IF NOT IN FLIGHT) */}
            {onChainWallet && onChainWallet.recoveryInitiatedAt === 0n && (
              <View style={styles.sectionBlock}>
                <Text style={[styles.sectionHeading, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                  2. Authorize recovery as guardian
                </Text>
                
                {/* Clear Explanation of Who Signs */}
                <View style={[styles.noticeBox, { backgroundColor: isDark ? '#161619' : '#F4F4F5', borderColor: isDark ? '#26262E' : theme.borderDefault }]}>
                  <MaterialIcons name="info-outline" size={18} color="#8E8E93" style={{ marginTop: 2, marginRight: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.noticeTitle, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                      Why does the guardian sign?
                    </Text>
                    <Text style={[styles.noticeText, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>
                      Because your phone is lost. The guardian signs on Solana to initiate the rescue without needing your lost phone's passkeys.
                    </Text>
                  </View>
                </View>

                {/* Method Selector */}
                <View style={styles.methodSelectorWrap}>
                  <Text style={[styles.methodSelectorLabel, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>
                    Guardian signing method
                  </Text>
                  <View style={[styles.tabSelectorRow, { backgroundColor: isDark ? '#141416' : '#E5E5EA', borderColor: isDark ? '#26262E' : theme.borderDefault, borderWidth: 1 }]}>
                    <TouchableOpacity
                      style={[
                        styles.tabSelectorPill,
                        signingTab === 'devnet' && styles.tabSelectorPillActive,
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setSigningTab('devnet')
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.tabSelectorText,
                          { color: signingTab === 'devnet' ? '#080C1E' : (isDark ? '#8E8E93' : '#636366') },
                          signingTab === 'devnet' && { fontWeight: '600' },
                        ]}
                      >
                        In-app devnet (1-tap)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.tabSelectorPill,
                        signingTab === 'web' && styles.tabSelectorPillActive,
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setSigningTab('web')
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.tabSelectorText,
                          { color: signingTab === 'web' ? '#080C1E' : (isDark ? '#8E8E93' : '#636366') },
                          signingTab === 'web' && { fontWeight: '600' },
                        ]}
                      >
                        Guardian web portal
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Tab 1: In-App Devnet Guardian */}
                {signingTab === 'devnet' && (
                  <View style={[styles.tabContent, { backgroundColor: isDark ? '#141416' : '#FFFFFF', borderColor: isDark ? '#26262E' : theme.borderDefault }]}>
                    <Text style={[styles.tabDesc, { color: isDark ? '#8E8E93' : theme.textSecondary }]}>
                      In devnet mode, a pre-configured guardian keypair will broadcast the freeze transaction on Solana.
                    </Text>

                    {/* Pre-action Warning Banner */}
                    <View style={[styles.freezeWarningCard, { backgroundColor: isDark ? '#1C170E' : '#FEF3C7', borderColor: isDark ? 'rgba(245, 158, 11, 0.28)' : '#FDE68A' }]}>
                      <MaterialIcons name="warning-amber" size={18} color="#F59E0B" style={{ marginTop: 1, marginRight: 10 }} />
                      <Text style={[styles.freezeWarningText, { color: '#F59E0B' }]}>
                        This will immediately freeze the lost phone on Solana. A {describeTimelock(onChainWallet.recoveryTimelock)} dispute timelock will begin.
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.primaryActionBtn,
                        { backgroundColor: '#5E81FF' },
                        actionBusy && { opacity: 0.7 },
                      ]}
                      onPress={handleInitiateDevnet}
                      disabled={actionBusy !== null}
                      activeOpacity={0.85}
                    >
                      {actionBusy === 'initiate' ? (
                        <SpinLoader size="sm" color="#080C1E" strokeWidth={2.4} />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <MaterialIcons name="lock-outline" size={18} color="#080C1E" />
                          <Text style={[styles.primaryActionBtnText, { color: '#080C1E' }]}>
                            Initiate recovery and freeze lost phone
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Tab 2: Guardian Web Portal & Link */}
                {signingTab === 'web' && (
                  <View style={[styles.tabContent, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', borderColor: isDark ? '#26262C' : theme.borderDefault }]}>
                    <Text style={[styles.tabDesc, { color: isDark ? '#E4E4E7' : theme.textSecondary }]}>
                      Share this secure recovery link or QR code with your Guardian. They can authorize from any laptop, Mac, or phone browser with 1-click — no terminal or command line required:
                    </Text>

                    {/* QR Code for Direct Web Portal Access */}
                    <View style={{ alignItems: 'center', marginVertical: 12 }}>
                      <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderRadius: 16 }}>
                        <AppQrCode value={guardianWebUrl || 'https://haptix-passkeys.vercel.app'} size={145} showTapHint={false} />
                      </View>
                      <Text style={[styles.qrHint, { color: isDark ? '#A1A1AA' : theme.textSecondary }]}>
                        Scan with laptop or phone camera to open Web Portal
                      </Text>
                    </View>

                    {/* Web Link Display Card */}
                    <View style={[styles.webLinkCard, { backgroundColor: isDark ? '#141416' : '#F5F5F7', borderColor: isDark ? '#26262C' : theme.borderDefault }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <MaterialIcons name="link" size={14} color="#6C8CFF" />
                          <Text style={[styles.webLinkLabel, { color: '#6C8CFF' }]}>GUARDIAN RECOVERY LINK</Text>
                        </View>
                        {copiedLink && (
                          <Text style={{ fontSize: 11, color: '#10B981', fontWeight: '700' }}>Copied!</Text>
                        )}
                      </View>
                      <Text style={[styles.webLinkUrl, { color: isDark ? '#E4E4E7' : theme.textPrimary }]} numberOfLines={2}>
                        {guardianWebUrl}
                      </Text>
                    </View>

                    {/* Action Buttons: Copy Link, Share, Open Web */}
                    <View style={styles.webActionRow}>
                      <TouchableOpacity
                        style={[
                          styles.webActionBtn,
                          { backgroundColor: '#4F6BFF', borderColor: '#4F6BFF' },
                        ]}
                        onPress={handleCopyWebLink}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons
                          name={copiedLink ? 'check' : 'content-copy'}
                          size={15}
                          color="#FFFFFF"
                        />
                        <Text style={[styles.webActionBtnText, { color: '#FFFFFF' }]}>
                          {copiedLink ? 'Copied' : 'Copy Link'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.webActionBtn,
                          { backgroundColor: isDark ? '#26262A' : '#EFEFF0', borderColor: isDark ? '#3F3F46' : 'transparent' },
                        ]}
                        onPress={handleShareWebLink}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="share" size={15} color={isDark ? '#FFFFFF' : theme.textPrimary} />
                        <Text style={[styles.webActionBtnText, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                          Share
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.webActionBtn,
                          { backgroundColor: isDark ? '#26262A' : '#EFEFF0', borderColor: isDark ? '#3F3F46' : 'transparent' },
                        ]}
                        onPress={handleOpenWebPortal}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="open-in-browser" size={16} color={isDark ? '#FFFFFF' : theme.textPrimary} />
                        <Text style={[styles.webActionBtnText, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
                          Open Web
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Expandable Developer CLI Option */}
                    <TouchableOpacity
                      style={[styles.cliToggleRow, { borderTopColor: isDark ? '#26262C' : theme.borderSubtle }]}
                      onPress={() => setShowAdvancedCli(!showAdvancedCli)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <MaterialIcons name="terminal" size={14} color={isDark ? '#A1A1AA' : theme.textMuted} />
                        <Text style={[styles.cliToggleText, { color: isDark ? '#A1A1AA' : theme.textMuted }]}>
                          Advanced: Developer CLI command
                        </Text>
                      </View>
                      <MaterialIcons
                        name={showAdvancedCli ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                        size={18}
                        color={isDark ? '#A1A1AA' : theme.textMuted}
                      />
                    </TouchableOpacity>

                    {showAdvancedCli && (
                      <TouchableOpacity
                        style={[styles.codeBox, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault, marginTop: 8 }]}
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
                            {copiedPayload ? 'Copied CLI command' : 'Tap to copy CLI command'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )}
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
                    <SpinLoader size="sm" color="#FFFFFF" strokeWidth={2.4} />
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
        </Animated.View>
      </View>
    </Modal>

      <Modal
        visible={showFreezeConfirmModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowFreezeConfirmModal(false)}
      >
        <View style={styles.freezeConfirmOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowFreezeConfirmModal(false)} />
          <View
            style={[
              styles.freezeConfirmCard,
              {
                backgroundColor: isDark ? '#121215' : '#FFFFFF',
                borderColor: isDark ? '#222228' : theme.borderDefault,
              },
            ]}
          >
            <View style={styles.freezeConfirmBadge}>
              <MaterialIcons name="warning" size={26} color="#F59E0B" />
            </View>

            <Text style={[styles.freezeConfirmTitle, { color: isDark ? '#FFFFFF' : theme.textPrimary }]}>
              {'Freeze lost phone and start\nrecovery?'}
            </Text>

            <Text style={[styles.freezeConfirmSubtitle, { color: isDark ? '#9CA3AF' : theme.textSecondary }]}>
              This broadcasts a transaction signed by your guardian on Solana.
            </Text>

            <View
              style={[
                styles.freezeInfoBox,
                {
                  backgroundColor: isDark ? '#18181D' : '#F6F6F8',
                  borderColor: isDark ? '#26262E' : theme.borderDefault,
                },
              ]}
            >
              <View style={styles.freezeInfoRow}>
                <MaterialIcons name="lock-outline" size={18} color={isDark ? '#9CA3AF' : theme.textMuted} style={styles.freezeInfoIcon} />
                <Text style={[styles.freezeInfoText, { color: isDark ? '#E4E4E7' : theme.textPrimary }]}>
                  The lost phone is frozen on-chain and can't send funds.
                </Text>
              </View>

              <View style={[styles.freezeInfoDivider, { backgroundColor: isDark ? '#26262E' : theme.borderSubtle }]} />

              <View style={styles.freezeInfoRow}>
                <MaterialIcons name="schedule" size={18} color={isDark ? '#9CA3AF' : theme.textMuted} style={styles.freezeInfoIcon} />
                <Text style={[styles.freezeInfoText, { color: isDark ? '#E4E4E7' : theme.textPrimary }]}>
                  {`A ${onChainWallet ? describeTimelock(onChainWallet.recoveryTimelock) : '30s'} dispute window begins.`}
                </Text>
              </View>

              <View style={[styles.freezeInfoDivider, { backgroundColor: isDark ? '#26262E' : theme.borderSubtle }]} />

              <View style={styles.freezeInfoRow}>
                <MaterialIcons name="undo" size={18} color={isDark ? '#9CA3AF' : theme.textMuted} style={styles.freezeInfoIcon} />
                <Text style={[styles.freezeInfoText, { color: isDark ? '#E4E4E7' : theme.textPrimary }]}>
                  If you still have your original phone, you can veto this at any time with your passkeys.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.freezeConfirmPrimaryBtn, { backgroundColor: theme.accent }]}
              onPress={() => {
                setShowFreezeConfirmModal(false)
                void runInitiateDevnet()
              }}
            >
              <Text style={[styles.freezeConfirmPrimaryBtnText, { color: theme.accentForeground }]}>Freeze and start recovery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.freezeConfirmCancelBtn}
              onPress={() => setShowFreezeConfirmModal(false)}
            >
              <Text style={[styles.freezeConfirmCancelBtnText, { color: isDark ? '#71717A' : theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
    paddingTop: 12,
    maxHeight: '94%',
    flex: 1,
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
    alignSelf: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sheetSubtitle: {
    fontSize: 13.5,
    marginTop: 2,
  },
  guideCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  guideTitle: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  guideIntro: {
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 14,
  },
  stepsList: {
    gap: 12,
    marginBottom: 12,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumberText: {
    color: '#60A5FA',
    fontSize: 11,
    fontWeight: '700',
  },
  stepTextWrap: {
    flex: 1,
  },
  stepItemTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepItemDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  hintBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  hintText: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  sectionBlock: {
    marginTop: 4,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13.5,
    fontWeight: '500',
    marginBottom: 8,
  },
  inputFieldContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    height: 52,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 10,
  },
  pasteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  pasteButtonText: {
    color: '#5E81FF',
    fontSize: 14,
    fontWeight: '600',
  },
  inputHintText: {
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 10,
    marginBottom: 20,
    paddingHorizontal: 2,
  },
  inspectButtonFull: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  inspectButtonFullText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  howItWorksToggleCard: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  howItWorksTitle: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  howItWorksExpandedBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  devnetToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  devnetToggleText: {
    fontSize: 13.5,
    fontWeight: '500',
  },
  quickTestRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    justifyContent: 'center',
  },
  quickChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickChipText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 14,
  },
  noticeIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(79, 107, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 3,
    letterSpacing: -0.1,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 17,
  },
  methodSelectorWrap: {
    marginBottom: 10,
  },
  methodSelectorLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  diagnosticCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  guideIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectedAccountCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetWalletIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectedAccountLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  inspectedAccountTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  cardMiniBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeTargetBtn: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeTargetText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 12,
    marginTop: 8,
  },
  tabSelectorRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
    gap: 4,
  },
  tabSelectorPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  tabSelectorPillActive: {
    backgroundColor: '#4F6BFF',
    shadowColor: '#4F6BFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  tabSelectorText: {
    fontSize: 12.5,
    fontWeight: '700',
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
    marginBottom: 14,
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
    marginBottom: 12,
  },
  vetoCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  vetoTitle: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  vetoDesc: {
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  vetoBtn: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vetoBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  vetoSubHint: {
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: 6,
  },
  methodBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
  },
  methodBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
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
    marginBottom: 10,
  },
  freezeWarningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  freezeWarningText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
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
  webLinkCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
  },
  webLinkLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  webLinkUrl: {
    fontSize: 11.5,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  webActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  webActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  webActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cliToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
  },
  cliToggleText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  finalizeCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
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
  freezeConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  freezeConfirmCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#121215',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#222228',
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.6,
    shadowRadius: 28,
    elevation: 24,
  },
  freezeConfirmBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  freezeConfirmTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 8,
  },
  freezeConfirmSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 6,
  },
  freezeInfoBox: {
    width: '100%',
    backgroundColor: '#18181D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26262E',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 22,
  },
  freezeInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  freezeInfoIcon: {
    marginTop: 2,
    marginRight: 12,
  },
  freezeInfoText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '400',
    color: '#E4E4E7',
    lineHeight: 19.5,
  },
  freezeInfoDivider: {
    height: 1,
    backgroundColor: '#26262E',
    marginVertical: 12,
  },
  freezeConfirmPrimaryBtn: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    backgroundColor: '#5E81FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  freezeConfirmPrimaryBtnText: {
    fontSize: 15.5,
    fontWeight: '600',
    color: '#080C1E',
    letterSpacing: 0.1,
  },
  freezeConfirmCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  freezeConfirmCancelBtnText: {
    fontSize: 14.5,
    fontWeight: '500',
    color: '#71717A',
    textAlign: 'center',
  },
})
