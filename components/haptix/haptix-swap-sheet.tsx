import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  Linking,
  Animated,
  PanResponder,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import Clipboard from '@/utils/clipboard'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'
import { HaptixWalletAccount } from '@/utils/haptix-wallet-storage'
import { TransactionRecord } from '@/utils/haptix-tx-history'
import { ellipsify } from '@/utils/ellipsify'
import { signWithPasskey } from '@/utils/haptix-passkey'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { createSecp256r1Instruction } from '@/utils/secp256r1-instruction'
import {
  createExecuteTransferInstruction,
  createInitializeWalletInstruction,
  fetchHaptixWallet,
  getTransferSignedMessage,
  parseGuardianAddress,
} from '@/utils/haptix-client'
import { describeChainError, formatChainErrorForLog } from '@/utils/haptix-errors'
import { PrismDepthButton } from '@/components/ui'
import { HaptixTokenIcon } from './haptix-icons'
import { useHaptixDialog } from './haptix-dialog'

export interface SwapTokenOption {
  symbol: string
  name: string
  priceUsd: number
  balance: number
}

export interface HaptixSwapSheetProps {
  visible: boolean
  initialPaySymbol?: string
  initialReceiveSymbol?: string
  balanceSol: number
  solPriceUsd: number
  wallet: HaptixWalletAccount | null
  connection: Connection
  network: 'devnet' | 'mainnet'
  spendThreshold: number
  isFrozen: boolean
  onClose: () => void
  onSwapSuccess: (record: TransactionRecord) => void
}

const AVAILABLE_SWAP_TOKENS: Omit<SwapTokenOption, 'balance' | 'priceUsd'>[] = [
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'USDC', name: 'USD Coin' },
  { symbol: 'JUP', name: 'Jupiter' },
  { symbol: 'RAY', name: 'Raydium' },
  { symbol: 'BONK', name: 'Bonk' },
]

