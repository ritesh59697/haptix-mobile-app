import { useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAuth } from '@/components/auth/auth-provider'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixSettingsBadge, HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'
import { ellipsify } from '@/utils/ellipsify'

/**
 * Every wallet saved on this device, with the active one marked.
 *
 * Wallets used to share a single storage slot, so the second wallet a device created
 * silently evicted the first: its address, its passkey metadata and its balance all became
 * unreachable from the app while the account itself sat untouched on-chain. The list makes
 * that state visible and switchable.
 *
 * Rows only — the card and the "Wallets" heading belong to the settings screen so every
 * section keeps one geometry.
 */
export function SettingsUiWallets() {
  const { activeWallet, wallets, switchWallet } = useAuth()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  const handleSwitch = async (address: string) => {
    if (address === activeWallet?.address || switchingTo) return
    setSwitchingTo(address)
    try {
      const switched = await switchWallet(address)
      if (!switched) {
        dialog.alert('Wallet Not Found', 'That wallet is no longer saved on this device.', undefined, {
          status: 'error',
        })
      }
    } catch (err) {
      dialog.alert('Could Not Switch Wallet', err instanceof Error ? err.message : 'Please try again.', undefined, {
        status: 'error',
      })
    } finally {
      setSwitchingTo(null)
    }
  }

  return (
    <>
      {wallets.map((wallet, index) => {
        const isActive = wallet.address === activeWallet?.address
        const isSwitching = switchingTo === wallet.address

        return (
          <View key={wallet.address}>
            {index > 0 ? <HaptixSettingsDivider /> : null}
            <HaptixSettingsRow
              icon={isActive ? 'account-balance-wallet' : 'account-balance'}
              title={wallet.name}
              subtitle={ellipsify(wallet.address, 8)}
              onPress={() => handleSwitch(wallet.address)}
              accessibilityLabel={`Switch to ${wallet.name}`}
              accessibilityHint={isActive ? 'This wallet is already active' : 'Makes this the active wallet'}
              trailing={
                isActive ? (
                  <HaptixSettingsBadge label="Active" tone="success" />
                ) : isSwitching ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
                )
              }
            />
          </View>
        )
      })}
    </>
  )
}
