# Haptix v1.0.2 — Production Emergency Recovery Portal Release

Welcome to **v1.0.2** of **Haptix**, the consumer-grade passkey smart wallet built natively for the **Solana Mobile CLOCK IN Hackathon**, optimized for the **Solana Mobile Stack (SMS)** and the **Solana Seeker (Chapter 2)** ecosystem.

---

### Key Updates in v1.0.2 (Build 2)

- **Solana Mobile dApp Store Compliance (PER-001)**:
  - Stripped unnecessary permissions (`SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`) from Android build manifest to comply strictly with Solana Mobile publisher policies.
  - Bumped internal Android `versionCode` to `2` to satisfy store monotonic version sequence requirements.
  - Submitted for official review on the Solana Mobile Publishing Portal (`publish.solanamobile.com`, Submission `#344316773102`).
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

- **Version**: `1.0.2 (2)`
- **Build ID**: `24fe25c1-4982-4646-91d6-b0c39e84a046`
- **EAS Console**: [expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/24fe25c1-4982-4646-91d6-b0c39e84a046](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/24fe25c1-4982-4646-91d6-b0c39e84a046)
- **Direct Download Link**: [Download haptix-wallet.apk (v1.0.2 Build 2)](https://expo.dev/artifacts/eas/mjPp2sqRl62kglLs78622gzjJiaxk-ca13A_L_5bVpo.apk)
- **APK Binary**: `haptix-wallet.apk` (96.38 MB, SHA256: `fb7bde7211593d67362f5d7d6ddf0420aa37e21c241ba0115fa87ad9ecda277f`)

---

### Installation Instructions

1. Download `haptix-wallet.apk` directly onto your Android device or Solana Seeker / Saga.
2. Tap the downloaded file to install / update.
3. Open **Haptix** and navigate to **Settings → Recovery** to test the live production recovery portal link and QR code.

---

Built by [Ritesh](https://x.com/Ritesh5969)
