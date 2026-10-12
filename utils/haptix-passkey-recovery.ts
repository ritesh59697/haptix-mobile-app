import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Buffer } from 'buffer'
import { hexToBytes } from '@noble/curves/abstract/utils'
import { AppConfig } from '@/constants/app-config'
import {
  HaptixWalletAccount,
  createSmartWalletRecord,
  saveWallet,
} from '@/utils/haptix-wallet-storage'
import {
  bindHardwarePasskey,
  getDiscoverablePlatformAssertion,
} from '@/utils/haptix-passkey'
import {
  prepareAssertionVerification,
  preparedAssertionMatchesPublicKey,
} from '@/utils/secp256r1-instruction'
import { fetchHaptixWallet, HAPTIX_PROGRAM_ID } from '@/utils/haptix-client'

type ProgramAccountsPromise = ReturnType<Connection['getProgramAccounts']>
let cachedAccountsPromise: ProgramAccountsPromise | null = null
let cachedAccountsTimestamp = 0
const ACCOUNTS_CACHE_TTL_MS = 60_000

export function getCachedOrFetchProgramAccounts(connection: Connection): ProgramAccountsPromise {
  const now = Date.now()
  if (cachedAccountsPromise && now - cachedAccountsTimestamp < ACCOUNTS_CACHE_TTL_MS) {
    return cachedAccountsPromise
  }
  cachedAccountsTimestamp = now
  const p = connection
    .getProgramAccounts(HAPTIX_PROGRAM_ID, {
      dataSlice: { offset: 9, length: 66 },
    })
    .catch((err) => {
      cachedAccountsPromise = null
      throw err
    })
  cachedAccountsPromise = p
  return p
}

export interface DiscoverPasskeyOptions {
  targetAddress?: string
  rpcUrl?: string
}

/**
 * Prompts user for biometric passkey authentication and resolves their on-chain wallet.
 * Uses Fast Path 0 (local credential index) for <100ms instant unlock, falling back
 * to indexed PDA and parallelized on-chain program accounts scan.
 */
