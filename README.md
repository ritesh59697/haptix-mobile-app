# Haptix — Next-Gen Passkey Smart Wallet for Solana Mobile

<div align="center">

![Haptix Banner](assets/images/haptix-logo-white.png)

**Seedless. Biometric-Secured. Agent-Ready.**  
*Built for the Solana Mobile Ecosystem (Saga / Chapter 2)*

[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=flat&logo=solana)](https://solana.com)
[![Expo](https://img.shields.io/badge/Expo-55.0-000020?style=flat&logo=expo)](https://expo.dev)
[![Anchor](https://img.shields.io/badge/Anchor-0.31-2B2D42?style=flat)](https://www.anchor-lang.com)
[![Secp256r1](https://img.shields.io/badge/Cryptography-Secp256r1%20%2F%20P--256-blue?style=flat)](https://docs.solana.com)
[![Documentation](https://img.shields.io/badge/Docs-Mintlify-4F6BFF?style=flat&logo=gitbook&logoColor=white)](https://haptix-docs.mintlify.app)
[![Twitter](https://img.shields.io/badge/X-@HaptixWalllet-black?style=flat&logo=x)](https://x.com/HaptixWalllet)
[![Tests](https://img.shields.io/badge/Tests-146%20Passing-brightgreen?style=flat)](tests/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<br />

**[📖 Live Docs](https://haptix-docs.mintlify.app)** &bull; **[🐦 X Community](https://x.com/HaptixWalllet)** &bull; **[📲 Download Release APK (v1.0.0)](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.0/haptix-wallet.apk)** &bull; **[🚀 EAS Build Console](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/6e6cbb0a-cb5b-4e38-bd17-c5345c8f767a)** &bull; **[📦 GitHub Release v1.0.0](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.0)** &bull; **[⚡ Devnet Program](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)**

</div>

---

## 📱 Latest Standalone APK (v1.0.0)

| Attribute | Verified Value |
| :--- | :--- |
| **Release Tag** | [`v1.0.0`](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.0) |
| **Direct APK Binary** | [**haptix-wallet.apk (97.7 MB)**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.0/haptix-wallet.apk) |
| **EAS Build ID** | `fabae648-84e5-4d44-8bb5-0df29c98b641` |
| **EAS Build Console** | [View Build Logs on Expo.dev](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/fabae648-84e5-4d44-8bb5-0df29c98b641) |
| **Passkey UX** | Auto-targeted active wallet passkey (Zero-picker direct fingerprint prompt) |
| **Cloud Relay** | [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (24/7 UptimeRobot monitored) |

---

## 🚀 Overview

**Haptix** is a consumer-grade smart contract wallet designed natively for the **Solana Mobile Stack (SMS)**. 

Traditional mobile crypto wallets force users to manage 12-to-24 word seed phrases or endure friction-heavy prompts for every micro-transaction. Haptix eliminates seed phrases entirely by utilizing **Hardware Passkeys (Secp256r1 / P-256)** verified directly on Solana through native **instruction introspection (`Secp256r1SigVerify`)**.

### 🌟 Key Innovations

- **1-Tap Biometric Hardware Passkey**: Frictionless Face ID / Touch ID authentication without seed phrases, backed by OS hardware security.
- **Dual-Device Vault Mode (2-of-2 Quorum)**: High-value transactions or security policy adjustments mandate two independent hardware signatures (Primary phone passkey + secondary hardware key).
- **Customizable Spending Limits**: Configurable single-key fast lane threshold (e.g. $\le$ 0.1 SOL) with automatic quorum escalation for high-value transfers.
- **Autonomous AI Agent Sessions**: Scoped delegation of spending budgets to AI trading agents with strict on-chain rolling limits and time expiries.
- **Instant Panic Freeze & Guardian Recovery**: Emergency circuit breaker allowing users or designated guardians to freeze account outflows instantly in the event of lost hardware.
- **Agency-Grade Anti-Slop Design**: Ultra-clean monochrome OLED theme inspired by Apple, Cash App, and Linear with minimalist vector stroke iconography (Lucide / Rune).
- **Rare-UI Stepped Onboarding & Rolling Counters**: Smooth stepped progress onboarding player and vertical rolling odometer counters for live balances.

---

## 🏛️ Repository Architecture

This repository contains both the **React Native / Expo Mobile App** and the **On-Chain Anchor Solana Smart Program**:

```
haptix-mobile-app/
├── app/                            # Expo Router file-based navigation
│   ├── (tabs)/                     # Main authenticated tab views
│   │   ├── account/                # Smart wallet dashboard, send, receive
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
├── tests/                          # 146-test end-to-end integration test suite
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

## ⚡ Quick Start: Mobile App

### Prerequisites
- Node.js (v18+)
- Android Studio / Android Emulator or a physical Solana Mobile device (Saga / Chapter 2)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Integration Tests
Verify all 146 cryptographic, PDA derivation, precompile serialization, and live Devnet verification checks:
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

## 🔒 Quick Start: Smart Program (`haptix_program`)

### Program Details (Solana Devnet)
- **Program ID**: `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`
- **Solana Cluster**: `devnet`
- **Native Elliptic Curve**: `Secp256r1` (P-256 / WebAuthn)
- **Precompile**: `Secp256r1SigVerify11111111111111111111111`

### Build & Test On-Chain
```bash
cd haptix_program
anchor build
anchor test
```

---

## 🧪 Integration Test Suite (146 / 146 Passing)

The repository includes a comprehensive test suite validating the complete cryptographic and on-chain pipeline:

```
===============================================================
  HAPTIX SMART WALLET — REAL INTEGRATION TEST SUITE   
===============================================================

--- TEST GROUP 1: SECP256R1 CRYPTOGRAPHY ---
  PASS: Primary private key seed is exactly 32 bytes
  PASS: Primary compressed public key is exactly 33 bytes
  PASS: Public key prefix is 0x02 or 0x03 SEC1 format
  PASS: Secondary compressed public key is exactly 33 bytes

--- TEST GROUP 2: ANCHOR PDA DERIVATION ---
  PASS: Wallet address is off-curve PDA
  PASS: Valid canonical bump derived

--- TEST GROUP 3: SECP256R1 PRECOMPILE INSTRUCTION ---
  PASS: Transfer payload is exactly 40 bytes (32B pubkey + 8B amount)
  PASS: Compact signature is exactly 64 bytes [r (32B), s (32B)]
  PASS: Signature enforces canonical low-S (s <= n/2)
  PASS: Precompile instruction targets Secp256r1SigVerify1111111111111111111111111
  PASS: Precompile instruction data length is 153 bytes

--- TEST GROUP 4: ANCHOR INSTRUCTION ENCODING ---
  PASS: initialize_wallet discriminator matches on-chain Anchor IDL
  PASS: execute_transfer discriminator matches on-chain Anchor IDL
  PASS: grant_agent_session discriminator matches on-chain Anchor IDL
  PASS: agent_execute discriminator matches on-chain Anchor IDL
  PASS: panic_freeze discriminator matches on-chain Anchor IDL
  PASS: unfreeze discriminator matches on-chain Anchor IDL

--- TEST GROUP 5: LIVE SOLANA DEVNET ON-CHAIN VERIFICATION ---
  PASS: Program account exists on Devnet (9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke)
  PASS: Program account is executable on Devnet

--- SPEND THRESHOLD ON-CHAIN GOVERNANCE (DEVNET) ---
  PASS: initializes wallet with 0.1 SOL spending limit
  PASS: on-chain threshold matches initial 0.1 SOL
  PASS: rejects threshold update lacking valid secondary signature
  PASS: updates threshold to 0.5 SOL with 2-of-2 quorum
  PASS: on-chain threshold verified as 0.5 SOL

===============================================================
  TOTAL: 146 | PASSED: 146 | FAILED: 0
===============================================================
```

---

## 🎨 UI & Design Principles

- **Pure Minimalist Monochrome**: Dark tones paired with crisp typography and subtle hairline borders, completely free of neon / AI-slop cliches.
- **Physical Haptic Feedback**: Tactile responses on dock tab selection, percentage chip taps, and biometric passkey authorization.
- **Tabular Figures & Rolling Counters**: Numbers never clip or jump jarringly thanks to monospace numeric geometry and smooth bezier rolling.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
