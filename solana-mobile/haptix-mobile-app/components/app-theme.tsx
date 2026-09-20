import React, { PropsWithChildren } from 'react'
import {
  DarkTheme as AppThemeDark,
  DefaultTheme as AppThemeLight,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native'
import { ThemeProvider as HaptixThemeProvider, useAppTheme } from '@/components/theme/theme-context'

export { useAppTheme }

function NavigationThemeBridge({ children }: PropsWithChildren) {
  const { isDark } = useAppTheme()
  const navTheme = isDark ? AppThemeDark : AppThemeLight

  return <NavThemeProvider value={navTheme}>{children}</NavThemeProvider>
}

export function AppTheme({ children }: PropsWithChildren) {
  return (
    <HaptixThemeProvider>
      <NavigationThemeBridge>{children}</NavigationThemeBridge>
    </HaptixThemeProvider>
  )
}
