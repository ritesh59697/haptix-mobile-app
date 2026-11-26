/**
 * Storage for the guardian key Haptix generates when a wallet is created without one.
 *
 * That key can freeze the wallet and start a recovery, so it is private key material
 * and belongs in OS secure storage, the same as the passkey scalars in
 * `haptix-passkey.ts`. Builds before this module kept it as plaintext hex in
 * AsyncStorage, readable by anything that can read app storage or its backups. Reads
 * here move such an entry into SecureStore and delete the plaintext copy, so existing
 * wallets migrate the first time the recovery screen looks for their key.
 *
 * The logic takes its stores as arguments so it can be tested in Node. The exported
 * functions at the bottom bind it to `expo-secure-store` and AsyncStorage, loaded
 * lazily so importing this file never pulls in a native module.
 */
import { Keypair } from '@solana/web3.js'
import { Buffer } from 'buffer'

/** SecureStore key prefix. SecureStore only accepts alphanumerics, `.`, `-` and `_`. */
export const AUTO_GUARDIAN_SECURE_KEY_PREFIX = 'haptix_auto_guardian_'

/** The AsyncStorage key older builds wrote the plaintext secret to. Read only to migrate. */
export const AUTO_GUARDIAN_LEGACY_KEY_PREFIX = `@${AUTO_GUARDIAN_SECURE_KEY_PREFIX}`

/** Same rule `expo-secure-store` enforces; see `SECURE_STORE_KEY_PATTERN` in `haptix-passkey.ts`. */
export const SECURE_STORE_KEY_PATTERN = /^[\w.-]+$/

export interface SecureStoreLike {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface LegacyStoreLike {
  getItem(key: string): Promise<string | null>
  removeItem(key: string): Promise<void>
}

export interface AutoGuardianBackends {
  /** Null where OS secure storage is unavailable (web, or a build without the module). */
  secure: SecureStoreLike | null
  legacy: LegacyStoreLike
}

export interface AuthResult {
  success: boolean
  error?: string
}

export type RevealResult = { ok: true; secretKey: Uint8Array } | { ok: false; error: string }

export const SECURE_STORE_UNAVAILABLE_MESSAGE =
  'This build cannot store an auto-generated recovery key in secure device storage. ' +
  'Enter an independent guardian address (e.g. Phantom, Solflare) under advanced options instead.'

export function secureKeyFor(guardian: string): string {
  const key = `${AUTO_GUARDIAN_SECURE_KEY_PREFIX}${guardian}`
  if (!SECURE_STORE_KEY_PATTERN.test(key)) {
    throw new Error(`[Haptix Guardian] ${JSON.stringify(guardian)} does not form a valid SecureStore key.`)
  }
  return key
}

export function legacyKeyFor(guardian: string): string {
  return `${AUTO_GUARDIAN_LEGACY_KEY_PREFIX}${guardian}`
}

/** Decodes a stored hex secret, returning it only if it is the secret key of `guardian`. */
function decodeSecret(hex: string | null, guardian: string): Uint8Array | null {
  if (!hex) return null
  try {
    const keypair = Keypair.fromSecretKey(Uint8Array.from(Buffer.from(hex, 'hex')))
    return keypair.publicKey.toBase58() === guardian ? keypair.secretKey : null
  } catch {
    return null
  }
}

export function createAutoGuardianStore(resolveBackends: () => AutoGuardianBackends) {
  /**
   * Returns the guardian's secret key, migrating a plaintext AsyncStorage copy into
   * SecureStore on the way. The legacy entry is removed only after the secure copy
   * reads back identical; if anything fails it stays put, so the key is never lost.
   */
  async function load(guardian: string): Promise<Uint8Array | null> {
    const { secure, legacy } = resolveBackends()
    const secureKey = secureKeyFor(guardian)
    const legacyKey = legacyKeyFor(guardian)

    if (secure) {
      const stored = decodeSecret(await secure.getItem(secureKey).catch(() => null), guardian)
      if (stored) {
        // A plaintext copy can linger if an earlier migration was interrupted mid-way.
        await legacy.removeItem(legacyKey).catch(() => {})
        return stored
      }
    }

    const legacyHex = await legacy.getItem(legacyKey).catch(() => null)
    const legacySecret = decodeSecret(legacyHex, guardian)
    if (!legacyHex || !legacySecret) return null

    if (secure) {
      try {
        await secure.setItem(secureKey, legacyHex)
        if ((await secure.getItem(secureKey)) === legacyHex) {
          await legacy.removeItem(legacyKey)
        }
      } catch (e) {
        console.warn('[Haptix Guardian] Could not migrate the recovery key to secure storage:', e)
      }
    }
    return legacySecret
  }

  return {
    /** Stores a freshly generated guardian. Throws rather than fall back to AsyncStorage. */
    async save(keypair: Keypair): Promise<void> {
      const { secure } = resolveBackends()
      if (!secure) throw new Error(SECURE_STORE_UNAVAILABLE_MESSAGE)
      const guardian = keypair.publicKey.toBase58()
      const hex = Buffer.from(keypair.secretKey).toString('hex')
      await secure.setItem(secureKeyFor(guardian), hex)
      if ((await secure.getItem(secureKeyFor(guardian))) !== hex) {
        throw new Error('The recovery key did not read back from secure storage. Please try again.')
      }
    },

    /** Whether this device holds the guardian's secret. Never exposes it. */
    async has(guardian: string): Promise<boolean> {
      return (await load(guardian)) !== null
    },

    /** Returns the secret only after `authenticate` succeeds. */
    async reveal(guardian: string, authenticate: () => Promise<AuthResult>): Promise<RevealResult> {
      const auth = await authenticate()
      if (!auth.success) return { ok: false, error: auth.error || 'Biometric verification was not completed.' }
      const secretKey = await load(guardian)
      if (!secretKey) return { ok: false, error: 'This device does not hold the recovery key for this wallet.' }
      return { ok: true, secretKey }
    },
  }
}

// ---------------------------------------------------------------------------
// App bindings
// ---------------------------------------------------------------------------

function resolveAppBackends(): AutoGuardianBackends {
  const { Platform } = require('react-native') as typeof import('react-native')
  const AsyncStorage = require('@react-native-async-storage/async-storage')
    .default as typeof import('@react-native-async-storage/async-storage').default
  return {
    secure: Platform.OS === 'web' ? null : appSecureStore(Platform.OS),
    legacy: {
      getItem: (key) => AsyncStorage.getItem(key),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
  }
}

/** `expo-secure-store` with the keychain options `haptix-passkey.ts` uses for its scalars. */
function appSecureStore(os: string): SecureStoreLike | null {
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core')
    if (!requireOptionalNativeModule('ExpoSecureStore')) return null
    const store = require('expo-secure-store') as typeof import('expo-secure-store')
    const options = os === 'ios' ? { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY } : undefined
    return {
      getItem: (key) => store.getItemAsync(key),
      setItem: (key, value) => store.setItemAsync(key, value, options),
    }
  } catch {
    return null
  }
}

const appStore = createAutoGuardianStore(resolveAppBackends)

export const saveAutoGuardianSecret = appStore.save
export const hasAutoGuardianSecret = appStore.has

/** Biometric-gated read for the screen that displays or copies the key. */
export async function revealAutoGuardianSecret(guardian: string, reason: string): Promise<RevealResult> {
  const { promptBiometricAuth } = require('./haptix-passkey') as typeof import('./haptix-passkey')
  return appStore.reveal(guardian, () => promptBiometricAuth(reason))
}
