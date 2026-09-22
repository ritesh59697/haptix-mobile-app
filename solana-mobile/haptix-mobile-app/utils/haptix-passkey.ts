import { Alert, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { p256 } from '@noble/curves/p256'
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils'
import { sha256 } from '@noble/hashes/sha2'
import { requireOptionalNativeModule } from 'expo-modules-core'
import * as Crypto from 'expo-crypto'
import { AppConfig } from '@/constants/app-config'

/**
 * ============================================================================
 * HAPTIX PASSKEY ENGINE
 * ============================================================================
 *
 * WHAT THIS ACTUALLY DOES
 * -----------------------
 * A P-256 (secp256r1) scalar is generated on-device from the platform CSPRNG and
 * kept in the OS secure store via `expo-secure-store` (iOS Keychain, Android
 * Keystore-encrypted storage). Reads are gated behind an `expo-local-authentication`
 * biometric prompt, and every signature is verified on-chain by Solana's native
 * Secp256r1SigVerify precompile.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is a *software* key that the OS protects at rest and that we gate behind
 * biometrics. It is NOT generated inside, or confined to, a secure element:
 *
 *   - The scalar is materialised in JS memory to sign, so a rooted or jailbroken
 *     device, or anything that can read the unlocked secure store, can extract it.
 *   - It is not a WebAuthn credential and carries no hardware attestation.
 *
 * True hardware-bound keys need a native module that generates an
 * Android Keystore `KeyGenParameterSpec` / iOS Secure Enclave key and signs
 * inside it, so the scalar never reaches JS. Until that exists, no label, copy,
 * or comment in this app may describe these keys as hardware-bound, enclave-
 * sealed, or hardware-attested.
 *
 * Web builds use real platform passkeys through WebAuthn, which never expose key
 * material to JS.
 */

const CREDENTIAL_KEY_PRIMARY = '@haptix_passkey_credential_primary'
const CREDENTIAL_KEY_SECONDARY = '@haptix_passkey_credential_secondary'
const PUBKEY_KEY_PRIMARY = '@haptix_passkey_pubkey_primary'
const PUBKEY_KEY_SECONDARY = '@haptix_passkey_pubkey_secondary'

/**
 * SecureStore is unavailable on web, where these native scalars are never used,
 * so the keys are only ever touched on native platforms.
 */
const SCALAR_KEY_PRIMARY = 'haptix_scalar_primary'
const SCALAR_KEY_SECONDARY = 'haptix_scalar_secondary'

/** Legacy AsyncStorage keys that used to hold the scalar inside the credential id. */
const LEGACY_PLAINTEXT_CREDENTIAL = /^haptix_os_cred_(primary|secondary)_([0-9a-f]{64})$/

const LEGACY_VAULT_KEYS = [
  '@haptix_passkey_vault_haptix_passkey_primary_private_seed',
  '@haptix_passkey_vault_haptix_passkey_secondary_private_seed',
]

const CURVE_ORDER = p256.CURVE.n

/** Honest labelling: these keys are protected by the OS, not sealed in hardware. */
const DEVICE_KEY_LABELS = {
  primary: 'Device secure storage (biometric-gated)',
  secondary: 'Backup quorum key (device secure storage)',
} as const

const WEBAUTHN_LABEL = 'Platform passkey (WebAuthn)'

export interface PasskeyInfo {
  id: 'primary' | 'secondary'
  /** Opaque, non-secret identifier. Never contains key material. */
  credentialId: string
  publicKey: Uint8Array
  publicKeyHex: string
  label: string
  hasBiometrics: boolean
  /**
   * False unless the key is generated in and used from a secure element. No code
   * path currently achieves that, so callers must not render hardware claims.
   */
  hardwareBacked: boolean
}

export interface BiometricAuthResult {
  success: boolean
  error?: string
}

function getLocalAuth(): typeof import('expo-local-authentication') | null {
  try {
    if (Platform.OS === 'web') return null
    if (requireOptionalNativeModule('ExpoLocalAuthentication')) {
      return require('expo-local-authentication')
    }
    return null
  } catch {
    return null
  }
}

function getSecureStore(): typeof import('expo-secure-store') | null {
  try {
    if (Platform.OS === 'web') return null
    if (requireOptionalNativeModule('ExpoSecureStore')) {
      return require('expo-secure-store')
    }
    return null
  } catch {
    return null
  }
}

/**
 * Secure storage is mandatory for private key material. Falling back to
 * AsyncStorage would silently undo the whole point of this module, so refuse.
 */
function requireSecureStore(): typeof import('expo-secure-store') {
  const store = getSecureStore()
  if (!store) {
    throw new Error(
      'OS secure storage is unavailable in this build, so a device key cannot be created. ' +
        'Rebuild the app (expo prebuild / eas build) with expo-secure-store compiled in. ' +
        'Haptix will not fall back to AsyncStorage for private key material.',
    )
  }
  return store
}

function pubkeyKey(id: 'primary' | 'secondary'): string {
  return id === 'primary' ? PUBKEY_KEY_PRIMARY : PUBKEY_KEY_SECONDARY
}

function credentialKey(id: 'primary' | 'secondary'): string {
  return id === 'primary' ? CREDENTIAL_KEY_PRIMARY : CREDENTIAL_KEY_SECONDARY
}

function scalarKey(id: 'primary' | 'secondary'): string {
  return id === 'primary' ? SCALAR_KEY_PRIMARY : SCALAR_KEY_SECONDARY
}

async function secureRandomBytes(length: number): Promise<Uint8Array> {
  try {
    return await Crypto.getRandomBytesAsync(length)
  } catch {
    const fallback = new Uint8Array(length)
    crypto.getRandomValues(fallback)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Scalar handling
// ---------------------------------------------------------------------------

function scalarToHex(scalar: bigint): string {
  return scalar.toString(16).padStart(64, '0')
}

function scalarFromHex(hex: string): bigint | null {
  try {
    const value = BigInt('0x' + hex.replace(/^0x/, ''))
    if (value <= 0n || value >= CURVE_ORDER) return null
    return value
  } catch {
    return null
  }
}

/** Maps random bytes into the valid scalar range [1, n-1]. */
function scalarFromRandomBytes(bytes: Uint8Array): bigint {
  const value = BigInt('0x' + bytesToHex(bytes))
  return (value % (CURVE_ORDER - 1n)) + 1n
}

function compressedPubkeyHex(scalar: bigint): string {
  return bytesToHex(p256.Point.BASE.multiply(scalar).toRawBytes(true))
}

async function writeScalar(id: 'primary' | 'secondary', scalar: bigint): Promise<void> {
  const store = requireSecureStore()
  const options = Platform.OS === 'ios' ? { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY } : undefined
  await store.setItemAsync(scalarKey(id), scalarToHex(scalar), options)
}

async function readScalar(id: 'primary' | 'secondary'): Promise<bigint | null> {
  const store = getSecureStore()
  if (!store) return null
  try {
    const hex = await store.getItemAsync(scalarKey(id))
    return hex ? scalarFromHex(hex) : null
  } catch {
    return null
  }
}

async function deleteScalar(id: 'primary' | 'secondary'): Promise<void> {
  const store = getSecureStore()
  if (!store) return
  try {
    await store.deleteItemAsync(scalarKey(id))
  } catch {
    // Nothing to remove, or store unavailable.
  }
}

/**
 * Older builds wrote `haptix_os_cred_<id>_<64 hex chars>` into AsyncStorage, which
 * put the private scalar in plaintext in an unencrypted store. Move that scalar
 * into the OS secure store so the existing wallet keeps working, then delete the
 * plaintext copy.
 *
 * Only entries matching that exact legacy format are touched. WebAuthn credential
 * ids stored under the same AsyncStorage keys are left alone.
 */
async function migrateLegacyPlaintextScalar(id: 'primary' | 'secondary'): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(credentialKey(id))
    if (!raw) return null

    const match = LEGACY_PLAINTEXT_CREDENTIAL.exec(raw)
    if (!match) return null

    const legacyValue = BigInt('0x' + match[2]) % CURVE_ORDER
    await AsyncStorage.removeItem(credentialKey(id))

    if (legacyValue === 0n) {
      console.warn(
        `[Haptix Passkey] Discarded a legacy ${id} key with an out-of-range scalar; ` +
          'it could not have produced a usable key.',
      )
      return null
    }

    await writeScalar(id, legacyValue)
    const pubkeyHex = compressedPubkeyHex(legacyValue)
    await AsyncStorage.setItem(pubkeyKey(id), pubkeyHex)

    console.warn(
      `[Haptix Passkey] Migrated the ${id} key out of plaintext AsyncStorage into OS ` +
        'secure storage. The on-chain wallet address is unchanged.',
    )
    return pubkeyHex
  } catch (err) {
    console.warn('[Haptix Passkey] Legacy key migration failed:', err)
    return null
  }
}

async function removeLegacyVaults(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(LEGACY_VAULT_KEYS)
  } catch {
    // Best effort cleanup of pre-existing vault aliases.
  }
}

