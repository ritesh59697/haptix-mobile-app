# Haptix Security Architecture & Threat Model

Haptix eliminates the two primary causes of crypto wallet loss:
1. **Seed phrase theft or leakage**: Seed phrases are completely removed. Private keys are non-exportable hardware enclave platform credentials (P-256 / Secp256r1 via Android Credential Manager TEE/StrongBox and Apple Secure Enclave).
2. **Single-signature catastrophic drain**: Any transaction exceeding the user's daily spend threshold requires a 2-of-2 hardware passkey quorum across separate physical devices (e.g., phone + Mac Touch ID or USB FIDO2 key).

---

## 1. Key Hierarchy & Authority Separation

To prevent "second key" backdoor vulnerabilities, Haptix enforces strict operational and architectural boundaries:

```
┌────────────────────────────────────────────────────────┐
│               Haptix Security Model                    │
├──────────────────────┬─────────────────────────────────┤
│ Role                 │ Privileges & Constraints        │
├──────────────────────┼─────────────────────────────────┤
│ Primary Passkey      │ Small daily sends, biometrics   │
│ Secondary Passkey    │ Quorum for high-value sends     │
│ Recovery Guardian    │ Freeze wallet, initiate delay   │
│ Relayer (Fee Payer)  │ Pays network fee / rent ONLY    │
│ Program Authority    │ Timelocked Squads / Revoked     │
└──────────────────────┴─────────────────────────────────┘
```

### A. Program Upgrade Authority (Smart Contract Backend)
* **Devnet (Current)**: Upgradable by the project deployer keypair (`BPFLoaderUpgradeab1e`) for rapid testing and iterative protocol enhancements.
* **Mainnet Pre-Flight Requirement**:
  * Before holding production funds, upgrade authority must be **transferred to a Squads v4 timelocked multisig** (with a minimum 7-day timelock and published signers) or **permanently finalized** (`solana program set-upgrade-authority <PID> --final`).
  * Until `solana program show <PID>` reflects a multisig or revoked authority, the deployer key retains upgrade rights. Mainnet deployment scripts will enforce this gate before launch.

### B. Relayers & Fee Sponsorship
* **Role**: A relayer or gas-sponsor is strictly an untrusted transaction fee payer (`feePayer: payer.publicKey`).
* **Isolation Rules**:
  * Relayers never hold guardian privileges.
  * Relayers never see or derive passkey private keys.
  * Relayers have no access to program upgrade authorities.
  * If a relayer goes offline or censorious, the user can fund their own account or submit via another RPC.

### C. Guardian & Recovery Timelock
* **Guardian Role**: An external, independent Solana address (e.g. Phantom, Solflare, Ledger).
* **Constraints**:
  * Cannot spend or withdraw funds.
  * Cannot be a key held by this app or the fee-paying relayer.
  * Starting a recovery locks the wallet into an on-chain freeze.
* **Anti-Griefing Timelock Guarantee**:
  * `handle_initiate_recovery` enforces `require!(wallet.recovery_initiated_at == 0, HaptixError::RecoveryInProgress)`. A guardian cannot perpetually restart the clock or grief the owner.
  * Default delay is 24 hours (86,400s). The client rejects zero-delay and sub-hour values to preserve the owner's veto window.
  * When recovery is initiated, proposed replacement keys are visibly displayed on the phone. The owner can cancel/veto at any time before the timelock expires using a 2-of-2 passkey quorum.

---

## 2. Autonomous Agent Hot-Key Budgets

Haptix provides native session key grants for AI agents:
* **Autonomous Allowance**: Once granted via a 2-of-2 passkey quorum, an agent key can sign transactions without prompting for biometrics, up to its explicit budget cap.
* **Budget Isolation**: The agent's allowance is an independent budget that does NOT count against or consume the human owner's daily spend threshold.
* **Time-Bounded Expiry**: Agent sessions enforce short expiration timestamps (e.g., 1h to 24h).
* **Instant Revocation**: Owners can revoke an agent session at any time. Revocation remains fully operational even if the wallet is locked/frozen.

---

## 3. What You See Is What You Sign (WYSIWYS)

Both the mobile application and passkey engine enforce strict payload inspection before user verification:
1. **Pre-Signature Payload Validation**:
   * The passkey engine (`verifyWysiwysPayload`) inspects the exact binary payload before requesting biometric authorization or invoking the hardware enclave.
   * Arbitrary binary payloads and blind hashes are rejected immediately with a security exception.
   * Every authorized instruction requires an exact byte length:
     * `TRANSFER:` exactly 97 bytes
     * `SET_GUARDIAN:` exactly 93 bytes
     * `SET_THRESHOLD:` exactly 70 bytes
     * `GRANT_AGENT:` exactly 140 bytes
     * `REVOKE_AGENT:` exactly 93 bytes
     * `UNFREEZE_WALLET:` exactly 64 bytes
     * `CANCEL_RECOVERY:` exactly 64 bytes
2. **Transfer Verification**:
   * The recipient address and amount displayed on screen are cross-verified against the recipient (bytes 57..89) and amount (bytes 89..97) decoded from the 97-byte message buffer.
   * If the on-screen recipient or amount differs from the byte payload, signing is immediately aborted.

---

## 4. Cluster Binding & Replay Prevention

1. **8-Byte Cluster Tag**: Every signed message includes an 8-byte ASCII cluster identifier (`devnet\0\0` or `mainnet\0`). On-chain programs reject authorization messages where the embedded cluster tag does not match the account's bound cluster.
2. **Program Deployments**: Devnet currently operates under Program ID `9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`. Mainnet production deployment will mint an independent, distinct Program ID to guarantee physical instruction domain separation.
3. **Sequential Auth Nonces**: Every state-changing owner authorization increments an on-chain `auth_nonce`, preventing replay of previously captured WebAuthn assertions.
