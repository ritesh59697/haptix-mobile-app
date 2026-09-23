import { AppDropdown } from '@/components/app-dropdown'
import { useCluster } from '@/components/cluster/cluster-provider'
import { ClusterUiVersion } from '@/components/cluster/cluster-ui-version'
import { ClusterUiGenesisHash } from '@/components/cluster/cluster-ui-genesis-hash'
import { HaptixSettingsDivider } from '@/components/haptix/haptix-settings-ui'

/**
 * Network section body. Rows only — the settings screen owns the card and heading.
 */
export function SettingsUiCluster() {
  const { selectedCluster, clusters, setSelectedCluster } = useCluster()

  return (
    <>
      <ClusterUiVersion selectedCluster={selectedCluster} />
      <HaptixSettingsDivider />
      <ClusterUiGenesisHash selectedCluster={selectedCluster} />
      <HaptixSettingsDivider />
      <AppDropdown
        label="Cluster"
        items={clusters.map((c) => c.name)}
        selectedItem={selectedCluster.name}
        selectItem={(name) => setSelectedCluster(clusters.find((c) => c.name === name)!)}
      />
    </>
  )
}