export async function authenticateAndDiscoverPasskeyWallet(
  options?: DiscoverPasskeyOptions,
): Promise<HaptixWalletAccount> {
  const rpcUrl = options?.rpcUrl || AppConfig.devnetRpcUrl
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })
  const accountsPromise = getCachedOrFetchProgramAccounts(connection)

  const picked = await getDiscoverablePlatformAssertion()
  const prepared = prepareAssertionVerification(picked.assertion)
  if (!prepared) {
    throw new Error('Could not parse biometric passkey signature.')
  }

  let matchedPda: PublicKey | null = null
  let matchedKeyHex: string | null = null
  let matchedRole: 'primary' | 'secondary' = 'primary'

  // 0. Instant Device-Local Fast Path: Check if this device already has the wallet for this passkey
  const cachedWalletJson = await AsyncStorage.getItem(`@haptix_passkey_wallet_${picked.credentialId}`).catch(() => null)
  if (cachedWalletJson) {
    try {
      const cachedWallet: HaptixWalletAccount = JSON.parse(cachedWalletJson)
      const primaryBytes = hexToBytes(cachedWallet.primaryPasskeyHex)
      const secondaryBytes = cachedWallet.secondaryPasskeyHex ? hexToBytes(cachedWallet.secondaryPasskeyHex) : null

      let roleMatched: 'primary' | 'secondary' | null = null
      if (preparedAssertionMatchesPublicKey(prepared, primaryBytes)) {
        roleMatched = 'primary'
      } else if (secondaryBytes && preparedAssertionMatchesPublicKey(prepared, secondaryBytes)) {
        roleMatched = 'secondary'
      }

      if (roleMatched) {
        const boundKeyHex = roleMatched === 'primary' ? cachedWallet.primaryPasskeyHex : cachedWallet.secondaryPasskeyHex
        await bindHardwarePasskey(roleMatched, picked.credentialId, boundKeyHex)
        const updatedWallet: HaptixWalletAccount = {
          ...cachedWallet,
          primaryCredentialId: roleMatched === 'primary' ? picked.credentialId : cachedWallet.primaryCredentialId,
          secondaryCredentialId: roleMatched === 'secondary' ? picked.credentialId : cachedWallet.secondaryCredentialId,
        }
        await saveWallet(updatedWallet)
        return updatedWallet
      }
    } catch (fastErr) {
      console.warn('[Passkey Recovery] Fast cached wallet restore failed, falling through:', fastErr)
    }
  }

  // 1. Instant Fast Path: If this credential ID was mapped on this device previously, verify directly!
  const cachedPdaStr = await AsyncStorage.getItem(`@haptix_passkey_pda_${picked.credentialId}`).catch(() => null)
  if (cachedPdaStr) {
    try {
      const cachedPda = new PublicKey(cachedPdaStr)
      const cachedOnchainState = await fetchHaptixWallet(connection, cachedPda)
      if (cachedOnchainState) {
        if (preparedAssertionMatchesPublicKey(prepared, cachedOnchainState.primaryPasskey)) {
          matchedPda = cachedPda
          matchedKeyHex = Buffer.from(cachedOnchainState.primaryPasskey).toString('hex')
          matchedRole = 'primary'
        } else if (preparedAssertionMatchesPublicKey(prepared, cachedOnchainState.secondaryPasskey)) {
          matchedPda = cachedPda
          matchedKeyHex = Buffer.from(cachedOnchainState.secondaryPasskey).toString('hex')
          matchedRole = 'secondary'
        }
      }
    } catch {
      // Fall through to program accounts scan
    }
  }

  // 1.5. Target address path (if explicitly specified)
  if (!matchedPda && options?.targetAddress) {
    try {
      const targetPda = new PublicKey(options.targetAddress)
      const onchainState = await fetchHaptixWallet(connection, targetPda)
      if (onchainState) {
        if (preparedAssertionMatchesPublicKey(prepared, onchainState.primaryPasskey)) {
          matchedPda = targetPda
          matchedKeyHex = Buffer.from(onchainState.primaryPasskey).toString('hex')
          matchedRole = 'primary'
        } else if (preparedAssertionMatchesPublicKey(prepared, onchainState.secondaryPasskey)) {
          matchedPda = targetPda
          matchedKeyHex = Buffer.from(onchainState.secondaryPasskey).toString('hex')
          matchedRole = 'secondary'
        }
      }
    } catch {
      // Fall through
    }
  }

  // 2. Full scan path: Scan accounts using pre-computed signature digest & fast prefix checks
  if (!matchedPda) {
    const accounts = (await accountsPromise) ?? []
    for (const acc of accounts) {
      const primaryKey = acc.account.data.subarray(0, 33)
      const secondaryKey = acc.account.data.subarray(33, 66)
      if (preparedAssertionMatchesPublicKey(prepared, primaryKey)) {
        matchedPda = acc.pubkey
        matchedKeyHex = Buffer.from(primaryKey).toString('hex')
        matchedRole = 'primary'
        break
      }
      if (preparedAssertionMatchesPublicKey(prepared, secondaryKey)) {
        matchedPda = acc.pubkey
        matchedKeyHex = Buffer.from(secondaryKey).toString('hex')
        matchedRole = 'secondary'
        break
      }
    }
  }

  if (!matchedPda) {
    throw new Error('No smart wallet matching this passkey was found on Devnet.')
  }

  // Persist credentialId -> PDA mapping for instant sub-second logins next time
  await AsyncStorage.setItem(`@haptix_passkey_pda_${picked.credentialId}`, matchedPda.toBase58()).catch(() => {})

  const onchainState = await fetchHaptixWallet(connection, matchedPda)
  if (!onchainState) {
    throw new Error('Found wallet PDA, but could not load its on-chain account state.')
  }

  await bindHardwarePasskey(matchedRole, picked.credentialId, matchedKeyHex!)

  const spendThresholdSol = Number(onchainState.spendThresholdLamports) / LAMPORTS_PER_SOL
  const isVault = matchedRole === 'primary' && (!onchainState.secondaryPasskey || spendThresholdSol === 0)
  const restored = await createSmartWalletRecord({
    name: isVault ? 'Hardware Vault' : 'Personal Smart Wallet',
    primaryPasskeyHex: Buffer.from(onchainState.primaryPasskey).toString('hex'),
    secondaryPasskeyHex: Buffer.from(onchainState.secondaryPasskey).toString('hex'),
    primaryCredentialId: matchedRole === 'primary' ? picked.credentialId : undefined,
    secondaryCredentialId: matchedRole === 'secondary' ? picked.credentialId : undefined,
    primaryLabel: 'Primary passkey (Phone)',
    secondaryLabel: isVault ? 'Co-signer key (Second device)' : 'Platform passkey (backup)',
    spendThreshold: spendThresholdSol,
    network: 'devnet',
    securityMode: isVault ? 'vault' : 'everyday',
  })
  restored.address = matchedPda.toBase58()
  restored.isInitializedOnChain = true
  await saveWallet(restored)
  return restored
}
