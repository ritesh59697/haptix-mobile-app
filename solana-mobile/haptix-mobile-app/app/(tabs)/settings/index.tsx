import React, { useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { PublicKey } from '@solana/web3.js'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Buffer } from 'buffer'

import { useAuth } from '@/components/auth/auth-provider'
import { ClusterNetwork } from '@/components/cluster/cluster-network'
import { useCluster } from '@/components/cluster/cluster-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { HaptixAccountSwitcherSheet } from '@/components/haptix/haptix-account-switcher-sheet'
import { HaptixPolicySheet, PolicyTopic } from '@/components/haptix/haptix-policy-sheet'
import { HaptixTokenIcon } from '@/components/haptix/haptix-icons'
import { useConfirmRemoveWallet } from '@/components/haptix/haptix-remove-wallet'
import { bindHardwarePasskey, deletePasskeys, getDiscoverablePlatformAssertion } from '@/utils/haptix-passkey'
import { matchWebAuthnAssertion } from '@/utils/secp256r1-instruction'
import { saveWallet } from '@/utils/haptix-wallet-storage'
import { fundDevnetWallet } from '@/utils/haptix-funder'
import { ellipsify } from '@/utils/ellipsify'
import { setString as copyToClipboard } from '@/utils/clipboard'
import { SpinLoader } from '@/components/ui'

type AppearanceMode = 'system' | 'light' | 'dark'

const APPEARANCE_LABELS: Record<AppearanceMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

/**
 * Settings Screen — Restored Hardware Passkeys & Native Security Architecture
 *
 * Implements high-density, luxury-dark rhythm matching Image 3:
 *  - Dedicated Hardware Passkeys card with 2-of-2 Hardware Quorum badge.
 *  - Platform passkey primary & backup rows with public key inspect/link.
 *  - Security & Governance with Spending limits, Guardian recovery, and Lock wallet.
 *  - Network & Paymaster with Devnet Paymaster (Sponsored badge) and Security Policy.
 *  - Squircle icon tiles (#16161A, 38x38, r:10) and rich 2-line row subtitles.
 */
