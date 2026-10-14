# Haptix Vault Mode & Spending Limit Architecture

> **Architecture Overview**: Haptix implements a **dual-device hardware smart vault** on Solana:
> 1. **Primary Passkey**: Stored on the daily phone (Android Keystore / StrongBox Face ID & Fingerprint) for fast daily spending.
> 2. **Secondary Passkey (Vault Key)**: Stored on a separate device (MacBook Touch ID, iPad, or Windows Hello via the [Web Vault](https://haptix-passkeys.vercel.app/vault.html)) for high-value transactions.
> 3. **Customizable Spending Limit**: A user-configurable daily limit ($\le X$ SOL or $\le 50$ SKR) requiring a 2-of-2 hardware quorum to modify on-chain.
> 4. **Cross-Device Co-Signing**: Orchestrated automatically via the **Haptix Cloud Relay** (`https://haptix-relay.onrender.com`) with offline clipboard code fallback.

---

## 1. Threat Model & Security Architecture

### Why Single-Device 2-of-2 is Vulnerable
If a wallet stores both signing keys on the same physical phone, an attacker who steals an unlocked phone or shoulder-surfs the PIN can approve both biometric prompts in seconds and drain 100% of the wallet.

### The Dual-Device "Checking vs. Vault" Invariant
* **Low-Value Sends ($\le \text{Threshold}$)**:
  * Signed by **Primary Passkey** alone directly from the phone. Instant, single-tap confirmation (~400ms).
* **High-Value Sends ($> \text{Threshold}$)**:
  * Mathematically requires **Primary Passkey** (Phone) **AND** **Secondary Passkey** (Laptop / Web Vault).
  * Enforced 100% on-chain by Solana's native `Secp256r1SigVerify1111111111111111111111111` precompile instruction via instruction introspection.
  * A thief holding the phone alone is physically prevented by the Solana runtime from draining savings.
* **Modifying the Threshold**:
  * Changing the spending limit is an on-chain governance action (`set_spend_threshold`) requiring **both keys**. A thief cannot raise the limit to bypass security.

---

## 2. Multi-Asset Risk Engine

Haptix features a multi-asset risk-adaptive policy engine built specifically for the Solana Mobile and Solana Seeker ecosystem:

| Asset | Routine Fast-Lane (1-Tap Passkey) | High-Risk Escalation (2-of-2 Vault Quorum) | Verification Test Suite |
| :--- | :--- | :--- | :--- |
| **SOL** | $\le \text{Spend Threshold}$ (Default: `0.10 SOL`, customizable) | $> \text{Spend Threshold}$ | `tests/set-spend-threshold.test.ts` |
| **Seeker SKR** | $\le 50\text{ SKR}$ | $> 50\text{ SKR}$ | `tests/seeker-skr.test.ts` (18 tests) |
| **SPL Tokens** | Policy-evaluated via spend ceiling | Exceeds spend ceiling | `tests/integration-test.ts` |

---

## 3. On-Chain Smart Program (`haptix_program`)

Live on Solana Devnet: `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`

1. **`execute_transfer.rs`**:
   * Evaluates `transfer_amount <= wallet.spend_threshold_lamports`.
   * Low-value: Verifies only Primary `secp256r1` signature.
   * High-value: Requires and verifies both Primary and Secondary `secp256r1` precompile signatures.
2. **`governance.rs` (`handle_set_spend_threshold`)**:
   * Verifies `SET_THRESHOLD:<u64_le>` message against both `wallet.primary_passkey` and `wallet.secondary_passkey`.
   * Updates `wallet.spend_threshold_lamports` on-chain.
3. **`instructions/quorum.rs`**:
   * Inspects preceding instructions in the transaction sysvar to verify two distinct Secp256r1 precompile verifications before releasing funds.

---

## 4. Cross-Device Quorum Implementation

Haptix provides two seamless paths for cross-device signature co-signing:

```
┌─────────────────────────┐               ┌─────────────────────────┐
│   Solana Seeker / APK   │               │   Laptop / Mac Touch ID │
│   (Primary Passkey)     │               │   (Secondary Web Vault) │
└────────────┬────────────┘               └────────────┬────────────┘
             │                                         │
             │ 1. Post tx challenge                    │ 2. Detect & Prompt
             ▼                                         ▼
   ┌─────────────────────────────────────────────────────────┐
   │         Haptix Cloud Relay (Render / UptimeRobot)       │
   │         https://haptix-relay.onrender.com               │
   └─────────────────────────────────────────────────────────┘
             │                                         │
             │ 4. Receive signature & submit           │ 3. Sign with P-256
             ◀─────────────────────────────────────────┘
```

### A. Automated Cloud Relay Flow
1. **Phone Initiates Send**: In `components/haptix/haptix-send-sheet.tsx`, if the amount exceeds the spend threshold, the send sheet calls `queueVaultTransfer()` on the active relay host (`constants/app-config.ts`).
2. **Challenge Queued**: The relay assigns a unique transaction ID (`txId`) and holds the signing payload.
3. **Web Vault Approval**: The user opens [`public/vault.html`](file:///Users/ritesh/Claude%20projects/haptix-mobile-app/public/vault.html) (or `https://haptix-passkeys.vercel.app/vault.html`) on their laptop/MacBook. The portal polls the relay, presents the transaction details (recipient, amount, fee), and prompts for Mac Touch ID / Windows Hello.
4. **Signature Relay**: The signed P-256 WebAuthn assertion is posted back to the relay. The mobile app's polling listener (`pollVaultSignature`) automatically receives the signature and broadcasts the 2-of-2 transaction to Solana Devnet.

### B. Offline / Clipboard Fallback
If the device is offline or the relay is unreachable:
* The user generates the signature directly on [`vault.html`](file:///Users/ritesh/Claude%20projects/haptix-mobile-app/public/vault.html).
* Copy the signature payload code.
* The mobile app automatically detects the signature on the clipboard (`Clipboard.getString()`) and completes the 2-of-2 transaction without requiring relay uptime.

---

## 5. Shipped UI & Screen Architecture

* **Onboarding Mode Selector (`app/sign-in.tsx`)**:
  * **Everyday Mode**: Both keys registered on same device (for beginners / fast testing).
  * **Vault Mode**: Primary key on phone, Secondary key enrolled via Web Vault on secondary device.
* **Spending Limits Settings (`app/(tabs)/settings/limits.tsx`)**:
  * Preset chips (`0.05 SOL`, `0.1 SOL`, `0.5 SOL`, `1.0 SOL`, `Custom`).
  * Live explainer: *"Sends up to this amount need 1 tap. Larger sends ask for your Vault key."*
  * Save action enforces full 2-of-2 on-chain biometric approval.
* **Send Sheet Quorum Escalation (`components/haptix/haptix-send-sheet.tsx`)**:
  * Dynamically detects threshold breach.
  * Updates button CTA: **"Send with Quorum (Requires Vault Key)"**.
  * Shows real-time connection status with the Cloud Relay.
* **Settings Account Card (`app/(tabs)/settings/index.tsx`)**:
  * Displays **Dual-Device Vault** badge with active threshold status and recovery health.

---

## 6. Disaster Recovery Synergy

If the secondary Vault device is lost, stolen, or damaged:
* The user initiates **Guardian Social Recovery** via [`app/(tabs)/settings/recovery.tsx`](file:///Users/ritesh/Claude%20projects/haptix-mobile-app/app/(tabs)/settings/recovery.tsx) or [`public/recover.html`](file:///Users/ritesh/Claude%20projects/haptix-mobile-app/public/recover.html).
* A designated guardian initiates a 24-hour timelocked recovery.
* The wallet enters an on-chain freeze window allowing the owner to veto with remaining keys if malicious, or automatically rotate to a replacement secondary key once the timelock expires.

---

## 7. Verification & Automated Tests

All core primitives are verified by 290 automated tests in the test suite:
- `tests/set-spend-threshold.test.ts` — 9/9 unit and live Devnet verification tests for threshold governance.
- `tests/seeker-skr.test.ts` — 18/18 tests verifying Seeker SKR 50-token threshold quorum escalation.
- `tests/integration-test.ts` — End-to-end 2-of-2 multisig execution and P-256 precompile verification.
