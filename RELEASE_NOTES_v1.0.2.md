# Haptix v1.0.2 — Production Emergency Recovery Portal Release

Welcome to **v1.0.2** of **Haptix**, the consumer-grade passkey smart wallet built natively for the **Solana Mobile CLOCK IN Hackathon**, optimized for the **Solana Mobile Stack (SMS)** and the **Solana Seeker (Chapter 2)** ecosystem.

---

### Key Updates in v1.0.2

- **Production Emergency Recovery Routing**:
  - Replaced development bundler fallback (`localhost:8081`) with live production Vercel portal routing: `https://haptix-passkeys.vercel.app/recover.html`.
  - Both the on-screen link and generated QR code now open the live web recovery portal directly on external devices (Mac, Windows, tablets, or phones).
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

- **Version**: `1.0.2`
- **Build ID**: `c5def63a-dc70-4a58-a3b4-a6dd8c72c881`
- **EAS Console**: [expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/c5def63a-dc70-4a58-a3b4-a6dd8c72c881](https://expo.dev/accounts/ritesh5969/projects/haptix-wallet/builds/c5def63a-dc70-4a58-a3b4-a6dd8c72c881)
- **Direct Download Link**: [Download haptix-wallet.apk (v1.0.2)](https://expo.dev/artifacts/eas/zHXOU9hzxs29W8lMrYkwcU0Mkp1FEcdsBZXwTfcwjMQ.apk)
- **APK Binary**: `haptix-wallet.apk` (96.3 MB)

---

### Installation Instructions

1. Download `haptix-wallet.apk` directly onto your Android device or Solana Seeker / Saga.
2. Tap the downloaded file to install / update.
3. Open **Haptix** and navigate to **Settings → Recovery** to test the live production recovery portal link and QR code.

---

Built by [Ritesh](https://x.com/Ritesh5969)
