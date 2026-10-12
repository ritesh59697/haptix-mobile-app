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
  FlatList,
  Image,
  StatusBar as RNStatusBar,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAppTheme } from '@/components/theme/theme-context'

export const HAPTIX_GUIDE_STORAGE_KEY = '@haptix_has_seen_guide_v1'

const FINGERPRINT_HERO_BLUE = require('@/assets/images/fingerprint-hero-blue.png')

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

/**
 * Animated Biometric Radar Visual for Slide 1
 * Uses Haptix's signature high-res biometric fingerprint asset (FINGERPRINT_HERO_BLUE),
 * two concentric pulsing radar halos, tactile 112px sensor disc, and an indigo drop-glow.
 */
function PulsingBiometricStage({ accentColor = '#5a6ee6' }: { accentColor?: string }) {
  const pulse1 = useRef(new Animated.Value(1)).current
  const pulse2 = useRef(new Animated.Value(1)).current
  const opacity1 = useRef(new Animated.Value(1)).current
  const opacity2 = useRef(new Animated.Value(1)).current

  useEffect(() => {
    // Ring 1 loop (3.2s cycle)
    const anim1 = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse1, { toValue: 1.05, duration: 1600, useNativeDriver: true }),
          Animated.timing(opacity1, { toValue: 0.55, duration: 1600, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulse1, { toValue: 1, duration: 1600, useNativeDriver: true }),
          Animated.timing(opacity1, { toValue: 1, duration: 1600, useNativeDriver: true }),
        ]),
      ])
    )

    // Ring 2 loop with 500ms phase offset
    let anim2: Animated.CompositeAnimation | null = null
    const timer = setTimeout(() => {
      anim2 = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulse2, { toValue: 1.05, duration: 1600, useNativeDriver: true }),
            Animated.timing(opacity2, { toValue: 0.55, duration: 1600, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(pulse2, { toValue: 1, duration: 1600, useNativeDriver: true }),
            Animated.timing(opacity2, { toValue: 1, duration: 1600, useNativeDriver: true }),
          ]),
        ])
      )
      anim2.start()
    }, 500)

    anim1.start()

    return () => {
      clearTimeout(timer)
      anim1.stop()
      anim2?.stop()
    }
  }, [pulse1, pulse2, opacity1, opacity2])

  return (
    <View style={styles.pulseContainer}>
      {/* Outer pulse halo (220px) */}
      <Animated.View
        style={[
          styles.pulseRingOuter,
          {
            transform: [{ scale: pulse1 }],
            opacity: opacity1,
          },
        ]}
      />
      {/* Mid pulse halo (168px) */}
      <Animated.View
        style={[
          styles.pulseRingMid,
          {
            transform: [{ scale: pulse2 }],
            opacity: opacity2,
          },
        ]}
      />

      {/* Cross-platform Luminous Indigo Ambient Aura */}
      <View style={styles.glowAuraWrapper} pointerEvents="none">
        <Svg width={180} height={180} viewBox="0 0 180 180" fill="none">
          <Defs>
            <RadialGradient id="sensorGlow" cx="50%" cy="56%" r="46%">
              <Stop offset="0%" stopColor={accentColor} stopOpacity="0.48" />
              <Stop offset="55%" stopColor={accentColor} stopOpacity="0.18" />
              <Stop offset="100%" stopColor={accentColor} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="90" cy="90" r="90" fill="url(#sensorGlow)" />
        </Svg>
      </View>

      {/* Center 112px tactile sensor disc with high-res branded fingerprint */}
      <View style={[styles.sensorDisc, { borderColor: accentColor }]}>
        <Image
          source={FINGERPRINT_HERO_BLUE}
          style={{ width: 58, height: 58 }}
          resizeMode="contain"
        />
      </View>
    </View>
  )
}

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
  stageGradient: readonly [string, string, ...string[]]
  stageBorder: string
  stepLine: string
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
  iconBoxBg: '#eef0ff',
  backBtnBg: '#ffffff',
  backBtnBorder: '#e0ddd6',
  primaryBtnBg: '#5a6ee6',
  primaryBtnText: '#ffffff',
  signInLink: '#5a6ee6',
  stageGradient: ['#eceeff', '#f6f6fb'],
  stageBorder: '#e1e4fa',
  stepLine: '#d9dcf6',
}

