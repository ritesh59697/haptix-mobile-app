import AsyncStorage from '@react-native-async-storage/async-storage'
import { getWalletPda } from './haptix-client'
import { hexToBytes } from '@noble/curves/abstract/utils'

export interface HaptixWalletAccount {
  name: string
  address: string // The on-chain Haptix Anchor PDA address (Base58)
  primaryPasskeyHex: string // 33-byte compressed Secp256r1 hex
  secondaryPasskeyHex: string // 33-byte compressed Secp256r1 hex
  primaryPasskeyLabel: string
  secondaryPasskeyLabel: string
  guardianAddress?: string
  spendThreshold: number // in SOL
  isInitializedOnChain: boolean
  network: 'devnet' | 'mainnet-beta'
  isLocked?: boolean
  createdAt: number
}

const STORAGE_KEY = '@haptix_active_smart_wallet'
const LEGACY_STORAGE_KEY = '@haptix_active_wallet'

export async function getSavedWallet(): Promise<HaptixWalletAccount | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw) as HaptixWalletAccount
    }
    // Clean up any legacy plaintext secret key wallet if it exists
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY)
    return null
  } catch (err) {
    console.error('[Haptix Storage] Failed to load saved wallet', err)
    return null
  }
}

export async function saveWallet(wallet: HaptixWalletAccount): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(wallet))
  } catch (err) {
    console.error('[Haptix Storage] Failed to save wallet', err)
  }
}

export async function removeWallet(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY)
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
  primaryLabel = 'Touch ID / Face ID (Primary)',
  secondaryLabel = 'Backup quorum key (device secure storage)',
  guardianAddress,
  spendThreshold = 0.1,
  network = 'devnet',
}: {
  name?: string
  primaryPasskeyHex: string
  secondaryPasskeyHex: string
  primaryLabel?: string
  secondaryLabel?: string
  guardianAddress?: string
  spendThreshold?: number
  network?: 'devnet' | 'mainnet-beta'
}): Promise<HaptixWalletAccount> {
  const primaryBytes = hexToBytes(primaryPasskeyHex)
  const [pda] = getWalletPda(primaryBytes)

  const walletRecord: HaptixWalletAccount = {
    name: name.trim() || 'Personal Smart Wallet',
    address: pda.toBase58(),
    primaryPasskeyHex,
    secondaryPasskeyHex,
    primaryPasskeyLabel: primaryLabel,
    secondaryPasskeyLabel: secondaryLabel,
    guardianAddress,
    spendThreshold,
    isInitializedOnChain: false,
    network,
    isLocked: false,
    createdAt: Date.now(),
  }

  await saveWallet(walletRecord)
  return walletRecord
}
