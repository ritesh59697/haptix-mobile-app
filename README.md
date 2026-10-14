<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/assets/logotext-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="public/assets/logotext-light.png">
  <img alt="Haptix — Next-Gen Passkey Smart Wallet for Solana Mobile" src="public/assets/logotext-dark.png" width="340" />
</picture>

<br /><br />

**Seedless. Biometric-Secured. Agent-Ready.**  
*Built specifically for the **Solana Mobile CLOCK IN Hackathon** & **Colosseum** &bull; Dedicated to **Solana Seeker***

[![CLOCK IN Hackathon](https://img.shields.io/badge/Hackathon-CLOCK%20IN%20(Solana%20Mobile)-00FF66?style=flat&logo=solana)](https://solanamobile.radiant.nexus)
[![Colosseum](https://img.shields.io/badge/Hackathon-Colosseum-blueviolet?style=flat)](https://arena.colosseum.org)
[![Target Device](https://img.shields.io/badge/Target-Solana%20Seeker-black?style=flat&logo=android)](https://solanamobile.com)
[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=flat&logo=solana)](https://solana.com)
[![Expo](https://img.shields.io/badge/Expo-55.0-000020?style=flat&logo=expo)](https://expo.dev)
[![Anchor](https://img.shields.io/badge/Anchor-0.31-2B2D42?style=flat)](https://www.anchor-lang.com)
<br />
[![Secp256r1](https://img.shields.io/badge/Cryptography-Secp256r1%20%2F%20P--256-blue?style=flat)](https://docs.solana.com)
[![Live Web Vault](https://img.shields.io/badge/Web%20Vault-Vercel-black?style=flat&logo=vercel)](https://haptix-passkeys.vercel.app/vault.html)
[![Documentation](https://img.shields.io/badge/Docs-Mintlify-4F6BFF?style=flat&logo=gitbook&logoColor=white)](https://haptix-docs.mintlify.app)
[![Twitter](https://img.shields.io/badge/X-@HaptixWallet-black?style=flat&logo=x)](https://x.com/HaptixWalllet)
[![Tests](https://img.shields.io/badge/Tests-290%20Passing-brightgreen?style=flat)](tests/)

<br />

[Website](https://haptix-passkeys.vercel.app) &middot; [Web Vault](https://haptix-passkeys.vercel.app/vault.html) &middot; [Download APK (v1.0.1)](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/haptix-wallet.apk) &middot; [Pitch Video (70s)](https://youtu.be/9OnEFuHqNDY) &middot; [Walkthrough (3m)](https://youtu.be/kNsqykt4rfg) &middot; [Docs](https://haptix-docs.mintlify.app) &middot; [Pitch Deck](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf) &middot; [Devnet Program](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)

</div>

---

## Hackathon Deliverables

| Deliverable | Details & Links |
| :--- | :--- |
| **Track & Target** | Solana Mobile CLOCK IN Hackathon &bull; Dedicated to **Solana Seeker (Chapter 2)** |
| **Android APK** | [**Download haptix-wallet.apk (v1.0.1)**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/haptix-wallet.apk) &bull; EAS Build ID: [`da754004`](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/da754004-963e-4d77-bbae-45c4ac1f5a98) |
| **Live Web Demos** | [**Website**](https://haptix-passkeys.vercel.app) &bull; [**Web Vault (Co-Signer)**](https://haptix-passkeys.vercel.app/vault.html) |
| **Video Demos** | [**70-Second Pitch**](https://youtu.be/9OnEFuHqNDY) &bull; [**3-Minute Technical Walkthrough**](https://youtu.be/kNsqykt4rfg) |
| **Pitch Deck** | [**Haptix_Pitch_Deck.pdf**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf) |
| **On-Chain Program** | [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet) on Solana Devnet |
| **Test Verification** | **290 automated tests passing** across 14 test suites (`npm test`) |
| **Cloud Paymaster** | [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (Gas sponsorship relay) |

---

## Overview

Haptix is a risk-adaptive passkey smart wallet built natively for the Solana Mobile Stack (SMS) and the Solana Seeker (Chapter 2):

1. **Hardware-Backed Passkey Biometrics**: Integrates Android Credential Manager and the Secp256r1 hardware curve (`react-native-passkey`) for seedless, 1-tap biometric authentication.
2. **2-of-2 Hardware Biometric Quorum**: Transfers &le; 0.10 SOL (or &le; 50 SKR) authorize instantly via single-tap biometrics. Transfers exceeding the threshold automatically escalate to require dual authorization across devices (mobile phone + secondary Web Vault passkey).
3. **100% On-Chain Enforcement**: Cryptographic verification executes via Solana's native `Secp256r1SigVerify` precompile with instruction introspection. The cloud paymaster only sponsors fees—it cannot forge signatures or divert funds.
4. **Scoped Session Keys & Recovery**: Temporary, expenditure-capped keys for frictionless dApp interactions, paired with a non-custodial 24-hour social guardian timelock recovery system.

---

## Repository Architecture

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
├── public/                         # Web applications & static assets
│   ├── index.html                  # Official landing page, threat models & FAQ
│   ├── vault.html                  # Live Web Vault (2-of-2 hardware multisig client)
│   ├── recover.html                # Social Guardian timelock recovery interface (Roadmap)
│   └── assets/                     # Brand graphics, vector marks & media
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

## Quick Start

### Mobile App
```bash
# 1. Install dependencies
npm install

# 2. Run the 14-suite automated integration test harness
npm test

# 3. Start Expo development server
npx expo start

# 4. Build standalone Android APK with EAS
npx eas-cli build -p android --profile preview
```

### Smart Program (`haptix_program`)
- **Program ID**: `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke` (Solana Devnet)
- **Precompile**: `Secp256r1SigVerify1111111111111111111111111`

```bash
cd haptix_program
anchor build
anchor test
```

---

## Automated Test Suite (290 / 290 Passing)

The cryptographic pipeline, on-chain program, and spend policies are verified by 290 automated integration tests across 14 suites:

```bash
npm test
```

- **Cryptography & Precompile**: Secp256r1 signature encoding, low-S canonical form, instruction introspection offsets.
- **On-Chain Policies**: Spend threshold escalation, 2-of-2 hardware quorum, and Seeker SKR token rules.
- **Social Recovery**: 24-hour timelock execution, guardian authorization, and owner veto on live Solana Devnet.

---

## Design Principles

- **Minimalist Monochrome**: Precision typography, dark tones, and subtle hairline borders—no neon or generic cliches.
- **Physical Haptics**: Tactile feedback on navigation, percentage chips, and biometric passkey authorization.
- **Monospace Geometry**: Tabular figures and rolling counters to prevent jarring layout jumps.

---

Built by [Ritesh](https://x.com/Ritesh5969)
