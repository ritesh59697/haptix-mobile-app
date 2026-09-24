import { Stack } from 'expo-router'
import React from 'react'

export default function SettingsLayout() {
  // The screen renders its own header, so the stack's is suppressed to avoid two.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="recovery" />
      <Stack.Screen name="limits" />
    </Stack>
  )
}
