import React from 'react'
import { View, StyleSheet } from 'react-native'
import Svg, {
  Path,
  Rect,
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  G,
} from 'react-native-svg'

// ============================================================================
// 1. HERO SPLASH ART (SCREEN 1)
// Luminous cosmic sphere with deep navy/indigo dark glassmorphism
// ============================================================================
export function HeroSplashArt({ size = 300 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 300 300" fill="none">
        <Defs>
          <RadialGradient id="heroGlow" cx="60%" cy="30%" r="70%">
            <Stop offset="0%" stopColor="#6366F1" stopOpacity="0.45" />
            <Stop offset="40%" stopColor="#3B82F6" stopOpacity="0.25" />
            <Stop offset="80%" stopColor="#0B0F19" stopOpacity="0.85" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="1" />
          </RadialGradient>
          <LinearGradient id="orbRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.5" />
            <Stop offset="50%" stopColor="#818CF8" stopOpacity="0.2" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="innerSphere" cx="35%" cy="35%" r="65%">
            <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.6" />
            <Stop offset="30%" stopColor="#4F46E5" stopOpacity="0.7" />
            <Stop offset="70%" stopColor="#1E1B4B" stopOpacity="0.95" />
            <Stop offset="100%" stopColor="#09090B" stopOpacity="1" />
          </RadialGradient>
        </Defs>

        {/* Ambient Dark Glow */}
        <Circle cx="150" cy="150" r="140" fill="url(#heroGlow)" />

        {/* Floating Ring Light Arc */}
        <Path
          d="M 50 180 C 70 80, 230 60, 260 140 C 230 220, 80 230, 50 180 Z"
          stroke="url(#orbRing)"
          strokeWidth="1.5"
          fill="none"
        />

        {/* Main 3D Sphere */}
        <Circle cx="165" cy="120" r="72" fill="url(#innerSphere)" />

        {/* Top-Right Soft Highlight Orb */}
        <Circle cx="195" cy="85" r="28" fill="#FFFFFF" fillOpacity="0.12" />
      </Svg>
    </View>
  )
}

// ============================================================================
// 2. PASSKEY CARDS ART (SCREEN 2)
// Floating translucent security cards with biometric emblem
// ============================================================================
export function PasskeyCardsArt({ size = 260 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
        <Defs>
          <LinearGradient id="cardGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#E2E8F0" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#F1F5F9" stopOpacity="0.4" />
          </LinearGradient>
          <LinearGradient id="cardGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#DBEAFE" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#BFDBFE" stopOpacity="0.3" />
          </LinearGradient>
          <LinearGradient id="cardBorder" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.2" />
          </LinearGradient>
        </Defs>

        {/* Back Angled Card */}
        <G transform="rotate(-14 130 130)">
          <Rect
            x="60"
            y="40"
            width="140"
            height="180"
            rx="24"
            fill="url(#cardGrad2)"
            stroke="url(#cardBorder)"
            strokeWidth="1.5"
          />
        </G>

        {/* Front Elevated Card */}
        <G transform="rotate(8 130 130)">
          <Rect
            x="70"
            y="35"
            width="140"
            height="180"
            rx="24"
            fill="url(#cardGrad1)"
            stroke="url(#cardBorder)"
            strokeWidth="1.5"
          />
          {/* Subtle Keyhole / Passkey Chip Emblem */}
          <Circle cx="140" cy="115" r="16" fill="#3B82F6" fillOpacity="0.15" />
          <Circle cx="140" cy="112" r="6" fill="#2563EB" />
          <Path d="M 137 114 L 143 114 L 142 124 L 138 124 Z" fill="#2563EB" />
        </G>
      </Svg>
    </View>
  )
}

