import { NativeModules, Platform } from 'react-native'
import Constants from 'expo-constants'

export interface VaultSignaturePayload {
  signatureHex: string
  authenticatorDataHex: string
  clientDataJSONHex: string
}

let cachedRelayHost: string | null = null

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
 * Returns candidate IPs/hostnames where the Haptix Relay and vault.html might be running.
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

  // Android emulator alias & loopback. A guessed LAN address is not a relay.
  if (Platform.OS === 'android') {
    candidates.push('10.0.2.2')
  }
  candidates.push('127.0.0.1')
  candidates.push('localhost')

  // Deduplicate
  return Array.from(new Set(candidates.filter(Boolean)))
}

/**
 * Quickly tests candidate hosts to find which one is actively responding on port 8082.
 */
export async function findActiveRelayHost(): Promise<string> {
  if (cachedRelayHost) {
    try {
      const check = await fetchWithTimeout(`http://${cachedRelayHost}:8082/status`, {}, 1500)
      if (check.ok) return cachedRelayHost
    } catch {
      cachedRelayHost = null
    }
  }

  const candidates = getRelayCandidateHosts()
  for (const host of candidates) {
    try {
      const res = await fetchWithTimeout(`http://${host}:8082/status`, {}, 1500)
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          cachedRelayHost = host
          return host
        }
      }
    } catch {}
  }

  throw new Error(
    'No Haptix vault relay is running on this network. On your second device, run `npm run relay` and open vault.html before approving a send over the limit.',
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
  const res = await fetchWithTimeout(
    `http://${relayHost}:8082/pending-tx`,
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
    timeoutMs?: number
    pollIntervalMs?: number
    onTick?: (secondsRemaining: number) => void
    isAborted?: () => boolean
  },
): Promise<VaultSignaturePayload | null> {
  const timeoutMs = options?.timeoutMs ?? 75000
  const pollIntervalMs = options?.pollIntervalMs ?? 900
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Date.now() - startTime
    const secondsRemaining = Math.max(0, Math.round((timeoutMs - elapsed) / 1000))
    options?.onTick?.(secondsRemaining)
    if (options?.isAborted?.()) {
      throw new Error('Transfer cancelled.')
    }

    try {
      const res = await fetchWithTimeout(
        `http://${relayHost}:8082/tx-signature?id=${txId || ''}`,
        {},
        2500,
      )
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
export async function cancelVaultTransfer(relayHost: string, txId?: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `http://${relayHost}:8082/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: txId || '' }),
      },
      3000,
    )
    return res.ok
  } catch {
    return false
  }
}
