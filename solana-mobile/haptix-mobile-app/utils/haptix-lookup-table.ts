import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

// Permanent Address Lookup Table on Solana Devnet for Haptix
export const HAPTIX_DEVNET_ALT_ADDRESS = new PublicKey('ybupBjKzUPENMi55yWMNKEL6ng3qtgx9pX4UztcsCws')

let cachedAltAccount: AddressLookupTableAccount | null = null

/**
 * Returns the Haptix Address Lookup Table for Devnet.
 * Automatically adds walletPda to the table if it is not yet present,
 * ensuring high-risk transactions with 2 hardware passkeys stay safely
 * under Solana's 1232-byte MTU limit.
 */
export async function getHaptixAddressLookupTable(
  connection: Connection,
  walletPda?: PublicKey,
  payer?: Keypair,
): Promise<AddressLookupTableAccount | null> {
  try {
    const res = await connection.getAddressLookupTable(HAPTIX_DEVNET_ALT_ADDRESS)
    let alt = res.value
    if (!alt) return null

    if (walletPda && payer) {
      const alreadyInTable = alt.state.addresses.some((a) => a.equals(walletPda))
      if (!alreadyInTable) {
        try {
          const extendIx = AddressLookupTableProgram.extendLookupTable({
            payer: payer.publicKey,
            authority: payer.publicKey,
            lookupTable: HAPTIX_DEVNET_ALT_ADDRESS,
            addresses: [walletPda],
          })
          const tx = new Transaction().add(extendIx)
          await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })
          const updated = await connection.getAddressLookupTable(HAPTIX_DEVNET_ALT_ADDRESS)
          if (updated.value) {
            alt = updated.value
          }
        } catch (extendErr) {
          console.warn('[Haptix ALT] Could not extend lookup table with walletPda:', extendErr)
        }
      }
    }

    cachedAltAccount = alt
    return alt
  } catch (err) {
    console.warn('[Haptix ALT] Failed to fetch Address Lookup Table:', err)
    return cachedAltAccount
  }
}

/**
 * Builds and signs a transaction, compiling to V0 using Address Lookup Table
 * if available so 2-passkey hardware quorum transactions never exceed Solana's 1232-byte MTU.
 */
export function buildOptimalTransaction({
  payer,
  recentBlockhash,
  instructions,
  lookupTable,
}: {
  payer: Keypair
  recentBlockhash: string
  instructions: TransactionInstruction[]
  lookupTable?: AddressLookupTableAccount | null
}): { rawTx: Uint8Array; isV0: boolean } {
  if (lookupTable) {
    const v0Msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash,
      instructions,
    }).compileToV0Message([lookupTable])
    const v0Tx = new VersionedTransaction(v0Msg)
    v0Tx.sign([payer])
    return { rawTx: v0Tx.serialize(), isV0: true }
  }

  const legacyTx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash,
  }).add(...instructions)
  legacyTx.sign(payer)
  return { rawTx: legacyTx.serialize(), isV0: false }
}