// ---------------------------------------------------------------------------
// Biometrics
// ---------------------------------------------------------------------------

export async function checkBiometricsAvailable(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' && !!window.PublicKeyCredential
    }
    const localAuth = getLocalAuth()
    if (!localAuth) return false
    const hasHardware = await localAuth.hasHardwareAsync().catch(() => false)
    const isEnrolled = await localAuth.isEnrolledAsync().catch(() => false)
    return Boolean(hasHardware && isEnrolled)
  } catch (e) {
    console.warn('[Haptix Passkey] checkBiometricsAvailable error:', e)
    return false
  }
}

/**
 * Requests biometric verification from the user.
 * - Web: WebAuthn / platform passkey prompt.
 * - Native: the OS BiometricPrompt (fingerprint, face, or device credential).
 *
 * The sensor-less bypass is only reachable in dev mode, because it grants
 * authorization without authenticating anything.
 */
export async function promptBiometricAuth(
  reason: string = 'Authorize Haptix Smart Wallet Action',
): Promise<BiometricAuthResult> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      try {
        const credIdB64 = await AsyncStorage.getItem(CREDENTIAL_KEY_PRIMARY)
        if (credIdB64 && !LEGACY_PLAINTEXT_CREDENTIAL.test(credIdB64)) {
          const challenge = crypto.getRandomValues(new Uint8Array(32))
          const credential = await navigator.credentials.get({
            publicKey: {
              challenge,
              rpId: window.location.hostname || 'localhost',
              userVerification: 'required',
              allowCredentials: [
                {
                  id: base64UrlToBytes(credIdB64) as any,
                  type: 'public-key' as const,
                },
              ],
              timeout: 60000,
            },
          })

          if (credential) {
            return { success: true }
          }
        }
      } catch (e: any) {
        if (e?.name === 'NotAllowedError') {
          return {
            success: false,
            error: 'Touch ID / passkey authentication was cancelled by the user.',
          }
        }
        console.warn('[Haptix Passkey] WebAuthn prompt error, falling back:', e)
      }
    }

    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm(`Haptix authorization\n\n${reason}\n\nContinue with your device passkey?`)
      return {
        success: confirmed,
        error: confirmed ? undefined : 'Authentication cancelled by user.',
      }
    }
    return { success: true }
  }

  const localAuth = getLocalAuth()
  if (localAuth) {
    try {
      const hasHardware = await localAuth.hasHardwareAsync().catch(() => false)
      const isEnrolled = await localAuth.isEnrolledAsync().catch(() => false)

      if (hasHardware && isEnrolled) {
        const result = await localAuth.authenticateAsync({
          promptMessage: reason,
          cancelLabel: 'Cancel',
          fallbackLabel: 'Use Device PIN / Pattern',
          disableDeviceFallback: false,
        })

        if (result.success) {
          return { success: true }
        }

        if (result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel') {
          return { success: false, error: 'Authentication was cancelled by user.' }
        }
        if (result.error === 'not_enrolled') {
          return { success: false, error: 'No biometric credentials enrolled in device Settings.' }
        }
        if (result.error === 'lockout') {
          return {
            success: false,
            error:
              'Biometric sensor locked after repeated failed attempts. Unlock with your device PIN or password first.',
          }
        }
        return { success: false, error: 'Biometric authentication was cancelled or failed.' }
      }
    } catch (err: any) {
      console.error('[Haptix Passkey] Native biometric prompt error:', err)
    }
  }

  // No biometric module compiled into this binary.
  if (!AppConfig.devMode) {
    return {
      success: false,
      error:
        'Biometric authentication is unavailable in this build. Rebuild the app so ' +
        'expo-local-authentication is compiled in, then try again.',
    }
  }

  return new Promise<BiometricAuthResult>((resolve) => {
    Alert.alert(
      'Biometric module missing (dev mode)',
      `This build has no compiled expo-local-authentication module, so the OS biometric ` +
        `prompt cannot be shown.\n\nAction: ${reason}\n\nDo you want to continue without ` +
        'biometric verification? This is only permitted in dev mode.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () =>
            resolve({
              success: false,
              error: 'Biometric prompt requires rebuilding the app (eas build or expo run:android).',
            }),
        },
        {
          text: 'Continue without biometrics',
          style: 'destructive',
          onPress: () => {
            console.warn('[Haptix Passkey][DEV MODE] Proceeding without biometric verification for: ' + reason)
            resolve({ success: true })
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve({ success: false, error: 'Authentication dismissed.' }),
      },
    )
  })
}

