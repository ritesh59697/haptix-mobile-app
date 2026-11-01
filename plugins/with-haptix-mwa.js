/**
 * Registers Haptix as a Mobile Wallet Adapter wallet provider.
 *
 * A dApp starts an MWA session by firing a `solana-wallet:` intent, so the
 * wallet has to declare an intent-filter for that scheme. This project has no
 * checked-in `android/` directory (Expo CNG regenerates it on prebuild), so the
 * filter is added here rather than by hand.
 *
 * The filter goes on the main activity: walletlib needs the caller's identity,
 * which Android only provides to the activity that received the intent.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins')

const { getMainActivityOrThrow } = AndroidConfig.Manifest

/** The scheme dApps use to associate with a wallet, per the MWA spec. */
const MWA_SCHEME = 'solana-wallet'

/**
 * Matches the association intent-filter, so repeated prebuilds do not stack
 * duplicates. Keyed on the scheme rather than the whole shape: that is what
 * makes this filter ours.
 */
function isMwaIntentFilter(filter) {
  return (filter?.data ?? []).some((entry) => entry?.$?.['android:scheme'] === MWA_SCHEME)
}

const withHaptixMwa = (config) =>
  withAndroidManifest(config, (cfg) => {
    const activity = getMainActivityOrThrow(cfg.modResults)
    activity['intent-filter'] = activity['intent-filter'] ?? []

    if (activity['intent-filter'].some(isMwaIntentFilter)) {
      return cfg
    }

    activity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      // DEFAULT lets startActivityForResult resolve it; BROWSABLE is required
      // by the spec so a dApp can hand the URI to the system.
      category: [
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      ],
      data: [{ $: { 'android:scheme': MWA_SCHEME } }],
    })

    return cfg
  })

module.exports = withHaptixMwa
