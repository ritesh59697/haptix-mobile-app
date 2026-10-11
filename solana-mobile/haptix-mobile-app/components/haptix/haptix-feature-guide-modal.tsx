import React, { useState, useRef, useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from 'react-native-svg'
import { useAppTheme } from '@/components/theme/theme-context'

export const HAPTIX_GUIDE_STORAGE_KEY = '@haptix_has_seen_guide_v1'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

interface GuideBullet {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  detail: string
}

interface GuideSlide {
  id: string
  badge: string
  badgeColor: string
  badgeBg: string
  title: string
  highlight: string
  subtitle: string
  bullets: GuideBullet[]
  renderVisual: (isDark: boolean) => React.ReactNode
}

export interface HaptixFeatureGuideModalProps {
  visible: boolean
  onClose: () => void
  /**
   * If true, saves the "has seen guide" flag to AsyncStorage upon close.
   * Default: true
   */
  persistDismissal?: boolean
}

export function HaptixFeatureGuideModal({
  visible,
  onClose,
  persistDismissal = true,
}: HaptixFeatureGuideModalProps) {
  const insets = useSafeAreaInsets()
  const { theme, isDark } = useAppTheme()
  const [currentIndex, setCurrentIndex] = useState(0)
  const scrollRef = useRef<ScrollView>(null)

  // Animated glow opacity
  const pulseAnim = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    ).start()
  }, [pulseAnim])

  // Reset index whenever opened
  useEffect(() => {
    if (visible) {
      setCurrentIndex(0)
      scrollRef.current?.scrollTo({ x: 0, animated: false })
    }
  }, [visible])

  const handleDismiss = async () => {
    if (persistDismissal) {
      try {
        await AsyncStorage.setItem(HAPTIX_GUIDE_STORAGE_KEY, 'true')
      } catch (err) {
        console.warn('[Haptix] Failed to save guide dismissal flag', err)
      }
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onClose()
  }

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      const nextIndex = currentIndex + 1
      scrollRef.current?.scrollTo({ x: nextIndex * SCREEN_WIDTH, animated: true })
      setCurrentIndex(nextIndex)
      void Haptics.selectionAsync()
    } else {
      void handleDismiss()
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1
      scrollRef.current?.scrollTo({ x: prevIndex * SCREEN_WIDTH, animated: true })
      setCurrentIndex(prevIndex)
      void Haptics.selectionAsync()
    }
  }

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x
    const newIndex = Math.round(offsetX / SCREEN_WIDTH)
    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < slides.length) {
      setCurrentIndex(newIndex)
      void Haptics.selectionAsync()
    }
  }

  const slides: GuideSlide[] = [
    {
      id: 'self-custody',
      badge: 'Zero-Custody Architecture',
      badgeColor: '#10B981',
      badgeBg: isDark ? 'rgba(16, 185, 129, 0.12)' : '#ECFDF5',
      title: 'Seedless & 100%',
      highlight: 'Self-Custodial',
      subtitle:
        'No 24-word seed phrases to write down or lose. Private keys never leave your phone’s hardware enclave (Android StrongBox) — zero server custody.',
      bullets: [
        {
          icon: 'security',
          label: '100% Self-Custodial',
          detail: 'Haptix never holds or controls your funds or keys',
        },
        {
          icon: 'phonelink-lock',
          label: 'Hardware StrongBox',
          detail: 'Passkey is physically generated in phone hardware',
        },
        {
          icon: 'verified',
          label: 'On-Chain Introspection',
          detail: 'Solana native Secp256r1 precompile verification',
        },
      ],
      renderVisual: () => (
        <View style={styles.visualContainer}>
          <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
            <Defs>
              <LinearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#10B981" stopOpacity="0.8" />
                <Stop offset="100%" stopColor="#059669" stopOpacity="0.2" />
              </LinearGradient>
            </Defs>
            <Circle cx="60" cy="60" r="54" fill="rgba(16, 185, 129, 0.08)" />
            <Circle cx="60" cy="60" r="42" fill="url(#shieldGrad)" />
            {/* Shield outline */}
            <Path
              d="M60 26L84 37V61C84 75.5 73.8 88.8 60 92C46.2 88.8 36 75.5 36 61V37L60 26Z"
              stroke="#10B981"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {/* Lock in center */}
            <Rect x="51" y="55" width="18" height="15" rx="3" fill="#FFFFFF" />
            <Path
              d="M55 55V49C55 46.2 57.2 44 60 44C62.8 44 65 46.2 65 49V55"
              stroke="#FFFFFF"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <Circle cx="60" cy="62" r="1.5" fill="#059669" />
          </Svg>
        </View>
      ),
    },
    {
      id: 'biometrics',
      badge: 'Sub-Second Execution',
      badgeColor: '#6366F1',
      badgeBg: isDark ? 'rgba(99, 102, 241, 0.12)' : '#EEF2FF',
      title: '1-Tap Biometric',
      highlight: 'Passkey Speed',
      subtitle:
        'Sign transactions in ~400ms using your fingerprint or Face ID. Zero seed phrase popups, zero seed vulnerability, seamless mobile feel.',
      bullets: [
        {
          icon: 'fingerprint',
          label: 'Sub-Second Signing',
          detail: 'Biometric authorization verified in ~400 milliseconds',
        },
        {
          icon: 'bolt',
          label: 'Solana Mobile Stack Native',
          detail: 'Built directly for Android Keystore and Solana Seeker',
        },
        {
          icon: 'check-circle',
          label: 'WYSIWYS Cryptography',
          detail: 'What You See Is What You Sign recipient validation',
        },
      ],
      renderVisual: () => (
        <View style={styles.visualContainer}>
          <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
            <Defs>
              <LinearGradient id="fingerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#6366F1" stopOpacity="0.8" />
                <Stop offset="100%" stopColor="#4F46E5" stopOpacity="0.2" />
              </LinearGradient>
            </Defs>
            <Circle cx="60" cy="60" r="54" fill="rgba(99, 102, 241, 0.08)" />
            <Circle cx="60" cy="60" r="42" fill="url(#fingerGrad)" />
            {/* Fingerprint concentric curves */}
            <Path
              d="M60 40C48.9 40 40 48.9 40 60C40 65.5 42.2 70.5 45.9 74.1"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <Path
              d="M74.1 74.1C77.8 70.5 80 65.5 80 60C80 48.9 71.1 40 60 40"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <Path
              d="M60 48C53.4 48 48 53.4 48 60C48 66.6 53.4 72 60 72"
              stroke="#A5B4FC"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <Path
              d="M60 56C57.8 56 56 57.8 56 60C56 64 60 67 60 67"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <Circle cx="60" cy="60" r="3" fill="#6366F1" />
          </Svg>
        </View>
      ),
    },
    {
      id: 'adaptive-security',
      badge: 'Mathematical Protection',
      badgeColor: '#F59E0B',
      badgeBg: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FEF3C7',
      title: 'Risk-Adaptive',
      highlight: 'Spending Quorum',
      subtitle:
        'Low-risk transfers (≤ 0.1 SOL) confirm with 1 tap. High-risk amounts (> 0.1 SOL) enforce a mathematical 2-of-2 hardware quorum across devices.',
      bullets: [
        {
          icon: 'speed',
          label: 'Low-Risk Fast Lane',
          detail: '1-tap biometric passkey for everyday micro-spends',
        },
        {
          icon: 'devices',
          label: '2-of-2 Hardware Quorum',
          detail: 'Requires Phone + Mac/Backup passkey for large spends',
        },
        {
          icon: 'lock',
          label: 'Circuit Breaker & Panic',
          detail: '1-tap on-chain freeze and 24h timelocked recovery',
        },
      ],
      renderVisual: () => (
        <View style={styles.visualContainer}>
          <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
            <Defs>
              <LinearGradient id="quorumGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#F59E0B" stopOpacity="0.8" />
                <Stop offset="100%" stopColor="#D97706" stopOpacity="0.2" />
              </LinearGradient>
            </Defs>
            <Circle cx="60" cy="60" r="54" fill="rgba(245, 158, 11, 0.08)" />
            <Circle cx="60" cy="60" r="42" fill="url(#quorumGrad)" />
            {/* Device 1 (Phone) */}
            <Rect x="42" y="44" width="16" height="28" rx="3" stroke="#FFFFFF" strokeWidth="2" fill="none" />
            <Circle cx="50" cy="67" r="1.5" fill="#FFFFFF" />
            {/* Device 2 (Laptop/Hardware) */}
            <Rect x="64" y="48" width="22" height="18" rx="2" stroke="#FDE68A" strokeWidth="2" fill="none" />
            <Path d="M60 68H90" stroke="#FDE68A" strokeWidth="2" strokeLinecap="round" />
            {/* Plus sign linking them */}
            <Path d="M60 55V61M57 58H63" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
          </Svg>
        </View>
      ),
    },
    {
      id: 'ai-agents',
      badge: 'Solana Mobile & Seeker',
      badgeColor: '#3B82F6',
      badgeBg: isDark ? 'rgba(59, 130, 246, 0.12)' : '#EFF6FF',
      title: 'Autonomous AI &',
      highlight: 'Seeker Ready',
      subtitle:
        'Delegate bounded trading budgets to AI agents (Jupiter Auto-DCA) without signing every swap. Natively integrated with Solana Seeker (SKR) tokens.',
      bullets: [
        {
          icon: 'smart-toy',
          label: 'AI Session Keys',
          detail: 'Temporary, budget-constrained trading authority',
        },
        {
          icon: 'stars',
          label: 'Seeker (SKR) Rewards',
          detail: '100 SKR welcome allocation & dynamic token rules',
        },
        {
          icon: 'local-gas-station',
          label: 'Gasless Paymaster',
          detail: 'Devnet account rent and gas sponsored automatically',
        },
      ],
      renderVisual: () => (
        <View style={styles.visualContainer}>
          <Svg width={120} height={120} viewBox="0 0 120 120" fill="none">
            <Defs>
              <LinearGradient id="aiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#3B82F6" stopOpacity="0.8" />
                <Stop offset="100%" stopColor="#2563EB" stopOpacity="0.2" />
              </LinearGradient>
            </Defs>
            <Circle cx="60" cy="60" r="54" fill="rgba(59, 130, 246, 0.08)" />
            <Circle cx="60" cy="60" r="42" fill="url(#aiGrad)" />
            {/* Robot Head */}
            <Rect x="44" y="45" width="32" height="26" rx="6" stroke="#FFFFFF" strokeWidth="2.2" fill="none" />
            <Circle cx="53" cy="56" r="3" fill="#60A5FA" />
            <Circle cx="67" cy="56" r="3" fill="#60A5FA" />
            <Path d="M54 65H66" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
            {/* Antenna */}
            <Path d="M60 45V37" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
            <Circle cx="60" cy="35" r="2.5" fill="#60A5FA" />
          </Svg>
        </View>
      ),
    },
  ]

  const activeSlide = slides[currentIndex]

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={handleDismiss}
      statusBarTranslucent={true}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.modalContainer,
            {
              backgroundColor: isDark ? '#09090C' : '#FFFFFF',
              borderColor: isDark ? '#1F1F24' : '#E2E8F0',
              paddingTop: Math.max(insets.top + 8, 24),
              paddingBottom: Math.max(insets.bottom + 12, 24),
            },
          ]}
        >
          {/* Top Bar: Progress Pills & Skip */}
          <View style={styles.topBar}>
            <View style={styles.pillsRow}>
              {slides.map((slide, idx) => (
                <View
                  key={slide.id}
                  style={[
                    styles.pillIndicator,
                    {
                      backgroundColor:
                        idx === currentIndex
                          ? activeSlide.badgeColor
                          : idx < currentIndex
                          ? isDark
                            ? 'rgba(255, 255, 255, 0.4)'
                            : '#94A3B8'
                          : isDark
                          ? '#1C1C22'
                          : '#E2E8F0',
                      width: idx === currentIndex ? 24 : 8,
                    },
                  ]}
                />
              ))}
            </View>

            <TouchableOpacity
              onPress={handleDismiss}
              style={styles.skipButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Text style={[styles.skipText, { color: isDark ? '#71717A' : '#64748B' }]}>
                Skip
              </Text>
              <MaterialIcons
                name="close"
                size={18}
                color={isDark ? '#71717A' : '#64748B'}
              />
            </TouchableOpacity>
          </View>

          {/* Horizontal Slide ScrollView */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScrollEnd}
            style={styles.carouselScroll}
          >
            {slides.map((slide) => (
              <View key={slide.id} style={styles.slidePage}>
                {/* Visual Graphic */}
                {slide.renderVisual(isDark)}

                {/* Badge Chip */}
                <View style={[styles.badgeChip, { backgroundColor: slide.badgeBg }]}>
                  <View style={[styles.badgeDot, { backgroundColor: slide.badgeColor }]} />
                  <Text style={[styles.badgeText, { color: slide.badgeColor }]}>
                    {slide.badge}
                  </Text>
                </View>

                {/* Headlines */}
                <Text style={[styles.slideTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                  {slide.title}{' '}
                  <Text style={{ color: slide.badgeColor }}>{slide.highlight}</Text>
                </Text>

                <Text style={[styles.slideSubtitle, { color: isDark ? '#A1A1AA' : '#475569' }]}>
                  {slide.subtitle}
                </Text>

                {/* Feature Bullet Cards */}
                <View style={styles.bulletList}>
                  {slide.bullets.map((bullet, bIdx) => (
                    <View
                      key={bIdx}
                      style={[
                        styles.bulletCard,
                        {
                          backgroundColor: isDark ? '#121217' : '#F8FAFC',
                          borderColor: isDark ? '#1E1E24' : '#E2E8F0',
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.bulletIconBox,
                          {
                            backgroundColor: isDark
                              ? 'rgba(255, 255, 255, 0.05)'
                              : '#EEF2FF',
                          },
                        ]}
                      >
                        <MaterialIcons
                          name={bullet.icon}
                          size={18}
                          color={slide.badgeColor}
                        />
                      </View>
                      <View style={styles.bulletTextBox}>
                        <Text
                          style={[
                            styles.bulletLabel,
                            { color: isDark ? '#F4F4F5' : '#0F172A' },
                          ]}
                        >
                          {bullet.label}
                        </Text>
                        <Text
                          style={[
                            styles.bulletDetail,
                            { color: isDark ? '#71717A' : '#64748B' },
                          ]}
                        >
                          {bullet.detail}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Bottom Action Footer */}
          <View style={styles.bottomFooter}>
            {currentIndex > 0 ? (
              <TouchableOpacity
                onPress={handlePrev}
                style={[
                  styles.prevButton,
                  {
                    backgroundColor: isDark ? '#18181B' : '#F1F5F9',
                    borderColor: isDark ? '#27272A' : '#E2E8F0',
                  },
                ]}
                activeOpacity={0.7}
              >
                <MaterialIcons
                  name="arrow-back"
                  size={18}
                  color={isDark ? '#E4E4E7' : '#0F172A'}
                />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 48 }} />
            )}

            <TouchableOpacity
              onPress={handleNext}
              style={[
                styles.primaryNextButton,
                {
                  backgroundColor:
                    currentIndex === slides.length - 1
                      ? activeSlide.badgeColor
                      : isDark
                      ? '#FFFFFF'
                      : '#0F172A',
                },
              ]}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.primaryNextText,
                  {
                    color:
                      currentIndex === slides.length - 1
                        ? '#FFFFFF'
                        : isDark
                        ? '#000000'
                        : '#FFFFFF',
                  },
                ]}
              >
                {currentIndex === slides.length - 1 ? 'Get Started' : 'Next'}
              </Text>
              <MaterialIcons
                name={currentIndex === slides.length - 1 ? 'check' : 'arrow-forward'}
                size={18}
                color={
                  currentIndex === slides.length - 1
                    ? '#FFFFFF'
                    : isDark
                    ? '#000000'
                    : '#FFFFFF'
                }
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
  },
  modalContainer: {
    flex: 1,
    borderWidth: 0,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillIndicator: {
    height: 6,
    borderRadius: 3,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  carouselScroll: {
    flex: 1,
  },
  slidePage: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualContainer: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  slideTitle: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  slideSubtitle: {
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 6,
  },
  bulletList: {
    width: '100%',
    gap: 8,
  },
  bulletCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 0.5,
    gap: 12,
  },
  bulletIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletTextBox: {
    flex: 1,
  },
  bulletLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 1,
  },
  bulletDetail: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  bottomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 12,
  },
  prevButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryNextButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryNextText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
})
