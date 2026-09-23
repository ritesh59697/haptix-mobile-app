import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
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
  KeyboardAvoidingView,
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
import {
  MAX_SOLANA_ADDRESS_LENGTH,
  RecipientSource,
  describeRecipientSource,
  isSolanaAddress,
  parseRecipientInput,
} from '@/utils/solana-address'
import { SolNameLookup, extractSolName, looksLikeSolName, resolveSolName } from '@/utils/solana-names'
import { TransferFeeEstimate, estimateTransferFee } from '@/utils/solana-fees'
import {
  ContactEntry,
  MAX_VISIBLE_RECIPIENTS,
  findContact,
  rankRecipients,
  sanitizeContactLabel,
} from '@/utils/contact-list'
import { deleteContact, loadContacts, saveContact, touchContact } from '@/utils/haptix-address-book'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import {
  StagedRecoveryKeys,
  commitStagedRecoveryKeys,
  discardStagedRecoveryKeys,
  loadStagedRecoveryKeys,
  deletePasskeys,
  promptBiometricAuth,
  signWithPasskey,
  stageRecoveryKeys,
} from '@/utils/haptix-passkey'
import { useAppTheme } from '@/components/theme/theme-context'
import {
  PrismDepthButton,
  DepthOutlineButton,
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
  getRevokeAgentSignedMessage,
  createRevokeAgentSessionInstruction,
  createInitiateRecoveryInstruction,
  createCancelRecoveryInstruction,
  createExecuteRecoveryInstruction,
  getCancelRecoverySignedMessage,
  createSetGuardianInstruction,
  getSetGuardianSignedMessage,
  parseGuardianAddress,
  WalletState,
  AgentSessionState,
} from '@/utils/haptix-client'
import { getFundedDevnetPayer, fundDevnetWallet } from '@/utils/haptix-funder'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { describeTimelock, parseTimelockInput } from '@/utils/recovery-timelock'
import { SWAP_COMING_SOON_LABEL } from '@/utils/haptix-swap'
import { MarketSnapshot, fallbackMarketSnapshot, fetchMarketSnapshot } from '@/utils/haptix-prices'
import {
  TransactionRecord,
  TransactionType,
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
import { HaptixIosTabs } from './haptix-ios-tabs'
import { HaptixPolicySheet, PolicyTopic } from './haptix-policy-sheet'
import { HaptixAlert } from './haptix-alert'
import { AppConfig } from '@/constants/app-config'
import { useHaptixDialog } from './haptix-dialog'
import { useConfirmRemoveWallet } from './haptix-remove-wallet'
import { radius, space, typeScale, ThemeTokens } from '@/theme/tokens'

/** Human-readable remaining time for an agent session countdown. */
function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return 'Expired'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'agents', label: 'Agent Ops' },
  { id: 'security', label: 'Security' },
] as const

type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]['id']

const SECURITY_TYPES: TransactionType[] = ['freeze', 'unfreeze', 'init', 'recovery', 'policy']
const AGENT_TYPES: TransactionType[] = ['agent_trade', 'agent_session']
const MOVEMENT_TYPES: TransactionType[] = ['transfer', 'airdrop', 'swap']

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

// One network fee, named once. It was written out as a literal in four places (the
// percentage chips, the preview row's "$0.0007", the total-outflow sum and the
// affordability check), so "MAX" could set an amount the fee then pushed over the
// balance and the transfer failed at signing time with the button still enabled.
const SEND_NETWORK_FEE_SOL = 0.000005

// How many past recipients are *considered* as shortcuts. The visible row is shorter
// (MAX_VISIBLE_RECIPIENTS); this is just the candidate pool that complements the saved
// address book, read back from this wallet's own send history.
const MAX_RECENT_RECIPIENTS = 8

// Cards previously used three different horizontal insets (hero card 18, asset and
// activity lists 16, empty state 24), so their inner text columns did not line up
// down the page. Every card now shares this inset.
const CARD_PADDING_X = 18

// The four header controls (avatar, network chip, theme toggle, overflow menu) were
// 36/27/32/34dp tall with three different radii, which read as four unrelated chips
// rather than one control group. They all use this size now.
const HEADER_CONTROL_SIZE = 36

