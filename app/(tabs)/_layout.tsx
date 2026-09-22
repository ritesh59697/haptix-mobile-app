import { Tabs } from 'expo-router'
import React from 'react'

export default function TabLayout() {
  // The app's own dock (HaptixFloatingDock) handles in-app navigation, so the
  // tab bar stays hidden. Only the wallet and settings routes exist.
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tabs.Screen name="index" options={{ tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarItemStyle: { display: 'none' } }} />
    </Tabs>
  )
}
