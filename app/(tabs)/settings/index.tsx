import React, { useState } from 'react'
import {
  ActivityIndicator,
  Image,
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

type AppearanceMode = 'system' | 'light' | 'dark'

const APPEARANCE_LABELS: Record<AppearanceMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

/**
 * Settings Screen — Rabby-style Pitch Black Architecture
 *
 * Preserves the exact user-preferred design:
 *  - Pitch black background & sleek dark cards.
 *  - Pure electric blue line icons directly placed (no boxes).
 *  - Clean single-line row rhythm with inline value tags & chevron.
 *  - Restored full Hardware Passkey quorum (Primary & Backup linking), Safe Lock, and Paymaster.
 */
export default function TabSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const dialog = useHaptixDialog()
  const { theme, isDark, themePreference, setThemePreference, appearanceStyle, setAppearanceStyle } = useAppTheme()
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

  const handleToggleAppearanceStyle = () => {
    Haptics.selectionAsync()
    void setAppearanceStyle(appearanceStyle === 'default' ? 'glassmorphic' : 'default')
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

  const screenBg = isDark ? '#000000' : theme.bgApp
  const cardBg = isDark ? '#000000' : theme.bgCard
  const cardBorder = isDark ? '#1C1C20' : theme.borderDefault
  const dividerColor = isDark ? '#18181C' : theme.borderSubtle
  const headerBorderColor = isDark ? '#18181C' : theme.borderSubtle

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      {/* Rabby-style Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop, borderBottomColor: headerBorderColor }]}>
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
        {/* SECTION 1: Features (Rabby Style) */}
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
              <MaterialIcons name="account-balance-wallet" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Manage Wallets</Text>
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
              <MaterialIcons name="content-copy" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Wallet Address</Text>
              <Text style={[styles.rowValue, { color: hasCopied ? theme.emeraldText : theme.textMuted }]}>
                {hasCopied ? 'Copied!' : activeWallet ? ellipsify(activeWallet.address, 6) : '—'}
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* SECTION 2: Settings (Rabby Style with Blue Icons & Restored Security) */}
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>Settings</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Platform passkey (primary) */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleShowPrimaryDetails}
              activeOpacity={0.7}
            >
              <MaterialIcons name="fingerprint" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Platform passkey (primary)</Text>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>
                {activeWallet?.primaryPasskeyHex ? `Active · ${ellipsify(activeWallet.primaryPasskeyHex, 4)}` : 'Active'}
              </Text>
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
              <MaterialIcons name="vpn-key" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Platform passkey (backup)</Text>
              {isBindingBackup ? (
                <ActivityIndicator size="small" color={theme.accent} style={styles.rowSpinner} />
              ) : (
                <Text
                  style={[
                    styles.rowValue,
                    { color: hasBackupBound ? theme.textMuted : theme.emeraldText },
                  ]}
                >
                  {hasBackupBound
                    ? activeWallet?.secondaryPasskeyHex
                      ? `Active · ${ellipsify(activeWallet.secondaryPasskeyHex, 4)}`
                      : 'Active'
                    : 'Link Key'}
                </Text>
              )}
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Spending Limit */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                router.push('/(tabs)/settings/limits')
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="speed" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Spending Limit</Text>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>
                ≤ {activeWallet?.spendThreshold ?? 0.1} SOL
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Guardian & Social Recovery */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                router.push('/(tabs)/settings/recovery')
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="supervisor-account" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Guardian & Recovery</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Lock Wallet (Safe Lock) */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleLockWallet}
              activeOpacity={0.7}
              disabled={isLocked}
            >
              <MaterialIcons name="lock-outline" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Lock wallet (Safe Lock)</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Devnet Paymaster */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleShowPaymasterDetails}
              activeOpacity={0.7}
            >
              <MaterialIcons name="local-gas-station" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Devnet Paymaster</Text>
              <Text style={[styles.rowValue, { color: '#10B981', fontWeight: '600' }]}>Sponsored</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Network Cluster */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleSelectCluster}
              activeOpacity={0.7}
            >
              <MaterialIcons name="hub" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Network Cluster</Text>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>{selectedCluster.name}</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Theme Mode */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleToggleTheme}
              activeOpacity={0.7}
            >
              <MaterialIcons name="brightness-medium" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Color Theme</Text>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>
                {APPEARANCE_LABELS[themePreference]}
              </Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Design Language */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleToggleAppearanceStyle}
              activeOpacity={0.7}
            >
              <MaterialIcons name="auto-awesome" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Liquid Glass (Beta)</Text>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>
                {appearanceStyle === 'glassmorphic' ? 'On' : 'Off'}
              </Text>
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
                  <MaterialIcons name="local-gas-station" size={20} color={theme.accent} />
                  <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Devnet Airdrop</Text>
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
                  <MaterialIcons name="open-in-new" size={20} color={theme.accent} />
                  <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Solana Explorer</Text>
                  <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* SECTION 3: About Us (Rabby Style) */}
        <View style={styles.sectionWrap}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>About Us</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Current Version */}
            <View style={styles.row}>
              <MaterialIcons name="info-outline" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Current Version</Text>
              <Text style={[styles.rowValue, { color: theme.textMuted }]}>1.0.0 (SMS)</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </View>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Follow Us / GitHub */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                Linking.openURL('https://github.com/ritesh59697/haptix-mobile-app')
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="code" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Source & Docs</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />

            {/* Security Architecture */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                Haptics.selectionAsync()
                setPolicyTopic('security')
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="menu-book" size={20} color={theme.accent} />
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>Security Architecture</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* SECTION 4: Standalone Device Actions (Rabby Style) */}
        <View style={styles.sectionWrap}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {/* Remove Wallet from Device */}
            <TouchableOpacity
              style={styles.row}
              onPress={handleRemoveWallet}
              activeOpacity={0.7}
            >
              <MaterialIcons name="delete-outline" size={20} color={theme.rose} />
              <Text style={[styles.rowTitle, { color: theme.rose }]}>Remove Wallet from Device</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.rose} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Rabby-style Bottom Centered Watermark */}
        <View style={styles.watermarkWrap}>
          <Image 
            source={require('@/assets/images/haptix-new-logo.png')} 
            style={{ width: 17, height: 17, resizeMode: 'contain' }}
          />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 13,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    letterSpacing: -0.2,
  },
  rowValue: {
    fontSize: 13.5,
    marginRight: 2,
  },
  rowSpinner: {
    marginRight: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 49,
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
