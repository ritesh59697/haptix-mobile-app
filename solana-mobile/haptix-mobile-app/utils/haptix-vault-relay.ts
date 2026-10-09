import { NativeModules, Platform } from 'react-native'
import Constants from 'expo-constants'
import { AppConfig } from '@/constants/app-config'

export interface VaultSignaturePayload {
  signatureHex: string
  authenticatorDataHex: string
  clientDataJSONHex: string
}

let cachedRelayHost: string | null = null

/**
 * Normalizes any host or URL into a complete endpoint URL.
 * Handles HTTPS cloud URLs, http:// domains, or raw IPs on port 8082.
 */
export function buildRelayUrl(relayHostOrUrl: string, endpointPath: string): string {
  const cleanPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  const target = (relayHostOrUrl || '').trim()
  if (!target) {
    return `http://localhost:8082${cleanPath}`
  }
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return `${target.replace(/\/+$/, '')}${cleanPath}`
  }
  return `http://${target}:8082${cleanPath}`
}

/**
 * Robust fetch with timeout using standard AbortController (safe for React Native Hermes).
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 5000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    try {
      controller.abort()
    } catch {}
  }, timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns candidate local IPs/hostnames where a local Haptix Relay might be running during dev.
 */
export function getRelayCandidateHosts(): string[] {
  const candidates: string[] = []

  // 1. Expo config hostUri (standard Expo Go / dev client Metro host)
  const hostUri = Constants.expoConfig?.hostUri
  if (hostUri) {
    const ip = hostUri.split(':')[0]
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      candidates.push(ip)
    }
  }

  // 2. Expo Go debuggerHost
  const expoGoHost =
    (Constants as any)?.expoGoConfig?.debuggerHost ||
    (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost
  if (typeof expoGoHost === 'string') {
    const ip = expoGoHost.split(':')[0]
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      candidates.push(ip)
    }
  }

  // 3. React Native SourceCode scriptURL
  try {
    const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL
    if (typeof scriptURL === 'string') {
      const match = scriptURL.match(/^https?:\/\/([^/:]+)/)
      if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        candidates.push(match[1])
      }
    }
  } catch {}

  // Android emulator alias & loopback
  if (Platform.OS === 'android') {
    candidates.push('10.0.2.2')
  }
  candidates.push('127.0.0.1')
  candidates.push('localhost')

  // Deduplicate
  return Array.from(new Set(candidates.filter(Boolean)))
}

/**
 * Finds an active relay: first tests the production cloud relay, then falls back to local candidates.
 */
export async function findActiveRelayHost(): Promise<string> {
  // 1. Check cached active relay if already validated
  if (cachedRelayHost) {
    try {
      const checkUrl = buildRelayUrl(cachedRelayHost, '/status')
      const check = await fetchWithTimeout(checkUrl, {}, 1500)
      if (check.ok) return cachedRelayHost
    } catch {
      cachedRelayHost = null
    }
  }

  // 2. Check the production Hosted Cloud Relay from AppConfig first
  if (AppConfig.vaultRelayUrl) {
    try {
      const cloudStatusUrl = buildRelayUrl(AppConfig.vaultRelayUrl, '/status')
      const cloudRes = await fetchWithTimeout(cloudStatusUrl, {}, 2500)
      if (cloudRes.ok) {
        const data = await cloudRes.json().catch(() => ({}))
        if (data.ok) {
          cachedRelayHost = AppConfig.vaultRelayUrl
          return AppConfig.vaultRelayUrl
        }
      }
    } catch {}
  }

  // 3. Fallback: check local network candidates (for local development)
  const candidates = getRelayCandidateHosts()
  for (const host of candidates) {
    try {
      const localUrl = buildRelayUrl(host, '/status')
      const res = await fetchWithTimeout(localUrl, {}, 1200)
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.ok) {
          cachedRelayHost = host
          return host
        }
      }
    } catch {}
  }

  // 4. If Cloud relay is defined, return it as default target even if cold/starting
  if (AppConfig.vaultRelayUrl) {
    return AppConfig.vaultRelayUrl
  }

  throw new Error(
    'Haptix Vault Relay is offline or unreachable. Please check your internet connection or use manual signature approval.',
  )
}

