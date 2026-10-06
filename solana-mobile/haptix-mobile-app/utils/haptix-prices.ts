/**
 * Live market prices and stats for the wallet UI.
 *
 * Primary source is the keyless CoinGecko public API (`/coins/markets`).
 * If that is unavailable (rate limited or offline) we fall back to CoinGecko
 * simple price, then Jupiter's public lite price API for SOL, and finally to
 * realistic reference values so the UI always renders without blank states.
 */

export type MarketToken = {
  symbol: string
  name: string
  price: string
  priceUsd: number
  change: string
  changePct: number
  isPositive: boolean
  marketCap?: string
  marketCapUsd?: number
  volume24h?: string
  volume24hUsd?: number
  circulatingSupply?: string
  circulatingSupplyRaw?: number
  allTimeHigh?: string
  athUsd?: number
}

export type MarketSnapshot = {
  solPriceUsd: number
  tokens: MarketToken[]
  /** True when at least the SOL price came from a live API rather than the fallback table. */
  isLive: boolean
  /** Epoch ms of the fetch, or 0 when the snapshot is the static fallback. */
  fetchedAt: number
}

export const FALLBACK_SOL_PRICE_USD = 120.70

export type TokenDescriptor = {
  symbol: string
  name: string
  /** CoinGecko coin id. */
  coingeckoId: string
  /** Reference values used when API calls fail. */
  fallbackPriceUsd: number
  fallbackChangePct: number
  fallbackMarketCapUsd: number
  fallbackVolume24hUsd: number
  fallbackCirculatingSupply: number
  fallbackAthUsd: number
}

export const TOKEN_DESCRIPTORS: TokenDescriptor[] = [
  {
    symbol: 'SOL',
    name: 'Solana',
    coingeckoId: 'solana',
    fallbackPriceUsd: 120.70,
    fallbackChangePct: 1.44,
    fallbackMarketCapUsd: 70_900_000_000,
    fallbackVolume24hUsd: 1_650_000_000,
    fallbackCirculatingSupply: 588_100_000,
    fallbackAthUsd: 293.31,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    coingeckoId: 'usd-coin',
    fallbackPriceUsd: 1.0,
    fallbackChangePct: 0.01,
    fallbackMarketCapUsd: 74_100_000_000,
    fallbackVolume24hUsd: 6_300_000_000,
    fallbackCirculatingSupply: 74_100_000_000,
    fallbackAthUsd: 1.04,
  },
  {
    symbol: 'SKR',
    name: 'Seeker',
    coingeckoId: 'seeker',
    fallbackPriceUsd: 0.018,
    fallbackChangePct: 2.1,
    fallbackMarketCapUsd: 125_000_000,
    fallbackVolume24hUsd: 1_700_000,
    fallbackCirculatingSupply: 7_100_000_000,
    fallbackAthUsd: 0.05,
  },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    coingeckoId: 'jupiter-exchange-solana',
    fallbackPriceUsd: 0.33,
    fallbackChangePct: 4.97,
    fallbackMarketCapUsd: 1_100_000_000,
    fallbackVolume24hUsd: 62_000_000,
    fallbackCirculatingSupply: 3_320_000_000,
    fallbackAthUsd: 2.04,
  },
  {
    symbol: 'RAY',
    name: 'Raydium',
    coingeckoId: 'raydium',
    fallbackPriceUsd: 2.06,
    fallbackChangePct: 4.94,
    fallbackMarketCapUsd: 556_000_000,
    fallbackVolume24hUsd: 59_000_000,
    fallbackCirculatingSupply: 270_000_000,
    fallbackAthUsd: 16.93,
  },
  {
    symbol: 'BONK',
    name: 'Bonk',
    coingeckoId: 'bonk',
    fallbackPriceUsd: 0.0000038,
    fallbackChangePct: 5.2,
    fallbackMarketCapUsd: 336_000_000,
    fallbackVolume24hUsd: 35_600_000,
    fallbackCirculatingSupply: 88_000_000_000_000,
    fallbackAthUsd: 0.000058,
  },
]