export default function TabSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const dialog = useHaptixDialog()
  const { theme, isDark, themePreference, setThemePreference } = useAppTheme()
  const { activeWallet, isLocked, lockWallet, signOut, updateWallet } = useAuth()
  const { selectedCluster, clusters, setSelectedCluster, connection, getExplorerUrl } = useCluster()
  const confirmRemoveWallet = useConfirmRemoveWallet()

  const [policyTopic, setPolicyTopic] = useState<PolicyTopic | null>(null)
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false)
  const [hasCopied, setHasCopied] = useState(false)
  const [isRequestingFaucet, setIsRequestingFaucet] = useState(false)
  const [isBindingBackup, setIsBindingBackup] = useState(false)

  const isDevnet = selectedCluster.network === ClusterNetwork.Devnet
  const hasBackupBound = !!activeWallet?.secondaryCredentialId

  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

  const handleBack = () => {
    Haptics.selectionAsync()
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)')
    }
  }

  const handleCopyAddress = async () => {
    if (!activeWallet?.address) return
    await copyToClipboard(activeWallet.address)
    setHasCopied(true)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setTimeout(() => setHasCopied(false), 1600)
  }

  const handleToggleTheme = () => {
    Haptics.selectionAsync()
    const cycle: Record<AppearanceMode, AppearanceMode> = {
      system: 'dark',
      dark: 'light',
      light: 'system',
    }
    void setThemePreference(cycle[themePreference])
  }

  const handleSelectCluster = () => {
    Haptics.selectionAsync()
    dialog.alert(
      'Solana Network',
      'Select a cluster to connect to:',
      clusters.map((c) => ({
        text: c.name + (c.name === selectedCluster.name ? ' (Active)' : ''),
        onPress: () => {
          setSelectedCluster(c)
          Haptics.selectionAsync()
        },
      })),
    )
  }

  const handleRequestFaucet = async () => {
    if (!activeWallet?.address) {
      dialog.alert('No Wallet', 'Please connect or create a wallet first.')
      return
    }

    try {
      setIsRequestingFaucet(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const walletPda = new PublicKey(activeWallet.address)
      const sig = await fundDevnetWallet(connection, walletPda, 0.2)

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      dialog.alert(
        'Airdrop Confirmed',
        `Received +0.2 Devnet SOL for testing.\n\nSignature: ${sig.slice(0, 8)}...${sig.slice(-8)}`,
      )
    } catch (err) {
      console.warn('Devnet airdrop failed:', err)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      dialog.alert('Faucet Failed', 'Could not complete Devnet airdrop. Please try again shortly.')
    } finally {
      setIsRequestingFaucet(false)
    }
  }

  const handleLockWallet = () => {
    dialog.alert(
      'Lock Wallet',
      'This device will require your biometric passkey before it can sign anything again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Lock',
          onPress: async () => {
            await lockWallet()
            handleBack()
          },
        },
      ],
      { status: 'warning' },
    )
  }

  const handleRemoveWallet = () => {
    confirmRemoveWallet(activeWallet?.address, async () => {
      await deletePasskeys()
      await signOut()
      router.replace('/sign-in')
    })
  }

  const handleLinkBackupPasskey = async () => {
    if (!activeWallet) return
    if (!activeWallet.secondaryPasskeyHex) {
      dialog.alert('Configuration Missing', 'No secondary passkey public key was recorded for this wallet.')
      return
    }

    try {
      setIsBindingBackup(true)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

      const onChainKeys = {
        primary: new Uint8Array(Buffer.from(activeWallet.primaryPasskeyHex, 'hex')),
        secondary: new Uint8Array(Buffer.from(activeWallet.secondaryPasskeyHex, 'hex')),
      }

      const picked = await getDiscoverablePlatformAssertion()
      const matched = matchWebAuthnAssertion(picked.assertion, onChainKeys)

      if (matched === 'secondary') {
        await bindHardwarePasskey('secondary', picked.credentialId, activeWallet.secondaryPasskeyHex)
        const updated = {
          ...activeWallet,
          secondaryCredentialId: picked.credentialId,
        }
        await saveWallet(updated)
        await updateWallet(updated)

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        dialog.alert(
          'Backup Key Linked',
          'Your Backup Quorum Key is now verified and active on this device. Full 2-of-2 multisig protection is enabled.',
          undefined,
          { status: 'success' },
        )
      } else if (matched === 'primary') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        dialog.alert(
          'Selected Primary Key',
          'You selected your Primary passkey again instead of your Backup key. On-chain multisig requires your distinct Backup key.',
          undefined,
          { status: 'warning' },
        )
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        dialog.alert(
          'Unrecognized Passkey',
          "The passkey you selected does not match this wallet's on-chain Backup key. Please select the correct passkey or hardware key.",
          undefined,
          { status: 'error' },
        )
      }
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
        return
      }
      dialog.alert('Binding Error', msg || 'Could not verify passkey')
    } finally {
      setIsBindingBackup(false)
    }
  }

  const handleShowPrimaryDetails = () => {
    if (!activeWallet) return
    dialog.alert(
      activeWallet.primaryPasskeyLabel || 'Platform passkey (primary)',
      `This hardware passkey is bound to this device's secure enclave.\n\nPublic Key:\n${activeWallet.primaryPasskeyHex}\n\nAuthorized for everyday sends up to ${activeWallet.spendThreshold ?? 0.1} SOL.`,
      undefined,
      { status: 'success' },
    )
  }

  const handleShowBackupDetails = () => {
    if (!activeWallet) return
    if (!hasBackupBound) {
      void handleLinkBackupPasskey()
      return
    }
    dialog.alert(
      activeWallet.secondaryPasskeyLabel || 'Platform passkey (backup)',
      `This backup passkey is bound and active on this device.\n\nPublic Key:\n${activeWallet.secondaryPasskeyHex}\n\nRequired for high-value transfers above ${activeWallet.spendThreshold ?? 0.1} SOL and recovery governance.`,
      undefined,
      { status: 'success' },
    )
  }

  const handleShowPaymasterDetails = () => {
    dialog.alert(
      'Devnet Paymaster',
      'Haptix sponsors all transaction gas fees on Devnet through our gasless paymaster treasury.\n\nNew users can transact immediately with zero initial SOL balance required.',
      undefined,
      { status: 'success' },
    )
  }

  const cardBg = isDark ? '#0D0D10' : theme.bgCard
  const cardBorder = isDark ? '#222226' : theme.borderDefault
  const tileBg = isDark ? '#16161A' : '#F1F2F4'
  const tileIconColor = isDark ? '#8A99AD' : '#556375'
  const dividerColor = isDark ? '#1C1C22' : theme.borderSubtle

  return (
    <View style={[styles.container, { backgroundColor: theme.bgApp }]}>
      {/* Settings Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop, borderBottomColor: theme.borderSubtle }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back to wallet"
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Settings</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* SECTION 1: Features */}
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Features</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Manage Wallets */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                setIsAccountSwitcherOpen(true)
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="account-balance-wallet" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Manage Wallets</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Switch active account or create new vaults.
                </Text>
              </View>
              <Text style={[styles.rowValue, { color: theme.textMuted }]} numberOfLines={1}>
                {activeWallet ? activeWallet.name : 'No wallet'}
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Wallet Address */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleCopyAddress}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="content-copy" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Wallet Address</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Copy public Solana smart wallet address.
                </Text>
              </View>
              <Text style={[styles.rowValue, { color: hasCopied ? theme.emeraldText : theme.textMuted }]}>
                {hasCopied ? 'Copied!' : activeWallet ? ellipsify(activeWallet.address, 6) : '—'}
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* SECTION 2: Hardware Passkeys (Image 3 Top Card) */}
        <View style={styles.sectionWrap}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Card Header with 2-of-2 Hardware Quorum Badge */}
            <View style={[styles.cardHeader, { borderBottomColor: dividerColor }]}>
              <View style={styles.cardHeaderTop}>
                <Text style={[styles.cardHeaderTitle, { color: theme.textPrimary }]}>Hardware Passkeys</Text>
                <View
                  style={[
                    styles.quorumBadge,
                    {
                      backgroundColor: hasBackupBound ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quorumBadgeText,
                      { color: hasBackupBound ? '#10B981' : '#3B82F6' },
                    ]}
                  >
                    {hasBackupBound ? '2-of-2 Hardware Quorum' : '1-of-2 Everyday Mode'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.cardHeaderDesc, { color: theme.textMuted }]}>
                Biometric credentials stored in this device's hardware chip.
              </Text>
            </View>

            {/* Platform passkey (primary) */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleShowPrimaryDetails}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="fingerprint" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Platform passkey (primary)</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Active • {activeWallet?.primaryPasskeyHex ? ellipsify(activeWallet.primaryPasskeyHex, 6) : 'Configured'}
                </Text>
              </View>
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>Active</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Platform passkey (backup) */}
            <TouchableOpacity
              style={styles.row}
              onPress={hasBackupBound ? handleShowBackupDetails : handleLinkBackupPasskey}
              activeOpacity={0.7}
              disabled={isBindingBackup}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="vpn-key" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Platform passkey (backup)</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  {hasBackupBound
                    ? `Active • ${ellipsify(activeWallet?.secondaryPasskeyHex || '', 6)}`
                    : 'Not linked to this device. Tap to link key.'}
                </Text>
              </View>
              {isBindingBackup ? (
                <SpinLoader size="sm" color={theme.accent} strokeWidth={2.4} />
              ) : (
                <View
                  style={[
                    styles.activeBadge,
                    {
                      backgroundColor: hasBackupBound ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.14)',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.activeBadgeText,
                      { color: hasBackupBound ? '#10B981' : '#3B82F6' },
                    ]}
                  >
                    {hasBackupBound ? 'Active' : 'Link Key'}
                  </Text>
                </View>
              )}
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* SECTION 3: Security & Governance (Image 3 Middle Card) */}
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Security & Governance</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Spending limit: ≤ 0.1 SOL */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                router.push('/(tabs)/settings/limits')
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="speed" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
                  Spending limit: ≤ {activeWallet?.spendThreshold ?? 0.1} SOL
                </Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Threshold for 1-tap passkey. Higher transfers require 2-of-2 quorum.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Guardian & social recovery */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                router.push('/(tabs)/settings/recovery')
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="supervisor-account" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Guardian & social recovery</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Designate trusted recovery guardian or veto unauthorized recovery.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Lock wallet (Safe Lock) */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleLockWallet}
              activeOpacity={0.7}
              disabled={isLocked}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="lock-outline" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Lock wallet (Safe Lock)</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Require hardware biometric passkey before the next signature.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* SECTION 4: Network & Paymaster (Image 3 Bottom Card) */}
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Network & Paymaster</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Devnet Paymaster */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleShowPaymasterDetails}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="local-gas-station" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Devnet Paymaster</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Zero-SOL account onboarding & gasless fees
                </Text>
              </View>
              <View style={styles.sponsoredBadge}>
                <Text style={styles.sponsoredBadgeText}>Sponsored</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* How security works */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                setPolicyTopic('security')
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="menu-book" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>How security works</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Explore limits, passkeys, and multi-layer quorum rules.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Network Cluster */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleSelectCluster}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="hub" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Network Cluster</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Active RPC endpoint for balances and transactions.
                </Text>
              </View>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>{selectedCluster.name}</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            {isDevnet && (
              <>
                <View style={[styles.divider, { backgroundColor: dividerColor }]} />

                {/* Devnet Airdrop */}
                <TouchableOpacity
                  style={styles.row}
                  onPress={handleRequestFaucet}
                  activeOpacity={0.7}
                  disabled={isRequestingFaucet}
                >
                  <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                    <MaterialIcons name="water-drop" size={20} color={tileIconColor} />
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Devnet Airdrop</Text>
                    <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                      Request free testnet SOL to your account.
                    </Text>
                  </View>
                  {isRequestingFaucet ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : (
                    <Text style={[styles.rowValue, { color: theme.textMuted }]}>+0.2 SOL</Text>
                  )}
                  <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
                </TouchableOpacity>

                <View style={[styles.divider, { backgroundColor: dividerColor }]} />

                {/* Solana Explorer */}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    Haptics.selectionAsync()
                    if (activeWallet?.address) {
                      Linking.openURL(getExplorerUrl(`address/${activeWallet.address}`))
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                    <MaterialIcons name="open-in-new" size={20} color={tileIconColor} />
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Solana Explorer</Text>
                    <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                      View on-chain account state and history.
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* SECTION 5: About Us */}
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>About Us</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Theme Mode */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleToggleTheme}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="brightness-medium" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Theme Mode</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Toggle system, dark, or light appearance.
                </Text>
              </View>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>
                {APPEARANCE_LABELS[themePreference]}
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Source & Docs */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                Linking.openURL('https://github.com/ritesh59697/haptix-mobile-app')
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="code" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Source & Docs</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  GitHub repository and technical architecture.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Current Version */}
            <View style={styles.row}>
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <MaterialIcons name="info-outline" size={20} color={tileIconColor} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Current Version</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Haptix Smart Wallet mobile client.
                </Text>
              </View>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>1.0.0 (SMS)</Text>
            </View>
          </View>
        </View>

        {/* SECTION 6: Standalone Device Actions */}
        <View style={styles.sectionWrap}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Remove Wallet from Device */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleRemoveWallet}
              activeOpacity={0.7}
            >
              <View style={[styles.iconTile, { backgroundColor: isDark ? 'rgba(244, 63, 94, 0.12)' : '#FEE2E2' }]}>
                <MaterialIcons name="delete-outline" size={20} color={theme.rose} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: theme.rose }]}>Remove Wallet from Device</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>
                  Deletes on-device key material and disconnects.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={theme.rose} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Rabby-style Bottom Centered Watermark */}
        <View style={styles.watermarkWrap}>
          <HaptixTokenIcon symbol="HAPTIX" size={17} />
          <Text style={[styles.watermarkText, { color: theme.textMuted }]}>
            Haptix Smart Wallet
          </Text>
        </View>
      </ScrollView>

      <HaptixPolicySheet
        topic={policyTopic}
        threshold={activeWallet?.spendThreshold ?? 0.1}
        onClose={() => setPolicyTopic(null)}
      />

      <HaptixAccountSwitcherSheet
        visible={isAccountSwitcherOpen}
        onClose={() => setIsAccountSwitcherOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerRightSpacer: {
    width: 36,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 18,
  },
  sectionWrap: {
    gap: 7,
  },
  sectionLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    marginLeft: 6,
    letterSpacing: -0.1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  cardHeaderDesc: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 4,
  },
  quorumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  quorumBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  rowSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  rowValue: {
    fontSize: 13,
    marginRight: 2,
  },
  activeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 7.5,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 4,
  },
  activeBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: -0.1,
  },
  sponsoredBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 7.5,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 4,
  },
  sponsoredBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: -0.1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 66,
  },
  watermarkWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    opacity: 0.5,
    paddingTop: 12,
    paddingBottom: 8,
  },
  watermarkText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
})

