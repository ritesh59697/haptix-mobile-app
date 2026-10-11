# Haptix v1.0.0 — Solana Mobile Hackathon Edition

Welcome to the initial release of **Haptix**, the consumer-grade passkey smart wallet built natively for the **Solana Mobile Stack (SMS)** and the **Solana Seeker (Chapter 2)** ecosystem.

---

### Key Features in v1.0.0

- **Seedless Biometric Passkeys (Secp256r1 / P-256)**: Private keys never leave the phone's hardware enclave (Android Keystore / StrongBox). Verified directly on-chain via Solana's native `Secp256r1SigVerify` precompile instruction introspection.
- **Risk-Adaptive Spending Policy**:
  - *Low-Risk Fast Lane (≤ 0.1 SOL / ≤ 50 SKR)*: 1-tap instant biometric passkey (~400ms confirmation).
  - *High-Risk Escalation (> 0.1 SOL / > 50 SKR)*: Enforces a mathematical 2-of-2 hardware quorum (Phone + Mac Touch ID or backup key).
- **Seeker (SKR) Token Architecture Ready ($10,000 Bonus Track)**: Natively supports Seeker Genesis rewards (100 SKR welcome allocation) and dynamic token risk thresholds (18 passing tests in integration suite).
- **Autonomous AI Agent Session Keys**: Delegate temporary, budget-constrained trading authority to AI agents (e.g. Jupiter Auto-DCA) with zero biometric interruptions.
- **Gasless Onboarding**: Embedded Devnet paymaster sponsors account rent and drips a 0.10 SOL starter test balance.
- **Emergency Circuit Breaker**: On-chain instant Panic Freeze and 24-hour timelocked guardian recovery.

---

### Verified On-Chain Anchor Program

- **Cluster**: Solana Devnet
- **Program ID**: [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)
- **Framework**: Anchor 0.31 / Solana Agave v3.1.13

---

### Verified EAS Production Build Receipt

- **Build ID**: `6e6cbb0a-cb5b-4e38-bd17-c5345c8f767a`
- **EAS Console**: [expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/6e6cbb0a-cb5b-4e38-bd17-c5345c8f767a](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/6e6cbb0a-cb5b-4e38-bd17-c5345c8f767a)
- **APK Binary Size**: 97.7 MB (`haptix-wallet.apk`)
- **Passkey Enhancement**: Auto-targets active wallet passkey; bypasses Credential Manager multi-account chooser dialog for 1-tap instant biometric sign.
- **Relay Infrastructure**: [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (24/7 UptimeRobot monitored, zero cold-start delay).

---

### Installation Instructions

1. Download the attached `haptix-wallet.apk` (97.7 MB) directly onto your Android device or Solana Seeker / Saga.
2. Tap the downloaded file to install (allow "Install from Unknown Sources" if prompted).
3. Open **Haptix** and tap **Create Smart Wallet** to test the 1-tap biometric passkey flow.

