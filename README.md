<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/assets/logotext-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="public/assets/logotext-light.png">
  <img alt="Haptix — Next-Gen Passkey Smart Wallet for Solana Mobile" src="public/assets/logotext-dark.png" width="340" />
</picture>

<br /><br />

**Seedless. Biometric-Secured. Agent-Ready.**  
*Built specifically for the **Solana Mobile CLOCK IN Hackathon** &bull; Dedicated to **Solana Seeker***

[![CLOCK IN Hackathon](https://img.shields.io/badge/Hackathon-CLOCK%20IN%20(Solana%20Mobile)-00FF66?style=flat&logo=solana)](https://solanamobile.radiant.nexus)
[![Target Device](https://img.shields.io/badge/Target-Solana%20Seeker-black?style=flat&logo=android)](https://solanamobile.com)
[![Solana dApp Store](https://img.shields.io/badge/Solana%20dApp%20Store-Live%20v1.0.2-14F195?style=flat&logo=solana)](https://publish.solanamobile.com)
[![Cryptography](https://img.shields.io/badge/Cryptography-Secp256r1%20%2F%20P--256-blue?style=flat)](https://docs.solana.com)
[![Tests](https://img.shields.io/badge/Tests-290%20Passing-brightgreen?style=flat)](tests/)
[![License](https://img.shields.io/badge/License-MIT-white?style=flat)](LICENSE)

<br />

[Website](https://haptixwallet.xyz) &middot; [Download APK (v1.0.2)](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.2/haptix-wallet.apk) &middot; [Web Vault (Co-Signer)](https://haptixwallet.xyz/vault.html) &middot; [Recovery Portal](https://haptixwallet.xyz/recover.html) &middot; [Pitch Video (70s)](https://youtu.be/9OnEFuHqNDY) &middot; [Devnet Program](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)

</div>

---

## Hackathon Deliverables

| Deliverable | Details & Links |
| :--- | :--- |
| **Track & Target** | Solana Mobile CLOCK IN Hackathon &bull; Dedicated to **Solana Seeker (Chapter 2)** |
| **Solana dApp Store** | **Live & Published (v1.0.2 / Build 3)** &bull; Submission ID: `#344280197850` &bull; Package: `io.haptix.wallet` &bull; [Solana Mobile Publishing Portal](https://publish.solanamobile.com)<br />*Note: Mobile client is published on the dApp Store; smart contracts execute on Solana Devnet.* |
| **Android APK** | [**Download haptix-wallet.apk (v1.0.2)**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.2/haptix-wallet.apk) &bull; EAS Build ID: [`d1a7544a`](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/d1a7544a-1f49-47dc-a1c3-94c4be3ac105) &bull; Version Code: `3`<br />*Store compliance: Zero-config devnet gas auto-funding for reviewers (FUN-002) and minimal Android permissions (PER-001).* |
| **Recovery Guide** | [**Visual Guardian Recovery Guide**](docs/GUARDIAN_RECOVERY_GUIDE.md) &bull; On-chain lifecycle, timelock & veto walkthrough |
| **Live Web Demos** | [**haptixwallet.xyz**](https://haptixwallet.xyz) (Primary) &bull; [**Web Vault (Co-Signer)**](https://haptixwallet.xyz/vault.html) &bull; [**Recovery Portal**](https://haptixwallet.xyz/recover.html) &bull; *(Fallback: [haptix-passkeys.vercel.app](https://haptix-passkeys.vercel.app))* |
| **Video Demos** | [**70-Second Pitch**](https://youtu.be/9OnEFuHqNDY) &bull; [**3-Minute Technical Walkthrough**](https://youtu.be/kNsqykt4rfg) |
| **Pitch Deck & Docs** | [**Haptix_Pitch_Deck.pdf**](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf) &bull; [**Documentation**](https://docs.haptixwallet.xyz) |
| **On-Chain Program** | [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet) on Solana Devnet |
| **Test Verification** | **290 automated tests passing** across 14 test suites (`npm test`) |
| **Cloud Paymaster** | [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (Gas sponsorship relay &bull; *Render free tier*) |

---

## Overview

Haptix is a risk-adaptive passkey smart wallet built natively for the Solana Mobile Stack (SMS) and the Solana Seeker (Chapter 2):

1. **Hardware-Backed Passkey Biometrics**: Integrates Android Credential Manager and the Secp256r1 hardware curve (`react-native-passkey`) for seedless, 1-tap biometric authentication backed by the device's Secure Enclave / StrongBox.
2. **Risk-Adaptive Spend Escalation**: Transfers &le; 0.10 SOL (or &le; 50 SKR) authorize instantly via single-tap phone biometrics. High-value transfers exceeding the threshold automatically escalate to require a 2-of-2 dual-device hardware quorum (mobile phone passkey + secondary Web Vault passkey).
3. **On-Chain Cryptographic Verification**: Signature verification and spending limits are enforced directly on-chain via Solana's native `Secp256r1SigVerify` precompile with instruction introspection. The cloud paymaster only sponsors transaction fees—it possesses zero signing authority and cannot alter transaction recipients or amounts.
4. **Autonomous Agent Sessions**: Grants temporary, expenditure-capped session keys for automated agent interactions and swaps without triggering repetitive biometric prompts.
5. **Guardian Social Recovery & Panic Freeze**: Non-custodial 24-hour timelock recovery portal ([`recover.html`](https://haptixwallet.xyz/recover.html)) with instant on-chain panic freeze and owner 2-of-2 veto capabilities.

<br />

<div align="center">
  <img src="public/assets/quorum-dual-device.png" alt="Haptix Dual-Device Hardware Quorum" width="760" style="max-width: 100%; border-radius: 8px;" />
  <p><em>Risk-Adaptive Spend Escalation: 1-Tap Biometrics under 0.10 SOL, escalating to a 2-of-2 Hardware Quorum (Mobile + Web Vault) above threshold.</em></p>
</div>

---

### Signing & Policy Verification Flow

```mermaid
flowchart TD
    User([User Initiates Transfer]) --> Check{Amount &le; Threshold?<br/>&le; 0.10 SOL / 50 SKR}
    
    %% Low-Risk Lane
    Check -- Yes (Micro-transfer) --> P1[Primary Biometric Passkey<br/>Android Keystore / StrongBox]
    P1 --> Precompile1[Solana Secp256r1SigVerify<br/>Precompile Instruction]
    Precompile1 --> Program1[Haptix Smart Program<br/>Validate Policy & Execute Transfer]
    Program1 --> Confirmed([Transaction Settled on Solana])

    %% Escalated Lane
    Check -- No (High-Value Transfer) --> Escalation[Risk Escalation Alert<br/>2-of-2 Hardware Quorum Triggered]
    Escalation --> P2A[1. Phone Passkey Biometrics<br/>Primary Signature]
    Escalation --> P2B[2. Web Vault Passkey<br/>Secondary Co-Signature]
    P2A --> Precompile2[Verify Dual P-256 Signatures<br/>Instruction Introspection]
    P2B --> Precompile2
    Precompile2 --> Program2[Haptix Smart Program<br/>Enforce Dual Quorum & Settle]
    Program2 --> Confirmed
    
    Relay[Cloud Paymaster Relay] -.->|Zero-SOL Gas Sponsorship| Program1
    Relay -.->|Zero-SOL Gas Sponsorship| Program2
```

---

## Status & Operational Notes

- **Network Environment**: The smart contracts are deployed and verified on **Solana Devnet**. The mobile APK is published via the Solana Mobile Publishing Portal for catalog distribution, but all on-chain logic currently targets Devnet. Do not send real mainnet assets to devnet PDAs.
- **Security Audit Status**: The on-chain Anchor program and client cryptographic libraries are experimental hackathon implementations and have **not yet been audited** by a third-party security firm.
- **Paymaster Relay Infrastructure**: The zero-SOL gasless paymaster is hosted on Render's free tier. If the relay service has been idle, the initial request may experience a **30–50 second cold-start delay** while the container spins up. Subsequent transactions process in sub-second time.
- **Hardware Passkey Support**: Android Credential Manager passkey signing relies on hardware-backed keystores (StrongBox / TEE). Passkeys require a physical Android device (Seeker, Saga, Pixel, Galaxy running Android 9+) and cannot be tested inside headless emulators or Expo Go.

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
│   ├── recover.html                # Social Guardian timelock recovery web portal (Live)
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

### Prerequisites
- **Node.js**: v20+ &bull; **Rust**: 1.75+ (for smart contract builds)
- **Solana CLI**: v1.18+ &bull; **Anchor**: 0.31.0
- **Android Device**: Physical Android device with biometric lock screen (API 28+ / Android 9+), Solana Seeker, or Saga.
  > **Note on Expo Go**: Passkeys require the native Android Credential Manager hardware keystore (`react-native-passkey`). Standard Expo Go cannot execute native passkey modules; use prebuilt APKs or local development builds (`npx expo run:android`).

### Mobile App
```bash
# 1. Install dependencies
npm install

# 2. Run the 14-suite automated integration test harness (290 tests)
npm test

# 3. Start Expo development server (for native dev client)
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

## License

This project is open-source and licensed under the [MIT License](LICENSE).

---

Built by [Ritesh](https://x.com/Ritesh5969)
