import { createContext, type PropsWithChildren, use, useMemo, useState, useEffect } from 'react'
import { SignInOutput, useMobileWallet } from '@wallet-ui/react-native-web3js'
import { AppConfig } from '@/constants/app-config'
import { useMutation } from '@tanstack/react-query'
import {
  HaptixWalletAccount,
  getSavedWallet,
  saveWallet,
  removeWallet,
  createSmartWalletRecord,
  setWalletLockState,
} from '@/utils/haptix-wallet-storage'
import {
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  promptBiometricAuth,
} from '@/utils/haptix-passkey'

export interface AuthState {
  isAuthenticated: boolean
  isLocked: boolean
  activeWallet: HaptixWalletAccount | null
  createWallet: (name?: string) => Promise<HaptixWalletAccount>
  restoreWallet: (customAddress?: string) => Promise<HaptixWalletAccount>
  lockWallet: () => Promise<void>
  unlockWallet: () => Promise<boolean>
  updateWallet: (updated: HaptixWalletAccount) => Promise<void>
  signIn: () => Promise<SignInOutput | void>
  signOut: () => Promise<void>
  isLoading: boolean
}

const Context = createContext<AuthState>({} as AuthState)

export function useAuth() {
  const value = use(Context)
  if (!value) {
    throw new Error('useAuth must be wrapped in a <AuthProvider />')
  }
  return value
}

function useSignInMutation() {
  const { signIn } = useMobileWallet()

  return useMutation({
    mutationFn: async () =>
      await signIn({
        uri: AppConfig.uri,
      }),
  })
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { accounts, disconnect } = useMobileWallet()
  const signInMutation = useSignInMutation()
  const [activeWallet, setActiveWallet] = useState<HaptixWalletAccount | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)

  // Load saved smart wallet on boot
  useEffect(() => {
    getSavedWallet()
      .then((saved) => {
        if (saved) {
          setActiveWallet(saved)
          setIsLocked(Boolean(saved.isLocked))
        }
      })
      .finally(() => {
        setIsInitializing(false)
      })
  }, [])

  const handleCreateWallet = async (name?: string): Promise<HaptixWalletAccount> => {
    // Generate authentic Secp256r1 passkeys in device hardware enclave
    const finalName = name || 'Personal Smart Wallet'
    const primary = await getOrCreatePrimaryPasskey(finalName)
    const secondary = await getOrCreateSecondaryPasskey(finalName)

    const created = await createSmartWalletRecord({
      name: finalName,
      primaryPasskeyHex: primary.publicKeyHex,
      secondaryPasskeyHex: secondary.publicKeyHex,
      primaryLabel: primary.label,
      secondaryLabel: secondary.label,
      spendThreshold: 0.1,
    })

    setActiveWallet(created)
    setIsLocked(false)
    return created
  }

  const handleRestoreWallet = async (customAddress?: string): Promise<HaptixWalletAccount> => {
    const primary = await getOrCreatePrimaryPasskey()
    const secondary = await getOrCreateSecondaryPasskey()

    const restored = await createSmartWalletRecord({
      name: 'Restored Smart Wallet',
      primaryPasskeyHex: primary.publicKeyHex,
      secondaryPasskeyHex: secondary.publicKeyHex,
      primaryLabel: primary.label,
      secondaryLabel: secondary.label,
      spendThreshold: 0.1,
    })

    if (customAddress) {
      restored.address = customAddress
      await saveWallet(restored)
    }

    setActiveWallet(restored)
    setIsLocked(false)
    return restored
  }

  const handleLockWallet = async () => {
    setIsLocked(true)
    await setWalletLockState(true)
  }

  const handleUnlockWallet = async (): Promise<boolean> => {
    const auth = await promptBiometricAuth('Unlock Haptix Smart Wallet')
    if (auth.success) {
      setIsLocked(false)
      await setWalletLockState(false)
      return true
    }
    return false
  }

  const handleUpdateWallet = async (updated: HaptixWalletAccount) => {
    await saveWallet(updated)
    setActiveWallet(updated)
  }

  const handleSignOut = async () => {
    await removeWallet()
    setActiveWallet(null)
    setIsLocked(false)
    await disconnect()
  }

  const value: AuthState = useMemo(
    () => ({
      isAuthenticated: Boolean(activeWallet || (accounts?.length ?? 0) > 0),
      isLocked,
      activeWallet,
      createWallet: handleCreateWallet,
      restoreWallet: handleRestoreWallet,
      lockWallet: handleLockWallet,
      unlockWallet: handleUnlockWallet,
      updateWallet: handleUpdateWallet,
      signIn: async () => {
        try {
          return await signInMutation.mutateAsync()
        } catch (e) {
          console.warn('MWA SignIn failed:', e)
          throw e
        }
      },
      signOut: handleSignOut,
      isLoading: signInMutation.isPending || isInitializing,
    }),
    [accounts, activeWallet, isInitializing, isLocked, signInMutation]
  )

  return <Context value={value}>{children}</Context>
}
