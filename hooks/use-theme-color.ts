/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/colors'
import { useAppTheme } from '@/components/theme/theme-context'

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
) {
  // Called unconditionally: the provider ships a dark default, so this reads fine
  // outside it, and a hook behind a try/catch changes the hook order as soon as the
  // call once succeeds. The device scheme is not consulted at all — the provider is
  // the one place that decides between the stored preference and "follow system".
  const { isDark } = useAppTheme()
  const colorScheme: 'dark' | 'light' = isDark ? 'dark' : 'light'

  const colorFromProps = props[colorScheme]

  if (colorFromProps) {
    return colorFromProps
  } else {
    return Colors[colorScheme][colorName]
  }
}
