import React, { useEffect, useState } from 'react'
import { StyleProp, Text, TextStyle } from 'react-native'
import { formatRemainingTime } from '@/utils/recovery-timelock'

interface HaptixCountdownProps {
  /** Deadline as unix seconds, matching what the program stores. */
  until: number
  /** Appended while there is time left, e.g. `" left"`. Dropped once expired. */
  suffix?: string
  style?: StyleProp<TextStyle>
}

/**
 * HaptixCountdown
 *
 * The clock lives in the component that displays it rather than in the screen that
 * happens to own the data. A screen holding `nowSeconds` in its own state re-renders
 * everything it renders on every tick, so one countdown used to cost a full repaint of
 * the wallet -- header, dock, activity list and every modal -- once a second. Here the
 * tick re-renders this line of text and nothing else.
 *
 * It renders as a `Text`, so it can be dropped inside an existing `Text` and inherit
 * that line's styles.
 */
export function HaptixCountdown({ until, suffix = '', style }: HaptixCountdownProps) {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const interval = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [])

  // A deadline that has already passed never gains time, so the tick is pointless once
  // the row is expired; the interval is torn down and `formatRemainingTime` supplies the
  // word for it, which keeps "Expired" spelled in exactly one place.
  const remaining = Math.max(0, until - nowSeconds)
  return (
    <Text style={style}>
      {remaining > 0 ? `${formatRemainingTime(remaining)}${suffix}` : formatRemainingTime(remaining)}
    </Text>
  )
}
