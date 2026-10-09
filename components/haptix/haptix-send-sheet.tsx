import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  NativeModules,
  Keyboard,
} from 'react-native'
import { hexToBytes } from '@noble/curves/abstract/utils'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import * as Haptics from 'expo-haptics'
import Clipboard from '@/utils/clipboard'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { AnimatedCounter, PrismDepthButton } from '@/components/ui'
import { ellipsify } from '@/utils/ellipsify'
import {
  MAX_SOLANA_ADDRESS_LENGTH,
  RecipientSource,
  describeRecipientSource,
  isSolanaAddress,
  parseRecipientInput,
} from '@/utils/solana-address'
import { SolNameLookup, extractSolName, looksLikeSolName, resolveSolName } from '@/utils/solana-names'
import { FALLBACK_TRANSFER_FEE_LAMPORTS, TransferFeeEstimate, estimateTransferFee } from '@/utils/solana-fees'
import {
  ContactEntry,
  MAX_VISIBLE_RECIPIENTS,
  findContact,
  rankRecipients,
  sanitizeContactLabel,
} from '@/utils/contact-list'
import { deleteContact, loadContacts, saveContact, touchContact } from '@/utils/haptix-address-book'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import { signWithPasskey, PasskeySignature } from '@/utils/haptix-passkey'
import {
  findActiveRelayHost,
  queueVaultTransfer,
  pollVaultSignature,
  cancelVaultTransfer,
  parseManualSignaturePayload,
} from '@/utils/haptix-vault-relay'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { TransactionRecord } from '@/utils/haptix-tx-history'
import { HaptixWalletAccount } from '@/utils/haptix-wallet-storage'
import { AppConfig } from '@/constants/app-config'
import {
  createExecuteTransferInstruction,
  createInitializeWalletInstruction,
  assertRecoveryGuardian,
  clusterTagFromNetwork,
  fetchHaptixWallet,
  getTransferSignedMessage,
  parseGuardianAddress,
  WALLET_ACCOUNT_SPACE,
} from '@/utils/haptix-client'
import { getHaptixAddressLookupTable, buildOptimalTransaction } from '@/utils/haptix-lookup-table'
import { useHaptixDialog } from './haptix-dialog'
import { radius, space, typeScale, ThemeTokens } from '@/theme/tokens'
import { SKR_TOKEN_METADATA, USDC_TOKEN_METADATA } from '@/utils/haptix-tokens'
import { SeekerTokenLogo, SolanaTokenLogo, UsdcTokenLogo } from './haptix-icons'

// The fee quoted before the cluster has answered. `estimateTransferFee` prices the real
// message and falls back to this same base fee when the RPC cannot be reached, so the
// sheet quotes one number from one source. It used to hardcode 0.000005 here, which is
// how "MAX" could set an amount the fee then pushed over the balance.
const SEND_NETWORK_FEE_SOL = FALLBACK_TRANSFER_FEE_LAMPORTS / LAMPORTS_PER_SOL

// How many past recipients are *considered* as shortcuts. The visible row is shorter
// (MAX_VISIBLE_RECIPIENTS); this is just the candidate pool that complements the saved
// address book, read back from this wallet's own send history.
const MAX_RECENT_RECIPIENTS = 8

const CHIP_SHAPE = {
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
  borderRadius: radius.pill,
} as const

export interface HaptixSendSheetProps {
  /** Driven by the wallet screen's Send action. */
  visible: boolean
  onClose: () => void
  /** The smart wallet spending. Null while none is active, which blocks the send. */
  wallet: HaptixWalletAccount | null
  network: 'devnet' | 'mainnet'
  connection: Connection
  balance: number
  /** Seeker SKR token balance */
  skrBalance?: number
  onSkrBalanceChange?: (newBalance: number) => void
  /** USD Coin balance */
  usdcBalance?: number
  onUsdcBalanceChange?: (newBalance: number) => void
  /** SOL amount above which the program requires the 2-of-2 passkey quorum. */
  spendThreshold: number
  isFrozen: boolean
  /**
   * A guardian recovery freezes the wallet too, so a refused send has to name the real
   * cause instead of blaming the user's own panic freeze.
   */
  recoveryInFlight: boolean
  solPriceUsd: number
  /** This wallet's history, read back for the recent-recipient shortcuts. */
  transactions: TransactionRecord[]
  /**
   * Called once a transfer is broadcast. The screen re-reads the balance and prepends
   * the record to Activity, so the sheet owns neither of those.
   */
  onTransferSent: (record: TransactionRecord) => Promise<void> | void
}

/**
 * HaptixSendSheet
 *
 * The send flow used to live inside `haptix-wallet-screen.tsx` and read its form state
 * straight off the screen. Because the amount, the recipient and the recipient's
 * validation flags all sat in the screen component, every keystroke in either field
 * re-rendered the whole wallet -- header, dock, whichever page was open and the entire
 * activity list -- to update one `TextInput`. That state lives here now, so typing
 * re-renders this sheet and nothing else.
 *
 * The sheet stays mounted whether or not it is visible: `Modal` renders nothing while
 * `visible` is false, and staying mounted is what keeps the typed amount alive across a
 * close-and-reopen, exactly as it was when the screen owned the state.
 */
