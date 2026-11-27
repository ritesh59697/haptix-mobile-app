/**
 * Dev-only screen for the Privacy Rings runtime probe (docs/PRIVATE_SEND_PLAN.md, section 3.2).
 *
 * Runs `utils/spr-probe.ts` under the app's own Hermes runtime and shows each step as it
 * finishes. "Copy report" puts the full plain-text report on the clipboard so it can leave
 * the phone; it is also printed to the Metro console. Only reachable when
 * EXPO_PUBLIC_HAPTIX_DEV_MODE is on, because it spends devnet SOL from the dev funder.
 */
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  StatusBar as RNStatusBar,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Haptics from 'expo-haptics'

import { AppConfig } from '@/constants/app-config'
import { useAppTheme } from '@/components/theme/theme-context'
import { getFundedDevnetPayer } from '@/utils/haptix-funder'
import { setString } from '@/utils/clipboard'
import {
  SprProbeReport,
  SprProbeStatus,
  describeProbeError,
  formatSprProbeReport,
  runSprProbe,
} from '@/utils/spr-probe'

/** Reads the probe's config. Literal member expressions, so Expo inlines them at bundle time. */
function readProbeEnv() {
  const indexerUrl = process.env.EXPO_PUBLIC_HAPTIX_SPR_DEVNET_INDEXER_URL?.trim()
  const proverUrl = process.env.EXPO_PUBLIC_HAPTIX_SPR_DEVNET_PROVER_URL?.trim()
  const budget = process.env.EXPO_PUBLIC_HAPTIX_SPR_PROBE_BUDGET_LAMPORTS?.trim()
  const missing = [
    !indexerUrl && 'EXPO_PUBLIC_HAPTIX_SPR_DEVNET_INDEXER_URL',
    !proverUrl && 'EXPO_PUBLIC_HAPTIX_SPR_DEVNET_PROVER_URL',
  ].filter(Boolean)
  if (missing.length) throw new Error(`${missing.join(' and ')} not set in .env (see .env.example)`)
  return { indexerUrl: indexerUrl!, proverUrl: proverUrl!, budgetLamports: budget ? BigInt(budget) : undefined }
}

export default function PrivacyProbeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { theme } = useAppTheme()
  const [report, setReport] = useState<SprProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const statusBarHeight = RNStatusBar.currentHeight ?? insets.top ?? 0
  const headerPaddingTop = Math.max(insets.top, statusBarHeight) + (Platform.OS === 'android' ? 12 : 6)

  const run = useCallback(async () => {
    Haptics.selectionAsync()
    setRunning(true)
    setSetupError(null)
    setCopied(false)
    setReport(null)
    try {
      const env = readProbeEnv()
      const funder = await getFundedDevnetPayer()
      const result = await runSprProbe(
        {
          rpcUrl: AppConfig.devnetRpcUrl,
          indexerUrl: env.indexerUrl,
          proverUrl: env.proverUrl,
          funderSecret: funder.secretKey,
          budgetLamports: env.budgetLamports,
          randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
        },
        setReport,
      )
      console.log(`[Haptix SPR probe]\n${formatSprProbeReport(result)}`)
    } catch (err) {
      setSetupError(describeProbeError(err))
    } finally {
      setRunning(false)
    }
  }, [])

  const copy = useCallback(async () => {
    if (!report) return
    await setString(formatSprProbeReport(report))
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setCopied(true)
  }, [report])

  const tone = (status: SprProbeStatus) => {
    switch (status) {
      case 'pass':
        return { icon: 'check-circle' as const, color: theme.emerald }
      case 'fail':
        return { icon: 'cancel' as const, color: theme.rose }
      case 'skip':
        return { icon: 'remove-circle-outline' as const, color: theme.textMuted }
      default:
        return { icon: 'info-outline' as const, color: theme.info }
    }
  }

  if (!AppConfig.devMode) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.bgApp }]}>
        <Text style={{ color: theme.textMuted }}>The Privacy Rings probe is only available in dev mode.</Text>
      </View>
    )
  }

  const verdictColor =
    report?.verdict === 'go' ? theme.emerald : report?.verdict === 'no-go' ? theme.rose : theme.textMuted

  return (
    <View style={[styles.container, { backgroundColor: theme.bgApp }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle, paddingTop: headerPaddingTop }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: theme.bgElevated, borderColor: theme.borderDefault }]}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back to settings"
        >
          <MaterialIcons name="arrow-back" size={18} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Privacy Rings probe</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            Devnet go/no-go for private send on this phone
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 32 }]}>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Loads the Helius SDK in the JavaScript engine this app runs on and runs a full private transfer between two
          throwaway devnet wallets, paid from the dev funder (1% of its balance unless a budget is set). Funds go back
          to the funder at the end. Takes about a minute.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.accent, opacity: running ? 0.6 : 1 }]}
            onPress={run}
            disabled={running}
            accessibilityRole="button"
          >
            {running ? (
              <ActivityIndicator color={theme.accentForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: theme.accentForeground }]}>
                {report ? 'Run again' : 'Run probe'}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondary, { borderColor: theme.borderDefault, opacity: report ? 1 : 0.4 }]}
            onPress={copy}
            disabled={!report}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: theme.textPrimary }]}>{copied ? 'Copied' : 'Copy report'}</Text>
          </TouchableOpacity>
        </View>

        {setupError && (
          <View style={[styles.card, { backgroundColor: theme.roseBg, borderColor: theme.roseBorder }]}>
            <Text style={[styles.detail, { color: theme.roseText }]}>{setupError}</Text>
          </View>
        )}

        {report && (
          <View style={[styles.card, { backgroundColor: theme.bgCard, borderColor: theme.borderSubtle }]}>
            <Text style={[styles.verdict, { color: verdictColor }]}>
              {report.verdict === 'running' ? 'Running…' : report.verdict.toUpperCase()}
            </Text>
            <Text style={[styles.detail, { color: theme.textMuted }]}>{report.runtime}</Text>
            {report.steps.map((s, i) => {
              const t = tone(s.status)
              return (
                <View key={`${i}-${s.name}`} style={styles.stepRow}>
                  <MaterialIcons name={t.icon} size={18} color={t.color} style={styles.stepIcon} />
                  <View style={styles.stepText}>
                    <Text style={[styles.stepName, { color: theme.textPrimary }]}>
                      {s.name}
                      {s.ms !== undefined ? <Text style={{ color: theme.textMuted }}> · {s.ms} ms</Text> : null}
                    </Text>
                    {s.detail ? (
                      <Text style={[styles.detail, { color: theme.textMuted }]} selectable>
                        {s.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2 },
  content: { padding: 16, gap: 16 },
  body: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secondary: { borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  verdict: { fontSize: 18, fontWeight: '700' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepIcon: { marginTop: 1, marginRight: 8 },
  stepText: { flex: 1 },
  stepName: { fontSize: 14, fontWeight: '500' },
  detail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
})
