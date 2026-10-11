# Haptix — Next-Gen Passkey Smart Wallet for Solana Mobile

<div align="center">

![Haptix Banner](haptix-mobile-app/assets/images/splash-icon.png)

**Seedless. Biometric-Secured. Agent-Ready.**  
*Built for the Solana Mobile Ecosystem (Saga / Chapter 2)*

[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=flat&logo=solana)](https://solana.com)
[![Expo](https://img.shields.io/badge/Expo-55.0-000020?style=flat&logo=expo)](https://expo.dev)
[![Anchor](https://img.shields.io/badge/Anchor-0.31-2B2D42?style=flat)](https://www.anchor-lang.com)
[![Secp256r1](https://img.shields.io/badge/Cryptography-Secp256r1%20%2F%20P--256-blue?style=flat)](https://docs.solana.com)
[![Documentation](https://img.shields.io/badge/Docs-Mintlify-4F6BFF?style=flat&logo=gitbook&logoColor=white)](https://haptix-docs.mintlify.app)
[![Twitter](https://img.shields.io/badge/X-@HaptixWalllet-black?style=flat&logo=x)](https://x.com/HaptixWalllet)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<br />

**[Live Docs](https://haptix-docs.mintlify.app)** &bull; **[X Community](https://x.com/HaptixWalllet)** &bull; **[Download Release APK (v1.0.0)](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.0/haptix-wallet.apk)** &bull; **[Download Pitch Deck PDF](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.0/Haptix_Pitch_Deck.pdf)** &bull; **[GitHub Release v1.0.0](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.0)** &bull; **[Live Devnet Program](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)**

</div>

---

## 📱 Latest Standalone APK (v1.0.0)

| Attribute | Verified Value |
| :--- | :--- |
| **Release Tag** | [`v1.0.0`](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.0) |
| **Direct APK Binary** | [**haptix-wallet.apk (97.7 MB)**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.0/haptix-wallet.apk) |
| **EAS Build ID** | `6e6cbb0a-cb5b-4e38-bd17-c5345c8f767a` |
| **EAS Build Console** | [View Build Logs on Expo.dev](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/6e6cbb0a-cb5b-4e38-bd17-c5345c8f767a) |
| **Passkey UX** | Auto-targeted active wallet passkey (Zero-picker direct fingerprint prompt) |
| **Cloud Relay** | [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (24/7 UptimeRobot monitored) |

---

## Overview

**Haptix** is a consumer-grade smart contract wallet designed natively for **Solana Mobile Stack (SMS)**. 

Traditional mobile wallets force users to manage 12-to-24 word seed phrases or endure annoying biometric popups for every trivial transaction. Haptix eliminates seed phrases entirely by utilizing **Hardware Passkeys (Secp256r1 / P-256)** verified directly on Solana through native **instruction introspection (`Secp256r1SigVerify`)**.

### Key Innovations

- **Zero-SOL Gasless Onboarding (Sponsored Paymaster)**: Users create and initialize smart wallets on-chain with zero pre-funded SOL. The embedded paymaster sponsors creation rent and drips a welcome 0.10 SOL starter test balance.
- **Seeker (SKR) Token Architecture Ready ($10,000 Bonus Track)**: Multi-asset spend policy engine architected for the Solana Mobile Seeker ecosystem, featuring risk-adaptive thresholds (1-tap passkey for ≤ 50 SKR, 2-of-2 hardware quorum for > 50 SKR) with 18 passing tests in our integration test suite.
- **1-Tap Biometric Hardware Passkey**: Fast, frictionless Face ID / Touch ID authentication without seed phrases.
- **2-of-2 Hardware Quorum**: High-value transactions or security policy updates mathematically mandate two independent hardware signatures (e.g. Phone Secure Enclave + Backup YubiKey / Mac Touch ID).
- **Autonomous AI Agent Sessions**: Delegate scoped spending power to AI agents (e.g., automated DCA or arbitrage) with on-chain budget ceilings and time expiries—zero user interruption required.
- **Instant Panic Freeze & Guardian Recovery**: Emergency circuit breaker allows guardians or users to freeze account outflows instantly in the event of compromised hardware.
- **Rare-UI `StepPlayer` Onboarding**: Fluid 8-screen onboarding flow with auto-advancing slides, interactive play/pause, and pill progress indicators.
- **Rare-UI `AnimatedCounter`**: High-performance vertical rolling digit odometer wheels for live USD portfolio balances and dynamic send outflow counters.
- **Expanded Transaction Preview**: Comprehensive transfer modal with real-time address validation, quick % chips (`25%`, `50%`, `75%`, `MAX`), estimated network fees, and security tier indicators.

---

## Repository Architecture

This repository contains both the **React Native / Expo Mobile App** and the **On-Chain Anchor Solana Smart Program**:

```
haptix-mobile-app/
├── haptix-mobile-app/              # React Native / Expo 55 Android Mobile App
│   ├── app/                        # Expo Router file-based navigation
│   │   ├── (tabs)/                 # Main authenticated tab views
│   │   │   └── account/            # Smart wallet dashboard, send, receive
│   │   ├── sign-in.tsx             # 8-Screen StepPlayer onboarding & passkey setup
│   │   └── _layout.tsx             # Root layout & providers
│   ├── components/                 # UI design system components
│   │   ├── haptix/                 # Haptix brand components & wallet views
│   │   │   ├── haptix-wallet-screen.tsx      # Main wallet dashboard & expanded send
│   │   │   ├── haptix-floating-dock.tsx      # Floating glassmorphic dock
│   │   │   └── haptix-icons.tsx              # Vector icon library
│   │   └── ui/                     # Reusable animated components
│   │       ├── step-player.tsx     # Rare-UI stepped progress player
│   │       └── animated-counter.tsx# Rare-UI rolling digit counter
│   ├── utils/                      # Cryptography, PDA derivation & RPC clients
│   │   ├── haptix-passkey.ts       # Secp256r1 hardware passkey signing
│   │   ├── haptix-client.ts        # Anchor instruction builder & account parser
│   │   └── secp256r1-instruction.ts# Native Secp256r1 precompile serializer
│   ├── tests/                      # 29-test end-to-end integration test suite
│   ├── constants/                  # On-chain Anchor IDL & configuration
│   ├── app.json                    # Expo config & native permissions
│   └── package.json                # Mobile app dependencies
│
├── haptix_program/                 # On-Chain Anchor 0.31 Solana Smart Contract
│   ├── programs/haptix_program/    # Rust program implementation
│   │   └── src/
│   │       ├── instructions/       # Transfer, Quorum, Agent, Recovery instructions
│   │       ├── secp256r1.rs        # Precompile instruction introspection
│   │       ├── state/              # Wallet account layout & spend policies
│   │       └── lib.rs              # Program entrypoint
│   ├── tests/                      # Anchor integration test suite
│   └── Anchor.toml                 # Anchor configuration & Devnet deployment
│
└── HACKATHON_SUBMISSION.md         # Solana Mobile Hackathon submission document
```

---

## Quick Start: Mobile App

### Prerequisites
- Node.js (v18+)
- Android Studio / Android Emulator or a physical Solana Mobile device (Saga / Chapter 2)

### 1. Install Dependencies
```bash
cd haptix-mobile-app
npm install
```

### 2. Run Integration Tests
Verify all 29 cryptographic, PDA derivation, precompile serialization, and live Devnet verification checks:
```bash
npm test
```

### 3. Start the Development Server
```bash
npx expo start
```
- Press `a` to run on Android emulator or connected device.
- Press `w` to open in desktop browser.

### 4. Build Android APK via EAS
```bash
npx eas-cli build -p android --profile development
```

### 5. Dual-Device Vault Cloud Relay (2-of-2 Multisig)
For production cross-device signing, the mobile app connects to the hosted cloud relay over HTTPS:
- **Local Dev:** `npm run relay` (listens on `0.0.0.0:8082`)
- **Production Cloud:** See [DEPLOY_RELAY.md](file:///Users/ritesh/Claude%20projects/passkey-wallet/solana-mobile/haptix-mobile-app/DEPLOY_RELAY.md) for 1-click Render / Railway deployment.
- **Web Co-Signer Portal:** [https://haptix-passkeys.vercel.app/vault.html](https://haptix-passkeys.vercel.app/vault.html)

---

## Quick Start: Smart Program (`haptix_program`)

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

## Integration Test Suite (29 / 29 Passing)

The repository includes a comprehensive standalone integration test suite (`tests/integration-test.ts`) that validates the complete cryptographic and on-chain pipeline:

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
  PASS: Valid canonical bump derived: 249

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
  PASS: Program account exists on Devnet (YTdPGhiX7wgA9mQPJpUXqXRFzRvMBLwRAJBWdTVUHWL)
  PASS: Program account is executable on Devnet
      On-chain program owner: BPFLoaderUpgradeab1e11111111111111111111111

===============================================================
  TOTAL: 29 | PASSED: 29 | FAILED: 0
===============================================================
```

---

## UI & Design Principles

- **Pure Minimalist Monochrome**: Pitch black (`#000000`) and charcoal surfaces (`#0C0C0C`) paired with crisp white (`#FFFFFF`) and silver accents (`#A1A1AA`). Completely free of neon/cyan clutter.
- **Physical Haptic Feedback**: Tactile responses on dock tab selection, percentage chip taps, and passkey authorization.
- **Tabular Figures & Rolling Counters**: Numbers never clip or jump jarringly thanks to monospace numeric geometry and smooth bezier rolling.

---

## License
This project is licensed under the MIT License - see the LICENSE file for details.
