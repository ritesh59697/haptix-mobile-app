import React, { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { CopyActionButton } from '@/components/ui/copy-action-button'
import { useHaptixDialog } from '@/components/haptix/haptix-dialog'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

/**
 * Removing the wallet from this device deletes the passkeys — it says nothing to the
 * chain. The part that is easy to get wrong is that the address has to leave with the
 * user: a passkey assertion proves the key is yours, it never hands the public key
 * back, so nothing on this side can rebuild the address later. Sign-in then needs the
 * address typed in, and an address nobody wrote down is an account nobody can open
 * again. Hence a copy button inside the confirmation rather than a sentence of prose.
 */
function RemoveWalletAddressNotice({ address }: { address: string }) {
  const { theme } = useAppTheme()

  return (
    <View style={styles.notice}>
      <Text style={[styles.noticeLabel, { color: theme.textSecondary }]}>Your wallet address</Text>
      <View style={[styles.addressBox, { backgroundColor: theme.bgApp, borderColor: theme.borderSubtle }]}>
        <Text selectable style={[styles.address, { color: theme.textPrimary }]}>
          {address}
        </Text>
      </View>
      <CopyActionButton value={address} label="Copy address" copiedLabel="Copied" compact style={styles.noticeCopy} />
    </View>
  )
}

/**
 * The one confirmation in front of forgetting a wallet, shared by the wallet screen's
 * overflow menu and Settings so the warning cannot drift between the two.
 */
export function useConfirmRemoveWallet() {
  const dialog = useHaptixDialog()

  return useCallback(
    (address: string | null | undefined, onConfirm: () => void | Promise<void>) => {
      dialog.alert(
        'Remove Wallet from Device',
        'Nothing is deleted on-chain and your funds stay put — this device only forgets the passkeys. Saving the address below is what gets you back in: signing in asks for it, and a passkey cannot hand it back.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void onConfirm()
            },
          },
        ],
        {
          status: 'error',
          content: address ? <RemoveWalletAddressNotice address={address} /> : undefined,
        },
      )
    },
    [dialog],
  )
}

const styles = StyleSheet.create({
  notice: {
    marginTop: 14,
  },
  noticeLabel: {
    fontSize: typeScale.footnote,
    fontWeight: '600',
    marginBottom: 6,
  },
  addressBox: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  address: {
    fontFamily: 'SpaceMono',
    fontSize: typeScale.caption,
    lineHeight: 16,
  },
  noticeCopy: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
})
