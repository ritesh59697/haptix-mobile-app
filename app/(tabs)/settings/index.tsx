import { useMemo, useState } from 'react'
import { Platform, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppConfig } from '@/constants/app-config'
import { useAuth } from '@/components/auth/auth-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { HaptixAlert } from '@/components/haptix/haptix-alert'
import { HaptixIosTabs, IosTabItem } from '@/components/haptix/haptix-ios-tabs'
import { HaptixPolicySheet, PolicyTopic } from '@/components/haptix/haptix-policy-sheet'
import {
  HaptixSettingsCard,
  HaptixSettingsDivider,
  HaptixSettingsHeader,
  HaptixSettingsRow,
} from '@/components/haptix/haptix-settings-ui'
import { SettingsAppConfig } from '@/components/settings/settings-app-config'
import { SettingsUiAccount } from '@/components/settings/settings-ui-account'
import { SettingsUiCluster } from '@/components/settings/settings-ui-cluster'
import { SettingsUiWallets } from '@/components/settings/settings-ui-wallets'
import { deletePasskeys } from '@/utils/haptix-passkey'
import { radius, typeScale } from '@/theme/tokens'

type AppearanceMode = 'system' | 'light' | 'dark'

const APPEARANCE_TABS: IosTabItem<AppearanceMode>[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const APPEARANCE_LABELS: Record<AppearanceMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

/**
 * Settings
 *
 * Rebuilt from the Expo template block so it uses the wallet screen's own card
 * geometry, row rhythm and heading treatment. Sections read top-down as: who this
 * wallet is, what it talks to, how it looks, what the app is, then the actions that
 * change device state — with the destructive one last.
 */
export default function TabSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const dialog = useHaptixDialog()
  const { theme, isDark, themePreference, setThemePreference } = useAppTheme()
  const { activeWallet, isLocked, lockWallet, signOut, wallets } = useAuth()
  const { selectedCluster } = useCluster()
  const [policyTopic, setPolicyTopic] = useState<PolicyTopic | null>(null)

  const s = useMemo(
    () => ({
      container: { backgroundColor: theme.bgApp },
      header: { backgroundColor: theme.bgApp, borderBottomColor: theme.borderSubtle },
      elevatedCard: { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault },
      textPrimary: { color: theme.textPrimary },
      textMuted: { color: theme.textMuted },
    }),
    [theme],
  )

  // Same inset maths as the wallet screen's header, so the two screens' headers sit
  // at the same height when you move between them.
  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

  // Settings is pushed onto the tab navigator rather than opened as a tab, so the
  // dock is not on screen: the header owns the way back. `back()` is preferred so
  // the wallet keeps its selected dock tab; the replace covers a cold deep link.
  const handleBack = () => {
    Haptics.selectionAsync()
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)')
    }
  }

  const handleLockWallet = () => {
    dialog.alert(
      'Lock Wallet',
      'This device will require your passkey before it can sign anything again.',
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
    dialog.alert(
      'Remove Wallet from Device',
      'Are you sure you want to remove this smart wallet from this device? Your on-chain account and funds remain secure on Solana and can be restored anytime using your passkey.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePasskeys()
            } catch (e) {
              console.warn('Failed to delete passkeys:', e)
            }
            await signOut()
            router.replace('/sign-in')
          },
        },
      ],
      { status: 'error' },
    )
  }

  const chevron = <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />

  return (
    <View style={[styles.container, s.container]}>
      <View style={[styles.header, s.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.pageTitleRow}>
          <TouchableOpacity
            style={[styles.backBtn, s.elevatedCard]}
            onPress={handleBack}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back to wallet"
          >
            <MaterialIcons name="arrow-back" size={18} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.pageTitleText}>
            <Text style={[styles.pageTitle, s.textPrimary]}>Settings</Text>
            <Text style={[styles.pageSubtitle, s.textMuted]}>Keys, network and this device.</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <HaptixSettingsCard>
          <HaptixSettingsHeader title="Account" description="The passkey wallet stored on this device." />
          <SettingsUiAccount />
        </HaptixSettingsCard>

        {/* Only rendered once a device holds more than one wallet: a list of one repeats
            the Account card above and adds nothing to scan. */}
        {wallets.length > 1 ? (
          <HaptixSettingsCard>
            <HaptixSettingsHeader
              title="Wallets"
              badge={`${wallets.length}`}
              description="Saved on this device. Switching re-points the passkey keys at the wallet you pick."
            />
            <SettingsUiWallets />
          </HaptixSettingsCard>
        ) : null}

        <HaptixSettingsCard>
          <HaptixSettingsHeader
            title="Network"
            badge={selectedCluster.name}
            description="Balances, transactions and agent sessions are read from this cluster."
          />
          <SettingsUiCluster />
        </HaptixSettingsCard>

        <HaptixSettingsCard>
          <HaptixSettingsHeader
            title="Appearance"
            badge={APPEARANCE_LABELS[themePreference]}
            description="Follow the system setting, or pin the app to one scheme."
          />
          <HaptixIosTabs<AppearanceMode>
            tabs={APPEARANCE_TABS}
            activeTab={themePreference}
            onChange={(mode) => {
              void setThemePreference(mode)
            }}
          />
          <HaptixSettingsDivider />
          <HaptixSettingsRow
            icon="contrast"
            title={`Currently ${isDark ? 'dark' : 'light'}`}
            subtitle={
              themePreference === 'system'
                ? 'Resolved from your device appearance right now.'
                : 'Pinned by your choice above, ignoring the device setting.'
            }
          />
        </HaptixSettingsCard>

        <HaptixSettingsCard>
          <HaptixSettingsHeader title="App" />
          <SettingsAppConfig />
        </HaptixSettingsCard>

        {AppConfig.devMode && (
          <HaptixSettingsCard>
            <HaptixSettingsHeader
              title="Developer"
              badge="DEV"
              badgeTone="danger"
              description="Only present in builds compiled with dev mode enabled."
            />
            <HaptixAlert
              status="warning"
              title="Dev mode is on"
              message="Devnet fee sponsorship and the treasury-funded faucet are live. Anything reachable from the bundle is recoverable, so never ship a build with EXPO_PUBLIC_HAPTIX_DEV_MODE=true."
            />
          </HaptixSettingsCard>
        )}

        <HaptixSettingsCard>
          <HaptixSettingsHeader
            title="Security & Device"
            badge="Careful"
            badgeTone="danger"
            description="These change how this device unlocks and signs for the wallet."
          />
          <HaptixSettingsRow
            icon="lock-outline"
            title="Lock wallet"
            subtitle="Requires your passkey before the next signature."
            onPress={handleLockWallet}
            disabled={isLocked}
            trailing={chevron}
          />
          <HaptixSettingsDivider />
          <HaptixSettingsRow
            icon="menu-book"
            title="How security works"
            subtitle="Fast lane, 2-of-2 quorum and the panic freeze."
            onPress={() => setPolicyTopic('security')}
            trailing={chevron}
          />
          <HaptixSettingsDivider />
          <HaptixSettingsRow
            icon="delete-outline"
            title="Remove from this device"
            subtitle="Funds stay on Solana and can be restored with your passkey."
            tone="danger"
            onPress={handleRemoveWallet}
          />
        </HaptixSettingsCard>
      </ScrollView>

      <HaptixPolicySheet
        topic={policyTopic}
        threshold={activeWallet?.spendThreshold ?? 0.1}
        onClose={() => setPolicyTopic(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitleText: {
    flex: 1,
  },
  pageTitle: {
    fontSize: typeScale.display,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    fontSize: typeScale.body,
    lineHeight: 18,
    marginTop: 2,
  },
})
