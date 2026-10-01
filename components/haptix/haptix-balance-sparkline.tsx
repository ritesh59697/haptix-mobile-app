/**
 * HaptixBalanceSparkline
 *
 * Professional financial sparkline chart matching OKX / Bitget style:
 *  - Organic, gentle bezier price curve (no jagged saw-tooth spikes)
 *  - Direction-aware trend (green upward for gain, rose downward for loss)
 *  - Ultra-subtle translucent gradient fill using stopOpacity for Android compatibility
 *  - Live price pulse dot at the right edge
 *  - Compact height that complements the balance without overwhelming the card
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg'

type SparklineData = number[]

// No hardcoded curves: only live market prices or neutral baseline


const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7'

// Downsample array to `target` points with basic stride
function downsample(data: number[], target = 28): number[] {
  if (data.length <= target) return data
  const step = (data.length - 1) / (target - 1)
  const result: number[] = []
  for (let i = 0; i < target; i++) {
    const idx = Math.min(Math.round(i * step), data.length - 1)
    result.push(data[idx])
  }
  return result
}

async function fetchHourlySolPrices(): Promise<SparklineData> {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const json = await res.json()
  const rawPrices = (json.prices as [number, number][]).map(([, p]) => p)
  if (rawPrices.length < 4) throw new Error('Insufficient data')
  return downsample(rawPrices, 28)
}

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
  if (!line || pts.length === 0) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `${line} L ${last.x.toFixed(1)} ${H} L ${first.x.toFixed(1)} ${H} Z`
}

function pricesToPoints(
  prices: SparklineData,
  W: number,
  H: number,
  padX = 4,
  padY = 12,
): { x: number; y: number }[] {
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  return prices.map((p, i) => ({
    x: padX + (i / (prices.length - 1)) * (W - padX * 2),
    y: padY + (1 - (p - min) / range) * (H - padY * 2),
  }))
}

interface Props {
  width: number
  height?: number
  isPositive: boolean
  isDark: boolean
}

export function HaptixBalanceSparkline({
  width,
  height = 64,
  isPositive,
  isDark,
}: Props) {
  const [prices, setPrices] = useState<SparklineData>([])

  const load = useCallback(async () => {
    try {
      const live = await fetchHourlySolPrices()
      setPrices(live)
    } catch {
      // Live feed unavailable; maintain clean flat baseline without invented movements
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Clean crypto colors: emerald for gains, modern rose for losses
  const lineColor = isPositive ? '#10B981' : '#F43F5E'
  const gradId = `balanceSparkGrad_${isPositive ? 'pos' : 'neg'}_${isDark ? 'dark' : 'light'}`

  const W = width
  const H = height
  const pts = useMemo(() => {
    if (prices.length < 2) {
      return [
        { x: 4, y: H / 2 },
        { x: W - 4, y: H / 2 },
      ]
    }
    return pricesToPoints(prices, W, H)
  }, [prices, W, H])
  const linePath = useMemo(() => buildSmoothPath(pts), [pts])
  const areaPath = useMemo(() => buildAreaPath(pts, H), [pts, H])
  const lastPt = pts.length > 0 ? pts[pts.length - 1] : null

  return (
    <View style={{ width: W, height: H, overflow: 'hidden' }}>
      <Svg width={W} height={H}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity={isDark ? 0.16 : 0.08} />
            <Stop offset="75%" stopColor={lineColor} stopOpacity={0.02} />
            <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* 1. Subtle translucent gradient fill */}
        <Path d={areaPath} fill={`url(#${gradId})`} />

        {/* 2. Razor-sharp clean 2px line */}
        <Path
          d={linePath}
          stroke={lineColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 3. Live current price pulse dot at end */}
        {lastPt && (
          <>
            <Circle
              cx={lastPt.x}
              cy={lastPt.y}
              r={5}
              fill={lineColor}
              fillOpacity={0.25}
            />
            <Circle
              cx={lastPt.x}
              cy={lastPt.y}
              r={2.5}
              fill={lineColor}
            />
          </>
        )}
      </Svg>
    </View>
  )
}
