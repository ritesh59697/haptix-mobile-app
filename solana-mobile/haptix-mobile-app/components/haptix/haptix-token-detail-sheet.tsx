import React, { useState, useMemo } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale, ThemeTokens } from '@/theme/tokens'
import { MarketToken } from '@/utils/haptix-prices'
import { HaptixTokenIcon } from './haptix-icons'

export type ChartTimeframe = '1H' | '1D' | '1W' | '1M' | 'ALL'

export interface HaptixTokenDetailSheetProps {
  visible: boolean
  token: MarketToken | null
  balanceSol: number
  solPriceUsd: number
  onClose: () => void
  onSend: (symbol: string) => void
  onReceive: (symbol: string) => void
  onSwap: (symbol: string) => void
}

/**
 * Generate simulated price points for sparkline based on base price, trend, and timeframe
 */
function generatePricePoints(
  basePrice: number,
  changePct: number,
  timeframe: ChartTimeframe,
  isPositive: boolean,
): number[] {
  const pointsCount = 24
  const points: number[] = []
  const volatility =
    timeframe === '1H' ? 0.008 : timeframe === '1D' ? 0.025 : timeframe === '1W' ? 0.06 : 0.12

  // Start from past price
  const trendMultiplier = isPositive ? 1 + Math.abs(changePct) / 100 : 1 - Math.abs(changePct) / 100
  const startPrice = basePrice / (trendMultiplier || 1)

  for (let i = 0; i < pointsCount; i++) {
    const progress = i / (pointsCount - 1)
    // Interpolate between start and current price with organic noise
    const baseInterp = startPrice + (basePrice - startPrice) * progress
    const wave1 = Math.sin(progress * Math.PI * 3.2) * (basePrice * volatility * 0.4)
    const wave2 = Math.cos(progress * Math.PI * 5.1) * (basePrice * volatility * 0.25)
    const pseudoRandom = Math.sin(i * 997) * (basePrice * volatility * 0.2)
    const val = i === pointsCount - 1 ? basePrice : baseInterp + wave1 + wave2 + pseudoRandom
    points.push(Math.max(val, basePrice * 0.5))
  }
  return points
}

/**
 * Build SVG smooth bezier path and gradient area path from points
 */
function buildSvgPaths(points: number[], width: number, height: number) {
  if (points.length < 2) return { linePath: '', areaPath: '', lastX: 0, lastY: 0 }

  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const paddingY = 16

  const coords = points.map((p, index) => {
    const x = (index / (points.length - 1)) * width
    const norm = (p - min) / range
    const y = height - paddingY - norm * (height - paddingY * 2)
    return { x, y }
  })

  // Build smooth cubic bezier curve
  let linePath = `M ${coords[0].x} ${coords[0].y}`
  for (let i = 0; i < coords.length - 1; i++) {
    const current = coords[i]
    const next = coords[i + 1]
    const cpX = (current.x + next.x) / 2
    linePath += ` C ${cpX} ${current.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`
  }

  const last = coords[coords.length - 1]
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

  return { linePath, areaPath, lastX: last.x, lastY: last.y }
}

