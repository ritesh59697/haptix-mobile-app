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
      title: 'Agents & the spending firewall',
      intro:
        'Two numbers govern every autonomous trade: a rolling 24-hour budget, and a per-trade fast-lane limit.',
      sections: [
        {
          heading: 'Daily budget',
          rows: [
            {
              term: 'Spending firewall',
              detail: `Trades up to ${threshold} SOL execute automatically. Anything above requires 2-of-2 hardware passkeys.`,
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
              term: 'Fast lane',
              detail: `Single trades up to ${threshold} SOL execute with zero biometric prompts.`,
            },
            {
              term: 'Quorum',
              detail: `Trades exceeding ${threshold} SOL require 2-of-2 hardware passkeys.`,
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
              detail:
                'Delegates a scoped cryptographic session key to an external bot. Requires 2-of-2 hardware passkeys.',
            },
            {
              term: 'Run Trade',
              detail:
                'Runs a real 0.02 SOL transfer on Solana Devnet, signed solely by the agent session key with zero prompts at execution time.',
            },
          ],
        },
        {
          heading: 'Kill switch',
          rows: [
            {
              term: 'Emergency circuit breaker',
              detail:
                'Instantly freezes and revokes all autonomous agent trading permissions on-chain. Unlock the wallet to resume trading.',
            },
          ],
        },
      ],
    },
    security: {
      title: 'Security & recovery',
      intro:
        'What protects this wallet, what stops a drain, and how you get back in if a device is lost.',
      sections: [
        {
          heading: 'Hardware credentials',
          rows: [
            {
              term: 'Hardware credentials',
              detail:
                'Secp256r1 cryptographic keys generated within isolated hardware secure chips. Keys cannot be extracted.',
            },
            {
              term: 'Primary device passkey',
              detail:
                'Hardware biometric key on Apple Secure Enclave / Android StrongBox using the NIST P-256 curve.',
            },
            {
              term: 'Hardware backup key',
              detail:
                'Physical FIDO2 / WebAuthn security key (e.g. YubiKey 5) required for 2-of-2 escalation.',
            },
          ],
        },
        {
          heading: 'On-chain policy firewall',
          rows: [
            {
              term: 'On-chain policy firewall',
              detail:
                'Smart contract rules enforced directly on Solana. Non-compliant transactions are rejected by the validator runtime.',
            },
            {
              term: 'Fast-lane cap',
              detail: 'Instant single-signature execution for transactions up to this limit.',
            },
            {
              term: 'Quorum escalation',
              detail:
                'Transfers above the fast-lane limit require both the biometric and the physical passkey.',
            },
            {
              term: 'Velocity breaker',
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
              detail:
                'Holds one power only: starting a recovery. It can never move funds out of the wallet.',
            },
            {
              term: '24h grace period',
              detail:
                'Starting a recovery freezes the wallet. You have 24 hours to cancel it with both hardware passkeys.',
            },
          ],
        },
        {
          heading: 'Panic & audit',
          rows: [
            {
              term: 'Emergency panic lock',
              detail:
                'Immediately revokes all delegated permissions and freezes account transfers on Solana.',
            },
            {
              term: 'On-chain attestations',
              detail:
                'Cryptographic proof of hardware enrollment and policy verification, logged on Solana Devnet.',
            },
            {
              term: 'Biometric passkey enrolled',
              detail: 'Hardware attestation verifying genuine Secure Enclave key generation.',
            },
            {
              term: '2-of-2 spending policy active',
              detail: 'Smart contract verified on Solana Devnet with multisig fallback.',
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

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            <Text style={[styles.intro, { color: theme.textSecondary }]}>{content?.intro}</Text>

            {content?.sections.map((section, sectionIndex) => (
              <View
                key={section.heading}
                style={sectionIndex === 0 ? styles.sectionFirst : styles.section}
              >
                <Text style={[styles.sectionHeading, { color: theme.textMuted }]}>
                  {section.heading}
                </Text>
                {section.rows.map((row, rowIndex) => (
                  <View key={row.term}>
                    <View style={styles.row}>
                      <Text style={[styles.term, { color: theme.textPrimary }]}>{row.term}</Text>
                      <Text style={[styles.detail, { color: theme.textSecondary }]}>
                        {row.detail}
                      </Text>
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
