# Haptix Solana Mobile: Architecture & Future Implementation Roadmap

> **Haptix** is a biometric hardware smart wallet on Solana Mobile powered by native `secp256r1` WebAuthn precompile signatures, dual-device 2-of-2 vault quorum, on-chain spending limits, and timelocked social recovery.

---

## 🏆 Current Implementation Status (Live on Devnet)

- **Smart Contract (`haptix_program`)**:
  - [x] Anchor smart contract live on Solana Devnet: `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`.
  - [x] Zero-dependency Secp256r1 verification using Solana native precompile (`Secp256r1SigVerify1111111111111111111111111`).
  - [x] Timelocked guardian social recovery (`initiate_recovery`, `cancel_recovery`, `execute_recovery`).
  - [x] Autonomous AI agent session keys with spend caps and time bounds (`grant_agent_session`, `agent_execute`, `revoke_agent_session`).
  - [x] Emergency Panic Freeze circuit breaker (`panic_freeze`, `unfreeze`).
- **Mobile Client (`haptix-mobile-app`)**:
  - [x] Real hardware passkeys via Android Keystore & FIDO2 platform authenticators (`react-native-passkey`).
  - [x] Dual-device **Vault Mode** vs. Everyday Mode choice during onboarding.
  - [x] On-chain **Spending Limits** UI in Settings (`/settings/limits`) with preset chips, custom input, and 2-of-2 biometric quorum update.
  - [x] Dynamic Send Sheet escalation: 1-tap passkey for low-risk sends $\le$ limit; mandatory dual-key quorum for high-risk sends.
  - [x] In-app recovery status tracking with "Keep My Keys" fast-path veto.
  - [x] 146/146 unit & Devnet integration tests passing.
- **CLI Guardian Tool (`tools/haptix-guardian.ts`)**:
  - [x] Operational run-book for status, initiate, execute, and veto simulation.

---

## 🚀 Future Implementation Roadmap

### Phase 1: Web Recovery Portal (`recovery.haptix.app`)
**Problem**: If a user permanently loses their phone, they currently need a Mac/Linux terminal to run the CLI tool (`npm run guardian`) with their recovery keypair.
**Solution**: Build a simple, high-security companion web application (`recovery.haptix.app`):
- [ ] **Hardware Wallet Connect**: Support OneKey, Ledger, and Solana browser wallets (Phantom, Solflare) via `@solana/wallet-standard`.
- [ ] **1-Click Initiate**: Guardian connects their hardware wallet or browser extension, enters the user's smart wallet address, and signs `initiate_recovery`.
- [ ] **Live Timelock Countdown**: Clean visual countdown bar showing time remaining in the dispute/veto window.
- [ ] **Execute & Rescue**: Once the timelock elapses, guardian clicks "Complete Recovery" to install the user's new phone passkey. No CLI or command line required.

### Phase 2: Physical Hardware Security Keys (USB-C / NFC FIDO2 & YubiKey / OneKey)
**Problem**: Power users and institutional vaults often prefer dedicated offline hardware authenticators (YubiKey 5 NFC, OneKey, Feitian) over a second laptop/phone.
**Solution**: Native FIDO2 / CTAP2 Cross-Platform Security Key Integration:
- [ ] **NFC Tap & USB-OTG Pairing**: Direct hardware passkey enrollment using Android's native CTAP2 FIDO transport.
- [ ] **Physical Touch Presence (UP)**: Requiring physical button contact on the USB/NFC key for high-value vault transaction approvals.
- [ ] **Hardware Compatibility Matrix**: Verified testing across YubiKey 5 Series (NFC/Type-C), OneKey, and Google Titan Security Keys.

### Phase 3: WebAuthn Cross-Device Hybrid Transport & Push Approvals
**Problem**: Registering a laptop TouchID or tablet as the secondary Vault Key currently relies on external key generation or platform-specific cross-platform flags.
**Solution**: Implement native FIDO2 Hybrid Transport & Push Approvals:
- [ ] **QR Code Pairing Ceremony**: During Vault Mode setup on the phone, display a standardized FIDO2 QR code.
- [ ] **Secure Enclave Storage**: The user scans the QR code with their MacBook camera/Safari, saving the secondary passkey into their laptop's Apple Secure Enclave.
- [ ] **Cross-Device Push Signing**: High-value transfers trigger a Bluetooth/cloud notification to the MacBook for TouchID approval.

### Phase 4: Production Gasless Relayer & Sponsorship Pool
**Problem**: Devnet testing uses a local funder keypair (`EXPO_PUBLIC_HAPTIX_FUNDER_KEY`) to sponsor account creation and network rent fees.
**Solution**: Enterprise-grade gas abstraction service:
- [ ] **Serverless Relayer Service**: Deploy a secure AWS KMS / Cloudflare Worker relayer that co-signs transactions as `feePayer`.
- [ ] **Token Fee Payment**: Allow users to pay transaction and rent fees in SPL tokens (USDC, BONK) rather than needing native SOL in a fresh wallet.
- [ ] **Sybil & Abuse Prevention**: Rate-limit free account initialization per hardware device / IP.

### Phase 5: Security Audit & Mainnet Migration
- [ ] **Independent Smart Contract Audit**: Formal verification of `haptix_program` secp256r1 precompile integration, instruction sysvar index checks, and arithmetic bounds.
- [ ] **Mainnet Program Deployment**: Deploy with multi-sig program upgrade authority (Squads Protocol).
- [ ] **Google Play Store & Solana dApp Store Release**: Complete Android production build (`eas build --platform android --profile production`) and publish to the Solana Mobile dApp Store.
