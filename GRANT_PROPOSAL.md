# Grant Application & Technical Proposal: Haptix Protocol

> **Target Grant Programs:** Base Ecosystem Grants · Optimism Superchain Grants · Ethereum Foundation / 4337 Core Grants · Gitcoin Grants  
> **Project Name:** Haptix (`passkey-wallet`)  
> **Tagline:** The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents  
> **Repository:** [https://github.com/ritesh59697/haptix](https://github.com/ritesh59697/haptix)  
> **Live Smart Account (Base Sepolia):** [`0xB01543453cF31052c769d79e9C755E3b035d796f`](https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f)  
> **Canonical EntryPoint:** [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://sepolia.basescan.org/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) (ERC-4337 v0.7)  
> **P-256 Precompile:** Osaka RIP-7212 (`0x0000000000000000000000000000000000000100`)

---

## 1. Executive Summary

Haptix is an ERC-4337 smart account architecture built natively for the EVM that marries **WebAuthn hardware passkeys (secp256r1 / P-256)** via the **RIP-7212 precompile** with an **autonomous spending policy firewall for AI agents**.

As AI trading agents, autonomous bots, and automated solvers become ubiquitous on EVM networks, exposing full-custody private keys in hot memory or cloud runtimes creates critical security risks. If an agent's host server is compromised or prompted adversarially, attackers instantly drain the entire wallet balance.

**Haptix solves this on-chain**:
1. **Human Hardware Security**: Daily human operations are authorized through device hardware enclaves (Apple Touch ID, Face ID, Android Biometrics, Windows Hello, YubiKey) using native P-256 curve cryptography verified directly by Base's native `0x100` precompile at ~109k gas.
2. **Autonomous AI Agent Delegation**: Users grant bounded `secp256k1` session keys to AI agents with on-chain limits (micro-transfers <= $50 execute autonomously with 0 human friction).
3. **Hardware Biometric Escalation**: Any high-value action or DeFi swap ($50–$200) requires the agent to present the UserOp to the human for a **2-of-2 biometric passkey quorum**.
4. **Hard Fail-Closed Ceiling**: Transactions exceeding the maximum ceiling (> $200), or attempts to approve persistent allowances (`approve`, `permit`, `permit2`), are **blocked directly in EVM bytecode**.
5. **Guardian Social Recovery**: Timelocked on-chain guardian recovery eliminates single-point-of-failure key loss without sacrificing non-custodial sovereignty.

---

## 2. Problem Statement & Market Need

| Current Pain Point | The Vulnerability | How Haptix Solves It |
|---|---|---|
| **Hot Keys for AI Agents** | AI agents store unconstrained ECDSA private keys in `.env` files or VPS memory. Compromise = total asset loss. | Scoped session keys with hard per-tx limits, 24h rolling caps, and protocol allowlists enforced in smart contract bytecode. |
| **Client-Side 2FA Bypasses** | Web2 wallets rely on frontend popups, SMS, or TOTP codes. An attacker with the private key scripts RPC broadcasts directly. | Enforcement lives **inside `validateUserOp` on-chain**. Bypassing the wallet UI fails closed at the consensus layer. |
| **High Gas for Curve P-256** | Verifying WebAuthn P-256 in standard EVM bytecode costs ~350k–400k gas per signature. | Utilizes native Osaka RIP-7212 precompile (`0x100`) on Base, bringing single-passkey validation down to **~109k gas**. |
| **ERC-7562 Mempool Ban Violations** | Naive spend windows query `block.timestamp` during validation, which causes bundlers to drop the op under ERC-7562 opcode rules. | Intersects EntryPoint `validUntil` / `validAfter` time bounds without executing banned opcodes in validation. |
| **Permanent Passkey Lockout** | Pure passkey wallets with no recovery mean that losing physical devices results in permanent fund loss. | Timelocked Guardian Social Recovery module with 1-signature emergency cancellation. |

---

## 3. Technical Architecture & Innovation

```
                      +------------------------------------------+
                      |         ERC-4337 PackedUserOperation     |
                      +------------------------------------------+
                                           |
                                           v
                       +----------------------------------------+
                       |   validateUserOp (PasskeyAccount.sol)  |
                       +----------------------------------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
            [0x00 Human Passkey]                          [0x01 / 0x02 Agent]
                    |                                             |
         +----------+----------+                        +---------+---------+
         |                     |                        |                   |
    [< Threshold]       [>= Threshold]           [<= $50 Micro]       [$50-$200 Limit]
         |                     |                        |                   |
         v                     v                        v                   v
   1 Hardware Sig       2-of-2 Hardware          Autonomous ECDSA     Agent ECDSA +
   (~109k gas)          Passkey Quorum           Session Key          2-Passkey Quorum
         |                     |                        |                   |
         +----------+----------+                        +---------+---------+
                    |                                             |
                    +----------------------+----------------------+
                                           |
                                           v
                        +-------------------------------------+
                        |   RIP-7212 P-256 Precompile (0x100) |
                        +-------------------------------------+
                                           |
                                           v
                        +-------------------------------------+
                        |         execute() On-Chain          |
                        +-------------------------------------+
```

### On-Chain Calldata Policy Engine (`SpendPolicy.sol`)
- **Inspection**: Calldata is decoded and classified during `validateUserOp` before state is touched.
- **DeFi Guardrails**: Restricts autonomous agents to audited protocols (e.g. Uniswap V3 `SwapRouter02`). Enforces `recipient == address(this)` to prevent fund redirection and `amountOutMinimum > 0` to prevent zero-slippage sandwich attacks.
- **Anti-Drain Blanket**: Persistent approvals (`approve`, `increaseAllowance`, `setApprovalForAll`) and gasless permits (`permit`, `permit2`) are blocked for autonomous agents and strictly demand a 2-of-2 human passkey quorum.

---

## 4. Current Progress & Verifiable Receipts

Haptix is not an idea or mock-up—it is an end-to-end engineered, battle-tested, working protocol live on Base Sepolia:

### 1. Smart Contract Test Suite (243 Tests Passing)
- **17 Foundry Suites**: 243 tests passed, 0 failed, 0 skipped (100% passing).
- **Cryptographic Vectors**: Real WebCrypto P-256 hardware vectors tested against EVM `osaka` `0x100` precompile.
- **Red-Team Attack Tests (`AgentRedTeamAudit.t.sol`)**: Reentrancy, array head manipulation, calldata fuzzing (256 runs), duplicate signers, replay attacks.
- **ERC-7562 Opcode Opacity (`Erc7562.t.sol`)**: Verifies independence from `TIMESTAMP` and `NUMBER` opcodes during validation.

### 2. TypeScript SDK (`@haptix/sdk`)
- **10 Vitest Suites**: 50 tests passed, 0 failed.
- Modules: `PasskeyAccount`, `AgentSessionManager`, `SwapPolicyBuilder`, `BundlerClient`, `RecoveryManager`.
- 100% typed with `viem` and `@simplewebauthn/browser`.

### 3. Frontend & Browser Extension
- **Chrome Extension (Manifest V3)**: Production-ready sidebar and popup UI with full WebAuthn enclave enrollment.
- **Interactive Web App**: Standalone harness for 2-of-2 passkey quorum enrollment and 1-click autonomous execution / policy firewall simulation (`http://localhost:5199/grant-session.html`).

### 4. Verified On-Chain Deployments & Receipts (Base Sepolia)
- **PasskeyAccountFactory**: [`0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b`](https://sepolia.basescan.org/address/0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b) (Counterfactual CREATE2 factory)
- **PasskeyAccount Implementation**: [`0x9B553dF98bbC1c7152698c4739A93281F0FBB110`](https://sepolia.basescan.org/address/0x9B553dF98bbC1c7152698c4739A93281F0FBB110)
- **Live Passkey Smart Account**: [`0xB01543453cF31052c769d79e9C755E3b035d796f`](https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f)
- **Live Session Delegation (2-of-2 Passkey Quorum)**: Verified on Base Sepolia scan ([Tx `0x1aa7d520…2ccb`](https://sepolia.basescan.org/tx/0x1aa7d520a4f74e5ec84f4c51cd00402b898e33f3c1bf04277bbaebc824dd2ccb)) at Block 46457789.
- **Autonomous AI Agent UserOp (Zero Passkey Prompts)**: Verified on Base Sepolia scan ([Tx `0x4ca3ea90…5840`](https://sepolia.basescan.org/tx/0x4ca3ea90dfa75ceef593c381a75b6cab9e36188fc03db26ccf064e2ca9785840)) at Block 46457806.
- **Autonomous Demo Execution**: Verified on Base Sepolia scan ([Tx `0xa5130be0…055d`](https://sepolia.basescan.org/tx/0xa5130be0e01acb26176cf87f6776c52877360ecc06872df8b67042517b49055d)).
- **On-Chain Policy Firewall Enforcement**: 0.005 ETH over-limit transfer rejected on-chain (`SIG_VALIDATION_FAILED (1)` and EntryPoint `AA24` signature error).
- **Live Biometric Touch ID UserOp**: Verified on Base Sepolia scan ([Tx `0x5c4c413d…404d`](https://sepolia.basescan.org/tx/0x5c4c413d486754cf8098d4ca4dd2f82a17a72aabc9680174a0bc583bffeb404d)).
- **dApp EIP-1193 Extension UserOp**: Verified on Base Sepolia scan ([Tx `0x428fe58b…1d11`](https://sepolia.basescan.org/tx/0x428fe58b08360238c33bfc6a92264e977283aab0b05965d3abe0f034b5d21d11)).

### 5. Reproducible Terminal Demo Commands
```bash
npm run demo        # Complete unified 3-step security lifecycle
npm run demo:agent  # Standalone live autonomous agent spend
npm run demo:reject # Standalone live on-chain policy firewall audit
```

---

## 5. Roadmap, Milestones & Use of Grant Funds

Grant funding will be utilized strictly for security hardening, mainnet infrastructure, and developer adoption:

```
[Milestone 1: Security Audit] ───> [Milestone 2: Mainnet & Gas Tank] ───> [Milestone 3: Chrome Store & AI SDKs]
  - External Smart Contract Audit    - Base Mainnet Deployment           - Chrome Web Store Launch
  - Cantina / Code4rena Review       - Pimlico Paymaster Gas Pool        - Eliza / LangChain / Goat Adapters
  - Formal Verification of Windows   - Multi-Chain (OP / Arbitrum)       - Developer Documentation Hub
```

### Milestone Breakdown

| Milestone | Deliverables | Target Completion | Earmarked Budget |
|---|---|:---:|:---:|
| **Milestone 1: Security Audit & Bug Bounty** | External tier-1 audit of `PasskeyAccount.sol`, `SpendPolicy.sol`, `SpendWindow.sol`, and `Recovery`. Launch Immunefi bug bounty. | 6–8 weeks | $25,000 |
| **Milestone 2: Mainnet Deployment & Paymaster Pool** | Deploy factory and canonical accounts to Base Mainnet & Optimism. Fund initial Pimlico/Alchemy paymaster gas sponsorship tank for early adopters. | 3–4 weeks | $15,000 |
| **Milestone 3: Chrome Web Store & AI Framework Integrations** | Public Chrome Web Store listing. Pre-built plugins for popular AI agent frameworks (ElizaOS, LangChain, Virtuals, Goat SDK). | 4–6 weeks | $10,000 |
| **Total Requested** | | | **$50,000** |

---

## 6. Alignment with Grant Foundations

### Why Base?
- Base natively supports the Osaka RIP-7212 precompile (`0x100`), making it the premier L2 for low-cost biometric passkeys.
- Haptix accelerates Base's mission to "bring the next billion users onchain" by eliminating seed phrases for humans while simultaneously creating the safest infrastructure for onchain AI agents.

### Why Optimism & Superchain?
- Standardized ERC-4337 v0.7 + RIP-7212 precompile deployment across the entire Superchain (OP Mainnet, Base, Zora, Mode).
- Fosters autonomous onchain economic activity by making agentic micro-swaps and arbitrage safe against key compromise.

---

## 7. Team & Contact Information

- **Lead Developer & Maintainer:** Ritesh ([GitHub: ritesh59697](https://github.com/ritesh59697))
- **Project Repository:** [github.com/ritesh59697/haptix](https://github.com/ritesh59697/haptix)
- **License:** Open-source MIT License
