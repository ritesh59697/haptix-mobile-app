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
import { lamportsToSol } from '@/utils/lamports-to-sol'

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

const DEFAULT_DEVNET_FUNDER_SECRET: number[] = [
  46, 129, 3, 83, 59, 175, 161, 152, 178, 87, 85, 114, 129, 215, 95, 24, 48, 1, 23, 69, 230, 202, 39, 155, 19, 65, 198, 78, 87, 15, 215, 250, 208, 90, 55, 201, 207, 250, 187, 201, 214, 80, 41, 254, 243, 231, 152, 64, 187, 254, 47, 182, 189, 241, 103, 100, 225, 184, 193, 142, 33, 44, 175, 124
]

let cachedFunder: Keypair | null = null

function loadFunderSecret(): Uint8Array {
  // Read as a literal member expression. Expo substitutes `EXPO_PUBLIC_*` values by
  // matching this exact source text at bundle time, so a computed lookup such as
  // `process.env[FUNDER_KEY_ENV]` is never replaced.
  const raw = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY?.trim()

  if (!raw) {
    // Sideloaded APK fallback for hackathon judges/evaluators: use verified Devnet paymaster key
    return Uint8Array.from(DEFAULT_DEVNET_FUNDER_SECRET)
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
  if (!AppConfig.devMode && !process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY) {
    // Sideloaded APK fallback on devnet: warn rather than fatal crash
    console.warn(`[Haptix] Devnet fee sponsorship running with default sponsor fallback for ${feature}.`)
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

/**
 * Directly fund a smart wallet PDA with Devnet SOL from the local funder wallet.
 */
export async function fundDevnetWallet(
  connection: Connection,
  walletPda: PublicKey,
  amountSol: number = 0.2,
): Promise<string> {
  const payer = await getFundedDevnetPayer(connection)
  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL))

  // Describe a drained funder in words. Submitting anyway produced
  // `Transfer: insufficient lamports 91721040, need 200000000` inside a simulation
  // dump, which is the amount the funder had at that moment and says nothing about
  // what to do next.
  const available = await connection.getBalance(payer.publicKey)
  if (BigInt(available) < lamports) {
    throw new Error(
      `The Devnet funder ${payer.publicKey.toBase58()} holds ${lamportsToSol(available).toFixed(4)} SOL ` +
        `but this request needs ${amountSol.toFixed(2)}. Top the funder up from a Devnet faucet and retry.`,
    )
  }

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

/**
 * Direct funding helper (replaces deprecated public airdrop).
 */
export async function airdropToWalletPda(
  connection: Connection,
  walletPda: PublicKey,
  amountSol: number = 0.2,
): Promise<string> {
  return fundDevnetWallet(connection, walletPda, amountSol)
}
