import { useEffect, useState } from 'react'
import type { Connection, Keypair } from '@solana/web3.js'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'

/**
 * The guardian keypair, but only when this device actually holds it.
 *
 * A release build cannot sign as a guardian at all, so this resolves to `null` rather
 * than handing back the fee payer and letting a transaction fail on-chain. Both the
 * panic freeze and the guardian-started recovery need the same answer, which is why
 * this is one hook instead of the same effect copied into two screens.
 *
 * On Devnet this returns a key for wallets whose guardian is the bundled funder key --
 * which is every wallet created with dev mode on. Pointing a wallet's guardian
 * elsewhere is what makes it `null`, and that is the intended state, not a failure.
 */
export function useGuardianSigner(connection: Connection, guardianAddress: string | null): Keypair | null {
  const [guardianSigner, setGuardianSigner] = useState<Keypair | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const payer = await getFundedDevnetPayer(connection).catch(() => null)
      if (cancelled) return
      setGuardianSigner(payer && guardianAddress && payer.publicKey.toBase58() === guardianAddress ? payer : null)
    })()
    return () => {
      cancelled = true
    }
  }, [connection, guardianAddress])

  return guardianSigner
}
