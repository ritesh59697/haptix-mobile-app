import '../polyfill'
import { PortalHost } from '@rn-primitives/portal'
import { useFonts } from 'expo-font'
import { Stack , useSegments, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { AppProviders } from '@/components/app-providers'
import { useEffect, useCallback } from 'react'
import * as SplashScreen from 'expo-splash-screen'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTrackLocations } from '@/hooks/use-track-locations'
import { AppSplashController } from '@/components/app-splash-controller'
import { useAuth } from '@/components/auth/auth-provider'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  // The boundary sits above everything that can fail while rendering: the font loader
  // below, the provider tree, and the first screen. An error in any of them used to drop
  // the whole tree and leave a blank screen with nothing to read.
  return (
    <AppErrorBoundary>
      <RootLayoutInner />
    </AppErrorBoundary>
  )
}

function RootLayoutInner() {
  // Use this hook to track the locations for analytics or debugging.
  // Delete if you don't need it.
  useTrackLocations((pathname, params) => {
    console.log(`Track ${pathname}`, { params })
  })
  const [loaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  })

  // `error` is a hard failure: `useFonts` has already given up, so waiting on `loaded`
  // below would wait forever. Throwing here hands it to the boundary, which prints it.
  if (fontError) throw fontError

  const onLayoutRootView = useCallback(async () => {
    // Layout completed. Splash hiding is coordinated with Auth hydration via AppSplashController.
  }, [])

  if (!loaded) {
    return (
      <View style={styles.booting}>
        <ActivityIndicator color="#9C93FF" />
        <Text style={styles.bootingText}>Loading Haptix…</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AppProviders>
        <AppSplashController fontsLoaded={loaded} />
        <RootNavigator />
        <StatusBar style="auto" />
      </AppProviders>
      <PortalHost />
    </View>
  )
}

// Plain styles on purpose: this view renders before the theme provider exists.
const styles = StyleSheet.create({
  booting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#0b0f17',
  },
  bootingText: {
    color: '#9aa4b8',
    fontSize: 13,
  },
})

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(tabs)'
    if (!isAuthenticated && inAuthGroup) {
      router.replace('/sign-in')
    } else if (isAuthenticated && segments[0] === 'sign-in') {
      router.replace('/(tabs)')
    }
  }, [isAuthenticated, isLoading, segments])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="+not-found" />
    </Stack>
  )
}