const COINGECKO_MARKETS_ENDPOINT = 'https://api.coingecko.com/api/v3/coins/markets'
const COINGECKO_SIMPLE_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price'
const JUPITER_SOL_ENDPOINT = 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112'
const FETCH_TIMEOUT_MS = 8000

export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(4)}`
  if (value >= 0.001) return `$${value.toFixed(6)}`
  return `$${value.toFixed(8)}`
}

export function formatLargeNumberUsd(value?: number): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)} T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)} B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)} M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)} K`
  return `$${value.toFixed(2)}`
}

export function formatSupply(supply?: number, symbol: string = ''): string {
  if (!supply || !Number.isFinite(supply) || supply <= 0) return '—'
  const suffix = symbol ? ` ${symbol}` : ''
  if (supply >= 1e12) return `${(supply / 1e12).toFixed(1)}T${suffix}`
  if (supply >= 1e9) return `${(supply / 1e9).toFixed(1)}B${suffix}`
  if (supply >= 1e6) return `${(supply / 1e6).toFixed(1)}M${suffix}`
  if (supply >= 1e3) return `${(supply / 1e3).toFixed(1)}K${suffix}`
  return `${supply.toFixed(0)}${suffix}`
}

export function formatAth(ath?: number): string {
  if (!ath || !Number.isFinite(ath) || ath <= 0) return '—'
  if (ath >= 1) return `$${ath.toFixed(2)}`
  if (ath >= 0.01) return `$${ath.toFixed(4)}`
  return `$${ath.toFixed(6)}`
}

