import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
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
  theme: darkTokens,
  colorScheme: 'dark',
  isDark: true,
  themePreference: 'dark',
  setThemePreference: async () => {},
  toggleTheme: async () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const deviceColorScheme = useDeviceColorScheme()
  const [themePreference, setThemePreferenceState] = useState<ThemeMode>('dark')

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

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colorScheme: activeColorScheme,
        isDark: activeColorScheme === 'dark',
        themePreference,
        setThemePreference,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useAppTheme() {
  return useContext(ThemeContext)
}
