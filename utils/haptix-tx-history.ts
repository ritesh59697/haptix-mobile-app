import AsyncStorage from '@react-native-async-storage/async-storage'
import { TransactionRecord, isRecordLike, mergeTxRecords } from './haptix-tx-parser'

/**
 * Persistence for transaction history. Parsing lives in `haptix-tx-parser` so it
 * stays free of React Native dependencies and can be exercised directly.
 */

const STORAGE_KEY_PREFIX = '@haptix_tx_history'
const MAX_STORED_RECORDS = 100

function storageKey(walletAddress: string): string {
  return `${STORAGE_KEY_PREFIX}:${walletAddress}`
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
