import AsyncStorage from '@react-native-async-storage/async-storage'
import { PublicKey } from '@solana/web3.js'
import { HAPTIX_PROGRAM_ID } from './haptix-client'

/**
 * Seeker (SKR) SPL Token definitions & state management.
 * Designed specifically for the Solana Mobile "CLOCK IN" Hackathon ($10,000 SKR Bonus Prize).
 */

// Deterministically derived off-curve PDA mint for Seeker SKR ecosystem on Devnet
export const SEEKER_SKR_MINT: PublicKey = PublicKey.findProgramAddressSync(
  [Buffer.from('seeker_skr_mint')],
  HAPTIX_PROGRAM_ID,
)[0]

export const SKR_TOKEN_METADATA = {
  name: 'Seeker',
  symbol: 'SKR',
  decimals: 6,
  fallbackPriceUsd: 0.25,
  initialGenesisReward: 100, // 100 SKR welcome genesis allocation for Seeker users
  quorumThreshold: 50, // Transfers > 50 SKR escalate to 2-of-2 Hardware Quorum
}

export const USDC_TOKEN_METADATA = {
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  fallbackPriceUsd: 1.0,
  initialGenesisReward: 25.0, // 25 USDC welcome balance
  quorumThreshold: 20.0, // Transfers > 20 USDC escalate to 2-of-2 Hardware Quorum
}

const SKR_BALANCE_PREFIX = '@haptix_skr_balance_'
const USDC_BALANCE_PREFIX = '@haptix_usdc_balance_'

/**
 * Reads the stored SKR token balance for a smart wallet address.
 * If this wallet is new, it automatically seeds it with the Seeker Genesis Reward (100 SKR).
 */
export async function getStoredSkrBalance(walletAddress: string): Promise<number> {
  if (!walletAddress) return 0
  try {
    const raw = await AsyncStorage.getItem(`${SKR_BALANCE_PREFIX}${walletAddress}`)
    if (raw !== null) {
      const parsed = parseFloat(raw)
      return isNaN(parsed) ? 0 : parsed
    }
    // Automatically grant Seeker Genesis Reward to new smart wallets
    await setStoredSkrBalance(walletAddress, SKR_TOKEN_METADATA.initialGenesisReward)
    return SKR_TOKEN_METADATA.initialGenesisReward
  } catch {
    return SKR_TOKEN_METADATA.initialGenesisReward
  }
}

/**
 * Writes updated SKR token balance to device storage.
 */
export async function setStoredSkrBalance(walletAddress: string, amount: number): Promise<void> {
  if (!walletAddress) return
  try {
    await AsyncStorage.setItem(`${SKR_BALANCE_PREFIX}${walletAddress}`, amount.toString())
  } catch {}
}

/**
 * Explicitly claims or confirms the 100 SKR Seeker Genesis Reward for an onboarding wallet.
 */
export async function claimSeekerGenesisReward(walletAddress: string): Promise<number> {
  const current = await getStoredSkrBalance(walletAddress)
  if (current <= 0) {
    await setStoredSkrBalance(walletAddress, SKR_TOKEN_METADATA.initialGenesisReward)
    return SKR_TOKEN_METADATA.initialGenesisReward
  }
  return current
}

/**
 * Deducts an amount from the wallet's SKR balance upon an on-chain transfer.
 */
export async function deductSkrBalance(walletAddress: string, amountToSend: number): Promise<number> {
  const current = await getStoredSkrBalance(walletAddress)
  const updated = Math.max(0, current - amountToSend)
  await setStoredSkrBalance(walletAddress, updated)
  return updated
}

/**
 * Reads the stored USDC token balance for a smart wallet address.
 */
export async function getStoredUsdcBalance(walletAddress: string): Promise<number> {
  if (!walletAddress) return 0
  try {
    const raw = await AsyncStorage.getItem(`${USDC_BALANCE_PREFIX}${walletAddress}`)
    if (raw !== null) {
      const parsed = parseFloat(raw)
      return isNaN(parsed) ? 0 : parsed
    }
    await setStoredUsdcBalance(walletAddress, USDC_TOKEN_METADATA.initialGenesisReward)
    return USDC_TOKEN_METADATA.initialGenesisReward
  } catch {
    return USDC_TOKEN_METADATA.initialGenesisReward
  }
}

/**
 * Writes updated USDC token balance to device storage.
 */
export async function setStoredUsdcBalance(walletAddress: string, amount: number): Promise<void> {
  if (!walletAddress) return
  try {
    await AsyncStorage.setItem(`${USDC_BALANCE_PREFIX}${walletAddress}`, amount.toString())
  } catch {}
}

/**
 * Deducts an amount from the wallet's USDC balance upon an on-chain transfer.
 */
export async function deductUsdcBalance(walletAddress: string, amountToSend: number): Promise<number> {
  const current = await getStoredUsdcBalance(walletAddress)
  const updated = Math.max(0, current - amountToSend)
  await setStoredUsdcBalance(walletAddress, updated)
  return updated
}

