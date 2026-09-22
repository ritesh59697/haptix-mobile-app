import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { ellipsify } from '@/utils/ellipsify'
import { AppText } from '@/components/app-text'
import { AppView } from '@/components/app-view'
import { AppConfig } from '@/constants/app-config'
import { useAuth } from '@/components/auth/auth-provider'
import { WalletUiButtonConnect } from '@/components/solana/wallet-ui-button-connect'
import { WalletUiButtonDisconnect } from '@/components/solana/wallet-ui-button-disconnect'

/**
 * The Mobile Wallet Adapter block below is a development-only tool: app auth is
 * passkey-only, so connecting an MWA wallet no longer signs you in. It stays
 * available behind `AppConfig.devMode` and the real Haptix wallet is always shown.
 */
function MobileWalletAdapterBlock() {
  const { account } = useMobileWallet()
  if (account) {
    return (
      <AppView style={{ flexDirection: 'column', justifyContent: 'flex-end' }}>
        <AppText>Connected to {ellipsify(account.address.toString(), 8)}</AppText>
        <WalletUiButtonDisconnect />
      </AppView>
    )
  }
  return (
    <AppView style={{ flexDirection: 'column', justifyContent: 'flex-end' }}>
      <AppText>Connect your wallet.</AppText>
      <WalletUiButtonConnect />
    </AppView>
  )
}

export function SettingsUiAccount() {
  const { activeWallet } = useAuth()
  return (
    <AppView>
      <AppText type="subtitle">Account</AppText>
      <AppView style={{ flexDirection: 'column', justifyContent: 'flex-end' }}>
        <AppText>
          {activeWallet ? `Passkey wallet · ${ellipsify(activeWallet.address, 8)}` : 'No wallet on this device.'}
        </AppText>
      </AppView>
      {AppConfig.devMode && <MobileWalletAdapterBlock />}
    </AppView>
  )
}
