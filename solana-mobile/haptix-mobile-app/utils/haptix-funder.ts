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

let cachedFunder: Keypair | null = null

function loadFunderSecret(): Uint8Array {
  // Read as a literal member expression. Expo substitutes `EXPO_PUBLIC_*` values by
  // matching this exact source text at bundle time, so a computed lookup such as
  // `process.env[FUNDER_KEY_ENV]` is never replaced. Nothing catches that in
  // development, because the Metro dev server also populates a real `process.env` from
  // `.env`; a release build has no runtime `process.env` at all, so the computed form
  // silently read `undefined` and only the shipped APK reported the key as unset.
  const raw = process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY?.trim()

  if (!raw) {
    throw new Error(
      `Devnet fee sponsorship is not configured. Set ${FUNDER_KEY_ENV} in ` +
        'solana-mobile/haptix-mobile-app/.env (gitignored) to the JSON byte array held in ' +
        'your funder keypair file, for example the contents of ' +
        '~/.config/solana/haptix-funder.json. See .env.example.',
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
    throw new Error(
      `${feature} is a development-only feature and is disabled in this build. ` +
        'Set EXPO_PUBLIC_HAPTIX_DEV_MODE=true in a gitignored .env for local Devnet demos.',
    )
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
