# Haptix On-Chain Solana Smart Program

> **Program ID (Devnet)**: [`9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke`](https://explorer.solana.com/address/9wC1ok8d4PrBDG3TS7iyEu9QxMCYv6BKrdLb3q4yZbke?cluster=devnet)  
> **Framework**: Anchor 0.31 / Rust / Solana Precompile Introspection

---

## Architecture Overview

Haptix provides seedless, biometric hardware smart accounts on Solana Mobile (Seeker & Saga) with zero-dependency native `Secp256r1` precompile verification:

1. **Native Secp256r1 Verification**: Verifies P-256 WebAuthn signatures directly on-chain via Solana's native `Secp256r1SigVerify1111111111111111111111111` precompile instruction introspection.
2. **2-of-2 Hardware Biometric Quorum**: Transfers exceeding spend policy limits (or > 50 SKR) require dual-device hardware verification (Primary phone biometric + Secondary Vault key / Mac Touch ID).
3. **Autonomous Agent Sessions**: Scoped session keys with time bounds and expenditure ceilings for AI trading agents (`grant_agent_session`, `agent_execute`).
4. **Guardian Social Recovery**: Timelocked (24-hour) social recovery and emergency Panic Freeze circuit breaker (`panic_freeze`, `unfreeze`).

---

## Build & Test

```bash
anchor build
anchor test
```
