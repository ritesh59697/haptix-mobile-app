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
  StatusBar as RNStatusBar,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
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
  renderVisual: (palette: GuidePalette) => React.ReactNode
}

interface GuidePalette {
  containerBg: string
  containerBorder: string
  textPrimary: string
  textSecondary: string
  textCard: string
  accent: string
  cardBg: string
  cardBorder: string
  cardDivider: string
  pillActive: string
  pillInactive: string
  iconBoxBg: string
  backBtnBg: string
  backBtnBorder: string
  primaryBtnBg: string
  primaryBtnText: string
  signInLink: string
  numberBadgeBorder: string
  numberBadgeText: string
}

const lightPalette: GuidePalette = {
  containerBg: '#fbfaf8',
  containerBorder: '#e6e4de',
  textPrimary: '#181714',
  textSecondary: '#6b6a64',
  textCard: '#4a4944',
  accent: '#5a6ee6',
  cardBg: '#ffffff',
  cardBorder: '#e6e4de',
  cardDivider: '#eeece7',
  pillActive: '#5a6ee6',
  pillInactive: '#dcd9d2',
  iconBoxBg: '#f1f0ec',
  backBtnBg: '#ffffff',
  backBtnBorder: '#e0ddd6',
  primaryBtnBg: '#5a6ee6',
  primaryBtnText: '#ffffff',
  signInLink: '#5a6ee6',
  numberBadgeBorder: '#5a6ee6',
  numberBadgeText: '#5a6ee6',
}

const darkPalette: GuidePalette = {
  containerBg: '#09090b',
  containerBorder: '#2a2a28',
  textPrimary: '#f2f1ee',
  textSecondary: '#8a8985',
  textCard: '#b4b3ae',
  accent: '#6c8cff',
  cardBg: '#101012',
  cardBorder: '#2a2a28',
  cardDivider: '#202024',
  pillActive: '#6c8cff',
  pillInactive: '#2a2a2e',
  iconBoxBg: '#17171a',
  backBtnBg: '#101012',
  backBtnBorder: '#2a2a28',
  primaryBtnBg: '#6c8cff',
  primaryBtnText: '#0c0c0d',
  signInLink: '#6c8cff',
  numberBadgeBorder: '#6c8cff',
  numberBadgeText: '#6c8cff',
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
  /**
   * If true, forces Claude's warm off-white light mode design (#fbfaf8 with #5a6ee6).
   * Default: true
   */
  forceLight?: boolean
}