export function HaptixTokenDetailSheet({
  visible,
  token,
  balanceSol,
  solPriceUsd,
  onClose,
  onSend,
  onReceive,
  onSwap,
}: HaptixTokenDetailSheetProps) {
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()
  const styles = createStyles(theme, isDark)

  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1D')

  const chartWidth = Math.min(Dimensions.get('window').width - 48, 380)
  const chartHeight = 150

  const activeToken = token ?? {
    symbol: 'SOL',
    name: 'Solana',
    price: `$${solPriceUsd.toFixed(2)}`,
    priceUsd: solPriceUsd,
    change: '+1.05%',
    changePct: 1.05,
    isPositive: true,
  }

  const isPositive = activeToken.isPositive
  const trendColor = isPositive ? theme.emerald : theme.roseText

  const points = useMemo(() => {
    return generatePricePoints(
      activeToken.priceUsd || solPriceUsd,
      activeToken.changePct || 1.0,
      timeframe,
      isPositive,
    )
  }, [activeToken.priceUsd, activeToken.changePct, timeframe, isPositive, solPriceUsd])

  const { linePath, areaPath, lastX, lastY } = useMemo(() => {
    return buildSvgPaths(points, chartWidth, chartHeight)
  }, [points, chartWidth, chartHeight])

  // Holdings
  const isSol = activeToken.symbol.toUpperCase() === 'SOL'
  const userBalance = isSol ? balanceSol : 0.0
  const userFiatValue = isSol ? balanceSol * (activeToken.priceUsd || solPriceUsd) : 0.0

  if (!visible) return null

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheetContainer, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close token details"
            >
              <MaterialIcons name="close" size={18} color={theme.textPrimary} />
            </TouchableOpacity>

            <View style={styles.tokenTitleWrap}>
              <HaptixTokenIcon symbol={activeToken.symbol} size={22} />
              <Text style={[styles.tokenName, { color: theme.textPrimary }]}>{activeToken.name}</Text>
              <MaterialIcons name="verified" size={16} color={theme.accent} style={{ marginLeft: 2 }} />
            </View>

            <View style={[styles.tagBadge, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}>
              <Text style={[styles.tagText, { color: theme.textSecondary }]}>{activeToken.symbol}</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Hero Price & 24h Change */}
            <View style={styles.heroPriceSection}>
              <Text style={[styles.heroPrice, { color: theme.textPrimary }]}>{activeToken.price}</Text>
              <View style={styles.trendRow}>
                <View
                  style={[
                    styles.trendPill,
                    {
                      backgroundColor: isPositive ? theme.emeraldBg : theme.roseBg,
                      borderColor: isPositive ? theme.emeraldBorder : theme.roseBorder,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={isPositive ? 'arrow-drop-up' : 'arrow-drop-down'}
                    size={16}
                    color={trendColor}
                  />
                  <Text style={[styles.trendText, { color: trendColor }]}>{activeToken.change}</Text>
                </View>
                <Text style={[styles.timeframeSubtitle, { color: theme.textMuted }]}>past {timeframe}</Text>
              </View>
            </View>

            {/* Sparkline Chart */}
            <View style={styles.chartContainer}>
              <Svg width={chartWidth} height={chartHeight}>
                <Defs>
                  <LinearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={trendColor} stopOpacity={0.32} />
                    <Stop offset="80%" stopColor={trendColor} stopOpacity={0.04} />
                    <Stop offset="100%" stopColor={trendColor} stopOpacity={0.0} />
                  </LinearGradient>
                </Defs>
                {/* Shaded Area */}
                <Path d={areaPath} fill="url(#chartGradient)" />
                {/* Line */}
                <Path d={linePath} fill="none" stroke={trendColor} strokeWidth={2.4} strokeLinecap="round" />
                {/* Glowing Pulse Dot at end */}
                <Circle cx={lastX} cy={lastY} r={4.5} fill={trendColor} />
                <Circle cx={lastX} cy={lastY} r={8} fill={trendColor} opacity={0.25} />
              </Svg>
            </View>

            {/* Timeframe Filters (1H, 1D, 1W, 1M, ALL) */}
            <View style={styles.timeframeRow}>
              {(['1H', '1D', '1W', '1M', 'ALL'] as ChartTimeframe[]).map((tf) => {
                const isActive = timeframe === tf
                return (
                  <TouchableOpacity
                    key={tf}
                    style={[
                      styles.timeframeBtn,
                      isActive && {
                        backgroundColor: theme.bgElevated,
                        borderColor: theme.borderDefault,
                      },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      setTimeframe(tf)
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.timeframeBtnText,
                        { color: isActive ? theme.textPrimary : theme.textMuted },
                        isActive && { fontWeight: '700' },
                      ]}
                    >
                      {tf}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* Phantom-Style Action Buttons: [ Swap ] · [ Send ] · [ Receive ] */}
            <View style={styles.actionButtonsRow}>
              <TouchableOpacity
                style={[styles.actionCard, { backgroundColor: theme.accentLight, borderColor: theme.borderDefault }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
                  onClose()
                  onSwap(activeToken.symbol)
                }}
                activeOpacity={0.75}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: theme.accent }]}>
                  <MaterialIcons name="swap-horiz" size={22} color={theme.accentForeground} />
                </View>
                <Text style={[styles.actionCardLabel, { color: theme.textPrimary }]}>Swap</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                  onClose()
                  onSend(activeToken.symbol)
                }}
                activeOpacity={0.75}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: theme.bgElevated }]}>
                  <MaterialIcons name="arrow-upward" size={20} color={theme.textPrimary} />
                </View>
                <Text style={[styles.actionCardLabel, { color: theme.textPrimary }]}>Send</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                  onClose()
                  onReceive(activeToken.symbol)
                }}
                activeOpacity={0.75}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: theme.bgElevated }]}>
                  <MaterialIcons name="arrow-downward" size={20} color={theme.textPrimary} />
                </View>
                <Text style={[styles.actionCardLabel, { color: theme.textPrimary }]}>Receive</Text>
              </TouchableOpacity>
            </View>

            {/* Your Holdings Card */}
            <View style={[styles.holdingsCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
              <View style={styles.holdingsHeader}>
                <Text style={[styles.holdingsTitle, { color: theme.textMuted }]}>YOUR BALANCE</Text>
                <Text style={[styles.holdingsNetwork, { color: theme.textMuted }]}>Solana Devnet</Text>
              </View>
              <View style={styles.holdingsRow}>
                <Text style={[styles.holdingsCrypto, { color: theme.textPrimary }]}>
                  {userBalance.toFixed(4)} {activeToken.symbol}
                </Text>
                <Text style={[styles.holdingsFiat, { color: theme.textSecondary }]}>
                  ≈ ${userFiatValue.toFixed(2)}
                </Text>
              </View>
            </View>

            {/* Token Market Stats (2x2 Grid) */}
            <View style={[styles.statsCard, { backgroundColor: theme.bgCard, borderColor: theme.borderDefault }]}>
              <Text style={[styles.statsHeading, { color: theme.textMuted }]}>MARKET STATS</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statItem}>
                  <Text style={[styles.statLabel, { color: theme.textMuted }]}>Market Cap</Text>
                  <Text style={[styles.statValue, { color: theme.textPrimary }]}>
                    {activeToken.symbol === 'SOL' ? '$54.2 B' : activeToken.symbol === 'USDC' ? '$34.1 B' : '$1.2 B'}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statLabel, { color: theme.textMuted }]}>24h Volume</Text>
                  <Text style={[styles.statValue, { color: theme.textPrimary }]}>
                    {activeToken.symbol === 'SOL' ? '$3.8 B' : '$780 M'}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statLabel, { color: theme.textMuted }]}>Circulating Supply</Text>
                  <Text style={[styles.statValue, { color: theme.textPrimary }]}>
                    {activeToken.symbol === 'SOL' ? '468.2M SOL' : '10.0B'}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statLabel, { color: theme.textMuted }]}>All-Time High</Text>
                  <Text style={[styles.statValue, { color: theme.textPrimary }]}>
                    {activeToken.symbol === 'SOL' ? '$259.96' : '$1.00'}
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
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
      backgroundColor: theme.bgApp,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      borderColor: theme.borderDefault,
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
    },
    tokenTitleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    tokenName: {
      fontSize: typeScale.title,
      fontWeight: '700',
    },
    tagBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    tagText: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    heroPriceSection: {
      alignItems: 'center',
      marginBottom: 16,
    },
    heroPrice: {
      fontSize: 36,
      fontWeight: '800',
      letterSpacing: -1,
    },
    trendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    trendPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    trendText: {
      fontSize: typeScale.caption,
      fontWeight: '700',
    },
    timeframeSubtitle: {
      fontSize: typeScale.footnote,
    },
    chartContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 4,
    },
    timeframeRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      marginVertical: 14,
    },
    timeframeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    timeframeBtnText: {
      fontSize: typeScale.caption,
      fontWeight: '600',
    },
    actionButtonsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      marginVertical: 16,
    },
    actionCard: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: radius.lg,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    actionIconCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionCardLabel: {
      fontSize: typeScale.footnote,
      fontWeight: '700',
    },
    holdingsCard: {
      padding: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginBottom: 12,
    },
    holdingsHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    holdingsTitle: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.6,
    },
    holdingsNetwork: {
      fontSize: typeScale.micro,
    },
    holdingsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    holdingsCrypto: {
      fontSize: typeScale.title,
      fontWeight: '700',
    },
    holdingsFiat: {
      fontSize: typeScale.body,
    },
    statsCard: {
      padding: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginBottom: 20,
    },
    statsHeading: {
      fontSize: typeScale.micro,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginBottom: 12,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: 14,
    },
    statItem: {
      width: '50%',
    },
    statLabel: {
      fontSize: typeScale.caption,
      marginBottom: 2,
    },
    statValue: {
      fontSize: typeScale.body,
      fontWeight: '700',
    },
  })
