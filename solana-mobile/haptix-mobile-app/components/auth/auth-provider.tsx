import { createContext, type PropsWithChildren, use, useMemo, useState, useEffect } from 'react'
import {
  HaptixWalletAccount,
  getSavedWallet,
  activateWallet,
  loadWallets,
  saveWallet,
  removeWallet,
  removeWalletByAddress,
  createSmartWalletRecord,
  setWalletLockState,
} from '@/utils/haptix-wallet-storage'
import {
  applyWalletCredentials,
  bindHardwarePasskey,
  credentialIdForRecord,
  getOrCreatePrimaryPasskey,
  getOrCreateSecondaryPasskey,
  hexToBytes,
  PasskeyInfo,
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
  createWallet: (
    name?: string,
    options?: {
      mode?: 'everyday' | 'vault'
      spendThreshold?: number
      primaryLabel?: string
      secondaryLabel?: string
      guardianAddress?: string
      vaultKeySource?: 'mac' | 'hardware'
      macVaultKeyHex?: string
    },
  ) => Promise<HaptixWalletAccount>
  restoreWallet: () => Promise<HaptixWalletAccount>
  lockWallet: () => Promise<void>
  unlockWallet: () => Promise<boolean>
  updateWallet: (updated: HaptixWalletAccount) => Promise<void>
  removeAccount: (address: string) => Promise<void>
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
    let mounted = true
    async function boot() {
      try {
        const saved = await getSavedWallet()
        if (saved && mounted) {
          const wallet = await backfillCredentials(saved).catch(() => saved)
          setActiveWallet(wallet)
          setIsLocked(Boolean(wallet.isLocked))
        }
        if (mounted) {
          const all = await loadWallets().catch(() => [])
          setWallets(all)
        }
      } catch (err) {
        console.error('[AuthProvider] Boot error:', err)
      } finally {
        if (mounted) {
          setIsInitializing(false)
        }
      }
    }
    boot()
    return () => {
      mounted = false
    }
  }, [])

  /** Keeps the switcher in step with storage after any create, restore or rename. */
  const refreshWallets = async () => {
    setWallets(await loadWallets())
  }

  const handleCreateWallet = async (
    name?: string,
    options?: {
      mode?: 'everyday' | 'vault'
      spendThreshold?: number
      primaryLabel?: string
      secondaryLabel?: string
      guardianAddress?: string
      vaultKeySource?: 'mac' | 'hardware'
      macVaultKeyHex?: string
    },
  ): Promise<HaptixWalletAccount> => {
    const isFirstWallet = wallets.length === 0
    const finalName = name?.trim() || `Account ${wallets.length + 1}`
    const mode = options?.mode || 'everyday'
    const forceNew = !isFirstWallet

    // 1. Generate Primary Passkey
    const primary = await getOrCreatePrimaryPasskey(finalName, { forceNew })

    // 2. Generate Secondary Passkey (Mac Touch ID vs Security Key vs Platform)
    let secondary: PasskeyInfo
    if (mode === 'vault' && options?.vaultKeySource === 'mac') {
      const cleanHex = options.macVaultKeyHex?.trim().startsWith('0x')
        ? options.macVaultKeyHex.trim().slice(2)
        : options.macVaultKeyHex?.trim() || ''
      if (!cleanHex || cleanHex.length !== 66 || (!cleanHex.startsWith('02') && !cleanHex.startsWith('03'))) {
        throw new Error('Please enter a valid 33-byte Mac Touch ID public key hex (starts with 02 or 03).')
      }
      secondary = {
        id: 'secondary',
        credentialId: 'mac_vault_' + cleanHex.slice(0, 16),
        publicKey: hexToBytes(cleanHex),
        publicKeyHex: cleanHex,
        label: options?.secondaryLabel || 'Mac Touch ID (Vault Key)',
        hasBiometrics: true,
        mode: 'hardware',
        hardwareBacked: true,
      }
      await bindHardwarePasskey('secondary', secondary.credentialId, secondary.publicKeyHex)
    } else {
      secondary = await getOrCreateSecondaryPasskey(finalName, {
        forceNew,
        attachment: mode === 'vault' ? 'securityKey' : 'platform',
      })
    }

    const threshold =
      options?.spendThreshold !== undefined
        ? options.spendThreshold
        : mode === 'vault'
          ? 0.0
          : 0.1

    const created = await createSmartWalletRecord({
      name: finalName,
      primaryPasskeyHex: primary.publicKeyHex,
      secondaryPasskeyHex: secondary.publicKeyHex,
      primaryCredentialId: credentialIdForRecord(primary),
      secondaryCredentialId: credentialIdForRecord(secondary),
      primaryLabel: options?.primaryLabel || primary.label,
      secondaryLabel: options?.secondaryLabel || secondary.label,
      guardianAddress: options?.guardianAddress,
      spendThreshold: threshold,
      securityMode: mode,
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

  const handleRemoveAccount = async (address: string) => {
    await Promise.all([clearTxHistory(address), clearCachedBalance(address)])
    const nextWallet = await removeWalletByAddress(address)
    if (nextWallet) {
      await handleSwitchWallet(nextWallet.address)
    } else {
      setActiveWallet(null)
      setIsLocked(false)
    }
    await refreshWallets()
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
      removeAccount: handleRemoveAccount,
      signOut: handleSignOut,
      isLoading: isInitializing,
    }),
    [activeWallet, isInitializing, isLocked, wallets],
  )

  return <Context value={value}>{children}</Context>
}
