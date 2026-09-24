import AsyncStorage from '@react-native-async-storage/async-storage'
import { getWalletPda } from './haptix-client'
import { hexToBytes } from '@noble/curves/abstract/utils'

export interface HaptixWalletAccount {
  name: string
  address: string // The on-chain Haptix Anchor PDA address (Base58)
  primaryPasskeyHex: string // 33-byte compressed Secp256r1 hex
  secondaryPasskeyHex: string // 33-byte compressed Secp256r1 hex
  /**
   * Credential ids behind the two keys when they live in the OS authenticator rather
   * than in `expo-secure-store`. Switching wallets re-points the signing path at these,
   * so a wallet only becomes switchable once it carries them.
   */
  primaryCredentialId?: string
  secondaryCredentialId?: string
  primaryPasskeyLabel: string
  secondaryPasskeyLabel: string
  guardianAddress?: string
  spendThreshold: number // in SOL
  isInitializedOnChain: boolean
  network: 'devnet' | 'mainnet-beta'
  isLocked?: boolean
  securityMode?: 'everyday' | 'vault'
  createdAt: number
}

/**
 * Wallets are stored as a list plus a pointer to the active one.
 *
 * A single slot meant the next wallet silently evicted the previous record: the earlier
 * address, its passkey metadata and its balance all became unreachable from the app even
 * though the account and its funds were untouched on-chain. Keeping the list is what makes
 * switching between wallets possible at all.
 */
const WALLETS_KEY = '@haptix_wallets'
const ACTIVE_ADDRESS_KEY = '@haptix_active_wallet_address'
/** Single-slot record written by earlier builds; folded into the list on first read. */
const LEGACY_STORAGE_KEY = '@haptix_active_smart_wallet'
/** Pre-passkey plaintext secret from the original prototype. Always deleted. */
const LEGACY_PLAINTEXT_KEY = '@haptix_active_wallet'

function isWalletRecord(value: unknown): value is HaptixWalletAccount {
  const record = value as HaptixWalletAccount | null
  return (
    !!record &&
    typeof record === 'object' &&
    typeof record.address === 'string' &&
    record.address.length > 0 &&
    typeof record.primaryPasskeyHex === 'string' &&
    typeof record.secondaryPasskeyHex === 'string'
  )
}

/**
 * Every wallet this device knows about, in the order they were added.
 */
export async function loadWallets(): Promise<HaptixWalletAccount[]> {
  try {
    await AsyncStorage.removeItem(LEGACY_PLAINTEXT_KEY)

    const raw = await AsyncStorage.getItem(WALLETS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isWalletRecord) : []
    }

    // Fold a single-slot record into the list, so an existing install keeps its wallet
    // instead of looking as though it had been signed out.
    const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacyRaw) return []

    const legacy: unknown = JSON.parse(legacyRaw)
    if (!isWalletRecord(legacy)) return []

    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify([legacy]))
    await AsyncStorage.setItem(ACTIVE_ADDRESS_KEY, legacy.address)
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY)
    return [legacy]
  } catch (err) {
    console.error('[Haptix Storage] Failed to load wallets', err)
    return []
  }
}

/** The wallet the app is currently operating as, or null when the device has none. */
export async function getSavedWallet(): Promise<HaptixWalletAccount | null> {
  const wallets = await loadWallets()
  if (wallets.length === 0) return null

  const activeAddress = await AsyncStorage.getItem(ACTIVE_ADDRESS_KEY).catch(() => null)
  // Falling back to the most recently added wallet self-heals a list written without a
  // pointer, and can only ever select a wallet this device already holds.
  return wallets.find((wallet) => wallet.address === activeAddress) ?? wallets[wallets.length - 1]
}

export async function saveWallet(wallet: HaptixWalletAccount): Promise<void> {
  try {
    const wallets = await loadWallets()
    const index = wallets.findIndex((existing) => existing.address === wallet.address)
    const next = index >= 0 ? wallets.map((existing, at) => (at === index ? wallet : existing)) : [...wallets, wallet]

    // Upsert in place. `saveWallet` also runs on every lock/init state change, so it must
    // not reorder the list or drop sibling wallets.
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(next))
    await AsyncStorage.setItem(ACTIVE_ADDRESS_KEY, wallet.address)
  } catch (err) {
    console.error('[Haptix Storage] Failed to save wallet', err)
  }
}

/**
 * Makes an already-saved wallet active and returns it, or null when this device does not
 * hold it. The caller re-points the signing credentials at the record it gets back.
 */
export async function activateWallet(address: string): Promise<HaptixWalletAccount | null> {
  const wallets = await loadWallets()
  const wallet = wallets.find((candidate) => candidate.address === address)
  if (!wallet) return null
  await AsyncStorage.setItem(ACTIVE_ADDRESS_KEY, wallet.address)
  return wallet
}

export async function removeWallet(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([WALLETS_KEY, ACTIVE_ADDRESS_KEY, LEGACY_STORAGE_KEY, LEGACY_PLAINTEXT_KEY])
  } catch (err) {
    console.error('[Haptix Storage] Failed to remove wallet', err)
  }
}

export async function setWalletLockState(isLocked: boolean): Promise<void> {
  const current = await getSavedWallet()
  if (current) {
    current.isLocked = isLocked
    await saveWallet(current)
  }
}

/**
 * Creates and saves a new Haptix Smart Wallet account backed by Secp256r1 passkeys.
 * Does NOT generate or store any raw private keys in AsyncStorage.
 */
export async function createSmartWalletRecord({
  name = 'Personal Smart Wallet',
  primaryPasskeyHex,
  secondaryPasskeyHex,
  primaryCredentialId,
  secondaryCredentialId,
  primaryLabel = 'Touch ID / Face ID (Primary)',
  secondaryLabel = 'Backup quorum key (device secure storage)',
  guardianAddress,
  spendThreshold = 0.1,
  network = 'devnet',
  securityMode = 'everyday',
}: {
  name?: string
  primaryPasskeyHex: string
  secondaryPasskeyHex: string
  primaryCredentialId?: string
  secondaryCredentialId?: string
  primaryLabel?: string
  secondaryLabel?: string
  guardianAddress?: string
  spendThreshold?: number
  network?: 'devnet' | 'mainnet-beta'
  securityMode?: 'everyday' | 'vault'
}): Promise<HaptixWalletAccount> {
  const primaryBytes = hexToBytes(primaryPasskeyHex)
  const [pda] = getWalletPda(primaryBytes)

  const walletRecord: HaptixWalletAccount = {
    name: name.trim() || 'Personal Smart Wallet',
    address: pda.toBase58(),
    primaryPasskeyHex,
    secondaryPasskeyHex,
    primaryCredentialId,
    secondaryCredentialId,
    primaryPasskeyLabel: primaryLabel,
    secondaryPasskeyLabel: secondaryLabel,
    guardianAddress,
    spendThreshold,
    isInitializedOnChain: false,
    network,
    isLocked: false,
    securityMode,
    createdAt: Date.now(),
  }

  await saveWallet(walletRecord)
  return walletRecord
}