// ============================================================================
// 3. AI AGENTS STACK ART (SCREEN 3)
// 3D stacked translucent platform layers with floating badges
// ============================================================================
export function AgentStackArt({ size = 260 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
        <Defs>
          <LinearGradient id="plateGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#E0E7FF" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#F8FAFC" stopOpacity="0.3" />
          </LinearGradient>
          <LinearGradient id="plateBorder" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#A5B4FC" stopOpacity="0.7" />
            <Stop offset="100%" stopColor="#E2E8F0" stopOpacity="0.2" />
          </LinearGradient>
        </Defs>

        {/* Stack Layer 3 (Bottom) */}
        <Path
          d="M 130 155 L 195 185 L 130 215 L 65 185 Z"
          fill="url(#plateGrad)"
          stroke="url(#plateBorder)"
          strokeWidth="1.5"
        />

        {/* Stack Layer 2 (Middle) */}
        <Path
          d="M 130 130 L 195 160 L 130 190 L 65 160 Z"
          fill="url(#plateGrad)"
          stroke="url(#plateBorder)"
          strokeWidth="1.5"
        />

        {/* Stack Layer 1 (Top) */}
        <Path
          d="M 130 105 L 195 135 L 130 165 L 65 135 Z"
          fill="url(#plateGrad)"
          stroke="url(#plateBorder)"
          strokeWidth="1.5"
        />

        {/* Badge 1: Robot Badge (Top Center) */}
        <Rect x="114" y="32" width="34" height="34" rx="10" fill="#0F172A" />
        {/* Robot face glyph */}
        <Circle cx="125" cy="46" r="2" fill="#38BDF8" />
        <Circle cx="137" cy="46" r="2" fill="#38BDF8" />
        <Path d="M 125 54 L 137 54" stroke="#38BDF8" strokeWidth="1.5" strokeLinecap="round" />
        <Rect x="120" y="40" width="22" height="18" rx="4" stroke="#38BDF8" strokeWidth="1.2" fill="none" />

        {/* Badge 2: Bolt (Right) */}
        <Rect x="188" y="75" width="30" height="30" rx="9" fill="#0F172A" />
        <Path d="M 204 81 L 197 90 L 202 90 L 199 99 L 208 89 L 203 89 Z" fill="#F59E0B" />

        {/* Badge 3: Analytics Chart (Left) */}
        <Rect x="42" y="115" width="30" height="30" rx="9" fill="#0F172A" />
        <Rect x="49" y="132" width="3" height="6" rx="1" fill="#38BDF8" />
        <Rect x="55" y="128" width="3" height="10" rx="1" fill="#38BDF8" />
        <Rect x="61" y="123" width="3" height="15" rx="1" fill="#38BDF8" />

        {/* Badge 4: Shield (Bottom Right) */}
        <Rect x="175" y="145" width="30" height="30" rx="9" fill="#0F172A" />
        <Path
          d="M 190 152 L 199 155 C 199 162, 195 166, 190 169 C 185 166, 181 162, 181 155 Z"
          fill="none"
          stroke="#10B981"
          strokeWidth="1.5"
        />
      </Svg>
    </View>
  )
}

// ============================================================================
// 4. MULTI-CHAIN TOKENS ART (SCREEN 4)
// Floating 3D badges: Solana, Ethereum, USDC, Bitcoin
// ============================================================================
export function MultiChainArt({ size = 260 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
        <Defs>
          <LinearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#9945FF" />
            <Stop offset="100%" stopColor="#14F195" />
          </LinearGradient>
          <LinearGradient id="ethGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#627EEA" />
            <Stop offset="100%" stopColor="#3B5998" />
          </LinearGradient>
          <LinearGradient id="btcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#F7931A" />
            <Stop offset="100%" stopColor="#D97706" />
          </LinearGradient>
          <LinearGradient id="usdcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#2775CA" />
            <Stop offset="100%" stopColor="#1D4ED8" />
          </LinearGradient>
        </Defs>

        {/* 1. Solana Badge (Top Left) */}
        <Circle cx="80" cy="80" r="32" fill="#0F172A" />
        <G transform="translate(62, 69) scale(0.09)">
          <Path
            d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
            fill="url(#solGrad)"
          />
          <Path
            d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
            fill="url(#solGrad)"
          />
          <Path
            d="M333.4 120.8c-2.4-2.4-5.7-3.8-9.2-3.8H6.8c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
            fill="url(#solGrad)"
          />
        </G>

        {/* 2. Ethereum Badge (Top Right) */}
        <Circle cx="185" cy="65" r="28" fill="url(#ethGrad)" />
        {/* Eth diamond */}
        <Path d="M 185 48 L 195 65 L 185 70 L 175 65 Z" fill="#FFFFFF" fillOpacity="0.9" />
        <Path d="M 185 72 L 195 67 L 185 81 L 175 67 Z" fill="#FFFFFF" fillOpacity="0.75" />

        {/* 3. USDC Badge (Center-Right) */}
        <Circle cx="160" cy="145" r="30" fill="url(#usdcGrad)" />
        <Circle cx="160" cy="145" r="22" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeDasharray="4 2" />
        {/* Dollar Sign */}
        <Path
          d="M 160 135 L 160 155 M 156 139 C 156 137, 164 137, 164 141 C 164 145, 156 145, 156 149 C 156 153, 164 153, 164 151"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />

        {/* 4. Bitcoin Badge (Bottom Right) */}
        <Circle cx="215" cy="175" r="26" fill="url(#btcGrad)" />
        {/* B glyph */}
        <Path
          d="M 211 165 L 217 165 C 220 165, 222 167, 222 170 C 222 172, 220 174, 217 174 L 211 174 M 211 174 L 218 174 C 221 174, 223 176, 223 179 C 223 182, 221 184, 218 184 L 211 184 M 214 162 L 214 187"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  )
}