const darkPalette: GuidePalette = {
  containerBg: '#09090b',
  containerBorder: '#2a2a28',
  textPrimary: '#f2f1ee',
  textSecondary: '#8a8985',
  textCard: '#b4b3ae',
  accent: '#6c8cff',
  cardBg: '#121216',
  cardBorder: '#23253a',
  cardDivider: '#202024',
  pillActive: '#6c8cff',
  pillInactive: '#2a2a2e',
  iconBoxBg: '#181b30',
  backBtnBg: '#121216',
  backBtnBorder: '#2a2a28',
  primaryBtnBg: '#6c8cff',
  primaryBtnText: '#0c0c0d',
  signInLink: '#6c8cff',
  stageGradient: ['#141624', '#0d0d12'],
  stageBorder: '#23253a',
  stepLine: '#272b48',
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
   * If true, forces warm off-white light mode design (#fbfaf8 with #5a6ee6).
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
  const flatListRef = useRef<FlatList<GuideSlide>>(null)

  // Use light mode palette as requested by user
  const p = forceLight ? lightPalette : isDark ? darkPalette : lightPalette

  // Responsively scale the stage height between 220px and 286px depending on viewport
  const stageHeight = Math.min(286, Math.max(220, Math.round(SCREEN_HEIGHT * 0.35)))

  const slides: GuideSlide[] = [
    {
      id: 'seedless',
      title: 'No seed phrase to lose',
      subtitle:
        "Your fingerprint unlocks your wallet. The key stays in your phone's secure chip and never leaves it.",
      renderVisual: (palette) => (
        <PulsingBiometricStage accentColor={palette.accent} />
      ),
    },
    {
      id: 'two-keys',
      title: 'Big sends need two keys',
      subtitle:
        "Choose your limit. Everyday sends up to 0.1 SOL need one fingerprint. Anything above it needs your second key, so a stolen phone can't empty your wallet.",
      renderVisual: (palette) => (
        <View style={styles.splitCardsCol}>
          {/* Card 1: ≤ 0.1 SOL */}
          <View
            style={[
              styles.obCard,
              {
                backgroundColor: palette.cardBg,
                borderColor: palette.cardBorder,
              },
            ]}
          >
            <Text style={[styles.obCardMono, { color: palette.textPrimary }]}>
              ≤ 0.1 SOL
            </Text>
            <View style={styles.obCardRight}>
              <Image
                source={FINGERPRINT_HERO_BLUE}
                style={{ width: 17, height: 17, tintColor: palette.textCard }}
                resizeMode="contain"
              />
              <Text style={[styles.obCardLabel, { color: palette.textCard }]}>
                One fingerprint
              </Text>
            </View>
          </View>

          {/* Card 2: > 0.1 SOL */}
          <View
            style={[
              styles.obCard,
              {
                backgroundColor: palette.cardBg,
                borderColor: palette.cardBorder,
              },
            ]}
          >
            <Text style={[styles.obCardMono, { color: palette.textPrimary }]}>
              &gt; 0.1 SOL
            </Text>
            <View style={styles.obCardRight}>
              <Image
                source={FINGERPRINT_HERO_BLUE}
                style={{ width: 17, height: 17, tintColor: palette.textCard }}
                resizeMode="contain"
              />
              <MaterialIcons
                name="laptop"
                size={16}
                color={palette.textCard}
                style={{ marginLeft: 1 }}
              />
              <Text style={[styles.obCardLabel, { color: palette.textCard }]}>
                Both keys
              </Text>
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
      renderVisual: (palette) => (
        <View
          style={[
            styles.stepperCard,
            {
              backgroundColor: palette.cardBg,
              borderColor: palette.cardBorder,
            },
          ]}
        >
          {/* Step 1 */}
          <View style={styles.stepItemRow}>
            <View style={styles.stepIndicatorCol}>
              <View style={[styles.stepNumCircle, { borderColor: palette.accent }]}>
                <Text style={[styles.stepNumText, { color: palette.accent }]}>1</Text>
              </View>
              <View style={[styles.stepVerticalLine, { backgroundColor: palette.stepLine }]} />
            </View>
            <View style={styles.stepTextWrap}>
              <Text style={[styles.stepText, { color: palette.textPrimary }]}>
                Your guardian starts a recovery
              </Text>
            </View>
          </View>

          {/* Step 2 */}
          <View style={styles.stepItemRow}>
            <View style={styles.stepIndicatorCol}>
              <View style={[styles.stepNumCircle, { borderColor: palette.accent }]}>
                <Text style={[styles.stepNumText, { color: palette.accent }]}>2</Text>
              </View>
              <View style={[styles.stepVerticalLine, { backgroundColor: palette.stepLine }]} />
            </View>
            <View style={styles.stepTextWrap}>
              <Text style={[styles.stepText, { color: palette.textPrimary }]}>
                You have 24 hours to cancel it
              </Text>
            </View>
          </View>

          {/* Step 3 */}
          <View style={styles.stepItemRow}>
            <View style={styles.stepIndicatorCol}>
              <View style={[styles.stepNumCircle, { borderColor: palette.accent }]}>
                <Text style={[styles.stepNumText, { color: palette.accent }]}>3</Text>
              </View>
            </View>
            <View style={[styles.stepTextWrap, { paddingBottom: 4 }]}>
              <Text style={[styles.stepText, { color: palette.textPrimary }]}>
                Your new phone takes over
              </Text>
            </View>
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
        <View style={styles.splitCardsCol}>
          {/* Card 1: AI agents */}
          <View
            style={[
              styles.obCard,
              {
                backgroundColor: palette.cardBg,
                borderColor: palette.cardBorder,
                justifyContent: 'flex-start',
                gap: 14,
              },
            ]}
          >
            <View style={[styles.iconTileBox, { backgroundColor: palette.iconBoxBg }]}>
              <MaterialCommunityIcons name="robot-outline" size={21} color={palette.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.featureTitleText, { color: palette.textPrimary }]}>
                AI agents
              </Text>
              <Text style={[styles.featureSubtitleText, { color: palette.textSecondary }]}>
                A budget and time limit you set
              </Text>
            </View>
          </View>

          {/* Card 2: Seeker ready */}
          <View
            style={[
              styles.obCard,
              {
                backgroundColor: palette.cardBg,
                borderColor: palette.cardBorder,
                justifyContent: 'flex-start',
                gap: 14,
              },
            ]}
          >
            <View style={[styles.iconTileBox, { backgroundColor: palette.iconBoxBg }]}>
              <MaterialCommunityIcons name="star-outline" size={21} color={palette.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.featureTitleText, { color: palette.textPrimary }]}>
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
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
      RNStatusBar.setBarStyle('dark-content', true)
    }
  }, [visible])

  const scrollToIndex = (index: number) => {
    setCurrentIndex(index)
    flatListRef.current?.scrollToIndex({ index, animated: true })
    void Haptics.selectionAsync()
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
      scrollToIndex(currentIndex + 1)
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
      scrollToIndex(currentIndex - 1)
    }
  }

  const handleSignIn = () => {
    void handleDismiss()
    if (onSignIn) {
      onSignIn()
    }
  }

  const isLast = currentIndex === slides.length - 1

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
              <TouchableOpacity
                key={idx}
                onPress={() => scrollToIndex(idx)}
                hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.pill,
                    {
                      width: idx === currentIndex ? 26 : 12,
                      backgroundColor:
                        idx === currentIndex ? p.pillActive : p.pillInactive,
                    },
                  ]}
                />
              </TouchableOpacity>
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

        {/* 2. BODY CONTENT: Hardware-accelerated continuous horizontal carousel (ZERO FLICKER) */}
        <FlatList
          ref={flatListRef}
          data={slides}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          scrollEventThrottle={16}
          style={styles.pagerList}
          contentContainerStyle={styles.pagerContentContainer}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onScrollToIndexFailed={(info) => {
            flatListRef.current?.scrollToOffset({
              offset: info.index * SCREEN_WIDTH,
              animated: true,
            })
          }}
          onMomentumScrollEnd={(e) => {
            const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
            if (newIndex >= 0 && newIndex < slides.length && newIndex !== currentIndex) {
              setCurrentIndex(newIndex)
              void Haptics.selectionAsync()
            }
          }}
          renderItem={({ item }) => (
            <View style={[styles.slidePage, { width: SCREEN_WIDTH }]}>
              {/* Framed Tinted Stage Panel */}
              <LinearGradient
                colors={p.stageGradient}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={[
                  styles.stagePanel,
                  {
                    borderColor: p.stageBorder,
                    height: stageHeight,
                  },
                ]}
              >
                {item.renderVisual(p)}
              </LinearGradient>

              {/* Title */}
              <Text style={[styles.slideTitle, { color: p.textPrimary }]}>
                {item.title}
              </Text>

              {/* Subtitle */}
              <Text style={[styles.slideSubtitle, { color: p.textSecondary }]}>
                {item.subtitle}
              </Text>
            </View>
          )}
        />

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
    paddingHorizontal: 0,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 32,
    paddingHorizontal: 22,
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

  // Carousel & Slides
  pagerList: {
    flex: 1,
  },
  pagerContentContainer: {
    alignItems: 'center',
  },
  slidePage: {
    paddingHorizontal: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Tinted Stage Panel
  stagePanel: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },

  // Slide 1: Pulsing Radar Halos & Sensor Disc
  pulseContainer: {
    width: 230,
    height: 230,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pulseRingOuter: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1.2,
    borderColor: 'rgba(90, 110, 230, 0.24)',
  },
  pulseRingMid: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1.2,
    borderColor: 'rgba(90, 110, 230, 0.38)',
  },
  glowAuraWrapper: {
    position: 'absolute',
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sensorDisc: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    // iOS shadow + Android elevation fallback
    shadowColor: '#5a6ee6',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 4,
    position: 'relative',
  },

  // Slide 2 & 4: Split Cards
  splitCardsCol: {
    width: '100%',
    maxWidth: 264,
    gap: 12,
  },
  obCard: {
    borderWidth: 0.5,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#5a6ee6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  obCardMono: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  obCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  obCardLabel: {
    fontSize: 13,
    fontWeight: '400',
  },

  // Slide 3: Connected Stepper Card
  stepperCard: {
    borderWidth: 0.5,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
    width: '100%',
    maxWidth: 272,
    shadowColor: '#5a6ee6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  stepItemRow: {
    flexDirection: 'row',
    gap: 14,
  },
  stepIndicatorCol: {
    alignItems: 'center',
  },
  stepNumCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stepVerticalLine: {
    width: 1.5,
    flex: 1,
    marginVertical: 3,
  },
  stepTextWrap: {
    flex: 1,
    paddingTop: 3,
    paddingBottom: 16,
  },
  stepText: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '400',
  },

  // Slide 4: AI Agent & Seeker Tiles
  iconTileBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureTitleText: {
    fontSize: 14.5,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  featureSubtitleText: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },

  // Typography below stage
  slideTitle: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 29,
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: 8,
  },
  slideSubtitle: {
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 290,
  },

  // Footer Actions
  footerSection: {
    width: '100%',
    paddingHorizontal: 22,
    paddingTop: 8,
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
    marginTop: 12,
    minHeight: 20,
  },
  subFooterText: {
    fontSize: 13,
  },
  signInLinkText: {
    fontWeight: '500',
  },
})
