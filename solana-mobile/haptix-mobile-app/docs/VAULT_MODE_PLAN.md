# Haptix Vault Mode & Spending Limit Architecture Plan

> **Goal**: Evolve Haptix from a single-device 2-of-2 wallet into a **dual-device smart vault**:
> 1. **Primary Passkey**: Stored on the daily phone (FaceID / Fingerprint) for routine spending.
> 2. **Secondary Passkey (Vault Key)**: Stored on a separate device (MacBook TouchID, iPad, or Hardware Wallet like OneKey / YubiKey) for high-value transactions.
> 3. **Customizable Spending Limit**: A user-configurable daily limit ($\le X$ SOL) requiring a 2-of-2 quorum to change on-chain.

---

## 1. Threat Model & Security Architecture

### Why Single-Device 2-of-2 is Vulnerable
* If an attacker steals an unlocked phone or shoulder-surfs the PIN, they can approve both biometric prompts in seconds and drain 100% of the wallet.

### The Dual-Device "Checking vs. Vault" Invariant
* **Low-Value Sends ($\le \text{Threshold}$)**:
  * Signed by **Primary Passkey** alone directly from the phone. Instant, friction-free.
* **High-Value Sends ($> \text{Threshold}$)**:
  * Requires **Primary Passkey** (Phone) **AND** **Secondary Passkey** (Laptop / Hardware Key).
  * A thief holding the phone alone is physically prevented by the Solana validator precompile from draining savings.
* **Modifying the Threshold**:
  * Changing the spending limit is an on-chain governance action (`set_spend_threshold`) requiring **both keys**. A thief cannot raise the limit to bypass security.

---

## 2. On-Chain Program Status (Already Ready)

The Solana smart contract already contains the necessary hooks:

1. **`execute_transfer.rs`**:
   * Evaluates `transfer_amount <= wallet.spend_threshold_lamports`.
   * Low-value: Verifies only Primary `secp256r1` signature.
   * High-value: Requires and verifies both Primary and Secondary `secp256r1` precompile signatures.
2. **`governance.rs` (`handle_set_spend_threshold`)**:
   * Verifies `SET_THRESHOLD:<u64_le>` message against both `wallet.primary_passkey` and `wallet.secondary_passkey`.
   * Updates `wallet.spend_threshold_lamports` on-chain.

---

## 3. Phased Implementation Roadmap

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: On-Chain Spending Limit Control in Settings        │
│ - Implement `set_spend_threshold` helper & unit tests       │
│ - Build Settings → "Spending Limits" UI with slider/presets │
│ - 2-of-2 authorization flow for threshold updates           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Mode Selection at Onboarding                       │
│ - Everyday Mode (Single device: 2 on-device passkeys)       │
│ - Vault Mode (Phone + Hardware/Laptop Key)                  │
│ - FIDO2 / WebAuthn cross-platform credential picker         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: High-Value Send Experience Polish                  │
│ - Real-time threshold detection in Send Sheet               │
│ - Clear prompt: "Primary approved. Now tap Vault Key."      │
│ - Hardware key (OneKey/YubiKey NFC) or cross-device sign    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Phase 1: On-Chain Spending Limit Control (Immediate Focus)

### A. Core Client Utilities (`utils/haptix-client.ts`)
* Implement:
  ```typescript
  export function getSetSpendThresholdSignedMessage(newThresholdLamports: bigint): Uint8Array {
    const prefix = Buffer.from('SET_THRESHOLD:', 'utf8')
    const amountBytes = Buffer.alloc(8)
    amountBytes.writeBigUInt64LE(newThresholdLamports)
    return Buffer.concat([prefix, amountBytes])
  }
  ```
* Implement instruction builder `createSetSpendThresholdInstruction`.

### B. Unit & Devnet Tests (`tests/set-spend-threshold.test.ts`)
* Test message serialization and LE u64 layout.
* Test on-chain update with Devnet wallet:
  * Proves threshold updates when both keys sign.
  * Proves attempt with only 1 key fails on-chain.

### C. Settings UI (`app/(tabs)/settings/limits.tsx`)
* **Route**: `/settings/limits` accessible from Settings $\rightarrow$ Spending Limits.
* **Controls**:
  * Preset chips: `0.05 SOL`, `0.1 SOL`, `0.5 SOL`, `1.0 SOL`, `Custom`.
  * Visual explainer: *"Sends up to this amount need 1 tap. Larger sends ask for your Vault key."*
  * **Save Button**: Prompts biometric approval of Primary Key $\rightarrow$ prompts Secondary Key $\rightarrow$ submits on-chain tx.

---

## 5. Phase 2: Dual-Device / Vault Mode Setup

### A. Onboarding Architecture (`app/sign-in.tsx`)
Present the user with an intuitive choice during wallet creation:

| Mode | User Persona | Secondary Key Storage |
| :--- | :--- | :--- |
| **Everyday Mode** | Beginners, small balances | Secondary passkey stored in same device secure storage. |
| **Vault Mode** | Security-conscious, large balances | Secondary passkey stored on Laptop / iPad or Hardware Wallet. |

### B. Hardware & Cross-Device Key Registration
1. **NFC / USB Hardware Key (OneKey / YubiKey)**:
   * When registering Secondary Key, pass `authenticatorAttachment: 'cross-platform'` to the WebAuthn API.
   * Android/iOS displays the native prompt: *"Insert your security key or hold it near your phone."*
2. **MacBook / iPad (Hybrid Transport)**:
   * Native WebAuthn QR flow: iOS/Android displays a pairing QR code. The user scans it with their MacBook camera or Safari to store the passkey in their MacBook's Secure Enclave (TouchID).

---

## 6. Phase 3: High-Value Send Experience Polish

In [`components/haptix/haptix-send-sheet.tsx`](file:///Users/ritesh/Claude%20projects/passkey-wallet/solana-mobile/haptix-mobile-app/components/haptix/haptix-send-sheet.tsx):
* Compare entered amount with `activeWallet.spendThreshold`.
* If $\le \text{Threshold}$:
  * Action button: **"Send with Passkey (1 signature)"**
* If $> \text{Threshold}$:
  * Action button: **"Send with Quorum (Requires Vault Key)"**
  * Displays a reassurance banner:
    > *"This transfer exceeds your daily limit of {X} SOL. Your Primary Key will sign, then your Vault Key will be requested."*

---

- [x] **Instruction & Utility**: `getSetSpendThresholdSignedMessage` and `createSetSpendThresholdInstruction` verified.
- [x] **Automated Tests**: New test suite `tests/set-spend-threshold.test.ts` passing on Devnet (9/9 passed).
- [x] **UI Component**: New `app/(tabs)/settings/limits.tsx` screen linked from Settings.
- [x] **Threshold Updates**: End-to-end on-chain update tested and verified on Solana Explorer.
- [x] **Send Sheet Escalation**: Send sheet dynamically escalates to 2-of-2 signatures above configured threshold, displays distinct "Phone + Vault Key" badge and secondary prompt.
- [x] **Dual-Device Mode Selector**: Wallet creation in `app/sign-in.tsx` allows choosing Everyday Mode vs. Vault Mode (cross-platform security key attachment).
- [x] **Account Display**: Settings Account card displays "Dual-Device Vault" or "Everyday Mode" with distinct badges and descriptions.
