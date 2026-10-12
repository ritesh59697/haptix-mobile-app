import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { AppConfig } from '@/constants/app-config'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Devnet fee sponsorship for local demos.
 *
 * A client bundle cannot keep a secret: `EXPO_PUBLIC_*` values are inlined at
 * build time and are recoverable from any shipped binary. Fee sponsorship
 * therefore belongs in a server-side relayer. Until that exists, this module is
 * a development-only escape hatch, which is why the key lives in a gitignored
 * `.env` instead of the source tree and every use is gated behind
 * `AppConfig.devMode`.
 */

const FUNDER_KEY_ENV = 'EXPO_PUBLIC_HAPTIX_FUNDER_KEY'

let cachedFunder: Keypair | null = null

function loadFunderSecret(): Uint8Array {
  if (!AppConfig.devMode) {
    throw new Error(
      'Fee sponsorship is off. A production build cannot carry a fee-payer key. Fund the wallet with SOL, or run a server-side relayer.',
    )
  }

  // Read as a literal member expression. Expo substitutes `EXPO_PUBLIC_*` values by
  // matching this exact source text at bundle time, so a computed lookup such as
  // `process.env[FUNDER_KEY_ENV]` is never replaced.
  const raw = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY?.trim()

  if (!raw) {
    throw new Error(
      `${FUNDER_KEY_ENV} is not set. Devnet fee sponsorship reads that variable at build time and will not fall back to a key checked into the app.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${FUNDER_KEY_ENV} must be a JSON byte array such as [12,34,...], not a base58 string.`)
  }

  if (!Array.isArray(parsed) || parsed.length !== 64) {
    const shape = Array.isArray(parsed) ? `${parsed.length} entries` : typeof parsed
    throw new Error(`${FUNDER_KEY_ENV} must be a JSON array of exactly 64 bytes; got ${shape}.`)
  }

  const bytes = parsed.map((value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`${FUNDER_KEY_ENV} contains a value that is not a byte.`)
    }
    return value
  })

  return Uint8Array.from(bytes)
}

function requireDevMode(feature: string): void {
  if (!AppConfig.devMode) {
    throw new Error(`${feature} is disabled outside dev mode.`)
  }
}

/**
 * Returns the local funder keypair used to sponsor Devnet network fees.
 *
 * Gated behind dev mode, requires a funder key in the environment, and logs a
 * warning the first time it is handed out.
 */
export async function getFundedDevnetPayer(_connection?: Connection, _minSol: number = 0.01): Promise<Keypair> {
  requireDevMode('Client-side Devnet fee sponsorship')

  if (!cachedFunder) {
    const funder = Keypair.fromSecretKey(loadFunderSecret())

    console.warn(
      '[Haptix][DEV MODE] Paying network fees and airdropping Devnet SOL with a local ' +
        `funder keypair: ${funder.publicKey.toBase58()}. This key is embedded in the ` +
        'bundle, so it is only ever acceptable for Devnet demos -- use a server-side ' +
        'relayer before shipping to mainnet or holding anything of value.',
    )

    cachedFunder = funder
  }

  return cachedFunder
}

export interface FundWalletOptions {
  maxBalanceCheck?: number
  enforceCooldown?: boolean
}

/**
 * Directly fund a smart wallet PDA with Devnet SOL from the local funder wallet.
 */
export async function fundDevnetWallet(
  connection: Connection,
  walletPda: PublicKey,
  amountSol: number = 0.2,
  options?: FundWalletOptions,
): Promise<string> {
  // 0. Max balance check: prevent hoarding if wallet already has ample test funds
  if (options?.maxBalanceCheck !== undefined) {
    try {
      const currentLamports = await connection.getBalance(walletPda)
      const currentSol = currentLamports / LAMPORTS_PER_SOL
      if (currentSol >= options.maxBalanceCheck) {
        throw new Error(
          `Your wallet already holds ${currentSol.toFixed(3)} SOL. This is plenty of test SOL to test transfers, swaps, and 2-of-2 Vault quorums!`,
        )
      }
    } catch (balErr: any) {
      if (balErr?.message?.includes('already holds')) throw balErr
    }
  }

  // 0.1 Cooldown check: prevent rapid spam clicking
  if (options?.enforceCooldown) {
    const cooldownKey = `@haptix_faucet_cooldown_${walletPda.toBase58()}`
    const lastTimestampStr = await AsyncStorage.getItem(cooldownKey).catch(() => null)
    if (lastTimestampStr) {
      const elapsed = Date.now() - Number(lastTimestampStr)
      if (elapsed < 10_000) {
        const remaining = Math.ceil((10_000 - elapsed) / 1000)
        throw new Error(`Faucet cooldown active. Please wait ${remaining}s before requesting more Devnet SOL.`)
      }
    }
    await AsyncStorage.setItem(cooldownKey, Date.now().toString()).catch(() => {})
  }

  // 1. Try local funder keypair sponsorship first
  try {
    const payer = await getFundedDevnetPayer(connection)
    const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL))
    const available = await connection.getBalance(payer.publicKey)

    if (BigInt(available) >= lamports) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: walletPda,
          lamports,
        }),
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: 'confirmed',
      })
      return sig
    }
  } catch (funderErr: any) {
    if (funderErr?.message?.includes('already holds') || funderErr?.message?.includes('cooldown active')) {
      throw funderErr
    }
    console.warn('[Funder]: Local sponsor unavailable, falling back to cluster airdrop...', funderErr)
  }

  // 2. Fallback to cluster requestAirdrop
  try {
    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL)
    const airdropSig = await connection.requestAirdrop(walletPda, lamports)
    const latestBlockhash = await connection.getLatestBlockhash()
    await connection.confirmTransaction(
      {
        signature: airdropSig,
        ...latestBlockhash,
      },
      'confirmed',
    )
    return airdropSig
  } catch (airdropErr: any) {
    if (airdropErr?.message?.includes('already holds') || airdropErr?.message?.includes('cooldown active')) {
      throw airdropErr
    }
    throw new Error(
      `Could not fund Devnet account: ${airdropErr?.message || 'Devnet rate limit reached'}. Please request free SOL from https://faucet.solana.com/`,
    )
  }
}

export async function airdropToWalletPda(
  connection: Connection,
  walletPda: PublicKey,
  amountSol: number = 0.2,
): Promise<string> {
  return fundDevnetWallet(connection, walletPda, amountSol)
}

/**
 * Checks whether an address matches the Devnet sponsor/funder key.
 */
export function isDevnetFunder(pubkey?: PublicKey | string | null): boolean {
  if (!pubkey) return false
  const address = typeof pubkey === 'string' ? pubkey : pubkey.toBase58()
  try {
    if (cachedFunder) return cachedFunder.publicKey.toBase58() === address
    const raw = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY?.trim()
    if (!raw) return false
    const parsed = JSON.parse(raw)
    const funder = Keypair.fromSecretKey(Uint8Array.from(parsed))
    cachedFunder = funder
    return funder.publicKey.toBase58() === address
  } catch {
    return false
  }
}

/**
 * Returns the Devnet funder's public key if available in the environment,
 * allowing developers to explicitly populate the recovery guardian in dev mode.
 */
export function getDevnetFunderPublicKey(): PublicKey | null {
  try {
    if (cachedFunder) return cachedFunder.publicKey
    const raw = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY?.trim()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const funder = Keypair.fromSecretKey(Uint8Array.from(parsed))
    cachedFunder = funder
    return funder.publicKey
  } catch {
    return null
  }
}


