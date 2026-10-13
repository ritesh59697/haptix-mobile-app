# Haptix v1.0.1 — Anti-Spam Protections & Performance Release

Welcome to **v1.0.1** of **Haptix**, the consumer-grade passkey smart wallet built natively for the **Solana Mobile CLOCK IN Hackathon**, optimized for the **Solana Mobile Stack (SMS)** and the **Solana Seeker (Chapter 2)** ecosystem.

---

### Key Updates in v1.0.1

- **Anti-Spam & Rate Limiting Protections**:
  - **10-Second Faucet Cooldown**: Enforces a 10s cooldown timer between faucet drip requests to safeguard treasury reserves.
  - **0.50 SOL Balance Cap**: Faucet rejects requests if the wallet already holds $\ge 0.50$ SOL to prevent balance hoarding while keeping testing fluid.
  - **5 Wallets Per Device Limit**: Caps wallet creation at 5 wallets per device to protect against device-level botting.
  - **0.20 SOL Starter Funding**: Calibrated starter funding to 0.20 SOL for seamless onboarding and immediate multi-tx testing.
  - **10 SOL Dedicated Treasury Address**: Relaying via dedicated treasury account `F2KbEr684c41WjtwqhWkKWbXfBWaZ49nG3A6vbVVrLgK` to fund new wallets reliably.
- **Passkey Performance & Discovery**:
  - **Instant Biometric Sign**: Auto-targets active wallet passkey; bypasses Credential Manager multi-account chooser dialog for 1-tap instant biometric sign.
  - **Optimized Default Onboarding**: Everyday Mode selected by default for friction-free UX with optional 2-of-2 hardware Vault Mode.
- **Visual Polish & Modern Clean Interface**:
  - Cleaned headers, badges, and typography with zero visual slop.

---

### Verified On-Chain Anchor Program

- **Cluster**: Solana Devnet
- **Program ID**: [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)
- **Framework**: Anchor 0.31 / Solana Agave v3.1.13

---

### Verified EAS Production Build Receipt

- **Build ID**: `da754004-963e-4d77-bbae-45c4ac1f5a98`
- **EAS Console**: [expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/da754004-963e-4d77-bbae-45c4ac1f5a98](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/da754004-963e-4d77-bbae-45c4ac1f5a98)
- **APK Binary**: `haptix-wallet.apk`
- **Relay Infrastructure**: [https://haptix-relay.onrender.com](https://haptix-relay.onrender.com) (24/7 UptimeRobot monitored, zero cold-start delay)

---

### Installation Instructions

1. Download the attached `haptix-wallet.apk` directly onto your Android device or Solana Seeker / Saga.
2. Tap the downloaded file to install (allow "Install from Unknown Sources" if prompted).
3. Open **Haptix** and tap **Create Smart Wallet** to test the 1-tap biometric passkey flow.

---

Built by [Ritesh](https://x.com/Ritesh5969)
