import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { ellipsify } from '@/utils/ellipsify'
import { setString as copyToClipboard } from '@/utils/clipboard'
import { useAuth } from '@/components/auth/auth-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { HaptixSettingsBadge, HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'

/**
 * Account section body. Renders rows only — the card and the "Account" heading are
 * owned by the settings screen so every section shares one geometry.
 */
export function SettingsUiAccount() {
  const router = useRouter()
  const { activeWallet } = useAuth()
  const { theme } = useAppTheme()
  const [hasCopied, setHasCopied] = useState(false)
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The "Copied!" pill has to fall back to the chevron on its own; a timer that is
  // never cleared leaks on unmount and flips state on an unmounted screen.
  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    }
  }, [])

  if (!activeWallet) {
    return (
      <HaptixSettingsRow
        icon="account-balance-wallet"
        title="No wallet on this device"
        subtitle="Create or restore a wallet to manage its keys and policy."
      />
    )
  }

  const handleCopyAddress = async () => {
    await copyToClipboard(activeWallet.address)
    setHasCopied(true)
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    copyResetTimer.current = setTimeout(() => setHasCopied(false), 1600)
  }

  return (
    <>
      <HaptixSettingsRow
        icon="account-balance-wallet"
        title={activeWallet.name}
        subtitle="Passkey smart wallet"
        trailing={
          <HaptixSettingsBadge
            label={activeWallet.isInitializedOnChain ? 'On-chain' : 'Not funded'}
            tone={activeWallet.isInitializedOnChain ? 'success' : 'muted'}
          />
        }
      />

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon="content-copy"
        title={ellipsify(activeWallet.address, 8)}
        subtitle={hasCopied ? 'Copied to clipboard' : 'Tap to copy the full address'}
        onPress={handleCopyAddress}
        accessibilityLabel="Copy wallet address"
        trailing={hasCopied ? null : <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />}
      />

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon={activeWallet.securityMode === 'vault' ? 'devices' : 'fingerprint'}
        title={activeWallet.securityMode === 'vault' ? 'Dual-Device Vault' : 'Both passkeys'}
        subtitle={
          activeWallet.securityMode === 'vault'
            ? 'Primary key on this phone. Vault key held on your secondary device or hardware key.'
            : "Two keys held in this device's secure chip. Above your limit, both are required."
        }
        trailing={
          <HaptixSettingsBadge
            label={activeWallet.securityMode === 'vault' ? 'Vault' : 'Local'}
            tone={activeWallet.securityMode === 'vault' ? 'accent' : 'muted'}
          />
        }
      />

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon="speed"
        title={`One-key limit ≤ ${activeWallet.spendThreshold} SOL`}
        subtitle={
          activeWallet.securityMode === 'vault'
            ? 'Tap to adjust. High-value sends require your secondary device or hardware key.'
            : 'Tap to adjust. Sends above this require both your primary and backup keys.'
        }
        onPress={() => {
          Haptics.selectionAsync()
          router.push('/(tabs)/settings/limits')
        }}
        trailing={<MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />}
      />
    </>
  )
}
