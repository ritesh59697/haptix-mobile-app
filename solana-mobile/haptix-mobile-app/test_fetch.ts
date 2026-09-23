import { Connection, PublicKey } from '@solana/web3.js'
import { fetchHaptixWallet } from './utils/haptix-client'
import { getDevnetRpcUrl } from './utils/rpc-endpoints'

// Read the endpoint from the shared resolver, so this probe talks to the same node as the
// app (and therefore to whatever EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL points at) instead of
// the rate-limited public endpoint. `loadEnvFile` has to run before the resolver is
// called, which is why the resolver reads `process.env` at call time rather than at import.
process.loadEnvFile('.env')

async function main() {
  const address = process.argv[2] ?? 'GS7S1Pop747oxnV5R5kHUfqfFVm1cGNHdoGEXQHnWj9Y'
  const connection = new Connection(getDevnetRpcUrl(), { commitment: 'confirmed' })
  const pda = new PublicKey(address)

  console.log('Fetching PDA:', pda.toBase58())
  console.log('Wallet state:', await fetchHaptixWallet(connection, pda))
}

main().catch(console.error)