export function HaptixSendSheet({
  visible,
  onClose,
  wallet,
  network,
  connection,
  balance,
  skrBalance = 0,
  onSkrBalanceChange,
  usdcBalance = 0,
  onUsdcBalanceChange,
  spendThreshold,
  isFrozen,
  recoveryInFlight,
  solPriceUsd,
  transactions,
  onTransferSent,
}: HaptixSendSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()
  const dialog = useHaptixDialog()
  const styles = useSendSheetStyles()

  const [selectedToken, setSelectedToken] = useState<'SOL' | 'SKR' | 'USDC'>('SOL')
  const [showTokenMenu, setShowTokenMenu] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [sendStep, setSendStep] = useState<'idle' | 'primary' | 'secondary' | 'broadcasting'>('idle')
  const [sendErrorMsg, setSendErrorMsg] = useState('')
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
  const [confirmedTransfer, setConfirmedTransfer] = useState<{
    signature: string
    amount: number
    tokenSymbol: string
    recipientAddress: string
    isQuorum: boolean
    networkFee: string
  } | null>(null)
  const [copiedSig, setCopiedSig] = useState(false)
  const [copiedRecipient, setCopiedRecipient] = useState(false)

  const sendAbortRef = useRef(false)
  const currentRelayTxRef = useRef<{ relayHost: string; txId: string } | null>(null)

  const handleCancelSending = async () => {
    sendAbortRef.current = true
    if (currentRelayTxRef.current) {
      const { relayHost, txId } = currentRelayTxRef.current
      cancelVaultTransfer(relayHost, txId).catch(() => {})
      currentRelayTxRef.current = null
    }
    setIsSending(false)
    setSendStep('idle')
    setSendErrorMsg('Transfer cancelled.')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
  }

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

  // The screen cleared the recipient and its validation flags in the button handler that
  // opened this sheet. Now that the sheet owns them it clears on close instead of on
  // open, while it is hidden -- a sheet dismissed on a half-typed address used to come
  // back shouting that error in the first frame of the next slide-in. The amount is
  // deliberately left alone: re-sending the same size is the common case.
  useEffect(() => {
    if (visible) return
    panY.setValue(0)
    setSendRecipient('')
    setSendRecipientSource(null)
    setRecipientAttemptError('')
    setSendRecipientAttempted(false)
    setSendRecipientBlurred(false)
    setSendErrorMsg('')
    setShowTokenMenu(false)
    setConfirmedTransfer(null)
    setCopiedSig(false)
    setCopiedRecipient(false)
  }, [visible, panY])

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        return
      }
      setRecipientAttemptError(parsed.error ?? 'That is not a Solana address.')
      setSendRecipientAttempted(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
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
    Keyboard.dismiss()
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
    if (!visible) return
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
  }, [sendRecipient, visible, connection])

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

  // Recipient state, derived once and shared by the badge, the inline message, the
  // preview row and the send button, so those four can never disagree about whether the
  // address is usable -- the button used to look ready with a link sitting in the field.
  // It is derived above `handleSaveContact` because saving a contact needs the address.
  const recipientParse = useMemo(() => parseRecipientInput(sendRecipient), [sendRecipient])
  const recipientAddress = recipientParse.address

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

  // Initiate send flow by validating inputs and triggering on-chain passkey transfer directly
  const handleInitiateSendFlow = async () => {
    setSendErrorMsg('')
    sendAbortRef.current = false
    currentRelayTxRef.current = null
    if (isFrozen) {
      dialog.alert(
        'Wallet Locked',
        recoveryInFlight
          ? 'A guardian recovery is holding this wallet locked, so the transfer is refused on-chain. Open Settings \u2192 Recovery to see the deadline.'
          : 'Nothing can leave this wallet while it is locked. Unlock it to send again.',
      )
      return
    }

    const amt = parseFloat(sendAmountText) || 0
    if (amt <= 0) {
      dialog.alert('Invalid Amount', 'Please enter a valid transfer amount.')
      return
    }

    const available = selectedToken === 'SKR' ? skrBalance : balance
    if (amt > available) {
      dialog.alert(
        'Insufficient Funds',
        `You have ${available.toFixed(selectedToken === 'SKR' ? 2 : 4)} ${selectedToken} available.`,
      )
      return
    }

    const parsedRecipient = parseRecipientInput(sendRecipient)
    if (parsedRecipient.address && parsedRecipient.source !== 'raw') {
      // Take the address out of whatever was pasted rather than failing on the wrapper.
      setSendRecipient(parsedRecipient.address)
      setSendRecipientSource(parsedRecipient.source)
    }

    try {
      new PublicKey(sendRecipient.trim())
    } catch {
      setSendRecipientAttempted(true)
      dialog.alert('Invalid Address', parsedRecipient.error ?? 'Please enter a valid Solana address.')
      return
    }

    if (!wallet?.address) {
      dialog.alert('Error', 'No active smart wallet found.')
      return
    }

    if (sendRecipient.trim() === wallet.address) {
      dialog.alert('Self-Transfer Not Supported', 'Cannot transfer funds to your own wallet address. Please enter a different recipient address.')
      return
    }

    try {
      await handleExecuteSend((step) => {
        setSendStep(step === 1 ? 'primary' : 'secondary')
      })
    } catch {
      // Handled and alerted inside handleExecuteSend
    } finally {
      setIsSending(false)
      setSendStep('idle')
    }
  }

  const getSendProgressText = () => {
    if (sendStep === 'primary') {
      return 'Authenticating Phone Passkey…'
    }
    if (sendStep === 'secondary') {
      if (wallet?.securityMode === 'vault') {
        return 'Waiting for second device…'
      }
      return 'Authenticating Backup Key…'
    }
    if (sendStep === 'broadcasting') {
      return 'Confirming on Solana…'
    }
    return isSendQuorumRequired ? 'Authorizing 2-of-2 Quorum…' : 'Processing Transfer…'
  }

  // On-chain Send Transaction execution via Haptix Anchor Program & Secp256r1 Precompile
  const handleExecuteSend = async (onStepChange: (step: 1 | 2) => void) => {
    const amt = parseFloat(sendAmountText) || 0
    const toPubkey = new PublicKey(sendRecipient.trim())
    const activeWallet = wallet
    if (!activeWallet?.address) {
      throw new Error('No active smart wallet found.')
    }

    const walletPda = new PublicKey(activeWallet.address)
    if (toPubkey.equals(walletPda)) {
      throw new Error('Cannot transfer funds to your own wallet address.')
    }
    if (selectedToken !== 'SOL') {
      throw new Error(
        'Only SOL can be sent. SKR and USDC figures in this app were stored on the phone, not on Solana.',
      )
    }
    const isHighRiskQuorum = amt > spendThreshold

    const amountLamports = BigInt(Math.round(amt * LAMPORTS_PER_SOL))

    try {
      setIsSending(true)
      setSendStep('primary')
      await Haptics.impactAsync(
        isHighRiskQuorum ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
      )

      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      const needsInit = !onChain && !!(activeWallet.primaryPasskeyHex && activeWallet.secondaryPasskeyHex)
      const authNonce = onChain?.authNonce ?? 0n

      if (onChain) {
        const dataLen = (await connection.getAccountInfo(walletPda))?.data.length ?? WALLET_ACCOUNT_SPACE
        const reserve = BigInt(await connection.getMinimumBalanceForRentExemption(dataLen))
        const available = BigInt(onChain.balanceLamports)
        if (available < amountLamports + reserve) {
          const keepSol = Number(reserve) / LAMPORTS_PER_SOL
          throw new Error(
            `Leave about ${keepSol.toFixed(4)} SOL in the account. Sending ${amt} SOL would spend the rent reserve, and the network can delete the wallet if it drops below that.`,
          )
        }
      }

      const message = getTransferSignedMessage(
        walletPda,
        toPubkey,
        amountLamports,
        authNonce,
        clusterTagFromNetwork(onChain?.cluster ?? network),
      )

      // 1. Primary Passkey authorization (Biometric challenge)
      const primarySig = await signWithPasskey(
        'primary',
        message,
        `Authorize ${amt} SOL transfer to ${ellipsify(toPubkey.toBase58(), 4)}`,
        { expectedRecipient: toPubkey.toBase58(), expectedAmountLamports: amountLamports },
      )

      const precompilePrimary = createSecp256r1Instruction({
        ...primarySig,
        message,
      })

      // Sponsor transaction network fee on Devnet via persistent funded relayer
      const payer = await getFundedDevnetPayer(connection)

      // The wallet PDA has to exist on-chain before the program can write to it, and
      // `initialize_wallet` MUST get its own transaction rather than riding along with
      // a passkey instruction. Each hardware passkey contributes a secp256r1 precompile
      // carrying a full WebAuthn assertion (~380 bytes each) — two of those already consume
      // most of Solana's 1232-byte transaction limit. Bundling initIx + 2 precompiles +
      // transferIx exceeds Solana's 1232-byte MTU limit (1266 > 1232).
      if (needsInit) {
        const primaryPasskey = new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex'))
        const secondaryPasskey = new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex'))
        const initIx = createInitializeWalletInstruction({
          payer: payer.publicKey,
          walletPda,
          primaryPasskey,
          secondaryPasskey,
          spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
          guardian: assertRecoveryGuardian(parseGuardianAddress(activeWallet.guardianAddress), payer.publicKey, walletPda),
        })

        const initBlockhash = await connection.getLatestBlockhash('confirmed')
        const initTx = new Transaction({
          feePayer: payer.publicKey,
          recentBlockhash: initBlockhash.blockhash,
        }).add(initIx)
        initTx.sign(payer)

        const initSig = await connection.sendRawTransaction(initTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        })

        await connection.confirmTransaction(
          {
            signature: initSig,
            blockhash: initBlockhash.blockhash,
            lastValidBlockHeight: initBlockhash.lastValidBlockHeight,
          },
          'confirmed',
        )
      }

      const primarySigIxIndex = 0
      const secondarySigIxIndex = isHighRiskQuorum ? 1 : undefined

      let txInstructions = []

      if (isHighRiskQuorum) {
        onStepChange(2)
        setSendStep('secondary')
        // 2. High-Risk: 2-of-2 passkey quorum required
        const secondaryPrompt =
          activeWallet?.securityMode === 'vault'
            ? `Approve on your second device to send ${amt} SOL`
            : `Confirm with your backup key: ${amt} SOL`

        let secondarySig: PasskeySignature
        if (activeWallet?.securityMode === 'vault') {
          let macSig: PasskeySignature | null = null
          const relayHost = await findActiveRelayHost().catch((e) => {
            console.warn('[Haptix Send] Vault relay discovery fallback:', e?.message)
            return null
          })
          const messageHex = Buffer.from(message).toString('hex')

          // Check if clipboard already has a valid signature code (from vault.html)
          const clipboardText = await Clipboard.getString().catch(() => '')
          const clipboardSig = clipboardText ? parseManualSignaturePayload(clipboardText) : null
          if (clipboardSig && activeWallet?.secondaryPasskeyHex) {
            macSig = {
              signature: hexToBytes(clipboardSig.signatureHex),
              publicKey: hexToBytes(activeWallet.secondaryPasskeyHex),
              authenticatorData: hexToBytes(clipboardSig.authenticatorDataHex),
              clientDataJSON: hexToBytes(clipboardSig.clientDataJSONHex),
            }
          }

          if (!macSig && relayHost) {
            try {
              const txId = await queueVaultTransfer({
                relayHost,
                messageHex,
                amountSol: amt,
                amountUsd: solPriceUsd > 0 ? (amt * solPriceUsd).toFixed(2) : undefined,
                feeSol: `${feeEstimate?.sol ?? SEND_NETWORK_FEE_SOL} SOL`,
                recipient: toPubkey.toBase58(),
                walletPda: walletPda.toBase58(),
                walletName: activeWallet?.name || 'Hardware Vault',
                spendThresholdSol: spendThreshold,
              })
              currentRelayTxRef.current = { relayHost, txId }

              const sigPayload = await pollVaultSignature(relayHost, txId, {
                walletPda: walletPda.toBase58(),
                timeoutMs: 80000,
                pollIntervalMs: 800,
                isAborted: () => sendAbortRef.current,
              })

              if (sigPayload && activeWallet?.secondaryPasskeyHex) {
                macSig = {
                  signature: hexToBytes(sigPayload.signatureHex),
                  publicKey: hexToBytes(activeWallet.secondaryPasskeyHex),
                  authenticatorData: hexToBytes(sigPayload.authenticatorDataHex),
                  clientDataJSON: hexToBytes(sigPayload.clientDataJSONHex),
                }
              }
            } catch (relayErr: any) {
              if (relayErr?.message?.includes('cancelled')) {
                throw relayErr
              }
              if (relayErr?.message?.includes('declined')) {
                throw new Error('Transfer was declined on second device.')
              }
              console.warn('[Haptix Send] Vault relay connection failed:', relayErr)
            } finally {
              currentRelayTxRef.current = null
            }
          }

          if (sendAbortRef.current) {
            throw new Error('Transfer cancelled.')
          }

          if (!macSig) {
            // Second check: check if user copied signature to clipboard while waiting
            const lateClip = await Clipboard.getString().catch(() => '')
            const lateSig = lateClip ? parseManualSignaturePayload(lateClip) : null
            if (lateSig && activeWallet?.secondaryPasskeyHex) {
              macSig = {
                signature: hexToBytes(lateSig.signatureHex),
                publicKey: hexToBytes(activeWallet.secondaryPasskeyHex),
                authenticatorData: hexToBytes(lateSig.authenticatorDataHex),
                clientDataJSON: hexToBytes(lateSig.clientDataJSONHex),
              }
            }
          }

          if (!macSig) {
            const vaultUrl = AppConfig.vaultWebUrl
            throw new Error(
              `Second device authorization was not completed. Please open ${vaultUrl} on your second device and tap "Authorize with Biometrics".`,
            )
          }

          secondarySig = macSig
        } else {
          secondarySig = await signWithPasskey('secondary', message, secondaryPrompt, {
            expectedRecipient: toPubkey.toBase58(),
            expectedAmountLamports: amountLamports,
          })
        }

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

      setSendStep('broadcasting')
      const latestBlockhash = await connection.getLatestBlockhash('confirmed')
      const lookupTable = await getHaptixAddressLookupTable(connection, walletPda, payer).catch(() => null)
      const { rawTx } = buildOptimalTransaction({
        payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions,
        lookupTable,
      })

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

      // Paying a saved recipient again is the signal that it is still current, so the
      // address book keeps it at the front of the shortcut row.
      if (contacts.some((entry) => entry.address === toPubkey.toBase58())) {
        void touchContact(toPubkey.toBase58()).then(setContacts)
      }

      // The balance re-read and the Activity entry belong to the screen, which is the
      // only thing that outlives this sheet.
      await onTransferSent({
        signature: sig,
        type: 'transfer',
        direction: 'send',
        amount: amt,
        tokenSymbol: 'SOL',
        recipientOrSender: toPubkey.toBase58(),
        timestamp: Date.now(),
        status: 'confirmed',
      })

      setIsSending(false)
      setConfirmedTransfer({
        signature: sig,
        amount: amt,
        tokenSymbol: 'SOL',
        recipientAddress: toPubkey.toBase58(),
        isQuorum: isHighRiskQuorum,
        networkFee: `${effectiveFeeSol} SOL`,
      })
    } catch (err: any) {
      if (err?.message?.includes('cancelled') || sendAbortRef.current) {
        setIsSending(false)
        setSendStep('idle')
        setSendErrorMsg('Transfer cancelled.')
        return
      }
      console.error('[Haptix Send] Execution error:', formatChainErrorForLog(err))
      const errorText = describeChainError(err, 'The transfer could not be completed on-chain. Please try again.')
      setSendErrorMsg(errorText)
      setIsSending(false)
      dialog.alert('Transfer Error', errorText)
    }
  }

  const sendAmountNum = parseFloat(sendAmountText) || 0
  const activeSpendThreshold =
    selectedToken === 'SKR'
      ? SKR_TOKEN_METADATA.quorumThreshold
      : selectedToken === 'USDC'
      ? USDC_TOKEN_METADATA.quorumThreshold
      : spendThreshold
  const isSendQuorumRequired = sendAmountNum > activeSpendThreshold

  // Not blocked: moving your own SOL back to yourself is a legitimate devnet test. It is
  // only worth saying out loud so it does not happen by accident.
  const isRecipientSelf = !!recipientAddress && recipientAddress === wallet?.address
  const nameInput = looksLikeSolName(sendRecipient) ? extractSolName(sendRecipient) : null
  const savedContact = findContact(contacts, recipientAddress)
  const isValidRecipient = Boolean(recipientAddress && !isRecipientSelf)
  // While an address is being typed it is invalid many times on the way to being valid,
  // so the error text waits until the paste was rejected, the field was left, or what is
  // in it is already longer than any address could be.
  const showRecipientError =
    !nameInput &&
    (!!recipientAttemptError ||
      (!!recipientParse.error &&
        (sendRecipientAttempted || sendRecipientBlurred || sendRecipient.trim().length > MAX_SOLANA_ADDRESS_LENGTH)))
  const isRecipientInvalid = Boolean(
    isRecipientSelf ||
      recipientAttemptError ||
      (showRecipientError && recipientParse.error),
  )
  const recipientNotice = describeRecipientSource(sendRecipientSource)

  // Everything the fee is subtracted from: the balance chip, the percentage chips and the
  // affordability check all have to agree on what "all of it" means. The number is the
  // cluster's answer when it has one, and the base fee when it does not.
  const effectiveFeeSol = feeEstimate?.sol ?? SEND_NETWORK_FEE_SOL
  const isFeeLive = feeEstimate?.source === 'rpc'
  const maxSendableSol = Math.max(0, balance - effectiveFeeSol)
  const sendTotalSol = sendAmountNum > 0 ? sendAmountNum + effectiveFeeSol : 0
  const activeTokenPriceUsd =
    selectedToken === 'SKR'
      ? SKR_TOKEN_METADATA.fallbackPriceUsd
      : selectedToken === 'USDC'
      ? USDC_TOKEN_METADATA.fallbackPriceUsd
      : solPriceUsd

  const sendAmountError = (() => {
    if (sendAmountNum <= 0) return null
    if (selectedToken === 'SKR') {
      if (sendAmountNum > skrBalance) {
        return `That is more than your ${skrBalance.toFixed(2)} SKR balance.`
      }
      return null
    }
    if (selectedToken === 'USDC') {
      if (sendAmountNum > (usdcBalance ?? 0)) {
        return `That is more than your ${(usdcBalance ?? 0).toFixed(2)} USDC balance.`
      }
      return null
    }
    if (sendTotalSol > balance) {
      return `That is more than your ${balance.toFixed(4)} SOL once the ${effectiveFeeSol} SOL network fee is included.`
    }
    return null
  })()

  // Fee pricing sits here, below the recipient and amount derivations it reads. It
  // re-prices while the sheet is open because a blockhash is only good for ~60-90
  // seconds, and it prices the same message the wallet is about to sign.
  useEffect(() => {
    if (!visible) return
    const feePayer = wallet?.address ? new PublicKey(wallet.address) : null
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
  }, [visible, connection, wallet?.address, recipientAddress, sendAmountNum])

  // Recent recipients, read back from this wallet's own send history instead of a new
  // address book: the addresses are already stored per wallet and are exactly the ones
  // worth offering again. Invalid or self-referential entries are filtered out so a
  // shortcut can never re-introduce the garbage address the parser rejects.
  const recentRecipients = useMemo(() => {
    const seen = new Set<string>()
    const recipients: string[] = []
    for (const tx of transactions) {
      if (tx.direction !== 'send') continue
      const candidate = (tx.recipientOrSender || '').trim()
      if (!isSolanaAddress(candidate)) continue
      if (candidate === wallet?.address) continue
      if (seen.has(candidate)) continue
      seen.add(candidate)
      recipients.push(candidate)
      if (recipients.length >= MAX_RECENT_RECIPIENTS) break
    }
    return recipients
  }, [transactions, wallet?.address])

  // Saved contacts first, history after: a name the user typed beats an address they
  // happened to pay once, and both are capped to one row of chips.
  const recipientShortcuts = useMemo(
    () => rankRecipients(contacts, recentRecipients, MAX_VISIBLE_RECIPIENTS, wallet?.address),
    [contacts, recentRecipients, wallet?.address],
  )

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.expandedModalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            styles.expandedSendSheet,
            styles.modalSheet,
            confirmedTransfer && { height: 'auto', maxHeight: '92%' },
            { paddingBottom: 0, transform: [{ translateY: panY }] },
          ]}
        >
          {/* Functional Drag Handle Touch Zone */}
          <View style={styles.dragHandleTouchZone} {...panResponder.panHandlers}>
            <View style={[styles.modalDragHandle, { backgroundColor: isDark ? '#3a3a37' : '#D1D1D6' }]} />
          </View>

          {confirmedTransfer ? (
            /* ==================== TRANSFER CONFIRMED VIEW ==================== */
            <View style={[styles.confirmedViewContainer, { paddingBottom: Math.max(insets.bottom, 22) }]}>
              {/* Checkmark Ring Badge */}
              <View style={styles.confirmedRingOuter}>
                <View style={styles.confirmedRingInner}>
                  <MaterialIcons name="check" size={28} color={isDark ? '#34D399' : '#059669'} />
                </View>
              </View>

              <Text style={styles.confirmedSubtitle}>Transfer confirmed</Text>
              <Text style={styles.confirmedHeroAmount}>
                −{confirmedTransfer.amount} {confirmedTransfer.tokenSymbol}
              </Text>
              <Text style={styles.confirmedNetworkText}>
                Confirmed on Solana {network}
              </Text>

              {/* Detail Card Box */}
              <View style={styles.confirmedDetailBox}>
                {/* To Row */}
                <View style={styles.confirmedRow}>
                  <Text style={styles.confirmedRowLabel}>To</Text>
                  <TouchableOpacity
                    style={styles.confirmedCopyableValue}
                    onPress={() => {
                      Clipboard.setString(confirmedTransfer.recipientAddress)
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                      setCopiedRecipient(true)
                      setTimeout(() => setCopiedRecipient(false), 2000)
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.confirmedMonoText}>
                      {ellipsify(confirmedTransfer.recipientAddress, 4)}
                    </Text>
                    <MaterialIcons
                      name={copiedRecipient ? 'check' : 'content-copy'}
                      size={13}
                      color={copiedRecipient ? '#5fbf7a' : (isDark ? '#8a8985' : theme.textMuted)}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.confirmedRowDivider} />

                {/* Network Fee Row */}
                <View style={styles.confirmedRow}>
                  <Text style={styles.confirmedRowLabel}>Network fee</Text>
                  <Text style={styles.confirmedRowValue}>{confirmedTransfer.networkFee}</Text>
                </View>

                <View style={styles.confirmedRowDivider} />

                {/* Verified By Row */}
                <View style={styles.confirmedRow}>
                  <Text style={styles.confirmedRowLabel}>Verified by</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <MaterialIcons name="fingerprint" size={15} color={isDark ? '#8a8985' : theme.accent} />
                    <Text style={styles.confirmedRowValue}>
                      {confirmedTransfer.isQuorum ? 'Both passkeys' : 'Passkey'}
                    </Text>
                  </View>
                </View>

                <View style={styles.confirmedRowDivider} />

                {/* Signature Row */}
                <View style={styles.confirmedRow}>
                  <Text style={styles.confirmedRowLabel}>Signature</Text>
                  <TouchableOpacity
                    style={styles.confirmedCopyableValue}
                    onPress={() => {
                      Clipboard.setString(confirmedTransfer.signature)
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                      setCopiedSig(true)
                      setTimeout(() => setCopiedSig(false), 2000)
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.confirmedMonoText}>
                      {ellipsify(confirmedTransfer.signature, 8)}
                    </Text>
                    <MaterialIcons
                      name={copiedSig ? 'check' : 'content-copy'}
                      size={13}
                      color={copiedSig ? '#5fbf7a' : (isDark ? '#8a8985' : theme.textMuted)}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Done Button */}
              <TouchableOpacity
                style={styles.confirmedDoneBtn}
                onPress={() => {
                  setConfirmedTransfer(null)
                  onClose()
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmedDoneBtnText}>Done</Text>
              </TouchableOpacity>

              {/* View on Solscan Button */}
              <TouchableOpacity
                style={styles.confirmedSolscanBtn}
                onPress={() => {
                  const clusterParam = network === 'devnet' ? '?cluster=devnet' : ''
                  Linking.openURL(`https://solscan.io/tx/${confirmedTransfer.signature}${clusterParam}`).catch(() => {})
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="open-in-new" size={15} color={isDark ? '#8a8985' : theme.textMuted} />
                <Text style={styles.confirmedSolscanBtnText}>View on Solscan</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // ==================== SEND FORM ====================
            <View style={{ flex: 1 }}>
              {/* Modal Header */}
              <View style={styles.modalSheetHeader}>
                <View>
                  <Text style={styles.cleanModalTitle}>
                    Send {selectedToken === 'SKR' ? 'Seeker' : selectedToken === 'USDC' ? 'USD Coin' : 'Solana'}
                  </Text>
                  <Text style={styles.cleanModalSubtitle}>
                    {isSendQuorumRequired
                      ? 'Approve on this phone and second device'
                      : 'Instant on-chain transfer via passkey'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onClose()}
                  style={styles.modalCloseBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close send sheet"
                >
                  <MaterialIcons name="close" size={18} color="#8a8985" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 150 }}
              >
            {/* HERO AMOUNT INPUT SECTION */}
            <View style={styles.cleanSendCard}>
              {/* Header row: Clickable Asset Selector Menu + Available Balance */}
              <View style={styles.cleanTokenHeaderRow}>
                {/* Menu-type Asset Selector Button */}
                <TouchableOpacity
                  style={[
                    styles.assetSelectorTrigger,
                    {
                      backgroundColor: theme.isDark ? '#000000' : '#FFFFFF',
                      borderColor: showTokenMenu ? theme.accent : theme.borderDefault,
                    },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setShowTokenMenu(!showTokenMenu)
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Select asset, currently ${selectedToken}`}
                >
                  <View style={styles.assetSelectorLogoWrap}>
                    {selectedToken === 'SOL' && <SolanaTokenLogo size={20} />}
                    {selectedToken === 'SKR' && <SeekerTokenLogo size={20} />}
                    {selectedToken === 'USDC' && <UsdcTokenLogo size={20} />}
                  </View>
                  <Text style={[styles.assetSelectorTicker, { color: theme.textPrimary }]}>
                    {selectedToken}
                  </Text>
                  <MaterialIcons
                    name={showTokenMenu ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={theme.textSecondary}
                  />
                </TouchableOpacity>

                {/* Available Balance (Clickable to fill Max) */}
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync()
                    if (selectedToken === 'SKR') {
                      setSendAmountText(skrBalance > 0 ? skrBalance.toFixed(2) : '0')
                    } else if (selectedToken === 'USDC') {
                      setSendAmountText((usdcBalance ?? 0) > 0 ? (usdcBalance ?? 0).toFixed(2) : '0')
                    } else {
                      setSendAmountText(maxSendableSol > 0 ? maxSendableSol.toFixed(4) : '0')
                    }
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.cleanAvailableBtn}
                >
                  <Text style={[styles.cleanAvailableText, { color: theme.textSecondary }]}>
                    Available{' '}
                    <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>
                      {selectedToken === 'SKR'
                        ? `${skrBalance.toFixed(2)} SKR`
                        : selectedToken === 'USDC'
                        ? `${(usdcBalance ?? 0).toFixed(2)} USDC`
                        : `${balance.toFixed(4)} SOL`}
                    </Text>
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Asset Dropdown Menu */}
              {showTokenMenu && (
                <View
                  style={[
                    styles.assetDropdownMenu,
                    {
                      backgroundColor: theme.isDark ? '#000000' : '#FFFFFF',
                      borderColor: theme.borderDefault,
                    },
                  ]}
                >
                  {[{ symbol: 'SOL' as const, name: 'Solana' }].map((token) => {
                    const isSelected = selectedToken === token.symbol
                    const tokBal = balance
                    const tokPrice = solPriceUsd
                    const tokFiat = tokBal * tokPrice

                    return (
                      <TouchableOpacity
                        key={token.symbol}
                        style={[
                          styles.assetDropdownItem,
                          isSelected && {
                            backgroundColor: theme.isDark
                              ? 'rgba(108, 140, 255, 0.12)'
                              : 'rgba(108, 140, 255, 0.08)',
                          },
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync()
                          setSelectedToken(token.symbol)
                          setShowTokenMenu(false)
                          setSendAmountText('0.05')
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.assetDropdownItemLeft}>
                          <View style={styles.assetDropdownLogoWrap}>
                            <SolanaTokenLogo size={24} />
                          </View>
                          <View>
                            <Text style={[styles.assetDropdownName, { color: theme.textPrimary }]}>
                              {token.name}
                            </Text>
                            <Text style={[styles.assetDropdownTicker, { color: theme.textSecondary }]}>
                              {token.symbol}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.assetDropdownItemRight}>
                          <Text style={[styles.assetDropdownBalance, { color: theme.textPrimary }]}>
                            {tokBal.toFixed(token.symbol === 'SOL' ? 4 : 2)} {token.symbol}
                          </Text>
                          <Text style={[styles.assetDropdownFiat, { color: theme.textSecondary }]}>
                            ≈ ${tokFiat.toFixed(2)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}

              {/* Center Big Amount */}
              <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <TextInput
                    style={styles.cleanSendBigInput}
                    value={sendAmountText}
                    onChangeText={setSendAmountText}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.textMuted}
                    selectionColor={theme.accent}
                    autoFocus={false}
                  />
                  <Text style={[styles.cleanSendCurrencySuffix, { color: theme.textSecondary }]}>
                    {selectedToken}
                  </Text>
                </View>
                <Text style={[styles.cleanSendUsdText, { color: theme.textMuted }]}>
                  ≈ ${(sendAmountNum * activeTokenPriceUsd).toFixed(2)} USD
                </Text>
              </View>

              {/* Quick Percentage Chips (4-grid: 25%, 50%, 75%, Max) */}
              <View style={styles.cleanPercentGrid}>
                {[
                  { label: '25%', fraction: 0.25 },
                  { label: '50%', fraction: 0.5 },
                  { label: '75%', fraction: 0.75 },
                  { label: 'Max', fraction: 1 },
                ].map((chip) => {
                  const targetMax =
                    selectedToken === 'SKR'
                      ? skrBalance
                      : selectedToken === 'USDC'
                      ? (usdcBalance ?? 0)
                      : maxSendableSol
                  const chipDecimals = selectedToken === 'SOL' ? 4 : 2
                  const chipVal = Math.max(0, targetMax * chip.fraction).toFixed(chipDecimals)
                  const isChipActive =
                    targetMax > 0 &&
                    (sendAmountText === chipVal ||
                      (chip.fraction === 1 && Math.abs(sendAmountNum - targetMax) < 0.0001))
                  return (
                    <TouchableOpacity
                      key={chip.label}
                      style={[
                        styles.cleanPercentChip,
                        isChipActive ? styles.cleanPercentChipActive : styles.cleanPercentChipInactive,
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setSendAmountText(chipVal)
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.cleanPercentChipText,
                          isChipActive ? styles.cleanPercentChipTextActive : styles.cleanPercentChipTextInactive,
                        ]}
                      >
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* Warning Banner when over balance */}
              {sendAmountError ? (
                <View style={styles.cleanWarningBanner}>
                  <MaterialIcons name="error-outline" size={15} color="#e5484d" style={{ marginTop: 1, flexShrink: 0 }} />
                  <Text style={styles.cleanWarningBannerText}>{sendAmountError}</Text>
                </View>
              ) : null}
            </View>

            {/* RECIPIENT INPUT SECTION */}
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.cleanFieldLabel}>Recipient Solana address</Text>
              <View
                style={[
                  styles.cleanRecipientBox,
                  isValidRecipient && { borderColor: theme.emeraldBorder },
                  isRecipientInvalid && { borderColor: theme.roseBorder },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0, overflow: 'hidden', marginRight: 8 }}>
                  <TextInput
                    style={styles.cleanRecipientInput}
                    value={sendRecipient}
                    onChangeText={handleRecipientTextChange}
                    onBlur={() => setSendRecipientBlurred(true)}
                    placeholder="Enter recipient address"
                    placeholderTextColor="#5f5e5a"
                    selectionColor="#6c8cff"
                    autoCapitalize="none"
                    autoCorrect={false}
                    numberOfLines={1}
                    multiline={false}
                    accessibilityLabel="Recipient Solana address"
                  />
                </View>
                {sendRecipient ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {isValidRecipient ? (
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: theme.emeraldBg,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <MaterialIcons name="check" size={14} color={theme.emerald} />
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={{ padding: 4 }}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setSendRecipient('')
                        setSendRecipientSource(null)
                        setRecipientAttemptError('')
                        setSendRecipientAttempted(false)
                        setResolvedName(null)
                        setNameLookup(null)
                        setPendingContactName(null)
                      }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityLabel="Clear recipient address"
                    >
                      <MaterialIcons name="cancel" size={16} color="#8a8985" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.cleanPasteBtn}
                    onPress={handlePasteRecipient}
                    accessibilityLabel="Paste address from clipboard"
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="content-paste" size={14} color="#6c8cff" />
                    <Text style={styles.cleanPasteBtnText}>Paste</Text>
                  </TouchableOpacity>
                )}
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
              ) : isRecipientSelf ? (
                <View style={styles.fieldMessageRow}>
                  <MaterialIcons name="error-outline" size={13} color={theme.roseText} />
                  <Text style={[styles.fieldMessageText, { color: theme.roseText }]}>
                    Cannot send to this wallet&apos;s own address.
                  </Text>
                </View>
              ) : recipientAttemptError || (showRecipientError && recipientParse.error) ? (
                <View style={styles.fieldMessageRow}>
                  <MaterialIcons name="error-outline" size={13} color={theme.roseText} />
                  <Text style={[styles.fieldMessageText, { color: theme.roseText }]}>
                    {recipientAttemptError || recipientParse.error}
                  </Text>
                </View>
              ) : recipientNotice ? (
                <View style={styles.fieldMessageRow}>
                  <MaterialIcons name="auto-fix-high" size={13} color={theme.emerald} />
                  <Text style={[styles.fieldMessageText, styles.textSecondary]}>{recipientNotice}</Text>
                </View>
              ) : isValidRecipient ? (
                <View style={styles.fieldMessageRow}>
                  <MaterialIcons name="check-circle" size={13} color={theme.emerald} />
                  <Text style={[styles.fieldMessageText, { color: theme.emeraldText }]}>
                    {savedContact ? `Saved contact (${savedContact.label})` : 'Valid Solana address'}
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

            {/* TRANSACTION PREVIEW SECTION */}
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.cleanFieldLabel}>Transaction preview</Text>
              <View style={styles.cleanPreviewCard}>
                {/* Recipient */}
                <View style={styles.cleanPreviewRow}>
                  <Text style={styles.cleanPreviewLabel}>Recipient</Text>
                  <Text style={[styles.cleanPreviewValue, !recipientAddress && { color: theme.textMuted }]}>
                    {recipientAddress
                      ? savedContact?.label || resolvedName
                        ? `${savedContact?.label ?? resolvedName} (${ellipsify(recipientAddress, 4)})`
                        : ellipsify(recipientAddress, 4)
                      : 'Not specified'}
                  </Text>
                </View>

                {/* Transfer amount */}
                <View style={styles.cleanPreviewRow}>
                  <Text style={styles.cleanPreviewLabel}>Transfer amount</Text>
                  <Text style={[styles.cleanPreviewValue, { fontWeight: '500' }]}>
                    {sendAmountNum.toFixed(selectedToken === 'SOL' ? 4 : 2)} {selectedToken}
                  </Text>
                </View>

                {/* Network */}
                <View style={styles.cleanPreviewRow}>
                  <Text style={styles.cleanPreviewLabel}>Network</Text>
                  <Text style={styles.cleanPreviewValue}>
                    {network === 'devnet' ? 'Solana devnet' : 'Solana mainnet'}
                  </Text>
                </View>

                {/* Estimated fee */}
                <View style={styles.cleanPreviewRow}>
                  <Text style={styles.cleanPreviewLabel}>Estimated fee</Text>
                  <Text style={styles.cleanPreviewValue}>
                    {selectedToken !== 'SOL' ? '0.00 SOL (Sponsored)' : `${effectiveFeeSol} SOL`}
                  </Text>
                </View>

                {/* Authorization */}
                <View style={styles.cleanPreviewRow}>
                  <Text style={styles.cleanPreviewLabel}>Authorization</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <MaterialIcons name="fingerprint" size={14} color={theme.textPrimary} />
                    <Text style={styles.cleanPreviewValue}>
                      {isSendQuorumRequired ? '2 passkeys' : '1 passkey'}
                    </Text>
                  </View>
                </View>

                {/* Single subtle divider before total outflow */}
                <View style={[styles.cleanPreviewDivider, { backgroundColor: theme.borderDefault }]} />

                {/* Total outflow */}
                <View style={[styles.cleanPreviewRow, { paddingTop: 2 }]}>
                  <Text style={[styles.cleanPreviewValue, { fontWeight: '600' }]}>Total outflow</Text>
                  <Text style={[styles.cleanPreviewValue, { fontWeight: '600' }]}>
                    {selectedToken === 'SOL'
                      ? sendTotalSol.toFixed(4)
                      : sendAmountNum.toFixed(2)}{' '}
                    {selectedToken}
                  </Text>
                </View>
              </View>
            </View>

            {/* Error message */}
            {sendErrorMsg ? (
              <View style={[styles.cleanWarningBanner, { marginBottom: 12 }]}>
                <MaterialIcons name="error-outline" size={15} color="#e5484d" style={{ marginTop: 1, flexShrink: 0 }} />
                <Text style={styles.cleanWarningBannerText}>{sendErrorMsg}</Text>
              </View>
            ) : null}

              </ScrollView>

              {/* ACTION BUTTON & HELPER - PINNED STICKY AT BOTTOM */}
              <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}>
                {isSending ? (
                  <View style={styles.stepApprovalCard}>
                    {/* Step 1: This phone */}
                    <View style={styles.stepApprovalRow}>
                      <View style={styles.stepApprovalLeft}>
                        <MaterialIcons
                          name="smartphone"
                          size={18}
                          color={theme.isDark ? '#F2F1EE' : '#18181B'}
                        />
                        <Text style={styles.stepApprovalDeviceName}>This phone</Text>
                      </View>

                      <View style={styles.stepApprovalRight}>
                        {sendStep === 'primary' ? (
                          <View style={styles.stepApprovalStatusBadge}>
                            <ActivityIndicator size="small" color="#6C8CFF" style={{ marginRight: 6 }} />
                            <Text style={styles.stepApprovalStatusActive}>Waiting for passkey</Text>
                          </View>
                        ) : (
                          <View style={styles.stepApprovalStatusBadge}>
                            <View style={styles.stepApprovalCheckCircle}>
                              <MaterialIcons name="check" size={12} color="#FFFFFF" />
                            </View>
                            <Text style={styles.stepApprovalStatusApproved}>Approved</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Step 2 (if quorum is required) */}
                    {isSendQuorumRequired && (
                      <>
                        <View style={styles.stepApprovalDivider} />
                        <View style={styles.stepApprovalRow}>
                          <View style={styles.stepApprovalLeft}>
                            <MaterialIcons
                              name={wallet?.securityMode === 'vault' ? 'devices' : 'security'}
                              size={18}
                              color={
                                sendStep === 'primary'
                                  ? (theme.isDark ? '#71717A' : '#A1A1AA')
                                  : (theme.isDark ? '#F2F1EE' : '#18181B')
                              }
                            />
                            <Text
                              style={[
                                styles.stepApprovalDeviceName,
                                sendStep === 'primary' && styles.stepApprovalDeviceNameMuted,
                              ]}
                            >
                              {wallet?.securityMode === 'vault' ? 'Second device' : 'Backup key'}
                            </Text>
                          </View>

                          <View style={styles.stepApprovalRight}>
                            {sendStep === 'primary' ? (
                              <View style={styles.stepApprovalStatusBadge}>
                                <View style={styles.stepApprovalPendingDot} />
                                <Text style={styles.stepApprovalStatusMuted}>Pending</Text>
                              </View>
                            ) : sendStep === 'secondary' ? (
                              <View style={styles.stepApprovalStatusBadge}>
                                <ActivityIndicator size="small" color="#6C8CFF" style={{ marginRight: 6 }} />
                                <Text style={styles.stepApprovalStatusActive}>
                                  {wallet?.securityMode === 'vault' ? 'Waiting for second device' : 'Waiting for passkey'}
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.stepApprovalStatusBadge}>
                                <View style={styles.stepApprovalCheckCircle}>
                                  <MaterialIcons name="check" size={12} color="#FFFFFF" />
                                </View>
                                <Text style={styles.stepApprovalStatusApproved}>Approved</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </>
                    )}

                    {/* Helper text when waiting for second device */}
                    {sendStep === 'secondary' && wallet?.securityMode === 'vault' && (
                      <View style={styles.stepApprovalHelperRow}>
                        <MaterialIcons name="touch-app" size={14} color="#6C8CFF" />
                        <Text style={styles.stepApprovalHelperText}>
                          Open Haptix Vault on your second device to approve.
                        </Text>
                      </View>
                    )}

                    {/* Bottom Action: Broadcasting state OR Cancel button */}
                    {sendStep === 'broadcasting' ? (
                      <View style={styles.stepApprovalBroadcastingRow}>
                        <ActivityIndicator size="small" color={theme.isDark ? '#F2F1EE' : '#18181B'} style={{ marginRight: 8 }} />
                        <Text style={styles.stepApprovalBroadcastingText}>Sending to Solana…</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.stepApprovalCancelBtn}
                        onPress={handleCancelSending}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel transfer"
                      >
                        <Text style={styles.stepApprovalCancelText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.cleanSubmitBtn,
                        (!recipientAddress || isRecipientSelf || sendAmountNum <= 0 || !!sendAmountError)
                          ? styles.cleanSubmitBtnDisabled
                          : styles.cleanSubmitBtnEnabled,
                      ]}
                      onPress={handleInitiateSendFlow}
                      disabled={!recipientAddress || isRecipientSelf || sendAmountNum <= 0 || !!sendAmountError}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Sign and send with passkey"
                    >
                      <Text
                        style={[
                          styles.cleanSubmitBtnText,
                          (!recipientAddress || isRecipientSelf || sendAmountNum <= 0 || !!sendAmountError)
                            ? styles.cleanSubmitBtnTextDisabled
                            : styles.cleanSubmitBtnTextEnabled,
                        ]}
                      >
                        {isSendQuorumRequired ? 'Sign and send with 2 passkeys' : 'Sign and send with passkey'}
                      </Text>
                    </TouchableOpacity>

                    {(!recipientAddress || sendAmountNum <= 0 || !!sendAmountError) && (
                      <Text style={styles.cleanDisabledHelper}>
                        {!recipientAddress
                          ? 'Add a recipient address to continue'
                          : sendAmountNum <= 0
                          ? 'Enter an amount to continue'
                          : sendAmountError
                          ? 'Adjust amount to continue'
                          : 'Complete form to continue'}
                      </Text>
                    )}
                  </>
                )}
              </View>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const createSendSheetStyles = (theme: ThemeTokens, isDark: boolean) =>
  StyleSheet.create({
    confirmedViewContainer: {
      paddingTop: 4,
      paddingBottom: 8,
      alignItems: 'stretch',
    },
    confirmedRingOuter: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.10)' : '#E6F9F0',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 16,
    },
    confirmedRingInner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.22)' : '#CEF5E1',
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmedSubtitle: {
      color: isDark ? '#8a8985' : theme.textSecondary,
      fontSize: 12.5,
      textAlign: 'center',
      marginBottom: 4,
    },
    confirmedHeroAmount: {
      fontSize: 32,
      fontWeight: '600',
      letterSpacing: -0.5,
      color: isDark ? '#f2f1ee' : theme.textPrimary,
      textAlign: 'center',
    },
    confirmedNetworkText: {
      color: isDark ? '#8a8985' : theme.textMuted,
      fontSize: 13,
      marginTop: 4,
      textAlign: 'center',
      marginBottom: 22,
    },
    confirmedDetailBox: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: isDark ? '#2a2a28' : theme.borderDefault,
      backgroundColor: isDark ? '#141416' : '#F6F6F8',
      paddingHorizontal: 14,
      paddingVertical: 2,
      marginBottom: 18,
    },
    confirmedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
    },
    confirmedRowLabel: {
      color: isDark ? '#8a8985' : theme.textSecondary,
      fontSize: 13,
    },
    confirmedRowValue: {
      color: isDark ? '#f2f1ee' : theme.textPrimary,
      fontSize: 13,
      fontWeight: '500',
    },
    confirmedCopyableValue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 2,
    },
    confirmedMonoText: {
      color: isDark ? '#f2f1ee' : theme.textPrimary,
      fontSize: 12.5,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
    confirmedRowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: isDark ? '#201f1d' : theme.borderSubtle,
    },
    confirmedDoneBtn: {
      backgroundColor: '#6c8cff',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    confirmedDoneBtnText: {
      color: '#0c0c0d',
      fontSize: 15,
      fontWeight: '600',
    },
    confirmedSolscanBtn: {
      borderWidth: 1,
      borderColor: isDark ? '#2a2a28' : theme.borderDefault,
      borderRadius: 12,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: isDark ? 'transparent' : '#FFFFFF',
    },
    confirmedSolscanBtnText: {
      color: isDark ? '#f2f1ee' : theme.textPrimary,
      fontSize: 14,
      fontWeight: '500',
    },
    card: { backgroundColor: theme.bgCard, borderColor: theme.borderDefault },
    divider: { backgroundColor: theme.borderSubtle },
    elevatedCard: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    input: { backgroundColor: theme.bgInput, borderColor: theme.borderDefault, color: theme.textPrimary },
    dragHandleTouchZone: {
      width: '100%',
      paddingTop: 8,
      paddingBottom: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalDragHandle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      alignSelf: 'center',
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
    textMuted: { color: theme.textMuted },
    textPrimary: { color: theme.textPrimary },
    textSecondary: { color: theme.textSecondary },
    actionHintText: {
      marginTop: 8,
      fontSize: typeScale.footnote,
      textAlign: 'center',
    },
    clearActionBtn: {
      paddingHorizontal: 6,
      justifyContent: 'center',
    },
    contactSaveActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    contactSaveInput: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: typeScale.body,
    },
    contactSaveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      marginTop: 10,
    },
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
      maxHeight: '94%',
      height: '90%',
    },
    stickyFooter: {
      paddingTop: 10,
      backgroundColor: theme.isDark ? '#000000' : theme.bgCard,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.isDark ? '#201f1d' : theme.borderDefault,
    },
    cleanModalTitle: {
      fontSize: 19,
      fontWeight: '500',
      color: theme.textPrimary,
    },
    cleanModalSubtitle: {
      color: '#8a8985',
      fontSize: 13,
      marginTop: 2,
      marginBottom: 10,
    },
    cleanSendCard: {
      borderWidth: 1,
      borderColor: theme.borderDefault,
      borderRadius: 14,
      padding: 12,
      marginBottom: 10,
      backgroundColor: theme.isDark ? '#000000' : theme.bgElevated,
    },
    cleanTokenHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    assetSelectorTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
    },
    assetSelectorLogoWrap: {
      width: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    assetSelectorTicker: {
      fontSize: 13.5,
      fontWeight: '600',
    },
    cleanAvailableBtn: {
      paddingVertical: 4,
    },
    cleanAvailableText: {
      fontSize: 12,
    },
    assetDropdownMenu: {
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 14,
      overflow: 'hidden',
    },
    assetDropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    assetDropdownItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    assetDropdownLogoWrap: {
      width: 28,
      height: 28,
      justifyContent: 'center',
      alignItems: 'center',
    },
    assetDropdownName: {
      fontSize: 13.5,
      fontWeight: '600',
    },
    assetDropdownTicker: {
      fontSize: 11.5,
      marginTop: 1,
    },
    assetDropdownItemRight: {
      alignItems: 'flex-end',
    },
    assetDropdownBalance: {
      fontSize: 13,
      fontWeight: '600',
    },
    assetDropdownFiat: {
      fontSize: 11.5,
      marginTop: 1,
    },
    cleanTokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    cleanTokenPill: {
      borderRadius: 20,
      paddingVertical: 6,
      paddingHorizontal: 12,
      backgroundColor: 'transparent',
    },
    cleanTokenPillActive: {
      borderWidth: 1.5,
      borderColor: '#6c8cff',
    },
    cleanTokenPillInactive: {
      borderWidth: 0.5,
      borderColor: theme.borderDefault,
    },
    cleanTokenPillText: {
      fontSize: 13,
    },
    cleanTokenPillTextActive: {
      color: '#6c8cff',
      fontWeight: '500',
    },
    cleanTokenPillTextInactive: {
      color: theme.textSecondary,
      fontWeight: '400',
    },
    cleanSendBigInput: {
      fontSize: 38,
      fontWeight: '700',
      color: theme.textPrimary,
      textAlign: 'center',
      minWidth: 60,
      padding: 0,
      letterSpacing: -0.5,
    },
    cleanSendCurrencySuffix: {
      fontSize: 22,
      fontWeight: '600',
      color: theme.textSecondary,
      marginLeft: 8,
    },
    cleanSendUsdText: {
      textAlign: 'center',
      fontSize: 13.5,
      fontWeight: '500',
      color: theme.textMuted,
      marginTop: 4,
      marginBottom: 14,
    },
    cleanPercentGrid: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 6,
    },
    cleanPercentChip: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? '#000000' : '#FFFFFF',
      borderWidth: 1,
    },
    cleanPercentChipActive: {
      borderColor: theme.accent,
      backgroundColor: theme.isDark ? 'rgba(108, 140, 255, 0.16)' : 'rgba(108, 140, 255, 0.10)',
    },
    cleanPercentChipInactive: {
      borderColor: theme.borderDefault,
    },
    cleanPercentChipText: {
      fontSize: 12.5,
      fontWeight: '600',
    },
    cleanPercentChipTextActive: {
      color: theme.accent,
      fontWeight: '700',
    },
    cleanPercentChipTextInactive: {
      color: theme.textSecondary,
    },
    cleanWarningBanner: {
      flexDirection: 'row',
      gap: 8,
      backgroundColor: 'rgba(229, 72, 77, 0.1)',
      borderRadius: 10,
      padding: 10,
      alignItems: 'flex-start',
    },
    cleanWarningBannerText: {
      color: '#e5484d',
      lineHeight: 18,
      fontSize: 12,
      flex: 1,
    },
    cleanFieldLabel: {
      color: theme.textSecondary,
      fontSize: 12,
      marginBottom: 6,
      fontWeight: '500',
    },
    cleanRecipientBox: {
      borderWidth: 1,
      borderColor: theme.borderDefault,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.isDark ? '#000000' : theme.bgElevated,
    },
    cleanRecipientInput: {
      color: theme.textPrimary,
      fontSize: 13,
      padding: 0,
      margin: 0,
    },
    cleanPasteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    cleanPasteBtnText: {
      color: '#6c8cff',
      fontWeight: '500',
      fontSize: 13,
    },
    cleanPreviewCard: {
      borderWidth: 1,
      borderColor: theme.borderDefault,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginBottom: 10,
      backgroundColor: theme.isDark ? '#000000' : theme.bgElevated,
    },
    cleanPreviewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    cleanPreviewDivider: {
      height: StyleSheet.hairlineWidth,
      marginVertical: 6,
    },
    cleanPreviewLabel: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    cleanPreviewValue: {
      color: theme.textPrimary,
      fontSize: 13,
    },
    cleanSubmitBtn: {
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    stepApprovalCard: {
      backgroundColor: theme.isDark ? '#141416' : '#F4F4F5',
      borderWidth: 1,
      borderColor: theme.isDark ? '#27272A' : '#E4E4E7',
      borderRadius: 14,
      padding: 14,
      marginBottom: 8,
    },
    stepApprovalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 2,
    },
    stepApprovalLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    stepApprovalDeviceName: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.isDark ? '#F4F4F5' : '#18181B',
    },
    stepApprovalDeviceNameMuted: {
      color: theme.isDark ? '#71717A' : '#A1A1AA',
    },
    stepApprovalRight: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepApprovalStatusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepApprovalCheckCircle: {
      width: 17,
      height: 17,
      borderRadius: 8.5,
      backgroundColor: '#10B981',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 6,
    },
    stepApprovalStatusApproved: {
      fontSize: 13,
      fontWeight: '600',
      color: '#10B981',
    },
    stepApprovalStatusActive: {
      fontSize: 13,
      fontWeight: '600',
      color: '#6C8CFF',
    },
    stepApprovalPendingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.isDark ? '#3F3F46' : '#D4D4D8',
      marginRight: 7,
    },
    stepApprovalStatusMuted: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.isDark ? '#71717A' : '#A1A1AA',
    },
    stepApprovalDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.isDark ? '#27272A' : '#E4E4E7',
      marginVertical: 10,
    },
    stepApprovalHelperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingTop: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.isDark ? '#27272A' : '#E4E4E7',
    },
    stepApprovalHelperText: {
      fontSize: 12,
      color: theme.isDark ? '#A1A1AA' : '#52525B',
      fontWeight: '400',
      flex: 1,
    },
    stepApprovalBroadcastingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 11,
      marginTop: 10,
      borderRadius: 10,
      backgroundColor: theme.isDark ? '#1C1B19' : '#E4E4E7',
    },
    stepApprovalBroadcastingText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: theme.isDark ? '#F2F1EE' : '#18181B',
    },
    stepApprovalCancelBtn: {
      marginTop: 10,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepApprovalCancelText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: theme.isDark ? '#A1A1AA' : '#71717A',
    },
    cleanSubmitBtnDisabled: {
      backgroundColor: theme.isDark ? '#1C1B19' : '#E4E4E7',
      borderWidth: 1,
      borderColor: theme.isDark ? '#2E2D2A' : '#D4D4D8',
    },
    cleanSubmitBtnEnabled: {
      backgroundColor: theme.isDark ? '#F2F1EE' : '#000000',
      borderWidth: 1,
      borderColor: theme.isDark ? '#F2F1EE' : '#000000',
    },
    cleanSubmitBtnText: {
      fontSize: 14.5,
      fontWeight: '600',
    },
    cleanSubmitBtnTextDisabled: {
      color: theme.isDark ? '#7A7975' : '#71717A',
    },
    cleanSubmitBtnTextEnabled: {
      color: theme.isDark ? '#0C0C0D' : '#FFFFFF',
      fontWeight: '600',
    },
    cleanDisabledHelper: {
      textAlign: 'center',
      color: theme.textSecondary,
      fontSize: 12,
    },
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
    inputBoxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
    },
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
    inputSection: {
      marginBottom: 16,
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
    liveFeeDot: {
      width: 5,
      height: 5,
      borderRadius: radius.pill,
    },
    liveFeePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    liveFeeText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    modalCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalInput: {
      flex: 1,
      paddingVertical: 12,
      fontSize: typeScale.bodyLg,
    },
    modalSheetSubtitle: {
      color: theme.textMuted,
      fontSize: typeScale.footnote,
      marginTop: 2,
    },
    pasteActionBtn: {
      ...CHIP_SHAPE,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.bgElevated,
    },
    pasteActionText: {
      color: theme.textPrimary,
      fontSize: typeScale.footnote,
      fontWeight: '600',
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
    percentageChipsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      gap: space.sm,
    },
    previewCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 14,
      gap: 10,
    },
    previewDivider: {
      height: 1,
      backgroundColor: theme.borderSubtle,
    },
    previewLabel: {
      color: theme.textMuted,
      fontSize: typeScale.body,
    },
    previewLabelBold: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },
    previewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    previewSection: {
      marginBottom: 14,
    },
    previewTotalValue: {
      fontSize: typeScale.bodyLg,
      fontWeight: '700',
    },
    previewValueBold: {
      fontSize: typeScale.body,
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
    previewValueSub: {
      color: theme.textMuted,
      fontSize: typeScale.caption,
      fontWeight: '400',
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
    recentRecipientLabel: {
      fontSize: typeScale.caption,
      fontWeight: '600',
      letterSpacing: 0.4,
      marginRight: 2,
    },
    recentRecipientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      marginTop: 10,
    },
    savedRecipientAddress: {
      fontSize: typeScale.caption,
      fontFamily: 'SpaceMono',
      marginTop: 1,
    },
    savedRecipientChip: {
      ...CHIP_SHAPE,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 180,
    },
    savedRecipientLabel: {
      fontSize: typeScale.footnote,
      fontWeight: '600',
    },
    savedRecipientTextGroup: {
      flexShrink: 1,
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
    sendHeroCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 16,
      marginBottom: 16,
      alignItems: 'center',
    },
    sendInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      marginBottom: 4,
    },
    sendTokenHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      marginBottom: 12,
    },
    sendTokenName: {
      fontSize: typeScale.footnote,
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
    sendUsdApprox: {
      fontSize: typeScale.body,
      color: theme.textMuted,
    },
    sendUsdCounter: {
      fontSize: typeScale.body,
      fontWeight: '500',
      color: theme.textMuted,
    },
    sendUsdEstimateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
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
  })

function useSendSheetStyles() {
  const { theme, isDark } = useAppTheme()
  return useMemo(() => createSendSheetStyles(theme, isDark), [theme, isDark])
}
