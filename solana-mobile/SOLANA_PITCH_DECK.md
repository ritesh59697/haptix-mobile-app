# Haptix — Pitch Deck (Solana Mobile Hackathon)

> **The Biometric Hardware Enclave Smart Wallet for Solana Seeker & Saga**  
> *Seedless Human Security. 2-of-2 Hardware Quorum. Autonomous AI Agent Delegation.*

---

## Slide 1: Title & Elevator Pitch

<div align="center">

# HAPTIX
### Next-Gen Passkey Smart Wallet for Solana Mobile

**Seedless Biometrics · Secp256r1 On-Chain Introspection · 2-of-2 Hardware Quorum · AI Agent Session Keys**

*Targeting: Solana Seeker (Chapter 2) · Solana Saga · Solana dApp Store*

</div>

> **Presenter Notes:**  
> "Haptix is a consumer-grade smart contract wallet engineered specifically for Solana Mobile. By pairing Android's biometric hardware enclaves with Solana's native Secp256r1 precompile, we eliminate seed phrases entirely, introduce risk-adaptive 2-of-2 hardware security, and give autonomous AI agents safe, bounded on-chain execution."

---

## Slide 2: The Problem

### "Mobile Web3 Is Trapped Between UX Friction and Total Insecurity"

```
   TODAY'S BROKEN MOBILE PARADIGM:

   [ Seed Phrase Friction ]        [ All-or-Nothing Signing ]        [ AI Agent Hot Keys ]
   • 12-24 words written on paper  • Biometric popup for every $0.10 • Raw private keys in memory
   • 1 single point of failure     • Fatigue leads to blind-signing  • Prompt injection = 100% drain
   • #1 reason users abandon apps  • Zero risk categorization        • No bounded budgets on mobile
```

1. **Seed Phrase Fatigue**:
   - Seed phrases are the worst onboarding UX in tech. Lose the paper, lose your funds. Leak the phrase, lose everything.
2. **Security Fatigue on Mobile**:
   - Existing mobile wallets treat a $0.05 micro-swap with the same friction as a $50,000 transfer. Users get prompt fatigue and blind-sign malicious approvals.
3. **The AI Agent Dilemma**:
   - AI trading agents are exploding on Solana, but on mobile, agents either require a human to sign every trade or hold raw hot keys in plaintext memory.

---

## Slide 3: The Solution

### "Haptix: Moving Security Policy into Solana Anchor Bytecode"

Haptix replaces vulnerable seed phrases and client-side popups with a **4-Layer Smart Wallet Architecture** verified directly on-chain via Solana's native **Secp256r1 (P-256) precompile instruction introspection**:

```
                       ┌─────────────────────────────────────────┐
                       │       Incoming Transaction Request      │
                       └────────────────────┬────────────────────┘
                                            │
                                            ▼
                       ┌─────────────────────────────────────────┐
                       │     haptix_program (Anchor on Devnet)   │
                       └────────────────────┬────────────────────┘
                                            │
             ┌──────────────────────────────┼──────────────────────────────┐
             ▼                              ▼                              ▼
    [ Low-Value Spend ]           [ High-Value Spend ]            [ AI Agent Trade ]
    Amount <= 0.1 SOL             Amount > 0.1 SOL                Bounded Session Key
             │                              │                              │
             ▼                              ▼                              ▼
    1-Tap Hardware Passkey        2-of-2 Hardware Quorum          Autonomous Execution
    (Touch ID / Face ID)          (Phone + 2nd Device / Key)      (Zero User Interruption)
    ~400ms On-Chain               Mathematical Enforcement        Deducted from Allowance
```

---

## Slide 4: Key Technical Innovations

### 1. Native Secp256r1 (P-256) Curve Verification
- Uses Solana's native `Secp256r1SigVerify` precompile via instruction introspection (`get_instruction_relative`).
- Private keys **never leave the phone's hardware enclave** (Android Keystore / StrongBox).

### 2. Risk-Adaptive Spending Threshold
- **Low-Risk Fast Lane (≤ 0.1 SOL)**: 1-tap passkey. Lightning-fast microtransactions.
- **High-Risk Escalation (> 0.1 SOL)**: Automatically escalates to **2-of-2 Hardware Quorum**. Requires Passkey #1 (phone) + Passkey #2 (out-of-band Mac Touch ID, YubiKey, or backup hardware).

### 3. Gasless Onboarding (0.1 SOL Starter Faucet)
- New wallets are immediately funded with 0.1 Devnet SOL and initialized on-chain.
- Users never land on an empty `$0.00` dead-end wallet.

### 4. Autonomous AI Agent Session Keys
- Grants temporary, budget-constrained Ed25519/Secp256k1 keys to trading bots.
- Agents execute autonomous swaps within policy limits with **zero human biometric popups**.

### 5. Guardian Social Recovery & Panic Freeze
- Lost device? Social guardians initiate a 24-hour timelocked passkey rotation.
- Suspected exploit? Guardians or users trigger an on-chain **Panic Freeze** to halt all outflows immediately.

