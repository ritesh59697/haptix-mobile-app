import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { BaseButton } from '@/components/solana/base-button'
import React from 'react'

export function WalletUiButtonConnect({ label = 'Connect' }: { label?: string }) {
  const { connect } = useMobileWallet()

  // Backing out of the wallet-app association rejects this promise. It is a normal
  // outcome of a flow the user just cancelled, not an app failure, so it must not
  // surface as an unhandled rejection in the logs.
  const handlePress = () => {
    connect().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      if (!/cancell?ed/i.test(message)) {
        console.warn('[Haptix] Wallet app connection failed:', message)
      }
    })
  }

  return <BaseButton label={label} onPress={handlePress} />
}
