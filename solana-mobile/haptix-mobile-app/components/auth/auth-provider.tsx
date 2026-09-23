import { createContext, type PropsWithChildren, use, useMemo, useState, useEffect } from 'react'
import {
  HaptixWalletAccount,
  getSavedWallet,
  activateWallet,
  loadWallets,
  saveWallet,
  removeWallet,
  createSmartWalletRecord,
  setWalletLockState,
} from '@/utils/haptix-wallet-storage'
import {
  applyWalletCredentials,
  credentialIdForRecord,
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  promptBiometricAuth,
} from '@/utils/haptix-passkey'
import { clearCachedBalance, clearTxHistory } from '@/utils/haptix-tx-history'

export interface AuthState {
  isAuthenticated: boolean
  isLocked: boolean
  activeWallet: HaptixWalletAccount | null
  /** Every wallet saved on this device, for the account switcher. */
  wallets: HaptixWalletAccount[]
  switchWallet: (address: string) => Promise<boolean>
  createWallet: (name?: string) => Promise<HaptixWalletAccount>
  restoreWallet: () => Promise<HaptixWalletAccount>
  lockWallet: () => Promise<void>
  unlockWallet: () => Promise<boolean>
  updateWallet: (updated: HaptixWalletAccount) => Promise<void>
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

/**
 * Gives a wallet record the credential ids it was saved without.
 *
 * Records written before credential ids were persisted cannot be switched back to,
 * because a switch re-points the signing path from those ids. The wallet's own device
 * slots are still aimed at its keys while it is the active wallet, so that is the moment
 * the ids can be recovered without asking the user for a passkey.
 */
async function backfillCredentials(wallet: HaptixWalletAccount): Promise<HaptixWalletAccount> {
  if (wallet.primaryCredentialId && wallet.secondaryCredentialId) return wallet

  const bound = await applyWalletCredentials(wallet)
  if (bound.primary === wallet.primaryCredentialId && bound.secondary === wallet.secondaryCredentialId) {
    return wallet
  }

  const enriched: HaptixWalletAccount = {
    ...wallet,
    primaryCredentialId: bound.primary,
    secondaryCredentialId: bound.secondary,
  }
  await saveWallet(enriched)
  return enriched
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [activeWallet, setActiveWallet] = useState<HaptixWalletAccount | null>(null)
  const [wallets, setWallets] = useState<HaptixWalletAccount[]>([])
  const [isLocked, setIsLocked] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)

  // Load saved smart wallet on boot
  useEffect(() => {
    getSavedWallet()
      .then(async (saved) => {
        if (!saved) return
        // A failed backfill must not stop the wallet from loading; the record is only
        // missing an optimisation at that point.
        const wallet = await backfillCredentials(saved).catch(() => saved)
        setActiveWallet(wallet)
        setIsLocked(Boolean(wallet.isLocked))
      })
      .then(loadWallets)
      .then(setWallets)
      .finally(() => {
        setIsInitializing(false)
      })
  }, [])

  /** Keeps the switcher in step with storage after any create, restore or rename. */
  const refreshWallets = async () => {
    setWallets(await loadWallets())
  }

  const handleCreateWallet = async (name?: string): Promise<HaptixWalletAccount> => {
    // Generate device-bound Secp256r1 keys in OS secure storage
    const finalName = name || 'Personal Smart Wallet'
    const primary = await getOrCreatePrimaryPasskey(finalName)
    const secondary = await getOrCreateSecondaryPasskey(finalName)

    const created = await createSmartWalletRecord({
      name: finalName,
      primaryPasskeyHex: primary.publicKeyHex,
      secondaryPasskeyHex: secondary.publicKeyHex,
      primaryCredentialId: credentialIdForRecord(primary),
      secondaryCredentialId: credentialIdForRecord(secondary),
      primaryLabel: primary.label,
      secondaryLabel: secondary.label,
      spendThreshold: 0.1,
    })

    setActiveWallet(created)
    await refreshWallets()
    setIsLocked(false)
    return created
  }