---

## Slide 5: Seeker Ecosystem & SKR Integration Architecture ($10,000 Bonus Track)

Haptix is designed from day one to natively support the upcoming **Solana Seeker (Chapter 2)** ecosystem and its official SKR token upon launch:

- **Ecosystem-Ready Token Architecture**: The Haptix spend policy engine natively accommodates SPL tokens with configurable risk thresholds alongside native SOL.
- **Risk-Adaptive SKR Policy (Validated in Integration Suite)**:
  - `≤ 50 SKR`: 1-tap instant biometric passkey authorization.
  - `> 50 SKR`: Automatically escalates to 2-of-2 hardware quorum.
  - Fully tested in `tests/seeker-skr.test.ts` (18 passing test cases).
- **Official Seeker Branding**: Vector-precise Seeker mark and token metadata definitions ready to bind to the mainnet SKR mint upon launch.
- **Solana Mobile Stack (SMS) Ready**: Designed for Seeker Seed Vault integration and dApp Store publishing guidelines.
- **Tactile Haptic Feedback**: Powered by `expo-haptics`, giving users distinct physical vibrations for safe approvals vs high-risk quorum alerts.

---

## Slide 6: Product Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HAPTIX SYSTEM ARCHITECTURE                      │
├───────────────────────────────────┬────────────────────────────────────┤
│           MOBILE CLIENT           │          ON-CHAIN SMART PROGRAM    │
│  (React Native 0.83 / Expo 55)    │           (Anchor 0.31 / Rust)     │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Native Android BiometricPrompt  │ • Program ID: 9wC1ok8d4P...Zbke    │
│ • WebAuthn / Passkey P-256 Signer │ • Precompile Introspection         │
│ • Account Switcher & Theme Modal  │ • Counterfactual PDA Derivation    │
│ • Local Funder Treasury Relayer   │ • Dynamic Threshold Evaluation     │
│ • Out-of-Band WebRTC Relay Tool   │ • Scoped Agent Allowance Engine    │
│ • Pitch-black Minimalist UI       │ • 24h Timelocked Social Recovery   │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## Slide 7: Competitive Landscape

| Feature | Phantom / Solflare | Backpack | Safe (EVM) | **Haptix (Solana Mobile)** |
|:---|:---|:---|:---|:---|
| **Seedless Hardware Passkeys** | No (Seed Phrase) | No (Seed Phrase) | WebAuthn only | **Yes (Secp256r1 Native)** |
| **Risk-Adaptive Quorum** | No (1-key only) | No | Complex multisig | **Yes (1-Key vs 2-of-2 Quorum)** |
| **Out-of-Band Hardware Pair** | No | No | No | **Yes (Phone + Mac Touch ID / YubiKey)** |
| **AI Agent Session Delegation** | No | No | Session Keys | **Yes (On-Chain Bounded Budget)** |
| **Gasless First-Run Top-Up** | No ($0 dead-end) | No | No | **Yes (0.1 SOL Auto-Funder)** |
| **Seeker SKR Native Support** | Basic SPL | Basic SPL | None | **Architecture Ready (Risk Tiers Tested)** |
| **Emergency Panic Freeze** | No | No | Guard Module | **Yes (On-Chain Instant Freeze)** |

---

## Slide 8: Market Opportunity & Traction

- **Solana Seeker Pre-Orders**: Over **150,000+** hardware units pre-ordered across 50+ countries.
- **Target Audience**: 150k+ crypto-native mobile users who demand seedless convenience without sacrificing cold-storage security.
- **Verified On-Chain Readiness**:
  - Deployed on **Solana Devnet** (`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`).
  - **57 out of 57** integration tests passing live on Devnet.
  - Release APK built and validated.

---

## Slide 9: Team & Hackathon Timeline

- **Hackathon**: CLOCK IN — The 3rd Solana Mobile Hackathon (RadiantsDAO x Solana Mobile).
- **Track**: Consumer Mobile App / Solana Mobile Stack / SKR Integration Bonus Track.
- **Deliverables**:
  - Live GitHub Repository (Full Open Source).
  - Standalone Android APK (`haptix-wallet.apk`).
  - Live Devnet Anchor Program & Verified Contract Receipts.
  - 3-Minute Demo Video Walkthrough.
  - Full Testing & Reproducibility Guide.

---

## Slide 10: Conclusion & Vision

<div align="center">

### Haptix turns the Solana Seeker into the most secure consumer smart wallet on Earth.

**No seed phrases. No blind signing. No unconstrained bots.**

[GitHub Repository](https://github.com/ritesh59697/haptix-mobile-app) · [Devnet Explorer](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet) · [Download APK](https://expo.dev/artifacts/eas/87Q9THZikUdtFiCe41nZNSSyRl1BPJTqk6LYayDM3ZI.apk)

</div>
