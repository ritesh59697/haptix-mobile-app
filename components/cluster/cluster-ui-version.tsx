import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { Cluster } from '@/components/cluster/cluster'
import { HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'

/**
 * Renders as a settings row rather than a bare `AppText` line: the template's 16px
 * sentence sat inside the app's 14/12px card rhythm and read as unstyled body copy.
 */
export function ClusterUiVersion({ selectedCluster }: { selectedCluster: Cluster }) {
  const { connection } = useMobileWallet()
  const query = useQuery({
    queryKey: ['get-version', { selectedCluster }],
    queryFn: () =>
      connection.getVersion().then((version) => {
        return {
          core: version['solana-core'],
          features: version['feature-set'],
        }
      }),
  })

  return (
    <HaptixSettingsRow
      icon="dns"
      title={query.isLoading ? 'Reading RPC version…' : String(query.data?.core ?? 'Unknown')}
      subtitle={
        query.isLoading ? 'Querying the selected cluster' : `RPC node · feature set ${query.data?.features ?? '—'}`
      }
    />
  )
}
