import React from 'react'
import { Redirect } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'
import { HaptixAppLoader } from '@/components/haptix/haptix-app-loader'

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth()

  // Hold in the branded loading buffer while verifying stored credentials.
  // This prevents premature redirection to /sign-in on app boot when the user
  // already has an initialized wallet.
  if (isLoading) {
    return <HaptixAppLoader message="Securing biometric enclave…" />
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />
  }

  return <Redirect href="/sign-in" />
}
