# Haptix Phase 3A: Production Integration & Client SDK Specification

---

## 1. Overview & System Architecture

Haptix provides a secure delegation framework that allows autonomous AI agents to transact on behalf of users without ever gaining custody of the master wallet keys. 

Phase 3A bridges the verified, hardened smart contracts (`PasskeyAccount.sol`, `SpendPolicy.sol`, `SpendWindow.sol`) with a production-grade TypeScript SDK (`@haptix/sdk`).

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                 SDK ARCHITECTURE                               │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│    [AI Agent Process]                      [Web Client / User Interface]       │
│            │                                             │                     │
│    ┌───────▼─────────────────────────────────────────────▼───────────────┐     │
│    │                     HaptixAccountClient                             │     │
│    ├─────────────────────────────────────────────────────────────────────┤     │
│    │ • agent.ts        : secp256k1 key generation & UserOp signing       │     │
│    │ • session.ts      : SessionConfig validation & calldata encoding    │     │
│    │ • userop.ts       : ERC-4337 v0.7 PackedUserOperation pack/hash    │     │
│    │ • swap.ts         : Uniswap V3 encoding & integer slippage math     │     │
│    │ • policy.ts       : Offline fail-closed validation & rule checks    │     │
│    │ • passkey.ts      : WebAuthn browser assertions & quorum collation │     │
│    │ • bundler.ts      : JSON-RPC client (eth_sendUserOperation, etc.)   │     │
│    └─────────────────────────────────┬───────────────────────────────────┘     │
│                                      │                                         │
│                                      ▼                                         │
│               [ERC-4337 v0.7 Bundler Endpoint (Pimlico / Stackup)]             │
│                                      │                                         │
│                                      ▼                                         │
│               [Canonical EntryPoint v0.7 (0x0000...7172)]                      │
│                                      │                                         │
│                                      ▼                                         │
│               [PasskeyAccount.sol Smart Contract on Base]                      │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Modules

### 2.1. Agent Key Management (`agent.ts`)
- **Key Generation**: Uses cryptographically secure random entropy to generate 32-byte `secp256k1` keys.
- **Address Derivation**: Computes the standard EVM address (Keccak-256 of uncompressed public key).
- **Signature Encodings**:
  - `0x01` Autonomous Agent Signature:
    $$\text{signature} = \text{0x01} \parallel \text{abi.encode}(\text{agentKey}, \text{ecdsaSig}_{65})$$
  - `0x02` Escalated Agent Signature:
    $$\text{signature} = \text{0x02} \parallel \text{abi.encode}(\text{agentKey}, \text{ecdsaSig}_{65}, \text{passkeyIds}, \text{passkeySigs})$$
- **EIP-2 Low-S Normalization**: Strictly normalizes all ECDSA signatures to the lower half of the curve order ($s \le N/2$).

### 2.2. ERC-4337 v0.7 UserOperation Packing (`userop.ts`)
- Implements the exact canonical v0.7 `PackedUserOperation` format:
  - `accountGasLimits`: `bytes32` containing `(verificationGasLimit << 128) | callGasLimit`.
  - `gasFees`: `bytes32` containing `(maxPriorityFeePerGas << 128) | maxFeePerGas`.
- Computes `userOpHash` using the exact two-step Keccak-256 hash specified by ERC-4337 v0.7 and verified against `Vectors.sol`.

### 2.3. Off-Chain Quoting & Slippage Protection (`swap.ts`)
- **Integer Base-Unit Arithmetic**: All financial calculations use `bigint` without floating-point errors.
- **Minimum Output Guarantee**:
  $$\text{amountOutMinimum} = \frac{\text{quotedAmountOut} \times (10000 - \text{slippageBps})}{10000}$$
- **Fail-Closed Safeguards**: Rejects $\text{amountOutMinimum} = 0$, duplicate token addresses ($\text{tokenIn} == \text{tokenOut}$), native ETH swaps without wrapping, and excessive slippage ($> 5\%$).

### 2.4. Offline Policy Validator (`policy.ts`)
- Simulates on-chain validation rules locally before submitting UserOperations to bundlers:
  1. Checks active session timeframe (`validAfter` / `validUntil`).
  2. Verifies destination contract is allowlisted.
  3. Verifies function selector is allowlisted.
  4. Blocks persistent approvals (`approve`, `permit`, `permit2`).
  5. Determines whether operation can proceed autonomously ($\le \text{perTxLimit}$) or requires human passkey escalation ($> \text{perTxLimit} \le \text{humanApprovalThreshold}$).
  6. Strictly rejects operations exceeding `humanApprovalThreshold`.

### 2.5. WebAuthn Hardware Passkey Client (`passkey.ts`)
- **Browser WebAuthn Integration**: Communicates with Apple Secure Enclave, Android Keystore, and FIDO2 YubiKeys via `navigator.credentials`.
- **DER Parser**: Parses raw ASN.1 DER ECDSA signatures into normalized 32-byte `(r, s)` components with P-256 low-s normalization.
- **2-of-N Quorum Collation**: Enforces strictly ascending signer IDs ($\text{ids}[i] < \text{ids}[i+1]$) as required by `PasskeyAccount.sol`.

---

## 3. Test Coverage & Verification

- **SDK Unit & Integration Tests**: 38 tests passing across 7 suites (`vitest`).
- **Foundry Smart Contract Invariants**: 220 tests passing across 15 suites (`forge test`).
- **Zero Failures / Zero Regressions**.
