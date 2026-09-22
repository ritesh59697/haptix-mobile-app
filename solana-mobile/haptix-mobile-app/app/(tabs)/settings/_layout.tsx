import { WalletUiDropdown } from '@/components/solana/wallet-ui-dropdown'
import { AppConfig } from '@/constants/app-config'
import { Stack } from 'expo-router'
import React from 'react'

export default function SettingsLayout() {
  // `WalletUiDropdown` drives the Mobile Wallet Adapter. App auth is passkey-only,
  // so connecting an MWA wallet no longer signs you in; keep the control for
  // development builds only.
  return (
    <Stack
      screenOptions={{
        headerTitle: 'Settings',
        headerRight: AppConfig.devMode ? () => <WalletUiDropdown /> : undefined,
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  )
}
