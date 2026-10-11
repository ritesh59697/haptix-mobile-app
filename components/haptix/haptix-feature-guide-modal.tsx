import React, { useState, useRef, useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAppTheme } from '@/components/theme/theme-context'

export const HAPTIX_GUIDE_STORAGE_KEY = '@haptix_has_seen_guide_v1'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

interface GuideSlide {
  id: string
  title: string
  subtitle: string
  renderVisual: () => React.ReactNode
}

export interface HaptixFeatureGuideModalProps {
  visible: boolean
  onClose: () => void
  onCreateWallet?: () => void
  onSignIn?: () => void
  /**
   * If true, saves the "has seen guide" flag to AsyncStorage upon close.
   * Default: true
   */
  persistDismissal?: boolean
}

export function HaptixFeatureGuideModal({
  visible,
  onClose,
  onCreateWallet,
  onSignIn,
  persistDismissal = true,
}: HaptixFeatureGuideModalProps) {
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const [currentIndex, setCurrentIndex] = useState(0)

  // Fade & slide animation when changing steps
  const fadeAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current

  const slides: GuideSlide[] = [
    {
      id: 'seedless',
      title: 'No seed phrase to lose',
      subtitle:
        "Your fingerprint unlocks your wallet. The key stays in your phone's hardware secure chip and never leaves it — 100% self-custodial.",
      renderVisual: () => (
        <View style={styles.slide1OuterCircle}>
          <View style={styles.slide1InnerCircle}>
            <MaterialIcons name="fingerprint" size={38} color="#6c8cff" />
          </View>
        </View>
      ),
    },
    {
      id: 'two-keys',
      title: 'Big sends need two keys',
      subtitle:
        "Choose your limit. Anything above it needs a second key, so a stolen phone can't empty your wallet.",
      renderVisual: () => (
        <View style={styles.specCard}>
          <View style={styles.specRow}>
            <Text style={styles.specMonoText}>0.05 SOL</Text>
            <View style={styles.specRightWrap}>
              <MaterialIcons name="fingerprint" size={17} color="#b4b3ae" />
              <Text style={styles.specRightText}>One fingerprint</Text>
            </View>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specRow}>
            <Text style={styles.specMonoText}>1 SOL</Text>
            <View style={styles.specRightWrap}>
              <MaterialIcons name="fingerprint" size={17} color="#b4b3ae" />
              <MaterialIcons name="laptop" size={17} color="#b4b3ae" style={{ marginLeft: -2 }} />
              <Text style={styles.specRightText}>Both keys</Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 'recovery',
      title: 'Lose your phone, keep your wallet',
      subtitle:
        'A guardian you choose can start a recovery. They can never move your funds.',
      renderVisual: () => (
        <View style={[styles.specCard, { maxWidth: 310 }]}>
          <View style={styles.specRow}>
            <View style={styles.stepNumCircle}>
              <Text style={styles.stepNumText}>1</Text>
            </View>
            <Text style={styles.stepDescText}>Your guardian starts a recovery</Text>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specRow}>
            <View style={styles.stepNumCircle}>
              <Text style={styles.stepNumText}>2</Text>
            </View>
            <Text style={styles.stepDescText}>You have 24 hours to cancel it</Text>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specRow}>
            <View style={styles.stepNumCircle}>
              <Text style={styles.stepNumText}>3</Text>
            </View>
            <Text style={styles.stepDescText}>Your new phone takes over</Text>
          </View>
        </View>
      ),
    },
    {
      id: 'ai-seeker',
      title: 'Autonomous AI & Seeker ready',
      subtitle:
        'Delegate bounded trading budgets to AI agents without approving every swap. Natively built for Solana Mobile Stack & Seeker (SKR).',
      renderVisual: () => (
        <View style={[styles.specCard, { maxWidth: 310 }]}>
          <View style={styles.specRow}>
            <View style={styles.stepNumCircle}>
              <MaterialIcons name="smart-toy" size={12} color="#6c8cff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitleText}>AI Session Keys</Text>
              <Text style={styles.featureSubtitleText}>Bounded budget & timelocked trades</Text>
            </View>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specRow}>
            <View style={styles.stepNumCircle}>
              <MaterialIcons name="stars" size={12} color="#6c8cff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitleText}>Seeker (SKR) Ready</Text>
              <Text style={styles.featureSubtitleText}>Genesis rewards & gasless Devnet sponsor</Text>
            </View>
          </View>
        </View>
      ),
    },
  ]

  // Reset index whenever opened
  useEffect(() => {
    if (visible) {
      setCurrentIndex(0)
      fadeAnim.setValue(1)
      slideAnim.setValue(0)
    }
  }, [visible, fadeAnim, slideAnim])

  const transitionToSlide = (newIndex: number) => {
    void Haptics.selectionAsync()
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: newIndex > currentIndex ? -12 : 12,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentIndex(newIndex)
      slideAnim.setValue(newIndex > currentIndex ? 12 : -12)
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start()
    })
  }

  const handleDismiss = async () => {
    if (persistDismissal) {
      try {
        await AsyncStorage.setItem(HAPTIX_GUIDE_STORAGE_KEY, 'true')
      } catch (err) {
        console.warn('[Haptix] Failed to save guide dismissal flag', err)
      }
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onClose()
  }

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      transitionToSlide(currentIndex + 1)
    } else {
      if (onCreateWallet) {
        void handleDismiss()
        onCreateWallet()
      } else {
        void handleDismiss()
      }
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      transitionToSlide(currentIndex - 1)
    }
  }

  const handleSignIn = () => {
    void handleDismiss()
    if (onSignIn) {
      onSignIn()
    }
  }

  const isLast = currentIndex === slides.length - 1
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
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />

        <View
          style={[
            styles.cardContainer,
            {
              paddingTop: Math.max(insets.top + 10, 20),
              paddingBottom: Math.max(insets.bottom + 14, 24),
            },
          ]}
        >
          {/* 1. TOP BAR: Progress indicator pills & Skip */}
          <View style={styles.topBar}>
            <View style={styles.pillsRow}>
              {slides.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.pill,
                    {
                      width: idx === currentIndex ? 26 : 12,
                      backgroundColor: idx === currentIndex ? '#6c8cff' : '#2a2a2e',
                    },
                  ]}
                />
              ))}
            </View>

            {!isLast ? (
              <TouchableOpacity
                onPress={handleDismiss}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
              >
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 32 }} />
            )}
          </View>

          {/* 2. BODY CONTENT: Animated Visual + Title + Subtitle */}
          <Animated.View
            style={[
              styles.bodySection,
              {
                opacity: fadeAnim,
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            {/* Visual element */}
            <View style={styles.visualWrapper}>{activeSlide.renderVisual()}</View>

            {/* Title */}
            <Text style={styles.slideTitle}>{activeSlide.title}</Text>

            {/* Subtitle */}
            <Text style={styles.slideSubtitle}>{activeSlide.subtitle}</Text>
          </Animated.View>

          {/* 3. FOOTER ACTIONS: Back button + Next / Create button */}
          <View style={styles.footerSection}>
            <View style={styles.buttonRow}>
              {currentIndex > 0 ? (
                <TouchableOpacity
                  onPress={handlePrev}
                  style={styles.backButton}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="arrow-back" size={18} color="#f2f1ee" />
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={handleNext}
                style={[styles.primaryButton, currentIndex === 0 && { width: '100%' }]}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryButtonText}>
                  {isLast ? 'Create wallet' : 'Next'}
                </Text>
                {!isLast && (
                  <MaterialIcons name="arrow-forward" size={17} color="#0c0c0d" />
                )}
              </TouchableOpacity>
            </View>

            {/* Sub-footer on last slide: "Already have a wallet? Sign in" */}
            <View style={styles.subFooterWrap}>
              {isLast ? (
                <TouchableOpacity onPress={handleSignIn} activeOpacity={0.7}>
                  <Text style={styles.subFooterText}>
                    Already have a wallet?{' '}
                    <Text style={styles.signInLinkText}>Sign in</Text>
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  cardContainer: {
    backgroundColor: '#09090b',
    borderRadius: 22,
    borderWidth: 0.5,
    borderColor: '#2a2a28',
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 360,
    minHeight: 590,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    height: 4,
    borderRadius: 2,
  },
  skipText: {
    color: '#8a8985',
    fontSize: 13,
    fontWeight: '500',
  },
  bodySection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  visualWrapper: {
    minHeight: 180,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
  },
  slideTitle: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 30,
    color: '#f2f1ee',
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: 10,
  },
  slideSubtitle: {
    fontSize: 13.5,
    color: '#8a8985',
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 290,
  },
  // Slide 1 Visual
  slide1OuterCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#6c8cff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slide1InnerCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#17171a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Slide 2 & 3 Spec Card
  specCard: {
    borderWidth: 0.5,
    borderColor: '#2a2a28',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 2,
    backgroundColor: '#101012',
    width: '100%',
    maxWidth: 275,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 12,
  },
  specMonoText: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 13,
    fontWeight: '500',
    color: '#f2f1ee',
  },
  specRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  specRightText: {
    fontSize: 13,
    color: '#b4b3ae',
    fontWeight: '400',
  },
  specDivider: {
    height: 0.5,
    backgroundColor: '#202024',
  },
  // Slide 3 Step circle
  stepNumCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#6c8cff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    color: '#6c8cff',
    fontSize: 11,
    fontWeight: '500',
  },
  stepDescText: {
    fontSize: 13,
    color: '#f2f1ee',
    fontWeight: '400',
    flex: 1,
  },
  featureTitleText: {
    fontSize: 13,
    color: '#f2f1ee',
    fontWeight: '500',
  },
  featureSubtitleText: {
    fontSize: 11,
    color: '#8a8985',
    marginTop: 1,
  },
  // Footer
  footerSection: {
    width: '100%',
    paddingTop: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  backButton: {
    width: 50,
    height: 50,
    borderWidth: 0.5,
    borderColor: '#2a2a28',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  primaryButton: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#6c8cff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#0c0c0d',
    fontWeight: '500',
    fontSize: 14.5,
  },
  subFooterWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 20,
  },
  subFooterText: {
    color: '#8a8985',
    fontSize: 13,
  },
  signInLinkText: {
    color: '#6c8cff',
    fontWeight: '500',
  },
})
