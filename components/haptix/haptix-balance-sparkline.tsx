/**
 * HaptixBalanceSparkline
 *
 * Clean line-only sparkline — no fill, no gradient area.
 * Matches OKX / Bitget style: just a smooth colored line.
 * Green when positive, red when negative.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

type SparklineData = number[]

// Realistic 7-day SOL shape used while live data loads
const FALLBACK_SOL_PRICES: SparklineData = [148, 152, 145, 158, 162, 155, 160]

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
  if (prices.length < 2) throw new Error('Too few points')
  return prices
}

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

function pricesToPoints(
  prices: SparklineData,
  W: number,
  H: number,
): { x: number; y: number }[] {
  const pad = 4
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  return prices.map((p, i) => ({
    x: pad + (i / (prices.length - 1)) * (W - pad * 2),
    y: pad + (1 - (p - min) / range) * (H - pad * 2),
  }))
}

interface Props {
  width: number
  height?: number
  isPositive: boolean
}

export function HaptixBalanceSparkline({ width, height = 56, isPositive }: Props) {
  const [prices, setPrices] = useState<SparklineData>(FALLBACK_SOL_PRICES)

  const load = useCallback(async () => {
    try {
      const live = await fetchSolSparkline()
      setPrices(live)
    } catch {
      // keep fallback
    }
  }, [])

  useEffect(() => { load() }, [load])

  const lineColor = isPositive ? '#22C55E' : '#EF4444'
  const pts = pricesToPoints(prices, width, height)
  const linePath = buildSmoothPath(pts)

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <Svg width={width} height={height}>
        <Path
          d={linePath}
          stroke={lineColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}
