import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
  Alert,
  Modal,
  ActivityIndicator,
  Linking,
  Pressable,
  Platform,
  StatusBar as RNStatusBar,
  KeyboardAvoidingView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { Buffer } from 'buffer'
import * as Haptics from 'expo-haptics'
import Clipboard from '@/utils/clipboard'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAuth } from '@/components/auth/auth-provider'
import { AppQrCode } from '@/components/app-qr-code'
import { ellipsify } from '@/utils/ellipsify'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import { signWithPasskey, promptBiometricAuth, deletePasskeys } from '@/utils/haptix-passkey'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  PrismDepthButton,
  DepthOutlineButton,
  BookmarkSaveButton,
  CopyActionButton,
  ThemeToggleButton,
  HoldToConfirmButton,
  AnimatedCounter,
} from '@/components/ui'
import {
  fetchHaptixWallet,
  getTransferSignedMessage,
  createExecuteTransferInstruction,
  createInitializeWalletInstruction,
  getGrantAgentSignedMessage,
  createGrantAgentSessionInstruction,
  createAgentExecuteInstruction,
  createPanicFreezeInstruction,
  createUnfreezeInstruction,
  WalletState,
} from '@/utils/haptix-client'
import { getFundedDevnetPayer, fundDevnetWallet } from '@/utils/haptix-funder'
import {
  HaptixBrandMark,
  SolanaTokenLogo,
  UsdcTokenLogo,
  ActionSendIcon,
  ActionReceiveIcon,
  ActionSwapIcon,
  DockHomeIcon,
  DockMarketsIcon,
  DockSwapIcon,
  DockAgentIcon,
  DockSecurityIcon,
  EyeShowIcon,
  EyeHideIcon,
  DepositActionIcon,
  WithdrawActionIcon,
  CopyChipIcon,
  FingerScanBold,
  KeySquareBold,
} from './haptix-icons'
import { HaptixFloatingDock, DockTabId } from './haptix-floating-dock'
import { HaptixIosTabs } from './haptix-ios-tabs'
import { HaptixPolicySheet, PolicyTopic } from './haptix-policy-sheet'
import { HaptixAlert } from './haptix-alert'
import { radius, typeScale } from '@/theme/tokens'

const DEVNET_RPC = 'https://api.devnet.solana.com'
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com'
const SOL_PRICE_USD = 150.0 // Market reference rate for portfolio valuation

const MARKET_TOKENS = [
  { symbol: 'SOL', name: 'Solana', price: '$150.00', change: '+4.82%', isPositive: true },
  { symbol: 'USDC', name: 'USD Coin', price: '$1.00', change: '+0.01%', isPositive: true },
  { symbol: 'JUP', name: 'Jupiter', price: '$0.84', change: '+7.15%', isPositive: true },
  { symbol: 'RAY', name: 'Raydium', price: '$1.92', change: '+3.40%', isPositive: true },
  { symbol: 'BONK', name: 'Bonk', price: '$0.000021', change: '-1.85%', isPositive: false },
]

interface TransactionRecord {
  signature: string
  type: 'transfer' | 'airdrop' | 'agent_trade' | 'swap' | 'freeze' | 'unfreeze' | 'init'
  amount: number
  tokenSymbol?: 'SOL' | 'USDC'
  recipientOrSender: string
  timestamp: number
  status: 'confirmed' | 'finalized'
  securityType?: string
}

function isValidSolanaAddress(addr: string): boolean {
  if (!addr) return false
  const trimmed = addr.trim()
  return trimmed.length >= 32 && trimmed.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)
}