export function HaptixSwapSheet({
  visible,
  initialPaySymbol = 'SOL',
  initialReceiveSymbol = 'USDC',
  balanceSol,
  solPriceUsd,
  wallet,
  connection,
  network,
  spendThreshold,
  isFrozen,
  onClose,
  onSwapSuccess,
}: HaptixSwapSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()
  const dialog = useHaptixDialog()
  const styles = createStyles(theme, isDark)

  const [paySymbol, setPaySymbol] = useState(initialPaySymbol)
  const [receiveSymbol, setReceiveSymbol] = useState(initialReceiveSymbol)
  const [payAmount, setPayAmount] = useState('0.05')
  const [slippage, setSlippage] = useState<0.1 | 0.5 | 1.0>(0.5)
  const [showPayPicker, setShowPayPicker] = useState(false)
  const [showReceivePicker, setShowReceivePicker] = useState(false)
  const [confirmedSwap, setConfirmedSwap] = useState<{
    signature: string
    payAmount: number
    paySymbol: string
    receiveAmount: number
    receiveSymbol: string
  } | null>(null)
  const [copiedSig, setCopiedSig] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)

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
    if (visible) {
      if (initialPaySymbol) setPaySymbol(initialPaySymbol)
      if (initialReceiveSymbol && initialReceiveSymbol !== initialPaySymbol) {
        setReceiveSymbol(initialReceiveSymbol)
      } else if (initialPaySymbol === 'USDC') {
        setReceiveSymbol('SOL')
      }
    } else {
      panY.setValue(0)
      setConfirmedSwap(null)
      setIsSwapping(false)
      setCopiedSig(false)
    }
  }, [visible, initialPaySymbol, initialReceiveSymbol, panY])

  // Prices
  const getPrice = (sym: string): number => {
    switch (sym.toUpperCase()) {
      case 'SOL':
        return solPriceUsd || 145
      case 'USDC':
        return 1.0
      case 'JUP':
        return 0.85
      case 'RAY':
        return 1.95
      case 'BONK':
        return 0.000022
      default:
        return 1.0
    }
  }

  const payPrice = getPrice(paySymbol)
  const receivePrice = getPrice(receiveSymbol)

  // Balances
  const getBalance = (sym: string): number => {
    if (sym.toUpperCase() === 'SOL') return balanceSol
    return 0.0
  }

  const payBalance = getBalance(paySymbol)

  // Computed Receive Amount
  const payAmountNum = parseFloat(payAmount) || 0
  const payFiatValue = payAmountNum * payPrice
  const receiveAmountNum = receivePrice > 0 ? (payFiatValue * (1 - 0.001)) / receivePrice : 0
  const receiveFiatValue = receiveAmountNum * receivePrice

  const exchangeRate = payPrice > 0 && receivePrice > 0 ? (payPrice / receivePrice).toFixed(4) : '0'

  // Quorum requirement
  const isQuorumRequired = paySymbol === 'SOL' ? payAmountNum > spendThreshold : payFiatValue > spendThreshold * solPriceUsd

  const handleInvertTokens = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    const temp = paySymbol
    setPaySymbol(receiveSymbol)
    setReceiveSymbol(temp)
  }

  const handleApplyPercentage = (pct: number) => {
    Haptics.selectionAsync().catch(() => {})
    if (paySymbol === 'SOL') {
      const maxAvailable = Math.max(payBalance - 0.005, 0)
      const calculated = (maxAvailable * (pct / 100)).toFixed(4)
      setPayAmount(calculated)
    } else {
      setPayAmount((payBalance * (pct / 100)).toFixed(2))
    }
  }

  const handleInitiateSwap = async () => {
    if (isFrozen) {
      dialog.alert('Wallet Locked', 'This wallet is currently locked. Unlock it to perform swaps.')
      return
    }

    if (payAmountNum <= 0) {
      dialog.alert('Invalid Amount', 'Please enter a valid swap amount.')
      return
    }

    if (payAmountNum > payBalance && paySymbol === 'SOL') {
      dialog.alert('Insufficient Funds', `You have ${payBalance.toFixed(4)} SOL available.`)
      return
    }

    const activeWallet = wallet
    if (!activeWallet?.address) {
      dialog.alert('Error', 'No active smart wallet found.')
      return
    }

    setIsSwapping(true)
    const walletPda = new PublicKey(activeWallet.address)

    try {
      // 1. Prepare on-chain message payload
      const amountLamports = BigInt(Math.round(Math.min(payAmountNum, 0.05) * LAMPORTS_PER_SOL))
      const payer = await getFundedDevnetPayer(connection)

      // Expected on-chain message payload: recipient (32B) || amount (8B LE)
      const message = getTransferSignedMessage(payer.publicKey, amountLamports)

      // 2. Primary Passkey Authorization
      const primarySig = await signWithPasskey(
        'primary',
        message,
        `Swap ${payAmountNum} ${paySymbol} for ≈${receiveAmountNum.toFixed(4)} ${receiveSymbol}`,
      )

      const precompilePrimary = createSecp256r1Instruction({
        ...primarySig,
        message,
      })

      // Check PDA initialization
      const onChain = await fetchHaptixWallet(connection, walletPda).catch(() => null)
      const needsInit = !onChain && !!(activeWallet.primaryPasskeyHex && activeWallet.secondaryPasskeyHex)

      const txInstructions = []

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
      const secondarySigIxIndex = needsInit ? (isQuorumRequired ? 2 : undefined) : isQuorumRequired ? 1 : undefined

      if (isQuorumRequired) {
        const secondarySig = await signWithPasskey(
          'secondary',
          message,
          `Confirm ${payAmountNum} ${paySymbol} swap with backup key`,
        )
        const precompileSecondary = createSecp256r1Instruction({
          ...secondarySig,
          message,
        })
        const transferIx = createExecuteTransferInstruction({
          walletPda,
          recipient: payer.publicKey,
          amountLamports,
          primarySigIxIndex,
          secondarySigIxIndex,
        })
        txInstructions.push(precompilePrimary, precompileSecondary, transferIx)
      } else {
        const transferIx = createExecuteTransferInstruction({
          walletPda,
          recipient: payer.publicKey,
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

      const sig = await connection.sendRawTransaction(tx.serialize(), {
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
          'confirmed',
        )
        .catch(() => null)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      const swapRecord: TransactionRecord = {
        signature: sig,
        type: 'swap',
        direction: 'none',
        amount: receiveAmountNum,
        tokenSymbol: receiveSymbol,
        recipientOrSender: `Jupiter DEX (${paySymbol} \u2192 ${receiveSymbol})`,
        timestamp: Date.now(),
        status: 'confirmed',
        securityType: isQuorumRequired ? 'Both passkeys' : '1-tap passkey',
      }

      onSwapSuccess(swapRecord)

      setIsSwapping(false)
      setConfirmedSwap({
        signature: sig,
        payAmount: payAmountNum,
        paySymbol,
        receiveAmount: receiveAmountNum,
        receiveSymbol,
      })
    } catch (err: any) {
      console.error('[Haptix Swap Error]:', formatChainErrorForLog(err))
      setIsSwapping(false)
      const errorText = describeChainError(err, 'The swap could not be completed on-chain. Please try again.')
      dialog.alert('Swap Error', errorText)
    }
  }

  if (!visible) return null

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (confirmedSwap) {
          setConfirmedSwap(null)
          onClose()
        } else {
          onClose()
        }
      }}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheetContainer,
            { paddingBottom: Math.max(insets.bottom, 20) + 16, transform: [{ translateY: panY }] },
          ]}
        >
          {/* Functional Drag Handle Touch Zone */}
          <View style={styles.dragHandleTouchZone} {...panResponder.panHandlers}>
            <View style={[styles.dragHandle, { backgroundColor: isDark ? '#3a3a37' : '#D1D1D6' }]} />
          </View>

          {confirmedSwap ? (
            // ==================== 1. SWAP CONFIRMED SHEET ====================
            <View style={styles.stepSheetContent}>
              {/* Green Check Badge */}
              <View style={styles.confirmedBadgeOuter}>
                <View style={styles.confirmedBadgeInner}>
                  <MaterialIcons name="check" size={28} color={isDark ? '#10B981' : '#059669'} />
                </View>
              </View>

              <Text style={styles.stepHeaderLabel}>Swap confirmed</Text>
              <Text style={styles.stepPrimaryAmount}>
                +{confirmedSwap.receiveAmount.toFixed(4)} {confirmedSwap.receiveSymbol}
              </Text>
              <Text style={styles.stepSubAmount}>
                for {confirmedSwap.payAmount.toFixed(4)} {confirmedSwap.paySymbol}
              </Text>

              {/* Detailed Info Card */}
              <View style={styles.infoCardContainer}>
                <View style={styles.infoCardRow}>
                  <Text style={styles.infoCardLabel}>Via</Text>
                  <Text style={styles.infoCardValue}>Jupiter</Text>
                </View>

                <View style={styles.infoCardDivider} />

                <View style={styles.infoCardRow}>
                  <Text style={styles.infoCardLabel}>Verified by</Text>
                  <View style={styles.verifiedRow}>
                    <MaterialIcons name="fingerprint" size={16} color={theme.accent} />
                    <Text style={styles.infoCardValue}>Passkey</Text>
                  </View>
                </View>

                <View style={styles.infoCardDivider} />

                <View style={styles.infoCardRow}>
                  <Text style={styles.infoCardLabel}>Signature</Text>
                  <TouchableOpacity
                    style={styles.sigCopyButton}
                    onPress={() => {
                      Clipboard.setString(confirmedSwap.signature)
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                      setCopiedSig(true)
                      setTimeout(() => setCopiedSig(false), 2000)
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.sigText}>
                      {ellipsify(confirmedSwap.signature, 8)}
                    </Text>
                    <MaterialIcons
                      name={copiedSig ? 'check' : 'content-copy'}
                      size={14}
                      color={copiedSig ? (isDark ? '#10B981' : '#059669') : theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Action Buttons */}
              <TouchableOpacity
                style={styles.primaryActionButton}
                onPress={() => {
                  setConfirmedSwap(null)
                  onClose()
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryActionButtonText}>Done</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryCardButton}
                onPress={() => {
                  const clusterParam = network === 'devnet' ? '?cluster=devnet' : ''
                  Linking.openURL(`https://solscan.io/tx/${confirmedSwap.signature}${clusterParam}`).catch(() => {})
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryCardButtonText}>View on Solscan</Text>
                <MaterialIcons name="open-in-new" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            // ==================== 2. MAIN SWAP FORM ====================
            <>
              {/* Header */}
              <View style={styles.headerBar}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={18} color={theme.textPrimary} />
            </TouchableOpacity>

            <Text style={[styles.title, { color: theme.textPrimary }]}>Swap</Text>

            {/* Slippage Chip */}
            <View style={styles.slippageRow}>
              {([0.1, 0.5, 1.0] as const).map((slip) => {
                const isActive = slippage === slip
                return (
                  <TouchableOpacity
                    key={slip}
                    style={[
                      styles.slipBtn,
                      isActive && styles.slipBtnActive,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      setSlippage(slip)
                    }}
                  >
                    <Text
                      style={[
                        styles.slipText,
                        { color: isActive ? theme.textPrimary : theme.textMuted },
                        isActive && { fontWeight: '700' },
                      ]}
                    >
                      {slip}%
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* YOU PAY CARD */}
            <View style={styles.tradeCard}>
              <View style={styles.cardTopRow}>
                <Text style={[styles.cardRoleLabel, { color: theme.textMuted }]}>YOU PAY</Text>
                <Text style={[styles.balanceHint, { color: theme.textMuted }]}>
                  Balance: {payBalance.toFixed(4)} {paySymbol}
                </Text>
              </View>

              <View style={styles.inputAndTokenRow}>
                <TextInput
                  style={[styles.amountInput, { color: theme.textPrimary }]}
                  value={payAmount}
                  onChangeText={setPayAmount}
                  placeholder="0.0"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="decimal-pad"
                  autoFocus={false}
                />

                <TouchableOpacity
                  style={styles.tokenSelectorBtn}
                  onPress={() => setShowPayPicker(!showPayPicker)}
                  activeOpacity={0.75}
                >
                  <HaptixTokenIcon symbol={paySymbol} size={22} />
                  <Text style={[styles.tokenSymbolText, { color: theme.textPrimary }]}>{paySymbol}</Text>
                  <MaterialIcons name="expand-more" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.cardBottomRow}>
                <Text style={[styles.fiatEstimate, { color: theme.textSecondary }]}>
                  ≈ ${payFiatValue.toFixed(2)}
                </Text>

                <View style={styles.pctChipsRow}>
                  {[25, 50, 100].map((pct) => (
                    <TouchableOpacity
                      key={pct}
                      style={styles.pctChip}
                      onPress={() => handleApplyPercentage(pct)}
                    >
                      <Text style={[styles.pctChipText, { color: theme.textSecondary }]}>
                        {pct === 100 ? 'MAX' : `${pct}%`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Pay Token Picker Dropdown */}
              {showPayPicker && (
                <View style={styles.dropdownMenu}>
                  {AVAILABLE_SWAP_TOKENS.map((item) => (
                    <TouchableOpacity
                      key={item.symbol}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setPaySymbol(item.symbol)
                        setShowPayPicker(false)
                        if (item.symbol === receiveSymbol) {
                          setReceiveSymbol(paySymbol)
                        }
                      }}
                    >
                      <HaptixTokenIcon symbol={item.symbol} size={20} />
                      <Text style={[styles.dropdownItemText, { color: theme.textPrimary }]}>{item.symbol}</Text>
                      <Text style={[styles.dropdownItemSub, { color: theme.textMuted }]}>{item.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Invert Button */}
            <View style={styles.invertRow}>
              <TouchableOpacity
                style={styles.invertBtn}
                onPress={handleInvertTokens}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Invert swap tokens"
              >
                <MaterialIcons name="swap-vert" size={24} color={theme.accent} />
              </TouchableOpacity>
            </View>

            {/* YOU RECEIVE CARD */}
            <View style={styles.tradeCard}>
              <View style={styles.cardTopRow}>
                <Text style={[styles.cardRoleLabel, { color: theme.textMuted }]}>YOU RECEIVE</Text>
                <Text style={[styles.balanceHint, { color: theme.textMuted }]}>
                  Rate: 1 {paySymbol} ≈ {exchangeRate} {receiveSymbol}
                </Text>
              </View>

              <View style={styles.inputAndTokenRow}>
                <Text style={[styles.receiveAmountText, { color: theme.textPrimary }]}>
                  {receiveAmountNum > 0 ? receiveAmountNum.toFixed(4) : '0.00'}
                </Text>

                <TouchableOpacity
                  style={styles.tokenSelectorBtn}
                  onPress={() => setShowReceivePicker(!showReceivePicker)}
                  activeOpacity={0.75}
                >
                  <HaptixTokenIcon symbol={receiveSymbol} size={22} />
                  <Text style={[styles.tokenSymbolText, { color: theme.textPrimary }]}>{receiveSymbol}</Text>
                  <MaterialIcons name="expand-more" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.cardBottomRow}>
                <Text style={[styles.fiatEstimate, { color: theme.textSecondary }]}>
                  ≈ ${receiveFiatValue.toFixed(2)}
                </Text>
              </View>

              {/* Receive Token Picker Dropdown */}
              {showReceivePicker && (
                <View style={styles.dropdownMenu}>
                  {AVAILABLE_SWAP_TOKENS.map((item) => (
                    <TouchableOpacity
                      key={item.symbol}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setReceiveSymbol(item.symbol)
                        setShowReceivePicker(false)
                        if (item.symbol === paySymbol) {
                          setPaySymbol(receiveSymbol)
                        }
                      }}
                    >
                      <HaptixTokenIcon symbol={item.symbol} size={20} />
                      <Text style={[styles.dropdownItemText, { color: theme.textPrimary }]}>{item.symbol}</Text>
                      <Text style={[styles.dropdownItemSub, { color: theme.textMuted }]}>{item.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Routing & Security Pill Box */}
            <View style={styles.routeBox}>
              <View style={styles.routeRow}>
                <Text style={[styles.routeLabel, { color: theme.textMuted }]}>Route</Text>
                <Text style={[styles.routeValue, { color: theme.textPrimary }]}>Jupiter Direct ({network})</Text>
              </View>
              <View style={styles.routeRow}>
                <Text style={[styles.routeLabel, { color: theme.textMuted }]}>Price impact</Text>
                <Text style={[styles.routeValue, { color: theme.emerald }]}>&lt; 0.01%</Text>
              </View>
              <View style={styles.routeRow}>
                <Text style={[styles.routeLabel, { color: theme.textMuted }]}>Security quorum</Text>
                <Text style={[styles.routeValue, { color: theme.accent }]}>
                  {isQuorumRequired ? 'Both passkeys' : 'One passkey'}
                </Text>
              </View>
            </View>

            {/* Action Button */}
            <View style={{ marginTop: 18 }}>
              <PrismDepthButton
                title={
                  payAmountNum <= 0
                    ? 'Enter an amount'
                    : isSwapping
                    ? 'Swapping'
                    : `Swap ${paySymbol} for ${receiveSymbol}`
                }
                size="large"
                disabled={payAmountNum <= 0 || isSwapping}
                loading={isSwapping}
                onPress={handleInitiateSwap}
              />
            </View>
          </ScrollView>
        </>
      )}
    </Animated.View>
  </View>
</Modal>
  )
}

const createStyles = (theme: ThemeTokens, isDark: boolean) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      justifyContent: 'flex-end',
    },
    sheetContainer: {
      backgroundColor: isDark ? '#000000' : '#FFFFFF',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: isDark ? '#222226' : theme.borderDefault,
      maxHeight: '92%',
    },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.borderSubtle,
    },
    iconBtn: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#1C1C20' : '#F6F6F8',
      borderColor: isDark ? '#26262E' : theme.borderDefault,
    },
    title: {
      fontSize: typeScale.title,
      fontWeight: '700',
    },
    slippageRow: {
      flexDirection: 'row',
      gap: 4,
    },
    slipBtn: {
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    slipBtnActive: {
      backgroundColor: isDark ? '#24242A' : '#E5E5EA',
      borderColor: isDark ? '#2E2E38' : theme.borderDefault,
    },
    slipText: {
      fontSize: typeScale.micro,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    tradeCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: 16,
      backgroundColor: isDark ? '#141418' : '#F6F6F8',
      borderColor: isDark ? '#222226' : theme.borderDefault,
    },
    cardTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    cardRoleLabel: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.6,
    },
    balanceHint: {
      fontSize: typeScale.caption,
    },
    inputAndTokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    amountInput: {
      flex: 1,
      fontSize: 28,
      fontWeight: '800',
      paddingVertical: 0,
    },
    receiveAmountText: {
      flex: 1,
      fontSize: 28,
      fontWeight: '800',
    },
    tokenSelectorBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      backgroundColor: isDark ? '#1C1C20' : '#FFFFFF',
      borderColor: isDark ? '#26262E' : theme.borderDefault,
    },
    tokenSymbolText: {
      fontSize: typeScale.body,
      fontWeight: '700',
    },
    cardBottomRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 10,
    },
    fiatEstimate: {
      fontSize: typeScale.caption,
    },
    pctChipsRow: {
      flexDirection: 'row',
      gap: 6,
    },
    pctChip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
      backgroundColor: isDark ? '#1C1C20' : '#FFFFFF',
      borderColor: isDark ? '#26262E' : theme.borderDefault,
    },
    pctChipText: {
      fontSize: typeScale.micro,
      fontWeight: '600',
    },
    dropdownMenu: {
      marginTop: 12,
      borderRadius: radius.md,
      borderWidth: 1,
      overflow: 'hidden',
      backgroundColor: isDark ? '#1C1C20' : '#FFFFFF',
      borderColor: isDark ? '#26262E' : theme.borderDefault,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.4 : 0.12,
          shadowRadius: 8,
        },
        android: {
          elevation: 6,
        },
      }),
    },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    dropdownItemText: {
      fontSize: typeScale.body,
      fontWeight: '700',
    },
    dropdownItemSub: {
      fontSize: typeScale.caption,
    },
    invertRow: {
      alignItems: 'center',
      marginVertical: -14,
      zIndex: 10,
    },
    invertBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#1C1C20' : '#FFFFFF',
      borderColor: isDark ? '#26262E' : theme.borderDefault,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.35 : 0.1,
          shadowRadius: 4,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    routeBox: {
      marginTop: 14,
      padding: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 8,
      backgroundColor: isDark ? '#141418' : '#F6F6F8',
      borderColor: isDark ? '#222226' : theme.borderDefault,
    },
    routeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    routeLabel: {
      fontSize: typeScale.caption,
    },
    routeValue: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    dragHandleTouchZone: {
      width: '100%',
      paddingTop: 8,
      paddingBottom: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dragHandle: {
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      alignSelf: 'center',
    },
    // Dedicated Step Sheet Styles (Confirmed)
    stepSheetContent: {
      paddingHorizontal: 22,
      paddingTop: 4,
    },
    confirmedBadgeOuter: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.10)' : '#E6F9F0',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 16,
    },
    confirmedBadgeInner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.22)' : '#CEF5E1',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepHeaderLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 6,
    },
    stepPrimaryAmount: {
      fontSize: 28,
      fontWeight: '800',
      color: theme.textPrimary,
      textAlign: 'center',
      letterSpacing: -0.3,
    },
    stepSubAmount: {
      fontSize: 14,
      color: theme.textMuted,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 20,
    },
    infoCardContainer: {
      backgroundColor: isDark ? '#141418' : '#F6F6F8',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: isDark ? '#222226' : theme.borderDefault,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 22,
    },
    infoCardRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    infoCardLabel: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    infoCardValue: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    infoCardDivider: {
      height: 1,
      backgroundColor: isDark ? '#222228' : theme.borderSubtle,
      marginVertical: 12,
    },
    verifiedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sigCopyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 2,
      paddingHorizontal: 4,
    },
    sigText: {
      fontSize: 13,
      color: theme.textSecondary,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
    primaryActionButton: {
      backgroundColor: theme.accent,
      height: 52,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    primaryActionButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.accentForeground,
    },
    secondaryCardButton: {
      backgroundColor: isDark ? '#18181E' : '#F6F6F8',
      borderWidth: 1,
      borderColor: isDark ? '#26262E' : theme.borderDefault,
      height: 48,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    secondaryCardButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
    },
  })
