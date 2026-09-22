import { clusterApiUrl } from '@solana/web3.js'
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'

export class AppConfig {
  static name = 'Haptix Wallet'
  static uri = 'https://haptix.io'

  /**
   * Development-only escape hatches: client-side Devnet fee sponsorship and the
   * treasury-funded faucet drip.
   *
   * Anything reachable from the bundle is recoverable, so a build with this
   * enabled leaks whatever key it carries. Never enable it in a shipped build.
   */
  static readonly devMode = process.env.EXPO_PUBLIC_HAPTIX_DEV_MODE === 'true'
  static clusters: Cluster[] = [
    {
      id: 'solana:devnet',
      name: 'Devnet',
      endpoint: clusterApiUrl('devnet'),
      network: ClusterNetwork.Devnet,
    },
    {
      id: 'solana:testnet',
      name: 'Testnet',
      endpoint: clusterApiUrl('testnet'),
      network: ClusterNetwork.Testnet,
    },
  ]
}
