import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'
import { Buffer } from 'buffer'

import { useAuth } from '@/components/auth/auth-provider'
import { useAppTheme } from '@/components/theme/theme-context'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { HaptixAlert } from '@/components/haptix/haptix-alert'
import { HaptixSettingsBadge, HaptixSettingsDivider, HaptixSettingsRow } from '@/components/haptix/haptix-settings-ui'
import { LucideKeyRound } from '@/components/haptix/haptix-icons'
import { PrismDepthButton, SpinLoader } from '@/components/ui'
import { bindHardwarePasskey, getDiscoverablePlatformAssertion } from '@/utils/haptix-passkey'
import { matchWebAuthnAssertion } from '@/utils/secp256r1-instruction'
import { saveWallet } from '@/utils/haptix-wallet-storage'
import { ellipsify } from '@/utils/ellipsify'

export function SettingsUiPasskeys() {
  const { activeWallet, updateWallet } = useAuth()
  const { theme } = useAppTheme()
  const dialog = useHaptixDialog()
  const [isBinding, setIsBinding] = useState(false)

  if (!activeWallet) return null

  const hasPrimaryBound = !!activeWallet.primaryCredentialId || !!activeWallet.primaryPasskeyHex
  const hasBackupBound = !!activeWallet.secondaryCredentialId

  const handleLinkBackupPasskey = async () => {
    if (!activeWallet.secondaryPasskeyHex) {
      dialog.alert('Configuration Missing', 'No secondary passkey public key was recorded for this wallet.')
      return
    }

    try {
      setIsBinding(true)
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
      setIsBinding(false)
    }
  }

  const handleShowPrimaryDetails = () => {
    dialog.alert(
      activeWallet.primaryPasskeyLabel || 'Primary Passkey',
      `This hardware passkey is bound to this device.\n\nPublic Key:\n${activeWallet.primaryPasskeyHex}\n\nAuthorized for everyday sends up to ${activeWallet.spendThreshold ?? 0.1} SOL.`,
      undefined,
      { status: 'success' },
    )
  }

  const handleShowBackupDetails = () => {
    if (!hasBackupBound) {
      handleLinkBackupPasskey()
      return
    }
    dialog.alert(
      activeWallet.secondaryPasskeyLabel || 'Backup Quorum Key',
      `This backup passkey is bound and active on this device.\n\nPublic Key:\n${activeWallet.secondaryPasskeyHex}\n\nRequired for high-value transfers above ${activeWallet.spendThreshold ?? 0.1} SOL and recovery governance.`,
      undefined,
      { status: 'success' },
    )
  }

  return (
    <>
      <HaptixSettingsRow
        icon="fingerprint"
        title={activeWallet.primaryPasskeyLabel || 'Primary Passkey'}
        subtitle={
          activeWallet.primaryPasskeyHex
            ? `Active • ${ellipsify(activeWallet.primaryPasskeyHex, 6)}`
            : 'Active on this device'
        }
        onPress={handleShowPrimaryDetails}
        trailing={
          <View style={styles.badgeWrapper}>
            <HaptixSettingsBadge label="Active" tone="success" />
            <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
          </View>
        }
      />

      <HaptixSettingsDivider />

      <HaptixSettingsRow
        icon="vpn-key"
        title={activeWallet.secondaryPasskeyLabel || 'Backup Quorum Key'}
        subtitle={
          hasBackupBound
            ? `Active • ${ellipsify(activeWallet.secondaryPasskeyHex, 6)}`
            : 'Not linked to this device. Tap to link key.'
        }
        onPress={hasBackupBound ? handleShowBackupDetails : handleLinkBackupPasskey}
        disabled={isBinding}
        trailing={
          isBinding ? (
            <SpinLoader size="sm" color={theme.accent} strokeWidth={2.4} />
          ) : (
            <View style={styles.badgeWrapper}>
              <HaptixSettingsBadge
                label={hasBackupBound ? 'Active' : 'Link Key'}
                tone={hasBackupBound ? 'success' : 'accent'}
              />
              <MaterialIcons name="chevron-right" size={18} color={theme.textMuted} />
            </View>
          )
        }
      />

      {!hasBackupBound ? (
        <View style={styles.alertSpacing}>
          <HaptixAlert
            status="warning"
            title="Everyday Mode Active"
            message={`Without your Backup Key, sends are limited to ≤ ${activeWallet.spendThreshold ?? 0.1} SOL. Link your Backup Key to unlock high-value transfers and full 2-of-2 multisig security.`}
            style={styles.alertBox}
          />
          <PrismDepthButton
            title={isBinding ? 'Verifying Backup Key…' : 'Link Backup Passkey Now'}
            onPress={handleLinkBackupPasskey}
            disabled={isBinding}
            icon={
              isBinding ? (
                <SpinLoader
                  size="sm"
                  color={isBinding ? theme.textMuted : theme.accentForeground}
                  strokeWidth={2.4}
                />
              ) : (
                <LucideKeyRound size={16} color={theme.accentForeground} strokeWidth={2} />
              )
            }
            textStyle={styles.linkKeyButtonText}
          />
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  badgeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  alertSpacing: {
    marginTop: 12,
    gap: 10,
  },
  alertBox: {
    marginBottom: 0,
  },
  linkKeyButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
})
