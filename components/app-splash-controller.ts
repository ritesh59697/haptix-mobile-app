import { useEffect, useRef } from 'react'
import * as SplashScreen from 'expo-splash-screen'
import { useAuth } from '@/components/auth/auth-provider'

interface AppSplashControllerProps {
  fontsLoaded?: boolean
}

export function AppSplashController({ fontsLoaded = true }: AppSplashControllerProps) {
  const { isLoading } = useAuth()
  const hasHiddenRef = useRef(false)

  useEffect(() => {
    // Only hide the native splash screen when both fonts and wallet auth state are hydrated
    if (fontsLoaded && !isLoading && !hasHiddenRef.current) {
      hasHiddenRef.current = true
      // Small tick allowing the destination screen (either /(tabs) or /sign-in)
      // to paint its first frame underneath the native splash screen before reveal.
      const timer = setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {})
      }, 60)
      return () => clearTimeout(timer)
    }
  }, [fontsLoaded, isLoading])

  return null
}