function formatChange(pct: number): string {
  if (!Number.isFinite(pct)) return '0.00%'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

export interface ParsedTokenMarketData {
  priceUsd: number
  changePct: number
  marketCapUsd?: number
  volume24hUsd?: number
  circulatingSupplyRaw?: number
  athUsd?: number
}

function buildTokens(dataMap: Record<string, ParsedTokenMarketData>): MarketToken[] {
  return TOKEN_DESCRIPTORS.map((descriptor) => {
    const data = dataMap[descriptor.symbol]
    const priceUsd = data?.priceUsd ?? descriptor.fallbackPriceUsd
    const changePct = data?.changePct ?? descriptor.fallbackChangePct
    const marketCapUsd = data?.marketCapUsd ?? descriptor.fallbackMarketCapUsd
    const volume24hUsd = data?.volume24hUsd ?? descriptor.fallbackVolume24hUsd
    const circulatingSupplyRaw = data?.circulatingSupplyRaw ?? descriptor.fallbackCirculatingSupply
    const athUsd = data?.athUsd ?? descriptor.fallbackAthUsd

    return {
      symbol: descriptor.symbol,
      name: descriptor.name,
      price: formatUsdPrice(priceUsd),
      priceUsd,
      change: formatChange(changePct),
      changePct,
      isPositive: changePct >= 0,
      marketCapUsd,
      marketCap: formatLargeNumberUsd(marketCapUsd),
      volume24hUsd,
      volume24h: formatLargeNumberUsd(volume24hUsd),
      circulatingSupplyRaw,
      circulatingSupply: formatSupply(circulatingSupplyRaw, descriptor.symbol),
      athUsd,
      allTimeHigh: formatAth(athUsd),
    }
  })
}

export function fallbackMarketSnapshot(): MarketSnapshot {
  const dataMap: Record<string, ParsedTokenMarketData> = {}
  for (const d of TOKEN_DESCRIPTORS) {
    dataMap[d.symbol] = {
      priceUsd: d.fallbackPriceUsd,
      changePct: d.fallbackChangePct,
      marketCapUsd: d.fallbackMarketCapUsd,
      volume24hUsd: d.fallbackVolume24hUsd,
      circulatingSupplyRaw: d.fallbackCirculatingSupply,
      athUsd: d.fallbackAthUsd,
    }
  }
  return {
    solPriceUsd: FALLBACK_SOL_PRICE_USD,
    tokens: buildTokens(dataMap),
    isLive: false,
    fetchedAt: 0,
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

type CoinGeckoMarketItem = {
  id?: string
  symbol?: string
  current_price?: number
  price_change_percentage_24h?: number
  market_cap?: number
  total_volume?: number
  circulating_supply?: number
  ath?: number
}

function readCoinGeckoMarketsPayload(payload: unknown): Record<string, ParsedTokenMarketData> {
  if (!Array.isArray(payload)) throw new Error('Malformed CoinGecko markets response')
  const dataMap: Record<string, ParsedTokenMarketData> = {}

  for (const item of payload as CoinGeckoMarketItem[]) {
    if (!item || typeof item !== 'object') continue
    const matched = TOKEN_DESCRIPTORS.find(
      (d) =>
        d.coingeckoId.toLowerCase() === (item.id || '').toLowerCase() ||
        d.symbol.toLowerCase() === (item.symbol || '').toLowerCase(),
    )
    if (!matched) continue

    const priceUsd = typeof item.current_price === 'number' && Number.isFinite(item.current_price) && item.current_price > 0
      ? item.current_price
      : matched.fallbackPriceUsd

    const changePct = typeof item.price_change_percentage_24h === 'number' && Number.isFinite(item.price_change_percentage_24h)
      ? item.price_change_percentage_24h
      : matched.fallbackChangePct

    const marketCapUsd = typeof item.market_cap === 'number' && Number.isFinite(item.market_cap) && item.market_cap > 0
      ? item.market_cap
      : matched.fallbackMarketCapUsd

    const volume24hUsd = typeof item.total_volume === 'number' && Number.isFinite(item.total_volume) && item.total_volume > 0
      ? item.total_volume
      : matched.fallbackVolume24hUsd

    const circulatingSupplyRaw = typeof item.circulating_supply === 'number' && Number.isFinite(item.circulating_supply) && item.circulating_supply > 0
      ? item.circulating_supply
      : matched.fallbackCirculatingSupply

    const athUsd = typeof item.ath === 'number' && Number.isFinite(item.ath) && item.ath > 0
      ? item.ath
      : matched.fallbackAthUsd

    dataMap[matched.symbol] = {
      priceUsd,
      changePct,
      marketCapUsd,
      volume24hUsd,
      circulatingSupplyRaw,
      athUsd,
    }
  }

  if (!dataMap.SOL || !Number.isFinite(dataMap.SOL.priceUsd)) {
    throw new Error('CoinGecko markets response had no valid SOL price')
  }

  return dataMap
}

type CoinGeckoSimpleQuote = {
  usd?: number
  usd_24h_change?: number
  usd_market_cap?: number
  usd_24h_vol?: number
}

function readCoinGeckoSimplePayload(payload: unknown): Record<string, ParsedTokenMarketData> {
  if (!payload || typeof payload !== 'object') throw new Error('Malformed CoinGecko simple response')
  const data = payload as Record<string, CoinGeckoSimpleQuote>
  const dataMap: Record<string, ParsedTokenMarketData> = {}

  for (const descriptor of TOKEN_DESCRIPTORS) {
    const quote = data[descriptor.coingeckoId]
    if (!quote || typeof quote.usd !== 'number' || !Number.isFinite(quote.usd) || quote.usd <= 0) continue

    const priceUsd = quote.usd
    const changePct = typeof quote.usd_24h_change === 'number' && Number.isFinite(quote.usd_24h_change)
      ? quote.usd_24h_change
      : descriptor.fallbackChangePct
    const marketCapUsd = typeof quote.usd_market_cap === 'number' && Number.isFinite(quote.usd_market_cap) && quote.usd_market_cap > 0
      ? quote.usd_market_cap
      : descriptor.fallbackMarketCapUsd
    const volume24hUsd = typeof quote.usd_24h_vol === 'number' && Number.isFinite(quote.usd_24h_vol) && quote.usd_24h_vol > 0
      ? quote.usd_24h_vol
      : descriptor.fallbackVolume24hUsd
    const circulatingSupplyRaw = quote.usd_market_cap && quote.usd
      ? quote.usd_market_cap / quote.usd
      : descriptor.fallbackCirculatingSupply

    dataMap[descriptor.symbol] = {
      priceUsd,
      changePct,
      marketCapUsd,
      volume24hUsd,
      circulatingSupplyRaw,
      athUsd: descriptor.fallbackAthUsd,
    }
  }

  if (!dataMap.SOL || !Number.isFinite(dataMap.SOL.priceUsd)) {
    throw new Error('CoinGecko simple response had no SOL price')
  }

  return dataMap
}

/** Jupiter v3 lite returns `{ "<mint>": { usdPrice, priceChange24h } }`. */
function readJupiterSolPayload(payload: unknown): { priceUsd: number; changePct: number | null } {
  if (!payload || typeof payload !== 'object') throw new Error('Malformed Jupiter response')
  const entry = Object.values(payload as Record<string, unknown>)[0]
  if (!entry || typeof entry !== 'object') throw new Error('Malformed Jupiter response')
  const quote = entry as { usdPrice?: number; priceChange24h?: number }
  if (typeof quote.usdPrice !== 'number' || !Number.isFinite(quote.usdPrice) || quote.usdPrice <= 0) {
    throw new Error('Jupiter response had no SOL price')
  }
  const changePct =
    typeof quote.priceChange24h === 'number' && Number.isFinite(quote.priceChange24h) ? quote.priceChange24h : null
  return { priceUsd: quote.usdPrice, changePct }
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const ids = TOKEN_DESCRIPTORS.map((descriptor) => descriptor.coingeckoId).join(',')

  // Method 1: CoinGecko /coins/markets (Full stats: price, change, market cap, volume, supply, ATH)
  try {
    const marketsUrl = `${COINGECKO_MARKETS_ENDPOINT}?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false`
    const dataMap = readCoinGeckoMarketsPayload(await fetchJson(marketsUrl))
    return {
      solPriceUsd: dataMap.SOL.priceUsd,
      tokens: buildTokens(dataMap),
      isLive: true,
      fetchedAt: Date.now(),
    }
  } catch (e) {
    // Fall through to simple price
  }

  // Method 2: CoinGecko /simple/price with market cap and volume
  try {
    const simpleUrl = `${COINGECKO_SIMPLE_ENDPOINT}?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`
    const dataMap = readCoinGeckoSimplePayload(await fetchJson(simpleUrl))
    return {
      solPriceUsd: dataMap.SOL.priceUsd,
      tokens: buildTokens(dataMap),
      isLive: true,
      fetchedAt: Date.now(),
    }
  } catch {
    // Fall through to Jupiter for SOL
  }

  // Method 3: Jupiter Lite price for SOL only
  try {
    const { priceUsd, changePct } = readJupiterSolPayload(await fetchJson(JUPITER_SOL_ENDPOINT))
    const fallbackMap: Record<string, ParsedTokenMarketData> = {}
    for (const d of TOKEN_DESCRIPTORS) {
      fallbackMap[d.symbol] = {
        priceUsd: d.symbol === 'SOL' ? priceUsd : d.fallbackPriceUsd,
        changePct: d.symbol === 'SOL' && changePct !== null ? changePct : d.fallbackChangePct,
        marketCapUsd: d.symbol === 'SOL' ? priceUsd * 588_100_000 : d.fallbackMarketCapUsd,
        volume24hUsd: d.fallbackVolume24hUsd,
        circulatingSupplyRaw: d.fallbackCirculatingSupply,
        athUsd: d.fallbackAthUsd,
      }
    }
    return {
      solPriceUsd: priceUsd,
      tokens: buildTokens(fallbackMap),
      isLive: true,
      fetchedAt: Date.now(),
    }
  } catch {
    return fallbackMarketSnapshot()
  }
}
