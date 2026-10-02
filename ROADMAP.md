# Haptix Master Roadmap: The Seedless Biometric Smart Wallet

> **Haptix** is a biometric hardware-enclave smart wallet ecosystem. It eliminates seed phrases entirely using native device passkeys (Secp256r1 / P-256), enforces a 2-of-2 hardware quorum for high-value transfers, and provides on-chain timelocked guardian recovery.

---

## The 4-Phase Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: SOLANA MOBILE APP (Current Hackathon Priority)                │
│ • Anchor program + Secp256r1 precompile + 2-of-2 hardware quorum       │
│ • Production Expo / React Native Android APK                           │
│ • 152/152 automated tests passing • Live on Solana Devnet             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ PHASE 2: EVM COMPATIBLE MOBILE APP (Base / Superchain / ERC-4337)     │
│ • Reuse mobile UI screens • Connect to existing PasskeyAccount.sol     │
│ • Native RIP-7212 (0x100) precompile on Base • Bundler & Paymaster     │
│ • Tap into Base Ecosystem Grants & Ethereum Hackathons                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ PHASE 3: UNIFIED SVM + EVM CONSUMER APP                                │
│ • One biometric passkey generates accounts on both Solana & Base       │
│ • Unified multi-chain portfolio, spending policies, and guardian      │
│ • Full public release on Google Play Store & iOS App Store             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ PHASE 4: UNIVERSAL BROWSER EXTENSION (Chrome / Brave / Edge)           │
│ • Manifest V3 side panel & popup wallet                                │
│ • Dual-standard injection: window.solana + window.ethereum (EIP-1193)  │
│ • Standalone desktop trading + Dual-device companion to Mobile App     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Solana Mobile App (Active — Hackathon Finalization)

**Objective**: Ship an un-drainable, seedless smart wallet for the Solana Mobile Hackathon.

- [x] **On-Chain Anchor Program (`haptix_program`)**:
  - Off-curve smart wallet PDA derivation with canonical bumps.
  - Native `Secp256r1SigVerify1111111111111111111111111` precompile instruction validation.
  - Spend threshold governance: 1-tap fingerprint under limit, 2-of-2 hardware quorum above limit.
  - Timelocked social / guardian recovery with owner cancellation veto.
  - Autonomous AI Agent session key delegation with spending allowance.
  - Panic freeze / unfreeze protection.
  - 152/152 automated unit, cryptographic, and Devnet integration tests passing.
- [x] **Production Expo Mobile App (`solana-mobile/haptix-mobile-app`)**:
  - Native biometric passkey minting inside device Secure Enclave / Android StrongBox.
  - Dual-device Mac Touch ID enrollment & WebSockets relay.
  - Network-scoped Devnet/Mainnet transaction history and RPC routing.
  - Dynamic action bar (Send · Swap · Receive) and Jupiter DEX swap routing.
  - Emergency Panic Freeze & Timelocked Guardian Recovery UI.
- [ ] **Hackathon Submission & Distribution**:
  - Complete preview APK build via EAS (`npx eas-cli build -p android --profile preview`).
  - Record high-impact product walkthrough demo video.
  - Submit entry with deployed contract receipts and technical documentation.

---

## Phase 2: EVM Mobile App (Base / Arbitrum / ERC-4337)

**Objective**: Bring the exact same seedless Haptix UX to the EVM ecosystem.

- [x] **Smart Contracts Ready in Repo (`src/` & `test/`)**:
  - `PasskeyAccount.sol` and `PasskeyAccountFactory.sol` complete with 243 passing Foundry tests.
  - ERC-4337 v0.7 EntryPoint (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`).
  - Native RIP-7212 (`0x100`) precompile optimization on Base (sub-cent gas costs).
- [ ] **Mobile Client Port**:
  - Replace the Solana RPC client with ERC-4337 UserOperation bundler client (Pimlico / Alchemy).
  - WebAuthn clientDataJSON & authenticatorData hashing for `PackedUserOperation`.
  - Paymaster integration for gasless onboarding and USDC gas sponsorship.
- [ ] **Ecosystem Grants & Hackathons**:
  - Apply for Base Builder Grants, Optimism Superchain Grants, and ERC-4337 Foundation rounds.

---

## Phase 3: Unified Multi-Chain App (Solana SVM + EVM)

**Objective**: The first universal smart account wallet where one fingerprint unlocks both Solana and Base.

- [ ] **One-Biometric Multi-Chain Creation**:
  - Single biometric registration provisions both a Solana PDA wallet and a Base ERC-4337 address.
- [ ] **Unified Multi-Chain Dashboard**:
  - Aggregated net worth and token balances across Solana, Base, and Arbitrum.
  - Clean chain switcher and auto-routing for outgoing payments.
- [ ] **Cross-Chain Spending & Recovery Policies**:
  - Unified spending limit rules across chains.
  - Global recovery guardian: one trusted external key can initiate recovery across all chains.
- [ ] **App Store Distribution**:
  - Public launch on Google Play Store (Solana dApp Store compatible) and Apple App Store.

---

## Phase 4: Universal Browser Extension (SVM + EVM)

**Objective**: Replace traditional seed-phrase browser extensions with a biometric desktop standard.

- [ ] **Manifest V3 Desktop Extension**:
  - Persistent Side Panel (`chrome.sidePanel`) and popup interface.
  - Touch ID on macOS, Windows Hello on PC, and USB YubiKey support.
- [ ] **Dual Provider DApp Injection**:
  - `@solana/wallet-standard` (`window.solana`) for Jupiter, Raydium, Magic Eden, Tensor.
  - `EIP-1193` (`window.ethereum`) for Uniswap, Aave, OpenSea, Aerodrome.
- [ ] **Dual-Device Companion Sync**:
  - Instant desktop push prompt to serve as the 2nd hardware quorum key for the mobile app, and vice versa.
- [ ] **Chrome Web Store Launch**:
  - Distribution to Chrome, Brave, Edge, and Arc browsers.

---

## Security Invariants (Across All Phases)

1. **Zero Seed Phrases**: Private keys never exist as human-readable mnemonics. They are minted and sealed inside hardware security chips.
2. **What You See Is What You Sign (WYSIWYS)**: The UI verifies the exact bytes hashed and signed by the authenticator; no blind or uninspected signatures.
3. **Quorum Escalation**: Large sends always require two distinct physical authenticators.
4. **Guardian Isolation**: Guardians can only freeze and start timelocked recovery; they can never move funds or bypass security delays.

