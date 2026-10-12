import React, { useState } from 'react'
import { ActivityIndicator, Linking } from 'react-native'
import { PublicKey } from '@solana/web3.js'
import * as Haptics from 'expo-haptics'
import { AppDropdown } from '@/components/app-dropdown'
import { useCluster } from '@/components/cluster/cluster-provider'
import { HaptixSettingsBadge, HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'
import { ClusterNetwork } from '@/components/cluster/cluster-network'
import { useAuth } from '@/components/auth/auth-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { fundDevnetWallet } from '@/utils/haptix-funder'
import { setString as copyToClipboard } from '@/utils/clipboard'

/**
 * Network section body. Rows only — the settings screen owns the card and heading.
 * Houses network selection and Devnet developer utilities (faucet airdrop & explorer).
 */
export function SettingsUiCluster() {
  const { selectedCluster, clusters, setSelectedCluster, connection, getExplorerUrl } = useCluster()
  const { activeWallet } = useAuth()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const [isRequestingFaucet, setIsRequestingFaucet] = useState(false)

  const isDevnet = selectedCluster.network === ClusterNetwork.Devnet

  const handleRequestFaucet = async () => {
    if (!activeWallet?.address) {
      dialog.alert('No Wallet', 'Please connect or create a wallet first.')
      return
    }

    try {
      setIsRequestingFaucet(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const walletPda = new PublicKey(activeWallet.address)
      const sig = await fundDevnetWallet(connection, walletPda, 0.2, {
        maxBalanceCheck: 0.5,
        enforceCooldown: true,
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      dialog.alert(
        'Airdrop Confirmed',
        `Received +0.2 Devnet SOL for testing.\n\nSignature: ${sig.slice(0, 8)}...${sig.slice(-8)}`,
      )
    } catch (err: any) {
      console.warn('Devnet airdrop failed:', err)
      const msg = err?.message || ''

      if (msg.includes('already holds')) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        dialog.alert('Test Balance Plentiful', msg, undefined, { status: 'neutral' })
        return
      }

      if (msg.includes('cooldown active')) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        dialog.alert('Faucet Cooldown Active', msg, undefined, { status: 'warning' })
        return
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      dialog.alert(
        'Devnet Faucet Unavailable',
        'The in-app sponsorship faucet is temporarily busy or rate-limited. You can request free SOL directly from the official Solana Devnet Web Faucet.',
        [
          {
            text: 'Copy Address',
            onPress: () => {
              if (activeWallet?.address) {
                copyToClipboard(activeWallet.address)
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              }
            },
          },
          {
            text: 'Open Solana Faucet',
            onPress: () => {
              if (activeWallet?.address) {
                copyToClipboard(activeWallet.address)
              }
              Linking.openURL('https://faucet.solana.com/').catch(() => {})
            },
          },
          {
            text: 'Dismiss',
            style: 'cancel',
          },
        ],
        { status: 'warning' },
      )
    } finally {
      setIsRequestingFaucet(false)
    }
  }

  return (
    <>
      <AppDropdown
        label="Cluster"
        items={clusters.map((c) => c.name)}
        selectedItem={selectedCluster.name}
        selectItem={(name) => setSelectedCluster(clusters.find((c) => c.name === name)!)}
      />
      <HaptixSettingsDivider />
      <HaptixSettingsRow
        icon="dns"
        title="RPC Endpoint"
        subtitle={selectedCluster.endpoint ? selectedCluster.endpoint.replace('https://', '') : 'Solana Devnet'}
        trailing={<HaptixSettingsBadge label="Online" tone="success" />}
      />

      {isDevnet && (
        <>
          <HaptixSettingsDivider />
          <HaptixSettingsRow
            icon="local-gas-station"
            title="Request Devnet Airdrop (+0.2 SOL)"
            subtitle={
              isRequestingFaucet ? 'Requesting funds from relayer…' : 'Fund test account with Devnet SOL'
            }
            onPress={handleRequestFaucet}
            trailing={
              isRequestingFaucet ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : undefined
            }
          />
          {activeWallet?.address && (
            <>
              <HaptixSettingsDivider />
              <HaptixSettingsRow
                icon="open-in-new"
                title="View on Solana Explorer"
                subtitle="Inspect transactions and accounts on Devnet"
                onPress={() => {
                  Haptics.selectionAsync()
                  Linking.openURL(getExplorerUrl(`address/${activeWallet.address}`))
                }}
              />
            </>
          )}
        </>
      )}
    </>
  )
}
