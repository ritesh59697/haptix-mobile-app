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
  amber: string
  amberBg: string
  amberText: string
  emerald: string
  emeraldBg: string
  emeraldText: string
  rose: string
  roseBg: string
  roseText: string
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
  bgApp: '#000000', // Pure OLED Pitch Black
  bgCard: '#0D0D0D', // Minimalist Charcoal Card
  bgElevated: '#141414', // Subtle Elevated Card
  bgInput: '#0A0A0A',
  borderSubtle: 'rgba(255, 255, 255, 0.07)',
  borderDefault: 'rgba(255, 255, 255, 0.12)',
  borderFocus: '#FFFFFF',
  textPrimary: '#FFFFFF', // Crisp White
  textSecondary: '#A1A1AA', // Refined Silver
  textMuted: '#71717A', // Muted Gray
  accent: '#FFFFFF', // Pure White Accent (Zero Neon)
  accentLight: 'rgba(255, 255, 255, 0.08)',
  accentGlow: 'rgba(255, 255, 255, 0.15)',
  accentForeground: '#000000', // Crisp Black Text on White
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.10)',
  amberText: '#FBBF24',
  emerald: '#10B981',
  emeraldBg: 'rgba(16, 185, 129, 0.10)',
  emeraldText: '#34D399',
  rose: '#F43F5E',
  roseBg: 'rgba(244, 63, 94, 0.10)',
  roseText: '#FB7185',
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
  bgApp: '#FFFFFF', // Clean White
  bgCard: '#FAFAFA', // Subtle Off-White
  bgElevated: '#F4F4F5',
  bgInput: '#FFFFFF',
  borderSubtle: '#F4F4F5',
  borderDefault: '#E4E4E7',
  borderFocus: '#000000',
  textPrimary: '#000000',
  textSecondary: '#52525B',
  textMuted: '#A1A1AA',
  accent: '#000000', // Pure Black Accent
  accentLight: 'rgba(0, 0, 0, 0.05)',
  accentGlow: 'rgba(0, 0, 0, 0.10)',
  accentForeground: '#FFFFFF', // Crisp White Text on Black
  amber: '#D97706',
  amberBg: '#FEF3C7',
  amberText: '#92400E',
  emerald: '#059669',
  emeraldBg: '#D1FAE5',
  emeraldText: '#065F46',
  rose: '#E11D48',
  roseBg: '#FFE4E6',
  roseText: '#9F1239',
  shadowColor: '#000000',
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
}
