# Solana Browser Extension Plan

Same Haptix idea on the desktop web: a passkey instead of a seed phrase, zero 12/24-word phrases to leak or phish, a hardware 2-of-2 quorum for anything over the spend limit, an independent recovery guardian, and AI agent session keys.

Not a new smart contract. It talks directly to the existing on-chain Anchor program (`haptix_program`) already running on Solana Devnet and ready for Mainnet.

---

## 1. What It Is

A Manifest V3 browser extension (Chrome, Brave, Edge, Arc) that acts as a full-featured Solana wallet (like Phantom, Solflare, or Backpack) with two fundamental advantages:

1. **Seedless Passkey Native**:
   * Uses **Mac Touch ID**, **Windows Hello**, or **YubiKey / FIDO2** via the browser's native `navigator.credentials` WebAuthn API.
   * Impossible to phish via fake website popups (WebAuthn binds strictly to the origin / extension ID).
2. **Smart Contract Powered**:
   * Controls an on-chain smart wallet PDA (`haptix_program`).
   * Validated natively on Solana via the `Secp256r1SigVerify1111111111111111111111111` precompile instruction.
   * Can operate standalone or as a paired companion to the Haptix Mobile APK.

---

## 2. Already Built & Directly Reusable

| Component | Source in Repo | Status |
| :--- | :--- | :--- |
| **On-Chain Anchor Program** | `solana-mobile/haptix_program/` | Program `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke` on Devnet. 152/152 automated tests passing. |
| **Secp256r1 Precompile Encoder** | `solana-mobile/haptix-mobile-app/utils/haptix-wysiwys.ts` | Complete: 210-byte instruction layout, canonical low-S normalization, Anchor discriminators. |
| **WebAuthn Browser Enrollment** | `solana-mobile/haptix-mobile-app/public/vault.html` | Working: Touch ID P-256 enrollment and raw signature extraction. |
| **Transaction History & Cache** | `solana-mobile/haptix-mobile-app/utils/haptix-tx-history.ts` | Network-scoped Devnet/Mainnet transaction parser and balance caching. |
| **Recovery & Quorum Logic** | `solana-mobile/haptix-mobile-app/utils/haptix-recovery.ts` | Full Anchor instruction encoders for guardian initialization, rotation, and timelocked execution. |

---

## 3. Extension Architecture (Manifest V3)

```
┌────────────────────────────────────────────────────────────────────────┐
│ dApp Page (e.g. jup.ag, raydium.io)                                    │
│   └── window.solana / @solana/wallet-standard                          │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ window.postMessage
┌─────────────────────────────────▼──────────────────────────────────────┐
│ content-script.js (Injected into web pages)                            │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ chrome.runtime.sendMessage
┌─────────────────────────────────▼──────────────────────────────────────┐
│ background.js (Service Worker)                                         │
│   ├── State management & RPC connections                               │
│   ├── Origin permission checks & approval queues                       │
│   └── Opens Extension Popup or Side Panel                              │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────────┐
│ Extension UI (Popup & chrome.sidePanel)                                │
│   ├── React + Vite + Tailwind / Vanilla CSS                            │
│   ├── WYSIWYS Transaction Preview (Recipient, Amount, Cluster)         │
│   └── WebAuthn Prompt (Touch ID / Windows Hello / YubiKey)             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Operational Modes

### A. Standalone Everyday Desktop Wallet
* **Primary Key**: Mac Touch ID or Windows Hello.
* **Secondary Key**: Backup browser passkey or hardware key.
* **Spend Threshold**: Default 0.1 SOL (1-tap fingerprint for daily swaps on Jupiter, 2nd prompt above limit).
* **Guardian**: External address (Phantom, Solflare, or Ledger) for recovery.

### B. Dual-Device Companion to Mobile App
* The extension can act as the **Vault Key** for the phone app:
  * When a high-value transfer is initiated on the mobile phone, the desktop extension receives a push notification or local relay prompt to sign via Touch ID.
  * When trading on desktop, transfers above the vault threshold require an approval tap on the phone.

---

## 5. Development Roadmap

### Phase 1: Extension Foundation (~1 week)
- Set up a clean `packages/solana-extension` or `extension-solana/` using Vite + React + Manifest V3.
- Configure `manifest.json` with `sidePanel`, `storage`, and `activeTab` permissions.
- Implement passkey generation via `navigator.credentials.create()` (P-256 / Secp256r1) in the extension UI.
- Compute the smart wallet PDA and display balance from Solana Devnet.

### Phase 2: Wallet Standard & DApp Injection (~1.5 weeks)
- Implement `@solana/wallet-standard` provider (`window.solana`, `window.haptix`).
- Support standard RPC methods:
  - `connect()`
  - `disconnect()`
  - `signAndSendTransaction()`
  - `signTransaction()`
  - `signMessage()`
- Test with standard dApp demo (e.g., Jupiter swap demo or Solana wallet tester).

### Phase 3: Transaction Preview & Quorum Execution (~1.5 weeks)
- Build the transaction inspection UI: simulate transaction, decode recipient, verify balance change.
- Wrap incoming instructions into `execute_transfer` or smart wallet user operations.
- Prompt Touch ID / Windows Hello for Secp256r1 signature.
- Verify Secp256r1 precompile instruction on-chain.

### Phase 4: Mobile-Desktop Sync & Mainnet Polish (~1 week)
- QR-code pairing between Mobile APK and Extension.
- Local relay / encrypted sync for dual-device approvals.
- Mainnet toggle with priority fees and compute budget optimization.

---

## 6. Strict Rules (Do Not Compromise)

1. **No Seed Phrases Ever**: Never introduce a mnemonic fallback. If passkeys are lost, recovery belongs strictly to the on-chain Recovery Guardian.
2. **Origin Binding**: The WebAuthn credential must remain bound to the extension's secure context. A web page script must never directly access the passkey credential ID.
3. **What You See Is What You Sign (WYSIWYS)**: The amount, recipient address, and network cluster shown in the extension dialog must strictly match the exact bytes hashed and signed by the passkey.
4. **Independent Guardian**: The guardian address must be validated on-chain and cannot be the wallet PDA or an embedded key.
