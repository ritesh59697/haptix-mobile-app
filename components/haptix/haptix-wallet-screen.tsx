import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Linking,
  Pressable,
  Platform,
  Share,
  StatusBar as RNStatusBar,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
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
import { isSolanaAddress } from '@/utils/solana-address'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import { deletePasskeys, signWithPasskey } from '@/utils/haptix-passkey'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  PrismDepthButton,
  DepthOutlineButton,
  CopyActionButton,
  ThemeToggleButton,
  HoldToConfirmButton,
} from '@/components/ui'
import {
  fetchHaptixWallet,
  createInitializeWalletInstruction,
  getGrantAgentSignedMessage,
  createGrantAgentSessionInstruction,
  createAgentExecuteInstruction,
  createPanicFreezeInstruction,
  createUnfreezeInstruction,
  getRevokeAgentSignedMessage,
  createRevokeAgentSessionInstruction,
  parseGuardianAddress,
  WalletState,
  AgentSessionState,
} from '@/utils/haptix-client'
import { getFundedDevnetPayer, fundDevnetWallet } from '@/utils/haptix-funder'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { MarketSnapshot, fallbackMarketSnapshot, fetchMarketSnapshot } from '@/utils/haptix-prices'
import {
  TransactionRecord,
  fetchOnChainTransactions,
  loadCachedBalance,
  loadTxHistory,
  mergeTxRecords,
  saveCachedBalance,
  saveTxHistory,
} from '@/utils/haptix-tx-history'
import {
  HaptixBrandMark,
  SolanaTokenLogo,
  UsdcTokenLogo,
  ActionSendIcon,
  ActionReceiveIcon,
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
import { HaptixIosTabs, IosTabItem } from './haptix-ios-tabs'
import { HaptixPolicySheet, PolicyTopic } from './haptix-policy-sheet'
import { HaptixSendSheet } from './haptix-send-sheet'
import { HaptixAlert } from './haptix-alert'
import { useGuardianSigner } from '@/hooks/use-guardian-signer'
import { AppConfig } from '@/constants/app-config'
import { useHaptixDialog } from './haptix-dialog'
import { useConfirmRemoveWallet } from './haptix-remove-wallet'
import { typeScale } from '@/theme/tokens'
import { useWalletStyles } from './haptix-wallet-styles'
import { ActivityRow, AgentSessionRow } from './haptix-wallet-rows'
import {
  AGENT_TYPES,
  MOVEMENT_TYPES,
  SECURITY_TYPES,
  activityIconFor,
  activitySecurityLabelFor,
  activityToneFor,
} from '@/utils/haptix-activity-display'

// Module scope, not inline: the segmented control is memoized, and a fresh array on every
// render would have handed it a new prop and defeated that.
const HOME_SEGMENT_TABS: IosTabItem<'assets' | 'markets'>[] = [
  { id: 'assets', label: 'Assets' },
  { id: 'markets', label: 'Watchlist' },
]

const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'agents', label: 'Agent Sessions' },
  { id: 'security', label: 'Security' },
] as const

type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]['id']

function matchesActivityFilter(tx: TransactionRecord, filter: ActivityFilter): boolean {
  if (filter === 'transfers') return MOVEMENT_TYPES.includes(tx.type)
  if (filter === 'agents') return AGENT_TYPES.includes(tx.type)
  if (filter === 'security') return SECURITY_TYPES.includes(tx.type)
  return true
}

// Endpoints live in AppConfig so the settings cluster card and the wallet always
// resolve the same node. See the note there about rate limits and the env override.
const DEVNET_RPC = AppConfig.devnetRpcUrl
const MAINNET_RPC = AppConfig.mainnetRpcUrl
// Demo allowance for the autonomous agent trade. The recipient used to be a
// throwaway `Keypair.generate()` address, which quietly burned the funds; it is
// now supplied by the user and confirmed before the trade runs.
const AGENT_TRADE_AMOUNT_SOL = 0.02
const AGENT_TRADE_AMOUNT_LAMPORTS = 20_000_000n

