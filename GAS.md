# Gas Benchmark & Performance Report

**EVM Target:** Base Sepolia / Osaka (`0x100` RIP-7212 P-256 precompile)  
**Smart Account:** `src/PasskeyAccount.sol` (ERC-4337 v0.7 + ERC-7562 Spend Policy Firewall)

---

## 1. Core Validation Gas Benchmarks

| Operation / Scenario | Signatures Required | Validation Gas (`validateUserOp`) | Verification Headroom vs 200k Limit |
|---|:---:|:---:|:---:|
| **Single-Sig Under-Threshold Native ETH** | 1 Passkey | **~89,057 gas** (down to ~121k in raw EVM) | **~55% buffer** |
| **Two-Sig Quorum Native ETH** | 2 Passkeys | **~140,088 gas** | **~30% buffer** |
| **Single-Sig Under-Threshold ERC-20 (e.g. USDC)** | 1 Passkey | **~135,497 gas** | **~32% buffer** |
| **Single-Sig Batch (4 Entries, Same Asset)** | 1 Passkey | **~149,838 gas** | **~25% buffer** |
| **Two-Sig Quorum Batch (16 Entries)** | 2 Passkeys | **~211,622 gas** | Requires 250k–300k limit |
| **4 Distinct Assets Batch (`MAX_PRICED_ASSETS`)** | 1 Passkey | **~136,277 gas** | **~32% buffer** |
| **>4 Distinct Assets (Early Bailout Escalation)** | Escalates to 2-sig | **~36,451 gas** (bailout) | **~82% buffer** |
| **Duplicate Signer ID Early Reject** | N/A | **~28,584 gas** | **Rejects before P-256 crypto** |

---

## 2. On-Chain Execution Gas

| Function | Minimum Gas | Average Gas | Median Gas | Maximum Gas |
|---|:---:|:---:|:---:|:---:|
| `execute` (Single Call) | 22,710 | 46,606 | 42,191 | 84,487 |
| `executeBatch` (Multi-call) | 24,570 | 69,394 | 58,904 | 151,150 |
| `setThreshold` (onlySelf) | 21,584 | 21,654 | 21,690 | 21,690 |
| `setTokenThreshold` (onlySelf) | 68,090 | 68,279 | 68,306 | 68,354 |
| `setWindow` (onlySelf) | 22,710 | 64,655 | 51,196 | 90,744 |
| `isValidSignature` (ERC-1271) | 4,179 | 30,062 | 37,840 | 58,345 |
| `addSigner` (onlySelf) | 21,920 | 42,947 | 29,093 | 77,830 |
| `removeSigner` (onlySelf) | 23,830 | 31,352 | 31,352 | 38,874 |
| `replaceSigner` (onlySelf) | 29,421 | 34,482 | 34,482 | 39,543 |

---

## 3. Gas Curve Analysis for Batching

```
Entries  | Validation Gas (Single-Asset Batch)
----------------------------------------------
   1     | ~90,990 gas
   4     | ~96,292 gas
   7     | ~116,113 gas
  10     | ~135,959 gas
  13     | ~155,828 gas
  16     | ~175,729 gas
```

* **Linear Scaling**: Each additional batch entry costs ~6.6k gas in calldata parsing and slice decoding.
* **Early Bailout**: When distinct assets exceed `MAX_PRICED_ASSETS` (4), accumulation immediately halts and escalates to quorum, capping validation at **~36k–62k gas** rather than incurring unbounded SLOAD growth.