export function HaptixFeatureGuideModal({
  visible,
  onClose,
  onCreateWallet,
  onSignIn,
  persistDismissal = true,
  forceLight = true,
}: HaptixFeatureGuideModalProps) {
  const insets = useSafeAreaInsets()
  const { isDark } = useAppTheme()
  const [currentIndex, setCurrentIndex] = useState(0)

  // Use light mode palette as requested by user
  const p = forceLight ? lightPalette : isDark ? darkPalette : lightPalette

  // Fade & slide animation when changing steps
  const fadeAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current

  const slides: GuideSlide[] = [
    {
      id: 'seedless',
      title: 'No seed phrase to lose',
      subtitle:
        "Your fingerprint unlocks your wallet. The key stays in your phone's secure chip and never leaves it.",
      renderVisual: (palette) => (
        <View
          style={[
            styles.slide1OuterCircle,
            { borderColor: palette.accent },
          ]}
        >
          <View
            style={[
              styles.slide1InnerCircle,
              { backgroundColor: palette.iconBoxBg },
            ]}
          >
            <MaterialIcons name="fingerprint" size={36} color={palette.accent} />
          </View>
        </View>
      ),
    },
    {
      id: 'two-keys',
      title: 'Big sends need two keys',
      subtitle:
        "Choose your limit. Anything above it needs a second key. Keep it on another device and a stolen phone can't empty your wallet.",
      renderVisual: (palette) => (
        <View
          style={[
            styles.specCard,
            {
              backgroundColor: palette.cardBg,
              borderColor: palette.cardBorder,
              maxWidth: 275,
            },
          ]}
        >
          <View style={styles.specRow}>
            <Text
              style={[
                styles.specMonoText,
                { color: palette.textPrimary },
              ]}
            >
              0.05 SOL
            </Text>
            <View style={styles.specRightWrap}>
              <MaterialIcons name="fingerprint" size={16} color={palette.textCard} />
              <Text style={[styles.specRightText, { color: palette.textCard }]}>
                One fingerprint
              </Text>
            </View>
          </View>
          <View style={[styles.specDivider, { backgroundColor: palette.cardDivider }]} />
          <View style={styles.specRow}>
            <Text
              style={[
                styles.specMonoText,
                { color: palette.textPrimary },
              ]}
            >
              1 SOL
            </Text>
            <View style={styles.specRightWrap}>
              <MaterialIcons name="fingerprint" size={16} color={palette.textCard} />
              <MaterialCommunityIcons
                name="key-outline"
                size={16}
                color={palette.textCard}
                style={{ marginLeft: -1 }}
              />
              <Text style={[styles.specRightText, { color: palette.textCard }]}>
                Both keys
              </Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 'recovery',
      title: "A lost phone isn't the end",
      subtitle:
        'Name a guardian or save your recovery key. A guardian can start a recovery, but can never move your funds.',
      renderVisual: (palette) => (
        <View
          style={[
            styles.specCard,
            {
              backgroundColor: palette.cardBg,
              borderColor: palette.cardBorder,
              maxWidth: 295,
            },
          ]}
        >
          <View style={styles.specRow}>
            <View
              style={[
                styles.stepNumCircle,
                { borderColor: palette.numberBadgeBorder },
              ]}
            >
              <Text style={[styles.stepNumText, { color: palette.numberBadgeText }]}>1</Text>
            </View>
            <Text style={[styles.stepDescText, { color: palette.textPrimary }]}>
              Your guardian starts a recovery
            </Text>
          </View>
          <View style={[styles.specDivider, { backgroundColor: palette.cardDivider }]} />
          <View style={styles.specRow}>
            <View
              style={[
                styles.stepNumCircle,
                { borderColor: palette.numberBadgeBorder },
              ]}
            >
              <Text style={[styles.stepNumText, { color: palette.numberBadgeText }]}>2</Text>
            </View>
            <Text style={[styles.stepDescText, { color: palette.textPrimary }]}>
              You have 24 hours to cancel it
            </Text>
          </View>
          <View style={[styles.specDivider, { backgroundColor: palette.cardDivider }]} />
          <View style={styles.specRow}>
            <View
              style={[
                styles.stepNumCircle,
                { borderColor: palette.numberBadgeBorder },
              ]}
            >
              <Text style={[styles.stepNumText, { color: palette.numberBadgeText }]}>3</Text>
            </View>
            <Text style={[styles.stepDescText, { color: palette.textPrimary }]}>
              Your new phone takes over
            </Text>
          </View>
        </View>
      ),
    },
    {
      id: 'ai-agents',
      title: 'Agents trade within limits',
      subtitle:
        'Give an AI agent a small budget for a set time, so it can trade without you approving every swap.',
      renderVisual: (palette) => (
        <View
          style={[
            styles.specCard,
            {
              backgroundColor: palette.cardBg,
              borderColor: palette.cardBorder,
              maxWidth: 295,
            },
          ]}
        >
          <View style={styles.specRow}>
            <View
              style={[
                styles.iconTileBox,
                { backgroundColor: palette.iconBoxBg },
              ]}
            >
              <MaterialCommunityIcons name="robot-outline" size={18} color={palette.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.featureTitleText,
                  { color: palette.textPrimary },
                ]}
              >
                AI agents
              </Text>
              <Text style={[styles.featureSubtitleText, { color: palette.textSecondary }]}>
                A budget and time limit you set
              </Text>
            </View>
          </View>
          <View style={[styles.specDivider, { backgroundColor: palette.cardDivider }]} />
          <View style={styles.specRow}>
            <View
              style={[
                styles.iconTileBox,
                { backgroundColor: palette.iconBoxBg },
              ]}
            >
              <MaterialCommunityIcons name="star-outline" size={18} color={palette.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.featureTitleText,
                  { color: palette.textPrimary },
                ]}
              >
                Seeker ready
              </Text>
              <Text style={[styles.featureSubtitleText, { color: palette.textSecondary }]}>
                Genesis rewards and free devnet fees
              </Text>
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
      RNStatusBar.setBarStyle('dark-content', true)
    }
  }, [visible, fadeAnim, slideAnim])

  const transitionToSlide = (newIndex: number) => {
    void Haptics.selectionAsync()
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: newIndex > currentIndex ? -10 : 10,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentIndex(newIndex)
      slideAnim.setValue(newIndex > currentIndex ? 10 : -10)
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 160,
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
      animationType="slide"
      transparent={false}
      onRequestClose={handleDismiss}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <StatusBar style="dark" backgroundColor={p.containerBg} />
      <View
        style={[
          styles.fullScreenPage,
          {
            backgroundColor: p.containerBg,
            paddingTop: Math.max(insets.top + 8, 20),
            paddingBottom: Math.max(insets.bottom + 12, 24),
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
                      backgroundColor:
                        idx === currentIndex ? p.pillActive : p.pillInactive,
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
                <Text style={[styles.skipText, { color: p.textSecondary }]}>Skip</Text>
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
            {/* Visual element (fixed height so typography never shifts) */}
            <View style={styles.visualWrapper}>{activeSlide.renderVisual(p)}</View>

            {/* Title */}
            <Text style={[styles.slideTitle, { color: p.textPrimary }]}>
              {activeSlide.title}
            </Text>

            {/* Subtitle */}
            <Text style={[styles.slideSubtitle, { color: p.textSecondary }]}>
              {activeSlide.subtitle}
            </Text>
          </Animated.View>

          {/* 3. FOOTER ACTIONS: Back button + Next / Create button */}
          <View style={styles.footerSection}>
            <View style={styles.buttonRow}>
              {currentIndex > 0 ? (
                <TouchableOpacity
                  onPress={handlePrev}
                  style={[
                    styles.backButton,
                    {
                      backgroundColor: p.backBtnBg,
                      borderColor: p.backBtnBorder,
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="arrow-back" size={18} color={p.textPrimary} />
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={handleNext}
                style={[
                  styles.primaryButton,
                  { backgroundColor: p.primaryBtnBg },
                  currentIndex === 0 && { width: '100%' },
                ]}
                activeOpacity={0.85}
              >
                <Text style={[styles.primaryButtonText, { color: p.primaryBtnText }]}>
                  {isLast ? 'Create wallet' : 'Next'}
                </Text>
                {!isLast && (
                  <MaterialIcons name="arrow-forward" size={17} color={p.primaryBtnText} />
                )}
              </TouchableOpacity>
            </View>

            {/* Sub-footer on last slide: "Already have a wallet? Sign in" */}
            <View style={styles.subFooterWrap}>
              {isLast ? (
                <TouchableOpacity onPress={handleSignIn} activeOpacity={0.7}>
                  <Text style={[styles.subFooterText, { color: p.textSecondary }]}>
                    Already have a wallet?{' '}
                    <Text style={[styles.signInLinkText, { color: p.signInLink }]}>
                      Sign in
                    </Text>
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
    fullScreenPage: {
      flex: 1,
      paddingHorizontal: 22,
      justifyContent: 'space-between',
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 32,
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
      fontSize: 13.5,
      fontWeight: '500',
    },
    bodySection: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 14,
    },
    visualWrapper: {
      height: 210, // Fixed 210px visual area so headline starts at same height on every slide
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 18,
      width: '100%',
    },
  slideTitle: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 30,
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: 10,
  },
  slideSubtitle: {
    fontSize: 13.5,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  slide1InnerCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Slide 2 & 3 Spec Card
  specCard: {
    borderWidth: 0.5,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 2,
    width: '100%',
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
  },
  specRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  specRightText: {
    fontSize: 13,
    fontWeight: '400',
  },
  specDivider: {
    height: 0.5,
  },
  // Slide 3 Step circle
  stepNumCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 11,
    fontWeight: '500',
  },
  stepDescText: {
    fontSize: 13,
    fontWeight: '400',
    flex: 1,
  },
  // Slide 4 Tile box
  iconTileBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    flexShrink: 0,
  },
  featureTitleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  featureSubtitleText: {
    fontSize: 11.5,
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
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  primaryButton: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
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
    fontSize: 13,
  },
  signInLinkText: {
    fontWeight: '500',
  },
})
