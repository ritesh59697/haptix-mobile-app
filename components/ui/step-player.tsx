import React, { useEffect, useRef, useState, useMemo } from 'react'
import { View, TouchableOpacity, StyleSheet, Animated, Easing, Platform } from 'react-native'
import * as Haptics from 'expo-haptics'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useAppTheme } from '@/components/theme/theme-context'

export interface StepPlayerStep {
  duration?: number
  label?: string
}

export interface StepPlayerProps {
  steps?: number | StepPlayerStep[]
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  playing?: boolean
  defaultPlaying?: boolean
  onPlayingChange?: (playing: boolean) => void
  duration?: number
  loop?: boolean
  onComplete?: () => void
  size?: number
  showControl?: boolean
  controlPosition?: 'left' | 'right'
  seekable?: boolean
}

/**
 * StepPlayer
 * Inspired by swamimalode07/rare-ui/step-player
 * An iOS-style stepped progress track with play, pause and replay control.
 * The active step smoothly stretches into an animated bar that fills as it plays.
 */
export function StepPlayer({
  steps = 4,
  value,
  defaultValue = 0,
  onValueChange,
  playing,
  defaultPlaying = false,
  onPlayingChange,
  duration = 4000,
  loop = false,
  onComplete,
  size = 36,
  showControl = true,
  controlPosition = 'right',
  seekable = true,
}: StepPlayerProps) {
  const { isDark } = useAppTheme()

  const items = useMemo<StepPlayerStep[]>(
    () => (typeof steps === 'number' ? Array.from({ length: Math.max(1, steps) }, () => ({})) : steps),
    [steps],
  )
  const count = items.length

  const isValueControlled = value !== undefined
  const isPlayingControlled = playing !== undefined

  const [indexState, setIndexState] = useState(() => Math.min(Math.max(0, defaultValue), count - 1))
  const [playingState, setPlayingState] = useState(defaultPlaying)
  const [finished, setFinished] = useState(false)

  const activeIndex = Math.min(isValueControlled ? value : indexState, count - 1)
  const isPlaying = isPlayingControlled ? playing : playingState

  // Progress of current active step (0 to 1)
  const progressAnim = useRef(new Animated.Value(0)).current
  // Step expansion width animations for each step
  const widthAnims = useRef(items.map((_, i) => new Animated.Value(i === activeIndex ? 1 : 0))).current

  // Calculate proportional dimensions based on size prop
  const trackHeight = Math.max(24, size)
  const dotSize = Math.max(6, Math.round(trackHeight * 0.22))
  const barWidth = Math.max(28, Math.round(dotSize * 5.2))
  const gap = Math.max(6, Math.round(trackHeight * 0.22))
  const paddingH = Math.max(8, Math.round(trackHeight * 0.3))

  const commitIndex = (next: number) => {
    progressAnim.setValue(0)
    setFinished(false)
    if (!isValueControlled) {
      setIndexState(next)
    }
    onValueChange?.(next)
  }

  const commitPlaying = (next: boolean) => {
    if (!isPlayingControlled) {
      setPlayingState(next)
    }
    onPlayingChange?.(next)
  }

  // Animate step widths when activeIndex changes
  useEffect(() => {
    items.forEach((_, i) => {
      Animated.timing(widthAnims[i], {
        toValue: i === activeIndex ? 1 : 0,
        duration: 320,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: false,
      }).start()
    })
  }, [activeIndex, items])

  // Step fill animation when playing
  useEffect(() => {
    if (!isPlaying) {
      progressAnim.stopAnimation()
      return
    }

    const stepDuration = items[activeIndex]?.duration ?? duration
    progressAnim.setValue(0)

    const animation = Animated.timing(progressAnim, {
      toValue: 1,
      duration: stepDuration,
      easing: Easing.linear,
      useNativeDriver: false,
    })

    animation.start(({ finished: animFinished }) => {
      if (animFinished) {
        if (activeIndex < count - 1) {
          commitIndex(activeIndex + 1)
        } else {
          onComplete?.()
          if (loop) {
            commitIndex(0)
          } else {
            setFinished(true)
            commitPlaying(false)
          }
        }
      }
    })

    return () => animation.stop()
  }, [isPlaying, activeIndex, count, duration, loop])

  const handleTogglePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (finished) {
      commitIndex(0)
      commitPlaying(true)
      return
    }
    commitPlaying(!isPlaying)
  }

  const handleStepPress = (idx: number) => {
    if (!seekable) return
    Haptics.selectionAsync()
    commitIndex(idx)
  }

  const controlBg = isDark ? '#1F1F23' : '#F1F1F5'
  const controlIconColor = isDark ? '#FFFFFF' : '#0B1220'
  const trackBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)'
  const dotPending = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(15, 23, 42, 0.22)'
  const dotPast = isDark ? '#FFFFFF' : '#0B1220'
  const barFill = isDark ? '#FFFFFF' : '#0B1220'

  return (
    <View style={[styles.container, controlPosition === 'right' && styles.rowReverse]}>
      {/* Control Button: Play / Pause / Replay */}
      {showControl && (
        <TouchableOpacity
          style={[
            styles.controlBtn,
            {
              width: trackHeight,
              height: trackHeight,
              borderRadius: trackHeight / 2,
              backgroundColor: controlBg,
            },
          ]}
          onPress={handleTogglePlay}
          activeOpacity={0.75}
          accessibilityLabel={finished ? 'Replay' : isPlaying ? 'Pause' : 'Play'}
        >
          <MaterialIcons
            name={finished ? 'replay' : isPlaying ? 'pause' : 'play-arrow'}
            size={Math.round(trackHeight * 0.52)}
            color={controlIconColor}
          />
        </TouchableOpacity>
      )}

      {/* Progress Track */}
      <View
        style={[
          styles.track,
          {
            height: trackHeight,
            paddingHorizontal: paddingH,
            gap,
            backgroundColor: trackBg,
          },
        ]}
      >
        {items.map((_, i) => {
          const isCurrent = i === activeIndex
          const isPast = i < activeIndex

          const width = widthAnims[i].interpolate({
            inputRange: [0, 1],
            outputRange: [dotSize, barWidth],
          })

          return (
            <TouchableOpacity key={i} onPress={() => handleStepPress(i)} disabled={!seekable} activeOpacity={0.8}>
              <Animated.View
                style={[
                  styles.step,
                  {
                    width,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: isPast ? dotPast : dotPending,
                  },
                ]}
              >
                {/* Active step progress fill bar */}
                {isCurrent && (
                  <Animated.View
                    style={[
                      styles.fillBar,
                      {
                        borderRadius: dotSize / 2,
                        backgroundColor: barFill,
                        width: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                )}
              </Animated.View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  controlBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  step: {
    overflow: 'hidden',
    position: 'relative',
  },
  fillBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
})

export default StepPlayer
