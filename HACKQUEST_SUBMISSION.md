# Arbitrum Open House Singapore: Online Buildathon — Submission Kit

> **Hackathon Portal:** [HackQuest Buildathon Submission](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)  
> **Project Name:** Haptix Protocol (`passkey-wallet`)  
> **Tagline:** The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents  
> **Prize Pool:** $115,000 USDC + IRL Singapore Founder House ($300k+ Pool)  
> **Submission Deadline:** October 4, 2026 (15:59 UTC)  

---

## 1. Quick Copy-Paste Form Answers

### Project Details
- **Project Name:** `Haptix Protocol`
- **Short Tagline (under 80 characters):**  
  `Biometric Hardware Enclave & Autonomous AI Agent Firewall for Arbitrum`
- **Track Selection:**  
  `Infrastructure & Tooling` / `Account Abstraction` / `AI & Consumer Usability`
- **Special Consideration / Sponsor Track:**  
  `Paxos USDG Integration` (Eligible for extra consideration prize pool)

### Contract Addresses (Exact Format for HackQuest)
- **Primary Core Contract Address:**  
  `Arbitrum Sepolia: 0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3 — PasskeyAccount Implementation`
- **Primary Factory Contract Address:**  
  `Arbitrum Sepolia: 0x60319237e8dd2D661eBcF8E6933458BD78Ce146d — PasskeyAccountFactory (CREATE2 Minimal Proxy)`
- **Canonical EntryPoint:**  
  `Arbitrum Sepolia: 0x0000000071727De22E5E9d8BAf0edAc6f37da032 — Canonical ERC-4337 v0.7 EntryPoint`
- **Multi-Chain Reference (Base Sepolia):**  
  `Base Sepolia: 0xB01543453cF31052c769d79e9C755E3b035d796f — Live Passkey Smart Account`

---

## 2. On-Chain Verification Receipts (Arbitrum Sepolia)

