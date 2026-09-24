import React, { useMemo } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'
import { radius, typeScale } from '@/theme/tokens'

export type PolicyTopic = 'agents' | 'security'

interface PolicyRow {
  term: string
  detail: string
}

interface PolicySection {
  heading: string
  rows: PolicyRow[]
}

interface PolicyContent {
  title: string
  intro: string
  sections: PolicySection[]
}

/**
 * One home for the "how does this actually work" copy.
 *
 * This text used to live in ~25 inline ⓘ badges pinned to section headings and
 * row labels. Explaining every noun next to itself made the screens unreadable
 * and buried the numbers under chrome. Same copy, read once, on demand.
 */
export function buildPolicy(threshold: number): Record<PolicyTopic, PolicyContent> {
  return {
    agents: {
      title: 'Agents & spending limits',
      intro: 'Two numbers govern every autonomous trade: a rolling 24-hour budget, and a per-trade limit.',
      sections: [
        {
          heading: 'Daily budget',
          rows: [
            {
              term: 'Spending limits',
              detail: `Trades up to ${threshold} SOL execute automatically. Anything above requires both device passkeys.`,
            },
            {
              term: 'Daily limit',
              detail:
                'Maximum budget delegated to autonomous agents in a 24-hour window. The counter resets on a rolling basis.',
            },
          ],
        },
        {
          heading: 'Per-trade limits',
          rows: [
            {
              term: 'One-key limit',
              detail: `Single trades up to ${threshold} SOL execute with zero biometric prompts.`,
            },
            {
              term: 'Larger trades',
              detail: `Trades exceeding ${threshold} SOL require both device passkeys.`,
            },
          ],
        },
        {
          heading: 'Delegated agents',
          rows: [
            {
              term: 'Active agents',
              detail: 'On-chain delegated bots authorized to transact within your policy limits.',
            },
            {
              term: 'Jupiter Auto-DCA',
              detail: 'Automated dollar-cost averaging into SOL & USDC via Jupiter DEX pools.',
            },
            {
              term: 'Kamino Yield',
              detail: 'Dynamically rebalances concentrated liquidity positions to maximize APY.',
            },
          ],
        },
        {
          heading: 'Session keys',
          rows: [
            {
              term: 'Grant session key',
              detail: 'Delegates a scoped session key to an external bot. Requires both device passkeys to authorise.',
            },
            {
              term: 'Run Trade',
              detail:
                'Runs a real 0.02 SOL transfer on Solana Devnet, signed solely by the agent session key with zero prompts at execution time.',
            },
          ],
        },
        {
          heading: 'Locking the wallet',
          rows: [
            {
              term: 'Wallet lock',
              detail: 'Locks the wallet on-chain and stops every agent from trading. Unlock the wallet to resume.',
            },
          ],
        },
      ],
    },
    security: {
      title: 'Security & recovery',
      intro: 'What protects this wallet, what stops a drain, and how you get back in if a device is lost.',
      sections: [
        {
          heading: 'Your keys',
          rows: [
            {
              term: 'Your keys',
              detail:
                'Generated on this device and held in OS secure storage. These are software keys, so a compromised device can extract them.',
            },
            {
              term: 'Primary device passkey',
              detail:
                'NIST P-256 key in OS secure storage, unlocked with your device biometrics. Not sealed in a secure element.',
            },
            {
              term: 'Backup key',
              detail: 'The second key in the quorum, also on this device. Required for sends above your one-key limit.',
            },
          ],
        },
        {
          heading: 'Spending limits',
          rows: [
            {
              term: 'Spending limits',
              detail: 'Rules the Solana program enforces itself. A transaction that breaks them is rejected on-chain.',
            },
            {
              term: 'One-key limit',
              detail: 'Instant single-signature execution for transactions up to this limit.',
            },
            {
              term: 'Larger sends',
              detail: 'Transfers above the one-key limit need both passkeys.',
            },
            {
              term: 'Rate limit',
              detail: 'Prevents drain attacks by capping transaction frequency to 5 per hour.',
            },
            {
              term: 'Sub-account session key',
              detail: 'Sub-account session keys can only spend their daily budget on Jupiter DEX.',
            },
          ],
        },
        {
          heading: 'Recovery',
          rows: [
            {
              term: 'Guardian recovery',
              detail:
                'Recover smart wallet control without seed phrases. One designated guardian proposes new passkeys.',
            },
            {
              term: 'Guardian',
              detail: 'Holds one power only: starting a recovery. It can never move funds out of the wallet.',
            },
            {
              term: '24h grace period',
              detail:
                'Starting a recovery freezes the wallet. You have 24 hours to cancel it with both device passkeys.',
            },
          ],
        },
        {
          heading: 'Lock and history',
          rows: [
            {
              term: 'Wallet lock',
              detail: 'Revokes every delegated permission and stops transfers until you unlock the wallet.',
            },
            {
              term: 'On-chain attestations',
              detail: 'Policy and session state written on-chain, verifiable on Solana Devnet.',
            },
            {
              term: 'Biometric passkey enrolled',
              detail: 'Keys created on this device and gated by biometrics. No hardware attestation is performed.',
            },
            {
              term: 'Spending limits active',
              detail: 'The on-chain limits above are live. Above the threshold, both keys must sign.',
            },
          ],
        },
      ],
    },
  }
}

interface HaptixPolicySheetProps {
  topic: PolicyTopic | null
  threshold: number
  onClose: () => void
}

export function HaptixPolicySheet({ topic, threshold, onClose }: HaptixPolicySheetProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppTheme()
  const content = useMemo(() => (topic ? buildPolicy(threshold)[topic] : null), [topic, threshold])

  return (
    <Modal visible={content !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bgCard,
              borderColor: theme.borderDefault,
              paddingBottom: insets.bottom + 20,
            },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.dragHandle, { backgroundColor: theme.borderDefault }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>{content?.title}</Text>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: theme.accentLight }]}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={17} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            <Text style={[styles.intro, { color: theme.textSecondary }]}>{content?.intro}</Text>

            {content?.sections.map((section, sectionIndex) => (
              <View key={section.heading} style={sectionIndex === 0 ? styles.sectionFirst : styles.section}>
                <Text style={[styles.sectionHeading, { color: theme.textMuted }]}>{section.heading}</Text>
                {section.rows.map((row, rowIndex) => (
                  <View key={row.term}>
                    <View style={styles.row}>
                      <Text style={[styles.term, { color: theme.textPrimary }]}>{row.term}</Text>
                      <Text style={[styles.detail, { color: theme.textSecondary }]}>{row.detail}</Text>
                    </View>
                    {rowIndex < section.rows.length - 1 ? (
                      <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />
                    ) : null}
                  </View>
                ))}
              </View>
            ))}

            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: theme.accent }]}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={[styles.doneBtnText, { color: theme.accentForeground }]}>Got it</Text>
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingTop: 12,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  title: {
    flex: 1,
    marginRight: 12,
    fontSize: typeScale.heading,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  intro: {
    fontSize: typeScale.bodyLg,
    lineHeight: 20,
    marginBottom: 22,
  },
  section: {
    marginTop: 22,
  },
  sectionFirst: {
    marginTop: 0,
  },
  sectionHeading: {
    fontSize: typeScale.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    paddingVertical: 11,
  },
  term: {
    fontSize: typeScale.bodyLg,
    fontWeight: '600',
    marginBottom: 3,
  },
  detail: {
    fontSize: typeScale.body,
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  doneBtn: {
    marginTop: 28,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontSize: typeScale.title,
    fontWeight: '700',
  },
})
