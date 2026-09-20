import { Platform } from 'react-native'

/**
 * Cross-platform clipboard helper.
 * Uses navigator.clipboard on Web and safely requires @react-native-clipboard/clipboard on Native.
 */
export async function setString(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Fallback for older web contexts
      }
    }
    return
  }

  try {
    const Clipboard = require('@react-native-clipboard/clipboard').default
    Clipboard.setString(text)
  } catch {
    // ignore
  }
}

export async function getString(): Promise<string> {
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return ''
      }
    }
    return ''
  }

  try {
    const Clipboard = require('@react-native-clipboard/clipboard').default
    return await Clipboard.getString()
  } catch {
    return ''
  }
}

const Clipboard = {
  setString,
  getString,
}

export default Clipboard
