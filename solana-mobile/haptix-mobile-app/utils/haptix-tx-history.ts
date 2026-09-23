import AsyncStorage from '@react-native-async-storage/async-storage'
import { TransactionRecord, isRecordLike, mergeTxRecords } from './haptix-tx-parser'

/**
 * Persistence for per-wallet chain data: the activity history and the last balance
 * that was measured successfully. Parsing lives in `haptix-tx-parser` so it stays free
 * of React Native dependencies and can be exercised directly.
 */

const STORAGE_KEY_PREFIX = '@haptix_tx_history'
const BALANCE_KEY_PREFIX = '@haptix_balance'
const MAX_STORED_RECORDS = 100

function storageKey(walletAddress: string): string {
  return `${STORAGE_KEY_PREFIX}:${walletAddress}`
}

function balanceKey(walletAddress: string): string {
  return `${BALANCE_KEY_PREFIX}:${walletAddress}`
}

/**
 * The last successfully measured SOL balance for a wallet, in lamports.
 *
 * The wallet card started every launch at zero and only corrected itself once the RPC
 * replied, so opening the app presented `$0.00 / 0.0000 SOL` as fact for the first few
 * hundred milliseconds -- the one number a wallet must never get wrong. Hydrating the
 * last measured value keeps the card truthful while the refresh is in flight, and a
 * failed refresh leaves the cached figure in place (with the RPC banner) rather than
 * zeroing it. Keyed per address so a stale entry can never be read for another wallet.
 */
export async function loadCachedBalance(walletAddress: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(balanceKey(walletAddress))
    if (!raw) return null
    const lamports = Number(raw)
    return Number.isFinite(lamports) && lamports >= 0 ? lamports : null
  } catch (err) {
    console.error('[Haptix TxHistory] Failed to load the cached balance', err)
    return null
  }
}

export async function saveCachedBalance(walletAddress: string, lamports: number): Promise<void> {
  if (!Number.isFinite(lamports) || lamports < 0) return
  try {
    await AsyncStorage.setItem(balanceKey(walletAddress), String(lamports))
  } catch (err) {
    console.error('[Haptix TxHistory] Failed to persist the balance', err)
  }
}

/** Drops a wallet's cached balance. Called when the device is signed out of it. */
export async function clearCachedBalance(walletAddress: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(balanceKey(walletAddress))
  } catch (err) {
    console.error('[Haptix TxHistory] Failed to clear the cached balance', err)
  }
}

/**
 * Reads persisted history for a wallet. Records written by older builds (which
 * had no direction or counterparty data) fail validation and are dropped, so a
 * stale heuristic never resurfaces in the UI.
 */
export async function loadTxHistory(walletAddress: string): Promise<TransactionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(walletAddress))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecordLike)
  } catch (err) {
    console.error('[Haptix TxHistory] Failed to load history', err)
    return []
  }
}

export async function saveTxHistory(walletAddress: string, records: TransactionRecord[]): Promise<void> {
  try {
    const trimmed = mergeTxRecords([], records).slice(0, MAX_STORED_RECORDS)
    await AsyncStorage.setItem(storageKey(walletAddress), JSON.stringify(trimmed))
  } catch (err) {
    console.error('[Haptix TxHistory] Failed to persist history', err)
  }
}

export async function clearTxHistory(walletAddress: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(walletAddress))
  } catch (err) {
    console.error('[Haptix TxHistory] Failed to clear history', err)
  }
}

export * from './haptix-tx-parser'