// ---------------------------------------------------------------------------
// WebAuthn (web only)
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Extracts the 33-byte compressed point from a SPKI DER public key. */
function extractCompressedP256FromSpki(spkiBytes: Uint8Array): Uint8Array {
  if (spkiBytes.length < 65) {
    throw new Error('SPKI buffer is too short')
  }
  const uncompressed = spkiBytes.slice(spkiBytes.length - 65)
  if (uncompressed[0] !== 0x04) {
    throw new Error('Invalid EC uncompressed point prefix')
  }
  const point = p256.Point.fromHex(bytesToHex(uncompressed))
  return point.toRawBytes(true)
}

/**
 * Registers a platform passkey via WebAuthn. No key material reaches JS; the
 * authenticator holds the private key and we persist only the credential id and
 * public key.
 */
export async function registerWebAuthnPasskey(
  id: 'primary' | 'secondary' = 'primary',
  walletName: string = 'Haptix Wallet',
): Promise<PasskeyInfo> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.PublicKeyCredential) {
    throw new Error('WebAuthn passkeys are not supported in this environment.')
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId = crypto.getRandomValues(new Uint8Array(16))

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Haptix Wallet', id: window.location.hostname || 'localhost' },
        user: {
          id: userId,
          name: walletName,
          displayName: walletName,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 / P-256
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null

    if (!credential) {
      throw new Error('Passkey creation was cancelled.')
    }

    const rawId = new Uint8Array(credential.rawId)
    const credentialId = bytesToBase64Url(rawId)
    const response = credential.response as AuthenticatorAttestationResponse

    let compressedPublicKey: Uint8Array
    try {
      const spki = response.getPublicKey?.()
      if (!spki) throw new Error('Authenticator did not expose a public key')
      compressedPublicKey = extractCompressedP256FromSpki(new Uint8Array(spki))
    } catch {
      throw new Error(
        'This browser will not export the passkey public key, so the wallet address cannot be derived. Try Chrome or Safari.',
      )
    }

    const publicKeyHex = bytesToHex(compressedPublicKey)
    await AsyncStorage.setItem(credentialKey(id), credentialId)
    await AsyncStorage.setItem(pubkeyKey(id), publicKeyHex)

    return {
      id,
      credentialId,
      publicKey: compressedPublicKey,
      publicKeyHex,
      label: WEBAUTHN_LABEL,
      hasBiometrics: true,
      hardwareBacked: false,
    }
  } catch (err: any) {
    console.error(`[Haptix Passkey] WebAuthn registration failed for ${id}:`, err)
    if (err?.name === 'NotAllowedError') {
      throw new Error('Passkey creation was cancelled. Complete the platform verification to continue.')
    }
    throw new Error(err?.message || 'Failed to create a passkey.')
  }
}

