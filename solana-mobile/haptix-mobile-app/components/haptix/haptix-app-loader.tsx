import React from 'react'
import { StyleSheet, Text, View, StatusBar } from 'react-native'
import { SpinLoader } from '@/components/ui/spin-loader'

interface HaptixAppLoaderProps {
  message?: string
  subMessage?: string
}

/**
 * Minimal full-screen SpinLoader from Opensource UI.
 * Replaces the cluttered legacy layout with a clean, centered 8-spoke loader.
 */
export function HaptixAppLoader({ message }: HaptixAppLoaderProps) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#08070F" />
      <View style={styles.center}>
        <SpinLoader size="lg" color="#9C93FF" strokeWidth={2.4} />
        {message ? <Text style={styles.statusText}>{message}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08070F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E9B',
    letterSpacing: 0.2,
  },
})