export function HaptixWalletScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { activeWallet, isLocked, lockWallet, unlockWallet, signOut, updateWallet } = useAuth()
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
  const [isSending, setIsSending] = useState(false)
  const [sendErrorMsg, setSendErrorMsg] = useState('')
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
  const [policyTopic, setPolicyTopic] = useState<PolicyTopic | null>(null)

  // Form Inputs
  const [sendRecipient, setSendRecipient] = useState('')
  const [sendAmountText, setSendAmountText] = useState('0.05')
  // Where the address came from (link, Solana Pay URI, a line of chat) so the sheet can
  // say what it did, and whether the user has already tried to paste or has left the
  // field -- an error while a 32-character address is half typed is just noise.
  const [sendRecipientSource, setSendRecipientSource] = useState<RecipientSource | null>(null)
  const [sendRecipientAttempted, setSendRecipientAttempted] = useState(false)
  const [sendRecipientBlurred, setSendRecipientBlurred] = useState(false)
  // Rejections that never reach the field (an empty clipboard, a link with no address in
  // it) still need to be visible, and `parseRecipientInput('')` has nothing to say yet.
  const [recipientAttemptError, setRecipientAttemptError] = useState('')
  // Saved recipients, loaded once and updated on save/remove.
  const [contacts, setContacts] = useState<ContactEntry[]>([])
  // Name resolution result for the current field contents, if it looks like an .sns/.sol name.
  const [nameLookup, setNameLookup] = useState<SolNameLookup | null>(null)
  const [isResolvingName, setIsResolvingName] = useState(false)
  // The address a `.sns`/`.sol` name resolved to, kept so the sheet can show both and
  // offer the name as the contact's label.
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  // Non-null while the "name this contact" row is open. The empty string means the row
  // is open with no name typed yet.
  const [pendingContactName, setPendingContactName] = useState<string | null>(null)
  // Live network fee for the transfer being previewed.
  const [feeEstimate, setFeeEstimate] = useState<TransferFeeEstimate | null>(null)

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

  // Session expiry countdown, and the recovery timelock while one is in flight. The
  // interval is scoped to the two places a countdown is actually on screen: ticking
  // every second for the whole app would re-render the entire screen (and every modal
  // in it) once a second, forever. Recovery is exempt from the agents-page scoping
  // because its window is a real deadline rather than a session readout — leaving it
  // to the agents page froze the number at whatever it read on arrival.
  const recoveryInFlight = onChainWallet !== null && onChainWallet.recoveryInitiatedAt !== 0n
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (dockTab !== 'agent' && !recoveryInFlight) return
    setNowSeconds(Math.floor(Date.now() / 1000))
    const interval = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [dockTab, recoveryInFlight])

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
            '2-of-2 actions (high-value sends, unlocking) will fail until this wallet is re-created here.'

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
              '2-of-2 actions will fail until the wallet is re-created from this device.',
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
        securityType: '2-of-2 Key Quorum',
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
      dialog.alert('Security Alert', 'Wallet is panic frozen. Session key delegation locked.')
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
        securityType: '2-of-2 Key Quorum',
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

  // Recipient typing. Addresses are pasted far more often than they are typed, and a
  // paste can arrive as a link, a chat line or an address wrapped over two lines. Any
  // edit longer than an address is parsed rather than stored verbatim; anything else
  // has its whitespace and invisible characters removed so the field always holds
  // something that can be compared character for character.
  const handleRecipientTextChange = (text: string) => {
    setSendRecipientSource(null)
    setRecipientAttemptError('')
    setSendRecipientAttempted(false)
    setSendRecipientBlurred(false)

    const direct = text.replace(/[\s\u200B-\u200D\uFEFF]+/g, '')
    if (isSolanaAddress(direct)) {
      setSendRecipient(direct)
      return
    }

    // A bulk insertion -- the OS paste menu, autofill, a drag -- that holds no address
    // is diagnosed and dropped instead of stored. It used to land in the field verbatim,
    // so a pasted explorer link sat there looking like a recipient until signing failed
    // on it. Typing one character at a time still stores partial input, so the field
    // never fights someone halfway through an address. A pasted `.sns`/`.sol` name is
    // left alone too: that is a name to resolve, not a mistake to reject.
    const bulkInserted = text.length - sendRecipient.length > 1 || text.includes('\n')
    if (bulkInserted && !looksLikeSolName(direct)) {
      const parsed = parseRecipientInput(text)
      if (parsed.address) {
        setSendRecipient(parsed.address)
        setSendRecipientSource(parsed.source)
        setSendRecipientAttempted(true)
        return
      }
      setRecipientAttemptError(parsed.error ?? 'That is not a Solana address.')
      setSendRecipientAttempted(true)
      return
    }

    setSendRecipient(direct)
  }

  // The Paste button used to store whatever the clipboard held. Pasting a Solscan link,
  // a `.sol` name or a stray tweet put that text in the recipient slot, where it looked
  // like a recipient and only failed at signing time. The clipboard is now parsed first:
  // an address is extracted and the field is filled, anything else leaves the field
  // untouched and explains itself.
  const handlePasteRecipient = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSendRecipientAttempted(true)
    setRecipientAttemptError('')
    setSendRecipientSource(null)

    const text = await Clipboard.getString()
    if (!text || !text.trim()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setRecipientAttemptError('There is nothing on the clipboard to paste.')
      return
    }

    const parsed = parseRecipientInput(text)
    if (!parsed.address) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setRecipientAttemptError(parsed.error ?? 'The clipboard does not contain a Solana address.')
      return
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setSendRecipient(parsed.address)
    setSendRecipientSource(parsed.source)
  }

  // A name typed or pasted into the field is resolved automatically rather than being
  // rejected as "not an address". The effect is debounced because a name is typed one
  // character at a time, and each lookup costs an RPC round trip.
  useEffect(() => {
    if (!showSendModal) return
    const name = looksLikeSolName(sendRecipient) ? extractSolName(sendRecipient) : null
    if (!name) {
      setNameLookup(null)
      setIsResolvingName(false)
      return
    }

    let cancelled = false
    setIsResolvingName(true)
    const timer = setTimeout(async () => {
      const lookup = await resolveSolName(connection, name)
      if (cancelled) return
      setIsResolvingName(false)
      setNameLookup(lookup)
      if (lookup.status === 'resolved' && lookup.address) {
        // Fill the field with the address but remember the name, so the preview can show
        // "Amit (ritesh.sns)" and the contact can be saved under a readable label.
        setSendRecipient(lookup.address)
        setResolvedName(lookup.name)
        setSendRecipientSource(null)
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sendRecipient, showSendModal, connection])

  // Load the address book once. Failures resolve to an empty book, never to an error
  // the send sheet would have to render.
  useEffect(() => {
    let cancelled = false
    void loadContacts().then((entries) => {
      if (!cancelled) setContacts(entries)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveContact = async (label: string | null) => {
    if (!recipientAddress) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    // An empty field means "use the name it resolved from", not "save it nameless".
    const typed = sanitizeContactLabel(label)
    const next = await saveContact(recipientAddress, typed ?? resolvedName)
    setContacts(next)
    setPendingContactName(null)
  }

  // Removing is destructive and expensive to undo by hand, so it asks first.
  const handleRemoveContact = (address: string, label: string | null) => {
    dialog.alert(
      'Remove saved recipient',
      `${label || ellipsify(address, 4)} will no longer appear as a shortcut. You can still send to the address by pasting it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void deleteContact(address).then(setContacts)
          },
        },
      ],
    )
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

  // On-chain Send Transaction via Haptix Anchor Program & Secp256r1 Precompile
  const handleSendTransaction = async () => {
    setSendErrorMsg('')
    if (isFrozen) {
      dialog.alert('Security Alert', 'Wallet is panic frozen. Outgoing transfers are locked on-chain.')
      return
    }

    const amt = parseFloat(sendAmountText) || 0
    if (amt <= 0) {
      dialog.alert('Invalid Amount', 'Please enter a valid transfer amount.')
      return
    }

    if (amt > balance) {
      dialog.alert('Insufficient Funds', `You have ${balance.toFixed(4)} SOL available.`)
      return
    }

    const parsedRecipient = parseRecipientInput(sendRecipient)
    if (parsedRecipient.address && parsedRecipient.source !== 'raw') {
      // Take the address out of whatever was pasted rather than failing on the wrapper.
      setSendRecipient(parsedRecipient.address)
      setSendRecipientSource(parsedRecipient.source)
    }

    let toPubkey: PublicKey
    try {
      toPubkey = new PublicKey(sendRecipient.trim())
    } catch {
      // `parseRecipientInput` knows which mistake this is (0x address, .sol name, a
      // character that base58 does not contain); saying "invalid address" for all of
      // them was the reason a pasted link gave no clue what to fix.
      setSendRecipientAttempted(true)
      dialog.alert('Invalid Address', parsedRecipient.error ?? 'Please enter a valid Solana address.')
      return
    }

    if (!activeWallet?.address) {
      dialog.alert('Error', 'No active smart wallet found.')
      return
    }

    const walletPda = new PublicKey(activeWallet.address)
    const isHighRiskQuorum = amt > spendThreshold
    const amountLamports = BigInt(Math.round(amt * LAMPORTS_PER_SOL))

    try {
      setIsSending(true)
      await Haptics.impactAsync(
        isHighRiskQuorum ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
      )

      // Expected on-chain message payload: recipient (32B) || amount (8B LE)
      const message = getTransferSignedMessage(toPubkey, amountLamports)

      // 1. Primary Passkey authorization (Biometric challenge)
      const primarySig = await signWithPasskey(
        'primary',
        message,
        `Authorize ${amt} SOL transfer to ${ellipsify(toPubkey.toBase58(), 4)}`,
      )

      const precompilePrimary = createSecp256r1Instruction({
        ...primarySig,
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
          guardian: parseGuardianAddress(activeWallet.guardianAddress) ?? undefined,
        })
        txInstructions.push(initIx)
      }

      const primarySigIxIndex = needsInit ? 1 : 0
      const secondarySigIxIndex = needsInit ? (isHighRiskQuorum ? 2 : undefined) : isHighRiskQuorum ? 1 : undefined

      if (isHighRiskQuorum) {
        // 2. High-Risk: 2-of-2 passkey quorum required
        const secondarySig = await signWithPasskey(
          'secondary',
          message,
          `High-Value Quorum: Authorize ${amt} SOL transfer`,
        )

        const precompileSecondary = createSecp256r1Instruction({
          ...secondarySig,
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
          'confirmed',
        )
        .catch(() => null)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await fetchRealBalance()

      // Paying a saved recipient again is the signal that it is still current, so the
      // address book keeps it at the front of the shortcut row.
      if (contacts.some((entry) => entry.address === toPubkey.toBase58())) {
        void touchContact(toPubkey.toBase58()).then(setContacts)
      }

      setTransactions((prev) => [
        {
          signature: sig,
          type: 'transfer',
          direction: 'send',
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

      dialog.alert(
        'Transfer Confirmed On-Chain',
        `Sent ${amt} SOL.\n\n${
          isHighRiskQuorum ? 'Verified: 2-of-2 Passkey Quorum' : 'Verified: 1-Tap Secp256r1 Passkey'
        }\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () =>
              Linking.openURL(
                `https://explorer.solana.com/tx/${sig}?cluster=${network === 'devnet' ? 'devnet' : 'mainnet-beta'}`,
              ),
          },
          { text: 'Done', style: 'cancel' },
        ],
      )
    } catch (err: any) {
      console.error('[Haptix Send] Execution error:', formatChainErrorForLog(err))
      const errorText = describeChainError(err, 'The transfer could not be completed on-chain. Please try again.')
      setSendErrorMsg(errorText)
      dialog.alert('Transfer Failed', errorText)
    } finally {
      setIsSending(false)
    }
  }

  // Autonomous Agent Execution via On-Chain Program (Zero Passkey Prompts)
  const handleAgentExecute = async (recipientAddress: string) => {
    if (isFrozen) {
      dialog.alert('Security Alert', 'Wallet is panic frozen. Autonomous agents are locked on-chain.')
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
      const secondarySig = await signWithPasskey('secondary', grantMsg, '2-of-2 Quorum for AI Agent Session')

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

  const confirmRevokeAgentSession = (session: AgentSessionState) => {
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
  }

  // Revokes a delegated session key on-chain. This is the only way to actually
  // stop an agent: the key material lives with the agent, so the program has to
  // be told to stop honouring it.
  const handleRevokeAgentSession = async (agentPubkey: PublicKey) => {
    if (!activeWallet?.address) return
    const walletPda = new PublicKey(activeWallet.address)

    try {
      setRevokingAgent(agentPubkey.toBase58())
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const message = getRevokeAgentSignedMessage(agentPubkey)
      const primarySig = await signWithPasskey('primary', message, 'Revoke Agent Session (Primary)')
      const secondarySig = await signWithPasskey('secondary', message, '2-of-2 Quorum: Revoke Agent Session')

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
          securityType: '2-of-2 Key Quorum',
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
  }

  // Toggle Panic Freeze on Solana Devnet
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
          'A guardian recovery is holding this wallet frozen. Use Veto (2-of-2) to cancel it, or wait out the timelock and Execute Recovery — either of those unfreezes the wallet.',
        )
        return
      }

      if (!isFrozen) {
        // A panic freeze is guardian-gated on-chain, so it can only be submitted by
        // whoever holds the guardian key. It used to sign with the fee payer and assume
        // the two were the same account, which quietly turned into a failing transaction
        // for any wallet whose guardian is a real third party.
        if (!guardianSigner) {
          dialog.alert(
            'Guardian Not On This Device',
            `Panic Freeze is signed by this wallet's guardian (${
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
            recipientOrSender: 'Guardian Circuit Breaker',
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: 'Guardian Emergency Panic',
          },
          ...prev,
        ])

        dialog.alert(
          'Emergency Panic Freeze Activated',
          `Smart wallet is now locked on-chain.\n\nOutgoing transactions and agent sessions are blocked.\n\nTx: ${ellipsify(sig, 8)}`,
        )
      } else {
        // Unfreeze requires a 2-of-2 passkey quorum
        const unfreezeMsg = new Uint8Array(Buffer.from('UNFREEZE_WALLET'))

        const primarySig = await signWithPasskey('primary', unfreezeMsg, 'Authorize Wallet Unfreeze (Primary)')
        const secondarySig = await signWithPasskey(
          'secondary',
          unfreezeMsg,
          'Authorize Wallet Unfreeze (Secondary Quorum)',
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
            recipientOrSender: 'Smart Account Quorum Unfreeze',
            timestamp: Date.now(),
            status: 'confirmed',
            securityType: '2-of-2 Key Quorum',
          },
          ...prev,
        ])

        dialog.alert(
          'Smart Wallet Unfrozen',
          `Verified 2-of-2 passkey quorum.\nWallet operations restored.\n\nTx: ${ellipsify(sig, 8)}`,
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

  // --- Guardian social recovery -------------------------------------------
  // The guardian can start a recovery and nothing else: executing waits out the
  // timelock, and a veto is signed by the very keys being replaced, so a compromised
  // guardian cannot finish a takeover. This device can only play the guardian when it
  // actually holds the guardian key, which on Devnet it does -- wallets are created with
  // the bundled dev key as guardian. A release build cannot sign as a guardian at all,
  // and says so rather than offering a button that would fail every time.
  const [recoveryBusy, setRecoveryBusy] = useState<null | 'initiate' | 'cancel' | 'execute'>(null)
  const [stagedRecovery, setStagedRecovery] = useState<StagedRecoveryKeys | null>(null)
  const [guardianSigner, setGuardianSigner] = useState<Keypair | null>(null)
  const [guardianDraft, setGuardianDraft] = useState('')
  const [showGuardianEditor, setShowGuardianEditor] = useState(false)
  const [guardianBusy, setGuardianBusy] = useState(false)

  /**
   * The guardian was write-once: `set_guardian` existed on-chain and in the IDL, but
   * nothing in the app could build the instruction, so every wallet stayed pointed at
   * whoever was configured at creation. That matters more than it sounds -- while the
   * guardian is a key this build also holds, starting a recovery and owning the wallet
   * are the same act, and the veto proves nothing. Pointing the guardian elsewhere is
   * what turns the recovery flow into a two-party one.
   */
  const guardianDraftParse = useMemo(() => parseRecipientInput(guardianDraft), [guardianDraft])

  const guardianAddress = onChainWallet?.guardian.toBase58() ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const payer = await getFundedDevnetPayer(connection).catch(() => null)
      if (cancelled) return
      setGuardianSigner(payer && guardianAddress && payer.publicKey.toBase58() === guardianAddress ? payer : null)
    })()
    return () => {
      cancelled = true
    }
  }, [connection, guardianAddress])

  // The recovery in flight may have been started from this device in an earlier session;
  // the keys it proposed live in the OS secure store, not in component state.
  useEffect(() => {
    let cancelled = false
    void loadStagedRecoveryKeys().then((keys) => {
      if (!cancelled) setStagedRecovery(keys)
    })
    return () => {
      cancelled = true
    }
  }, [onChainWallet?.recoveryInitiatedAt, activeWallet?.address])

  const recoveryWindow = useMemo(() => {
    if (!onChainWallet || onChainWallet.recoveryInitiatedAt === 0n) return null
    const unlockAt = Number(onChainWallet.recoveryInitiatedAt) + Number(onChainWallet.recoveryTimelock)
    return { unlockAt, secondsLeft: Math.max(0, unlockAt - nowSeconds) }
  }, [onChainWallet, nowSeconds])

  const runInitiateRecovery = async () => {
    if (!onChainWallet || !activeWallet?.address) return
    const guardian = guardianSigner ?? (await getFundedDevnetPayer(connection))
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

      const walletPda = new PublicKey(activeWallet.address)
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
      await fetchRealBalance()
      dialog.alert(
        'Recovery Started',
        `The guardian proposed a new key pair and the wallet is frozen for ${describeTimelock(onChainWallet.recoveryTimelock)}. You can veto it with both passkeys, or execute it once the window passes.\n\nTx: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'View on Explorer',
            onPress: () => Linking.openURL(`https://explorer.solana.com/tx/${sig}?cluster=devnet`),
          },
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
        `proposes a new key pair, this wallet freezes for ${describeTimelock(onChainWallet.recoveryTimelock)}, and you can still veto it with the current passkeys during that window.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start Recovery', style: 'destructive', onPress: () => void runInitiateRecovery() },
      ],
    )
  }

  const runCancelRecovery = async () => {
    if (!activeWallet?.address) return
    setRecoveryBusy('cancel')
    try {
      const walletPda = new PublicKey(activeWallet.address)
      const message = getCancelRecoverySignedMessage()

      const primarySig = await signWithPasskey('primary', message, 'Veto Guardian Recovery (Primary)')
      const secondarySig = await signWithPasskey('secondary', message, '2-of-2 Veto: Cancel Recovery')

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
      await fetchRealBalance()
      dialog.alert(
        'Recovery Cancelled',
        `Verified 2-of-2 passkey quorum and discarded the guardian's proposed keys. The wallet is unfrozen.\n\nTx: ${ellipsify(
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
      await fetchRealBalance()

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
        'The wallet cannot be its own guardian — a recovery would then need the wallet to authorize itself.',
      )
      return
    }

    setGuardianBusy(true)
    try {
      const walletPda = new PublicKey(activeWallet.address)
      const message = getSetGuardianSignedMessage(newGuardian)

      const primarySig = await signWithPasskey('primary', message, 'Change Guardian (Primary)')
      const secondarySig = await signWithPasskey('secondary', message, '2-of-2: Change Guardian')

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
      await fetchRealBalance()

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      dialog.alert(
        'Guardian Updated',
        `Verified 2-of-2 passkeys and set the guardian to ${ellipsify(parsed.address, 6)}.\n\n` +
          `That address can now start a recovery and nothing else. It cannot move funds, and this device ` +
          `no longer can — the button above will go dead unless the new guardian key is held here.\n\nTx: ${ellipsify(sig, 8)}`,
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
      `Recovery would be started by ${ellipsify(parsed.address, 6)} instead of ${ellipsify(onChainWallet.guardian.toBase58(), 6)}.\n\n` +
        'This needs both passkeys, because handing recovery to an address you do not control is the same as giving ' +
        'your wallet away. It cannot be undone without both passkeys either.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change Guardian', style: 'destructive', onPress: () => void runSetGuardian() },
      ],
      { status: 'warning' },
    )
  }

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

  // Live agent sessions, read straight from the on-chain account. The old
  // "2 Active" badge was hardcoded and appeared whenever the wallet had any
  // allowance configured, regardless of what was actually delegated.
  const agentSessions = useMemo(() => {
    const sessions = onChainWallet?.agents ?? []
    return [...sessions].sort((a, b) => Number(a.validUntil) - Number(b.validUntil))
  }, [onChainWallet])

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

  const sendAmountNum = parseFloat(sendAmountText) || 0
  const isSendQuorumRequired = sendAmountNum > spendThreshold

  // Recipient state, derived once and shared by the badge, the inline message, the
  // preview row and the send button, so those four can never disagree about whether the
  // address is usable -- the button used to look ready with a link sitting in the field.
  const recipientParse = useMemo(() => parseRecipientInput(sendRecipient), [sendRecipient])
  const recipientAddress = recipientParse.address
  const isRecipientSelf = !!recipientAddress && recipientAddress === activeWallet?.address
  // A `.sns`/`.sol` name is neither an address nor a mistake: it is looked up, so the
  // "not a Solana address" messaging has to stand down while that happens.
  const nameInput = looksLikeSolName(sendRecipient) ? extractSolName(sendRecipient) : null
  const savedContact = findContact(contacts, recipientAddress)
  // While an address is being typed it is invalid many times on the way to being valid,
  // so the error text waits until the paste was rejected, the field was left, or what is
  // in it is already longer than any address could be.
  const showRecipientError =
    !nameInput &&
    (!!recipientAttemptError ||
      (!!recipientParse.error &&
        (sendRecipientAttempted || sendRecipientBlurred || sendRecipient.trim().length > MAX_SOLANA_ADDRESS_LENGTH)))
  const recipientNotice = describeRecipientSource(sendRecipientSource)

  // Everything the fee is subtracted from: the balance chip, the percentage chips and the
  // affordability check all have to agree on what "all of it" means. The number is the
  // cluster's answer when it has one, and the base fee when it does not.
  const effectiveFeeSol = feeEstimate?.sol ?? SEND_NETWORK_FEE_SOL
  const isFeeLive = feeEstimate?.source === 'rpc'
  const maxSendableSol = Math.max(0, balance - effectiveFeeSol)
  const sendTotalSol = sendAmountNum > 0 ? sendAmountNum + effectiveFeeSol : 0
  const sendAmountError = (() => {
    if (sendAmountNum <= 0) return null
    if (sendTotalSol > balance) {
      return `That is more than your ${balance.toFixed(4)} SOL once the ${effectiveFeeSol} SOL network fee is included.`
    }
    return null
  })()

  // Recent recipients, read back from this wallet's own send history instead of a new
  // address book: the addresses are already stored per wallet and are exactly the ones
  // worth offering again. Invalid or self-referential entries are filtered out so a
  // shortcut can never re-introduce the garbage address the parser rejects.
  // Fee pricing sits here, below the recipient and amount derivations it reads. It
  // re-prices while the sheet is open because a blockhash is only good for ~60-90
  // seconds, and it prices the same message the wallet is about to sign.
  useEffect(() => {
    if (!showSendModal) return
    const feePayer = activeWallet?.address ? new PublicKey(activeWallet.address) : null
    const destination = recipientAddress ? new PublicKey(recipientAddress) : feePayer
    if (!feePayer || !destination) return

    let cancelled = false
    const price = async () => {
      const estimate = await estimateTransferFee(connection, {
        feePayer,
        destination,
        lamports: BigInt(Math.max(1, Math.round((sendAmountNum || 0.000001) * LAMPORTS_PER_SOL))),
      })
      if (!cancelled) setFeeEstimate(estimate)
    }
    void price()
    const interval = setInterval(price, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [showSendModal, connection, activeWallet?.address, recipientAddress, sendAmountNum])

  const recentRecipients = useMemo(() => {
    const seen = new Set<string>()
    const recipients: string[] = []
    for (const tx of transactions) {
      if (tx.direction !== 'send') continue
      const candidate = (tx.recipientOrSender || '').trim()
      if (!isSolanaAddress(candidate)) continue
      if (candidate === activeWallet?.address) continue
      if (seen.has(candidate)) continue
      seen.add(candidate)
      recipients.push(candidate)
      if (recipients.length >= MAX_RECENT_RECIPIENTS) break
    }
    return recipients
  }, [transactions, activeWallet?.address])

  // Saved contacts first, history after: a name the user typed beats an address they
  // happened to pay once, and both are capped to one row of chips.
  const recipientShortcuts = useMemo(
    () => rankRecipients(contacts, recentRecipients, MAX_VISIBLE_RECIPIENTS, activeWallet?.address),
    [contacts, recentRecipients, activeWallet?.address],
  )

  const activityTitleFor = (tx: TransactionRecord) => {
    if (tx.type === 'freeze') return 'Emergency Freeze'
    if (tx.type === 'unfreeze') return 'Smart Wallet Unlocked'
    if (tx.type === 'init') return 'On-Chain Setup'
    if (tx.type === 'airdrop') return 'Devnet Faucet'
    if (tx.type === 'agent_trade') return 'Agent Auto-Trade'
    if (tx.type === 'agent_session') return 'Agent Session Granted'
    if (tx.type === 'recovery') return 'Guardian Recovery'
    if (tx.type === 'policy') return 'Policy Updated'
    if (tx.type === 'swap') return 'Token Swap'
    return tx.direction === 'receive' ? 'Received SOL' : 'Transfer SOL'
  }

  // Rows derive their icon, colour and amount from the parsed on-chain data, so
  // a failed or no-value transaction can never render as a completed transfer.
  const activityIconFor = (tx: TransactionRecord): React.ComponentProps<typeof MaterialIcons>['name'] => {
    if (tx.type === 'freeze') return 'lock'
    if (tx.type === 'unfreeze') return 'lock-open'
    if (tx.type === 'init') return 'verified-user'
    if (tx.type === 'recovery') return 'health-and-safety'
    if (tx.type === 'policy') return 'tune'
    if (tx.type === 'agent_trade') return 'smart-toy'
    if (tx.type === 'agent_session') return 'vpn-key'
    if (tx.direction === 'receive') return 'arrow-downward'
    if (tx.direction === 'send') return 'arrow-outward'
    return 'receipt-long'
  }

  // Icon chips share one surface and carry their meaning in the icon colour. Tinting
  // every inflow emerald turned the list into a grid of muddy green circles, and a
  // tinted chip stopped meaning anything once most rows had one. Only the alarmed
  // states fill their chip, so a filled chip is now the thing worth noticing.
  const activityToneFor = (tx: TransactionRecord) => {
    const negative = tx.status === 'failed' || tx.type === 'freeze'
    const positive = tx.status !== 'failed' && (tx.direction === 'receive' || tx.type === 'unfreeze')
    if (negative) {
      return { color: theme.roseText, background: theme.roseBg, border: theme.roseBorder }
    }
    return {
      color: positive ? theme.emeraldText : theme.textPrimary,
      background: theme.bgElevated,
      border: theme.borderDefault,
    }
  }

  const activityAmountFor = (tx: TransactionRecord) => {
    if (tx.direction === 'none' || tx.amount <= 0) return '\u2014'
    return `${tx.direction === 'receive' ? '+' : '-'}${tx.amount.toFixed(4)} ${tx.tokenSymbol}`
  }

  const renderWalletHome = () => (
    <>
      {/* HERO BALANCE CARD */}
      <View style={[styles.heroCard, styles.card]}>
        <View style={styles.heroTopRow}>
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

          <View style={[styles.heroBadgePill, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
            <Text style={[styles.heroBadgeText, styles.textSecondary]}>
              {network === 'devnet' ? 'Devnet' : 'Mainnet'}
            </Text>
          </View>
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
              // The recipient and its validation flags are cleared on open, so a sheet
              // that was closed on a half-typed address does not reopen already shouting.
              setSendRecipient('')
              setSendRecipientSource(null)
              setRecipientAttemptError('')
              setSendRecipientAttempted(false)
              setSendRecipientBlurred(false)
              setSendErrorMsg('')
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

        {/* On-Chain Program Deployment & Status Badge */}
        {network === 'devnet' && (
          <View
            style={[
              styles.onChainStatusBanner,
              { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View
                style={[styles.onChainStatusDot, { backgroundColor: onChainWallet ? theme.emerald : theme.amber }]}
              />
              <Text
                // The dot carries the state; the label stays neutral. Green body text on
                // every card competes with the accent colour that marks what is tappable.
                style={[styles.onChainStatusText, { color: onChainWallet ? theme.textSecondary : theme.amberText }]}
                numberOfLines={2}
              >
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
                <Text style={[styles.assetSecondaryTag, styles.textMuted]}>SOL · Solana</Text>
              </View>
            </View>
            <View style={styles.assetRight}>
              <Text style={[styles.assetCryptoAmount, styles.textPrimary]}>{balance.toFixed(4)} SOL</Text>
              <Text style={[styles.assetFiatAmount, styles.textSecondary]}>
                ≈ ${(balance * solPriceUsd).toFixed(2)}
              </Text>
            </View>
          </View>

          <View style={[styles.assetDivider, styles.divider]} />

          {/* USD Coin Row */}
          <View style={styles.assetRow}>
            <View style={styles.assetLeft}>
              <View
                style={[styles.assetLogoWrap, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
              >
                <UsdcTokenLogo size={24} />
              </View>
              <View>
                <Text style={[styles.assetPrimaryName, styles.textPrimary]}>USD Coin</Text>
                <Text style={[styles.assetSecondaryTag, styles.textMuted]}>USDC · Circle</Text>
              </View>
            </View>
            {/* USDC balances are not read or held anywhere yet, so this row
                reports its status instead of a hardcoded 0.00. */}
            <View style={styles.assetRight}>
              <Text style={[styles.assetCryptoAmount, styles.textMuted]}>{SWAP_COMING_SOON_LABEL}</Text>
              <Text style={[styles.assetFiatAmount, styles.textMuted]}>Not tracked yet</Text>
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
          {transactions.slice(0, 3).map((tx, idx) => {
            const tone = activityToneFor(tx)
            return (
              <React.Fragment key={tx.signature || idx}>
                {idx > 0 && <View style={[styles.assetDivider, styles.divider]} />}
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
                        { backgroundColor: tone.background, borderColor: tone.border },
                      ]}
                    >
                      <MaterialIcons name={activityIconFor(tx)} size={18} color={tone.color} />
                    </View>
                    <View>
                      <Text style={[styles.activityItemTitle, styles.textPrimary]}>{activityTitleFor(tx)}</Text>
                      <Text style={[styles.activityItemDate, styles.textMuted]}>
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
                      tx.direction === 'receive' && tx.status !== 'failed'
                        ? { color: theme.emeraldText, fontWeight: '700' }
                        : tx.status === 'failed'
                          ? { color: theme.roseText, fontWeight: '700' }
                          : styles.textPrimary,
                    ]}
                  >
                    {tx.status === 'failed' ? 'Failed' : activityAmountFor(tx)}
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
              <Text style={[styles.agentHeroTitle, styles.textPrimary]}>Spending Firewall</Text>
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
            <View style={[styles.agentStatusDot, { backgroundColor: isFrozen ? theme.rose : theme.emerald }]} />
            <Text style={[styles.agentStatusText, { color: isFrozen ? theme.roseText : theme.textSecondary }]}>
              {isFrozen ? 'Panic Frozen' : 'Firewall Active'}
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
            <Text style={[styles.agentPolicyPillText, styles.textSecondary]}>Fast-Lane: ≤ {spendThreshold} SOL</Text>
          </View>

          <View style={[styles.agentPolicyPill, styles.elevatedCard]}>
            <MaterialIcons name="shield" size={14} color={theme.amber} />
            <Text style={[styles.agentPolicyPillText, styles.textSecondary]}>Quorum: &gt; {spendThreshold} SOL</Text>
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
            const remainingSeconds = Math.max(0, Number(session.validUntil) - nowSeconds)
            const remainingAllowance = Number(session.allowanceLamports) / LAMPORTS_PER_SOL
            const isRevoking = revokingAgent === sessionKey

            return (
              <View key={sessionKey}>
                {index > 0 && <View style={[styles.agentRowDivider, styles.divider]} />}
                <View style={styles.agentCompactRow}>
                  <View
                    style={[
                      styles.agentCompactIcon,
                      {
                        backgroundColor: isExpired ? theme.roseBg : theme.bgElevated,
                        borderColor: isExpired ? theme.roseBorder : theme.borderDefault,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name={isExpired ? 'timer-off' : 'vpn-key'}
                      size={18}
                      color={isExpired ? theme.rose : theme.emerald}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.agentCompactName, styles.textPrimary]}>{ellipsify(sessionKey, 6)}</Text>
                    <Text style={[styles.agentCompactSub, styles.textMuted]}>
                      {remainingAllowance.toFixed(4)} SOL left ·{' '}
                      {isExpired ? 'Expired' : `${formatRemainingTime(remainingSeconds)} left`}
                    </Text>
                    <Text style={[styles.agentCompactSub, styles.textMuted]}>
                      {session.allowedProgram.equals(SystemProgram.programId)
                        ? 'SOL transfers only'
                        : `Program ${ellipsify(session.allowedProgram.toBase58(), 4)}`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.agentRevokeBtn, { borderColor: theme.roseBorder }]}
                    onPress={() => confirmRevokeAgentSession(session)}
                    disabled={isRevoking}
                    accessibilityRole="button"
                    accessibilityLabel={`Revoke agent session ${ellipsify(sessionKey, 4)}`}
                  >
                    {isRevoking ? (
                      <ActivityIndicator size="small" color={theme.roseText} />
                    ) : (
                      <Text style={styles.agentRevokeBtnText}>Revoke</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
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
              2-of-2 Quorum
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

        {/* Panic Circuit Breaker */}
        <View style={{ marginTop: 4 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text
                style={[styles.agentActionTitle, isFrozen ? { color: theme.emeraldText } : { color: theme.roseText }]}
              >
                {isFrozen ? 'Wallet Is Locked' : 'Emergency Circuit Breaker'}
              </Text>
            </View>
            <Text style={[styles.emergencyTag, { color: isFrozen ? theme.emeraldText : theme.roseText }]}>
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
            On-chain activity verified by Secp256r1 passkey signatures
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
              const tone = activityToneFor(tx)
              const isAgent = AGENT_TYPES.includes(tx.type)
              const dayLabel = groupLabel(tx.timestamp)
              const showDayHeader = idx === 0 || dayLabel !== groupLabel(filtered[idx - 1].timestamp)

              return (
                <React.Fragment key={tx.signature || idx}>
                  {showDayHeader && <Text style={[styles.activityGroupLabel, styles.textMuted]}>{dayLabel}</Text>}
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
                          { backgroundColor: tone.background, borderColor: tone.border },
                        ]}
                      >
                        <MaterialIcons name={activityIconFor(tx)} size={18} color={tone.color} />
                      </View>
                      <View style={{ flexShrink: 1 }}>
                        <Text style={[styles.activityItemTitle, styles.textPrimary]}>{activityTitleFor(tx)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <Text style={[styles.activityItemDate, styles.textMuted]}>
                            {new Date(tx.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                          <Text style={styles.textMuted}>·</Text>
                          <Text
                            style={[styles.activitySecurityBadge, { color: isAgent ? theme.accent : theme.textMuted }]}
                            numberOfLines={1}
                          >
                            {tx.securityType || (isAgent ? 'Zero-Prompt' : 'Secp256r1')}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.activityRight}>
                      <Text
                        style={[
                          styles.activityAmount,
                          tx.status === 'failed'
                            ? { color: theme.roseText, fontWeight: '700' }
                            : tx.direction === 'receive'
                              ? { color: theme.emeraldText, fontWeight: '700' }
                              : styles.textPrimary,
                        ]}
                      >
                        {tx.status === 'failed' ? 'Failed' : activityAmountFor(tx)}
                      </Text>
                      <View style={styles.confirmedBadgeRow}>
                        <MaterialIcons
                          name={tx.status === 'failed' ? 'error-outline' : 'check'}
                          size={11}
                          color={tx.status === 'failed' ? theme.roseText : theme.textMuted}
                        />
                        <Text
                          style={[
                            styles.confirmedBadgeText,
                            { color: tx.status === 'failed' ? theme.roseText : theme.textMuted },
                          ]}
                        >
                          {tx.status === 'failed' ? 'Failed' : tx.status === 'finalized' ? 'Finalized' : 'Confirmed'}
                        </Text>
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
          <Text style={[styles.pageTitle, styles.textPrimary]}>Security & Protection</Text>
          <PolicyLinkButton onPress={() => setPolicyTopic('security')} />
        </View>
        <Text style={[styles.pageSubtitle, styles.textSecondary]}>
          Device credentials, on-chain policy firewall & emergency lock
        </Text>
      </View>

      {/* 1. Status alert. Only the alarmed state is raised here: the green variant said
          the same thing as the Device Credentials card directly below it, so the top of
          the screen was spending two blocks on one fact. */}
      {isFrozen && (
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
      )}

      {/* 2. Device Credentials Card */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Device Credentials</Text>
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
            <Text style={[styles.credentialSub, styles.textMuted]}>OS secure storage · Biometric-gated</Text>
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
            <Text style={[styles.credentialSub, styles.textMuted]}>OS secure storage · Quorum key</Text>
          </View>
          <View style={styles.quorumTag}>
            <Text style={styles.quorumTagText}>2-of-2 Quorum</Text>
          </View>
        </View>
      </View>

      {/* 3. Spending Policy Firewall (Stat Grid) */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>On-Chain Policy Firewall</Text>
        </View>

        <View style={styles.policyStatsGrid}>
          {/* Tile 1: Fast-lane limit */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>Fast-Lane Cap</Text>
            <Text style={[styles.policyStatValue, styles.textPrimary]}>≤ {spendThreshold} SOL</Text>
          </View>

          {/* Tile 2: High-value quorum */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>Quorum Escalation</Text>
            <Text style={[styles.policyStatValue, styles.textPrimary]}>2-of-2 Keys</Text>
          </View>

          {/* Tile 3: Velocity circuit breaker */}
          <View style={[styles.policyStatTile, styles.input]}>
            <Text style={[styles.policyStatLabel, styles.textSecondary]}>Velocity Breaker</Text>
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

      {/* 4. Guardian Social Recovery */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Guardian Social Recovery</Text>
          <View
            style={[
              styles.activeTag,
              onChainWallet
                ? { backgroundColor: 'transparent', borderColor: theme.borderDefault }
                : {
                    backgroundColor: theme.amberBg,
                    borderColor: theme.amberBorder,
                  },
            ]}
          >
            <Text style={[styles.activeTagText, { color: onChainWallet ? theme.textSecondary : theme.amberText }]}>
              {onChainWallet ? 'Active' : 'Not on-chain yet'}
            </Text>
          </View>
        </View>

        <View style={styles.recoveryDetailRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.recoveryDetailTitle, styles.textPrimary]}>1 Guardian</Text>
            <Text style={[styles.recoveryDetailDesc, styles.textMuted]}>Cannot spend funds</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={[styles.recoveryDetailTitle, styles.textPrimary]}>
              {onChainWallet ? describeTimelock(onChainWallet.recoveryTimelock) : '24h'} Timelock
            </Text>
            <Text style={[styles.recoveryDetailDesc, styles.textMuted]}>You can veto with 2-of-2</Text>
          </View>
        </View>

        {/* The program stores exactly one guardian and gives it no spending
            authority, so show who it actually is rather than a capability badge. */}
        <View style={[styles.recoveryGuardianRow, styles.input]}>
          <Text style={[styles.recoveryGuardianLabel, styles.textMuted]}>GUARDIAN</Text>
          <Text style={[styles.recoveryGuardianValue, styles.textPrimary]} numberOfLines={1} ellipsizeMode="middle">
            {onChainWallet ? ellipsify(onChainWallet.guardian.toBase58(), 6) : 'Set on first on-chain activation'}
          </Text>
          <Text style={[styles.recoveryGuardianNote, styles.textMuted]}>
            Can start a recovery and nothing else — it cannot move funds.
          </Text>
        </View>

        {/* Until the guardian can be pointed somewhere else, starting a recovery and
            owning the wallet are the same act on this build, because the Devnet guardian
            key ships inside it. This is where that stops being true. */}
        {onChainWallet && (
          <>
            <TouchableOpacity
              style={styles.guardianToggle}
              onPress={() => {
                Haptics.selectionAsync()
                setShowGuardianEditor((prev) => !prev)
              }}
              disabled={guardianBusy}
            >
              <Text style={styles.guardianToggleText}>
                {showGuardianEditor ? 'Cancel guardian change' : 'Change guardian'}
              </Text>
              <MaterialIcons
                name={showGuardianEditor ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={18}
                color={theme.textSecondary}
              />
            </TouchableOpacity>

            {showGuardianEditor && (
              <View style={styles.guardianEditor}>
                <View style={[styles.guardianInputRow, styles.input]}>
                  <TextInput
                    style={styles.guardianInput}
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
                    >
                      <MaterialIcons name="cancel" size={18} color={theme.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                <Text
                  style={[
                    styles.guardianHint,
                    guardianDraft.length > 0 && !guardianDraftParse.address
                      ? { color: theme.roseText }
                      : { color: theme.textMuted },
                  ]}
                >
                  {guardianDraft.trim().length === 0
                    ? 'A link or a message containing an address is read the same way a bare address is. Needs both passkeys.'
                    : (guardianDraftParse.error ??
                      `Guardian will become ${ellipsify(guardianDraftParse.address ?? '', 6)}.`)}
                </Text>

                <DepthOutlineButton
                  title={guardianBusy ? 'Changing…' : 'Update Guardian (2-of-2)'}
                  size="compact"
                  disabled={guardianBusy || !guardianDraftParse.address}
                  onPress={handleSetGuardian}
                />
              </View>
            )}
          </>
        )}

        {/* The one place recovery is reachable. Without this the program could rotate
            keys all day and no owner would ever be able to ask it to. */}
        {recoveryWindow ? (
          <View style={styles.recoveryPendingBox}>
            <View style={styles.recoveryPendingHeader}>
              <MaterialIcons name="lock-clock" size={16} color={theme.amberText} />
              <Text style={[styles.recoveryPendingTitle, { color: theme.amberText }]}>
                {recoveryWindow.secondsLeft > 0
                  ? `Recovery in flight · ${formatRemainingTime(recoveryWindow.secondsLeft)} left`
                  : 'Recovery in flight · timelock elapsed'}
              </Text>
            </View>
            <Text style={[styles.recoveryDetailDesc, styles.textMuted]}>
              {recoveryWindow.secondsLeft > 0
                ? 'The wallet is frozen. Veto with both passkeys, or wait out the window and execute.'
                : 'Executing installs the proposed keys and unfreezes the wallet.'}
            </Text>
            <View style={styles.recoveryActionRow}>
              <DepthOutlineButton
                title={recoveryBusy === 'cancel' ? 'Vetoing…' : 'Veto (2-of-2)'}
                size="compact"
                disabled={recoveryBusy !== null}
                onPress={() => void runCancelRecovery()}
              />
              <PrismDepthButton
                title={recoveryBusy === 'execute' ? 'Executing…' : 'Execute Recovery'}
                size="compact"
                disabled={recoveryBusy !== null || recoveryWindow.secondsLeft > 0}
                onPress={handleExecuteRecovery}
              />
            </View>
          </View>
        ) : (
          <View style={styles.recoveryActionRow}>
            <DepthOutlineButton
              title={recoveryBusy === 'initiate' ? 'Starting…' : 'Start Recovery (Guardian)'}
              size="compact"
              disabled={recoveryBusy !== null || !guardianSigner || !onChainWallet}
              onPress={handleStartRecovery}
            />
          </View>
        )}

        <Text style={[styles.recoveryDetailDesc, styles.textMuted]}>
          {!onChainWallet
            ? 'The guardian is recorded when the account is first created on-chain.'
            : guardianSigner
              ? 'This build holds the guardian key, so it can start and veto a recovery — that is what makes the flow testable end to end.'
              : 'Recovery is started by the guardian from their own device; this build cannot sign as it.'}
        </Text>
      </View>

      {/* 5. Emergency Panic Lock */}
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>Emergency Panic Lock</Text>
        </View>

        {/* Body copy rather than an alert panel: the amber box used to be the
            loudest thing in the card, out-shouting the destructive control under it. */}
        <Text style={[styles.panicExplain, styles.textSecondary]}>
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
      <View style={[styles.securitySectionCard, styles.card]}>
        <View style={styles.securitySectionHeader}>
          <Text style={[styles.securitySectionHeading, styles.textPrimary]}>On-Chain Attestations</Text>
        </View>

        <View style={styles.auditLogRow}>
          <MaterialIcons name="check-circle" size={16} color={theme.emerald} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.auditLogText, styles.textPrimary]}>Biometric Passkey Enrolled</Text>
            </View>
            <Text style={[styles.auditLogTime, styles.textMuted]}>Secp256r1 · OS secure storage</Text>
          </View>
        </View>

        <View style={[styles.securityRowDivider, styles.divider]} />

        <View style={styles.auditLogRow}>
          <MaterialIcons name="check-circle" size={16} color={theme.emerald} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.auditLogText, styles.textPrimary]}>2-of-2 Spending Policy Active</Text>
            </View>
            <Text style={[styles.auditLogTime, styles.textMuted]}>Secp256r1 on-chain verification · Devnet</Text>
          </View>
        </View>
      </View>
    </>
  )

  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

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
              setDockTab('security')
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
      <Modal visible={showSendModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.expandedModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.expandedSendSheet, styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

            {/* Modal Header */}
            <View style={styles.modalSheetHeader}>
              <View>
                <Text style={[styles.modalSheetTitle, styles.textPrimary]}>Send Solana</Text>
                <Text style={[styles.modalSheetSubtitle, styles.textMuted]}>Instant on-chain transfer via passkey</Text>
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
              <View style={[styles.sendHeroCard, styles.card]}>
                <View style={styles.sendTokenHeaderRow}>
                  <View style={[styles.sendTokenPill, styles.elevatedCard]}>
                    <Text style={[styles.sendTokenSymbol, styles.textPrimary]}>SOL</Text>
                    <Text style={[styles.sendTokenName, styles.textMuted]}>Solana</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      // Tapping "Available" fills the whole balance, which is always a
                      // hair more than the wallet can actually send once the fee is
                      // added. It fills the sendable maximum instead.
                      Haptics.selectionAsync()
                      setSendAmountText(maxSendableSol > 0 ? maxSendableSol.toFixed(4) : '0')
                    }}
                    style={styles.sendBalanceChip}
                  >
                    <Text style={[styles.sendBalanceLabel, styles.textSecondary]}>Available: </Text>
                    <Text style={[styles.sendBalanceValue, { color: theme.accent }]}>{balance.toFixed(4)} SOL</Text>
                  </TouchableOpacity>
                </View>

                {/* Big Amount Input */}
                <View style={styles.sendInputRow}>
                  <TextInput
                    style={[styles.sendBigInput, styles.textPrimary]}
                    value={sendAmountText}
                    onChangeText={setSendAmountText}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.textMuted}
                    selectionColor={theme.accent}
                    autoFocus={false}
                  />
                  <Text style={[styles.sendCurrencySuffix, styles.textSecondary]}>SOL</Text>
                </View>

                {/* Live USD Counter using swamimalode07/rare-ui/animated-counter */}
                <View style={styles.sendUsdEstimateRow}>
                  <Text style={[styles.sendUsdApprox, styles.textMuted]}>≈ </Text>
                  <AnimatedCounter
                    value={sendAmountNum * solPriceUsd}
                    decimals={2}
                    prefix="$"
                    suffix=" USD"
                    textStyle={[styles.sendUsdCounter, styles.textMuted]}
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
                      style={[styles.percentChip, styles.input]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        const val = Math.max(0, maxSendableSol * chip.fraction)
                        setSendAmountText(val > 0 ? val.toFixed(4) : '0')
                      }}
                    >
                      <Text style={[styles.percentChipText, styles.textSecondary]}>{chip.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* The button simply greyed out when the amount was over the balance, so an
                    amount typed by hand looked fine. Say what is wrong and by how much. */}
                {sendAmountError ? (
                  <View style={styles.fieldMessageRow}>
                    <MaterialIcons name="error-outline" size={13} color={theme.roseText} />
                    <Text style={[styles.fieldMessageText, { color: theme.roseText }]}>{sendAmountError}</Text>
                  </View>
                ) : null}
              </View>

              {/* RECIPIENT INPUT SECTION */}
              <View style={styles.inputSection}>
                <View style={styles.inputLabelRow}>
                  <Text style={[styles.inputLabel, styles.textMuted]}>RECIPIENT SOLANA ADDRESS</Text>
                  {recipientAddress ? (
                    <View style={styles.validBadge}>
                      <MaterialIcons name="check-circle" size={12} color={theme.emerald} />
                      <Text style={styles.validBadgeText}>Valid Address</Text>
                    </View>
                  ) : showRecipientError && recipientParse.error ? (
                    <View style={styles.invalidBadge}>
                      <MaterialIcons name="error-outline" size={12} color={theme.roseText} />
                      <Text style={styles.invalidBadgeText}>Not a Solana address</Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.inputBoxRow, styles.input]}>
                  <TextInput
                    style={[styles.modalInput, styles.textPrimary]}
                    value={sendRecipient}
                    onChangeText={handleRecipientTextChange}
                    onBlur={() => setSendRecipientBlurred(true)}
                    placeholder="Enter recipient base58 address"
                    placeholderTextColor={theme.textMuted}
                    selectionColor={theme.accent}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Recipient Solana address"
                  />
                  {recipientAddress && !isRecipientSelf ? (
                    <TouchableOpacity
                      style={styles.clearActionBtn}
                      onPress={() => {
                        Haptics.selectionAsync()
                        if (savedContact) {
                          handleRemoveContact(recipientAddress, savedContact.label)
                        } else {
                          setPendingContactName('')
                        }
                      }}
                      accessibilityLabel={savedContact ? 'Remove saved recipient' : 'Save this recipient'}
                    >
                      <MaterialIcons
                        name={savedContact ? 'bookmark' : 'bookmark-border'}
                        size={16}
                        color={savedContact ? theme.amber : theme.textMuted}
                      />
                    </TouchableOpacity>
                  ) : null}
                  {sendRecipient ? (
                    <TouchableOpacity
                      style={styles.clearActionBtn}
                      onPress={() => {
                        setSendRecipient('')
                        setSendRecipientSource(null)
                        setRecipientAttemptError('')
                        setSendRecipientAttempted(false)
                        setResolvedName(null)
                        setNameLookup(null)
                        setPendingContactName(null)
                      }}
                      accessibilityLabel="Clear recipient address"
                    >
                      <MaterialIcons name="cancel" size={16} color={theme.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.pasteActionBtn, { backgroundColor: theme.bgElevated }]}
                    onPress={handlePasteRecipient}
                    accessibilityLabel="Paste address from clipboard"
                  >
                    <Text style={[styles.pasteActionText, { color: theme.accent }]}>Paste</Text>
                  </TouchableOpacity>
                </View>

                {/* One message slot under the field: what the paste did, what a name
                    resolved to, or what is wrong. The previous sheet said nothing at all
                    about a rejected paste. */}
                {isResolvingName ? (
                  <View style={styles.fieldMessageRow}>
                    <ActivityIndicator size="small" color={theme.textMuted} />
                    <Text style={[styles.fieldMessageText, styles.textSecondary]}>
                      {`Resolving ${nameInput ?? 'name'}…`}
                    </Text>
                  </View>
                ) : nameLookup ? (
                  <View style={styles.fieldMessageRow}>
                    <MaterialIcons
                      name={nameLookup.status === 'resolved' ? 'check-circle' : 'error-outline'}
                      size={13}
                      color={nameLookup.status === 'resolved' ? theme.emerald : theme.roseText}
                    />
                    <Text
                      style={[
                        styles.fieldMessageText,
                        nameLookup.status === 'resolved' ? styles.textSecondary : { color: theme.roseText },
                      ]}
                    >
                      {nameLookup.message}
                    </Text>
                  </View>
                ) : recipientNotice ? (
                  <View style={styles.fieldMessageRow}>
                    <MaterialIcons name="auto-fix-high" size={13} color={theme.emerald} />
                    <Text style={[styles.fieldMessageText, styles.textSecondary]}>{recipientNotice}</Text>
                  </View>
                ) : recipientAttemptError || (showRecipientError && recipientParse.error) ? (
                  <View style={styles.fieldMessageRow}>
                    <MaterialIcons name="error-outline" size={13} color={theme.roseText} />
                    <Text style={[styles.fieldMessageText, { color: theme.roseText }]}>
                      {recipientAttemptError || recipientParse.error}
                    </Text>
                  </View>
                ) : isRecipientSelf ? (
                  // Not blocked: moving your own SOL back to yourself is a legitimate
                  // devnet test. It just is not worth a fee by accident.
                  <View style={styles.fieldMessageRow}>
                    <MaterialIcons name="info-outline" size={13} color={theme.amber} />
                    <Text style={[styles.fieldMessageText, { color: theme.amberText }]}>
                      That is this wallet&apos;s own address - the transfer would only cost the network fee.
                    </Text>
                  </View>
                ) : null}

                {/* Saving the current recipient. Opens in place, pre-filled with the name a
                    .sns/.sol lookup produced when there was one. */}
                {pendingContactName !== null && recipientAddress ? (
                  <View style={styles.contactSaveRow}>
                    <TextInput
                      style={[styles.contactSaveInput, styles.input]}
                      value={pendingContactName}
                      onChangeText={setPendingContactName}
                      placeholder={resolvedName ?? 'Name this recipient (optional)'}
                      placeholderTextColor={theme.textMuted}
                      selectionColor={theme.accent}
                      autoCapitalize="words"
                      autoCorrect={false}
                      maxLength={32}
                      accessibilityLabel="Contact name"
                    />
                    <View style={styles.contactSaveActions}>
                      <TouchableOpacity
                        style={styles.clearActionBtn}
                        onPress={() => setPendingContactName(null)}
                        accessibilityLabel="Cancel saving this recipient"
                      >
                        <MaterialIcons name="close" size={16} color={theme.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.clearActionBtn}
                        onPress={() => void handleSaveContact(pendingContactName)}
                        accessibilityLabel="Save recipient"
                      >
                        <MaterialIcons name="check" size={18} color={theme.emerald} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {/* Shortcuts: saved contacts first, then addresses this wallet has paid.
                    Only shown while the field is empty, so they never compete with what the
                    user is typing. Long-pressing a saved one offers to remove it. */}
                {!sendRecipient && recipientShortcuts.length > 0 ? (
                  <View style={styles.recentRecipientRow}>
                    <Text style={[styles.recentRecipientLabel, styles.textMuted]}>
                      {recipientShortcuts.some((entry) => entry.saved) ? 'Saved' : 'Recent'}
                    </Text>
                    {recipientShortcuts.map((entry) => {
                      const useShortcut = () => {
                        Haptics.selectionAsync()
                        setSendRecipient(entry.address)
                        setResolvedName(null)
                        setNameLookup(null)
                        setSendRecipientSource(null)
                        setRecipientAttemptError('')
                        setSendRecipientAttempted(true)
                      }
                      return entry.saved ? (
                        <TouchableOpacity
                          key={entry.address}
                          style={[styles.savedRecipientChip, styles.input]}
                          onPress={useShortcut}
                          onLongPress={() => handleRemoveContact(entry.address, entry.label)}
                          accessibilityLabel={`Send to ${entry.label ?? ellipsify(entry.address, 4)}. Long press to remove.`}
                        >
                          <MaterialIcons name="bookmark" size={12} color={theme.amber} />
                          <View style={styles.savedRecipientTextGroup}>
                            <Text style={[styles.savedRecipientLabel, styles.textPrimary]} numberOfLines={1}>
                              {entry.label ?? ellipsify(entry.address, 4)}
                            </Text>
                            <Text style={[styles.savedRecipientAddress, styles.textMuted]} numberOfLines={1}>
                              {ellipsify(entry.address, 4)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          key={entry.address}
                          style={[styles.recentRecipientChip, styles.input]}
                          onPress={useShortcut}
                          accessibilityLabel={`Use recent recipient ${ellipsify(entry.address, 4)}`}
                        >
                          <Text style={[styles.recentRecipientChipText, styles.textSecondary]}>
                            {ellipsify(entry.address, 4)}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                ) : null}
              </View>

              {/* EXPANDED TRANSACTION PREVIEW SECTION */}
              <View style={styles.previewSection}>
                <Text style={[styles.inputLabel, styles.textMuted, { marginBottom: 8 }]}>TRANSACTION PREVIEW</Text>
                <View style={[styles.previewCard, styles.card]}>
                  {/* Recipient Item. It showed a wallet avatar and the raw field contents,
                      so a pasted link or a half-typed address was previewed as if it were a
                      real recipient. Now the row reflects the parsed state. */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, styles.textMuted]}>Recipient</Text>
                    <View style={styles.previewValueRow}>
                      {recipientAddress ? (
                        <>
                          {/* A saved or resolved name is what the user recognises; the
                              address stays next to it so nothing is hidden. */}
                          {savedContact?.label || resolvedName ? (
                            <Text style={[styles.previewValueText, styles.textPrimary]}>
                              {`${savedContact?.label ?? resolvedName} · ${ellipsify(recipientAddress, 4)}`}
                            </Text>
                          ) : (
                            <Text style={[styles.previewValueText, styles.textPrimary]}>
                              {ellipsify(recipientAddress, 5)}
                            </Text>
                          )}
                        </>
                      ) : sendRecipient ? (
                        <>
                          <MaterialIcons name="error-outline" size={13} color={theme.roseText} />
                          <Text style={[styles.previewValueText, { color: theme.roseText }]}>Invalid address</Text>
                        </>
                      ) : (
                        <Text style={[styles.previewValueText, styles.textMuted]}>Not specified</Text>
                      )}
                    </View>
                  </View>

                  <View style={[styles.previewDivider, styles.divider]} />

                  {/* Transfer Value */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, styles.textMuted]}>Transfer Amount</Text>
                    <Text style={[styles.previewValueBold, styles.textPrimary]}>{sendAmountNum.toFixed(4)} SOL</Text>
                  </View>

                  <View style={[styles.previewDivider, styles.divider]} />

                  {/* Network & Speed */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, styles.textMuted]}>Network</Text>
                    <View style={styles.previewValueRow}>
                      <Text style={[styles.previewValueText, styles.textSecondary]}>
                        {network === 'devnet' ? 'Solana Devnet (Sub-second)' : 'Solana Mainnet'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.previewDivider, styles.divider]} />

                  {/* Network Fee, priced by the cluster. The old row printed a literal
                      "0.000005 SOL (~$0.0007)" that could not follow a fee change and did
                      not match the live price the rest of the sheet quotes. */}
                  <View style={styles.previewRow}>
                    <View style={styles.previewValueRow}>
                      <Text style={[styles.previewLabel, styles.textMuted]}>Estimated Fee</Text>
                      {isFeeLive ? (
                        <View style={styles.liveFeePill}>
                          <View style={[styles.liveFeeDot, { backgroundColor: theme.emerald }]} />
                          <Text style={[styles.liveFeeText, { color: theme.emeraldText }]}>live</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.previewValueText, styles.textSecondary]}>
                      {`${effectiveFeeSol} SOL (~$${(effectiveFeeSol * solPriceUsd).toFixed(4)})`}
                    </Text>
                  </View>

                  <View style={[styles.previewDivider, styles.divider]} />

                  {/* Security Clearance */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabel, styles.textMuted]}>Authorization</Text>
                    <View style={styles.securityBadgeRow}>
                      <MaterialIcons
                        name={isSendQuorumRequired ? 'security' : 'fingerprint'}
                        size={14}
                        color={isSendQuorumRequired ? theme.amber : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.securityBadgeText,
                          { color: isSendQuorumRequired ? theme.amberText : theme.textSecondary },
                        ]}
                      >
                        {isSendQuorumRequired ? '2-of-2 Key Quorum' : '1-Tap Biometric Passkey'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.previewDivider, styles.divider]} />

                  {/* Total Deduction with AnimatedCounter */}
                  <View style={styles.previewRow}>
                    <Text style={[styles.previewLabelBold, styles.textPrimary]}>Total Outflow</Text>
                    <AnimatedCounter
                      value={sendTotalSol}
                      decimals={4}
                      suffix=" SOL"
                      textStyle={[styles.previewTotalValue, styles.textPrimary]}
                    />
                  </View>
                </View>
              </View>

              {/* ERROR MESSAGE */}
              {sendErrorMsg ? (
                <View
                  style={{
                    marginTop: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: theme.roseBg,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: theme.roseText, fontSize: typeScale.body, textAlign: 'center' }}>
                    {sendErrorMsg}
                  </Text>
                </View>
              ) : null}

              {/* ACTION BUTTON */}
              <View style={{ marginTop: 14 }}>
                <PrismDepthButton
                  size="large"
                  title={isSendQuorumRequired ? 'Authorize 2-of-2 Key Quorum' : 'Sign & Send with Passkey'}
                  onPress={handleSendTransaction}
                  loading={isSending}
                  // A missing (or unusable) recipient is a reason not to send, so the button
                  // says so instead of appearing ready and failing after the tap.
                  disabled={isSending || sendAmountNum <= 0 || sendTotalSol > balance || !recipientAddress}
                />
                {!recipientAddress ? (
                  <Text style={[styles.actionHintText, styles.textMuted]}>
                    {sendRecipient
                      ? 'Enter a valid recipient address to continue.'
                      : 'Add a recipient address to continue.'}
                  </Text>
                ) : null}
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
                    const detailTone = activityToneFor(selectedTransaction)
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
                      {selectedTransaction.securityType || 'Secp256r1 Passkey'}
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
              <Text style={[styles.overflowRowText, styles.textPrimary]}>Security & Protection</Text>
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

// Status labels, tappable chips and mini stat tiles each get exactly one
// geometry. This family previously carried eleven hand-tuned padding pairs
// (vertical 2/3/4/5/6/7/8 against horizontal 6/7/8/9/10/12/14, spread over
// radii sm/md/xl), so two badges sitting in the same row never lined up, and
// "the same" tag looked different on the agents page than on the home page.
const TAG_SHAPE = {
  paddingHorizontal: space.sm,
  paddingVertical: space.xs,
  borderRadius: radius.pill,
} as const

const CHIP_SHAPE = {
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
  borderRadius: radius.pill,
} as const

const TILE_SHAPE = {
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
  borderRadius: radius.lg,
} as const

// This sheet is built per theme rather than declared once at module scope.
// The screen used to carry a second, Tailwind-ish palette inline (25 copies of
// #10B981, 21 of #FDA4AF, 33 rgba() tints) purely because a module-level
// StyleSheet.create cannot read the active theme -- and those hand-picked values
// were dark-only, so light mode rendered #FFFBEB and #ECFDF5 washes on white.
// Every colour below now resolves through theme/tokens.ts.
const createStyles = (theme: ThemeTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bgApp,
    },

    /* 1. ELEVATED CONSUMER HEADER */
    header: {
      backgroundColor: theme.bgApp,
      borderBottomColor: theme.borderSubtle,
      borderBottomWidth: 1,
      // Matches scrollContent so the brand chip lines up with the card edges below.
      paddingHorizontal: 20,
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
      borderColor: theme.roseBorder,
      backgroundColor: theme.roseBg,
    },
    identityTextGroup: {
      justifyContent: 'center',
    },
    headerWalletName: {
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
      // Was 140, measured against the old 15dp title. The name truncates on one
      // line, so the cap has to grow with the type it caps: 140 * (17/15).
      maxWidth: 160,
    },
    addressCopyChip: {
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      borderWidth: 1,
      marginTop: space.xxs,
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
      justifyContent: 'center',
      gap: 4,
      height: HEADER_CONTROL_SIZE,
      borderWidth: 1,
      paddingHorizontal: 10,
      borderRadius: radius.md,
    },
    networkDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: theme.amber,
    },
    networkPillText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    headerIconBtn: {
      width: HEADER_CONTROL_SIZE,
      height: HEADER_CONTROL_SIZE,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerIconBtnAlert: {
      borderColor: theme.roseBorder,
      backgroundColor: theme.roseBg,
    },

    /* EMERGENCY FREEZE BANNER */
    freezeAlertBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.roseBg,
      borderBottomWidth: 1,
      borderBottomColor: theme.roseBorder,
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    freezeAlertText: {
      color: theme.roseText,
      fontSize: typeScale.caption,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    freezeAlertAction: {
      color: theme.roseText,
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
      padding: CARD_PADDING_X,
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
      padding: 4,
    },
    heroBadgePill: { ...TAG_SHAPE, borderWidth: 1 },
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
      // The title stays on the card edge (like the segmented control above it) while the
      // "See all" action is pulled in to the card's inner content column, so it lines up
      // with the right-aligned amounts in the list below instead of the card's border.
      paddingRight: CARD_PADDING_X,
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
    trendBadge: { ...TAG_SHAPE, backgroundColor: theme.accentLight },
    trendBadgeText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    trendPositive: {
      color: theme.emeraldText,
    },
    trendNegative: {
      color: theme.roseText,
    },

    /* ASSETS LIST (CLEAN LIST WITHOUT CARD CLUTTER) */
    assetList: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingHorizontal: CARD_PADDING_X,
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
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
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
      gap: space.sm,
    },
    agentPolicyPill: {
      ...TILE_SHAPE,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
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
      borderWidth: 1,
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
    agentRevokeBtn: {
      ...CHIP_SHAPE,
      borderWidth: 1,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentRevokeBtnText: {
      color: theme.roseText,
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    agentRowDivider: {
      height: 1,
      marginVertical: 10,
    },
    quorumBadgeSmall: {
      ...TAG_SHAPE,
      borderWidth: 1,
    },
    agentChipSelectorRow: {
      flexDirection: 'row',
      gap: space.sm,
    },
    agentRecipientInput: {
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
      fontSize: typeScale.footnote,
    },
    agentRecipientHint: {
      fontSize: typeScale.caption,
      marginTop: 6,
    },
    agentBudgetChip: {
      ...CHIP_SHAPE,
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
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
    agentActionTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },
    agentActionSubtitle: {
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    agentFastLaneTestBtn: {
      ...CHIP_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
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
      paddingHorizontal: CARD_PADDING_X,
      paddingVertical: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyActivityTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
      marginTop: 8,
      textAlign: 'center',
    },
    emptyActivitySubtitle: {
      fontSize: typeScale.footnote,
      marginTop: 2,
      textAlign: 'center',
    },
    activityList: {
      borderWidth: 1,
      borderRadius: radius.lg,
      paddingHorizontal: CARD_PADDING_X,
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
      color: theme.textMuted,
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
      color: theme.textMuted,
      fontSize: typeScale.caption,
    },
    /* MODAL COMMON STYLES */
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.scrim,
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: theme.bgCard,
      borderColor: theme.borderDefault,
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
      color: theme.textMuted,
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
      backgroundColor: theme.scrim,
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
      ...CHIP_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
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
      color: theme.textMuted,
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
      color: theme.textMuted,
    },
    sendUsdEstimateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    sendUsdApprox: {
      fontSize: typeScale.body,
      color: theme.textMuted,
    },
    sendUsdCounter: {
      fontSize: typeScale.body,
      fontWeight: '500',
      color: theme.textMuted,
    },
    percentageChipsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      gap: space.sm,
    },
    percentChip: {
      ...CHIP_SHAPE,
      flex: 1,
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
      color: theme.textSecondary,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    invalidBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    invalidBadgeText: {
      color: theme.roseText,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    /* One message slot under the recipient and amount fields, shared by the
       extraction notice, the rejection reason and the self-send warning. */
    fieldMessageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 8,
    },
    fieldMessageText: {
      flex: 1,
      fontSize: typeScale.footnote,
      lineHeight: 17,
    },
    recentRecipientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      marginTop: 10,
    },
    recentRecipientLabel: {
      fontSize: typeScale.caption,
      fontWeight: '600',
      letterSpacing: 0.4,
      marginRight: 2,
    },
    recentRecipientChip: {
      ...CHIP_SHAPE,
      borderWidth: 1,
    },
    recentRecipientChipText: {
      fontSize: typeScale.footnote,
      fontWeight: '500',
      fontFamily: 'SpaceMono',
    },
    /* A saved (named) shortcut reads as a name with its address underneath rather than
       as a hex blob, so the row is scannable and the address is still visible. */
    savedRecipientChip: {
      ...CHIP_SHAPE,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 180,
    },
    savedRecipientTextGroup: {
      flexShrink: 1,
    },
    savedRecipientLabel: {
      fontSize: typeScale.footnote,
      fontWeight: '600',
    },
    savedRecipientAddress: {
      fontSize: typeScale.caption,
      fontFamily: 'SpaceMono',
      marginTop: 1,
    },
    /* Inline "name this contact" row. It lives in the sheet instead of a dialog because
       the theme's dialog has no text input, and an address book without names is just
       another list of hex. */
    contactSaveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      marginTop: 10,
    },
    contactSaveInput: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: typeScale.body,
    },
    contactSaveActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    liveFeePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    liveFeeDot: {
      width: 5,
      height: 5,
      borderRadius: radius.pill,
    },
    liveFeeText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    actionHintText: {
      marginTop: 8,
      fontSize: typeScale.footnote,
      textAlign: 'center',
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
      color: theme.textMuted,
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
      color: theme.textSecondary,
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
      backgroundColor: theme.borderSubtle,
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
      backgroundColor: theme.emerald,
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
      borderWidth: 1,
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
    guardianToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    guardianToggleText: {
      color: theme.textSecondary,
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
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    guardianInput: { flex: 1, color: theme.textPrimary, fontSize: typeScale.caption, padding: 0 },
    guardianHint: {
      fontSize: typeScale.caption,
      lineHeight: 15,
      marginTop: 8,
      marginBottom: 12,
    },
    recoveryActionRow: {
      // Stacked, not side by side. Both buttons are `width: '100%'` with their label
      // clipped by `overflow: 'hidden'`, so sharing a row made the pair wider than the
      // box it sits in and "Execute Recovery" hung over the amber border. Full-width
      // rows also survive a large system font, which a 50/50 split would not.
      gap: 10,
      marginTop: 14,
    },
    recoveryPendingBox: {
      marginTop: 14,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: theme.amberBg,
      borderColor: theme.amberBorder,
    },
    recoveryPendingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    recoveryPendingTitle: {
      fontSize: typeScale.body,
      fontWeight: '700',
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
      backgroundColor: theme.accentLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    securityItemTitle: {
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },
    securityItemDesc: {
      color: theme.textMuted,
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
      color: theme.textMuted,
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
      color: theme.textMuted,
      fontSize: typeScale.caption,
      marginTop: 1,
    },
    activeTag: {
      ...TAG_SHAPE,
      backgroundColor: theme.emeraldBg,
      borderWidth: 1,
      borderColor: theme.emeraldBorder,
    },
    activeTagText: {
      color: theme.emeraldText,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    quorumTag: {
      ...TAG_SHAPE,
      // Quiet outline rather than a filled amber pill: the quorum is a standing
      // property of the wallet, not an alarm, and two filled amber chips on one
      // screen read as decoration instead of information.
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.amberBorder,
    },
    quorumTagText: {
      color: theme.amberText,
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    specInnerDivider: {
      height: 1,
      backgroundColor: theme.borderSubtle,
      marginVertical: 8,
    },
    specKeyValueRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
    },
    specKeyText: {
      color: theme.textMuted,
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
      color: theme.textMuted,
      fontSize: typeScale.footnote,
      lineHeight: 16,
      marginTop: 2,
    },
    panicBtn: {
      ...CHIP_SHAPE,
      backgroundColor: theme.bgElevated,
    },
    panicBtnActive: {
      backgroundColor: theme.roseSurface,
      borderWidth: 1,
      borderColor: theme.rose,
    },
    panicBtnText: {
      color: theme.roseText,
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
      color: theme.textSecondary,
      fontSize: typeScale.footnote,
      fontWeight: '500',
    },
    auditLogTime: {
      color: theme.textMuted,
      fontSize: typeScale.caption,
      marginTop: 2,
    },

    /* INPUTS & FORM MODALS */
    inputLabel: {
      color: theme.textMuted,
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
      color: theme.accent,
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
      ...CHIP_SHAPE,
      backgroundColor: theme.bgElevated,
    },
    pasteActionText: {
      color: theme.textPrimary,
      fontSize: typeScale.footnote,
      fontWeight: '600',
    },
    riskCardNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.accentLight,
      borderWidth: 1,
      borderColor: theme.borderDefault,
      borderRadius: radius.md,
      padding: 12,
      marginTop: 14,
      marginBottom: 20,
    },
    riskCardNoticeQuorum: {
      backgroundColor: theme.amberBg,
      borderColor: theme.amberBorder,
    },
    riskNoticeText: {
      flex: 1,
      color: theme.textSecondary,
      fontSize: typeScale.footnote,
      lineHeight: 16,
    },
    modalPrimaryActionBtn: {
      backgroundColor: theme.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 15,
      borderRadius: radius.lg,
    },
    modalPrimaryActionBtnText: {
      color: theme.accentForeground,
      fontSize: typeScale.title,
      fontWeight: '600',
    },

    /* RECEIVE MODAL */
    receiveExplainerText: {
      color: theme.textSecondary,
      fontSize: typeScale.body,
      lineHeight: 18,
      marginBottom: 16,
    },
    receiveMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      marginBottom: 14,
    },
    receiveNetworkPill: {
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
    },
    receiveNetworkPillText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    receiveMetaText: {
      flex: 1,
      fontSize: typeScale.caption,
      textAlign: 'right',
    },
    receiveWarning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: theme.amberBg,
      borderWidth: 1,
      borderColor: theme.amberBorder,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 14,
    },
    receiveWarningText: {
      flex: 1,
      fontSize: typeScale.caption,
      lineHeight: 16,
    },
    qrContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent,
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
      backgroundColor: theme.roseBg,
      borderWidth: 1,
      borderColor: theme.roseBorder,
      paddingVertical: 14,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    modalDangerBtnText: {
      color: theme.roseText,
      fontSize: typeScale.bodyLg,
      fontWeight: '600',
    },

    /* OVERFLOW MENU */
    menuBackdrop: {
      flex: 1,
      backgroundColor: theme.scrim,
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
      backgroundColor: theme.borderSubtle,
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
      color: theme.textSecondary,
      fontSize: typeScale.bodyLg,
      textAlign: 'center',
      marginBottom: 6,
    },
    safeLockWalletName: {
      color: theme.textMuted,
      fontSize: typeScale.body,
      fontWeight: '600',
      marginBottom: 26,
    },
    unlockButton: {
      width: '100%',
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: theme.accent,
      justifyContent: 'center',
      alignItems: 'center',
    },
    unlockButtonText: {
      color: theme.accentForeground,
      fontSize: typeScale.title,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    // On-Chain Deployment Banner
    onChainStatusBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
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
      flexShrink: 1,
    },
    deployPdaButton: {
      ...CHIP_SHAPE,
    },
    deployPdaButtonText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    // Activity Filters
    activityFilterRow: {
      flexDirection: 'row',
      gap: space.sm,
      marginBottom: space.md,
    },
    activityFilterChip: {
      ...CHIP_SHAPE,
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
      color: theme.emeraldText,
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
      ...TAG_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: theme.emeraldBg,
    },
    txDetailConfirmedText: {
      color: theme.emeraldText,
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
      color: theme.accentForeground,
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },

    /* Shared surface / text treatments.
     These used to live in a second style object built inline in JSX because a
     module-level StyleSheet could not see the palette. Now that the sheet is
     built from the theme, one mechanism covers both. */
    card: { backgroundColor: theme.bgCard, borderColor: theme.borderDefault },
    elevatedCard: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    textPrimary: { color: theme.textPrimary },
    textSecondary: { color: theme.textSecondary },
    textMuted: { color: theme.textMuted },
    input: { backgroundColor: theme.bgInput, borderColor: theme.borderDefault, color: theme.textPrimary },
    divider: { backgroundColor: theme.borderSubtle },
    iconBtn: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    actionBtn: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    actionBtnText: { color: theme.textPrimary },
  })

function useWalletStyles() {
  const { theme } = useAppTheme()
  return useMemo(() => createStyles(theme), [theme])
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
