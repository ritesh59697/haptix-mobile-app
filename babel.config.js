// https://docs.expo.dev/versions/latest/config/babel/
//
// Same as Expo's default config, plus `unstable_transformImportMeta`. Hermes can't parse
// `import.meta`, and `@lightprotocol/hasher.rs` (the Privacy Rings SDK's Poseidon hasher) uses
// it, so without this the whole Android bundle fails to build. The transform only rewrites
// code that contains `import.meta`; the app's own code has none. See docs/PRIVATE_SEND_PLAN.md,
// section 3.2.
//
// `babel-preset-expo` is installed under `expo/`, not at the top of node_modules, so it is
// resolved from there rather than by bare name.
const presetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] })

module.exports = function (api) {
  api.cache(true)
  return {
    presets: [[presetExpo, { unstable_transformImportMeta: true }]],
  }
}
