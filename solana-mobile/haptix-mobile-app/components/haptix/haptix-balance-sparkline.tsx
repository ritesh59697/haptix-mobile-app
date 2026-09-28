/**
 * HaptixBalanceSparkline
 *
 * Renders a 7-day SOL price sparkline inside the balance card.
 * Shows seed/fallback data immediately, then replaces with live
 * CoinGecko data once fetched.
 * Green line/fill when positive, red when negative.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { View } from 'react-native'
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg'

// ─── Types ────────────────────────────────────────────────────────────────────
type SparklineData = number[]

// ─── Realistic SOL fallback prices (used while fetching / on error) ───────────
// Approximate 7-day SOL prices – gives chart a real shape from the start.
const FALLBACK_SOL_PRICES: SparklineData = [
  148, 152, 145, 158, 162, 155, 160,
]

// ─── CoinGecko fetch ─────────────────────────────────────────────────────────
const COINGECKO_CHART_URL =
  'https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7&interval=daily'

async function fetchSolSparkline(): Promise<SparklineData> {
  const res = await fetch(COINGECKO_CHART_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
  const json = await res.json()
  const prices = (json.prices as [number, number][]).map(([, p]) => p)
  if (prices.length < 2) throw new Error('Too few data points')
  return prices
}

// ─── SVG path builders ────────────────────────────────────────────────────────

/** Catmull-Rom → cubic bezier smooth path through all points */
function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

/** Closed path for the gradient fill area below the line */
function buildAreaPath(pts: { x: number; y: number }[], H: number): string {
  const line = buildSmoothPath(pts)
  if (!line) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `${line} L ${last.x.toFixed(2)} ${H} L ${first.x.toFixed(2)} ${H} Z`
}

// ─── Normalise price array → SVG points ──────────────────────────────────────
function pricesToPoints(
  prices: SparklineData,
  W: number,
  H: number,
  pad = 3,
): { x: number; y: number }[] {
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  return prices.map((p, i) => ({
    x: pad + (i / (prices.length - 1)) * (W - pad * 2),
    y: H - pad - ((p - min) / range) * (H - pad * 2),
  }))
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  width: number
  height?: number
  isPositive: boolean
}

export function HaptixBalanceSparkline({ width, height = 72, isPositive }: Props) {
  // Start with fallback so chart is always visible immediately
  const [prices, setPrices] = useState<SparklineData>(FALLBACK_SOL_PRICES)

  const load = useCallback(async () => {
    try {
      const live = await fetchSolSparkline()
      setPrices(live)
    } catch {
      // Keep fallback silently
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ── Colours ──────────────────────────────────────────────────────────────
  const lineColor = isPositive ? '#34D399' : '#F87171'
  const gradTop   = isPositive ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'
  const gradBot   = 'rgba(0,0,0,0)'

  // ── Build SVG paths ───────────────────────────────────────────────────────
  const W = width
  const H = height
  const pts = pricesToPoints(prices, W, H)
  const linePath = buildSmoothPath(pts)
  const areaPath = buildAreaPath(pts, H)

  return (
    <View style={{ width: W, height: H, overflow: 'hidden' }}>
      <Svg width={W} height={H}>
        <Defs>
          <LinearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={gradTop} />
            <Stop offset="1" stopColor={gradBot} />
          </LinearGradient>
        </Defs>
        {/* gradient fill */}
        <Path d={areaPath} fill="url(#sparkGrad)" />
        {/* line */}
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