  /**
   * Adopts this device's own passkeys as a wallet.
   *
   * Deliberately takes no address: a typed address is not evidence that this device
   * holds the keys for it, and stamping one onto these credentials is what produced
   * wallets the app could read but never sign for. Restoring by address goes through the
   * verified picker in `app/sign-in.tsx`, which proves the passkey against the keys the
   * on-chain account already holds.
   */
  const handleRestoreWallet = async (): Promise<HaptixWalletAccount> => {
    const primary = await getOrCreatePrimaryPasskey()
    const secondary = await getOrCreateSecondaryPasskey()

    const restored = await createSmartWalletRecord({
      name: 'Restored Smart Wallet',
      primaryPasskeyHex: primary.publicKeyHex,
      secondaryPasskeyHex: secondary.publicKeyHex,
      primaryCredentialId: credentialIdForRecord(primary),
      secondaryCredentialId: credentialIdForRecord(secondary),
      primaryLabel: primary.label,
      secondaryLabel: secondary.label,
      spendThreshold: 0.1,
    })

    setActiveWallet(restored)
    await refreshWallets()
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
    await refreshWallets()
  }

  /**
   * Switches the active wallet and re-points the signing credentials at it.
   *
   * Both steps matter: making a record active without moving the credential pointers
   * would leave signing on the previous wallet's keys, and every signature for the new
   * one would be rejected on-chain.
   */
  const handleSwitchWallet = async (address: string): Promise<boolean> => {
    const wallet = await activateWallet(address)
    if (!wallet) return false

    const bound = await applyWalletCredentials(wallet)

    // Activating a wallet this device cannot sign for would leave signing on the previous
    // wallet's credentials, and the failure would only appear later, mid-transaction, as a
    // rejected signature. Refusing keeps the reason next to the action that caused it --
    // and the pointer `activateWallet` already moved goes back, because boot reads it to
    // decide which wallet to open.
    if (!bound.primary && !bound.secondary) {
      if (activeWallet) await activateWallet(activeWallet.address)
      throw new Error(
        "This wallet's passkeys are not on this device. Sign in with its address to bind them, then switch again.",
      )
    }

    // The switch is also where a wallet saved without credential ids becomes
    // self-describing, using the ids just discovered in its own device slots.
    const alreadyBound =
      bound.primary === wallet.primaryCredentialId && bound.secondary === wallet.secondaryCredentialId
    const active: HaptixWalletAccount = alreadyBound
      ? wallet
      : { ...wallet, primaryCredentialId: bound.primary, secondaryCredentialId: bound.secondary }
    if (!alreadyBound) {
      await saveWallet(active)
      await refreshWallets()
    }

    setActiveWallet(active)
    setIsLocked(Boolean(wallet.isLocked))
    return true
  }

  const handleSignOut = async () => {
    // Signing out means forgetting this device, so the cached chain data goes too. The
    // history is keyed by address and would otherwise still be readable on a shared
    // device after the wallet itself had been removed.
    const address = activeWallet?.address
    if (address) {
      await Promise.all([clearTxHistory(address), clearCachedBalance(address)])
    }
    await removeWallet()
    setActiveWallet(null)
    setWallets([])
    setIsLocked(false)
  }

  const value: AuthState = useMemo(
    () => ({
      isAuthenticated: Boolean(activeWallet),
      isLocked,
      activeWallet,
      wallets,
      switchWallet: handleSwitchWallet,
      createWallet: handleCreateWallet,
      restoreWallet: handleRestoreWallet,
      lockWallet: handleLockWallet,
      unlockWallet: handleUnlockWallet,
      updateWallet: handleUpdateWallet,
      signOut: handleSignOut,
      isLoading: isInitializing,
    }),
    [activeWallet, isInitializing, isLocked, wallets],
  )

  return <Context value={value}>{children}</Context>
}
