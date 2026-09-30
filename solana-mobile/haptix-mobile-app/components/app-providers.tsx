import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PropsWithChildren } from 'react'
import { AuthProvider } from '@/components/auth/auth-provider'
import { ClusterProvider } from '@/components/cluster/cluster-provider'
import { AppTheme } from '@/components/app-theme'
import { HaptixDialogProvider } from '@/components/haptix/haptix-dialog'
import { RemoveWalletModalProvider } from '@/components/haptix/haptix-remove-wallet'

const queryClient = new QueryClient()
/**
 * There is deliberately no Mobile Wallet Adapter provider here.
 *
 * `@wallet-ui/react-native-web3js` evaluates
 * `TurboModuleRegistry.getEnforcing('SolanaMobileWalletAdapter')` as a side effect of
 * being imported, which throws in Expo Go and in any build that does not link the MWA
 * native module — before the first render, so the app shows a blank screen rather than
 * an error. Haptix authenticates with passkeys and talks to the chain through
 * `ClusterProvider`'s connection, so nothing here needs a wallet adapter.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AppTheme>
      <HaptixDialogProvider>
        <RemoveWalletModalProvider>
          <QueryClientProvider client={queryClient}>
            <ClusterProvider>
              <AuthProvider>{children}</AuthProvider>
            </ClusterProvider>
          </QueryClientProvider>
        </RemoveWalletModalProvider>
      </HaptixDialogProvider>
    </AppTheme>
  )
}
