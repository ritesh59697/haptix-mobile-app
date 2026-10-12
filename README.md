# Haptix — Next-Gen Passkey Smart Wallet for Solana Mobile

<div align="center">

**Seedless. Biometric-Secured. Agent-Ready.**  
*Built for the Solana Mobile Ecosystem (Saga / Chapter 2)*

[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=flat&logo=solana)](https://solana.com)
[![Expo](https://img.shields.io/badge/Expo-55.0-000020?style=flat&logo=expo)](https://expo.dev)
[![Anchor](https://img.shields.io/badge/Anchor-0.31-2B2D42?style=flat)](https://www.anchor-lang.com)
[![Secp256r1](https://img.shields.io/badge/Cryptography-Secp256r1%20%2F%20P--256-blue?style=flat)](https://docs.solana.com)
[![Documentation](https://img.shields.io/badge/Docs-Mintlify-4F6BFF?style=flat&logo=gitbook&logoColor=white)](https://haptix-docs.mintlify.app)
[![Twitter](https://img.shields.io/badge/X-@HaptixWalllet-black?style=flat&logo=x)](https://x.com/HaptixWalllet)
[![Tests](https://img.shields.io/badge/Tests-290%20Passing-brightgreen?style=flat)](tests/)

<br />

**[🎬 Demo Video (YouTube)](https://youtu.be/kNsqykt4rfg)** &bull; **[Live Docs](https://haptix-docs.mintlify.app)** &bull; **[Download Release APK (v1.0.1)](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/haptix-wallet.apk)** &bull; **[Pitch Deck (PDF)](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf)** &bull; **[GitHub Release v1.0.1](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.1)** &bull; **[Devnet Program](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)**

</div>

---

## Submission Deliverables & Standalone APK (v1.0.1)

| Attribute | Verified Value |
| :--- | :--- |
| **Demo Video** | [**Watch 3-Min Walkthrough on YouTube**](https://youtu.be/kNsqykt4rfg) |
| **Release Tag** | [`v1.0.1`](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.1) |
| **Direct APK Binary** | [**haptix-wallet.apk**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/haptix-wallet.apk) |
| **Pitch Deck (PDF)** | [**Haptix_Pitch_Deck.pdf**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf) |
| **EAS Build ID** | `da754004-963e-4d77-bbae-45c4ac1f5a98` |
| **EAS Build Console** | [View Build Logs on Expo.dev](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/da754004-963e-4d77-bbae-45c4ac1f5a98) |
| **Passkey UX** | Auto-targeted active wallet passkey (Zero-picker direct fingerprint prompt) |
| **Cloud Relay** | [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (24/7 UptimeRobot monitored) |

---

## Overview

**Haptix** is a consumer-grade smart contract wallet designed natively for the **Solana Mobile Stack (SMS)**. 

Traditional mobile crypto wallets force users to manage 12-to-24 word seed phrases or endure friction-heavy prompts for every micro-transaction. Haptix eliminates seed phrases entirely by utilizing **Hardware Passkeys (Secp256r1 / P-256)** verified directly on Solana through native **instruction introspection (`Secp256r1SigVerify`)**.

### Key Innovations

- **1-Tap Biometric Hardware Passkey**: Frictionless Face ID / Touch ID authentication without seed phrases, backed by OS hardware security.
- **Dual-Device Vault Mode (2-of-2 Quorum)**: High-value transactions or security policy adjustments mandate two independent hardware signatures (Primary phone passkey + secondary hardware key).
- **Customizable Spending Limits**: Configurable single-key fast lane threshold (e.g. $\le$ 0.1 SOL) with automatic quorum escalation for high-value transfers.
- **Autonomous AI Agent Sessions**: Scoped delegation of spending budgets to AI trading agents with strict on-chain rolling limits and time expiries.
- **Instant Panic Freeze & Guardian Recovery**: Emergency circuit breaker allowing users or designated guardians to freeze account outflows instantly in the event of lost hardware.
- **Agency-Grade Anti-Slop Design**: Ultra-clean monochrome OLED theme inspired by Apple, Cash App, and Linear with minimalist vector stroke iconography (Lucide / Rune).
- **Rare-UI Stepped Onboarding & Rolling Counters**: Smooth stepped progress onboarding player and vertical rolling odometer counters for live balances.

---

## Repository Architecture

This repository contains both the **React Native / Expo Mobile App** and the **On-Chain Anchor Solana Smart Program**:

```
haptix-mobile-app/
├── app/                            # Expo Router file-based navigation
│   ├── (tabs)/                     # Main authenticated tab views
│   │   ├── index.tsx               # Smart wallet dashboard & navigation
│   │   └── settings/               # Spending limits, recovery, security
│   ├── sign-in.tsx                 # Onboarding & passkey registration
│   └── _layout.tsx                 # Root layout & providers
├── components/                     # UI design system components
│   ├── haptix/                     # Haptix brand components & wallet views
│   │   ├── haptix-wallet-screen.tsx# Main wallet dashboard & expanded send
│   │   ├── haptix-floating-dock.tsx# Floating dock navigation
│   │   └── haptix-icons.tsx        # Vector icon library (Lucide / Rune)
│   └── ui/                         # Reusable animated components
├── utils/                          # Cryptography, PDA derivation & RPC clients
│   ├── haptix-passkey.ts           # Secp256r1 hardware passkey signing
│   ├── haptix-client.ts            # Anchor instruction builder & account parser
│   └── secp256r1-instruction.ts    # Native Secp256r1 precompile serializer
├── tests/                          # 290-test end-to-end integration test suite
│
└── haptix_program/                 # On-Chain Anchor 0.31 Solana Smart Contract
    ├── programs/haptix_program/    # Rust program implementation
    │   └── src/
    │       ├── instructions/       # Transfer, Quorum, Agent, Recovery instructions
    │       ├── secp256r1.rs        # Precompile instruction introspection
    │       ├── state/              # Wallet account layout & spend policies
    │       └── lib.rs              # Program entrypoint
    ├── tests/                      # Anchor integration test suite
    └── Anchor.toml                 # Anchor configuration & Devnet deployment
```

---

## Quick Start: Mobile App

### Prerequisites
- Node.js (v18+)
- Android Studio / Android Emulator or a physical Solana Mobile device (Saga / Chapter 2)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Integration Tests
Verify all 290 cryptographic, PDA derivation, precompile serialization, and live Devnet verification checks:
```bash
npm test
```

### 3. Start the Development Server
```bash
npx expo start
```
- Press `a` to run on Android emulator or connected device.
- Press `w` to open in desktop browser.

### 4. Build Standalone Android APK (EAS)
```bash
npx eas-cli build -p android --profile preview
```

---

## Quick Start: Smart Program (`haptix_program`)

### Program Details (Solana Devnet)
- **Program ID**: `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`
- **Solana Cluster**: `devnet`
- **Native Elliptic Curve**: `Secp256r1` (P-256 / WebAuthn)
- **Precompile**: `Secp256r1SigVerify1111111111111111111111111`

### Build & Test On-Chain
```bash
cd haptix_program
anchor build
anchor test
```

---

## Integration Test Suite (290 / 290 Passing across 14 Suites)

The repository includes a comprehensive 14-suite test harness validating the complete cryptographic and on-chain pipeline:

```
===============================================================
  HAPTIX SMART WALLET — TEST HARNESS SUMMARY
===============================================================

  Suite 1:  Solana Address & Recipient Validation ........ 12 PASS
  Suite 2:  Contact List & Address Book .................. 14 PASS
  Suite 3:  Solana Dynamic Fee Estimation ................. 7 PASS
  Suite 4:  Secp256r1 Layout & Serialization ............. 28 PASS
  Suite 5:  Passkey Recovery Assertion Matcher ........... 10 PASS
  Suite 6:  Wallet Seed & Timelock Parsing ............... 33 PASS
  Suite 7:  Activity Display & Theme Rules ............... 28 PASS
  Suite 8:  Environment Variable Inlining ................. 5 PASS
  Suite 9:  WYSIWYS Cross-Validation Payload Checks ...... 11 PASS
  Suite 10: Devnet 24h Timelock Recovery Quorum .......... 53 PASS
  Suite 11: End-to-End Cryptography & Precompile ......... 29 PASS
  Suite 12: On-Chain Guardian Governance ................. 32 PASS
  Suite 13: Spend Threshold Dual-Signer Escalation ........ 9 PASS
  Suite 14: Seeker SKR Token & Sponsored Paymaster ....... 18 PASS

===============================================================
  TOTAL: 290 | PASSED: 290 | FAILED: 0 (100% PASSING)
===============================================================
```

---

## UI & Design Principles

- **Pure Minimalist Monochrome**: Dark tones paired with crisp typography and subtle hairline borders, completely free of neon / AI-slop cliches.
- **Physical Haptic Feedback**: Tactile responses on dock tab selection, percentage chip taps, and biometric passkey authorization.
- **Tabular Figures & Rolling Counters**: Numbers never clip or jump jarringly thanks to monospace numeric geometry and smooth bezier rolling.

---

Built by [Ritesh](https://x.com/Ritesh5969)
