import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

/**
 * Sends a direct JSON-RPC airdrop request via fetch with timeout,
 * avoiding @solana/web3.js RpcClient's noisy automatic 429 retry loops.
 */
async function directAirdropRequest(
  pubkey: PublicKey,
  lamports: number,
  timeoutMs: number = 4000
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('https://api.devnet.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'requestAirdrop',
        params: [pubkey.toBase58(), lamports],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      // e.g. 429 Too Many Requests
      return null
    }

    const data = await res.json()
    if (data.error) {
      return null
    }
    return data.result || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Attempts to obtain an ephemeral Devnet fee payer keypair.
 * If Devnet faucet is rate-limited (HTTP 429), returns null instead of hanging or spamming errors.
 */
export async function getFundedDevnetPayer(
  connection: Connection,
  minSol: number = 0.05
): Promise<Keypair | null> {
  const payer = Keypair.generate()
  const minLamports = Math.round(minSol * LAMPORTS_PER_SOL)

  const sig = await directAirdropRequest(payer.publicKey, minLamports, 3500)
  if (!sig) {
    // Devnet faucet rate limit reached; gracefully return null
    return null
  }

  try {
    const latest = await connection.getLatestBlockhash('confirmed')
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      'confirmed'
    )
    return payer
  } catch {
    return null
  }
}

/**
 * Requests a Devnet airdrop directly for a Haptix Wallet PDA without noisy 429 logs.
 */
export async function airdropToWalletPda(
  connection: Connection,
  walletPda: PublicKey,
  amountSol: number = 0.25
): Promise<string> {
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL)
  const sig = await directAirdropRequest(walletPda, lamports, 5000)

  if (!sig) {
    throw new Error('Solana Devnet faucet rate-limit reached. Please retry in a few moments.')
  }

  try {
    const latest = await connection.getLatestBlockhash('confirmed')
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      'confirmed'
    )
  } catch {
    // Return signature even if confirmation times out
  }

  return sig
}