| Component | On-Chain Address | Arbiscan Link |
|---|---|---|
| **PasskeyAccount Implementation** | `0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3` | [View on Arbiscan](https://sepolia.arbiscan.io/address/0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3) |
| **PasskeyAccountFactory** | `0x60319237e8dd2D661eBcF8E6933458BD78Ce146d` | [View on Arbiscan](https://sepolia.arbiscan.io/address/0x60319237e8dd2D661eBcF8E6933458BD78Ce146d) |
| **Implementation Deploy Tx** | `0xe87b7b21a1da1837304e0156418a29f5ef6765f93a3fc7b09f6fb7ae39988f10` | [View Tx](https://sepolia.arbiscan.io/tx/0xe87b7b21a1da1837304e0156418a29f5ef6765f93a3fc7b09f6fb7ae39988f10) |
| **Factory Deploy Tx** | `0xe2acbad9d20e1cdfbb9b4a0a329684ab92727dc904025974f9e0a5c23b98cda0` | [View Tx](https://sepolia.arbiscan.io/tx/0xe2acbad9d20e1cdfbb9b4a0a329684ab92727dc904025974f9e0a5c23b98cda0) |
| **RIP-7212 Precompile** | `0x0000000000000000000000000000000000000100` | Native Arbitrum Nitro P-256 Curve Precompile |
| **Paxos USDG Stablecoin** | `0xDDF7d873F5738c2A191624b1ba1Aba7042621E43` (Sepolia) · `0x004B506865409877C9fA29bfb1ebA929984B9bbC` (Mainnet) | [View on Arbiscan](https://arbiscan.io/address/0x004B506865409877C9fA29bfb1ebA929984B9bbC) |

---

## 3. Detailed Answers to HackQuest Questions

### Question 1: "Describe your project in detail (Problem, Solution, Architecture)"

> **Haptix is an ERC-4337 smart account protocol and biometric hardware security layer built natively for Arbitrum and EVM networks that combines WebAuthn hardware passkeys (Apple Touch ID, Face ID, Windows Hello, Android Biometrics) with an on-chain spending policy firewall for autonomous AI agents.**
>
> ### The Problem:
> As AI agents (trading bots, arbitrageurs, automated solvers) proliferate across Arbitrum, exposing full-custody private keys in cloud servers, `.env` files, or VPS memory creates existential risk. If an agent server is compromised or prompted adversarially, attackers instantly drain the entire balance. Traditional 2FA (TOTP, SMS) only exists on frontend clients—an attacker with the private key simply scripts RPC broadcasts directly, completely bypassing Web2 security.
>
> ### The Solution:
> Haptix shifts security enforcement **into the consensus layer (`validateUserOp` on-chain)**:
> 1. **Zero-Seed Biometric Security**: Humans authorize operations via device hardware enclaves using native P-256 curve cryptography verified directly by Arbitrum's RIP-7212 (`0x100`) precompile at ~109k gas.
> 2. **Autonomous AI Agent Delegation**: Users grant bounded session keys to AI agents with strict on-chain limits (e.g. micro-swaps <= $50 execute autonomously with 0 human prompts).
> 3. **Hardware Biometric Escalation**: Any high-value transfer or DeFi action ($50–$200) requires the agent to present the UserOp to the human for a **2-of-2 biometric passkey quorum**.
> 4. **Hard Fail-Closed Ceiling**: Transactions exceeding the ceiling (> $200), or attempts to approve persistent allowances (`approve`, `permit`, `permit2`), are **blocked directly in EVM bytecode**.
> 5. **Guardian Social Recovery**: Timelocked on-chain guardian recovery eliminates single-point-of-failure key loss without sacrificing non-custodial sovereignty.

---

### Question 2: "Which parts of your code have been produced during the Buildathon?"

> **During the Arbitrum Open House Singapore Buildathon, we produced the complete production-grade multi-chain architecture:**
> 1. **Arbitrum Smart Contract Deployment & Verification**:
>    - Deployed `PasskeyAccount` implementation (`0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3`) and `PasskeyAccountFactory` (`0x60319237e8dd2D661eBcF8E6933458BD78Ce146d`) to Arbitrum Sepolia.
>    - Benchmarked Arbitrum Nitro's native RIP-7212 precompile (`0x100`) verifying P-256 signatures in ~109,000 gas.
> 2. **On-Chain Policy Engine (`SpendPolicy.sol` & `SpendWindow.sol`)**:
>    - Developed calldata inspection engine for ERC-20 transfers and Uniswap V3 `SwapRouter02` swaps.
>    - Enforced recipient locking (`recipient == address(this)`) and anti-sandwich minimum slippage checks in EVM bytecode.
>    - Built 24-hour rolling rolling spend windows compliant with ERC-7562 opcode opacity rules.
> 3. **Paxos USDG Integration**:
>    - Integrated Paxos Global Dollar (USDG) into Haptix spending policies, configuration, and agent session builders on Arbitrum (`0x004B506865409877C9fA29bfb1ebA929984B9bbC` / `0xDDF7d873F5738c2A191624b1ba1Aba7042621E43`).
> 4. **Browser Extension & Cockpit DApp Simulator**:
>    - Built Manifest V3 Chrome Extension featuring biometric passkey enrollment and EIP-1193 injection.
>    - Engineered an obsidian-themed dApp cockpit simulator (`test-dapp.html`) testing `eth_requestAccounts`, `eth_sendTransaction`, `personal_sign`, and `wallet_switchEthereumChain`.
> 5. **Comprehensive Testing (293 Tests 100% Green)**:
>    - 17 Foundry test suites with 243 passing contract tests (fuzzing, red-team attack vectors, reentrancy audits).
>    - 10 Vitest suites with 50 passing TypeScript SDK tests (`@haptix/sdk`).

---

### Question 3: "Which sponsor/partner technologies have you used as part of your project?"

> - **Paxos / USDG (Global Dollar)**:  
>   *Usage*: Haptix natively supports Paxos USDG across Arbitrum Mainnet and Sepolia. Autonomous AI trading agents delegated through Haptix can manage and trade USDG within strict on-chain rolling limits, while any high-value transfers or unconstrained approvals trigger an automated escalation requiring 2-of-2 biometric passkey approval from the human owner.
>
> - **OpenZeppelin**:  
>   *Usage*: Utilized OpenZeppelin's audited smart contract foundations for ERC-1967/ERC-1167 proxy clones, safe arithmetic, and cryptographic primitives in `PasskeyAccountFactory.sol` and `PasskeyAccount.sol`.
>
> - **Arbitrum Nitro & Osaka RIP-7212 Precompile (`0x100`)**:  
>   *Usage*: Leveraged Arbitrum Nitro's native execution of secp256r1 verification via the `0x100` precompile, delivering high-speed biometric authentication at a fraction of standard L1 calldata costs.
>
> - **Alchemy & Pimlico**:  
>   *Usage*: Integrated ERC-4337 v0.7 bundler infrastructure and RPC endpoints for gas estimation and UserOperation submission.

---

## 4. Links & Deliverables Checklist

- [x] **Live GitHub Repository:** [https://github.com/ritesh59697/haptix](https://github.com/ritesh59697/haptix)
- [x] **Arbiscan Implementation Receipt:** [0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3](https://sepolia.arbiscan.io/address/0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3)
- [x] **Arbiscan Factory Receipt:** [0x60319237e8dd2D661eBcF8E6933458BD78Ce146d](https://sepolia.arbiscan.io/address/0x60319237e8dd2D661eBcF8E6933458BD78Ce146d)
- [x] **Technical Whitepaper / Proposal:** [GRANT_PROPOSAL.md](GRANT_PROPOSAL.md)
- [x] **Brand Assets & Screenshots:** [`assets/haptix_official_logo.jpg`](assets/haptix_official_logo.jpg)
- [x] **Test Results:** 243 Foundry tests passing (100%), 50 SDK tests passing (100%).
