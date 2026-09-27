export interface ThemeTokens {
  mode: 'dark' | 'light'
  isDark: boolean
  bgApp: string
  bgCard: string
  bgElevated: string
  bgInput: string
  borderSubtle: string
  borderDefault: string
  borderFocus: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  accentLight: string
  accentGlow: string
  accentForeground: string
  onTone: string
  amber: string
  amberBg: string
  amberText: string
  amberBorder: string
  emerald: string
  emeraldBg: string
  emeraldText: string
  emeraldBorder: string
  rose: string
  roseBg: string
  roseText: string
  roseSurface: string
  roseBorder: string
  info: string
  infoBg: string
  infoText: string
  infoBorder: string
  scrim: string
  shadowColor: string
  cardShadow: {
    shadowColor: string
    shadowOffset: { width: number; height: number }
    shadowOpacity: number
    shadowRadius: number
    elevation: number
  }
}

export const darkTokens: ThemeTokens = {
  mode: 'dark',
  isDark: true,
  bgApp: '#000000', // Pitch Black OLED (like ViperX)
  bgCard: '#000000', // Pitch Black Cards (like ViperX)
  bgElevated: '#0A0A0C', // Ultra-deep subtle elevation for chips/controls
  bgInput: '#050507', // Sleek pitch black input field
  borderSubtle: '#141416', // Subtle separator line
  borderDefault: '#222226', // Razor-sharp 1px border (like ViperX #1c1c1e / #222226)
  borderFocus: '#6C8CFF',
  textPrimary: '#FFFFFF', // Crisp pure white
  textSecondary: '#8E8E93', // Clean Apple/ViperX muted gray
  textMuted: '#636366',
  accent: '#6C8CFF', // Cohesive royal blue / purple accent
  accentLight: 'rgba(108, 140, 255, 0.12)',
  accentGlow: 'rgba(108, 140, 255, 0.25)',
  accentForeground: '#FFFFFF',
  onTone: '#FFFFFF',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.12)',
  amberText: '#FBBF24',
  amberBorder: 'rgba(245, 158, 11, 0.3)',
  emerald: '#00C076', // High-energy crypto green (like ViperX +3.42%)
  emeraldBg: 'rgba(0, 192, 118, 0.12)',
  emeraldText: '#00C076',
  emeraldBorder: 'rgba(0, 192, 118, 0.3)',
  rose: '#F43F5E',
  roseBg: 'rgba(244, 63, 94, 0.12)',
  roseText: '#FDA4AF',
  roseSurface: 'rgba(244, 63, 94, 0.2)',
  roseBorder: 'rgba(244, 63, 94, 0.3)',
  info: '#6C8CFF',
  infoBg: 'rgba(108, 140, 255, 0.12)',
  infoText: '#6C8CFF',
  infoBorder: 'rgba(108, 140, 255, 0.3)',
  scrim: 'rgba(0, 0, 0, 0.94)',
  shadowColor: '#000000',
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 4,
  },
}

export const lightTokens: ThemeTokens = {
  mode: 'light',
  isDark: false,
  bgApp: '#F6F6F8', // Soft off-white canvas matching mockup
  bgCard: '#FFFFFF', // Pure White Cards
  bgElevated: '#FFFFFF',
  bgInput: '#FFFFFF',
  borderSubtle: '#EEEEF0',
  borderDefault: '#E5E5EA',
  borderFocus: '#4F6BFF',
  textPrimary: '#09090B',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  accent: '#4F6BFF', // Vibrant Royal Blue Accent matching mockup (#4F6BFF)
  accentLight: 'rgba(79, 107, 255, 0.12)',
  accentGlow: 'rgba(79, 107, 255, 0.25)',
  accentForeground: '#FFFFFF', // Crisp White Text on Blue
  onTone: '#FFFFFF',
  amber: '#D97706',
  amberBg: '#FEF3C7',
  amberText: '#92400E',
  amberBorder: '#FDE68A',
  emerald: '#059669',
  emeraldBg: '#D1FAE5',
  emeraldText: '#065F46',
  emeraldBorder: '#6EE7B7',
  rose: '#E11D48',
  roseBg: '#FFE4E6',
  roseText: '#9F1239',
  roseSurface: '#FECDD3',
  roseBorder: '#FDA4AF',
  info: '#2563EB',
  infoBg: '#DBEAFE',
  infoText: '#1E40AF',
  infoBorder: '#BFDBFE',
  scrim: 'rgba(250, 250, 250, 0.94)',
  shadowColor: '#000000',
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
}

// ── Shape scale ──────────────────────────────────────────────────────────────
// Surfaces use six steps only. Anything meant to read as a circle or capsule
// uses `pill` rather than a hand-tuned half-dimension, so it stays round when
// the element is resized.
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const

// ── Type scale ───────────────────────────────────────────────────────────────
// Whole numbers only: fractional sizes render blurry on Android and read as
// accidents rather than decisions.
//
// The steps are ~1.15x apart on purpose. The previous scale ran 13/14/15/18 for
// body, bodyLg, title and heading, so four "levels" sat within one step of each
// other and hierarchy had to be carried entirely by colour and weight. Anything
// inside the dense-UI range (micro..body) stays put, because those sizes are
// already distinguished by role rather than by prominence.
export const typeScale = {
  micro: 10,
  caption: 11,
  footnote: 12,
  body: 13,
  bodyLg: 15,
  title: 17,
  heading: 20,
  displaySm: 23,
  display: 26,
  displayLg: 30,
  hero: 34,
  heroXl: 40,
} as const

// ── Space scale ──────────────────────────────────────────────────────────────
// Gaps and paddings come from here rather than from hand-picked numbers, so two
// cards sitting next to each other cannot disagree about what "a little space"
// means. `sm`/`md`/`lg` cover the common cases; `xxs` and `xs` exist for badge
// insets, where a 4dp difference is visible.
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const