export function HaptixWalletScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { activeWallet, isLocked, lockWallet, unlockWallet, signOut } = useAuth()
  const { theme, isDark } = useAppTheme()
  const dialog = useHaptixDialog()
  const confirmRemoveWallet = useConfirmRemoveWallet()

  // Rebuilt whenever the palette changes and not on any other render, so the
  // screen still has one stable style object per theme.
  const styles = useWalletStyles()

  // Network State (Devnet vs Mainnet)
  const [network, setNetwork] = useState<'devnet' | 'mainnet'>('devnet')

  // Balances
  const [balance, setBalance] = useState<number>(0)
  const [refreshing, setRefreshing] = useState(false)

  // Loading States
  // A failed balance read used to be flattened into 0 SOL by `.catch(() => 0)`, which
  // is the one wrong answer a wallet must never give. Failures keep the last known
  // balance and raise a banner instead.
  const [rpcIssue, setRpcIssue] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isRequestingFaucet, setIsRequestingFaucet] = useState(false)
  const [isInitializingWallet, setIsInitializingWallet] = useState(false)

  // Security & Anchor On-Chain State
  const [onChainWallet, setOnChainWallet] = useState<WalletState | null>(null)
  const [isFrozen, setIsFrozen] = useState(false)
  const [spendThreshold, setSpendThreshold] = useState(activeWallet?.spendThreshold ?? 0.1)

  // Modals & Drawers
  const [showSendModal, setShowSendModal] = useState(false)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showTxDetailModal, setShowTxDetailModal] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionRecord | null>(null)

  // Passing this down to `ActivityRow` is what lets the row's `memo` hold: an inline
  // arrow would be a new function on every render, so every row would re-render anyway.
  const handleSelectTransaction = useCallback((tx: TransactionRecord) => {
    setSelectedTransaction(tx)
    setShowTxDetailModal(true)
  }, [])
  const [policyTopic, setPolicyTopic] = useState<PolicyTopic | null>(null)

  // Agent Policy Customization Inputs
  const [isGrantingSession, setIsGrantingSession] = useState(false)
  const [customAgentAllowance, setCustomAgentAllowance] = useState('0.25')
  const [customAgentValidHours, setCustomAgentValidHours] = useState('24')
  const [agentRecipient, setAgentRecipient] = useState('')
  const [revokingAgent, setRevokingAgent] = useState<string | null>(null)

  // Live market prices, refreshed on mount and on pull-to-refresh.
  const [market, setMarket] = useState<MarketSnapshot>(() => fallbackMarketSnapshot())

  // Transactions History & Filters
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')

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

  // Live agent sessions, read straight from the on-chain account. The old
  // "2 Active" badge was hardcoded and appeared whenever the wallet had any
  // allowance configured, regardless of what was actually delegated.
  const agentSessions = useMemo(() => {
    const sessions = onChainWallet?.agents ?? []
    return [...sessions].sort((a, b) => Number(a.validUntil) - Number(b.validUntil))
  }, [onChainWallet])

  // Session expiry, and only session expiry. This value decides which delegated sessions
  // still count, so it has to change when one runs out -- but nothing on this screen looks
  // different between those moments.
  //
  // It used to tick once a second whenever the Agents tab was open, and whenever a
  // recovery was in flight. Both cases re-rendered the entire wallet -- header, dock,
  // activity list and every modal in it -- 60 times a minute just to watch a timestamp;
  // the recovery case outlived its own countdown, which moved to Settings -> Recovery
  // and left this screen ticking for a value nothing read. The digits are now rendered by
  // <HaptixCountdown>, which ticks inside the row it belongs to, and this screen simply
  // wakes up when the soonest deadline arrives. The delay is clamped to a minute so a
  // session days away cannot schedule a timer past setTimeout's ceiling, where the
  // overflow would fire immediately and put the tick straight back.
  const recoveryInFlight = onChainWallet !== null && onChainWallet.recoveryInitiatedAt !== 0n
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const nextExpiry = agentSessions
      .map((session) => Number(session.validUntil) * 1000)
      .filter((at) => at > Date.now())
      .sort((a, b) => a - b)[0]
    if (!nextExpiry) return
    const timer = setTimeout(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      Math.min(Math.max(nextExpiry - Date.now() + 250, 250), 60_000),
    )
    return () => clearTimeout(timer)
  }, [agentSessions, nowSeconds])

  const handleDockSelect = useCallback((tab: DockTabId) => {
    Haptics.selectionAsync()
    setDockTab(tab)
  }, [])

  // Active Connection depending on selected network
  const connection = useMemo(
    () =>
      new Connection(network === 'devnet' ? DEVNET_RPC : MAINNET_RPC, {
        commitment: 'confirmed',
      }),
    [network],
  )

  // Fetch on-chain balance and Anchor account state from Solana Devnet
  const fetchRealBalance = useCallback(async () => {
    if (!activeWallet?.address) return
    try {
      const pubkey = new PublicKey(activeWallet.address)
      const lamports = await connection.getBalance(pubkey)
      liveBalanceRef.current = true
      setBalance(lamports / LAMPORTS_PER_SOL)
      void saveCachedBalance(activeWallet.address, lamports)
      setRpcIssue(null)

      if (network === 'devnet') {
        const state = await fetchHaptixWallet(connection, pubkey).catch(() => null)
        if (state) {
          setOnChainWallet(state)
          setIsFrozen(state.isFrozen)
          setSpendThreshold(Number(state.spendThresholdLamports) / LAMPORTS_PER_SOL)
        }
      }
    } catch {
      // Rate limited, offline, or a dead endpoint: say so rather than reporting zero.
      setRpcIssue(
        `Could not reach the Solana ${network === 'devnet' ? 'devnet' : 'mainnet'} RPC. Balance may be out of date.`,
      )
    }
  }, [activeWallet?.address, connection, network])

  // Fetch recent transactions from Solana. Each signature is resolved to the
  // real parsed transaction so amount, direction and token symbol come from
  // chain data instead of a fixed 0.05 SOL guess.
  const fetchRecentTransactions = useCallback(async () => {
    if (!activeWallet?.address) return
    try {
      const records = await fetchOnChainTransactions(connection, new PublicKey(activeWallet.address), {
        knownSignatures: parsedHistoryRef.current,
      })
      if (records.length > 0) {
        setTransactions((prev) => mergeTxRecords(prev, records))
      }
    } catch {
      // Quietly ignore
    }
  }, [activeWallet?.address, connection])

  // `fetchRecentTransactions` must not list `transactions` as a dependency: that would
  // rebuild the callback on every write and re-trigger the whole boot fetch in a loop.
  // A ref carries the already-parsed signatures instead.
  const parsedHistoryRef = useRef<string[]>([])
  useEffect(() => {
    parsedHistoryRef.current = transactions.map((record) => record.signature)
  }, [transactions])

  // Show the last measured balance straight away instead of a fake zero.
  // `liveBalanceRef` is set as soon as a live read lands, so a slow AsyncStorage read
  // can never overwrite fresher chain data with an older figure.
  const liveBalanceRef = useRef(false)
  useEffect(() => {
    const address = activeWallet?.address
    if (!address) return
    let cancelled = false
    liveBalanceRef.current = false
    loadCachedBalance(address).then((lamports) => {
      if (cancelled || liveBalanceRef.current || lamports === null) return
      setBalance(lamports / LAMPORTS_PER_SOL)
    })
    return () => {
      cancelled = true
    }
  }, [activeWallet?.address])

  // Hydrate persisted history so a reload does not wipe the activity list.
  useEffect(() => {
    const address = activeWallet?.address
    if (!address) return
    let cancelled = false
    loadTxHistory(address).then((stored) => {
      if (!cancelled && stored.length > 0) {
        setTransactions((prev) => mergeTxRecords(prev, stored))
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeWallet?.address])

  // Every change to the list is written back, so local-only entries survive too.
  useEffect(() => {
    const address = activeWallet?.address
    if (!address || transactions.length === 0) return
    void saveTxHistory(address, transactions)
  }, [transactions, activeWallet?.address])

  const refreshMarketPrices = useCallback(async () => {
    setMarket(await fetchMarketSnapshot())
  }, [])

  useEffect(() => {
    fetchRealBalance()
    fetchRecentTransactions()
    void refreshMarketPrices()
  }, [fetchRealBalance, fetchRecentTransactions, refreshMarketPrices])

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchRealBalance(), fetchRecentTransactions(), refreshMarketPrices()])
    setRefreshing(false)
  }

  // Request Faucet Devnet SOL (+0.2 SOL from funded relayer treasury)
  const handleRequestFaucet = async () => {
    if (network !== 'devnet') {
      dialog.alert('Devnet Only', 'Faucet funding is only available on Solana Devnet.')
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
        direction: 'receive',
        amount: 0.2,
        tokenSymbol: 'SOL',
        recipientOrSender: 'Devnet Relayer Treasury',
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: 'Relayer Sponsoring',
      }
      setTransactions((prev) => [newTx, ...prev])

      dialog.alert(
        'Devnet SOL Received!',
        `Sent 0.20 SOL to your smart account from the Devnet relayer.\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
          { text: 'Great', style: 'default' },
        ],
      )
    } catch (err: any) {
      console.error('[Faucet Error]:', formatChainErrorForLog(err))
      dialog.alert('Faucet Request Failed', describeChainError(err, 'Could not fund this account on Devnet.'))
    } finally {
      setIsRequestingFaucet(false)
    }
  }

  // Initialize Counterfactual PDA Account on Solana Devnet (Anchor Program)
  const handleInitializeWalletOnChain = async () => {
    if (network !== 'devnet') {
      dialog.alert('Devnet Only', 'Wallet initialization on Anchor is available on Devnet.')
      return
    }
    if (!activeWallet?.address || !activeWallet.primaryPasskeyHex || !activeWallet.secondaryPasskeyHex) {
      dialog.alert('Error', 'Missing device passkey credentials.')
      return
    }

    try {
      setIsInitializingWallet(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      const walletPda = new PublicKey(activeWallet.address)
      const payer = await getFundedDevnetPayer(connection)
      const primaryPasskey = new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex'))
      const secondaryPasskey = new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex'))

      // A platform passkey belongs to the relying party, not to this install: remove the
      // wallet from the device, sign in again, and the authenticator can hand back the
      // same credential -- which derives the same PDA. Submitting `initialize_wallet`
      // anyway fails preflight with "Allocate: account ... already in use", so look
      // first and treat an existing account as the non-event that it is.
      const existing = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      if (existing) {
        const sameSecondary =
          Buffer.from(existing.secondaryPasskey).toString('hex') === Buffer.from(secondaryPasskey).toString('hex')

        await fetchRealBalance()
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

        // The PDA is derived from the primary key, so an existing account proves the
        // primary matches. The secondary is stored separately on-chain and is not part
        // of the derivation, which makes it the one key that can silently disagree --
        // and every 2-of-2 action (high-value transfer, unfreeze) then fails on
        // signature verification with nothing to explain why.
        const secondaryWarning = sameSecondary
          ? ''
          : '\n\nHeads up: the second key stored on-chain is not the one on this device. ' +
            'Sends above your one-key limit, and unlocking, will fail until this wallet is re-created here.'

        dialog.alert(
          'Smart Account Already On-Chain',
          'This wallet was initialized on Devnet earlier, so your spending limits are already enforced ' +
            `by the on-chain program.${secondaryWarning}`,
          [
            {
              text: 'View on Explorer',
              onPress: () =>
                Linking.openURL(`https://explorer.solana.com/address/${walletPda.toBase58()}?cluster=devnet`),
            },
            { text: 'Done', style: 'default' },
          ],
        )

        if (!sameSecondary) {
          console.warn(
            `[Haptix] On-chain secondary passkey for ${walletPda.toBase58()} differs from this device's. ` +
              'Actions above your one-key limit will fail until the wallet is re-created from this device.',
          )
        }
        return
      }

      const initIx = createInitializeWalletInstruction({
        payer: payer.publicKey,
        walletPda,
        primaryPasskey,
        secondaryPasskey,
        spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
        guardian: parseGuardianAddress(activeWallet?.guardianAddress) ?? undefined,
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
        'confirmed',
      )

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      const newTx: TransactionRecord = {
        signature: sig,
        type: 'init',
        direction: 'none',
        amount: 0,
        tokenSymbol: 'SOL',
        recipientOrSender: 'Haptix Policy Program',
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: 'Wallet setup',
      }
      setTransactions((prev) => [newTx, ...prev])

      dialog.alert(
        'Smart Account Ready',
        `Your spending limits are now enforced by the on-chain program on Solana Devnet.\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
          { text: 'Done', style: 'default' },
        ],
      )
    } catch (err: any) {
      console.error('[Initialize Wallet Error]:', formatChainErrorForLog(err))
      dialog.alert(
        'Initialization Failed',
        describeChainError(err, 'The on-chain account could not be created. Please try again.'),
      )
    } finally {
      setIsInitializingWallet(false)
    }
  }

  // The wallet PDA has to exist on-chain before the program can write to it, and
  // `initialize_wallet` gets its own transaction rather than riding along with a
  // passkey instruction. Each hardware passkey contributes a secp256r1 precompile
  // carrying a full WebAuthn assertion -- authenticatorData || sha256(clientDataJSON),
  // plus the raw clientDataJSON so the program can re-hash it -- and two of those
  // already consume most of Solana's 1232-byte transaction limit. Returns the init
  // signature, or null when the wallet was already live.
  const ensureWalletInitializedOnChain = async (walletPda: PublicKey, payer: Keypair): Promise<string | null> => {
    if (!activeWallet?.primaryPasskeyHex || !activeWallet?.secondaryPasskeyHex) return null

    const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
    if (onChain) return null

    const initIx = createInitializeWalletInstruction({
      payer: payer.publicKey,
      walletPda,
      primaryPasskey: new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex')),
      secondaryPasskey: new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex')),
      spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
      guardian: parseGuardianAddress(activeWallet.guardianAddress) ?? undefined,
    })

    const blockhash = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: blockhash.blockhash,
    }).add(initIx)
    tx.sign(payer)

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })

    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
      },
      'confirmed',
    )

    return sig
  }

  // Grant Scoped AI Agent Session Key on Solana Devnet (2-of-2 Passkey Quorum)
  const handleGrantCustomSession = async () => {
    if (isFrozen) {
      dialog.alert('Wallet Locked', 'This wallet is locked, so new agent sessions cannot be created. Unlock it first.')
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
      const secondarySig = await signWithPasskey(
        'secondary',
        grantMsg,
        'Confirm the agent session with your backup key',
      )

      const precompile1 = createSecp256r1Instruction({
        ...primarySig,
        message: grantMsg,
      })
      const precompile2 = createSecp256r1Instruction({
        ...secondarySig,
        message: grantMsg,
      })

      const payer = await getFundedDevnetPayer(connection)

      // The session is written onto the wallet PDA, so the PDA has to exist first.
      await ensureWalletInitializedOnChain(walletPda, payer)

      const txInstructions: TransactionInstruction[] = []

      // The program locates each passkey signature by its position in this
      // transaction, so the indices are read off the array as built rather than
      // assumed to start at zero.
      const grantIx = createGrantAgentSessionInstruction({
        walletPda,
        agentPubkey: ephemeralAgent.publicKey,
        validForSeconds,
        allowanceLamports,
        allowedProgram: SystemProgram.programId,
        primarySigIxIndex: txInstructions.length,
        secondarySigIxIndex: txInstructions.length + 1,
      })
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
        'confirmed',
      )

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      const newTx: TransactionRecord = {
        signature: sig,
        type: 'agent_session',
        direction: 'none',
        amount: 0,
        tokenSymbol: 'SOL',
        recipientOrSender: `Delegated Session Key (${ellipsify(ephemeralAgent.publicKey.toBase58(), 4)})`,
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: 'Both passkeys',
      }
      setTransactions((prev) => [newTx, ...prev])

      dialog.alert(
        'Agent Session Granted On-Chain',
        `Authorized session key on Anchor with ${allowanceSol} SOL allowance.\nValid for: ${hours} hours\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
          { text: 'Done', style: 'default' },
        ],
      )
    } catch (err: any) {
      console.error('[Grant Session Error]:', formatChainErrorForLog(err))
      dialog.alert(
        'Session Grant Failed',
        describeChainError(err, 'The agent session could not be granted on-chain. Please try again.'),
      )
    } finally {
      setIsGrantingSession(false)
    }
  }

  // Sharing is the one receive action a copy button cannot cover: sending the address to
  // the person who is about to pay you. The network is included in the message because a
  // devnet address that arrives without one gets paid on mainnet.
  const handleShareAddress = async () => {
    const address = activeWallet?.address
    if (!address) return
    const networkLabel = network === 'devnet' ? 'Solana Devnet' : 'Solana Mainnet'
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await Share.share({ message: `My ${networkLabel} address: ${address}` })
    } catch (err) {
      // No share sheet on this platform/browser -- copying achieves the same thing.
      console.warn('[Haptix] Share sheet unavailable, copied instead', err)
      await Clipboard.setString(address)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    }
  }

  // Autonomous Agent Execution via On-Chain Program (Zero Passkey Prompts)
  const handleAgentExecute = async (recipientAddress: string) => {
    if (isFrozen) {
      dialog.alert('Wallet Locked', 'This wallet is locked, so agents cannot spend. Unlock it first.')
      return
    }

    if (!activeWallet?.address) return

    let recipient: PublicKey
    try {
      recipient = new PublicKey(recipientAddress.trim())
    } catch {
      dialog.alert('Invalid Recipient', 'Enter the Solana address the agent should pay.')
      return
    }

    const walletPda = new PublicKey(activeWallet.address)

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      // Ephemeral autonomous agent session keypair
      const agentKeypair = Keypair.generate()
      const tradeAmountLamports = AGENT_TRADE_AMOUNT_LAMPORTS
      const allowanceLamports = 250_000_000n // 0.25 SOL
      const validForSeconds = 86400n // 24 hours

      // 1. Grant agent session on-chain via 2-of-2 passkey quorum
      const grantMsg = getGrantAgentSignedMessage(agentKeypair.publicKey, allowanceLamports, validForSeconds)
      const primarySig = await signWithPasskey('primary', grantMsg, 'Grant AI Agent On-Chain Session')
      const secondarySig = await signWithPasskey(
        'secondary',
        grantMsg,
        'Confirm the agent session with your backup key',
      )

      const precompile1 = createSecp256r1Instruction({
        ...primarySig,
        message: grantMsg,
      })
      const precompile2 = createSecp256r1Instruction({
        ...secondarySig,
        message: grantMsg,
      })

      // 2. Autonomous execution signed ONLY by agentKeypair (ZERO passkey prompts)
      const execIx = createAgentExecuteInstruction({
        walletPda,
        agentPubkey: agentKeypair.publicKey,
        recipient,
        amountLamports: tradeAmountLamports,
      })

      const payer = await getFundedDevnetPayer(connection)

      // Grant and execute travel as two transactions. A hardware passkey returns a
      // WebAuthn assertion, and each secp256r1 precompile has to carry that
      // assertion's clientDataJSON inline so the on-chain parser can re-hash it.
      // Two of those already consume most of Solana's 1232-byte limit, so the wallet
      // init gets its own transaction and the quorum settles the session before the
      // agent spends against it.
      await ensureWalletInitializedOnChain(walletPda, payer)

      const grantInstructions: TransactionInstruction[] = []

      // Signature indices are positions within their own transaction, so they have
      // to be read off the array as built rather than assumed to start at zero.
      const grantIx = createGrantAgentSessionInstruction({
        walletPda,
        agentPubkey: agentKeypair.publicKey,
        validForSeconds,
        allowanceLamports,
        allowedProgram: SystemProgram.programId,
        primarySigIxIndex: grantInstructions.length,
        secondarySigIxIndex: grantInstructions.length + 1,
      })
      grantInstructions.push(precompile1, precompile2, grantIx)

      const grantBlockhash = await connection.getLatestBlockhash('confirmed')
      const grantTx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: grantBlockhash.blockhash,
      }).add(...grantInstructions)

      grantTx.sign(payer)

      const grantSig = await connection.sendRawTransaction(grantTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(
        {
          signature: grantSig,
          blockhash: grantBlockhash.blockhash,
          lastValidBlockHeight: grantBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )

      // The session is on-chain now, so the agent's own key can spend from it.
      const execBlockhash = await connection.getLatestBlockhash('confirmed')
      const execTx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: execBlockhash.blockhash,
      }).add(execIx)

      execTx.sign(payer, agentKeypair)

      const rawTx = execTx.serialize()
      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: execBlockhash.blockhash,
          lastValidBlockHeight: execBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      setTransactions((prev) => [
        {
          signature: sig,
          type: 'agent_trade',
          direction: 'send',
          amount: AGENT_TRADE_AMOUNT_SOL,
          tokenSymbol: 'SOL',
          recipientOrSender: recipient.toBase58(),
          timestamp: Date.now(),
          status: 'confirmed',
        },
        ...prev,
      ])

      dialog.alert(
        'Autonomous Agent Trade Executed On-Chain',
        `The agent sent ${AGENT_TRADE_AMOUNT_SOL} SOL to ${ellipsify(recipient.toBase58(), 6)}, signed by its own session key with no prompt at execution time.\nThe amount came out of its daily allowance.\n\nSession grant tx: ${ellipsify(grantSig, 8)}\nTrade tx: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
          { text: 'Done', style: 'cancel' },
        ],
      )
    } catch (err: any) {
      console.error('[Haptix Agent] Execution error:', formatChainErrorForLog(err))
      dialog.alert(
        'Agent Error',
        describeChainError(err, 'The agent trade could not be executed on-chain. Please try again.'),
      )
    }
  }

  // "Test Trade" moved real funds behind two passkey prompts with no confirmation
  // step. The word "Test" implied harmless; the button now says what it does and
  // confirms the amount and the destination before spending.
  const confirmAgentExecute = () => {
    const destination = agentRecipient.trim()
    if (!isSolanaAddress(destination)) {
      dialog.alert(
        'Agent Recipient Required',
        'Set the Solana address the agent session should pay. The agent has no built-in destination, and a randomly generated one would only burn the funds.',
        [{ text: 'OK', style: 'default' }],
      )
      return
    }

    dialog.alert(
      'Run Autonomous Agent Trade',
      `Executes a real ${AGENT_TRADE_AMOUNT_SOL} SOL transfer to ${ellipsify(destination, 6)} on Solana Devnet, signed solely by a freshly generated agent session key — no biometric prompt at execution time.\n\nTwo passkey prompts are required up front to grant the session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run Trade', style: 'destructive', onPress: () => handleAgentExecute(destination) },
      ],
    )
  }

  // Revokes a delegated session key on-chain. This is the only way to actually
  // stop an agent: the key material lives with the agent, so the program has to
  // be told to stop honouring it.
  const handleRevokeAgentSession = useCallback(
    async (agentPubkey: PublicKey) => {
      if (!activeWallet?.address) return
      const walletPda = new PublicKey(activeWallet.address)

      try {
        setRevokingAgent(agentPubkey.toBase58())
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

        const message = getRevokeAgentSignedMessage(agentPubkey)
        const primarySig = await signWithPasskey('primary', message, 'Revoke Agent Session (Primary)')
        const secondarySig = await signWithPasskey(
          'secondary',
          message,
          'Confirm revoking the agent session with your backup key',
        )

        const precompilePrimary = createSecp256r1Instruction({
          ...primarySig,
          message,
        })
        const precompileSecondary = createSecp256r1Instruction({
          ...secondarySig,
          message,
        })
        const revokeIx = createRevokeAgentSessionInstruction({
          walletPda,
          agentPubkey,
          primarySigIxIndex: 0,
          secondarySigIxIndex: 1,
        })

        const payer = await getFundedDevnetPayer(connection)
        const latestBlockhash = await connection.getLatestBlockhash('confirmed')
        const tx = new Transaction({
          feePayer: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
        }).add(precompilePrimary, precompileSecondary, revokeIx)
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
          'confirmed',
        )

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        await fetchRealBalance()

        setTransactions((prev) => [
          {
            signature: sig,
            type: 'agent_session',
            direction: 'none',
            amount: 0,
            tokenSymbol: 'SOL',
            recipientOrSender: `Revoked Session Key (${ellipsify(agentPubkey.toBase58(), 4)})`,
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: 'Both passkeys',
          },
          ...prev,
        ])

        dialog.alert(
          'Agent Session Revoked On-Chain',
          `The program no longer accepts signatures from ${ellipsify(agentPubkey.toBase58(), 8)}.\n\nTx: ${ellipsify(sig, 8)}`,
          [
            {
              text: 'View on Explorer',
              onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
            },
            { text: 'Done', style: 'default' },
          ],
        )
      } catch (err: any) {
        console.error('[Haptix Agent] Revoke error:', formatChainErrorForLog(err))
        dialog.alert(
          'Revoke Failed',
          describeChainError(err, 'The agent session could not be revoked on-chain. Please try again.'),
        )
      } finally {
        setRevokingAgent(null)
      }
    },
    [activeWallet?.address, connection, dialog, fetchRealBalance],
  )

  const confirmRevokeAgentSession = useCallback(
    (session: AgentSessionState) => {
      const remaining = Number(session.allowanceLamports) / LAMPORTS_PER_SOL
      dialog.alert(
        'Revoke Agent Session',
        `Removes the session key ${ellipsify(session.agentPubkey.toBase58(), 8)} from the on-chain wallet.\n\nIt can no longer spend anything, even if it still holds a valid signature. Unspent allowance: ${remaining} SOL.\n\nTwo passkey prompts are required.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: () => handleRevokeAgentSession(session.agentPubkey),
          },
        ],
      )
    },
    // Stable identity so the memoized agent rows below are not re-rendered by a new
    // function on every render of this screen.
    [dialog, handleRevokeAgentSession],
  )

  // Toggle the wallet lock on Solana Devnet
  const handleToggleFreeze = async () => {
    if (!activeWallet?.address) return
    const walletPda = new PublicKey(activeWallet.address)

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      // Check the flag on-chain before spending a transaction on it. The local copy can
      // already be stale (a freeze landed from an earlier session, or a previous attempt
      // confirmed but the response was lost), and the banner does not correct itself --
      // so the user taps a button whose transaction is guaranteed to be rejected.
      const desiredFrozen = !isFrozen
      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      if (onChain && onChain.isFrozen === desiredFrozen) {
        setIsFrozen(desiredFrozen)
        dialog.alert(
          desiredFrozen ? 'Already Frozen' : 'Already Unfrozen',
          desiredFrozen
            ? 'This wallet is already frozen on-chain, so there was nothing to submit.'
            : 'This wallet is already unfrozen on-chain, so there was nothing to submit.',
        )
        return
      }

      // A recovery in flight holds the wallet frozen on purpose, and the program now
      // rejects an unfreeze while one is pending. Explain that here rather than spending
      // two passkey prompts on a transaction that can only be turned away.
      if (!desiredFrozen && onChain && onChain.recoveryInitiatedAt > 0n) {
        dialog.alert(
          'Recovery In Flight',
          'A guardian recovery is holding this wallet frozen. Cancel it with Keep My Keys, or wait out the timelock and execute the recovery. Either one unfreezes the wallet.',
        )
        return
      }

      if (!isFrozen) {
        // Locking the wallet is guardian-gated on-chain, so it can only be submitted by
        // whoever holds the guardian key. It used to sign with the fee payer and assume
        // the two were the same account, which quietly turned into a failing transaction
        // for any wallet whose guardian is a real third party.
        if (!guardianSigner) {
          dialog.alert(
            'Guardian Not On This Device',
            `Locking this wallet is signed by its guardian (${
              onChainWallet ? ellipsify(onChainWallet.guardian.toBase58(), 6) : 'not set'
            }), and this build does not hold that key. Ask the guardian to freeze it, or recover the wallet.`,
          )
          return
        }

        const payer = guardianSigner
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
            direction: 'none',
            amount: 0,
            tokenSymbol: 'SOL',
            recipientOrSender: 'Guardian lock',
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: 'Guardian lock',
          },
          ...prev,
        ])

        dialog.alert(
          'Wallet Locked',
          `Your wallet is locked on-chain.\n\nOutgoing transactions and agent spending are blocked until you unlock.\n\nTx: ${ellipsify(sig, 8)}`,
        )
      } else {
        // Unfreeze requires a 2-of-2 passkey quorum
        const unfreezeMsg = new Uint8Array(Buffer.from('UNFREEZE_WALLET'))

        const primarySig = await signWithPasskey('primary', unfreezeMsg, 'Authorize Wallet Unfreeze (Primary)')
        const secondarySig = await signWithPasskey(
          'secondary',
          unfreezeMsg,
          'Confirm the wallet unlock with your backup key',
        )

        // No catch here on purpose: a failed unfreeze must surface as a failure.
        // Swallowing it and still reporting "Wallet Unfrozen" asserted an on-chain
        // state change that never happened, and cleared the local freeze flag.
        const precompilePrimary = createSecp256r1Instruction({
          ...primarySig,
          message: unfreezeMsg,
        })
        const precompileSecondary = createSecp256r1Instruction({
          ...secondarySig,
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
            direction: 'none',
            amount: 0,
            tokenSymbol: 'SOL',
            recipientOrSender: 'Haptix Policy Program',
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: 'Both passkeys',
          },
          ...prev,
        ])

        dialog.alert(
          'Smart Wallet Unfrozen',
          `Verified with both passkeys.\nWallet operations restored.\n\nTx: ${ellipsify(sig, 8)}`,
        )
      }
      await fetchRealBalance()
    } catch (err: any) {
      // The program logs are the only thing that explains a rejected assertion -- web3.js
      // leaves them on the error object, and a bare `err` printed just "Simulation
      // failed." here, which is not diagnosable after the fact.
      console.error('[Haptix Freeze/Unfreeze] Error:', formatChainErrorForLog(err))
      dialog.alert(
        'Action Failed',
        describeChainError(err, 'The freeze state could not be changed on-chain. Please try again.'),
      )
    }
  }

  // --- Guardian ------------------------------------------------------------
  // Recovery itself lives in Settings (app/(tabs)/settings/recovery.tsx): it is a
  // property of the wallet rather than a daily destination, and a dock tab spent on a
  // card that only matters on the worst day was competing with the two that matter
  // every day. What stays here is the guardian key itself, because the panic freeze is
  // guardian-gated on-chain and still has to be reachable in one gesture.
  //
  // The guardian can start a recovery and nothing else: executing waits out the
  // timelock, and a veto is signed by the very keys being replaced, so a compromised
  // guardian cannot finish a takeover. This device can only play the guardian when it
  // actually holds the guardian key, which on Devnet it does -- wallets are created with
  // the bundled dev key as guardian. A release build cannot sign as a guardian at all,
  // and says so rather than offering a button that would fail every time.
  const guardianAddress = onChainWallet?.guardian.toBase58() ?? null
  const guardianSigner = useGuardianSigner(connection, guardianAddress)

  const handleCopyAddress = () => {
    if (!activeWallet?.address) return
    Clipboard.setString(activeWallet.address)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    dialog.alert('Address Copied', activeWallet.address)
  }

  const solPriceUsd = market.solPriceUsd

  // Derived Total Balance in USD
  // USDC is not tracked yet (see utils/haptix-swap.ts), so the portfolio total is SOL only.
  const totalUsdBalance = balance * solPriceUsd

  const activeAgentSessions = useMemo(
    () => agentSessions.filter((session) => Number(session.validUntil) > nowSeconds),
    [agentSessions, nowSeconds],
  )

  const activeAgentCount = activeAgentSessions.length

  const agentAllowance = useMemo(
    () => activeAgentSessions.reduce((sum, session) => sum + Number(session.allowanceLamports), 0) / LAMPORTS_PER_SOL,
    [activeAgentSessions],
  )

  // Agent budget. The cap is the delegated allowance, and "spent today" is read
  // back from this session's agent trades so the bar and the label share one
  // number instead of a hardcoded denominator that disagreed with both.
  const agentDailyBudgetUsd = agentAllowance * solPriceUsd
  const agentSpentToday = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return transactions
      .filter((tx) => tx.type === 'agent_trade' && tx.timestamp >= startOfDay.getTime())
      .reduce((sum, tx) => sum + tx.amount * solPriceUsd, 0)
  }, [transactions, solPriceUsd])

  const renderWalletHome = () => (
    <>
      {/* HERO BALANCE CARD */}
      <View style={[styles.heroCard, styles.card]}>
        <View style={styles.heroBalanceLabelRow}>
          <Text style={[styles.heroBalanceLabel, styles.textSecondary]}>Total balance</Text>
          <TouchableOpacity
            style={styles.eyeToggleButton}
            onPress={() => {
              Haptics.selectionAsync()
              setIsBalanceHidden((prev) => !prev)
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={isBalanceHidden ? 'Show balance' : 'Hide balance'}
          >
            {isBalanceHidden ? (
              <EyeHideIcon size={16} color={theme.textMuted} />
            ) : (
              <EyeShowIcon size={16} color={theme.textMuted} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.heroBalanceContent}>
          {isBalanceHidden ? (
            <Text style={[styles.heroPrimaryBalance, styles.textPrimary]}>$ ••••••</Text>
          ) : (
            <Text style={[styles.heroPrimaryBalance, styles.textPrimary]}>${totalUsdBalance.toFixed(2)}</Text>
          )}
          {isBalanceHidden ? (
            <Text style={[styles.heroSecondaryBalance, styles.textSecondary]}>•••• SOL</Text>
          ) : (
            <Text style={[styles.heroSecondaryBalance, styles.textSecondary]}>{balance.toFixed(4)} SOL</Text>
          )}
        </View>

        {/* Unified 4-Action Symmetrical Buttons Row */}
        <View style={styles.heroActionsRow}>
          {/* Send */}
          <TouchableOpacity
            style={[styles.heroActionBtn, styles.actionBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setShowSendModal(true)
            }}
            activeOpacity={0.78}
          >
            <ActionSendIcon size={15} color={theme.textPrimary} />
            <Text style={[styles.heroActionBtnText, styles.actionBtnText]}>Send</Text>
          </TouchableOpacity>

          {/* Receive */}
          <TouchableOpacity
            style={[styles.heroActionBtn, styles.actionBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setShowReceiveModal(true)
            }}
            activeOpacity={0.78}
          >
            <ActionReceiveIcon size={15} color={theme.textPrimary} />
            <Text style={[styles.heroActionBtnText, styles.actionBtnText]}>Receive</Text>
          </TouchableOpacity>

          {/* +0.2 SOL Faucet on Devnet */}
          {network === 'devnet' ? (
            <TouchableOpacity
              style={[styles.heroActionBtn, styles.actionBtn]}
              onPress={handleRequestFaucet}
              disabled={isRequestingFaucet}
              activeOpacity={0.78}
            >
              {isRequestingFaucet ? (
                <ActivityIndicator size="small" color={theme.textPrimary} />
              ) : (
                <>
                  <MaterialIcons name="local-gas-station" size={15} color={theme.textPrimary} />
                  <Text style={[styles.heroActionBtnText, styles.actionBtnText]}>Faucet</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.heroActionBtn, styles.actionBtn]}
              onPress={() => setShowReceiveModal(true)}
              activeOpacity={0.78}
            >
              <MaterialIcons name="add" size={16} color={theme.textPrimary} />
              <Text style={[styles.heroActionBtnText, styles.actionBtnText]}>Buy</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* On-chain setup status. Shown only while it still needs the user: a wallet whose
            limits are already live has nothing to act on here, and a green "all good" row
            on the main screen is reassurance the user did not ask for. The Devnet badge
            that used to sit in this card is gone for the same reason -- the header pill
            directly above it already says which network this is. */}
        {network === 'devnet' && !onChainWallet && (
          <View
            style={[
              styles.onChainStatusBanner,
              { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View style={[styles.onChainStatusDot, { backgroundColor: theme.amber }]} />
              <Text
                // The dot carries the state; the label stays neutral. Green body text on
                // every card competes with the accent colour that marks what is tappable.
                style={[styles.onChainStatusText, { color: theme.amberText }]}
                numberOfLines={2}
              >
                Spending limits are not enforced on-chain yet
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.deployPdaButton, { backgroundColor: theme.accent }]}
              onPress={handleInitializeWalletOnChain}
              disabled={isInitializingWallet}
            >
              {isInitializingWallet ? (
                <ActivityIndicator size="small" color={theme.accentForeground} />
              ) : (
                <Text style={[styles.deployPdaButtonText, { color: theme.accentForeground }]}>Finish setup</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* SEGMENTED FILTER BAR */}
      <View style={styles.segmentedContainer}>
        <HaptixIosTabs<'assets' | 'markets'>
          tabs={HOME_SEGMENT_TABS}
          activeTab={segmentedTab}
          onChange={setSegmentedTab}
        />
      </View>

      {/* TAB CONTENT: ASSETS */}
      {segmentedTab === 'assets' && (
        <View style={[styles.assetList, styles.card]}>
          {/* Solana Row */}
          <View style={styles.assetRow}>
            <View style={styles.assetLeft}>
              <View
                style={[styles.assetLogoWrap, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
              >
                <SolanaTokenLogo size={24} />
              </View>
              <View>
                <Text style={[styles.assetPrimaryName, styles.textPrimary]}>Solana</Text>
                <Text style={[styles.assetSecondaryTag, styles.textMuted]}>SOL</Text>
              </View>
            </View>
            <View style={styles.assetRight}>
              <Text style={[styles.assetCryptoAmount, styles.textPrimary]}>{balance.toFixed(4)} SOL</Text>
              <Text style={[styles.assetFiatAmount, styles.textSecondary]}>
                ≈ ${(balance * solPriceUsd).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* TAB CONTENT: MARKETS WATCHLIST */}
      {segmentedTab === 'markets' && (
        <Text style={[styles.segmentNote, styles.textMuted]}>
          {market.isLive ? 'Live prices · CoinGecko' : 'Offline estimate · last known prices'} · not tradable on Devnet
        </Text>
      )}
      {segmentedTab === 'markets' && (
        <View style={[styles.assetList, styles.card]}>
          {market.tokens.map((token, idx) => (
            <React.Fragment key={token.symbol}>
              <View style={styles.assetRow}>
                <View style={styles.assetLeft}>
                  <View
                    style={[
                      styles.assetLogoWrap,
                      { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
                    ]}
                  >
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
                      <Text style={[styles.assetPrimaryName, styles.textPrimary]}>{token.name}</Text>
                      <View style={[styles.trendBadge, { backgroundColor: theme.accentLight }]}>
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
                    <Text style={[styles.assetSecondaryTag, styles.textMuted]}>{token.symbol}</Text>
                  </View>
                </View>
                <View style={styles.assetRight}>
                  <Text style={[styles.assetCryptoAmount, styles.textPrimary]}>{token.price}</Text>
                  <Text style={[styles.assetFiatAmount, styles.textMuted]}>per token</Text>
                </View>
              </View>
              {idx < market.tokens.length - 1 && <View style={[styles.assetDivider, styles.divider]} />}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* RECENT ACTIVITY. The home tab previously stopped after the asset list,
          leaving roughly a quarter of the screen empty while transaction data
          sat unused in state. */}
      <View style={styles.homeSectionHeaderRow}>
        <Text style={[styles.homeSectionTitle, styles.textPrimary]}>Recent activity</Text>
        <TouchableOpacity onPress={() => setDockTab('activity')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.homeSectionLink, { color: theme.accent }]}>See all</Text>
        </TouchableOpacity>
      </View>

      {transactions.length === 0 ? (
        <View style={[styles.emptyActivityCard, styles.card]}>
          <MaterialIcons name="receipt-long" size={26} color={theme.textMuted} />
          <Text style={[styles.emptyActivityTitle, styles.textPrimary]}>No activity yet</Text>
          <Text style={[styles.emptyActivitySubtitle, styles.textMuted]}>
            Use the Faucet to request Devnet tokens and see your first transaction.
          </Text>
        </View>
      ) : (
        <View style={[styles.activityList, styles.card]}>
          {transactions.slice(0, 3).map((tx, idx) => (
            <React.Fragment key={tx.signature || idx}>
              {idx > 0 && <View style={[styles.assetDivider, styles.divider]} />}
              <ActivityRow tx={tx} variant="compact" onSelect={handleSelectTransaction} />
            </React.Fragment>
          ))}
        </View>
      )}
    </>
  )

  const renderAgentsPage = () => (
    <>
      <View style={styles.pageHeader}>
        <View style={styles.pageTitleRow}>
          <Text style={[styles.pageTitle, styles.textPrimary]}>AI Agents</Text>
          <PolicyLinkButton onPress={() => setPolicyTopic('agents')} />
        </View>
      </View>

      {/* 1. HERO FIREWALL & 24H BUDGET CARD */}
      <View style={[styles.agentHeroCard, styles.card]}>
        <View style={styles.agentHeroHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={[styles.agentFirewallIconCircle, { backgroundColor: isFrozen ? theme.roseBg : theme.accentLight }]}
            >
              <MaterialIcons
                name={isFrozen ? 'lock' : 'security'}
                size={18}
                color={isFrozen ? theme.roseText : theme.accent}
              />
            </View>
            <View>
              <Text style={[styles.agentHeroTitle, styles.textPrimary]}>Spending Limits</Text>
            </View>
          </View>

          <View
            style={[
              styles.agentHeroStatusBadge,
              // Only the alarmed state gets a filled, coloured pill. "Everything is fine"
              // is not worth an accent-coloured badge on every visit.
              isFrozen
                ? { backgroundColor: theme.roseBg, borderColor: theme.roseBorder }
                : { backgroundColor: 'transparent', borderColor: theme.borderDefault },
            ]}
          >
            <View
              style={[
                styles.agentStatusDot,
                { backgroundColor: isFrozen ? theme.rose : onChainWallet ? theme.emerald : theme.amber },
              ]}
            />
            <Text style={[styles.agentStatusText, { color: isFrozen ? theme.roseText : theme.textSecondary }]}>
              {/* Three states, because "not locked" is not the same as "limits are live".
                  A wallet whose policy was never deployed showed an emerald dot reading
                  "Limits active" while the Home tab was asking it to finish setup and the
                  Agent Sessions card directly below said to activate the policy first. */}
              {isFrozen ? 'Locked' : onChainWallet ? 'Limits active' : 'Not on-chain yet'}
            </Text>
          </View>
        </View>

        {/* Budget meter. The cap is what is actually delegated, so with no session granted
            both numbers are zero and the bar is empty -- a meter that reads as broken
            rather than as "nothing delegated yet". It appears once there is a budget. */}
        {agentDailyBudgetUsd > 0 && (
          <>
            <View style={styles.agentBudgetStatRow}>
              <View>
                <Text style={[styles.agentBudgetLabel, styles.textMuted]}>Spent Today</Text>
                <Text style={[styles.agentBudgetNumber, styles.textPrimary]}>${agentSpentToday.toFixed(2)} USD</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.agentBudgetLabel, styles.textMuted]}>Delegated</Text>
                <Text style={[styles.agentBudgetNumber, styles.textSecondary]}>
                  ${agentDailyBudgetUsd.toFixed(2)} USD
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.agentProgressTrack,
                { backgroundColor: isDark ? theme.borderSubtle : theme.borderDefault },
              ]}
            >
              <View
                style={[
                  styles.agentProgressFill,
                  {
                    backgroundColor: isFrozen ? theme.rose : theme.accent,
                    width: `${Math.min(100, Math.max(0, (agentSpentToday / agentDailyBudgetUsd) * 100))}%`,
                  },
                ]}
              />
            </View>
          </>
        )}

        {/* Policy Pills Row */}
        <View style={styles.agentPolicyPillRow}>
          <View style={[styles.agentPolicyPill, styles.elevatedCard]}>
            <MaterialIcons name="bolt" size={14} color={theme.emerald} />
            <Text style={[styles.agentPolicyPillText, styles.textSecondary]}>One key: ≤ {spendThreshold} SOL</Text>
          </View>

          <View style={[styles.agentPolicyPill, styles.elevatedCard]}>
            <MaterialIcons name="shield" size={14} color={theme.amber} />
            <Text style={[styles.agentPolicyPillText, styles.textSecondary]}>Both keys: &gt; {spendThreshold} SOL</Text>
          </View>
        </View>
      </View>

      {/* 2. AGENT SESSIONS. Read from the on-chain wallet account: these rows
          used to be two hardcoded agent names that had nothing to do with what
          was actually delegated. */}
      <View style={[styles.agentSectionCard, styles.card]}>
        <View style={styles.agentSectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.agentSectionHeading, styles.textPrimary]}>Agent Sessions</Text>
            {/* Counted only when there is something to count: a badge reading "0 Active"
                beside a heading that already says "Sessions" carries no information. */}
            {activeAgentCount > 0 ? (
              <Text style={[styles.agentCompactSub, styles.textMuted]}>{activeAgentCount} active</Text>
            ) : null}
          </View>
          {agentSessions.length > activeAgentCount && (
            <Text style={[styles.agentCompactSub, styles.textMuted]}>
              {agentSessions.length - activeAgentCount} expired
            </Text>
          )}
        </View>

        {!onChainWallet ? (
          <Text style={[styles.agentCompactSub, styles.textMuted]}>
            Activate the spending policy on-chain to manage agent sessions.
          </Text>
        ) : agentSessions.length === 0 ? (
          <Text style={[styles.agentCompactSub, styles.textMuted]}>
            No session keys delegated. Grant one below to let an agent spend from this wallet.
          </Text>
        ) : (
          agentSessions.map((session, index) => {
            const sessionKey = session.agentPubkey.toBase58()
            const isExpired = Number(session.validUntil) <= nowSeconds

            return (
              <React.Fragment key={sessionKey}>
                {index > 0 && <View style={[styles.agentRowDivider, styles.divider]} />}
                <AgentSessionRow
                  session={session}
                  isExpired={isExpired}
                  isRevoking={revokingAgent === sessionKey}
                  onRevoke={confirmRevokeAgentSession}
                />
              </React.Fragment>
            )
          })
        )}
      </View>

      {/* 3. GRANT SESSION KEY CARD */}
      <View style={[styles.agentSectionCard, styles.card]}>
        <View style={styles.agentSectionHeader}>
          <Text style={[styles.agentSectionHeading, styles.textPrimary]}>Grant Session Key</Text>
          <View style={[styles.quorumBadgeSmall, { backgroundColor: 'transparent', borderColor: theme.amberBorder }]}>
            <Text style={{ color: theme.amberText, fontSize: typeScale.caption, fontWeight: '600' }}>
              Both passkeys
            </Text>
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
                  isSelected ? { backgroundColor: theme.accent, borderColor: theme.accent } : styles.input,
                ]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setCustomAgentAllowance(val)
                }}
              >
                <Text
                  style={[
                    styles.agentBudgetChipText,
                    isSelected ? { color: theme.accentForeground, fontWeight: '700' } : styles.textSecondary,
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
      <View style={[styles.agentActionCard, styles.card]}>
        <Text style={[styles.agentActionTitle, styles.textPrimary]}>Autonomous Agent Trade</Text>

        {/* The agent needs a destination. It used to pay a freshly generated
            keypair, i.e. an address nobody controls, which just destroyed the
            funds. This is where the real recipient is entered. */}
        <TextInput
          style={[styles.agentRecipientInput, styles.input]}
          value={agentRecipient}
          onChangeText={setAgentRecipient}
          placeholder="Agent recipient address"
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.accent}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={[styles.agentRecipientHint, styles.textMuted]}>
          {`Sends ${AGENT_TRADE_AMOUNT_SOL} SOL to this address.`}
        </Text>

        {/* The action sits below the field it consumes. Beside the title it read before the
            address it spends to, so the card had to be parsed twice. */}
        <TouchableOpacity
          style={[
            styles.agentFastLaneTestBtn,
            { backgroundColor: theme.accent, alignSelf: 'flex-start', marginTop: 12 },
          ]}
          onPress={confirmAgentExecute}
          activeOpacity={0.8}
        >
          <MaterialIcons name="bolt" size={15} color={theme.accentForeground} />
          <Text style={[styles.agentFastLaneTestBtnText, { color: theme.accentForeground }]}>Run Trade</Text>
        </TouchableOpacity>

        <View style={[styles.agentRowDivider, styles.divider]} />

        {/* Wallet lock */}
        <View style={{ marginTop: 4 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text
                style={[
                  styles.agentActionTitle,
                  isFrozen ? { color: theme.emeraldText } : { color: theme.textPrimary },
                ]}
              >
                {isFrozen ? 'Wallet Is Locked' : 'Wallet Lock'}
              </Text>
            </View>
            <Text style={[styles.emergencyTag, { color: isFrozen ? theme.emeraldText : theme.textMuted }]}>
              {isFrozen ? 'Locked' : 'Available'}
            </Text>
          </View>

          <HoldToConfirmButton
            label={isFrozen ? 'Hold to Unlock Wallet' : 'Hold to Lock Wallet'}
            confirmingLabel={isFrozen ? 'Unlocking on-chain...' : 'Freezing on-chain...'}
            completedLabel={isFrozen ? 'Wallet Unlocked' : 'Wallet Frozen'}
            variant="primary"
            onConfirm={handleToggleFreeze}
          />
        </View>
      </View>
    </>
  )

  const renderActivityPage = () => {
    const filtered = transactions.filter((tx) => matchesActivityFilter(tx, activityFilter))

    // Day buckets. A flat column of "Transfer SOL · 2:43 PM" rows gives the eye
    // nothing to land on; the date is the cheapest real grouping available.
    const groupLabel = (ts: number) => {
      const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
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
          <Text style={[styles.pageTitle, styles.textPrimary]}>Transaction History</Text>
          <Text style={[styles.pageSubtitle, styles.textSecondary]}>
            Every action this wallet has taken, confirmed on-chain
          </Text>
        </View>

        {/* Activity Category Filter Chips */}
        <View style={styles.activityFilterRow}>
          {ACTIVITY_FILTERS.map((f) => {
            const isSelected = activityFilter === f.id
            return (
              <TouchableOpacity
                key={f.id}
                style={[styles.activityFilterChip, isSelected ? { backgroundColor: theme.accent } : styles.input]}
                onPress={() => {
                  Haptics.selectionAsync()
                  setActivityFilter(f.id)
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.activityFilterChipText,
                    isSelected ? { color: theme.accentForeground, fontWeight: '700' } : styles.textSecondary,
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
          <View style={[styles.emptyActivityCard, styles.card]}>
            <MaterialIcons name="receipt-long" size={26} color={theme.textMuted} />
            <Text style={[styles.emptyActivityTitle, styles.textPrimary]}>
              {activityFilter === 'all'
                ? 'No transactions yet'
                : `No ${ACTIVITY_FILTERS.find((f) => f.id === activityFilter)?.label.toLowerCase() ?? activityFilter} events yet`}
            </Text>
            <Text style={[styles.emptyActivitySubtitle, styles.textMuted]}>
              {activityFilter === 'all'
                ? 'Send SOL, request Devnet test tokens, or trigger AI trades to see activity.'
                : 'Try selecting All or trigger a new on-chain transaction.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.activityList, styles.card]}>
            {filtered.map((tx, idx) => {
              const dayLabel = groupLabel(tx.timestamp)
              const showDayHeader = idx === 0 || dayLabel !== groupLabel(filtered[idx - 1].timestamp)

              return (
                <React.Fragment key={tx.signature || idx}>
                  {showDayHeader && <Text style={[styles.activityGroupLabel, styles.textMuted]}>{dayLabel}</Text>}
                  <ActivityRow tx={tx} variant="detail" onSelect={handleSelectTransaction} />
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
          <Text style={[styles.pageTitle, styles.textPrimary]}>Security</Text>
          <PolicyLinkButton onPress={() => setPolicyTopic('security')} />
        </View>
        <Text style={[styles.pageSubtitle, styles.textSecondary]}>Your keys, spending limits, and wallet lock</Text>
      </View>

      {/* 1. Status alert. Only the alarmed state is raised here: the green variant said
          the same thing as the Device Credentials card directly below it, so the top of
          the screen was spending two blocks on one fact. */}
      {isFrozen && (
        <HaptixAlert
          status="error"
          icon="lock"
          title={recoveryInFlight ? 'Recovery In Flight' : 'Wallet Locked'}
          message={
            recoveryInFlight
              ? 'A guardian recovery is holding this wallet frozen, so there is nothing to unlock here. Veto it, or let the timelock run out, in Settings \u2192 Recovery.'
              : 'Outgoing transactions and agent spending are paused on-chain. Nothing can leave the wallet while it is locked.'
          }
          action={
            recoveryInFlight
              ? {
                  label: 'Open Recovery',
                  onPress: () => router.push('/(tabs)/settings/recovery'),
                  variant: 'primary',
                }
              : {
                  label: 'Unlock Wallet',
                  onPress: handleToggleFreeze,
                  variant: 'primary',
                }
          }
        />
      )}

      {/* 2. Device Credentials Card */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Your Keys</Text>
        </View>

        {/* Primary Passkey */}
        <View style={styles.credentialCompactRow}>
          <View
            style={[styles.credentialIconWrap, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
          >
            <FingerScanBold size={18} color={theme.emerald} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.credentialName, styles.textPrimary]}>
              {activeWallet?.primaryPasskeyLabel ?? 'Primary device key'}
            </Text>
            <Text style={[styles.credentialSub, styles.textMuted]}>Unlocks with fingerprint or face</Text>
          </View>
        </View>

        <View style={[styles.securityRowDivider, styles.divider]} />

        {/* Secondary / backup device key */}
        <View style={styles.credentialCompactRow}>
          <View
            style={[styles.credentialIconWrap, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
          >
            <KeySquareBold size={18} color={theme.amber} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.credentialName, styles.textPrimary]}>
              {activeWallet?.secondaryPasskeyLabel ?? 'Backup device key'}
            </Text>
            <Text style={[styles.credentialSub, styles.textMuted]}>Your backup key, on this device</Text>
          </View>
          <View style={styles.quorumTag}>
            <Text style={styles.quorumTagText}>For large sends</Text>
          </View>
        </View>
      </View>

      {/* 3. Spending Policy Firewall (Stat Grid) */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Spending Limits</Text>
        </View>

        <View style={styles.policyStatsGrid}>
          {/* Tile 1: Fast-lane limit */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>One-Key Limit</Text>
            <Text style={[styles.policyStatValue, styles.textPrimary]}>≤ {spendThreshold} SOL</Text>
          </View>

          {/* Tile 2: High-value quorum */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>Larger Sends</Text>
            <Text style={[styles.policyStatValue, styles.textPrimary]}>Both keys</Text>
          </View>

          {/* Tile 3: Velocity circuit breaker */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>Rate Limit</Text>
            <Text style={[styles.policyStatValue, styles.textPrimary]}>5 tx / hr</Text>
          </View>

          {/* Tile 4: Agent spending cap */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>Agent Limit</Text>
            <Text style={[styles.policyStatValue, styles.textPrimary]}>
              ${(agentAllowance * solPriceUsd).toFixed(0)} / 24h
            </Text>
          </View>
        </View>
      </View>

      {/* 4. Wallet lock */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Wallet Lock</Text>
        </View>

        {/* Body copy rather than an alert panel: the amber box used to be the
            loudest thing in the card, out-shouting the destructive control under it. */}
        <Text style={[styles.panicExplain, styles.textSecondary]}>
          {isFrozen
            ? 'Transfers, swaps, and agent spending are paused. Hold below to unlock.'
            : 'Hold to pause every outgoing transaction and agent spend until you unlock.'}
        </Text>

        <HoldToConfirmButton
          label={isFrozen ? 'Hold to Unlock Wallet' : 'Hold to Lock Wallet'}
          confirmingLabel={isFrozen ? 'Unlocking on-chain...' : 'Freezing on-chain...'}
          completedLabel={isFrozen ? 'Wallet Unlocked' : 'Wallet Frozen'}
          // Deliberately not `danger`. Red is reserved for states that are already wrong,
          // and locking a wallet is a deliberate protective action, not an alarm. The hold
          // gesture is what stops this from being a casual tap.
          variant="primary"
          onConfirm={handleToggleFreeze}
        />
      </View>

      {/* 5. What is currently protecting the wallet. */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Active Protections</Text>
        </View>

        <View style={styles.auditLogRow}>
          <MaterialIcons name="check-circle" size={16} color={theme.emerald} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.auditLogText, styles.textPrimary]}>Passkey enrolled</Text>
            </View>
            <Text style={[styles.auditLogTime, styles.textMuted]}>Held in this device&apos;s secure chip</Text>
          </View>
        </View>

        <View style={[styles.securityRowDivider, styles.divider]} />

        {/* Both rows describe the chain, so both read live state. The limits row used to
            be hardcoded true, which had a brand-new wallet claiming its limits were
            enforced on-chain on this page while the Home tab was still asking it to
            finish setup. */}
        <View style={styles.auditLogRow}>
          <MaterialIcons
            name={onChainWallet ? 'check-circle' : 'schedule'}
            size={16}
            color={onChainWallet ? theme.emerald : theme.amber}
          />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.auditLogText, styles.textPrimary]}>
                {onChainWallet ? 'Spending limits active' : 'Spending limits not active yet'}
              </Text>
            </View>
            <Text style={[styles.auditLogTime, styles.textMuted]}>
              {onChainWallet ? 'Enforced by the Solana program' : 'Finish setup on the Home tab to enforce them'}
            </Text>
          </View>
        </View>
      </View>
    </>
  )

  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

  const handleCloseSendSheet = useCallback(() => setShowSendModal(false), [])

  // The sheet reports a broadcast transfer back here rather than owning the result: the
  // balance and the activity list both outlive it, and the row has to appear in Activity
  // before the RPC index catches up with the signature.
  const handleTransferSent = useCallback(
    async (record: TransactionRecord) => {
      await fetchRealBalance()
      setTransactions((prev) => [record, ...prev])
    },
    [fetchRealBalance],
  )

  return (
    <View style={[styles.container, styles.container]}>
      {/* ==================================================================== */}
      {/* 1. ELEVATED CONSUMER HOME HEADER                                     */}
      {/* ==================================================================== */}
      <View style={[styles.header, styles.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.headerLeftGroup}>
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              // Settings, not Security. Security already owns a dock tab, so pointing the
              // wallet's identity chip at it meant two routes to the same page and none to
              // the one holding recovery, contacts and app preferences.
              router.push('/(tabs)/settings')
            }}
            activeOpacity={0.75}
          >
            <View style={[styles.avatarCircle, styles.elevatedCard, isFrozen && styles.avatarCircleAlert]}>
              <HaptixBrandMark size={16} color={isFrozen ? theme.roseText : theme.textPrimary} />
            </View>
          </TouchableOpacity>

          <View style={styles.identityTextGroup}>
            <Text style={[styles.headerWalletName, styles.textPrimary]} numberOfLines={1}>
              {activeWallet?.name || 'Haptix Wallet'}
            </Text>
            <TouchableOpacity
              style={[styles.addressCopyChip, styles.card]}
              onPress={handleCopyWalletAddress}
              activeOpacity={0.7}
            >
              <Text style={[styles.addressCopyText, styles.textMuted]}>
                {hasCopiedAddress ? 'Copied!' : ellipsify(activeWallet?.address || '', 4)}
              </Text>
              <CopyChipIcon size={11} color={hasCopiedAddress ? theme.accentForeground : theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.headerRight}>
          {/* Network Switcher Pill */}
          <TouchableOpacity
            style={[styles.networkPill, styles.elevatedCard]}
            onPress={() => {
              Haptics.selectionAsync()
              setNetwork((prev) => (prev === 'devnet' ? 'mainnet' : 'devnet'))
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Switch network, currently ${network === 'devnet' ? 'Devnet' : 'Mainnet'}`}
          >
            <View style={[styles.networkDot, network === 'mainnet' && { backgroundColor: theme.emerald }]} />
            <Text style={[styles.networkPillText, styles.textSecondary]}>
              {network === 'devnet' ? 'Devnet' : 'Mainnet'}
            </Text>
            {/* swap-horiz, not a chevron: this tap toggles the network in place, it does
                not open a menu, and the old keyboard-arrow-down promised one. */}
            <MaterialIcons name="swap-horiz" size={13} color={theme.textMuted} />
          </TouchableOpacity>

          {/* Quick Light/Dark Mode Switcher */}
          <ThemeToggleButton size="compact" showLabel={false} />

          {/* Overflow Menu Button */}
          <TouchableOpacity
            style={[styles.headerIconBtn, styles.iconBtn]}
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

      {/* FREEZE BANNER. A recovery holds the wallet frozen on purpose and the program
          refuses to unfreeze while one is pending, so the banner distinguishes the two
          cases and sends the recovery one to the screen that can actually resolve it --
          "Unlock" there would spend two passkey prompts on a transaction that can only
          be turned away. */}
      {isFrozen && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <HaptixAlert
            status="error"
            icon="lock"
            title={recoveryInFlight ? 'RECOVERY IN FLIGHT' : 'WALLET LOCKED'}
            message={
              recoveryInFlight
                ? 'A guardian recovery is holding this wallet frozen. Open Settings \u2192 Recovery to keep your current keys, or let the timelock run out.'
                : 'Nothing can leave this wallet while it is locked. Outgoing transactions and agent spending are paused on-chain.'
            }
            action={
              recoveryInFlight
                ? {
                    label: 'Open Recovery',
                    onPress: () => router.push('/(tabs)/settings/recovery'),
                    variant: 'primary',
                  }
                : {
                    label: 'Unlock',
                    onPress: handleToggleFreeze,
                    variant: 'primary',
                  }
            }
            style={{ marginBottom: 0 }}
          />
        </View>
      )}

      {/* RPC DEGRADED BANNER */}
      {rpcIssue && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <HaptixAlert
            status="warning"
            icon="cloud-off"
            title="Network trouble"
            message={rpcIssue}
            action={{
              label: 'Retry',
              onPress: onRefresh,
              loading: refreshing,
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
        style={[styles.scrollArea, styles.container]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 112 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
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
      {/* The sheet owns the send form, its validation, the fee quote and the address
          book shortcuts. Keeping that state out of this component is what stops a
          keystroke in the amount field from re-rendering the whole wallet. */}
      <HaptixSendSheet
        visible={showSendModal}
        onClose={handleCloseSendSheet}
        wallet={activeWallet}
        network={network}
        connection={connection}
        balance={balance}
        spendThreshold={spendThreshold}
        isFrozen={isFrozen}
        recoveryInFlight={recoveryInFlight}
        solPriceUsd={solPriceUsd}
        transactions={transactions}
        onTransferSent={handleTransferSent}
      />

      {/* ==================================================================== */}
      {/* 5. RECEIVE MODAL                                                     */}
      {/* ==================================================================== */}
      <Modal visible={showReceiveModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, styles.textPrimary]}>Receive Assets</Text>
              <TouchableOpacity onPress={() => setShowReceiveModal(false)}>
                <MaterialIcons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.receiveExplainerText, styles.textSecondary]}>
              Scan this QR code, or share the address with the person paying you.
            </Text>

            {/* Which network this address belongs to. The sheet said "on Solana" while the
                header behind it can be on devnet or mainnet, and the two get paid
                differently. */}
            <View style={styles.receiveMetaRow}>
              <View style={[styles.receiveNetworkPill, styles.input]}>
                <View
                  style={[
                    styles.networkDotSmall,
                    { backgroundColor: network === 'devnet' ? theme.accent : theme.emerald },
                  ]}
                />
                <Text style={[styles.receiveNetworkPillText, styles.textSecondary]}>
                  {network === 'devnet' ? 'Solana Devnet' : 'Solana Mainnet'}
                </Text>
              </View>
              <Text style={[styles.receiveMetaText, styles.textMuted]}>
                {activeWallet?.name ? activeWallet.name : 'Smart account'}
              </Text>
            </View>

            <View style={styles.qrContainer}>
              <AppQrCode value={activeWallet?.address || 'HaptixSolanaAddress'} />
            </View>

            <View style={[styles.addressDisplayBox, styles.input]}>
              <Text style={[styles.addressDisplayText, styles.textPrimary]} numberOfLines={1} ellipsizeMode="middle">
                {activeWallet?.address || ''}
              </Text>
            </View>

            {/* The one irreversible mistake an address screen can prevent. */}
            <View style={styles.receiveWarning}>
              <MaterialIcons name="warning-amber" size={13} color={theme.amber} />
              <Text style={[styles.receiveWarningText, styles.textSecondary]}>
                Only send SOL or SPL tokens on {network === 'devnet' ? 'Devnet' : 'Mainnet'} here. Assets from any other
                chain cannot be recovered.
              </Text>
            </View>

            <View style={{ width: '100%', gap: 10, marginTop: 14 }}>
              <CopyActionButton
                value={activeWallet?.address || ''}
                label="Copy Smart Account Address"
                copiedLabel="Address Copied to Clipboard!"
              />
              {/* Replaces a "Bookmark this address" button that only held local state: it
                  was never persisted anywhere, and bookmarking your own receive address
                  is not a thing anyone needs. Share is the action that was missing. */}
              <DepthOutlineButton title="Share Address" onPress={handleShareAddress} size="compact" />
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* 8. TRANSACTION DETAIL BOTTOM SHEET MODAL                             */}
      {/* ==================================================================== */}
      <Modal visible={showTxDetailModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, styles.textPrimary]}>Transaction Details</Text>
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
                  {(() => {
                    const detailTone = activityToneFor(selectedTransaction, theme)
                    const isValue = selectedTransaction.direction !== 'none' && selectedTransaction.amount > 0
                    return (
                      <>
                        <View style={[styles.txDetailIconCircle, { backgroundColor: detailTone.background }]}>
                          <MaterialIcons
                            name={activityIconFor(selectedTransaction)}
                            size={28}
                            color={detailTone.color}
                          />
                        </View>

                        <Text style={[styles.txDetailAmountText, styles.textPrimary]}>
                          {isValue
                            ? `${selectedTransaction.direction === 'receive' ? '+' : '-'}${selectedTransaction.amount.toFixed(4)} ${selectedTransaction.tokenSymbol}`
                            : 'No funds moved'}
                        </Text>

                        {isValue && selectedTransaction.tokenSymbol === 'SOL' && (
                          <Text style={[styles.txDetailFiatText, styles.textMuted]}>
                            ≈ ${(selectedTransaction.amount * solPriceUsd).toFixed(2)} USD
                          </Text>
                        )}

                        <View style={styles.txDetailConfirmedPill}>
                          <MaterialIcons
                            name={selectedTransaction.status === 'failed' ? 'error-outline' : 'verified'}
                            size={13}
                            color={selectedTransaction.status === 'failed' ? theme.roseText : theme.emeraldText}
                          />
                          <Text
                            style={[
                              styles.txDetailConfirmedText,
                              selectedTransaction.status === 'failed' ? { color: theme.roseText } : null,
                            ]}
                          >
                            {selectedTransaction.status === 'failed'
                              ? 'Failed on Solana Devnet'
                              : `Confirmed on Solana ${network === 'devnet' ? 'Devnet' : 'Mainnet'}`}
                          </Text>
                        </View>
                      </>
                    )
                  })()}
                </View>

                {/* Cryptographic Clearance Details Card */}
                <View style={[styles.securityGroupCard, styles.card]}>
                  <Text style={[styles.securityGroupLabel, styles.textMuted]}>HOW THIS WAS APPROVED</Text>

                  <View style={styles.specKeyValueRow}>
                    <Text style={[styles.specKeyText, styles.textSecondary]}>Approved by:</Text>
                    <Text style={[styles.specValueText, { color: theme.accent }]}>
                      {activitySecurityLabelFor(selectedTransaction)}
                    </Text>
                  </View>

                  <View style={styles.specKeyValueRow}>
                    <Text style={[styles.specKeyText, styles.textSecondary]}>Signature curve:</Text>
                    <Text style={[styles.specValueText, styles.textPrimary]}>NIST P-256 (Secp256r1)</Text>
                  </View>

                  <View style={styles.specKeyValueRow}>
                    <Text style={[styles.specKeyText, styles.textSecondary]}>Time:</Text>
                    <Text style={[styles.specValueText, styles.textPrimary]}>
                      {new Date(selectedTransaction.timestamp).toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Addresses & Signature Card */}
                <View style={[styles.securityGroupCard, styles.card]}>
                  <Text style={[styles.securityGroupLabel, styles.textMuted]}>ON-CHAIN IDENTIFIERS</Text>

                  {/* Recipient / Program */}
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[styles.specKeyText, styles.textMuted, { marginBottom: 4 }]}>Counterparty</Text>
                    <View style={[styles.addressCopyRow, styles.input]}>
                      <Text style={[styles.addressCopyRowText, styles.textPrimary]} numberOfLines={1}>
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
                    <Text style={[styles.specKeyText, styles.textMuted, { marginBottom: 4 }]}>
                      Transaction Signature
                    </Text>
                    <View style={[styles.addressCopyRow, styles.input]}>
                      <Text style={[styles.addressCopyRowText, styles.textPrimary]} numberOfLines={1}>
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
                      Linking.openURL(`https://explorer.solana.com/tx/${selectedTransaction.signature}?cluster=devnet`)
                    }
                  >
                    <MaterialIcons name="open-in-new" size={16} color={theme.accentForeground} />
                    <Text style={[styles.explorerButtonText, { color: theme.accentForeground }]}>
                      View on Solana Explorer
                    </Text>
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
          <View style={[styles.overflowSheet, styles.card, { bottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                handleCopyAddress()
              }}
            >
              <MaterialIcons name="content-copy" size={18} color={theme.textSecondary} />
              <Text style={[styles.overflowRowText, styles.textPrimary]}>Copy wallet address</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, styles.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                Linking.openURL(
                  `https://explorer.solana.com/address/${activeWallet?.address}?cluster=${
                    network === 'devnet' ? 'devnet' : 'mainnet-beta'
                  }`,
                )
              }}
            >
              <MaterialIcons name="open-in-new" size={18} color={theme.textSecondary} />
              <Text style={[styles.overflowRowText, styles.textPrimary]}>View on Solana Explorer</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, styles.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                setDockTab('security')
              }}
            >
              <MaterialIcons name="shield" size={18} color={theme.textPrimary} />
              <Text style={[styles.overflowRowText, styles.textPrimary]}>Security</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, styles.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                lockWallet()
              }}
            >
              <MaterialIcons name="lock" size={18} color={theme.textPrimary} />
              <Text style={[styles.overflowRowText, styles.textPrimary]}>Lock wallet (Safe Lock)</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, styles.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={() => {
                setShowOverflowMenu(false)
                router.push('/(tabs)/settings')
              }}
            >
              <MaterialIcons name="settings" size={18} color={theme.textPrimary} />
              <Text style={[styles.overflowRowText, styles.textPrimary]}>Settings</Text>
            </TouchableOpacity>

            <View style={[styles.overflowDivider, styles.divider]} />

            <TouchableOpacity
              style={styles.overflowRow}
              onPress={async () => {
                setShowOverflowMenu(false)
                confirmRemoveWallet(activeWallet?.address, async () => {
                  await deletePasskeys()
                  await signOut()
                  router.replace('/sign-in')
                })
              }}
            >
              <MaterialIcons name="delete-outline" size={18} color={theme.roseText} />
              <Text style={[styles.overflowRowText, { color: theme.roseText }]}>Remove from this device</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* ==================================================================== */}
      {/* UNIFIED POLICY / HELP SHEET                                          */}
      {/* ==================================================================== */}
      <HaptixPolicySheet topic={policyTopic} threshold={spendThreshold} onClose={() => setPolicyTopic(null)} />

      {/* ==================================================================== */}
      {/* 9. SAFE LOCK FULLSCREEN OVERLAY                                      */}
      {/* ==================================================================== */}
      {isLocked && (
        <Modal visible={isLocked} animationType="fade" transparent={false}>
          <View style={[styles.safeLockContainer, styles.container]}>
            <View style={[styles.safeLockCard, styles.card]}>
              <View
                style={[
                  styles.safeLockIconWrap,
                  { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
                ]}
              >
                <HaptixBrandMark size={32} color={theme.accent} />
              </View>
              <Text style={[styles.safeLockTitle, styles.textPrimary]}>Wallet Locked</Text>
              <Text style={[styles.safeLockSubtitle, styles.textSecondary]}>Protected by your device passkey</Text>
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
      {!isLocked && <HaptixFloatingDock activeTab={dockTab} onSelectTab={handleDockSelect} />}
    </View>
  )
}

function PolicyLinkButton({ onPress }: { onPress: () => void }) {
  const { theme } = useAppTheme()
  const styles = useWalletStyles()
  return (
    <TouchableOpacity
      style={[styles.policyLink, { borderColor: theme.borderDefault, backgroundColor: theme.accentLight }]}
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
