// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    // The Privacy Rings spike has its own package.json and node_modules, which CI does not install.
    ignores: ['dist/*', 'tools/privacy-rings-spike/**'],
  },
])
