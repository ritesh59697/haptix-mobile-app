/**
 * Live market prices for the wallet UI.
 *
 * Primary source is the keyless CoinGecko public API. If that is unavailable
 * (no network, rate limited, device offline) we fall back to Jupiter's public
 * lite price API for SOL, and finally to the hardcoded reference table below so
 * the UI always renders a value instead of a blank.
 */

export type MarketToken = {
  symbol: string
  name: string
  price: string
  priceUsd: number
  change: string
  changePct: number
  isPositive: boolean
}

export type MarketSnapshot = {
  solPriceUsd: number
  tokens: MarketToken[]
  /** True when at least the SOL price came from a live API rather than the fallback table. */
  isLive: boolean
  /** Epoch ms of the fetch, or 0 when the snapshot is the static fallback. */
  fetchedAt: number
}

export const FALLBACK_SOL_PRICE_USD = 150.0

type TokenDescriptor = {
  symbol: string
  name: string
  /** CoinGecko coin id. */
  coingeckoId: string
  /** Reference values used when every API call fails. */
  fallbackPriceUsd: number
  fallbackChangePct: number
}

const TOKEN_DESCRIPTORS: TokenDescriptor[] = [
  { symbol: 'SOL', name: 'Solana', coingeckoId: 'solana', fallbackPriceUsd: 150, fallbackChangePct: 4.82 },
  { symbol: 'SKR', name: 'Seeker', coingeckoId: 'seeker', fallbackPriceUsd: 0.25, fallbackChangePct: 12.4 },
  { symbol: 'USDC', name: 'USD Coin', coingeckoId: 'usd-coin', fallbackPriceUsd: 1, fallbackChangePct: 0.01 },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    coingeckoId: 'jupiter-exchange-solana',
    fallbackPriceUsd: 0.84,
    fallbackChangePct: 7.15,
  },
  { symbol: 'RAY', name: 'Raydium', coingeckoId: 'raydium', fallbackPriceUsd: 1.92, fallbackChangePct: 3.4 },
  { symbol: 'BONK', name: 'Bonk', coingeckoId: 'bonk', fallbackPriceUsd: 0.000021, fallbackChangePct: -1.85 },
]

const COINGECKO_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price'
const JUPITER_SOL_ENDPOINT = 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112'
const FETCH_TIMEOUT_MS = 8000

export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(4)}`
  if (value >= 0.001) return `$${value.toFixed(6)}`
  return `$${value.toFixed(8)}`
}

function formatChange(pct: number): string {
  if (!Number.isFinite(pct)) return '0.00%'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function buildTokens(pricesUsd: Record<string, number>, changesPct: Record<string, number>): MarketToken[] {
  return TOKEN_DESCRIPTORS.map((descriptor) => {
    const priceUsd = pricesUsd[descriptor.symbol] ?? descriptor.fallbackPriceUsd
    const changePct = changesPct[descriptor.symbol] ?? descriptor.fallbackChangePct
    return {
      symbol: descriptor.symbol,
      name: descriptor.name,
      price: formatUsdPrice(priceUsd),
      priceUsd,
      change: formatChange(changePct),
      changePct,
      isPositive: changePct >= 0,
    }
  })
}

export function fallbackMarketSnapshot(): MarketSnapshot {
  const pricesUsd: Record<string, number> = {}
  const changesPct: Record<string, number> = {}
  for (const descriptor of TOKEN_DESCRIPTORS) {
    pricesUsd[descriptor.symbol] = descriptor.fallbackPriceUsd
    changesPct[descriptor.symbol] = descriptor.fallbackChangePct
  }
  return {
    solPriceUsd: FALLBACK_SOL_PRICE_USD,
    tokens: buildTokens(pricesUsd, changesPct),
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

type CoinGeckoQuote = { usd?: number; usd_24h_change?: number }

function readCoinGeckoPayload(payload: unknown): {
  pricesUsd: Record<string, number>
  changesPct: Record<string, number>
} {
  if (!payload || typeof payload !== 'object') throw new Error('Malformed CoinGecko response')
  const data = payload as Record<string, CoinGeckoQuote>
  const pricesUsd: Record<string, number> = {}
  const changesPct: Record<string, number> = {}
  for (const descriptor of TOKEN_DESCRIPTORS) {
    const quote = data[descriptor.coingeckoId]
    if (!quote || typeof quote.usd !== 'number' || !Number.isFinite(quote.usd) || quote.usd <= 0) continue
    pricesUsd[descriptor.symbol] = quote.usd
    if (typeof quote.usd_24h_change === 'number' && Number.isFinite(quote.usd_24h_change)) {
      changesPct[descriptor.symbol] = quote.usd_24h_change
    }
  }
  if (!Number.isFinite(pricesUsd.SOL)) throw new Error('CoinGecko response had no SOL price')
  return { pricesUsd, changesPct }
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
  const url = `${COINGECKO_ENDPOINT}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`

  try {
    const { pricesUsd, changesPct } = readCoinGeckoPayload(await fetchJson(url))
    return {
      solPriceUsd: pricesUsd.SOL,
      tokens: buildTokens(pricesUsd, changesPct),
      isLive: true,
      fetchedAt: Date.now(),
    }
  } catch {
    // Fall through to Jupiter for SOL only.
  }

  try {
    const { priceUsd, changePct } = readJupiterSolPayload(await fetchJson(JUPITER_SOL_ENDPOINT))
    const pricesUsd: Record<string, number> = { SOL: priceUsd }
    const changesPct: Record<string, number> = {}
    if (changePct !== null) changesPct.SOL = changePct
    return {
      solPriceUsd: priceUsd,
      tokens: buildTokens(pricesUsd, changesPct),
      isLive: true,
      fetchedAt: Date.now(),
    }
  } catch {
    return fallbackMarketSnapshot()
  }
}
