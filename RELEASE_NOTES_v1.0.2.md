# Haptix v1.0.2 — Production Emergency Recovery Portal Release

Welcome to **v1.0.2** of **Haptix**, the consumer-grade passkey smart wallet built natively for the **Solana Mobile CLOCK IN Hackathon**, optimized for the **Solana Mobile Stack (SMS)** and the **Solana Seeker (Chapter 2)** ecosystem.

---

### Key Updates in v1.0.2 (Build 3)

- **Solana Mobile dApp Store Compliance (FUN-002 & PER-001)**:
  - **FUN-002 Resolved**: Embedded cloud environment variables into the standalone APK build (`EXPO_PUBLIC_HAPTIX_DEV_MODE=true`, Devnet RPC URL, and funded paymaster key). The paymaster automatically funds devnet gas and auto-drips test Devnet SOL on wallet creation so store reviewers can test instant passkey transfers, dual-biometric quorums, and agent sessions immediately on a clean device.
  - **PER-001 Verified**: Stripped unnecessary permissions (`SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`) from Android build manifest to comply strictly with Solana Mobile publisher policies.
  - **Officially Approved & LIVE**: Passed all automated guardian security checks and live reviewer functional testing. Officially published and live on the Solana Mobile dApp Store (Submission `#344280197850`, Release Mint: [`HF6AUA7d...atdZoEQg`](https://explorer.solana.com/address/HF6AUA7daN2Kk1k1z2p9r7K2E1Y1aZtdZoEQg?cluster=mainnet)).
- **Production Emergency Recovery & Custom Domain Routing**:
  - Live production recovery portal routing on both primary domain [haptixwallet.xyz/recover.html](https://haptixwallet.xyz/recover.html) and backwards-compatible fallback [haptix-passkeys.vercel.app/recover.html](https://haptix-passkeys.vercel.app/recover.html).
  - Both on-screen link and generated QR code open the live web recovery portal directly on external devices (Mac, Windows, tablets, or phones).
  - Centralized URL configuration in `AppConfig.recoveryPortalUrl`.
- **E2E Tested & Verified On-Chain**:
  - Full end-to-end verification with browser wallets (Phantom, Solflare) initiating on-chain emergency freezes and timelock executions.
  - 53 passing automated assertions on Solana Devnet (`npm run test:recovery`).

---

### Verified On-Chain Anchor Program

- **Cluster**: Solana Devnet
- **Program ID**: [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)
- **Framework**: Anchor 0.31 / Solana Agave v3.1.13

---

### Verified EAS Production Build Receipt

- **Version**: `1.0.2 (3)`
- **Build ID**: `d1a7544a-1f49-47dc-a1c3-94c4be3ac105`
- **EAS Console**: [expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/d1a7544a-1f49-47dc-a1c3-94c4be3ac105](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/d1a7544a-1f49-47dc-a1c3-94c4be3ac105)
- **Direct Download Link**: [Download haptix-wallet.apk (v1.0.2 Build 3)](https://expo.dev/artifacts/eas/XgEwZNuGgeza8558iYu_Rp70dv1jnsjoanWVEq3sRD0.apk)
- **APK Binary**: `haptix-wallet.apk` (96.30 MB, SHA256: `e52ab3842f65d897bbd357d8da9a906d83882475ebe29e12c166d382884b7a20`)

---

### Installation Instructions

1. Download `haptix-wallet.apk` directly onto your Android device or Solana Seeker / Saga.
2. Tap the downloaded file to install / update.
3. Open **Haptix** and navigate to **Settings → Recovery** to test the live production recovery portal link and QR code.

---

Built by [Ritesh](https://x.com/Ritesh5969)
