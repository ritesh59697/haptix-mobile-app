import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

/**
 * Pre-funded persistent relayer on Solana Devnet (4.049+ SOL balance).
 * Public key: 5oE1qrgMaVc2QQhamxAsJHxymTg2JJ4aRWCed6c1vqM6
 *
 * Used to sponsor network gas fees (5,000 lamports / 0.000005 SOL per tx)
 * and provide reliable zero-rate-limit faucet funding for smart wallet PDAs.
 */
export const DEVNET_RELAYER_SECRET = new Uint8Array([
  184, 220, 85, 40, 98, 75, 255, 188, 13, 211, 110, 48, 23, 14, 141, 18,
  246, 25, 200, 71, 159, 15, 20, 21, 233, 230, 235, 64, 180, 101, 36, 135,
  71, 70, 46, 52, 173, 218, 118, 185, 145, 139, 58, 146, 178, 169, 44, 238,
  238, 107, 216, 194, 236, 33, 191, 206, 220, 84, 134, 26, 80, 208, 218, 181,
])

/**
 * Returns the persistent funded Devnet fee payer keypair.
 * Eliminates public faucet 429 rate-limit errors entirely.
 */
export async function getFundedDevnetPayer(
  _connection?: Connection,
  _minSol: number = 0.01
): Promise<Keypair> {
  return Keypair.fromSecretKey(DEVNET_RELAYER_SECRET)
}

/**
 * Directly fund a smart wallet PDA with Devnet SOL from the relayer treasury.
 * Bypasses rate limits and delivers funds in sub-second time.
 */
export async function fundDevnetWallet(
  connection: Connection,
  walletPda: PublicKey,
  amountSol: number = 0.2
): Promise<string> {
  const payer = await getFundedDevnetPayer(connection)
  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL))
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: walletPda,
      lamports,
    })
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
  amountSol: number = 0.2
): Promise<string> {
  return fundDevnetWallet(connection, walletPda, amountSol)
}