// ---------------------------------------------------------------------------
// Device (native) passkeys
// ---------------------------------------------------------------------------

/**
 * Generates a P-256 keypair on-device and stores the scalar in OS secure
 * storage. The scalar is never written to AsyncStorage.
 */
async function registerDevicePasskey(
  id: 'primary' | 'secondary',
  walletName: string = 'Haptix Wallet',
): Promise<PasskeyInfo> {
  requireSecureStore()

  if (id === 'primary') {
    const auth = await promptBiometricAuth('Confirm with your device biometrics to create your Haptix wallet key')
    if (!auth.success) {
      throw new Error(
        auth.error || 'Biometric verification was cancelled. Your device must be unlocked to create the wallet key.',
      )
    }
  }

  const entropy = await secureRandomBytes(32)
  const scalar = scalarFromRandomBytes(entropy)
  entropy.fill(0)

  await writeScalar(id, scalar)
  const publicKeyHex = compressedPubkeyHex(scalar)
  await AsyncStorage.setItem(pubkeyKey(id), publicKeyHex)

  let credentialId: string
  try {
    credentialId = `haptix_device_key_${id}_${Crypto.randomUUID()}`
  } catch {
    credentialId = `haptix_device_key_${id}_${bytesToHex(await secureRandomBytes(8))}`
  }
  await AsyncStorage.setItem(credentialKey(id), credentialId)

  return {
    id,
    credentialId,
    publicKey: hexToBytes(publicKeyHex),
    publicKeyHex,
    label: DEVICE_KEY_LABELS[id],
    hasBiometrics: true,
    hardwareBacked: false,
  }
}

