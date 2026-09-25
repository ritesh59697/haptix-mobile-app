import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  StatusBar,
} from 'react-native'
import { HaptixBrandMark } from '@/components/haptix/haptix-icons'

interface HaptixAppLoaderProps {
  message?: string
  subMessage?: string
}

export function HaptixAppLoader({
  message = 'Securing biometric enclave…',
  subMessage = 'Solana Mobile Smart Account',
}: HaptixAppLoaderProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current
  const glowAnim = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.06,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.85,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.4,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    )

    pulseLoop.start()
    return () => pulseLoop.stop()
  }, [glowAnim, pulseAnim])

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#08070F" />

      <View style={styles.centerContent}>
        {/* Ambient Glow */}
        <Animated.View
          style={[
            styles.ambientGlow,
            {
              opacity: glowAnim,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />

        {/* Brand Icon Container */}
        <Animated.View
          style={[
            styles.iconWrapper,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <HaptixBrandMark size={44} color="#FFFFFF" />
        </Animated.View>

        {/* App Title */}
        <Text style={styles.title}>HAPTIX</Text>

        {/* Subtitle Badge */}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{subMessage.toUpperCase()}</Text>
        </View>

        {/* Loading Indicator & Status */}
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color="#9C93FF" />
          <Text style={styles.statusText}>{message}</Text>
        </View>
      </View>

      {/* Footer reassurance */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Hardware-Secured · Non-Custodial</Text>
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
    paddingHorizontal: 24,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ambientGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(108, 106, 243, 0.22)',
    filter: 'blur(24px)',
  },
  iconWrapper: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#141419',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#6C6AF3',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 3,
    color: '#F4F4F7',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(156, 147, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(156, 147, 255, 0.24)',
    marginBottom: 28,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#9C93FF',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#A0A0AC',
    letterSpacing: 0.2,
  },
  footer: {
    position: 'absolute',
    bottom: 36,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#555562',
    letterSpacing: 0.8,
  },
})
