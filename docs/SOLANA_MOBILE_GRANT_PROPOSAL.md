# Haptix: Passkey-Native Smart Wallet & Mobile Wallet Adapter (MWA) for Solana Seeker

**Grant Request:** Solana Mobile Ecosystem Grant  
**Proposed Budget:** $10,000 USD (Milestone-Based)  
**Project Lead:** Ritesh ([@Ritesh5969](https://x.com/Ritesh5969) / [GitHub](https://github.com/ritesh59697))  
**Project Links:** [Website](https://haptixwallet.xyz) &bull; [GitHub Repository](https://github.com/ritesh59697/haptix-mobile-app) &bull; [Documentation](https://docs.haptixwallet.xyz) &bull; [Solana Explorer (Devnet)](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)  
**Solana dApp Store Status:** **Approved & LIVE (v1.0.2 / Build 3)** &bull; Submission ID: `#344280197850` &bull; Package: `io.haptix.wallet`

---

## 1. Executive Summary

Haptix is a consumer-grade, seedless passkey smart wallet built natively for the **Solana Mobile Stack (SMS)** and the **Solana Seeker (Chapter 2)** ecosystem. It replaces vulnerable 12/24-word seed phrases with hardware-backed Android Keystore (`StrongBox`/`TEE`) biometric passkeys, enforcing on-chain spending firewalls, dual-device hardware escalation quorums, and 24-hour guardian social recovery directly via Solana's native `Secp256r1SigVerify` precompile.

Having already achieved **official approval and publication on the Solana Mobile dApp Store**, our next critical phase is **ecosystem interoperability**: transforming Haptix from a standalone consumer wallet into an **MWA-compatible Mobile Wallet Provider**. This will allow any third-party mobile dApp, game, or DeFi protocol on Solana Seeker to request authorized, policy-governed biometric transaction signing directly through Haptix.

---

## 2. Problem Statement & Ecosystem Opportunity

1. **Seed Phrase Drop-Off on Mobile**: 12/24-word seed phrases remain the single greatest point of failure and user drop-off in Web3 mobile adoption. Mobile users demand the seamless, 1-tap biometric experience of Apple Pay and Google Wallet.
2. **The Standalone Wallet Silo**: While Haptix currently provides 1-tap passkey transfers inside its own application, third-party mobile dApps cannot yet connect to Haptix to trigger passkey signatures.
3. **Complementary Security Beyond Ed25519 Seed Vault**: Solana Mobile's native Seed Vault is designed for single-device, single-key Ed25519 custody. However, users and AI agents require **programmable smart accounts** with:
   - On-chain spending thresholds (&le; 0.10 SOL or &le; 50 SKR fast-lane; higher amounts escalate to a 2-of-2 hardware quorum).
   - Cross-device multisig (co-signing between a Solana Seeker phone and a desktop/Mac Web Vault).
   - Time-bound, expenditure-capped session keys for automated AI agents.
   - Non-custodial 24-hour guardian social recovery with owner veto.

By integrating the **Mobile Wallet Adapter (MWA)** protocol, Haptix unlocks this entire programmable security suite for the broader Solana Mobile developer ecosystem.

---

## 3. Technical Architecture: How Haptix Operates

```
                                      HAPTIX ARCHITECTURE OVERVIEW

┌────────────────────────────┐              ┌─────────────────────────────┐
│    Physical Android Phone  │              │    Secondary Hardware Key   │
│   Solana Seeker / Android   │              │   Web Vault (Mac Touch ID / │
│  Android Keystore (StrongBox│              │   YubiKey / Windows Hello)  │
└─────────────┬──────────────┘              └──────────────┬──────────────┘
              │                                            │
              │ Primary P-256 Sig                          │ Secondary P-256 Sig
              │                                            │ (Only if > 0.10 SOL / 50 SKR)
              ▼                                            ▼
   ┌──────────────────────────────────────────────────────────────┐
   │         Solana Mobile Wallet Adapter (MWA) Endpoint          │
   │  (Third-Party Mobile dApps connect to Haptix via MWA SDK)   │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │             Cloud Paymaster Gas Sponsorship Relay            │
   │   (Zero-SOL gasless onboarding & transaction submission)     │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │         On-Chain Anchor Smart Contract (`haptix_program`)    │
   │                                                              │
   │  1. Secp256r1SigVerify Precompile Instruction Introspection  │
   │  2. WebAuthn authenticatorData & clientDataJSON parser       │
   │  3. Spend Policy: Instant if <= 0.10 SOL or <= 50 SKR         │
   │  4. Quorum Policy: Enforce 2-of-2 dual signatures if above   │
   │  5. Social Recovery: 24-hr timelock guardian rotation + veto │
   └──────────────────────────────────────────────────────────────┘
```

### Key Technical Distinctions:
* **Hardware Storage**: Secp256r1 private keys never leave the secure hardware element (Android Keystore StrongBox or TEE). 
* **On-Chain Precompile Introspection**: The Anchor smart contract (`haptix_program`) uses low-level instruction sysvar introspection to verify that Solana's native `Secp256r1SigVerify1111111111111111111111111` precompile executed successfully in the exact same transaction, verifying exact byte offsets, low-S canonical signatures, and SHA-256 message digests.
* **Native Seeker (SKR) Token Policy**: Already implemented and tested in the smart contract (`tests/seeker-skr.test.ts`):
  - Transfers &le; 50 SKR authorize instantly with 1-tap biometric passkey.
  - Transfers > 50 SKR automatically escalate to require 2-of-2 hardware quorum authorization.
  - Native Genesis welcome claim rules (100 SKR allocation).

---

## 4. Current Traction & Readiness

* **Solana dApp Store**: Officially approved & LIVE on the dApp Store catalog for Solana Seeker and Saga (v1.0.2 / Build 3). Compliant with publisher policies FUN-002 (zero-config devnet gas auto-funding for reviewers) and PER-001 (minimal Android permissions).
* **On-Chain Program**: Anchor 0.31 smart contract deployed on Solana Devnet (`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`).
* **Automated Test Coverage**: **324 automated tests passing** across 14 suites (`npm test`), with a **262-test zero-private-key runner** (`npm run test:no-key`) and active GitHub Actions continuous integration (CI).
* **Live Companions**:
  - Official Web Hub & Web Vault: [haptixwallet.xyz](https://haptixwallet.xyz)
  - 24-Hour Guardian Recovery Portal: [haptixwallet.xyz/recover.html](https://haptixwallet.xyz/recover.html)
  - Complete Developer Documentation: [docs.haptixwallet.xyz](https://docs.haptixwallet.xyz)

---

## 5. What We Want to Build: Scope & Milestones

We propose a focused, **3-milestone technical roadmap** funded by a **$10,000 USD grant**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROPOSED MILESTONE ROADMAP                         │
├──────────────────────────────┬──────────┬───────────────────────────────────┤
│ Milestone                    │ Budget   │ Target Deliverables               │
├──────────────────────────────┼──────────┼───────────────────────────────────┤
│ M1: MWA Wallet Provider      │ $4,000   │ Native MWA server implementation, │
│                              │          │ dApp connection, tx & msg signing │
├──────────────────────────────┼──────────┼───────────────────────────────────┤
│ M2: Security Hardening       │ $3,500   │ Third-party audit remediation,    │
│                              │          │ on-chain introspection validation │
├──────────────────────────────┼──────────┼───────────────────────────────────┤
│ M3: Seeker SDK & Adoption    │ $2,500   │ Developer docs, example dApp,     │
│                              │          │ Seeker community beta testing     │
├──────────────────────────────┴──────────┴───────────────────────────────────┤
│ TOTAL REQUESTED:             $10,000                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Milestone 1: Mobile Wallet Adapter (MWA) Wallet Provider ($4,000)
* **Goal**: Implement the official Solana Mobile Wallet Adapter 2.0 wallet specification inside Haptix.
* **Deliverables**:
  1. **MWA Intent Handler & WebSocket Server**: Enable Haptix to respond to `solana-wallet://` intents from external Android dApps.
  2. **`authorize` & `reauthorize`**: Session authorization returning the user's smart wallet PDA and Secp256r1 public key identity.
  3. **`sign_and_send_transactions`**: Intercept third-party transaction payloads, construct the Secp256r1 precompile verify instruction, prompt the biometric hardware Keystore, and relay sponsored transactions to Solana.
  4. **Policy Warning Modal**: If an external dApp requests a transfer exceeding the user's configured threshold (e.g. > 0.10 SOL or > 50 SKR), Haptix automatically triggers the 2-of-2 dual-device quorum co-signing flow before executing.
  5. **Automated MWA Compatibility Test Suite**: End-to-end integration tests verifying communication with standard Solana Mobile dApp clients.

### Milestone 2: Security Hardening & Mainnet Readiness ($3,500)
* **Goal**: Validate that all cryptographic precompile introspection and state transitions are exploit-free prior to handling real mainnet capital.
* **Deliverables**:
  1. **Independent Security Audit**: Submit the ~2,645 lines of Rust Anchor code (`haptix_program`) to an experienced Solana security auditing team (leveraging audit grants such as Vaultline).
  2. **Audit Remediation**: Fix any identified issues regarding instruction introspection offset validation, fee-funder front-running, or recovery timelock edge cases.
  3. **Mainnet Readiness Assessment**: Comprehensive report certifying the contract's readiness for Mainnet deployment.
  * *Note: Mainnet deployment is explicitly conditioned on successful audit completion and remediation.*

### Milestone 3: Seeker Developer SDK, Documentation & User Testing ($2,500)
* **Goal**: Make Haptix's 1-tap passkey and session key architecture easily embeddable by Solana Mobile developers.
* **Deliverables**:
  1. **Haptix Mobile Client SDK**: A lightweight TypeScript/React Native package allowing developers to query Haptix smart wallet state, check spend policies, and request scoped agent session keys (`grant_agent_session`).
  2. **Developer Documentation & Guides**: Full tutorials on [docs.haptixwallet.xyz](https://docs.haptixwallet.xyz) with working code samples showing how mobile games and DeFi dApps integrate Haptix via MWA.
  3. **Seeker Early-User Testing Group**: Coordinate a structured beta testing cohort of Solana Seeker pre-order holders to stress-test biometric reliability and gasless relay latency across physical devices.

---

## 6. Budget Justification & Timeline

| Category | Amount | Justification |
| :--- | :--- | :--- |
| **MWA Protocol Engineering** | $4,000 | 4 weeks dedicated engineering to implement native Android MWA 2.0 provider endpoints, protocol session management, and biometric signing integration. |
| **Security Review & Hardening** | $3,500 | Professional smart contract review fees and engineering time dedicated to cryptographic fuzzing and exploit prevention. |
| **SDK, Docs & Community Adoption** | $2,500 | 2 weeks of developer tooling creation, sample dApp implementation, documentation writeups, and beta user onboarding. |
| **Total Grant Request** | **$10,000** | **Delivered across 3 verifiable, milestone-gated releases.** |

### Estimated Timeline:
* **Weeks 1–4**: Milestone 1 (MWA Provider Implementation & Test Harness)
* **Weeks 5–7**: Milestone 2 (Security Audit Engagement, Vulnerability Fixes & Hardening)
* **Weeks 8–10**: Milestone 3 (Developer SDK, Integration Docs & Seeker Community Launch)

---

## 7. Expected Ecosystem Impact for Solana Mobile

1. **Expands Mobile Wallet Options**: Gives Solana Seeker users a true seedless smart wallet option that works seamlessly with every MWA-compatible dApp on the device.
2. **First Policy-Governed Mobile Account**: Mobile dApps will be able to utilize instant 1-tap biometric transactions for low-value payments, with built-in hardware protection against catastrophic drainage.
3. **Open-Source Contribution**: All MWA provider architecture, Secp256r1 precompile serializers, and client SDKs remain 100% open-source under the MIT license for the benefit of the entire Solana developer community.

---

## 8. Team Background

* **Ritesh ([@Ritesh5969](https://x.com/Ritesh5969))**: Full-stack Web3 engineer and solo creator of Haptix.
  - Designed and deployed the Anchor smart contract on Solana Devnet.
  - Implemented the client-side Secp256r1 serialization, low-S canonical encoding, and WebAuthn parsing.
  - Packaged, built, and successfully published Haptix v1.0.2 (Build 3) to the Solana Mobile dApp Store catalog.
  - Built an automated 14-suite test harness with 324 passing integration tests.