/**
 * Creates or retrieves the primary passkey.
 *
 * On native, an existing key is returned from secure storage; a legacy plaintext
 * key is migrated rather than discarded so existing wallets keep the same address.
 */
export async function getOrCreatePrimaryPasskey(walletName: string = 'Haptix Wallet'): Promise<PasskeyInfo> {
  await removeLegacyVaults()

  const migratedPubkey = await migrateLegacyPlaintextScalar('primary')
  const existingPubHex = migratedPubkey ?? (await AsyncStorage.getItem(PUBKEY_KEY_PRIMARY))

  if (existingPubHex) {
    const scalar = await readScalar('primary')
    if (scalar) {
      const publicKeyHex = bytesToHex(p256.Point.BASE.multiply(scalar).toRawBytes(true))
      await AsyncStorage.setItem(PUBKEY_KEY_PRIMARY, publicKeyHex)
      return {
        id: 'primary',
        credentialId: (await AsyncStorage.getItem(CREDENTIAL_KEY_PRIMARY)) ?? '',
        publicKey: hexToBytes(publicKeyHex),
        publicKeyHex,
        label: DEVICE_KEY_LABELS.primary,
        hasBiometrics: true,
        hardwareBacked: false,
      }
    }
  }

  if (Platform.OS === 'web') {
    return await registerWebAuthnPasskey('primary', walletName)
  }

  return await registerDevicePasskey('primary', walletName)
}

/**
 * Creates or retrieves the secondary quorum key.
 *
 * NOTE: this is a second key in the same OS secure store on the same device. It
 * is a second signature, not a second factor, and must not be described as an
 * external hardware key. A real 2-of-2 needs a separately held authenticator.
 */
export async function getOrCreateSecondaryPasskey(walletName: string = 'Haptix Wallet'): Promise<PasskeyInfo> {
  const migratedPubkey = await migrateLegacyPlaintextScalar('secondary')
  const existingPubHex = migratedPubkey ?? (await AsyncStorage.getItem(PUBKEY_KEY_SECONDARY))

  if (existingPubHex) {
    const scalar = await readScalar('secondary')
    if (scalar) {
      const publicKeyHex = bytesToHex(p256.Point.BASE.multiply(scalar).toRawBytes(true))
      await AsyncStorage.setItem(PUBKEY_KEY_SECONDARY, publicKeyHex)
      return {
        id: 'secondary',
        credentialId: (await AsyncStorage.getItem(CREDENTIAL_KEY_SECONDARY)) ?? '',
        publicKey: hexToBytes(publicKeyHex),
        publicKeyHex,
        label: DEVICE_KEY_LABELS.secondary,
        hasBiometrics: true,
        hardwareBacked: false,
      }
    }
  }

  if (Platform.OS === 'web') {
    return await registerWebAuthnPasskey('secondary', walletName)
  }

  return await registerDevicePasskey('secondary', walletName)
}

/**
 * Authenticates an existing passkey, for unlocks and restores.
 *
 * On native the key lives in this device's secure store, so this verifies the
 * local key rather than discovering a credential on a new device. Restoring onto
 * new hardware goes through guardian recovery instead; pretending otherwise
 * would produce a wallet whose key the device cannot use.
 */
