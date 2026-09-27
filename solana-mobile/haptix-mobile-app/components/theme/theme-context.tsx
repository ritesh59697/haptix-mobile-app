import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'
import { useColorScheme as useDeviceColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ThemeTokens, darkTokens, lightTokens } from '@/theme/tokens'

type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  theme: ThemeTokens
  colorScheme: 'light' | 'dark'
  isDark: boolean
  themePreference: ThemeMode
  setThemePreference: (pref: ThemeMode) => Promise<void>
  toggleTheme: () => Promise<void>
}

const STORAGE_KEY = '@haptix_theme_preference'

const ThemeContext = createContext<ThemeContextValue>({
  theme: lightTokens,
  colorScheme: 'light',
  isDark: false,
  themePreference: 'light',
  setThemePreference: async () => {},
  toggleTheme: async () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const deviceColorScheme = useDeviceColorScheme()
  const [themePreference, setThemePreferenceState] = useState<ThemeMode>('light')

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'system' || saved === 'light' || saved === 'dark') {
          setThemePreferenceState(saved)
        }
      })
      .catch(() => {})
  }, [])

  const activeColorScheme: 'light' | 'dark' =
    themePreference === 'system' ? (deviceColorScheme === 'light' ? 'light' : 'dark') : themePreference

  const theme = activeColorScheme === 'light' ? lightTokens : darkTokens

  const setThemePreference = useCallback(async (pref: ThemeMode) => {
    setThemePreferenceState(pref)
    try {
      await AsyncStorage.setItem(STORAGE_KEY, pref)
    } catch {
      // ignore
    }
  }, [])

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = activeColorScheme === 'dark' ? 'light' : 'dark'
    await setThemePreference(next)
  }, [activeColorScheme, setThemePreference])

  // Built once per palette instead of once per render. The inline object this replaces
  // was a new identity on every provider render, so every `useAppTheme()` consumer --
  // the dock, the wallet screen, and any row that reads the palette -- re-rendered
  // whenever the provider did. That also quietly defeated `React.memo` on those
  // components: a memoized component whose context value changes on every render never
  // gets to skip one. `theme` is one of two frozen token objects, so it is stable.
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      colorScheme: activeColorScheme,
      isDark: activeColorScheme === 'dark',
      themePreference,
      setThemePreference,
      toggleTheme,
    }),
    [theme, activeColorScheme, themePreference, setThemePreference, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useAppTheme() {
  return useContext(ThemeContext)
}
