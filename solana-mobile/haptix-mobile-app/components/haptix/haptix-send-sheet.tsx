import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
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
import { signWithPasskey } from '@/utils/haptix-passkey'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { TransactionRecord } from '@/utils/haptix-tx-history'
import { HaptixWalletAccount } from '@/utils/haptix-wallet-storage'
import {
  createExecuteTransferInstruction,
  createInitializeWalletInstruction,
  fetchHaptixWallet,
  getTransferSignedMessage,
  parseGuardianAddress,
} from '@/utils/haptix-client'
import { useHaptixDialog } from './haptix-dialog'
import { radius, space, typeScale, ThemeTokens } from '@/theme/tokens'

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

  const [isSending, setIsSending] = useState(false)
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

  // The screen cleared the recipient and its validation flags in the button handler that
  // opened this sheet. Now that the sheet owns them it clears on close instead of on
  // open, while it is hidden -- a sheet dismissed on a half-typed address used to come
  // back shouting that error in the first frame of the next slide-in. The amount is
  // deliberately left alone: re-sending the same size is the common case.
  useEffect(() => {
    if (visible) return
    setSendRecipient('')
    setSendRecipientSource(null)
    setRecipientAttemptError('')
    setSendRecipientAttempted(false)
    setSendRecipientBlurred(false)
    setSendErrorMsg('')
  }, [visible])

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

  // On-chain Send Transaction via Haptix Anchor Program & Secp256r1 Precompile
  const handleSendTransaction = async () => {
    setSendErrorMsg('')
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

    if (!wallet?.address) {
      dialog.alert('Error', 'No active smart wallet found.')
      return
    }

    const walletPda = new PublicKey(wallet.address)
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
      const needsInit = !onChain && !!(wallet.primaryPasskeyHex && wallet.secondaryPasskeyHex)

      let txInstructions = []

      // If wallet is not yet on-chain, atomically initialize it first in the SAME transaction
      if (needsInit) {
        const primaryPasskey = new Uint8Array(Buffer.from(wallet.primaryPasskeyHex, 'hex'))
        const secondaryPasskey = new Uint8Array(Buffer.from(wallet.secondaryPasskeyHex, 'hex'))
        const initIx = createInitializeWalletInstruction({
          payer: payer.publicKey,
          walletPda,
          primaryPasskey,
          secondaryPasskey,
          spendThresholdLamports: BigInt(Math.round(spendThreshold * LAMPORTS_PER_SOL)),
          guardian: parseGuardianAddress(wallet.guardianAddress) ?? undefined,
        })
        txInstructions.push(initIx)
      }

      const primarySigIxIndex = needsInit ? 1 : 0
      const secondarySigIxIndex = needsInit ? (isHighRiskQuorum ? 2 : undefined) : isHighRiskQuorum ? 1 : undefined

      if (isHighRiskQuorum) {
        // 2. High-Risk: 2-of-2 passkey quorum required
        const secondaryPrompt =
          wallet?.securityMode === 'vault'
            ? `Touch your Vault Key (Mac / YubiKey) to approve ${amt} SOL`
            : `Confirm with your backup key: ${amt} SOL`
        const secondarySig = await signWithPasskey('secondary', message, secondaryPrompt)

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

      onClose()

      dialog.alert(
        'Transfer Confirmed On-Chain',
        `Sent ${amt} SOL.\n\n${
          isHighRiskQuorum ? 'Verified: both passkeys' : 'Verified: passkey'
        }\n\nSignature: ${ellipsify(sig, 8)}`,
        [
          {
            text: 'Copy Link',
            onPress: () => {
              const clusterParam = network === 'devnet' ? '?cluster=devnet' : ''
              Clipboard.setString(`https://solscan.io/tx/${sig}${clusterParam}`)
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
            },
          },
          {
            text: 'View on Solscan',
            onPress: () => {
              const clusterParam = network === 'devnet' ? '?cluster=devnet' : ''
              Linking.openURL(`https://solscan.io/tx/${sig}${clusterParam}`)
            },
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

  const sendAmountNum = parseFloat(sendAmountText) || 0
  const isSendQuorumRequired = sendAmountNum > spendThreshold

  // Not blocked: moving your own SOL back to yourself is a legitimate devnet test. It is
  // only worth saying out loud so it does not happen by accident.
  const isRecipientSelf = !!recipientAddress && recipientAddress === wallet?.address
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
        <View style={[styles.expandedSendSheet, styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={[styles.modalDragHandle, { backgroundColor: theme.borderDefault }]} />

          {/* Modal Header */}
          <View style={styles.modalSheetHeader}>
            <View>
              <Text style={[styles.modalSheetTitle, styles.textPrimary]}>Send Solana</Text>
              <Text style={[styles.modalSheetSubtitle, styles.textMuted]}>Instant on-chain transfer via passkey</Text>
            </View>
            <TouchableOpacity
              onPress={() => onClose()}
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
                ].map((chip) => {
                  const chipVal = Math.max(0, maxSendableSol * chip.fraction).toFixed(4)
                  const isChipActive =
                    maxSendableSol > 0 &&
                    (sendAmountText === chipVal ||
                      (chip.fraction === 1 && Math.abs(sendAmountNum - maxSendableSol) < 0.0001))
                  return (
                    <TouchableOpacity
                      key={chip.label}
                      style={[
                        styles.percentChip,
                        styles.input,
                        isChipActive && {
                          backgroundColor: isDark
                            ? 'rgba(156, 147, 255, 0.18)'
                            : 'rgba(124, 101, 193, 0.14)',
                          borderColor: theme.accent,
                        },
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync()
                        setSendAmountText(chipVal)
                      }}
                    >
                      <Text
                        style={[
                          styles.percentChipText,
                          isChipActive ? { color: theme.accent, fontWeight: '700' } : styles.textSecondary,
                        ]}
                      >
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
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

              <View
                style={[
                  styles.inputBoxRow,
                  styles.input,
                  recipientAddress
                    ? {
                        borderColor: theme.emeraldBorder,
                        backgroundColor: isDark ? 'rgba(52, 211, 153, 0.06)' : 'rgba(16, 185, 129, 0.04)',
                      }
                    : showRecipientError && recipientParse.error
                    ? {
                        borderColor: theme.roseBorder,
                        backgroundColor: isDark ? 'rgba(248, 113, 113, 0.06)' : 'rgba(239, 68, 68, 0.04)',
                      }
                    : isResolvingName
                    ? {
                        borderColor: theme.accent,
                        backgroundColor: isDark ? 'rgba(124, 101, 193, 0.06)' : 'rgba(124, 101, 193, 0.04)',
                      }
                    : null,
                ]}
              >
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
                      Haptics.selectionAsync()
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
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="content-paste" size={13} color={theme.accent} />
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
                      name={isSendQuorumRequired ? (wallet?.securityMode === 'vault' ? 'devices' : 'security') : 'fingerprint'}
                      size={14}
                      color={isSendQuorumRequired ? theme.amber : theme.emerald}
                    />
                    <Text
                      style={[
                        styles.securityBadgeText,
                        { color: isSendQuorumRequired ? theme.amberText : theme.emeraldText },
                      ]}
                    >
                      {isSendQuorumRequired
                        ? wallet?.securityMode === 'vault'
                          ? 'Phone + Vault Key'
                          : 'Both passkeys'
                        : 'Fast Path (1 passkey)'}
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

            {/* VAULT MODE HELPER BANNER */}
            {isSendQuorumRequired && wallet?.securityMode === 'vault' ? (
              <View
                style={{
                  marginTop: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: theme.amberBg,
                  borderRadius: radius.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <MaterialIcons name="devices" size={18} color={theme.amber} />
                <Text style={{ color: theme.amberText, fontSize: typeScale.caption, flex: 1, lineHeight: 18 }}>
                  Dual-Device Vault Mode: transfers over {spendThreshold} SOL require confirmation from your secondary device or hardware key.
                </Text>
              </View>
            ) : null}

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
                title={
                  isSendQuorumRequired
                    ? wallet?.securityMode === 'vault'
                      ? 'Authorize with Phone + Vault Key'
                      : 'Authorize with Both Passkeys'
                    : 'Sign & Send with Passkey'
                }
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
  )
}

const createSendSheetStyles = (theme: ThemeTokens) =>
  StyleSheet.create({
    card: { backgroundColor: theme.bgCard, borderColor: theme.borderDefault },
    divider: { backgroundColor: theme.borderSubtle },
    elevatedCard: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
    input: { backgroundColor: theme.bgInput, borderColor: theme.borderDefault, color: theme.textPrimary },
    modalDragHandle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      alignSelf: 'center',
      marginBottom: 16,
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
      maxHeight: '92%',
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
  const { theme } = useAppTheme()
  return useMemo(() => createSendSheetStyles(theme), [theme])
}
