import { useEffect, useRef, useState } from 'react'
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
        icon="fingerprint"
        title="2-of-2 passkey quorum"
        subtitle="Two device-bound keys in the OS secure enclave. Both are required above the fast-lane limit."
      />

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon="speed"
        title={`Fast lane ≤ ${activeWallet.spendThreshold} SOL`}
        subtitle="Trades at or below this run without a second passkey prompt."
      />
    </>
  )
}
