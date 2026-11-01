/**
 * Config plugin: the `solana-wallet:` intent-filter that makes Haptix
 * discoverable as a Mobile Wallet Adapter provider.
 *
 * Worth testing without a device because a wrong manifest fails silently: the
 * app builds and runs, and dApps simply never find it. These assertions pin the
 * action, the categories and the scheme the MWA spec requires, and the
 * idempotency that keeps repeated prebuilds from stacking duplicates.
 */
import withHaptixMwa from '../plugins/with-haptix-mwa'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
    console.log(`  PASS: ${label}`)
  } else {
    failed++
    console.log(`  FAIL: ${label}`)
  }
}

type IntentFilter = {
  action?: { $: Record<string, string> }[]
  category?: { $: Record<string, string> }[]
  data?: { $: Record<string, string> }[]
}

type Activity = {
  $: Record<string, string>
  'intent-filter'?: IntentFilter[]
}

/** Minimal shape of the generated manifest, with one launcher activity. */
function manifestFixture(activityExtras: Partial<Activity> = {}) {
  const activity: Activity = {
    $: { 'android:name': '.MainActivity' },
    'intent-filter': [
      {
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
      },
    ],
    ...activityExtras,
  }
  return {
    manifest: {
      application: [{ $: { 'android:name': '.MainApplication' }, activity: [activity] }],
    },
  }
}

/**
 * Runs the plugin the way Expo does.
 *
 * `withAndroidManifest` registers a mod rather than applying it, so the config
 * returned by the plugin carries the function under `mods.android.manifest`.
 * Calling that with a manifest is what actually exercises the plugin body.
 */
async function applyPlugin(manifest: ReturnType<typeof manifestFixture>) {
  const config = withHaptixMwa({ name: 'Haptix', slug: 'haptix' } as never) as {
    mods?: { android?: { manifest?: (cfg: unknown) => unknown | Promise<unknown> } }
  }
  const mod = config.mods?.android?.manifest
  if (typeof mod !== 'function') {
    throw new Error('plugin did not register an android manifest mod')
  }
  const result = (await mod({ modResults: manifest, modRequest: {} })) as {
    modResults: ReturnType<typeof manifestFixture>
  }
  return result.modResults
}

function mainActivity(manifest: ReturnType<typeof manifestFixture>): Activity {
  return manifest.manifest.application[0].activity[0] as Activity
}

function mwaFilters(manifest: ReturnType<typeof manifestFixture>): IntentFilter[] {
  const filters = mainActivity(manifest)['intent-filter'] ?? []
  return filters.filter((f) => (f.data ?? []).some((d) => d.$['android:scheme'] === 'solana-wallet'))
}

async function run() {
  console.log('--- MWA CONFIG PLUGIN ---')

  const applied = await applyPlugin(manifestFixture())
  const filters = mwaFilters(applied)

  assert(filters.length === 1, 'adds exactly one solana-wallet intent-filter')

  const filter = filters[0]
  const actions = (filter.action ?? []).map((a) => a.$['android:name'])
  const categories = (filter.category ?? []).map((c) => c.$['android:name'])
  const schemes = (filter.data ?? []).map((d) => d.$['android:scheme'])

  // Per the MWA spec: dApps fire ACTION_VIEW at the solana-wallet scheme, and
  // BROWSABLE is required for the association URI to resolve.
  assert(actions.includes('android.intent.action.VIEW'), 'declares the VIEW action')
  assert(categories.includes('android.intent.category.BROWSABLE'), 'declares the BROWSABLE category')
  assert(categories.includes('android.intent.category.DEFAULT'), 'declares the DEFAULT category')
  assert(schemes.length === 1 && schemes[0] === 'solana-wallet', 'matches only the solana-wallet scheme')

  // The launcher filter must survive, or the app disappears from the home screen.
  const all = mainActivity(applied)['intent-filter'] ?? []
  const launcher = all.filter((f) =>
    (f.category ?? []).some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER'),
  )
  assert(launcher.length === 1, 'leaves the existing launcher intent-filter in place')
  assert(all.length === 2, 'adds to the activity rather than replacing its filters')

  // Prebuild can run repeatedly over a manifest the plugin already touched.
  const twice = await applyPlugin(applied)
  assert(mwaFilters(twice).length === 1, 'is idempotent: a second run adds no duplicate')

  // An activity with no intent-filter array at all must not crash the plugin.
  const bare = await applyPlugin(manifestFixture({ 'intent-filter': undefined }))
  assert(mwaFilters(bare).length === 1, 'handles an activity that has no intent-filter yet')

  console.log(`MWA PLUGIN TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  if (failed > 0) process.exit(1)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
