import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { ellipsify } from '@/utils/ellipsify'
import { setString as copyToClipboard } from '@/utils/clipboard'
import { AppConfig } from '@/constants/app-config'
import { useAuth } from '@/components/auth/auth-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { WalletUiButtonConnect } from '@/components/solana/wallet-ui-button-connect'
import { WalletUiButtonDisconnect } from '@/components/solana/wallet-ui-button-disconnect'
import { HaptixSettingsBadge, HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'
import { radius, typeScale } from '@/theme/tokens'

/**
 * The Mobile Wallet Adapter block below is a development-only tool: app auth is
 * passkey-only, so connecting an MWA wallet no longer signs you in. It stays
 * available behind `AppConfig.devMode` and the real Haptix wallet is always shown.
 */
function MobileWalletAdapterBlock() {
  const { account } = useMobileWallet()
  const { theme } = useAppTheme()

  return (
    <View style={[styles.devBlock, { borderColor: theme.borderSubtle, backgroundColor: theme.bgElevated }]}>
      <View style={styles.devHeader}>
        <MaterialIcons name="build" size={13} color={theme.textMuted} />
        <Text style={[styles.devLabel, { color: theme.textMuted }]}>Mobile Wallet Adapter · dev only</Text>
      </View>
      <Text style={[styles.devValue, { color: theme.textSecondary }]}>
        {account ? `Connected to ${ellipsify(account.address.toString(), 8)}` : 'No external wallet connected.'}
      </Text>
      <View style={styles.devActions}>{account ? <WalletUiButtonDisconnect /> : <WalletUiButtonConnect />}</View>
    </View>
  )
}

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

      {AppConfig.devMode && (
        <>
          <HaptixSettingsDivider />
          <MobileWalletAdapterBlock />
        </>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  devBlock: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 6,
  },
  devHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  devLabel: {
    fontSize: typeScale.caption,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  devValue: {
    fontSize: typeScale.footnote,
    lineHeight: 16,
  },
  devActions: {
    flexDirection: 'row',
    marginTop: 2,
  },
})
