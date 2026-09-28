/**
 * HaptixBalanceSparkline — OKX / MetaMask style
 *
 * Premium chart with:
 *  - Neon glow effect (double-painted line: soft bloom + sharp top layer)
 *  - Subtle gradient fill underneath
 *  - Hourly CoinGecko data (168 pts vs 7 daily) for a smoother curve
 *  - Green when positive, hot-pink/red when negative
 */
import React, { useEffect, useState, useCallback } from 'react'
import { View } from 'react-native'
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg'

type SparklineData = number[]

// ─── Realistic 24-point SOL fallback (used instantly while API loads) ─────────
const FALLBACK_SOL_PRICES: SparklineData = [
  152, 156, 153, 149, 155, 161, 158, 164, 160, 157,
  163, 168, 165, 162, 159, 166, 170, 167, 163, 158,
  161, 155, 158, 160,
]

// ─── CoinGecko — hourly data for past 7 days ──────────────────────────────────
// Omitting interval lets CG decide; for days<=90 it returns hourly (~168 pts)
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7'

async function fetchHourlySolPrices(): Promise<SparklineData> {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const json = await res.json()
  const prices = (json.prices as [number, number][]).map(([, p]) => p)
  if (prices.length < 4) throw new Error('Insufficient data')
  return prices
}

// ─── SVG path helpers ──────────────────────────────────────────────────────────

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function buildAreaPath(pts: { x: number; y: number }[], H: number): string {
  const line = buildSmoothPath(pts)
  if (!line) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `${line} L ${last.x.toFixed(1)} ${H} L ${first.x.toFixed(1)} ${H} Z`
}

function pricesToPoints(
  prices: SparklineData,
  W: number,
  H: number,
  padX = 0,
  padY = 6,
): { x: number; y: number }[] {
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  return prices.map((p, i) => ({
    x: padX + (i / (prices.length - 1)) * (W - padX * 2),
    y: padY + (1 - (p - min) / range) * (H - padY * 2),
  }))
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  width: number
  height?: number
  isPositive: boolean
  isDark: boolean
}

export function HaptixBalanceSparkline({
  width,
  height = 100,
  isPositive,
  isDark,
}: Props) {
  const [prices, setPrices] = useState<SparklineData>(FALLBACK_SOL_PRICES)

  const load = useCallback(async () => {
    try {
      const live = await fetchHourlySolPrices()
      setPrices(live)
    } catch {
      // keep fallback
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Colours ──────────────────────────────────────────────────────────────
  // Line colours — green (up) / hot pink-red (down) like OKX
  const lineColor   = isPositive ? '#00D4AA' : '#FF3B6B'
  // Glow layer — same hue, wider stroke, low opacity → bloom effect
  const glowColor   = isPositive ? 'rgba(0,212,170,0.35)' : 'rgba(255,59,107,0.35)'
  // Gradient fill alpha
  const fillTopAlpha = isDark ? 0.18 : 0.10
  const fillBotAlpha = 0
  const [r, g, b]   = isPositive ? [0, 212, 170] : [255, 59, 107]
  const gradTop     = `rgba(${r},${g},${b},${fillTopAlpha})`
  const gradBot     = `rgba(${r},${g},${b},${fillBotAlpha})`

  // ── Paths ────────────────────────────────────────────────────────────────
  const W = width
  const H = height
  const pts      = pricesToPoints(prices, W, H)
  const linePath = buildSmoothPath(pts)
  const areaPath = buildAreaPath(pts, H)

  return (
    <View style={{ width: W, height: H, overflow: 'hidden' }}>
      <Svg width={W} height={H}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={gradTop} />
            <Stop offset="1" stopColor={gradBot} />
          </LinearGradient>
        </Defs>

        {/* ── 1. Subtle gradient fill ── */}
        <Path d={areaPath} fill="url(#areaGrad)" />

        {/* ── 2. Glow bloom layer (wide + translucent) ── */}
        <Path
          d={linePath}
          stroke={glowColor}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* ── 3. Sharp line on top ── */}
        <Path
          d={linePath}
          stroke={lineColor}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}
