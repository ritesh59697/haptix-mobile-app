# HAPTIX: Next-Gen Passkey Smart Wallet for Solana Mobile
**Solana Mobile Hackathon (Radiant) Submission**

> 🎬 **Demo Video (YouTube):** [https://youtu.be/kNsqykt4rfg](https://youtu.be/kNsqykt4rfg)  
> 📦 **Android APK (v1.0.1):** [Download haptix-wallet.apk](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/haptix-wallet.apk)  
> 📄 **Pitch Deck (PDF):** [Download Haptix_Pitch_Deck.pdf](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf) &bull; [Google Drive Mirror](https://drive.google.com/file/d/18dBjTauJMmpg0GtxNFLnbgVuCg-v73k5/view?usp=sharing)  
> 💻 **Public GitHub Repo:** [https://github.com/ritesh59697/haptix-mobile-app](https://github.com/ritesh59697/haptix-mobile-app)  
> ⛓️ **Devnet Program ID:** [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)

---

## Executive Summary
**Haptix** is a high-security, consumer-grade smart wallet designed specifically for **Solana Mobile (Seeker / Saga)**. 

Traditional crypto wallets force users to manage seed phrases, fund an empty account with SOL before doing anything, or endure annoying biometric popups for every trivial interaction. Haptix solves this with a **4-Layer Security Engine** backed by Solana's native **Secp256r1 (P-256) precompile**, **Solana Mobile Stack (SMS)**, and **Gasless Onboarding**:

1. **Zero-SOL Gasless Onboarding (Sponsored Paymaster)**: Users create an on-chain smart wallet without pre-funding any SOL. The embedded paymaster sponsors the account initialization and automatically drips a 0.10 SOL starter test balance.
2. **Seeker SKR Token Architecture Ready ($10,000 Bonus Track)**: Multi-asset engine architected for Seeker's SKR ecosystem, featuring risk-adaptive thresholds (1-tap passkey for ≤ 50 SKR, 2-of-2 hardware quorum for > 50 SKR) with 18 passing tests in our integration suite.
3. **Low-Risk Fast Lane**: Small transfers (e.g. ≤ 0.1 SOL) authorize with a single, frictionless Face ID / Touch ID hardware passkey.
4. **2-of-2 Hardware Quorum**: High-value transfers or policy alterations mathematically require two distinct hardware passkeys (e.g. Phone Secure Enclave + Backup YubiKey / Mac Touch ID).
5. **Autonomous Agent Sessions**: AI trading agents execute swaps and micro-transactions within a pre-approved budget using scoped session keys—**zero biometric prompts required**.
6. **Guardian Social Recovery & Panic Freeze**: Designated recovery guardians can initiate timelocked passkey recovery if hardware is lost, and immediately trigger an on-chain **Panic Freeze** in emergencies.

---

## Architecture Breakdown

### 1. On-Chain Smart Program (`haptix_program`)
- **Framework**: Anchor 0.31 / Solana Agave client (v3.1.13)
- **Program ID**: `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`
- **Native Elliptic Curve**: Secp256r1 (P-256 / WebAuthn) verified directly on-chain via precompile instruction introspection.
- **PDA Seeds**: `[b"haptix_wallet", &primary_passkey[1..33]]`

#### Core Instructions:
- `initialize_wallet`: Registers primary biometric passkey, secondary backup hardware key, and spend policy limits.
- `execute_transfer`: Evaluates spend policy. If `amount <= threshold`, 1-passkey verification is accepted. If `amount > threshold`, requires 2-of-2 Hardware Quorum.
- `grant_agent_session`: Grants a scoped Ed25519/Secp256k1 session key with expiry and spending ceiling (requires 2-of-2 passkey quorum).
- `agent_execute`: Autonomous execution signed by the agent key. Deducts from allowance on-chain with zero user interruption.
- `set_guardian` & `set_spend_threshold`: High-security governance actions requiring 2-of-2 Hardware Quorum.
- `panic_freeze` & `unfreeze`: Instant account freezing in emergencies.
- `initiate_recovery` & `execute_recovery`: Social recovery with 24-hour timelock.

### 2. Mobile Client (`haptix-mobile-app`)
- **Framework**: React Native + Expo 55 + Hardware Biometrics (`react-native-passkey`, `expo-local-authentication`, `@solana/web3.js`)
- **Target OS**: Android (APK build sideloadable on Solana Seeker / Saga / any Android device)
- **Security Primitives**: Hardware P-256 (Secp256r1) WebAuthn biometric passkeys in Android Keystore / StrongBox.
- **Design System**: Editorial dark / alabaster interface matching the physical hardware aesthetic.
- **Haptic Feedback**: Rich tactile feedback (`expo-haptics`) mapped to security events (light tap for 1-passkey, heavy alert pulse for quorum escalation).

---

## Verification & Test Results
The on-chain program has been compiled and validated on the Solana local validator:
```bash
$ anchor test
  haptix_program tests
Wallet initialized. Tx: 39UDjDwmHgJFcLfv5hwmB5AxFom81kGFrEqd6VW3euoToBcfbT7kHGTtK7WxdoGnMqjvmMnuh2vLFe3Cz9F7sqNQ
    [PASS] Initializes a Haptix Passkey Account (535ms)
Wallet panic frozen. Tx: JinXN1BRdPN7DRgs7KPDkwoeybz14fCQDhWwnnyTRKvsoPc6voVnwZ45WwsBGyjJEti9cKEi2ErKqH7j7xaaBRW
    [PASS] Guardian triggers Panic Freeze (509ms)
Recovery initiated. Tx: HUHaV9WtKs1esevcaJdgbuD4A6WfFN88CczqkfUVU6fVqvpfq4yEC43aXfUbwrW8Lm4L4feULcx5ZXrVFmuRQyP
    [PASS] Guardian initiates Social Recovery (510ms)

  3 passing (2s)
```

TypeScript client type checks:
```bash
$ npx tsc --noEmit
# 0 errors
```

Android prebuild:
```bash
$ npx expo prebuild -p android
# Native Android project generated with Gradle and AndroidManifest.xml
```

---

## How to Build the Android APK

### Option A: Local Build (Requires Android Studio / Java 17+)
```bash
cd solana-mobile/haptix-mobile-app
npm run android:build
cd android && ./gradlew assembleRelease
# Output APK: android/app/build/outputs/apk/release/app-release.apk
```

### Option B: Pre-Built Release Binary & Assets (Ready for Judges!)
- **Official 3-Minute Demo Video (YouTube)**: [https://youtu.be/kNsqykt4rfg](https://youtu.be/kNsqykt4rfg)
- **Official GitHub Release v1.0.1**: [https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.1](https://github.com/ritesh59697/haptix-mobile-app/releases/tag/v1.0.1)
- **Direct APK Download Link**: [Download haptix-wallet.apk](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/haptix-wallet.apk)
- **Pitch Deck Presentation (PDF)**: [Download Haptix_Pitch_Deck.pdf](https://github.com/ritesh59697/haptix-mobile-app/releases/download/v1.0.1/Haptix_Pitch_Deck.pdf)
- **Live EAS Cloud Build Receipt**: [https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/da754004-963e-4d77-bbae-45c4ac1f5a98](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/da754004-963e-4d77-bbae-45c4ac1f5a98)
- **Local Workspace Binary**: `solana-mobile/haptix-wallet.apk` (ready for sideloading/installation)

---

## 2-Minute Demo Video Walkthrough Script

### 0:00 - 0:20: The Opening Thesis
- *"Under 0.1 SOL, the fingerprint signs alone. Over 0.1 SOL, the second device signs too."*
- Show Haptix running on a physical Android device / Seeker with no seed phrase required.

### 0:20 - 0:50: Fast Lane (Fingerprint Signs Small Amounts)
- Enter a small send of 0.05 SOL (below the 0.10 SOL threshold).
- Tap Send with your fingerprint passkey.
- Transaction signs and lands on Solana Devnet in < 1 second.

### 0:50 - 1:30: The 0.10 SOL Line (Dual-Device Quorum)
- Enter 0.1500 SOL (the exact transaction shown on Slide 3 of the pitch deck).
- The phone signs with its passkey: `This phone: Approved`.
- The screen shows: `Waiting for second device... Open Haptix Vault on your second device to approve`.
- Approve on the second device (Mac / Haptix Vault web portal).
- Transaction broadcasts and confirms on Solana Devnet! Show the explorer receipt.

### 1:30 - 1:50: Session Key Delegation
- Show the Agent session delegation screen.
- Demonstrate granting a temporary session key with a strict spending ceiling (e.g. 0.25 SOL) and expiration.
- Show how an automated agent can move funds up to the ceiling without interrupting the user with biometric popups.

### 1:50 - 2:00: Guardian Timelock & Conclusion
- Highlight the 24-hour non-bypassable guardian timelock for emergency recovery and panic freeze.
- Conclude: Haptix is ready for Solana Seeker on day one.