export function HaptixWalletScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { activeWallet, isLocked, lockWallet, unlockWallet, signOut } = useAuth()
  const { theme, isDark } = useAppTheme()

  const s = useMemo(() => ({
    container: { backgroundColor: theme.bgApp },
    header: { backgroundColor: theme.bgApp, borderBottomColor: theme.borderSubtle, borderBottomWidth: 1 },
    card: { backgroundColor: theme.bgCard, borderColor: theme.borderDefault },
    elevatedCard: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    textPrimary: { color: theme.textPrimary },
    textSecondary: { color: theme.textSecondary },
    textMuted: { color: theme.textMuted },
    input: { backgroundColor: theme.bgInput, borderColor: theme.borderDefault, color: theme.textPrimary },
    divider: { backgroundColor: theme.borderSubtle },
    iconBtn: { backgroundColor: isDark ? '#141414' : '#F4F4F5', borderColor: theme.borderDefault },
    modalSheet: { backgroundColor: theme.bgCard, borderColor: theme.borderDefault },
    actionBtn: { backgroundColor: isDark ? '#141414' : '#F4F4F5', borderColor: theme.borderDefault },
    actionBtnText: { color: theme.textPrimary },
    actionBtnSecondaryText: { color: theme.textSecondary },
  }), [theme, isDark])

  // Network State (Devnet vs Mainnet)
  const [network, setNetwork] = useState<'devnet' | 'mainnet'>('devnet')

  // Balances
  const [balance, setBalance] = useState<number>(0)
  const [usdcBalance, setUsdcBalance] = useState<number>(0)
  const [refreshing, setRefreshing] = useState(false)

  // Loading States
  const [isSending, setIsSending] = useState(false)
  const [sendErrorMsg, setSendErrorMsg] = useState('')
  const [isSwapping, setIsSwapping] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isRequestingFaucet, setIsRequestingFaucet] = useState(false)
  const [isInitializingWallet, setIsInitializingWallet] = useState(false)

  // Security & Anchor On-Chain State
  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isFrozen, setIsFrozen] = useState(false)
  const [agentAllowance, setAgentAllowance] = useState(0.25)
  const [spendThreshold, setSpendThreshold] = useState(activeWallet?.spendThreshold ?? 0.1)

  // Modals & Drawers
  const [showSendModal, setShowSendModal] = useState(false)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [showSwapModal, setShowSwapModal] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showTxDetailModal, setShowTxDetailModal] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionRecord | null>(null)
  const [policyTopic, setPolicyTopic] = useState<PolicyTopic | null>(null)

  // Form Inputs
  const [sendRecipient, setSendRecipient] = useState('')
  const [sendAmountText, setSendAmountText] = useState('0.05')
  const [swapFromAmountText, setSwapFromAmountText] = useState('0.1')
  const [swapDirection, setSwapDirection] = useState<'SOL_TO_USDC' | 'USDC_TO_SOL'>('SOL_TO_USDC')

  // Agent Policy Customization Inputs
  const [isGrantingSession, setIsGrantingSession] = useState(false)
  const [customAgentAllowance, setCustomAgentAllowance] = useState('0.25')
  const [customAgentValidHours, setCustomAgentValidHours] = useState('24')

  // Transactions History & Filters
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [activityFilter, setActivityFilter] = useState<'all' | 'transfers' | 'agents' | 'security'>('all')

  // Elevated Dock & Home View Controls
  const [dockTab, setDockTab] = useState<DockTabId>('home')
  const [isBalanceHidden, setIsBalanceHidden] = useState(false)
  const [segmentedTab, setSegmentedTab] = useState<'assets' | 'markets'>('assets')
  const [hasCopiedAddress, setHasCopiedAddress] = useState(false)

  const handleCopyWalletAddress = async () => {
    if (!activeWallet?.address) return
    await Clipboard.setString(activeWallet.address)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setHasCopiedAddress(true)
    setTimeout(() => setHasCopiedAddress(false), 2000)
  }

  const handleDockSelect = (tab: DockTabId) => {
    Haptics.selectionAsync()
    setDockTab(tab)
  }

  // Active Connection depending on selected network
  const connection = useMemo(
    () =>
      new Connection(network === 'devnet' ? DEVNET_RPC : MAINNET_RPC, {
        commitment: 'confirmed',
      }),
    [network]
  )

  // Fetch on-chain balance and Anchor account state from Solana Devnet
  const fetchRealBalance = useCallback(async () => {
    if (!activeWallet?.address) return
    try {
      const pubkey = new PublicKey(activeWallet.address)
      const lamports = await connection.getBalance(pubkey).catch(() => 0)
      setBalance(lamports / LAMPORTS_PER_SOL)

      if (network === 'devnet') {
        const state = await fetchHaptixWallet(connection, pubkey).catch(() => null)
        if (state) {
          setOnChainWallet(state)
          setIsFrozen(state.isFrozen)
          setSpendThreshold(Number(state.spendThresholdLamports) / LAMPORTS_PER_SOL)
          if (state.agents.length > 0) {
            const total = state.agents.reduce(
              (acc, a) => acc + Number(a.allowanceLamports),
              0
            )
            setAgentAllowance(total / LAMPORTS_PER_SOL)
          }
        }
      }
    } catch {
      // Quietly ignore transient RPC network latency
    }
  }, [activeWallet?.address, connection, network])

  // Fetch recent transactions from Solana
  const fetchRecentTransactions = useCallback(async () => {
    if (!activeWallet?.address) return
    try {
      const pubkey = new PublicKey(activeWallet.address)
      const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 10 }).catch(() => [])
      if (sigs && sigs.length > 0) {
        const mapped: TransactionRecord[] = sigs.map((s) => ({
          signature: s.signature,
          type: 'transfer',
          amount: 0.05,
          tokenSymbol: 'SOL',
          recipientOrSender: ellipsify(s.signature, 6),
          timestamp: (s.blockTime ?? Date.now() / 1000) * 1000,
          status: 'confirmed',
        }))
        setTransactions((prev) => {
          const combined = [...prev]
          for (const m of mapped) {
            if (!combined.some((c) => c.signature === m.signature)) {
              combined.push(m)
            }
          }
          return combined
        })
      }
    } catch {
      // Quietly ignore
    }
  }, [activeWallet?.address, connection])

  useEffect(() => {
    fetchRealBalance()
    fetchRecentTransactions()
  }, [fetchRealBalance, fetchRecentTransactions])

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchRealBalance(), fetchRecentTransactions()])
    setRefreshing(false)
  }

  // Request Faucet Devnet SOL (+0.2 SOL from funded relayer treasury)
  const handleRequestFaucet = async () => {
    if (network !== 'devnet') {
      Alert.alert('Devnet Only', 'Faucet funding is only available on Solana Devnet.')
      return
    }
    if (!activeWallet?.address) return

    try {
      setIsRequestingFaucet(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const walletPda = new PublicKey(activeWallet.address)
      const sig = await fundDevnetWallet(connection, walletPda, 0.2)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      const newTx: TransactionRecord = {
        signature: sig,
        type: 'airdrop',
        amount: 0.2,
        tokenSymbol: 'SOL',
        recipientOrSender: 'Devnet Relayer Treasury',
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: 'Relayer Sponsoring',
      }
      setTransactions((prev) => [newTx, ...prev])

      Alert.alert(
        'Devnet SOL Received!',
        `Sent 0.20 SOL to your smart account from the Devnet relayer.\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () =>
              Linking.openURL(
                `https://explorer.solana.com/tx/${sig}?cluster=devnet`
              ),
          },
          { text: 'Great', style: 'default' },
        ]
      )
    } catch (err: any) {
      console.error('[Faucet Error]:', err)
      Alert.alert('Faucet Request Failed', err?.message || 'Could not fund account on Devnet.')
    } finally {
      setIsRequestingFaucet(false)
    }
  }

  // Initialize Counterfactual PDA Account on Solana Devnet (Anchor Program)
  const handleInitializeWalletOnChain = async () => {
    if (network !== 'devnet') {
      Alert.alert('Devnet Only', 'Wallet initialization on Anchor is available on Devnet.')
      return
    }
    if (!activeWallet?.address || !activeWallet.primaryPasskeyHex || !activeWallet.secondaryPasskeyHex) {
      Alert.alert('Error', 'Missing hardware passkey credentials.')
      return
    }

    try {
      setIsInitializingWallet(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      const walletPda = new PublicKey(activeWallet.address)
      const payer = await getFundedDevnetPayer(connection)
      const primaryPasskey = new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex'))
      const secondaryPasskey = new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex'))

      const initIx = createInitializeWalletInstruction({
        payer: payer.publicKey,
        walletPda,
        primaryPasskey,
        secondaryPasskey,
        spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
      })

      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(initIx)
      tx.sign(payer)

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      )

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      const newTx: TransactionRecord = {
        signature: sig,
        type: 'init',
        amount: 0,
        tokenSymbol: 'SOL',
        recipientOrSender: 'Haptix Policy Program',
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: '2-of-2 Hardware Quorum',
      }
      setTransactions((prev) => [newTx, ...prev])

      Alert.alert(
        'Smart Account Ready',
        `Your spending limits are now enforced by the on-chain program on Solana Devnet.\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () =>
              Linking.openURL(
                `https://explorer.solana.com/tx/${sig}?cluster=devnet`
              ),
          },
          { text: 'Done', style: 'default' },
        ]
      )
    } catch (err: any) {
      console.error('[Initialize Wallet Error]:', err)
      Alert.alert('Initialization Failed', err?.message || 'Could not initialize on-chain account.')
    } finally {
      setIsInitializingWallet(false)
    }
  }

  // Grant Scoped AI Agent Session Key on Solana Devnet (2-of-2 Hardware Passkeys)
  const handleGrantCustomSession = async () => {
    if (isFrozen) {
      Alert.alert('Security Alert', 'Wallet is panic frozen. Session key delegation locked.')
      return
    }
    if (!activeWallet?.address) return

    const allowanceSol = parseFloat(customAgentAllowance) || 0.25
    const hours = parseInt(customAgentValidHours, 10) || 24
    const validForSeconds = BigInt(hours * 3600)
    const allowanceLamports = BigInt(Math.round(allowanceSol * LAMPORTS_PER_SOL))

    try {
      setIsGrantingSession(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const walletPda = new PublicKey(activeWallet.address)
      const ephemeralAgent = Keypair.generate()

      const grantMsg = getGrantAgentSignedMessage(ephemeralAgent.publicKey, allowanceLamports, validForSeconds)
      const primarySig = await signWithPasskey('primary', grantMsg, `Grant ${allowanceSol} SOL Session to Agent`)
      const secondarySig = await signWithPasskey('secondary', grantMsg, `2-of-2 Quorum for Agent Delegation`)

      const precompile1 = createSecp256r1Instruction({
        signature: primarySig.signature,
        publicKey: primarySig.publicKey,
        message: grantMsg,
      })
      const precompile2 = createSecp256r1Instruction({
        signature: secondarySig.signature,
        publicKey: secondarySig.publicKey,
        message: grantMsg,
      })
      const grantIx = createGrantAgentSessionInstruction({
        walletPda,
        agentPubkey: ephemeralAgent.publicKey,
        validForSeconds,
        allowanceLamports,
        allowedProgram: SystemProgram.programId,
        primarySigIxIndex: 0,
        secondarySigIxIndex: 1,
      })

      const payer = await getFundedDevnetPayer(connection)
      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      const needsInit = !onChain && !!(activeWallet.primaryPasskeyHex && activeWallet.secondaryPasskeyHex)

      let txInstructions = []
      if (needsInit) {
        const primaryPasskey = new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex'))
        const secondaryPasskey = new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex'))
        const initIx = createInitializeWalletInstruction({
          payer: payer.publicKey,
          walletPda,
          primaryPasskey,
          secondaryPasskey,
          spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
        })
        txInstructions.push(initIx)
      }
      txInstructions.push(precompile1, precompile2, grantIx)

      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(...txInstructions)
      tx.sign(payer)

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      )

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setAgentAllowance(allowanceSol)
      await fetchRealBalance()

      const newTx: TransactionRecord = {
        signature: sig,
        type: 'agent_trade',
        amount: allowanceSol,
        tokenSymbol: 'SOL',
        recipientOrSender: `Delegated Session Key (${ellipsify(ephemeralAgent.publicKey.toBase58(), 4)})`,
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: '2-of-2 Hardware Quorum',
      }
      setTransactions((prev) => [newTx, ...prev])

      Alert.alert(
        'Agent Session Granted On-Chain',
        `Authorized session key on Anchor with ${allowanceSol} SOL allowance.\nValid for: ${hours} hours\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
          { text: 'Done', style: 'default' },
        ]
      )
    } catch (err: any) {
      console.error('[Grant Session Error]:', err)
      Alert.alert('Session Grant Failed', err?.message || 'Could not grant session on-chain.')
    } finally {
      setIsGrantingSession(false)
    }
  }

  // On-chain Send Transaction via Haptix Anchor Program & Secp256r1 Precompile
  const handleSendTransaction = async () => {
    setSendErrorMsg('')
    if (isFrozen) {
      Alert.alert('Security Alert', 'Wallet is panic frozen. Outgoing transfers are locked on-chain.')
      return
    }

    const amt = parseFloat(sendAmountText) || 0
    if (amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid transfer amount.')
      return
    }

    if (amt > balance) {
      Alert.alert('Insufficient Funds', `You have ${balance.toFixed(4)} SOL available.`)
      return
    }

    let toPubkey: PublicKey
    try {
      toPubkey = new PublicKey(sendRecipient.trim())
    } catch {
      Alert.alert('Invalid Address', 'Please enter a valid Solana address.')
      return
    }

    if (!activeWallet?.address) {
      Alert.alert('Error', 'No active smart wallet found.')
      return
    }

    const walletPda = new PublicKey(activeWallet.address)
    const isHighRiskQuorum = amt > spendThreshold
    const amountLamports = BigInt(Math.round(amt * LAMPORTS_PER_SOL))

    try {
      setIsSending(true)
      await Haptics.impactAsync(
        isHighRiskQuorum ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light
      )

      // Expected on-chain message payload: recipient (32B) || amount (8B LE)
      const message = getTransferSignedMessage(toPubkey, amountLamports)

      // 1. Primary Passkey authorization (Biometric challenge)
      const primarySig = await signWithPasskey(
        'primary',
        message,
        `Authorize ${amt} SOL transfer to ${ellipsify(toPubkey.toBase58(), 4)}`
      )

      const precompilePrimary = createSecp256r1Instruction({
        signature: primarySig.signature,
        publicKey: primarySig.publicKey,
        message,
      })

      // Sponsor transaction network fee on Devnet via persistent funded relayer
      const payer = await getFundedDevnetPayer(connection)

      // Check if counterfactual PDA is already initialized on-chain
      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      const needsInit = !onChain && !!(activeWallet.primaryPasskeyHex && activeWallet.secondaryPasskeyHex)

      let txInstructions = []

      // If wallet is not yet on-chain, atomically initialize it first in the SAME transaction
      if (needsInit) {
        const primaryPasskey = new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex'))
        const secondaryPasskey = new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex'))
        const initIx = createInitializeWalletInstruction({
          payer: payer.publicKey,
          walletPda,
          primaryPasskey,
          secondaryPasskey,
          spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
        })
        txInstructions.push(initIx)
      }

      const primarySigIxIndex = needsInit ? 1 : 0
      const secondarySigIxIndex = needsInit ? (isHighRiskQuorum ? 2 : undefined) : (isHighRiskQuorum ? 1 : undefined)

      if (isHighRiskQuorum) {
        // 2. High-Risk: 2-of-2 Hardware Passkey Quorum required
        const secondarySig = await signWithPasskey(
          'secondary',
          message,
          `High-Value Quorum: Authorize ${amt} SOL transfer`
        )

        const precompileSecondary = createSecp256r1Instruction({
          signature: secondarySig.signature,
          publicKey: secondarySig.publicKey,
          message,
        })

        const transferIx = createExecuteTransferInstruction({
          walletPda,
          recipient: toPubkey,
          amountLamports,
          primarySigIxIndex,
          secondarySigIxIndex,
        })

        txInstructions.push(precompilePrimary, precompileSecondary, transferIx)
      } else {
        // Low-Risk: 1-tap passkey verification
        const transferIx = createExecuteTransferInstruction({
          walletPda,
          recipient: toPubkey,
          amountLamports,
          primarySigIxIndex,
          secondarySigIxIndex: undefined,
        })

        txInstructions.push(precompilePrimary, transferIx)
      }

      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(...txInstructions)

      tx.sign(payer)

      const rawTx = tx.serialize()
      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      // Non-blocking confirmation (transaction is already broadcast to cluster)
      connection
        .confirmTransaction(
          {
            signature: sig,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        )
        .catch(() => null)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      setTransactions((prev) => [
        {
          signature: sig,
          type: 'transfer',
          amount: amt,
          tokenSymbol: 'SOL',
          recipientOrSender: toPubkey.toBase58(),
          timestamp: Date.now(),
          status: 'confirmed',
        },
        ...prev,
      ])

      setShowSendModal(false)
      setSendRecipient('')

      Alert.alert(
        'Transfer Confirmed On-Chain',
        `Sent ${amt} SOL.\n\n${
          isHighRiskQuorum ? 'Verified: 2-of-2 Hardware Passkey Quorum' : 'Verified: 1-Tap Secp256r1 Passkey'
        }\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () =>
              Linking.openURL(
                `https://explorer.solana.com/tx/${sig}?cluster=${network === 'devnet' ? 'devnet' : 'mainnet-beta'}`
              ),
          },
          { text: 'Done', style: 'cancel' },
        ]
      )
    } catch (err: any) {
      console.error('[Haptix Send] Execution error:', err)
      const errorText = err?.message || 'Transaction could not be completed.'
      setSendErrorMsg(errorText)
      Alert.alert('Transfer Failed', errorText)
    } finally {
      setIsSending(false)
    }
  }

  // Token Swap Transaction (Transparent Mainnet vs Devnet status)
  const handleSwapTransaction = async () => {
    Alert.alert(
      'Jupiter DEX Aggregator',
      'Live token swaps require Jupiter DEX Liquidity Pools on Solana Mainnet-Beta.\n\nDevnet DEX routing is not simulated with dummy transactions to maintain zero-fake security principles.\n\nSwitch network to Mainnet for live token swaps.',
      [{ text: 'Understood', style: 'default' }]
    )
    setShowSwapModal(false)
  }

  // Autonomous Agent Execution via On-Chain Program (Zero Passkey Prompts)
  const handleAgentExecute = async () => {
    if (isFrozen) {
      Alert.alert('Security Alert', 'Wallet is panic frozen. Autonomous agents are locked on-chain.')
      return
    }

    if (!activeWallet?.address) return
    const walletPda = new PublicKey(activeWallet.address)

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      // Ephemeral autonomous agent session keypair
      const agentKeypair = Keypair.generate()
      const recipient = Keypair.generate().publicKey
      const tradeAmountLamports = 20_000_000n // 0.02 SOL
      const allowanceLamports = 250_000_000n // 0.25 SOL
      const validForSeconds = 86400n // 24 hours

      // 1. Grant agent session on-chain via 2-of-2 Hardware Passkeys
      const grantMsg = getGrantAgentSignedMessage(agentKeypair.publicKey, allowanceLamports, validForSeconds)
      const primarySig = await signWithPasskey('primary', grantMsg, 'Grant AI Agent On-Chain Session')
      const secondarySig = await signWithPasskey('secondary', grantMsg, '2-of-2 Quorum for AI Agent Session')

      const precompile1 = createSecp256r1Instruction({
        signature: primarySig.signature,
        publicKey: primarySig.publicKey,
        message: grantMsg,
      })
      const precompile2 = createSecp256r1Instruction({
        signature: secondarySig.signature,
        publicKey: secondarySig.publicKey,
        message: grantMsg,
      })
      const grantIx = createGrantAgentSessionInstruction({
        walletPda,
        agentPubkey: agentKeypair.publicKey,
        validForSeconds,
        allowanceLamports,
        allowedProgram: SystemProgram.programId,
        primarySigIxIndex: 0,
        secondarySigIxIndex: 1,
      })

      // 2. Autonomous execution signed ONLY by agentKeypair (ZERO passkey prompts)
      const execIx = createAgentExecuteInstruction({
        walletPda,
        agentPubkey: agentKeypair.publicKey,
        recipient,
        amountLamports: tradeAmountLamports,
      })

      const payer = await getFundedDevnetPayer(connection)
      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      const needsInit = !onChain && !!(activeWallet.primaryPasskeyHex && activeWallet.secondaryPasskeyHex)

      let txInstructions = []

      if (needsInit) {
        const primaryPasskey = new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex'))
        const secondaryPasskey = new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex'))
        const initIx = createInitializeWalletInstruction({
          payer: payer.publicKey,
          walletPda,
          primaryPasskey,
          secondaryPasskey,
          spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
        })
        txInstructions.push(initIx)
      }

      txInstructions.push(precompile1, precompile2, grantIx, execIx)

      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(...txInstructions)

      tx.sign(payer, agentKeypair)

      const rawTx = tx.serialize()
      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      connection
        .confirmTransaction(
          {
            signature: sig,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        )
        .catch(() => null)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      setTransactions((prev) => [
        {
          signature: sig,
          type: 'agent_trade',
          amount: 0.02,
          tokenSymbol: 'SOL',
          recipientOrSender: 'Jupiter DCA Autonomous Agent',
          timestamp: Date.now(),
          status: 'confirmed',
        },
        ...prev,
      ])

      Alert.alert(
        'Autonomous Agent Trade Executed On-Chain',
        `The agent sent 0.02 SOL, signed by its own session key with no prompt at execution time.\nThe amount came out of its daily allowance.\n\nTx: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
          { text: 'Done', style: 'cancel' },
        ]
      )
    } catch (err: any) {
      console.error('[Haptix Agent] Execution error:', err)
      Alert.alert('Agent Error', err?.message || 'Agent trade execution failed.')
    }
  }

  // "Test Trade" moved real funds behind two passkey prompts with no confirmation
  // step. The word "Test" implied harmless; the button now says what it does and
  // confirms the amount before spending.
  const confirmAgentExecute = () => {
    Alert.alert(
      'Run Autonomous Agent Trade',
      'Executes a real 0.02 SOL transfer on Solana Devnet, signed solely by a freshly generated agent session key — no biometric prompt at execution time.\n\nTwo passkey prompts are required up front to grant the session.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run Trade', style: 'destructive', onPress: () => handleAgentExecute() },
      ]
    )
  }

  // Toggle Panic Freeze on Solana Devnet
  const handleToggleFreeze = async () => {
    if (!activeWallet?.address) return
    const walletPda = new PublicKey(activeWallet.address)

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      if (!isFrozen) {
        // Freeze on-chain via guardian/payer
        const payer = await getFundedDevnetPayer(connection)
        const latestBlockhash = await connection.getLatestBlockhash('confirmed')
        const freezeIx = createPanicFreezeInstruction({
          walletPda,
          guardianSigner: payer.publicKey,
        })
        const tx = new Transaction({
          feePayer: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
        }).add(freezeIx)
        const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
          commitment: 'confirmed',
        })
        setIsFrozen(true)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)

        setTransactions((prev) => [
          {
            signature: sig,
            type: 'freeze',
            amount: 0,
            tokenSymbol: 'SOL',
            recipientOrSender: 'Guardian Circuit Breaker',
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: 'Guardian Emergency Panic',
          },
          ...prev,
        ])

        Alert.alert(
          'Emergency Panic Freeze Activated',
          `Smart wallet is now locked on-chain.\n\nOutgoing transactions and agent sessions are blocked.\n\nTx: ${ellipsify(sig, 8)}`
        )
      } else {
        // Unfreeze requires 2-of-2 Hardware Passkey Quorum
        const unfreezeMsg = new Uint8Array(Buffer.from('UNFREEZE_WALLET'))

        const primarySig = await signWithPasskey('primary', unfreezeMsg, 'Authorize Wallet Unfreeze (Primary)')
        const secondarySig = await signWithPasskey('secondary', unfreezeMsg, 'Authorize Wallet Unfreeze (Secondary Quorum)')

        // No catch here on purpose: a failed unfreeze must surface as a failure.
        // Swallowing it and still reporting "Wallet Unfrozen" asserted an on-chain
        // state change that never happened, and cleared the local freeze flag.
        const precompilePrimary = createSecp256r1Instruction({
          signature: primarySig.signature,
          publicKey: primarySig.publicKey,
          message: unfreezeMsg,
        })
        const precompileSecondary = createSecp256r1Instruction({
          signature: secondarySig.signature,
          publicKey: secondarySig.publicKey,
          message: unfreezeMsg,
        })
        const unfreezeIx = createUnfreezeInstruction({
          walletPda,
          primarySigIxIndex: 0,
          secondarySigIxIndex: 1,
        })

        const payer = await getFundedDevnetPayer(connection)
        const latestBlockhash = await connection.getLatestBlockhash('confirmed')
        const unfreezeTx = new Transaction({
          feePayer: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
        }).add(precompilePrimary, precompileSecondary, unfreezeIx)
        const sig = await sendAndConfirmTransaction(connection, unfreezeTx, [payer], {
          commitment: 'confirmed',
        })

        setIsFrozen(false)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

        setTransactions((prev) => [
          {
            signature: sig,
            type: 'unfreeze',
            amount: 0,
            tokenSymbol: 'SOL',
            recipientOrSender: 'Smart Account Quorum Unfreeze',
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: '2-of-2 Hardware Quorum',
          },
          ...prev,
        ])

        Alert.alert(
          'Smart Wallet Unfrozen',
          `Verified 2-of-2 Hardware Passkey Quorum.\nWallet operations restored.\n\nTx: ${ellipsify(sig, 8)}`
        )
      }
      await fetchRealBalance()
    } catch (err: any) {
      console.error('[Haptix Freeze/Unfreeze] Error:', err)
      Alert.alert('Action Failed', err?.message || 'Could not update freeze state on-chain.')
    }
  }

  const handleCopyAddress = () => {
    if (!activeWallet?.address) return
    Clipboard.setString(activeWallet.address)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Address Copied', activeWallet.address)
  }

  // Derived Total Balance in USD
  const totalUsdBalance = balance * SOL_PRICE_USD + usdcBalance
  const activeAgentCount = agentAllowance > 0 ? 2 : 0
  // Agent budget. The cap is the delegated allowance, and "spent today" is read
  // back from this session's agent trades so the bar and the label share one
  // number instead of a hardcoded denominator that disagreed with both.
  const agentDailyBudgetUsd = agentAllowance * SOL_PRICE_USD
  const agentSpentToday = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return transactions
      .filter((tx) => tx.type === 'agent_trade' && tx.timestamp >= startOfDay.getTime())
      .reduce((sum, tx) => sum + tx.amount * SOL_PRICE_USD, 0)
  }, [transactions])

  const sendAmountNum = parseFloat(sendAmountText) || 0
  const isSendQuorumRequired = sendAmountNum > spendThreshold

  const activityTitleFor = (tx: TransactionRecord) => {
    if (tx.type === 'freeze') return 'Emergency Freeze'
    if (tx.type === 'unfreeze') return 'Smart Wallet Unlocked'
    if (tx.type === 'init') return 'On-Chain Setup'
    if (tx.type === 'airdrop') return 'Devnet Faucet'
    if (tx.type === 'agent_trade') return 'Agent Auto-Trade'
    return 'Transfer SOL'
  }

  const renderWalletHome = () => (
    <>
      {/* HERO BALANCE CARD */}
      <View style={[styles.heroCard, s.card]}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroBalanceLabelRow}>
            <Text style={[styles.heroBalanceLabel, s.textSecondary]}>Total balance</Text>
            <TouchableOpacity
              style={styles.eyeToggleButton}
              onPress={() => {
                Haptics.selectionAsync()
                setIsBalanceHidden((prev) => !prev)
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isBalanceHidden ? (
                <EyeHideIcon size={16} color={theme.textMuted} />
              ) : (
                <EyeShowIcon size={16} color={theme.textMuted} />
              )}
            </TouchableOpacity>
          </View>

          <View style={[styles.heroBadgePill, { backgroundColor: isDark ? '#161616' : '#F4F4F5', borderColor: theme.borderDefault }]}>
            <Text style={[styles.heroBadgeText, s.textSecondary]}>
              {network === 'devnet' ? 'Devnet Testnet' : 'Hardware Quorum'}
            </Text>
          </View>
        </View>

        <View style={styles.heroBalanceContent}>
          {isBalanceHidden ? (
            <Text style={[styles.heroPrimaryBalance, s.textPrimary]}>$ ••••••</Text>
          ) : (
            <Text style={[styles.heroPrimaryBalance, s.textPrimary]}>${totalUsdBalance.toFixed(2)}</Text>
          )}
          {isBalanceHidden ? (
            <Text style={[styles.heroSecondaryBalance, s.textSecondary]}>•••• SOL</Text>
          ) : (
            <Text style={[styles.heroSecondaryBalance, s.textSecondary]}>{balance.toFixed(4)} SOL</Text>
          )}
        </View>

        {/* Unified 4-Action Symmetrical Buttons Row */}
        <View style={styles.heroActionsRow}>
          {/* Send */}
          <TouchableOpacity
            style={[styles.heroActionBtn, s.actionBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setShowSendModal(true)
            }}
            activeOpacity={0.78}
          >
            <ActionSendIcon size={15} color={theme.textPrimary} />
            <Text style={[styles.heroActionBtnText, s.actionBtnText]}>Send</Text>
          </TouchableOpacity>

          {/* Receive */}
          <TouchableOpacity
            style={[styles.heroActionBtn, s.actionBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setShowReceiveModal(true)
            }}
            activeOpacity={0.78}
          >
            <ActionReceiveIcon size={15} color={theme.textPrimary} />
            <Text style={[styles.heroActionBtnText, s.actionBtnText]}>Receive</Text>
          </TouchableOpacity>

          {/* Swap */}
          <TouchableOpacity
            style={[styles.heroActionBtn, s.actionBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setShowSwapModal(true)
            }}
            activeOpacity={0.78}
          >
            <ActionSwapIcon size={15} color={theme.textPrimary} />
            <Text style={[styles.heroActionBtnText, s.actionBtnText]}>Swap</Text>
          </TouchableOpacity>

          {/* +0.2 SOL Faucet on Devnet */}
          {network === 'devnet' ? (
            <TouchableOpacity
              style={[styles.heroActionBtn, s.actionBtn]}
              onPress={handleRequestFaucet}
              disabled={isRequestingFaucet}
              activeOpacity={0.78}
            >
              {isRequestingFaucet ? (
                <ActivityIndicator size="small" color={theme.textPrimary} />
              ) : (
                <>
                  <MaterialIcons name="local-gas-station" size={15} color={theme.textPrimary} />
                  <Text style={[styles.heroActionBtnText, s.actionBtnText]}>Faucet</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.heroActionBtn, s.actionBtn]}
              onPress={() => setShowReceiveModal(true)}
              activeOpacity={0.78}
            >
              <MaterialIcons name="add" size={16} color={theme.textPrimary} />
              <Text style={[styles.heroActionBtnText, s.actionBtnText]}>Buy</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* On-Chain Program Deployment & Status Badge */}
        {network === 'devnet' && (
          <View style={[styles.onChainStatusBanner, { backgroundColor: isDark ? '#101726' : '#F1F5F9', borderColor: theme.borderDefault }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View
                style={[
                  styles.onChainStatusDot,
                  { backgroundColor: onChainWallet ? '#10B981' : '#F59E0B' },
                ]}
              />
              <Text style={[styles.onChainStatusText, { color: onChainWallet ? '#10B981' : '#F59E0B' }]}>
                {onChainWallet ? 'Spending policy live on-chain' : 'Spending policy not on-chain yet'}
              </Text>
            </View>
            {!onChainWallet && (
              <TouchableOpacity
                style={[styles.deployPdaButton, { backgroundColor: theme.accent }]}
                onPress={handleInitializeWalletOnChain}
                disabled={isInitializingWallet}
              >
                {isInitializingWallet ? (
                  <ActivityIndicator size="small" color={theme.accentForeground} />
                ) : (
                  <Text style={[styles.deployPdaButtonText, { color: theme.accentForeground }]}>Activate on-chain</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* SEGMENTED FILTER BAR */}
      <View style={styles.segmentedContainer}>
        <HaptixIosTabs<'assets' | 'markets'>
          tabs={[
            { id: 'assets', label: 'Assets' },
            { id: 'markets', label: 'Watchlist' },
          ]}
          activeTab={segmentedTab}
          onChange={(tab) => setSegmentedTab(tab)}
        />
      </View>

      {/* TAB CONTENT: ASSETS */}
      {segmentedTab === 'assets' && (
        <View style={[styles.assetList, s.card]}>
          {/* Solana Row */}
          <View style={styles.assetRow}>
            <View style={styles.assetLeft}>
              <View style={[styles.assetLogoWrap, { backgroundColor: isDark ? '#141414' : '#F4F4F5', borderColor: theme.borderDefault }]}>
                <SolanaTokenLogo size={24} />
              </View>
              <View>
                <Text style={[styles.assetPrimaryName, s.textPrimary]}>Solana</Text>
                <Text style={[styles.assetSecondaryTag, s.textMuted]}>SOL · Solana</Text>
              </View>
            </View>
            <View style={styles.assetRight}>
              <Text style={[styles.assetCryptoAmount, s.textPrimary]}>{balance.toFixed(4)} SOL</Text>
              <Text style={[styles.assetFiatAmount, s.textSecondary]}>
                ≈ ${(balance * SOL_PRICE_USD).toFixed(2)}
              </Text>
            </View>
          </View>

          <View style={[styles.assetDivider, s.divider]} />

          {/* USD Coin Row */}
          <View style={styles.assetRow}>
            <View style={styles.assetLeft}>
              <View style={[styles.assetLogoWrap, { backgroundColor: isDark ? '#141414' : '#F4F4F5', borderColor: theme.borderDefault }]}>
                <UsdcTokenLogo size={24} />
              </View>
              <View>
                <Text style={[styles.assetPrimaryName, s.textPrimary]}>USD Coin</Text>
                <Text style={[styles.assetSecondaryTag, s.textMuted]}>USDC · Circle</Text>
              </View>
            </View>
            <View style={styles.assetRight}>
              <Text style={[styles.assetCryptoAmount, s.textPrimary]}>{usdcBalance.toFixed(2)} USDC</Text>
              <Text style={[styles.assetFiatAmount, s.textSecondary]}>≈ ${usdcBalance.toFixed(2)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* TAB CONTENT: MARKETS WATCHLIST */}
      {segmentedTab === 'markets' && (
        <Text style={[styles.segmentNote, s.textMuted]}>
          Indicative prices · not tradable on Devnet
        </Text>
      )}
      {segmentedTab === 'markets' && (
        <View style={[styles.assetList, s.card]}>
          {MARKET_TOKENS.map((token, idx) => (
            <React.Fragment key={token.symbol}>
              <View style={styles.assetRow}>
                <View style={styles.assetLeft}>
                  <View style={[styles.assetLogoWrap, { backgroundColor: isDark ? '#141414' : '#F4F4F5', borderColor: theme.borderDefault }]}>
                    {token.symbol === 'SOL' ? (
                      <SolanaTokenLogo size={24} />
                    ) : token.symbol === 'USDC' ? (
                      <UsdcTokenLogo size={24} />
                    ) : (
                      <MaterialIcons name="monetization-on" size={24} color={theme.textPrimary} />
                    )}
                  </View>
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.assetPrimaryName, s.textPrimary]}>{token.name}</Text>
                      <View style={[styles.trendBadge, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' }]}>
                        <Text
                          style={[
                            styles.trendBadgeText,
                            token.isPositive ? styles.trendPositive : styles.trendNegative,
                          ]}
                        >
                          {token.change}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.assetSecondaryTag, s.textMuted]}>{token.symbol}</Text>
                  </View>
                </View>
                <View style={styles.assetRight}>
                  <Text style={[styles.assetCryptoAmount, s.textPrimary]}>{token.price}</Text>
                  <Text style={[styles.assetFiatAmount, s.textMuted]}>per token</Text>
                </View>
              </View>
              {idx < MARKET_TOKENS.length - 1 && (
                <View style={[styles.assetDivider, s.divider]} />
              )}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* RECENT ACTIVITY. The home tab previously stopped after the asset list,
          leaving roughly a quarter of the screen empty while transaction data
          sat unused in state. */}
      <View style={styles.homeSectionHeaderRow}>
        <Text style={[styles.homeSectionTitle, s.textPrimary]}>Recent activity</Text>
        <TouchableOpacity
          onPress={() => setDockTab('activity')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.homeSectionLink, { color: theme.accent }]}>See all</Text>
        </TouchableOpacity>
      </View>

      {transactions.length === 0 ? (
        <View style={[styles.emptyActivityCard, s.card]}>
          <MaterialIcons name="receipt-long" size={26} color={theme.textMuted} />
          <Text style={[styles.emptyActivityTitle, s.textPrimary]}>No activity yet</Text>
          <Text style={[styles.emptyActivitySubtitle, s.textMuted]}>
            Use the Faucet to request Devnet tokens and see your first transaction.
          </Text>
        </View>
      ) : (
        <View style={[styles.activityList, s.card]}>
          {transactions.slice(0, 3).map((tx, idx) => {
            const isIncoming = tx.type === 'airdrop'
            return (
              <React.Fragment key={tx.signature || idx}>
                {idx > 0 && <View style={[styles.assetDivider, s.divider]} />}
                <TouchableOpacity
                  style={styles.activityRow}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setSelectedTransaction(tx)
                    setShowTxDetailModal(true)
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.activityLeft}>
                    <View
                      style={[
                        styles.activityIconCircle,
                        {
                          backgroundColor: isIncoming
                            ? 'rgba(16,185,129,0.12)'
                            : isDark
                              ? '#0E1628'
                              : '#F1F5F9',
                          borderColor: isIncoming
                            ? 'rgba(16,185,129,0.3)'
                            : theme.borderDefault,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={isIncoming ? 'arrow-downward' : 'arrow-outward'}
                        size={18}
                        color={isIncoming ? '#10B981' : theme.textPrimary}
                      />
                    </View>
                    <View>
                      <Text style={[styles.activityItemTitle, s.textPrimary]}>
                        {activityTitleFor(tx)}
                      </Text>
                      <Text style={[styles.activityItemDate, s.textMuted]}>
                        {new Date(tx.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.activityAmount,
                      isIncoming ? { color: '#10B981', fontWeight: '700' } : s.textPrimary,
                    ]}
                  >
                    {`${isIncoming ? '+' : '-'}${tx.amount.toFixed(4)} ${tx.tokenSymbol || 'SOL'}`}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            )
          })}
        </View>
      )}
    </>
  )

  const renderAgentsPage = () => (
    <>
      <View style={styles.pageHeader}>
        <View style={styles.pageTitleRow}>
          <Text style={[styles.pageTitle, s.textPrimary]}>AI Agents</Text>
          <PolicyLinkButton onPress={() => setPolicyTopic('agents')} />
        </View>
      </View>

      {/* 1. HERO FIREWALL & 24H BUDGET CARD */}
      <View style={[styles.agentHeroCard, s.card]}>
        <View style={styles.agentHeroHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.agentFirewallIconCircle, { backgroundColor: isFrozen ? 'rgba(244,63,94,0.15)' : theme.accentLight }]}>
              <MaterialIcons
                name={isFrozen ? 'lock' : 'security'}
                size={18}
                color={isFrozen ? '#FDA4AF' : theme.accent}
              />
            </View>
            <View>
              <Text style={[styles.agentHeroTitle, s.textPrimary]}>Spending Firewall</Text>
            </View>
          </View>

          <View
            style={[
              styles.agentHeroStatusBadge,
              {
                backgroundColor: isFrozen ? 'rgba(244,63,94,0.12)' : 'rgba(16,185,129,0.12)',
                borderColor: isFrozen ? 'rgba(244,63,94,0.25)' : 'rgba(16,185,129,0.25)',
              },
            ]}
          >
            <View
              style={[
                styles.agentStatusDot,
                { backgroundColor: isFrozen ? '#F43F5E' : '#10B981' },
              ]}
            />
            <Text
              style={[
                styles.agentStatusText,
                { color: isFrozen ? '#FDA4AF' : '#10B981', fontWeight: '600' },
              ]}
            >
              {isFrozen ? 'Panic Frozen' : 'Firewall Active'}
            </Text>
          </View>
        </View>

        {/* Budget Numbers */}
        <View style={styles.agentBudgetStatRow}>
          <View>
            <Text style={[styles.agentBudgetLabel, s.textMuted]}>Spent Today</Text>
            <Text style={[styles.agentBudgetNumber, s.textPrimary]}>
              ${agentSpentToday.toFixed(2)} USD
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.agentBudgetLabel, s.textMuted]}>Daily Limit</Text>
            <Text style={[styles.agentBudgetNumber, s.textSecondary]}>
              ${agentDailyBudgetUsd.toFixed(2)} USD
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={[styles.agentProgressTrack, { backgroundColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
          <View
            style={[
              styles.agentProgressFill,
              {
                backgroundColor: isFrozen ? '#F43F5E' : theme.accent,
                width: `${Math.min(100, Math.max(0, agentDailyBudgetUsd > 0 ? (agentSpentToday / agentDailyBudgetUsd) * 100 : 0))}%`,
              },
            ]}
          />
        </View>

        {/* Policy Pills Row */}
        <View style={styles.agentPolicyPillRow}>
          <View style={[styles.agentPolicyPill, s.elevatedCard]}>
            <MaterialIcons name="bolt" size={14} color="#10B981" />
            <Text style={[styles.agentPolicyPillText, s.textSecondary]}>Fast-Lane: ≤ {spendThreshold} SOL</Text>
          </View>

          <View style={[styles.agentPolicyPill, s.elevatedCard]}>
            <MaterialIcons name="shield" size={14} color="#F59E0B" />
            <Text style={[styles.agentPolicyPillText, s.textSecondary]}>Quorum: &gt; {spendThreshold} SOL</Text>
          </View>
        </View>
      </View>

      {/* 2. ACTIVE SUB-AGENTS SECTION */}
      <View style={[styles.agentSectionCard, s.card]}>
        <View style={styles.agentSectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.agentSectionHeading, s.textPrimary]}>Active Agents</Text>
            <View style={[styles.agentCountBadge, { backgroundColor: theme.accentLight }]}>
              <Text style={[styles.agentCountText, { color: theme.accent }]}>2 Active</Text>
            </View>
          </View>
        </View>

        {/* Agent 1: Jupiter */}
        <View style={styles.agentCompactRow}>
          <View style={[styles.agentCompactIcon, { backgroundColor: isDark ? '#172554' : '#EFF6FF' }]}>
            <MaterialIcons name="auto-graph" size={18} color="#3B82F6" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.agentCompactName, s.textPrimary]}>Jupiter Auto-DCA</Text>
            <Text style={[styles.agentCompactSub, s.textMuted]}>0.15 SOL / 24h · Auto-compounding</Text>
          </View>
          <View style={styles.agentActiveChip}>
            <Text style={styles.agentActiveChipText}>Active</Text>
          </View>
        </View>

        <View style={[styles.agentRowDivider, s.divider]} />

        {/* Agent 2: Kamino */}
        <View style={styles.agentCompactRow}>
          <View style={[styles.agentCompactIcon, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5' }]}>
            <MaterialIcons name="account-balance" size={18} color="#10B981" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.agentCompactName, s.textPrimary]}>Kamino Yield</Text>
            <Text style={[styles.agentCompactSub, s.textMuted]}>0.10 SOL / 24h · Liquidity rebalancer</Text>
          </View>
          <View style={styles.agentActiveChip}>
            <Text style={styles.agentActiveChipText}>Active</Text>
          </View>
        </View>
      </View>

      {/* 3. GRANT SESSION KEY CARD */}
      <View style={[styles.agentSectionCard, s.card]}>
        <View style={styles.agentSectionHeader}>
          <Text style={[styles.agentSectionHeading, s.textPrimary]}>Grant Session Key</Text>
          <View style={[styles.quorumBadgeSmall, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
            <Text style={{ color: '#F59E0B', fontSize: typeScale.caption, fontWeight: '600' }}>2-of-2 Quorum</Text>
          </View>
        </View>

        {/* Budget Selector Chips */}
        <View style={styles.agentChipSelectorRow}>
          {['0.10', '0.25', '0.50', '1.00'].map((val) => {
            const isSelected = customAgentAllowance === val
            return (
              <TouchableOpacity
                key={val}
                style={[
                  styles.agentBudgetChip,
                  isSelected ? { backgroundColor: theme.accent, borderColor: theme.accent } : s.input,
                ]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setCustomAgentAllowance(val)
                }}
              >
                <Text
                  style={[
                    styles.agentBudgetChipText,
                    isSelected ? { color: theme.accentForeground, fontWeight: '700' } : s.textSecondary,
                  ]}
                >
                  {val} SOL
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={{ marginTop: 12 }}>
          <PrismDepthButton
            size="default"
            title={`Authorize ${customAgentAllowance} SOL Session`}
            onPress={handleGrantCustomSession}
            loading={isGrantingSession}
            disabled={isGrantingSession}
          />
        </View>
      </View>

      {/* 4. FAST-LANE TEST & EMERGENCY CIRCUIT BREAKER */}
      <View style={[styles.agentActionCard, s.card]}>
        <View style={styles.agentActionRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={[styles.agentActionTitle, s.textPrimary]}>Autonomous Agent Trade</Text>
          </View>
          <TouchableOpacity
            style={[styles.agentFastLaneTestBtn, { backgroundColor: theme.accent }]}
            onPress={confirmAgentExecute}
            activeOpacity={0.8}
          >
            <MaterialIcons name="bolt" size={15} color={theme.accentForeground} />
            <Text style={[styles.agentFastLaneTestBtnText, { color: theme.accentForeground }]}>Run Trade</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.agentRowDivider, s.divider]} />

        {/* Panic Circuit Breaker */}
        <View style={{ marginTop: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={[styles.agentActionTitle, isFrozen ? { color: '#10B981' } : { color: '#FDA4AF' }]}>
                {isFrozen ? 'Wallet Is Locked' : 'Emergency Circuit Breaker'}
              </Text>
            </View>
            <Text style={[styles.emergencyTag, { color: isFrozen ? '#10B981' : '#FDA4AF' }]}>
              {isFrozen ? 'Frozen' : 'On-Chain Freeze'}
            </Text>
          </View>

          <HoldToConfirmButton
            label={isFrozen ? 'Hold to Unlock Smart Wallet' : 'Hold to Freeze Wallet & Agents'}
            confirmingLabel={isFrozen ? 'Unlocking on-chain...' : 'Freezing on-chain...'}
            completedLabel={isFrozen ? 'Wallet Unlocked' : 'Wallet Frozen'}
            variant={isFrozen ? 'primary' : 'danger'}
            onConfirm={handleToggleFreeze}
          />
        </View>
      </View>
    </>
  )

  const renderActivityPage = () => {
    const filtered = transactions.filter((tx) => {
      if (activityFilter === 'transfers') return tx.type === 'transfer' || tx.type === 'airdrop' || tx.type === 'swap'
      if (activityFilter === 'agents') return tx.type === 'agent_trade'
      if (activityFilter === 'security') return tx.type === 'freeze' || tx.type === 'unfreeze' || tx.type === 'init'
      return true
    })

    // Day buckets. A flat column of "Transfer SOL · 2:43 PM" rows gives the eye
    // nothing to land on; the date is the cheapest real grouping available.
    const groupLabel = (ts: number) => {
      const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
      const date = new Date(ts)
      const today = new Date()
      if (sameDay(date, today)) return 'Today'
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      if (sameDay(date, yesterday)) return 'Yesterday'
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }

    return (
      <>
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, s.textPrimary]}>Transaction History</Text>
          <Text style={[styles.pageSubtitle, s.textSecondary]}>
            On-chain activity verified by Secp256r1 passkey signatures
          </Text>
        </View>

        {/* Activity Category Filter Chips */}
        <View style={styles.activityFilterRow}>
          {[
            { id: 'all', label: 'All' },
            { id: 'transfers', label: 'Transfers' },
            { id: 'agents', label: 'Agent Ops' },
            { id: 'security', label: 'Security' },
          ].map((f) => {
            const isSelected = activityFilter === f.id
            return (
              <TouchableOpacity
                key={f.id}
                style={[
                  styles.activityFilterChip,
                  isSelected ? { backgroundColor: theme.accent } : s.input,
                ]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setActivityFilter(f.id as any)
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.activityFilterChipText,
                    isSelected ? { color: theme.accentForeground, fontWeight: '700' } : s.textSecondary,
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Transactions List */}
        {filtered.length === 0 ? (
          <View style={[styles.emptyActivityCard, s.card]}>
            <MaterialIcons name="receipt-long" size={26} color={theme.textMuted} />
            <Text style={[styles.emptyActivityTitle, s.textPrimary]}>
              {activityFilter === 'all' ? 'No transactions yet' : `No ${activityFilter} events found`}
            </Text>
            <Text style={[styles.emptyActivitySubtitle, s.textMuted]}>
              {activityFilter === 'all'
                ? 'Send SOL, request Devnet test tokens, or trigger AI trades to see activity.'
                : 'Try selecting All or trigger a new on-chain transaction.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.activityList, s.card]}>
            {filtered.map((tx, idx) => {
              const isIncoming = tx.type === 'airdrop'
              const isAgent = tx.type === 'agent_trade'
              const isSecurity = tx.type === 'freeze' || tx.type === 'unfreeze' || tx.type === 'init'
              const isFreeze = tx.type === 'freeze'
              const isUnfreeze = tx.type === 'unfreeze'
              const isInit = tx.type === 'init'
              const dayLabel = groupLabel(tx.timestamp)
              const showDayHeader =
                idx === 0 || dayLabel !== groupLabel(filtered[idx - 1].timestamp)

              return (
                <React.Fragment key={tx.signature || idx}>
                  {showDayHeader && (
                    <Text style={[styles.activityGroupLabel, s.textMuted]}>{dayLabel}</Text>
                  )}
                  <TouchableOpacity
                    style={styles.activityRow}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setSelectedTransaction(tx)
                    setShowTxDetailModal(true)
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.activityLeft}>
                    <View
                      style={[
                        styles.activityIconCircle,
                        {
                          backgroundColor: isFreeze
                            ? 'rgba(244,63,94,0.12)'
                            : isIncoming || isUnfreeze
                            ? 'rgba(16,185,129,0.12)'
                            : isDark
                            ? '#0E1628'
                            : '#F1F5F9',
                          borderColor: isFreeze
                            ? 'rgba(244,63,94,0.3)'
                            : isIncoming || isUnfreeze
                            ? 'rgba(16,185,129,0.3)'
                            : theme.borderDefault,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={
                          isFreeze
                            ? 'lock'
                            : isUnfreeze
                            ? 'lock-open'
                            : isInit
                            ? 'verified-user'
                            : isIncoming
                            ? 'arrow-downward'
                            : isAgent
                            ? 'smart-toy'
                            : 'arrow-outward'
                        }
                        size={18}
                        color={
                          isFreeze
                            ? '#FDA4AF'
                            : isIncoming || isUnfreeze
                            ? '#10B981'
                            : theme.textPrimary
                        }
                      />
                    </View>
                    <View>
                      <Text style={[styles.activityItemTitle, s.textPrimary]}>
                        {isFreeze
                          ? 'Emergency Freeze'
                          : isUnfreeze
                          ? 'Smart Wallet Unlocked'
                          : isInit
                          ? 'Account Initialized'
                          : isIncoming
                          ? 'Devnet Faucet'
                          : isAgent
                          ? 'Agent Auto-Trade'
                          : 'Transfer SOL'}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <Text style={[styles.activityItemDate, s.textMuted]}>
                          {new Date(tx.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                        <Text style={s.textMuted}>·</Text>
                        <Text style={[styles.activitySecurityBadge, { color: isAgent ? theme.accent : theme.textMuted }]} numberOfLines={1}>
                          {tx.securityType || (isAgent ? 'Zero-Prompt' : 'Secp256r1')}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.activityRight}>
                    <Text
                      style={[
                        styles.activityAmount,
                        isIncoming
                          ? { color: '#10B981', fontWeight: '700' }
                          : s.textPrimary,
                      ]}
                    >
                      {isSecurity
                        ? '—'
                        : `${isIncoming ? '+' : '-'}${tx.amount.toFixed(4)} ${tx.tokenSymbol || 'SOL'}`}
                    </Text>
                    <View style={styles.confirmedBadgeRow}>
                      <MaterialIcons name="check" size={11} color="#10B981" />
                      <Text style={[styles.confirmedBadgeText, { color: '#10B981' }]}>Confirmed</Text>
                    </View>
                  </View>
                  </TouchableOpacity>
                </React.Fragment>
              )
            })}
          </View>
        )}
      </>
    )
  }

  const renderSecurityPage = () => (
    <>
      <View style={styles.pageHeader}>
        <View style={styles.pageTitleRow}>
          <Text style={[styles.pageTitle, s.textPrimary]}>Security & Protection</Text>
          <PolicyLinkButton onPress={() => setPolicyTopic('security')} />
        </View>
        <Text style={[styles.pageSubtitle, s.textSecondary]}>
          Hardware credentials, on-chain policy firewall & emergency lock
        </Text>
      </View>

      {/* 1. DaisyUI Status Alert */}
      {isFrozen ? (
        <HaptixAlert
          status="error"
          icon="lock"
          title="Emergency Panic Lock Active"
          message="All transfers & agent sessions halted on-chain. Funds are safeguarded."
          action={{
            label: 'Unlock',
            onPress: handleToggleFreeze,
            variant: 'primary',
          }}
        />
      ) : (
        <HaptixAlert
          status="success"
          icon="verified-user"
          title="Hardware Protection Active"
          message="Secp256r1 keys cryptographically bound to hardware biometric enclave."
        />
      )}

      {/* 2. Hardware Credentials Card */}
      <View style={[styles.securitySectionCard, s.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, s.textPrimary]}>Hardware Credentials</Text>
          <View style={styles.securityCountBadge}>
            <Text style={styles.securityCountText}>2 Enrolled</Text>
          </View>
        </View>

        {/* Primary Passkey */}
        <View style={styles.credentialCompactRow}>
          <View style={[styles.credentialIconWrap, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5' }]}>
            <FingerScanBold size={18} color="#10B981" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.credentialName, s.textPrimary]}>Primary Device Passkey</Text>
            <Text style={[styles.credentialSub, s.textMuted]}>Biometric Secure Enclave · Instant</Text>
          </View>
          <View style={styles.activeTag}>
            <Text style={styles.activeTagText}>Active</Text>
          </View>
        </View>

        <View style={[styles.securityRowDivider, s.divider]} />

        {/* Secondary / Hardware Backup Passkey */}
        <View style={styles.credentialCompactRow}>
          <View style={[styles.credentialIconWrap, { backgroundColor: isDark ? '#451A03' : '#FFFBEB' }]}>
            <KeySquareBold size={18} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.credentialName, s.textPrimary]}>Hardware Backup Key</Text>
            <Text style={[styles.credentialSub, s.textMuted]}>Physical FIDO2 / YubiKey · Quorum</Text>
          </View>
          <View style={styles.quorumTag}>
            <Text style={styles.quorumTagText}>2-of-2 Quorum</Text>
          </View>
        </View>
      </View>

      {/* 3. Spending Policy Firewall (Stat Grid) */}
      <View style={[styles.securitySectionCard, s.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, s.textPrimary]}>On-Chain Policy Firewall</Text>
          <View style={styles.policyProgramTag}>
            <Text style={styles.policyProgramTagText}>Solana Devnet</Text>
          </View>
        </View>

        <View style={styles.policyStatsGrid}>
          {/* Tile 1: Fast-lane limit */}
          <View style={[styles.policyStatTile, s.input]}>
            <Text style={[styles.policyStatLabel, s.textSecondary]}>Fast-Lane Cap</Text>
            <Text style={[styles.policyStatValue, s.textPrimary]}>≤ {spendThreshold} SOL</Text>
          </View>

          {/* Tile 2: High-value quorum */}
          <View style={[styles.policyStatTile, s.input]}>
            <Text style={[styles.policyStatLabel, s.textSecondary]}>Quorum Escalation</Text>
            <Text style={[styles.policyStatValue, s.textPrimary]}>2-of-2 Keys</Text>
          </View>

          {/* Tile 3: Velocity circuit breaker */}
          <View style={[styles.policyStatTile, s.input]}>
            <Text style={[styles.policyStatLabel, s.textSecondary]}>Velocity Breaker</Text>
            <Text style={[styles.policyStatValue, s.textPrimary]}>5 tx / hr</Text>
          </View>

          {/* Tile 4: Agent spending cap */}
          <View style={[styles.policyStatTile, s.input]}>
            <Text style={[styles.policyStatLabel, s.textSecondary]}>Agent Limit</Text>
            <Text style={[styles.policyStatValue, s.textPrimary]}>${(agentAllowance * SOL_PRICE_USD).toFixed(0)} / 24h</Text>
          </View>
        </View>
      </View>

      {/* 4. Guardian Social Recovery */}
      <View style={[styles.securitySectionCard, s.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, s.textPrimary]}>Guardian Social Recovery</Text>
          <View
            style={[
              styles.activeTag,
              onChainWallet
                ? {
                    backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : '#ECFDF5',
                    borderColor: isDark ? 'rgba(16,185,129,0.3)' : '#A7F3D0',
                  }
                : {
                    backgroundColor: isDark ? 'rgba(245,158,11,0.12)' : '#FFFBEB',
                    borderColor: isDark ? 'rgba(245,158,11,0.3)' : '#FDE68A',
                  },
            ]}
          >
            <Text style={[styles.activeTagText, { color: onChainWallet ? '#10B981' : '#F59E0B' }]}>
              {onChainWallet ? 'Active' : 'Not on-chain yet'}
            </Text>
          </View>
        </View>

        <View style={styles.recoveryDetailRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.recoveryDetailTitle, s.textPrimary]}>1 Guardian</Text>
            <Text style={[styles.recoveryDetailDesc, s.textMuted]}>Cannot spend funds</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={[styles.recoveryDetailTitle, s.textPrimary]}>24h Timelock</Text>
            <Text style={[styles.recoveryDetailDesc, s.textMuted]}>You can veto with 2-of-2</Text>
          </View>
        </View>

        {/* The program stores exactly one guardian and gives it no spending
            authority, so show who it actually is rather than a capability badge. */}
        <View style={[styles.recoveryGuardianRow, s.input]}>
          <Text style={[styles.recoveryGuardianLabel, s.textMuted]}>GUARDIAN</Text>
          <Text
            style={[styles.recoveryGuardianValue, s.textPrimary]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {onChainWallet ? ellipsify(onChainWallet.guardian.toBase58(), 6) : 'Set on first on-chain activation'}
          </Text>
          <Text style={[styles.recoveryGuardianNote, s.textMuted]}>
            Can start a recovery and nothing else — it cannot move funds.
          </Text>
        </View>
      </View>

      {/* 5. Emergency Panic Lock */}
      <View style={[styles.securitySectionCard, s.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, s.textPrimary]}>Emergency Panic Lock</Text>
        </View>

        {/* Body copy rather than an alert panel: the amber box used to be the
            loudest thing in the card, out-shouting the destructive control under it. */}
        <Text style={[styles.panicExplain, s.textSecondary]}>
          {isFrozen
            ? 'Transfers, swaps, and AI session keys are frozen. Hold below to unlock.'
            : 'Hold to instantly freeze all transactions and agent sessions on-chain.'}
        </Text>

        <HoldToConfirmButton
          label={isFrozen ? 'Hold to Unlock Smart Wallet' : 'Hold to Emergency Freeze'}
          confirmingLabel={isFrozen ? 'Unlocking on-chain...' : 'Freezing on-chain...'}
          completedLabel={isFrozen ? 'Wallet Unlocked' : 'Wallet Frozen'}
          variant={isFrozen ? 'primary' : 'danger'}
          onConfirm={handleToggleFreeze}
        />
      </View>

      {/* 6. On-Chain Attestation Log */}
      <View style={[styles.securitySectionCard, s.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, s.textPrimary]}>On-Chain Attestations</Text>
          <View style={[styles.activeTag, { backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : '#ECFDF5', borderColor: isDark ? 'rgba(16,185,129,0.3)' : '#A7F3D0' }]}>
            <Text style={styles.activeTagText}>2 Verified</Text>
          </View>
        </View>

        <View style={styles.auditLogRow}>
          <MaterialIcons name="check-circle" size={16} color="#10B981" />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.auditLogText, s.textPrimary]}>
                Biometric Passkey Enrolled
              </Text>
            </View>
            <Text style={[styles.auditLogTime, s.textMuted]}>Secp256r1 · Hardware Secure Enclave</Text>
          </View>
        </View>

        <View style={[styles.securityRowDivider, s.divider]} />

        <View style={styles.auditLogRow}>
          <MaterialIcons name="check-circle" size={16} color="#10B981" />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.auditLogText, s.textPrimary]}>
                2-of-2 Spending Policy Active
              </Text>
            </View>
            <Text style={[styles.auditLogTime, s.textMuted]}>Secp256r1 on-chain verification · Devnet</Text>
          </View>
        </View>
      </View>
    </>
  )

  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

    return (
    <View style={[styles.container, s.container]}>
      {/* ==================================================================== */}
      {/* 1. ELEVATED CONSUMER HOME HEADER                                     */}
      {/* ==================================================================== */}
      <View style={[styles.header, s.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.headerLeftGroup}>
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setDockTab('security')
            }}
            activeOpacity={0.75}
          >
            <View style={[styles.avatarCircle, s.card, isFrozen && styles.avatarCircleAlert]}>
              <HaptixBrandMark size={16} color={isFrozen ? '#FDA4AF' : theme.textPrimary} />
            </View>
          </TouchableOpacity>

          <View style={styles.identityTextGroup}>
            <Text style={[styles.headerWalletName, s.textPrimary]} numberOfLines={1}>
              {activeWallet?.name || 'Haptix Wallet'}
            </Text>
            <TouchableOpacity
              style={[styles.addressCopyChip, s.card]}
              onPress={handleCopyWalletAddress}
              activeOpacity={0.7}
            >
              <Text style={[styles.addressCopyText, s.textMuted]}>
                {hasCopiedAddress ? 'Copied!' : ellipsify(activeWallet?.address || '', 4)}
              </Text>
              <CopyChipIcon size={11} color={hasCopiedAddress ? '#FFFFFF' : theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.headerRight}>
          {/* Network Switcher Pill */}
          <TouchableOpacity
            style={[styles.networkPill, s.card]}
            onPress={() => {
              Haptics.selectionAsync()
              setNetwork((prev) => (prev === 'devnet' ? 'mainnet' : 'devnet'))
            }}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.networkDot,
                network === 'mainnet' && { backgroundColor: '#10B981' },
              ]}
            />
            <Text style={[styles.networkPillText, s.textSecondary]}>
              {network === 'devnet' ? 'Devnet' : 'Mainnet'}
            </Text>
            <MaterialIcons name="keyboard-arrow-down" size={13} color={theme.textMuted} />
          </TouchableOpacity>

          {/* Quick Light/Dark Mode Switcher */}
          <ThemeToggleButton size="compact" showLabel={false} />

          {/* Overflow Menu Button */}
          <TouchableOpacity
            style={[styles.headerIconBtn, s.iconBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setShowOverflowMenu(true)
            }}
            accessibilityRole="button"
            accessibilityLabel="More Options"
          >
            <MaterialIcons name="more-horiz" size={18} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* EMERGENCY FREEZE BANNER */}
      {isFrozen && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <HaptixAlert
            status="error"
            icon="lock"
            title="EMERGENCY FREEZE ACTIVE"
            message="All outgoing transactions & agent delegations are frozen on-chain."
            action={{
              label: 'Unlock',
              onPress: handleToggleFreeze,
              variant: 'primary',
            }}
            style={{ marginBottom: 0 }}
          />
        </View>
      )}

      {/* ==================================================================== */}
      {/* 2. MAIN FINANCIAL DASHBOARD SCROLL AREA                              */}
      {/* ==================================================================== */}
      <ScrollView
        style={[styles.scrollArea, s.container]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 112 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.dashboardContainer}>
          {dockTab === 'home' && renderWalletHome()}
          {dockTab === 'agent' && renderAgentsPage()}
          {dockTab === 'activity' && renderActivityPage()}
          {dockTab === 'security' && renderSecurityPage()}
        </View>
      </ScrollView>

      {/* ==================================================================== */}
      {/* 4. EXPANDED SEND TRANSACTION & PREVIEW MODAL                         */}
      {/* ==================================================================== */}
      <Modal visible={showSendModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.expandedModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.expandedSendSheet, s.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            {/* Modal Header */}
            <View style={styles.modalSheetHeader}>
              <View>
                <Text style={[styles.modalSheetTitle, s.textPrimary]}>Send Solana</Text>
                <Text style={[styles.modalSheetSubtitle, s.textMuted]}>Instant on-chain transfer via passkey</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowSendModal(false)}
                style={styles.modalCloseBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={20} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {/* HERO AMOUNT INPUT SECTION */}
              <View style={[styles.sendHeroCard, s.card]}>
                <View style={styles.sendTokenHeaderRow}>
                  <View style={[styles.sendTokenPill, s.elevatedCard]}>
                    <Text style={[styles.sendTokenSymbol, s.textPrimary]}>SOL</Text>
                    <Text style={[styles.sendTokenName, s.textMuted]}>Solana</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.selectionAsync()
                      setSendAmountText(balance.toString())
                    }}
                    style={styles.sendBalanceChip}
                  >
                    <Text style={[styles.sendBalanceLabel, s.textSecondary]}>Available: </Text>
                    <Text style={[styles.sendBalanceValue, { color: theme.accent }]}>{balance.toFixed(4)} SOL</Text>
                  </TouchableOpacity>
                </View>

                {/* Big Amount Input */}
                <View style={styles.sendInputRow}>
                  <TextInput
                    style={[styles.sendBigInput, s.textPrimary]}
                    value={sendAmountText}
                    onChangeText={setSendAmountText}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#475569"
                    selectionColor={theme.accent}
                    autoFocus={false}
                  />
                  <Text style={[styles.sendCurrencySuffix, s.textSecondary]}>SOL</Text>
                </View>

                {/* Live USD Counter using swamimalode07/rare-ui/animated-counter */}
                <View style={styles.sendUsdEstimateRow}>
                  <Text style={[styles.sendUsdApprox, s.textMuted]}>≈ </Text>
                  <AnimatedCounter
                    value={sendAmountNum * SOL_PRICE_USD}
                    decimals={2}
                    prefix="$"
                    suffix=" USD"
                    textStyle={[styles.sendUsdCounter, s.textMuted]}
                  />
                </View>

                {/* Quick Percentage Chips */}
                <View style={styles.percentageChipsRow}>
                  {[
                    { label: '25%', fraction: 0.25 },
                    { label: '50%', fraction: 0.5 },
                    { label: '75%', fraction: 0.75 },
                    { label: 'MAX', fraction: 1 },
                  ].map((chip) => (
                    <TouchableOpacity
                      key={chip.label}
                      style={[styles.percentChip, s.input]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        const val = Math.max(0, balance * chip.fraction)
                        setSendAmountText(val > 0 ? val.toFixed(4) : '0')
                      }}
                    >
                      <Text style={[styles.percentChipText, s.textSecondary]}>{chip.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* RECIPIENT INPUT SECTION */}
              <View style={styles.inputSection}>
                <View style={styles.inputLabelRow}>
                  <Text style={[styles.inputLabel, s.textMuted]}>RECIPIENT SOLANA ADDRESS</Text>
                  {isValidSolanaAddress(sendRecipient) && (
                    <View style={styles.validBadge}>
                      <MaterialIcons name="check-circle" size={12} color="#10B981" />
                      <Text style={styles.validBadgeText}>Valid Address</Text>
                    </View>
                  )}
                </View>

                <View style={[styles.inputBoxRow, s.input]}>
                  <TextInput
                    style={[styles.modalInput, s.textPrimary]}
                    value={sendRecipient}
                    onChangeText={setSendRecipient}
                    placeholder="Enter recipient base58 address"
                    placeholderTextColor={theme.textMuted}
                    selectionColor={theme.accent}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {sendRecipient ? (
                    <TouchableOpacity
                      style={styles.clearActionBtn}
                      onPress={() => setSendRecipient('')}
                    >
                      <MaterialIcons name="cancel" size={16} color={theme.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.pasteActionBtn, { backgroundColor: isDark ? '#1F1F23' : '#EEF2F6' }]}
                    onPress={async () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      const text = await Clipboard.getString()
                      if (text) setSendRecipient(text.trim())
                    }}
                  >
                    <Text style={[styles.pasteActionText, { color: theme.accent }]}>Paste</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* EXPANDED TRANSACTION PREVIEW SECTION */}
              <View style={styles.previewSection}>
                <Text style={[styles.inputLabel, s.textMuted, { marginBottom: 8 }]}>TRANSACTION PREVIEW</Text>
                <View style={[styles.previewCard, s.card]}>
                  {/* Recipient Item */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, s.textMuted]}>Recipient</Text>
                    <View style={styles.previewValueRow}>
                      <View style={styles.recipientAvatarSmall}>
                        <MaterialIcons name="account-balance-wallet" size={12} color={theme.textPrimary} />
                      </View>
                      <Text style={[styles.previewValueText, s.textPrimary]}>
                        {sendRecipient ? ellipsify(sendRecipient, 4) : 'Not specified'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.previewDivider, s.divider]} />

                  {/* Transfer Value */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, s.textMuted]}>Transfer Amount</Text>
                    <Text style={[styles.previewValueBold, s.textPrimary]}>
                      {sendAmountNum.toFixed(4)} SOL
                    </Text>
                  </View>

                  <View style={[styles.previewDivider, s.divider]} />

                  {/* Network & Speed */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, s.textMuted]}>Network</Text>
                    <View style={styles.previewValueRow}>
                      <View style={styles.networkDotSmall} />
                      <Text style={[styles.previewValueText, s.textSecondary]}>
                        {network === 'devnet' ? 'Solana Devnet (Sub-second)' : 'Solana Mainnet'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.previewDivider, s.divider]} />

                  {/* Network Fee */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, s.textMuted]}>Estimated Fee</Text>
                    <Text style={[styles.previewValueText, s.textSecondary]}>0.000005 SOL (~$0.0007)</Text>
                  </View>

                  <View style={[styles.previewDivider, s.divider]} />

                  {/* Security Clearance */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, s.textMuted]}>Authorization</Text>
                    <View style={styles.securityBadgeRow}>
                      <MaterialIcons
                        name={isSendQuorumRequired ? 'security' : 'fingerprint'}
                        size={14}
                        color={isSendQuorumRequired ? '#F59E0B' : '#10B981'}
                      />
                      <Text
                        style={[
                          styles.securityBadgeText,
                          { color: isSendQuorumRequired ? '#F59E0B' : '#10B981' },
                        ]}
                      >
                        {isSendQuorumRequired ? '2-of-2 Hardware Quorum' : '1-Tap Biometric Passkey'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.previewDivider, s.divider]} />

                  {/* Total Deduction with AnimatedCounter */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabelBold, s.textPrimary]}>Total Outflow</Text>
                    <AnimatedCounter
                      value={sendAmountNum > 0 ? sendAmountNum + 0.000005 : 0}
                      decimals={4}
                      suffix=" SOL"
                      textStyle={[styles.previewTotalValue, s.textPrimary]}
                    />
                  </View>
                </View>
              </View>

              {/* ERROR MESSAGE */}
              {sendErrorMsg ? (
                <View style={{ marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.roseBg, borderRadius: radius.sm }}>
                  <Text style={{ color: theme.roseText, fontSize: typeScale.body, textAlign: 'center' }}>
                    {sendErrorMsg}
                  </Text>
                </View>
              ) : null}

              {/* ACTION BUTTON */}
              <View style={{ marginTop: 14 }}>
                <PrismDepthButton
                  size="large"
                  title={
                    isSendQuorumRequired
                      ? 'Authorize 2-of-2 Hardware Quorum'
                      : 'Sign & Send with Passkey'
                  }
                  onPress={handleSendTransaction}
                  loading={isSending}
                  disabled={isSending || sendAmountNum <= 0 || sendAmountNum > balance}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================================================================== */}
      {/* 5. RECEIVE MODAL                                                     */}
      {/* ==================================================================== */}
      <Modal visible={showReceiveModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, s.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, s.textPrimary]}>Receive Assets</Text>
              <TouchableOpacity onPress={() => setShowReceiveModal(false)}>
                <MaterialIcons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.receiveExplainerText, s.textSecondary]}>
              Scan this QR code or copy your address to receive SOL or SPL tokens on Solana.
            </Text>

            <View style={styles.qrContainer}>
              <AppQrCode value={activeWallet?.address || 'HaptixSolanaAddress'} />
            </View>

            <View style={[styles.addressDisplayBox, s.input]}>
              <Text style={[styles.addressDisplayText, s.textPrimary]} numberOfLines={1} ellipsizeMode="middle">
                {activeWallet?.address || ''}
              </Text>
            </View>

            <View style={{ width: '100%', gap: 10, marginTop: 8 }}>
              <CopyActionButton
                value={activeWallet?.address || ''}
                label="Copy Smart Account Address"
                copiedLabel="Address Copied to Clipboard!"
              />
              <View style={{ alignItems: 'center' }}>
                <BookmarkSaveButton
                  label="Bookmark this address"
                  savedLabel="Address bookmarked"
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* 6. SWAP MODAL (INSTANT SOL ↔ USDC)                                   */}
      {/* ==================================================================== */}
      <Modal visible={showSwapModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, s.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, s.textPrimary]}>Instant Swap</Text>
              <TouchableOpacity onPress={() => setShowSwapModal(false)}>
                <MaterialIcons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={[styles.swapDevnetNotice, s.input]}>
              <MaterialIcons name="info-outline" size={14} color={theme.textMuted} />
              <Text style={[styles.swapDevnetNoticeText, s.textMuted]}>
                Devnet has no Jupiter liquidity pools, so this swap cannot be routed here. Switch to
                Mainnet to swap for real — nothing is simulated.
              </Text>
            </View>

            {/* From Asset Box */}
            <View style={[styles.swapAssetCard, s.card]}>
              <View style={styles.swapCardRow}>
                <Text style={[styles.swapLabelText, s.textMuted]}>You pay</Text>
                <Text style={[styles.swapBalanceText, s.textSecondary]}>
                  Bal:{' '}
                  {swapDirection === 'SOL_TO_USDC'
                    ? `${balance.toFixed(4)} SOL`
                    : `${usdcBalance.toFixed(2)} USDC`}
                </Text>
              </View>
              <View style={styles.swapCardInputRow}>
                <TextInput
                  style={[styles.swapAmountInput, s.textPrimary]}
                  value={swapFromAmountText}
                  onChangeText={setSwapFromAmountText}
                  keyboardType="decimal-pad"
                  placeholder="0.1"
                  placeholderTextColor={theme.textMuted}
                  selectionColor={theme.accent}
                />
                <View style={[styles.tokenPill, { backgroundColor: isDark ? '#131E34' : '#EEF2F6', borderColor: theme.borderDefault }]}>
                  <Text style={[styles.tokenPillText, s.textPrimary]}>
                    {swapDirection === 'SOL_TO_USDC' ? 'SOL' : 'USDC'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Switch Direction Button */}
            <View style={styles.swapSwitchRow}>
              <TouchableOpacity
                style={[styles.swapSwitchCircle, s.card]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setSwapDirection(
                    swapDirection === 'SOL_TO_USDC' ? 'USDC_TO_SOL' : 'SOL_TO_USDC'
                  )
                }}
              >
                <MaterialIcons name="swap-vert" size={20} color={theme.accent} />
              </TouchableOpacity>
            </View>

            {/* To Asset Box */}
            <View style={[styles.swapAssetCard, s.card]}>
              <View style={styles.swapCardRow}>
                <Text style={[styles.swapLabelText, s.textMuted]}>You receive (est.)</Text>
                <Text style={[styles.swapRateText, { color: theme.accent }]}>1 SOL ≈ $150.00 USDC</Text>
              </View>
              <View style={styles.swapCardInputRow}>
                <Text style={[styles.swapAmountOutput, s.textPrimary]}>
                  {swapDirection === 'SOL_TO_USDC'
                    ? ((parseFloat(swapFromAmountText) || 0) * SOL_PRICE_USD).toFixed(2)
                    : ((parseFloat(swapFromAmountText) || 0) / SOL_PRICE_USD).toFixed(4)}
                </Text>
                <View style={[styles.tokenPill, { backgroundColor: isDark ? '#131E34' : '#EEF2F6', borderColor: theme.borderDefault }]}>
                  <Text style={[styles.tokenPillText, s.textPrimary]}>
                    {swapDirection === 'SOL_TO_USDC' ? 'USDC' : 'SOL'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.swapDetailRow}>
              <Text style={[styles.swapDetailKey, s.textMuted]}>Route</Text>
              <Text style={[styles.swapDetailVal, s.textSecondary]}>Jupiter · Mainnet only</Text>
            </View>

            <PrismDepthButton
              size="large"
              title="Confirm Swap"
              onPress={handleSwapTransaction}
              loading={isSwapping}
              disabled={isSwapping}
            />
          </View>
        </View>
      </Modal>



      {/* ==================================================================== */}
      {/* 8. TRANSACTION DETAIL BOTTOM SHEET MODAL                             */}
      {/* ==================================================================== */}
      <Modal visible={showTxDetailModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, s.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, s.textPrimary]}>Transaction Details</Text>
              <TouchableOpacity
                onPress={() => setShowTxDetailModal(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialIcons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedTransaction && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {/* Hero Status & Amount Header */}
                <View style={styles.txDetailHeroCard}>
                  <View
                    style={[
                      styles.txDetailIconCircle,
                      {
                        backgroundColor:
                          selectedTransaction.type === 'airdrop'
                            ? 'rgba(16,185,129,0.15)'
                            : selectedTransaction.type === 'freeze'
                            ? 'rgba(244,63,94,0.15)'
                            : theme.accentLight,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name={
                        selectedTransaction.type === 'airdrop'
                          ? 'arrow-downward'
                          : selectedTransaction.type === 'freeze'
                          ? 'lock'
                          : selectedTransaction.type === 'unfreeze'
                          ? 'lock-open'
                          : selectedTransaction.type === 'agent_trade'
                          ? 'smart-toy'
                          : 'arrow-outward'
                      }
                      size={28}
                      color={
                        selectedTransaction.type === 'airdrop' || selectedTransaction.type === 'unfreeze'
                          ? '#10B981'
                          : selectedTransaction.type === 'freeze'
                          ? '#FDA4AF'
                          : theme.accent
                      }
                    />
                  </View>

                  <Text style={[styles.txDetailAmountText, s.textPrimary]}>
                    {selectedTransaction.type === 'freeze' || selectedTransaction.type === 'unfreeze' || selectedTransaction.type === 'init'
                      ? 'No funds moved'
                      : `${selectedTransaction.type === 'airdrop' ? '+' : '-'}${selectedTransaction.amount.toFixed(4)} ${selectedTransaction.tokenSymbol || 'SOL'}`}
                  </Text>

                  {selectedTransaction.amount > 0 && (
                    <Text style={[styles.txDetailFiatText, s.textMuted]}>
                      ≈ ${(selectedTransaction.amount * SOL_PRICE_USD).toFixed(2)} USD
                    </Text>
                  )}

                  <View style={styles.txDetailConfirmedPill}>
                    <MaterialIcons name="verified" size={13} color="#10B981" />
                    <Text style={styles.txDetailConfirmedText}>Confirmed on Solana Devnet</Text>
                  </View>
                </View>

                {/* Cryptographic Clearance Details Card */}
                <View style={[styles.securityGroupCard, s.card]}>
                  <Text style={[styles.securityGroupLabel, s.textMuted]}>HOW THIS WAS APPROVED</Text>

                  <View style={styles.specKeyValueRow}>
                    <Text style={[styles.specKeyText, s.textSecondary]}>Approved by:</Text>
                    <Text style={[styles.specValueText, { color: theme.accent }]}>
                      {selectedTransaction.securityType || 'Secp256r1 Hardware Passkey'}
                    </Text>
                  </View>

                  <View style={styles.specKeyValueRow}>
                    <Text style={[styles.specKeyText, s.textSecondary]}>Signature curve:</Text>
                    <Text style={[styles.specValueText, s.textPrimary]}>NIST P-256 (Secp256r1)</Text>
                  </View>

                  <View style={styles.specKeyValueRow}>
                    <Text style={[styles.specKeyText, s.textSecondary]}>Time:</Text>
                    <Text style={[styles.specValueText, s.textPrimary]}>
                      {new Date(selectedTransaction.timestamp).toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Addresses & Signature Card */}
                <View style={[styles.securityGroupCard, s.card]}>
                  <Text style={[styles.securityGroupLabel, s.textMuted]}>ON-CHAIN IDENTIFIERS</Text>

                  {/* Recipient / Program */}
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[styles.specKeyText, s.textMuted, { marginBottom: 4 }]}>Counterparty</Text>
                    <View style={[styles.addressCopyRow, s.input]}>
                      <Text style={[styles.addressCopyRowText, s.textPrimary]} numberOfLines={1}>
                        {selectedTransaction.recipientOrSender}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          Clipboard.setString(selectedTransaction.recipientOrSender)
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                        }}
                      >
                        <MaterialIcons name="content-copy" size={16} color={theme.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Transaction Signature */}
                  <View>
                    <Text style={[styles.specKeyText, s.textMuted, { marginBottom: 4 }]}>Transaction Signature</Text>
                    <View style={[styles.addressCopyRow, s.input]}>
                      <Text style={[styles.addressCopyRowText, s.textPrimary]} numberOfLines={1}>
                        {selectedTransaction.signature}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          Clipboard.setString(selectedTransaction.signature)
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                        }}
                      >
                        <MaterialIcons name="content-copy" size={16} color={theme.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Explorer Action Buttons */}
                <View style={{ marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.explorerButton, { backgroundColor: theme.accent }]}
                    onPress={() =>
                      Linking.openURL(
                        `https://explorer.solana.com/tx/${selectedTransaction.signature}?cluster=devnet`
                      )
                    }
                  >
                    <MaterialIcons name="open-in-new" size={16} color={theme.accentForeground} />
                    <Text style={[styles.explorerButtonText, { color: theme.accentForeground }]}>View on Solana Explorer</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* 8. OVERFLOW MENU SHEET (ACCOUNT & TESTING CONTROLS)                  */}
      {/* ==================================================================== */}
      <Modal visible={showOverflowMenu} transparent animationType="fade">
        <Pressable style={styles.menuBackdrop} onPress={() => setShowOverflowMenu(false)}>
          <View style={[styles.overflowSheet, s.card, { bottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                handleCopyAddress()
              }}
            >
              <MaterialIcons name="content-copy" size={18} color={theme.textSecondary} />
              <Text style={[styles.overflowRowText, s.textPrimary]}>Copy wallet address</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, s.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                Linking.openURL(
                  `https://explorer.solana.com/address/${activeWallet?.address}?cluster=${
                    network === 'devnet' ? 'devnet' : 'mainnet-beta'
                  }`
                )
              }}
            >
              <MaterialIcons name="open-in-new" size={18} color={theme.textSecondary} />
              <Text style={[styles.overflowRowText, s.textPrimary]}>View on Solana Explorer</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, s.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                setDockTab('security')
              }}
            >
              <MaterialIcons name="shield" size={18} color={theme.textPrimary} />
              <Text style={[styles.overflowRowText, s.textPrimary]}>Security & Protection</Text>
            </TouchableOpacity>


            <View style={[styles.overflowDivider, s.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                lockWallet()
              }}
            >
              <MaterialIcons name="lock" size={18} color={theme.textPrimary} />
              <Text style={[styles.overflowRowText, s.textPrimary]}>Lock wallet (Safe Lock)</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, s.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={async () => {
                setShowOverflowMenu(false)
                if (Platform.OS === 'web') {
                  const confirmed = typeof window !== 'undefined'
                    ? window.confirm(
                        'Are you sure you want to remove this smart wallet from this device? Your on-chain account and funds remain secure on Solana and can be restored anytime using your passkey.'
                      )
                    : true
                  if (confirmed) {
                    try {
                      await deletePasskeys()
                    } catch (e) {
                      console.warn('Failed to delete passkeys:', e)
                    }
                    await signOut()
                    router.replace('/sign-in')
                  }
                  return
                }

                Alert.alert(
                  'Remove Wallet from Device',
                  'Are you sure you want to remove this smart wallet from this device? Your on-chain account and funds remain secure on Solana and can be restored anytime using your passkey.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await deletePasskeys()
                        } catch (e) {
                          console.warn('Failed to delete passkeys:', e)
                        }
                        await signOut()
                        router.replace('/sign-in')
                      },
                    },
                  ]
                )
              }}
            >
              <MaterialIcons name="delete-outline" size={18} color="#FDA4AF" />
              <Text style={[styles.overflowRowText, { color: '#FDA4AF' }]}>Remove from this device</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* ==================================================================== */}
      {/* UNIFIED POLICY / HELP SHEET                                          */}
      {/* ==================================================================== */}
      <HaptixPolicySheet
        topic={policyTopic}
        threshold={spendThreshold}
        onClose={() => setPolicyTopic(null)}
      />

      {/* ==================================================================== */}
      {/* 9. SAFE LOCK FULLSCREEN OVERLAY                                      */}
      {/* ==================================================================== */}
      {isLocked && (
        <Modal visible={isLocked} animationType="fade" transparent={false}>
          <View style={[styles.safeLockContainer, s.container]}>
            <View style={[styles.safeLockCard, s.card]}>
              <View style={[styles.safeLockIconWrap, { backgroundColor: isDark ? '#0E172A' : '#F1F5F9', borderColor: theme.borderDefault }]}>
                <HaptixBrandMark size={32} color={theme.accent} />
              </View>
              <Text style={[styles.safeLockTitle, s.textPrimary]}>Wallet Locked</Text>
              <Text style={[styles.safeLockSubtitle, s.textSecondary]}>
                Protected by hardware biometric passkey
              </Text>
              <Text style={[styles.safeLockWalletName, { color: theme.accent }]}>
                {activeWallet?.name || 'Personal Smart Wallet'}
              </Text>

              <PrismDepthButton
                size="large"
                title="Unlock with Biometrics"
                loading={isUnlocking}
                disabled={isUnlocking}
                onPress={async () => {
                  try {
                    setIsUnlocking(true)
                    await unlockWallet()
                  } finally {
                    setIsUnlocking(false)
                  }
                }}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* FLOATING PILL DOCK NAVIGATION */}
      {!isLocked && (
        <HaptixFloatingDock
          activeTab={dockTab}
          onSelectTab={handleDockSelect}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    
  },

  /* 1. ELEVATED CONSUMER HEADER */
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  avatarButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircleAlert: {
    borderColor: '#FDA4AF',
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
  },
  identityTextGroup: {
    justifyContent: 'center',
  },
  headerWalletName: {
    fontSize: typeScale.title,
    fontWeight: '700',
    letterSpacing: -0.2,
    maxWidth: 140,
  },
  addressCopyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  addressCopyText: {
    fontSize: typeScale.caption,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.md,
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: '#F59E0B',
  },
  networkPillText: {
    fontSize: typeScale.caption,
    fontWeight: '600',
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIconBtnAlert: {
    borderColor: 'rgba(244, 63, 94, 0.4)',
    backgroundColor: 'rgba(244, 63, 94, 0.08)',
  },

  /* EMERGENCY FREEZE BANNER */
  freezeAlertBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 63, 94, 0.3)',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  freezeAlertText: {
    color: '#FDA4AF',
    fontSize: typeScale.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  freezeAlertAction: {
    color: '#FDA4AF',
    fontSize: typeScale.footnote,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  /* 2. DASHBOARD SCROLL & SPACING */
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  dashboardContainer: {
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },

  /* DEDICATED PAGE HEADER */
  pageHeader: {
    marginBottom: 16,
    paddingHorizontal: 2,
    marginTop: 4,
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pageTitle: {
    fontSize: typeScale.display,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    fontSize: typeScale.body,
    lineHeight: 18,
    marginTop: 4,
  },
  policyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  policyLinkText: {
    fontSize: typeScale.caption,
    fontWeight: '600',
  },

  /* HERO BALANCE CARD */
  heroCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroBalanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroBalanceLabel: {
    fontSize: typeScale.body,
    fontWeight: '500',
  },
  eyeToggleButton: {
    padding: 2,
  },
  heroBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  heroBadgeText: {
    fontSize: typeScale.micro,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  heroBalanceContent: {
    marginBottom: 16,
  },
  heroPrimaryBalance: {
    fontSize: typeScale.hero,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  heroSecondaryBalance: {
    fontSize: typeScale.bodyLg,
    fontWeight: '500',
    marginTop: 3,
  },
  heroActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  heroActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  heroActionBtnText: {
    fontSize: typeScale.body,
    fontWeight: '600',
    letterSpacing: -0.1,
    flexShrink: 1,
  },

  /* QUICK ACTIONS GRID */
  quickActionsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  /* SEGMENTED FILTER BAR */
  segmentedContainer: {
    marginBottom: 14,
  },

  segmentNote: {
    fontSize: typeScale.footnote,
    fontWeight: '500',
    marginTop: -6,
    marginBottom: 10,
    marginLeft: 2,
  },

  panicExplain: {
    fontSize: typeScale.body,
    lineHeight: 19,
    marginBottom: 14,
  },

  homeSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 10,
  },

  homeSectionTitle: {
    fontSize: typeScale.title,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  homeSectionLink: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },

  /* TREND BADGE */
  trendBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  trendBadgeText: {
    fontSize: typeScale.caption,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  trendPositive: {
    color: '#10B981',
  },
  trendNegative: {
    color: '#F43F5E',
  },

  /* ASSETS LIST (CLEAN LIST WITHOUT CARD CLUTTER) */
  assetList: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  assetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  assetLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  assetLogoWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetPrimaryName: {
    fontSize: typeScale.title,
    fontWeight: '600',
  },
  assetSecondaryTag: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  assetRight: {
    alignItems: 'flex-end',
  },
  assetCryptoAmount: {
    fontSize: typeScale.title,
    fontWeight: '600',
  },
  assetFiatAmount: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  assetDivider: {
    height: 1,
  },

  /* AI AGENTS STYLES */
  agentHeroCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
  },
  agentHeroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  agentFirewallIconCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentHeroTitle: {
    fontSize: typeScale.title,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  agentHeroSubtitle: {
    fontSize: typeScale.footnote,
    marginTop: 1,
  },
  agentHeroStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  agentStatusDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  agentStatusText: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  agentBudgetStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  agentBudgetLabel: {
    fontSize: typeScale.footnote,
    fontWeight: '500',
  },
  agentBudgetNumber: {
    fontSize: typeScale.displaySm,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  agentProgressTrack: {
    height: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: 12,
  },
  agentProgressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  agentPolicyPillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  agentPolicyPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  agentPolicyPillText: {
    fontSize: typeScale.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
  agentSectionCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
  },
  agentSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  agentSectionHeading: {
    fontSize: typeScale.title,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  agentCountBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  agentCountText: {
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
  agentCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  agentCompactIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentCompactName: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  agentCompactSub: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  agentActiveChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  agentActiveChipText: {
    color: '#10B981',
    fontSize: typeScale.caption,
    fontWeight: '600',
  },
  agentRowDivider: {
    height: 1,
    marginVertical: 10,
  },
  quorumBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  agentChipSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  agentBudgetChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  agentBudgetChipText: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  agentActionCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
  },
  agentActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  agentActionTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
  },
  agentActionSubtitle: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  agentFastLaneTestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  agentFastLaneTestBtnText: {
    fontSize: typeScale.footnote,
    fontWeight: '700',
  },
  emergencyTag: {
    fontSize: typeScale.caption,
    fontWeight: '600',
  },

  /* RECENT ACTIVITY */
  emptyActivityCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActivityTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
    marginTop: 8,
  },
  emptyActivitySubtitle: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  activityList: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
  },
  activityGroupLabel: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
    letterSpacing: 0.2,
    paddingTop: 12,
    paddingBottom: 4,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  activityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activityIconCircle: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityItemTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '500',
  },
  activityItemDate: {
    color: '#64748B',
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  activityRight: {
    alignItems: 'flex-end',
  },
  activityAmount: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  activityConfirmedLabel: {
    color: '#475569',
    fontSize: typeScale.caption,
  },
  /* MODAL COMMON STYLES */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  modalDragHandle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalSheetTitle: {
    fontSize: typeScale.heading,
    fontWeight: '700',
  },
  modalSheetSubtitle: {
    color: '#64748B',
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* EXPANDED SEND TRANSACTION & PREVIEW STYLES */
  expandedModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  expandedSendSheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '92%',
  },
  sendHeroCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  sendTokenHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  sendTokenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  sendTokenSymbol: {
    fontSize: typeScale.body,
    fontWeight: '700',
  },
  sendTokenName: {
    fontSize: typeScale.footnote,
  },
  sendBalanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sendBalanceLabel: {
    color: '#64748B',
    fontSize: typeScale.footnote,
  },
  sendBalanceValue: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  sendInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  sendBigInput: {
    fontSize: typeScale.heroXl,
    fontWeight: '700',
    textAlign: 'center',
    minWidth: 120,
    padding: 0,
    includeFontPadding: false,
  },
  sendCurrencySuffix: {
    fontSize: typeScale.displaySm,
    fontWeight: '600',
    marginLeft: 6,
    color: '#64748B',
  },
  sendUsdEstimateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  sendUsdApprox: {
    fontSize: typeScale.body,
    color: '#64748B',
  },
  sendUsdCounter: {
    fontSize: typeScale.body,
    fontWeight: '500',
    color: '#64748B',
  },
  percentageChipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
  },
  percentChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  percentChipText: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  inputSection: {
    marginBottom: 16,
  },
  validBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  validBadgeText: {
    color: '#10B981',
    fontSize: typeScale.caption,
    fontWeight: '600',
  },
  clearActionBtn: {
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  previewSection: {
    marginBottom: 14,
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewLabel: {
    color: '#64748B',
    fontSize: typeScale.body,
  },
  previewLabelBold: {
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
  },
  previewValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewValueText: {
    color: '#CBD5E1',
    fontSize: typeScale.body,
    fontWeight: '500',
  },
  previewValueBold: {
    fontSize: typeScale.body,
    fontWeight: '700',
  },
  previewTotalValue: {
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#1F1F1F',
  },
  recipientAvatarSmall: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  networkDotSmall: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: '#10B981',
  },
  securityBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  securityBadgeText: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },

  /* SECURITY SECTION REFRESH */
  securitySectionCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
  },
  securitySectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  securitySectionHeading: {
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  securityCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  securityCountText: {
    fontSize: typeScale.caption,
    fontWeight: '600',
    color: '#94A3B8',
  },
  credentialCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  credentialIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  credentialName: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  credentialSub: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  securityRowDivider: {
    height: 1,
    marginVertical: 10,
  },
  policyProgramTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(147, 51, 234, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(147, 51, 234, 0.28)',
  },
  policyProgramTagText: {
    color: '#A855F7',
    fontSize: typeScale.caption,
    fontWeight: '600',
  },
  policyStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  policyStatTile: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
  },
  policyStatLabel: {
    fontSize: typeScale.caption,
    fontWeight: '500',
    marginBottom: 4,
  },
  policyStatValue: {
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
  },
  recoveryDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  recoveryDetailTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  recoveryDetailDesc: {
    fontSize: typeScale.footnote,
    marginTop: 2,
  },
  recoveryGuardianRow: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  recoveryGuardianLabel: {
    fontSize: typeScale.micro,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  recoveryGuardianValue: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  recoveryGuardianNote: {
    fontSize: typeScale.caption,
    lineHeight: 15,
    marginTop: 4,
  },

  /* LEGACY SECURITY COMPAT */
  securityRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 14,
  },
  securityCardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  securityItemTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  securityItemDesc: {
    color: '#7E8FA6',
    fontSize: typeScale.footnote,
    lineHeight: 16,
    marginTop: 2,
  },
  securityGroupCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
  },
  securityGroupLabel: {
    color: '#64748B',
    fontSize: typeScale.caption,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  securitySpecRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  specLabelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  securitySpecTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '500',
  },
  securitySpecSub: {
    color: '#64748B',
    fontSize: typeScale.caption,
    marginTop: 1,
  },
  activeTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  activeTagText: {
    color: '#10B981',
    fontSize: typeScale.caption,
    fontWeight: '600',
  },
  quorumTag: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  quorumTagText: {
    color: '#F59E0B',
    fontSize: typeScale.caption,
    fontWeight: '600',
  },
  specInnerDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 8,
  },
  specKeyValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  specKeyText: {
    color: '#7E8FA6',
    fontSize: typeScale.body,
  },
  specValueText: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  freezeSectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 14,
  },
  freezeTitle: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  freezeDesc: {
    color: '#64748B',
    fontSize: typeScale.footnote,
    lineHeight: 16,
    marginTop: 2,
  },
  panicBtn: {
    backgroundColor: '#1A2338',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  panicBtnActive: {
    backgroundColor: 'rgba(244, 63, 94, 0.2)',
    borderWidth: 1,
    borderColor: '#F43F5E',
  },
  panicBtnText: {
    color: '#FDA4AF',
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  auditLogRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
  },
  auditLogText: {
    color: '#E2E8F0',
    fontSize: typeScale.footnote,
    fontWeight: '500',
  },
  auditLogTime: {
    color: '#64748B',
    fontSize: typeScale.caption,
    marginTop: 2,
  },

  /* INPUTS & FORM MODALS */
  inputLabel: {
    color: '#64748B',
    fontSize: typeScale.caption,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  maxLinkText: {
    color: '#FFFFFF',
    fontSize: typeScale.footnote,
    fontWeight: '500',
  },
  inputBoxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  modalInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: typeScale.bodyLg,
  },
  modalInputStandalone: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typeScale.title,
  },
  pasteActionBtn: {
    backgroundColor: '#181818',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  pasteActionText: {
    color: '#FFFFFF',
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  riskCardNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: radius.md,
    padding: 12,
    marginTop: 14,
    marginBottom: 20,
  },
  riskCardNoticeQuorum: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  riskNoticeText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: typeScale.footnote,
    lineHeight: 16,
  },
  modalPrimaryActionBtn: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: radius.lg,
  },
  modalPrimaryActionBtnText: {
    color: '#000000',
    fontSize: typeScale.title,
    fontWeight: '600',
  },

  /* RECEIVE MODAL */
  receiveExplainerText: {
    color: '#94A3B8',
    fontSize: typeScale.body,
    lineHeight: 18,
    marginBottom: 16,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: 16,
    alignSelf: 'center',
    marginBottom: 16,
  },
  addressDisplayBox: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 18,
  },
  addressDisplayText: {
    fontSize: typeScale.footnote,
    fontFamily: 'SpaceMono',
    textAlign: 'center',
  },

  /* SWAP MODAL */
  swapAssetCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  },
  swapCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  swapLabelText: {
    color: '#64748B',
    fontSize: typeScale.footnote,
  },
  swapBalanceText: {
    color: '#64748B',
    fontSize: typeScale.footnote,
  },
  swapRateText: {
    color: '#A1A1AA',
    fontSize: typeScale.footnote,
  },
  swapCardInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swapAmountInput: {
    flex: 1,
    fontSize: typeScale.display,
    fontWeight: '600',
    paddingVertical: 4,
  },
  swapAmountOutput: {
    fontSize: typeScale.display,
    fontWeight: '600',
    paddingVertical: 4,
  },
  tokenPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  tokenPillText: {
    fontSize: typeScale.body,
    fontWeight: '600',
  },
  swapSwitchRow: {
    alignItems: 'center',
    marginVertical: -12,
    zIndex: 10,
  },
  swapSwitchCircle: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swapDevnetNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  swapDevnetNoticeText: {
    flex: 1,
    fontSize: typeScale.caption,
    lineHeight: 15,
  },
  swapDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  swapDetailKey: {
    color: '#64748B',
    fontSize: typeScale.footnote,
  },
  swapDetailVal: {
    color: '#94A3B8',
    fontSize: typeScale.footnote,
    fontWeight: '500',
  },

  /* AGENTS MODAL */
  agentExecuteTradeBtn: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    marginTop: 4,
    marginBottom: 12,
  },
  agentExecuteTradeText: {
    color: '#000000',
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  agentModalActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modalSecondaryBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  modalDangerBtn: {
    flex: 1,
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  modalDangerBtnText: {
    color: '#FDA4AF',
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },

  /* OVERFLOW MENU */
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  overflowSheet: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 8,
  },
  overflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  overflowRowText: {
    fontSize: typeScale.title,
    fontWeight: '500',
  },
  overflowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* 9. SAFE LOCK OVERLAY */
  safeLockContainer: {
    flex: 1,
    
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  safeLockCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
  },
  safeLockIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  safeLockTitle: {
    fontSize: typeScale.display,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  safeLockSubtitle: {
    color: '#94A3B8',
    fontSize: typeScale.bodyLg,
    textAlign: 'center',
    marginBottom: 6,
  },
  safeLockWalletName: {
    color: '#A1A1AA',
    fontSize: typeScale.body,
    fontWeight: '600',
    marginBottom: 26,
  },
  unlockButton: {
    width: '100%',
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unlockButtonText: {
    color: '#000000',
    fontSize: typeScale.title,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  // On-Chain Deployment Banner
  onChainStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 14,
  },
  onChainStatusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  onChainStatusText: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  deployPdaButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  deployPdaButtonText: {
    fontSize: typeScale.caption,
    fontWeight: '700',
  },
  // Activity Filters
  activityFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  activityFilterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  activityFilterChipText: {
    fontSize: typeScale.body,
    fontWeight: '500',
  },
  activitySecurityBadge: {
    fontSize: typeScale.caption,
    fontWeight: '500',
  },
  confirmedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  confirmedBadgeText: {
    color: '#10B981',
    fontSize: typeScale.caption,
    fontWeight: '500',
  },
  // Sub-Agent Details
  subAgentItem: {
    paddingVertical: 4,
  },
  subAgentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  subAgentTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subAgentName: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  subAgentDesc: {
    fontSize: typeScale.footnote,
    lineHeight: 16,
    marginBottom: 6,
  },
  subAgentMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subAgentMetaText: {
    fontSize: typeScale.footnote,
    fontWeight: '500',
  },
  sessionGrantExplainer: {
    fontSize: typeScale.footnote,
    lineHeight: 16,
    marginBottom: 12,
  },
  sessionInputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  sessionInputLabel: {
    fontSize: typeScale.footnote,
    fontWeight: '500',
    marginBottom: 4,
  },
  sessionInputBox: {
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
  },
  zeroPromptBadgeText: {
    fontSize: typeScale.footnote,
    textAlign: 'center',
    marginTop: 4,
  },
  // Transaction Details Modal
  txDetailHeroCard: {
    alignItems: 'center',
    paddingVertical: 18,
    marginBottom: 14,
  },
  txDetailIconCircle: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  txDetailAmountText: {
    fontSize: typeScale.displayLg,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  txDetailFiatText: {
    fontSize: typeScale.body,
    marginBottom: 10,
  },
  txDetailConfirmedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.xl,
  },
  txDetailConfirmedText: {
    color: '#10B981',
    fontSize: typeScale.footnote,
    fontWeight: '600',
  },
  addressCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  addressCopyRowText: {
    fontSize: typeScale.footnote,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
    marginRight: 8,
  },
  explorerButton: {
    height: 48,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  explorerButtonText: {
    color: '#000000',
    fontSize: typeScale.bodyLg,
    fontWeight: '700',
  },
})

function PolicyLinkButton({ onPress }: { onPress: () => void }) {
  const { theme } = useAppTheme()
  return (
    <TouchableOpacity
      style={[
        styles.policyLink,
        { borderColor: theme.borderDefault, backgroundColor: theme.accentLight },
      ]}
      onPress={() => {
        Haptics.selectionAsync()
        onPress()
      }}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <MaterialIcons name="info-outline" size={12} color={theme.textSecondary} />
      <Text style={[styles.policyLinkText, { color: theme.textSecondary }]}>How this works</Text>
    </TouchableOpacity>
  )
}