/**
 * Submits a high-value transfer to the Relay for 2-of-2 biometric authorization on the second device.
 */
export async function queueVaultTransfer(params: {
  relayHost: string
  messageHex: string
  amountSol: number
  amountUsd?: string
  feeSol?: string
  recipient: string
  walletPda: string
  walletName?: string
  spendThresholdSol?: number
}): Promise<string> {
  const { relayHost, messageHex, amountSol, amountUsd, feeSol, recipient, walletPda, walletName, spendThresholdSol } = params
  const targetUrl = buildRelayUrl(relayHost, '/pending-tx')
  const res = await fetchWithTimeout(
    targetUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageHex,
        amountSol,
        amountUsd,
        feeSol,
        recipient,
        walletPda,
        walletName,
        spendThresholdSol,
      }),
    },
    8000,
  )

  if (!res.ok) {
    throw new Error(`Vault relay rejected transfer request (${res.status})`)
  }

  const data = await res.json()
  return data?.txId || ''
}

/**
 * Polls the Relay until the user approves on the second device or timeout expires.
 */
export async function pollVaultSignature(
  relayHost: string,
  txId: string,
  options?: {
    walletPda?: string
    timeoutMs?: number
    pollIntervalMs?: number
    onTick?: (secondsRemaining: number) => void
    isAborted?: () => boolean
  },
): Promise<VaultSignaturePayload | null> {
  const timeoutMs = options?.timeoutMs ?? 75000
  const pollIntervalMs = options?.pollIntervalMs ?? 900
  const startTime = Date.now()
  const walletParam = options?.walletPda ? `&wallet=${encodeURIComponent(options.walletPda)}` : ''

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Date.now() - startTime
    const secondsRemaining = Math.max(0, Math.round((timeoutMs - elapsed) / 1000))
    options?.onTick?.(secondsRemaining)
    if (options?.isAborted?.()) {
      throw new Error('Transfer cancelled.')
    }

    try {
      const pollUrl = buildRelayUrl(relayHost, `/tx-signature?id=${txId || ''}${walletParam}`)
      const res = await fetchWithTimeout(pollUrl, {}, 2500)
      if (res.ok) {
        const data = await res.json()
        if (data.ok && data.signature) {
          return data.signature as VaultSignaturePayload
        }
        if (data.declined) {
          throw new Error('Transfer was declined on second device.')
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('declined')) {
        throw err
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  return null
}

/**
 * Parses a manual signature payload (JSON or base64) if the user pastes it directly.
 */
export function parseManualSignaturePayload(input: string): VaultSignaturePayload | null {
  try {
    const trimmed = input.trim()
    let jsonStr = trimmed
    if (trimmed.startsWith('ey') || !trimmed.startsWith('{')) {
      // Base64 decoded
      try {
        jsonStr = atob(trimmed)
      } catch {}
    }
    const parsed = JSON.parse(jsonStr)
    if (parsed.signatureHex && parsed.authenticatorDataHex && parsed.clientDataJSONHex) {
      return {
        signatureHex: parsed.signatureHex,
        authenticatorDataHex: parsed.authenticatorDataHex,
        clientDataJSONHex: parsed.clientDataJSONHex,
      }
    }
  } catch {}
  return null
}

/**
 * Cancels a pending transfer on the Relay.
 */
export async function cancelVaultTransfer(
  relayHost: string,
  txId?: string,
  walletPda?: string,
): Promise<boolean> {
  try {
    const cancelUrl = buildRelayUrl(relayHost, '/cancel')
    const res = await fetchWithTimeout(
      cancelUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: txId || '', walletPda: walletPda || '' }),
      },
      3000,
    )
    return res.ok
  } catch {
    return false
  }
}
