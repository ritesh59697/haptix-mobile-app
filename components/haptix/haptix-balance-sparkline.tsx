/**
 * HaptixBalanceSparkline
 *
 * Fetches the last 7 days of SOL price from CoinGecko and renders
 * a smooth SVG area sparkline inside the balance card.
 * Green when SOL is up, red when down.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg'

// ─── Types ───────────────────────────────────────────────────────────────────

type SparklineData = number[]   // array of USD prices, oldest first

// ─── CoinGecko helper ────────────────────────────────────────────────────────

const COINGECKO_CHART_URL =
  'https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7&interval=daily'

async function fetchSolSparkline(): Promise<SparklineData> {
  const res = await fetch(COINGECKO_CHART_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const json = await res.json()
  // json.prices → [[timestamp, price], ...]
  return (json.prices as [number, number][]).map(([, price]) => price)
}

// ─── SVG path builder ────────────────────────────────────────────────────────

/**
 * Builds a smooth cubic-bezier path string from an array of (x, y) points.
 * Uses the "catmull-rom to cubic bezier" conversion so the line curves
 * through every data point naturally.
 */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(i + 2, points.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/**
 * Builds a closed area path (line + vertical drops to bottom edge) for the gradient fill.
 */
function buildAreaPath(
  points: { x: number; y: number }[],
  height: number,
): string {
  const linePath = buildSmoothPath(points)
  if (!linePath) return ''
  const last = points[points.length - 1]
  const first = points[0]
  return `${linePath} L ${last.x} ${height} L ${first.x} ${height} Z`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Chart width in dp */
  width: number
  /** Chart height in dp */
  height?: number
  /** Whether SOL is currently positive (controls color) */
  isPositive: boolean
  /** Pre-seeded price array to show while fetching */
  seedPrices?: SparklineData
}

export function HaptixBalanceSparkline({
  width,
  height = 72,
  isPositive,
  seedPrices,
}: Props) {
  const [prices, setPrices] = useState<SparklineData>(seedPrices ?? [])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await fetchSolSparkline()
      if (data.length >= 2) setPrices(data)
    } catch {
      // keep seed / empty — fail silently
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ── Colours ──────────────────────────────────────────────────────────────
  const lineColor  = isPositive ? '#34D399' : '#F87171'   // emerald / rose
  const fillStart  = isPositive ? 'rgba(52,211,153,0.30)' : 'rgba(248,113,113,0.30)'
  const fillEnd    = 'rgba(0,0,0,0)'

  // ── Nothing to render yet ────────────────────────────────────────────────
  if (loading || prices.length < 2) {
    return <View style={{ width, height }} />
  }

  // ── Normalise data to SVG coordinate space ────────────────────────────────
  const pad = 2
  const W = width
  const H = height
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1

  const pts = prices.map((p, i) => ({
    x: pad + (i / (prices.length - 1)) * (W - pad * 2),
    // flip Y: high price → top of chart (small y)
    y: H - pad - ((p - min) / range) * (H - pad * 2),
  }))

  const linePath = buildSmoothPath(pts)
  const areaPath = buildAreaPath(pts, H)

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={W} height={H}>
        <Defs>
          <LinearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={fillStart} />
            <Stop offset="1" stopColor={fillEnd} />
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

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
})
