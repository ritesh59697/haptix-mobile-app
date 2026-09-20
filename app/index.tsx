import React from 'react'
import { Redirect } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'

export default function Index() {
  const { isAuthenticated } = useAuth()

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/account" />
  }

  return <Redirect href="/sign-in" />
}
