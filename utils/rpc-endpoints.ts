import { clusterApiUrl } from '@solana/web3.js'

/**
 * RPC endpoints, resolved on demand and shared by everything that talks to a cluster.
 *
 * Why these are functions rather than module-level constants: the Node integration
 * tests load `.env` with `process.loadEnvFile` from inside their own module body, and
 * ESM imports are evaluated *before* that body runs. A top-level `const` would be
 * captured from an environment that has not been populated yet and silently fall back
 * to the public endpoint -- the exact node we are trying to get off.
 *
 * Why a shared resolver at all: the endpoint used to be spelled out separately in the
 * settings cluster card, the wallet screen, the sign-in restore path and the test
 * suite, so they could disagree about which node they were talking to.
 *
 * The public endpoints rate limit by rolling request budget rather than by
 * concurrency -- measured against Devnet, ten parallel calls returned five HTTP 429s
 * while eight sequential calls all passed -- so a wallet that reads more than a
 * handful of accounts per launch needs a dedicated provider. Set
 * `EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL` / `EXPO_PUBLIC_HAPTIX_MAINNET_RPC_URL` in the
 * gitignored `.env` and restart Metro: Expo inlines these at bundle time, which is why
 * the `process.env.*` reads below have to stay statically analysable.
 */

export function getDevnetRpcUrl(): string {
  return process.env.EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL ?? clusterApiUrl('devnet')
}

export function getMainnetRpcUrl(): string {
  return process.env.EXPO_PUBLIC_HAPTIX_MAINNET_RPC_URL ?? clusterApiUrl('mainnet-beta')
}
