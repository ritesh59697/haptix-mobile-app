/**
 * Wallet-side Mobile Wallet Adapter (MWA) session.
 *
 * Lets third-party Solana dApps on the device ask Haptix to authorize them and
 * to sign messages, with the user approving through the same hardware passkeys
 * the rest of the app uses.
 *
 * Android only, and only in a native build: the session is hosted by a Kotlin
 * module, so it is absent in Expo Go and on web. Check `isMwaSupported()` before
 * wiring any UI to it.
 */
import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

/** A dApp is asking to connect. Approving returns an account it may address. */
export interface MwaAuthorizeRequest {
  type: 'authorize'
  requestId: string
  /** Self-reported dApp name. Not verified, so never present it as identity. */
  identityName: string | null
  identityUri: string | null
  iconRelativeUri: string | null
  /** Always a `solana:*` chain id; Haptix authorizes devnet only. */
  chain: string | null
}

/** A dApp is asking for message signatures. Payloads are base64. */
export interface MwaSignMessagesRequest {
  type: 'signMessages'
  requestId: string
  identityName: string | null
  identityUri: string | null
  payloads: string[]
}

export type MwaRequest = MwaAuthorizeRequest | MwaSignMessagesRequest

export type MwaSessionState = 'serving' | 'servingComplete' | 'teardownComplete' | 'error' | 'lowPowerNoConnection'

export interface MwaStateChange {
  state: MwaSessionState
}

export interface MwaDeauthorized {
  identityName: string | null
}

type Subscription = { remove: () => void }

interface HaptixMwaNativeModule {
  startSession(uri: string): Promise<boolean>
  endSession(): Promise<void>
  isSessionActive(): boolean
  approveAuthorize(
    requestId: string,
    publicKeyBase64: string,
    accountLabel: string | null,
    walletUriBase: string | null,
  ): Promise<void>
  approveSignMessages(requestId: string, signaturesBase64: string[]): Promise<void>
  declineRequest(requestId: string): Promise<void>
  addListener(event: 'onMwaRequest', listener: (payload: MwaRequest) => void): Subscription
  addListener(event: 'onMwaStateChange', listener: (payload: MwaStateChange) => void): Subscription
  addListener(event: 'onMwaDeauthorized', listener: (payload: MwaDeauthorized) => void): Subscription
}

// Optional: absent in Expo Go, on web, and in any build without the native
// module. Every export below degrades instead of throwing when it is missing.
const native = requireOptionalNativeModule<HaptixMwaNativeModule>('HaptixMwa')

/** Whether this build can host an MWA session at all. */
export function isMwaSupported(): boolean {
  return Platform.OS === 'android' && native != null
}

function requireNative(): HaptixMwaNativeModule {
  if (!native) {
    throw new Error(
      'Mobile Wallet Adapter is unavailable in this build. It needs the native Android module, so it does not run in Expo Go or on web.',
    )
  }
  return native
}

/**
 * Starts serving the dApp that opened `uri`.
 *
 * Resolves false when `uri` is not an MWA association URI, so an app-wide deep
 * link handler can pass everything here and act only on true.
 */
export async function startMwaSession(uri: string): Promise<boolean> {
  if (!isMwaSupported()) return false
  return requireNative().startSession(uri)
}

/** Ends the session, declining anything the user never answered. */
export async function endMwaSession(): Promise<void> {
  if (!isMwaSupported()) return
  await requireNative().endSession()
}

export function isMwaSessionActive(): boolean {
  if (!isMwaSupported()) return false
  return requireNative().isSessionActive()
}

/**
 * Approves a connection, scoping it to one account.
 *
 * `publicKeyBase64` must be the Haptix smart wallet PDA — the account that
 * holds funds on chain — not the passkey public key.
 */
export async function approveMwaAuthorize(options: {
  requestId: string
  publicKeyBase64: string
  accountLabel?: string | null
  walletUriBase?: string | null
}): Promise<void> {
  await requireNative().approveAuthorize(
    options.requestId,
    options.publicKeyBase64,
    options.accountLabel ?? null,
    options.walletUriBase ?? null,
  )
}

/**
 * Completes a signMessages request.
 *
 * One base64 signature per requested payload, in the order received; the dApp
 * matches them positionally.
 */
export async function approveMwaSignMessages(requestId: string, signaturesBase64: string[]): Promise<void> {
  await requireNative().approveSignMessages(requestId, signaturesBase64)
}

/** Declines a request. The dApp sees a user-rejected error. */
export async function declineMwaRequest(requestId: string): Promise<void> {
  await requireNative().declineRequest(requestId)
}

/** Subscribes to dApp requests. Returns a no-op remover where MWA is unsupported. */
export function addMwaRequestListener(listener: (request: MwaRequest) => void): Subscription {
  if (!isMwaSupported()) return { remove: () => {} }
  return requireNative().addListener('onMwaRequest', listener)
}

export function addMwaStateListener(listener: (change: MwaStateChange) => void): Subscription {
  if (!isMwaSupported()) return { remove: () => {} }
  return requireNative().addListener('onMwaStateChange', listener)
}

export function addMwaDeauthorizedListener(listener: (event: MwaDeauthorized) => void): Subscription {
  if (!isMwaSupported()) return { remove: () => {} }
  return requireNative().addListener('onMwaDeauthorized', listener)
}

/**
 * Features Haptix advertises to dApps.
 *
 * `solana:signAndSendTransaction` is absent on purpose. The on-chain program
 * verifies a passkey signature over a message that names one recipient and
 * amount, which is what stops a relay diverting funds — and also what prevents
 * signing an arbitrary dApp transaction. Supporting it needs a new program
 * instruction, so advertising it now would fail every request after the user
 * had already approved with biometrics. MWA 2.0 lists the feature as mandatory,
 * so Haptix is a partial provider until that lands.
 */
export const MWA_SUPPORTED_FEATURES = ['solana:signMessages'] as const
