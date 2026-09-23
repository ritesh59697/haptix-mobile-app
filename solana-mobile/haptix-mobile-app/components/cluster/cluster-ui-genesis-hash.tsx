import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCluster } from '@/components/cluster/cluster-provider'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { ellipsify } from '@/utils/ellipsify'
import { setString as copyToClipboard } from '@/utils/clipboard'
import { Cluster } from '@/components/cluster/cluster'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'

/**
 * Restyled to a settings row, and made tappable: the template printed an
 * ellipsified hash that could never be read back in full or used anywhere.
 */
export function ClusterUiGenesisHash({ selectedCluster }: { selectedCluster: Cluster }) {
  const { connection } = useCluster()
  const { theme } = useAppTheme()
  const [hasCopied, setHasCopied] = useState(false)
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useQuery({
    queryKey: ['get-genesis-hash', { selectedCluster }],
    queryFn: () => connection.getGenesisHash(),
  })

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    }
  }, [])

  const handleCopy = async () => {
    if (!query.data) return
    await copyToClipboard(query.data)
    setHasCopied(true)
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    copyResetTimer.current = setTimeout(() => setHasCopied(false), 1600)
  }

  return (
    <HaptixSettingsRow
      icon="tag"
      title={query.isLoading ? 'Reading genesis hash…' : ellipsify(query.data ?? '', 8)}
      subtitle={hasCopied ? 'Copied to clipboard' : 'Genesis hash · tap to copy'}
      onPress={query.data ? handleCopy : undefined}
      disabled={!query.data}
      accessibilityLabel="Copy genesis hash"
      trailing={hasCopied ? null : <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />}
    />
  )
}
