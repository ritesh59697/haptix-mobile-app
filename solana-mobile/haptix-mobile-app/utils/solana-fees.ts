import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'

/**
 * Network fee for a SOL transfer, priced by the cluster instead of by a literal.
 *
 * The send sheet used to print `0.000005 SOL` and sum the same number into "Total
 * outflow". That happens to be the base fee (5_000 lamports per required signature),
 * which is why it looked right -- but it was a constant that could not notice a fee
 * schedule change, and it was duplicated in four places.
 *
 * `getFeeForMessage` is the same call the runtime's fee calculator backs, so the sheet
 * now shows what the cluster would actually charge for the exact message being built.
 * Two honest limitations, both deliberate:
 * - Priority fees are not included, because this wallet sets no `SetComputeUnitPrice`
 *   instruction, so the priority component is zero. Adding the estimate here without
 *   adding the instruction would overstate the cost.
 * - A wallet still has to work while the RPC is unreachable, so a failed lookup falls
 *   back to the base fee rather than to zero or to an error the user cannot act on.
 */

/** Base fee: 5_000 lamports per required transaction signature. */
export const LAMPORTS_PER_SIGNATURE = 5_000

/** Used when the cluster cannot be reached; the fee schedule has never been lower. */
export const FALLBACK_TRANSFER_FEE_LAMPORTS = LAMPORTS_PER_SIGNATURE

export interface TransferFeeEstimate {
  lamports: number
  sol: number
  /** `rpc` when the cluster answered, `fallback` when it did not. */
  source: 'rpc' | 'fallback'
}

export interface TransferFeeRequest {
  /** Fee payer. Identity does not change the fee, but it has to be a real pubkey. */
  feePayer: PublicKey
  /** Destination. Only its presence in the message matters for pricing. */
  destination: PublicKey
  lamports: bigint
  /** Additional required signers, if the transaction carries any. */
  extraSignatures?: number
}

function fallbackEstimate(extraSignatures: number): TransferFeeEstimate {
  const lamports = FALLBACK_TRANSFER_FEE_LAMPORTS * (1 + Math.max(0, extraSignatures))
  return { lamports, sol: lamports / LAMPORTS_PER_SOL, source: 'fallback' }
}

/**
 * Prices a `SystemProgram.transfer` of `lamports` between the two keys. Resolves to a
 * usable number in every case: an unreachable RPC degrades to the base fee.
 */
export async function estimateTransferFee(
  connection: Connection,
  request: TransferFeeRequest,
): Promise<TransferFeeEstimate> {
  const extraSignatures = request.extraSignatures ?? 0
  try {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: request.feePayer,
        toPubkey: request.destination,
        lamports: request.lamports,
      }),
    )
    transaction.feePayer = request.feePayer
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    transaction.recentBlockhash = blockhash

    const response = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')
    if (typeof response?.value === 'number' && Number.isFinite(response.value)) {
      const lamports = response.value + LAMPORTS_PER_SIGNATURE * extraSignatures
      return { lamports, sol: lamports / LAMPORTS_PER_SOL, source: 'rpc' }
    }
    return fallbackEstimate(extraSignatures)
  } catch (err) {
    console.warn('[Haptix Fees] Falling back to the base fee for the transfer estimate', err)
    return fallbackEstimate(extraSignatures)
  }
}
