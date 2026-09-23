import { Buffer } from 'buffer'

// Installs the platform CSPRNG as `global.crypto.getRandomValues`.
//
// Solana key generation reads global `crypto`, and `Math.random()` is not an
// acceptable substitute for a wallet: it is seeded predictably, so every address
// (and every agent keypair derived from one) would be guessable. The module is a
// native dependency, but it is bundled into Expo Go and autolinked into dev builds,
// so it is present in every runtime this app supports. `polyfill.web.js` covers the
// web bundle, where the browser already provides the real thing.
import 'react-native-get-random-values'

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

// Fail closed. If the CSPRNG is somehow absent, refusing to start is the only safe
// outcome; silently falling back to a non-cryptographic source would produce a wallet
// that looks functional while deriving predictable keys.
if (typeof global.crypto !== 'object' || typeof global.crypto.getRandomValues !== 'function') {
  throw new Error(
    'crypto.getRandomValues is unavailable (react-native-get-random-values did not install). ' +
      'Refusing to start with an insecure random source.',
  )
}