// ============================================================================
// 5. BIOMETRIC SCAN GRAPHIC (SCREEN 6)
// Large scanner badge with Face ID / fingerprint brackets
// ============================================================================
export function BiometricScanGraphic({ size = 88 }: { size?: number }) {
  return (
    <View style={styles.scannerContainer}>
      <Svg width={size} height={size} viewBox="0 0 88 88" fill="none">
        <Defs>
          <LinearGradient id="scanBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#EFF6FF" />
            <Stop offset="100%" stopColor="#DBEAFE" />
          </LinearGradient>
        </Defs>

        {/* Background Squircle */}
        <Rect x="4" y="4" width="80" height="80" rx="24" fill="url(#scanBg)" />

        {/* 4 Outer Scan Brackets */}
        {/* Top-Left */}
        <Path d="M 24 34 L 24 26 C 24 24, 26 22, 28 22 L 36 22" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
        {/* Top-Right */}
        <Path d="M 52 22 L 60 22 C 62 22, 64 24, 64 26 L 64 34" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
        {/* Bottom-Left */}
        <Path d="M 24 54 L 24 62 C 24 64, 26 66, 28 66 L 36 66" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
        {/* Bottom-Right */}
        <Path d="M 52 66 L 60 66 C 62 66, 64 64, 64 62 L 64 54" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />

        {/* Center Face ID Features */}
        {/* Left Eye */}
        <Circle cx="35" cy="40" r="2.5" fill="#2563EB" />
        {/* Right Eye */}
        <Circle cx="53" cy="40" r="2.5" fill="#2563EB" />
        {/* Nose */}
        <Path d="M 44 40 L 44 47 L 47 47" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Smile Arc */}
        <Path d="M 36 53 C 40 57, 48 57, 52 53" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" fill="none" />
      </Svg>
    </View>
  )
}

// ============================================================================
// 6. WALLET SUCCESS CHECKMARK (SCREEN 7)
// Elegant soft blue circular badge with verified checkmark
// ============================================================================
export function WalletSuccessGraphic({ size = 72 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 72 72" fill="none">
        <Circle cx="36" cy="36" r="34" fill="#EFF6FF" />
        <Path
          d="M 25 36 L 32 43 L 47 28"
          stroke="#2563EB"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}

// ============================================================================
// 7. WALLET PROVIDER LOGOS (SCREEN 8)
// Phantom, Solflare, MetaMask, and Other Wallet
// ============================================================================
export function PhantomLogo({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Rect width="100" height="100" rx="24" fill="#AB9FF2" />
      {/* Ghost silhouette */}
      <Path
        d="M 28 58 C 28 36, 40 28, 50 28 C 60 28, 72 36, 72 58 C 72 70, 68 74, 62 70 C 58 66, 54 66, 50 70 C 46 74, 42 74, 38 70 C 32 66, 28 70, 28 58 Z"
        fill="#FFFFFF"
      />
      <Circle cx="44" cy="50" r="3.5" fill="#AB9FF2" />
      <Circle cx="58" cy="50" r="3.5" fill="#AB9FF2" />
    </Svg>
  )
}

export function SolflareLogo({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Rect width="100" height="100" rx="24" fill="#18181B" />
      <Defs>
        <LinearGradient id="solfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#FC603C" />
          <Stop offset="100%" stopColor="#F8B133" />
        </LinearGradient>
      </Defs>
      <Circle cx="50" cy="50" r="16" fill="url(#solfGrad)" />
      {/* Radiating geometric sun bursts */}
      <Path
        d="M 50 20 L 50 28 M 50 72 L 50 80 M 20 50 L 28 50 M 72 50 L 80 50 M 29 29 L 35 35 M 65 65 L 71 71 M 71 29 L 65 35 M 35 65 L 29 71"
        stroke="url(#solfGrad)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function MetaMaskLogo({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Rect width="100" height="100" rx="24" fill="#FFF7ED" />
      {/* Fox snout & ears */}
      <Path d="M 30 30 L 40 45 L 34 50 Z" fill="#E2761B" />
      <Path d="M 70 30 L 60 45 L 66 50 Z" fill="#E2761B" />
      <Path d="M 34 50 L 40 45 L 50 48 L 60 45 L 66 50 L 50 75 Z" fill="#E4761B" />
      <Path d="M 44 58 L 50 56 L 56 58 L 50 64 Z" fill="#233447" />
    </Svg>
  )
}

export function OtherWalletLogo({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Rect width="100" height="100" rx="24" fill="#F4F4F5" />
      <Rect x="28" y="34" width="44" height="32" rx="6" stroke="#18181B" strokeWidth="4" fill="none" />
      <Path d="M 28 42 L 72 42" stroke="#18181B" strokeWidth="3" />
      <Circle cx="58" cy="52" r="3" fill="#18181B" />
    </Svg>
  )
}

const styles = StyleSheet.create({
  scannerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
})
