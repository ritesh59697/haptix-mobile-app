import { ClusterNetwork } from '@/components/cluster/cluster-network'

/**
 * Wallet-standard cluster identifier, e.g. `solana:devnet`.
 *
 * Declared locally instead of imported from `@wallet-ui/react-native-web3js`: that
 * package's native entry evaluates
 * `TurboModuleRegistry.getEnforcing('SolanaMobileWalletAdapter')` at import time, which
 * throws in Expo Go and in any build without the Mobile Wallet Adapter native module,
 * killing the JS bundle before the first render (a white screen with no error box).
 */
export type SolanaClusterId = `solana:${string}`

export interface Cluster {
  id: SolanaClusterId
  name: string
  endpoint: string
  network: ClusterNetwork
  active?: boolean
}