export async function authenticatePasskey(reason: string = 'Authenticate to restore wallet'): Promise<PasskeyInfo> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.PublicKeyCredential) {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    try {
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname || 'localhost',
          userVerification: 'required',
          timeout: 60000,
        },
      })) as PublicKeyCredential | null

      if (!credential) {
        throw new Error('Authentication cancelled.')
      }

      const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId))

      return {
        id: 'primary',
        credentialId,
        publicKey: new Uint8Array(0),
        publicKeyHex: '',
        label: 'Restored passkey (WebAuthn)',
        hasBiometrics: true,
        hardwareBacked: false,
      }
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        throw new Error('Passkey authentication was cancelled or no passkey was found.')
      }
      throw new Error(err?.message || 'Failed to authenticate passkey.')
    }
  }

  const scalar = await readScalar('primary')
  if (!scalar) {
    throw new Error(
      'No wallet key exists on this device. A device key cannot be copied between devices, ' +
        'so restoring onto new hardware requires guardian recovery with your secondary key.',
    )
  }

  const auth = await promptBiometricAuth(reason)
  if (!auth.success) {
    throw new Error(auth.error || 'Biometric authentication failed.')
  }

  const publicKeyHex = compressedPubkeyHex(scalar)
  return {
    id: 'primary',
    credentialId: (await AsyncStorage.getItem(CREDENTIAL_KEY_PRIMARY)) ?? '',
    publicKey: hexToBytes(publicKeyHex),
    publicKeyHex,
    label: DEVICE_KEY_LABELS.primary,
    hasBiometrics: true,
    hardwareBacked: false,
  }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Signs a message with the requested passkey, after a biometric check.
 *
 * The message is SHA-256 hashed before signing to match the digest the Solana
 * Secp256r1SigVerify precompile computes over the same bytes.
 */
export async function signWithPasskey(
  passkeyId: 'primary' | 'secondary',
  message: Uint8Array,
  promptReason: string = 'Authorize on-chain transaction',
): Promise<{ signature: Uint8Array; publicKey: Uint8Array }> {
  const publicKeyHex = await AsyncStorage.getItem(pubkeyKey(passkeyId))
  if (!publicKeyHex) {
    throw new Error(`No registered passkey found for ${passkeyId}. Please create or restore your wallet first.`)
  }
  const publicKey = hexToBytes(publicKeyHex)

  // Web: the authenticator signs; no key material is available to JS.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.PublicKeyCredential) {
    const credentialId = await AsyncStorage.getItem(credentialKey(passkeyId))
    if (credentialId && !LEGACY_PLAINTEXT_CREDENTIAL.test(credentialId)) {
      try {
        const assertion = (await navigator.credentials.get({
          publicKey: {
            challenge: message as any,
            rpId: window.location.hostname || 'localhost',
            userVerification: 'required',
            allowCredentials: [
              {
                id: base64UrlToBytes(credentialId) as any,
                type: 'public-key' as const,
              },
            ],
            timeout: 60000,
          },
        })) as PublicKeyCredential | null

        if (assertion) {
          const response = assertion.response as AuthenticatorAssertionResponse
          const parsed = p256.Signature.fromDER(new Uint8Array(response.signature))
          return {
            signature: parsed.normalizeS().toCompactRawBytes(),
            publicKey,
          }
        }
      } catch (err: any) {
        console.error(`[Haptix Passkey] WebAuthn assertion for ${passkeyId} failed:`, err)
        throw new Error(`Biometric signature failed or cancelled: ${err?.message || 'Unknown error'}`)
      }
    }
  }

  const auth = await promptBiometricAuth(
    passkeyId === 'primary' ? promptReason : `Authorize 2-of-2 quorum signature (${promptReason})`,
  )

  // Fail closed: an unavailable or declined prompt must never produce a signature.
  if (!auth.success) {
    throw new Error(auth.error || 'Biometric authorization was cancelled or unavailable. Transaction aborted.')
  }

  const scalar = await readScalar(passkeyId)
  if (!scalar) {
    throw new Error(
      `Secure key material for the ${passkeyId} passkey is missing or was cleared. ` +
        'Re-create the wallet or restore it through guardian recovery.',
    )
  }

  const msgHash = sha256(message)
  const signature = p256.sign(msgHash, scalar, { lowS: true }).toCompactRawBytes()

  return { signature, publicKey }
}

/**
 * Clears every passkey artifact: secure-store scalars, public metadata, and any
 * legacy plaintext copies.
 */
export async function deletePasskeys(): Promise<void> {
  try {
    await deleteScalar('primary')
    await deleteScalar('secondary')

    await AsyncStorage.multiRemove([
      CREDENTIAL_KEY_PRIMARY,
      PUBKEY_KEY_PRIMARY,
      CREDENTIAL_KEY_SECONDARY,
      PUBKEY_KEY_SECONDARY,
      ...LEGACY_VAULT_KEYS,
    ])
  } catch (e) {
    console.warn('[Haptix Passkey] Error clearing passkeys:', e)
  }
}
