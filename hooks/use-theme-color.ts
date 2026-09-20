/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/colors'
import { useAppTheme } from '@/components/theme/theme-context'
import { useColorScheme as useRNColorScheme } from 'react-native'

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
) {
  const systemScheme = useRNColorScheme() === 'dark' ? 'dark' : 'light'
  let colorScheme: 'dark' | 'light' = systemScheme

  try {
    const { isDark } = useAppTheme()
    colorScheme = isDark ? 'dark' : 'light'
  } catch {
    // Outside theme provider fallback to system
  }

  const colorFromProps = props[colorScheme]

  if (colorFromProps) {
    return colorFromProps
  } else {
    return Colors[colorScheme][colorName]
  }
}
