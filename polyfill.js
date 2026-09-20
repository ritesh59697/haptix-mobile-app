import { Platform } from 'react-native'
import { Buffer } from 'buffer'

// Ensure global Buffer is always available on all platforms (Web, iOS, Android)
if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}
if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
  window.Buffer = Buffer
}
if (typeof global !== 'undefined' && typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer
}

if (Platform.OS !== 'web') {
  try {
    const { install } = require('react-native-quick-crypto')
    install()
  } catch (e) {
    console.warn('[Polyfill] react-native-quick-crypto install error:', e)
  }
}
