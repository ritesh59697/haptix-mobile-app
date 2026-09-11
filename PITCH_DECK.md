# Haptix — Pitch Deck

> **The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents**  
> *Seedless Human Security. Unhackable AI Agent Delegation.*

---

## Slide 1: Title & Elevator Pitch

<div align="center">

# HAPTIX
### The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents

**Unhackable on-chain delegation. Seedless biometric passkeys. Zero-trust AI execution.**

*Base Sepolia · ERC-4337 v0.7 · Osaka RIP-7212 Precompile (`0x100`)*

</div>

> **Presenter Notes:**  
> "Haptix solves the single biggest blocker facing on-chain AI agents today: how do you let autonomous agents execute DeFi trades without giving them the keys to drain your entire wallet? We combine Apple/Android biometric hardware passkeys with an on-chain smart contract firewall to make agent delegation truly safe."

---

## Slide 2: The Problem

### "The Hot-Key Dilemma: AI Agents Are Walking Targets"

```
   TODAY'S BROKEN PARADIGM:
   
   +--------------------+      Exposes Unprotected     +----------------------+
   | AI Trading Bot /   | ---------------------------> | Unbounded Hot Key    | ===> TOTAL DRAIN
   | Autonomous Agent   |      Private Key in Memory   | Full Wallet Custody  |      ON COMPROMISE
   +--------------------+                              +----------------------+
```

1. **AI Agents Hold Raw Hot Keys**:
   * On-chain AI agents (trading bots, arbitrage bots, liquidity rebalancers) store raw `secp256k1` private keys in `.env` files, VPS memory, or cloud servers.
   * If the host server is compromised or an LLM suffers a prompt injection, **100% of user funds are instantly drained**.
2. **Client-Side 2FA is an Illusion**:
   * Software 2FA (SMS, authenticator apps, frontend popups) only lives in the wallet UI.
   * An attacker who extracts the private key talks directly to the public RPC node, completely bypassing the user interface.
3. **The UX Paradox**:
   * Seed phrases are terrible for humans.
   * But giving unconstrained private keys to autonomous AI bots is financial suicide.

> **Presenter Notes:**  
> "Autonomous AI agents are exploding onchain. But today, every bot developer faces an impossible choice: either require a human to sign every $5 swap (defeating autonomy), or give the bot full private key custody (risking catastrophic loss). If a bot gets hacked, the wallet is drained."

---

## Slide 3: The Solution

### "Haptix: Moving Enforcement into EVM Bytecode"

Haptix replaces hot private keys with a **smart account architecture** where security policies are enforced **on-chain inside `validateUserOp`**, not in a vulnerable web UI:

```
                      +------------------------------------------+
                      |         Incoming UserOperation           |
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

1. **Native Biometrics (WebAuthn P-256)**: Touch ID, Face ID, Android Keystore, and YubiKeys verify directly on-chain via Base's native Osaka RIP-7212 precompile (`0x100`) for **~109k gas** (no seed phrases).
2. **Scoped AI Agent Session Keys**: Agents receive temporary `secp256k1` keys bounded by time, protocols, tokens, and financial limits.
3. **Bytecode-Level Containment**: Even if an attacker steals the agent's private key, they **cannot** exceed spending limits, modify account signers, or steal assets.

---

## Slide 4: The 3-Tier Security Policy Model

### "Autonomy When You Want It. Biometrics When You Need It."

```
 Spend Amount ($)
      ^
      |   [TIER 3: BLOCKED ON-CHAIN] > $200
      |   ----------------------------------------------------------------------
      |   Hard Ceiling Revert: Immediate EVM Bytecode Rejection (Fails Closed)
      |
      |   [TIER 2: ESCALATED BIOMETRIC QUORUM] $50 - $200
      |   ----------------------------------------------------------------------
      |   Agent Key + 2-of-2 Hardware Touch ID Passkey Quorum Required
      |
      |   [TIER 1: FULLY AUTONOMOUS MICRO-EXECUTION] <= $50
      |   ----------------------------------------------------------------------
      |   Agent Signs Autonomously · 0 Human Friction · Rolling 24h Cap
      +------------------------------------------------------------------------> Time
```

* **Tier 1 — Autonomous ($< \$50)**: Daily micro-swaps, DCA orders, and arbitrage execute 24/7 without disturbing the user.
* **Tier 2 — Biometric Escalation ($\$50–\$200)**: If the bot finds a high-conviction trade exceeding $50, it sends a notification. The user taps Touch ID / Face ID to authorize the quorum.
* **Tier 3 — Hard Ceiling ($> \$200)**: Any transaction exceeding the maximum ceiling is **instantly rejected on-chain**, protecting the treasury even if the agent is fully compromised.
* **Anti-Drain Blanket**: Approvals (`approve`, `setApprovalForAll`) and gasless permits (`permit`, `permit2`) are **strictly blocked** for autonomous agents.

---

## Slide 5: The Product Suite

### "End-to-End Infrastructure: Contracts, SDK & Extension"

```
+-------------------------------------------------------------------------------+
|                             THE HAPTIX ECOSYSTEM                              |
+-----------------------+-------------------------------+-----------------------+
|  1. SMART ACCOUNT     |  2. TYPESCRIPT SDK            |  3. CHROME EXTENSION  |
|     (On-Chain Core)   |     (@haptix/sdk)             |     (Rabby-Grade UI)  |
|                       |                               |                       |
| - ERC-4337 v0.7       | - Agent Key Generation        | - Manifest V3         |
| - RIP-7212 (0x100)    | - Autonomous UserOp Builder   | - WebAuthn Enrollment |
| - 24h Spend Windows   | - Integer Slippage Calculator | - Policy Inspector    |
| - Guardian Recovery   | - Bundler RPC Dispatcher      | - Side Panel & Popout |
| - Anti-Drain Blanket  | - Recovery Client Helpers     | - 100% Inline SVGs    |
+-----------------------+-------------------------------+-----------------------+
```

1. **`PasskeyAccount.sol`**: Immutable, counterfactual smart account with zero external dependencies during validation.
2. **`@haptix/sdk`**: Clean, type-safe developer SDK for bot builders (ElizaOS, LangChain, Goat SDK) to spin up bounded agents in 3 lines of code.
3. **Chrome Web Extension**: Clean obsidian-dark wallet with biometric hardware enrollment and real-time transaction risk analysis.

---

## Slide 6: Technical Moat & Breakthroughs

### "Engineered for ERC-7562 & EVM Reality"

| Engineering Challenge | How Everyone Else Fails | The Haptix Breakthrough |
|---|---|---|
| **Curve P-256 Gas Cost** | Standard EVM curve verification costs ~380k–400k gas. | Uses native **Osaka RIP-7212 precompile (`0x100`)** on Base for ultra-low **~109k gas** validation. |
| **ERC-7562 Mempool Rules** | Querying `TIMESTAMP` in validation causes public bundlers to ban and drop UserOps. | Uses EntryPoint `validUntil` / `validAfter` time range intersection in `SpendWindow.sol` (**zero banned opcodes**). |
| **DEX Sandwich Attacks** | Bot slippage is vulnerable to MEV searcher exploitation in public mempools. | On-chain Uniswap V3 parser strictly enforces `amountOutMinimum > 0` and locks `recipient == address(this)`. |
| **Permanent Device Loss** | Losing physical hardware passkeys permanently locks pure WebAuthn smart wallets. | **Timelocked Guardian Social Recovery** with fast-path 1-signature emergency cancellation. |
| **Zero SLOAD Decimals** | Querying token decimals during validation introduces external storage reads. | Explicit decimal registration at config time; validation evaluates raw base units directly. |

---

## Slide 7: Market Opportunity & "Why Now?"

### "The Convergence of Three Multi-Billion Dollar Megatrends"

```
                         +-----------------------------------+
                         |   1. THE AUTONOMOUS AI ECONOMY    |
                         |   $100B+ projected onchain agent  |
                         |   transactions by 2030            |
                         +-----------------+-----------------+
                                           |
                                           v
+------------------------------------+           +------------------------------------+
| 2. ACCOUNT ABSTRACTION (ERC-4337)  | <-------> | 3. BASE & L2 MASS ADOPTION         |
| 15M+ smart accounts deployed;      |  HAPTIX   | Sub-cent fees + native RIP-7212    |
| seed phrases being phased out      |           | precompiles for hardware keys      |
+------------------------------------+           +------------------------------------+
```

* **Why Now?**
  * **EIP-7212 / RIP-7212** is now live on Base and L2s. Hardware passkeys are finally fast and cheap.
  * **AI Agents are going onchain** in droves (trading bots, DeFAI protocols, automated yield strategies).
  * **Security is the missing link**: Without scoped hardware delegation, institutional capital and everyday users cannot safely fund AI agents.

---

## Slide 8: Competitive Matrix

### "Haptix vs. Existing Wallet & Delegation Solutions"

| Feature / Capability | MetaMask / EOA | Safe (Gnosis) | Privy / Dynamic | Biconomy / ZeroDev | **HAPTIX** |
|---|:---:|:---:|:---:|:---:|:---:|
| **Hardware Biometric Passkeys (P-256)** | ❌ | ❌ | ⚠️ Cloud MPC | ⚠️ Plugin | **✅ Native RIP-7212** |
| **Autonomous AI Agent Session Keys** | ❌ | ⚠️ Complex Module | ❌ | ✅ | **✅ Native Built-in** |
| **On-Chain Biometric Escalation Ceiling** | ❌ | ❌ | ❌ | ❌ | **✅ Yes ($50–$200)** |
| **Hard On-Chain Ceiling Revert** | ❌ | ❌ | ❌ | ⚠️ | **✅ Direct in EVM** |
| **Anti-Drain Approval Blanket** | ❌ | ❌ | ❌ | ❌ | **✅ Enforced On-Chain** |
| **ERC-7562 Compliant Rolling Budget** | ❌ | ❌ | ❌ | ⚠️ | **✅ Native SpendWindow** |
| **Timelocked Guardian Social Recovery** | ❌ | ⚠️ Multi-sig | ⚠️ Email/Social | ⚠️ Module | **✅ Yes (1-Sig Cancel)** |

---

## Slide 9: Traction & Verifiable Receipts

### "Not an Idea. Shipped & Verified On-Chain."

<div align="center">

| Metric | Achievement |
|---|---|
| **Test Coverage** | **291 Total Tests Passing (100%)** · 241 Foundry + 50 Vitest |
| **Red-Team Security** | 256 fuzz runs, reentrancy guards, array offset & malleability tests |
| **Live Network** | **Base Sepolia (Chain ID: 84532)** |
| **Live Smart Account** | [`0xB01543453cF31052c769d79e9C755E3b035d796f`](https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f) |
| **Verified Biometric UserOp** | [Tx `0x5c4c413d…404d`](https://sepolia.basescan.org/tx/0x5c4c413d486754cf8098d4ca4dd2f82a17a72aabc9680174a0bc583bffeb404d) (Touch ID Biometric Signature) |
| **Verified Extension UserOp** | [Tx `0x428fe58b…1d11`](https://sepolia.basescan.org/tx/0x428fe58b08360238c33bfc6a92264e977283aab0b05965d3abe0f034b5d21d11) (EIP-1193 dApp Simulator) |
| **Packaging Status** | Chrome Web Store ZIP packaged (`dist/haptix-extension-v1.0.0.zip`) |

</div>

> **Presenter Notes:**  
> "We don't pitch theoretical roadmaps. Haptix has 291 passing automated tests, live verified on-chain transactions using real Apple Touch ID hardware passkeys, and a completed Chrome extension ready for store release."

---

## Slide 10: Business Model & Value Capture

### "How Haptix Monetizes the On-Chain Agent Economy"

```
[1. BUNDLER & PAYMASTER MARGINS]
Earn transaction fee spread on sponsored ERC-4337 UserOperations dispatched by agents.

[2. ENTERPRISE POLICY SDK]
B2B SaaS / SDK licensing for hedge funds, prop shops, and DAO treasuries managing autonomous bot fleets.

[3. DELEGATION PROTOCOL AS A SERVICE]
Plug-and-play middleware for AI frameworks (ElizaOS, Virtuals, LangChain) with rev-share on execution volume.
```

1. **Transaction & Gas Sponsorship Margins**: Micro-fee spread on gas sponsorship pools and high-frequency agent bundles.
2. **Developer & Protocol Tier**: Enterprise SDK access for trading firms running 100+ concurrent autonomous bots with custom on-chain risk guardrails.
3. **Ecosystem Grants & Superchain Alignment**: Foundation grant support from Base, Optimism, and Arbitrum to drive ecosystem TVL and transaction counts.

---

## Slide 11: Roadmap & Milestones

### "Path to Mainnet and Ecosystem Integration"

```
Q1 2026: PROTOCOL HARDENING (COMPLETED)
  [x] ERC-4337 v0.7 + RIP-7212 (0x100) Core Architecture
  [x] 3-Tier Policy Engine & 24h Rolling Budget Windows
  [x] Timelocked Guardian Social Recovery Module
  [x] 291 Automated Tests (Foundry + Vitest) & Live Base Sepolia Verification

Q2 2026: AUDIT & MAINNET LAUNCH (CURRENT FOCUS)
  [ ] Tier-1 External Smart Contract Security Audit (Spearbit / Cantina / Code4rena)
  [ ] Base Mainnet & Optimism Mainnet Deployment
  [ ] Chrome Web Store Public Release (Developer Dashboard Upload)
  [ ] Production Bundler & Paymaster Gas Sponsorship Pool

Q3 2026: AI AGENT FRAMEWORK INTEGRATIONS
  [ ] Official ElizaOS & Goat SDK Plugins
  [ ] Multi-Chain Expansion (Arbitrum One, Zora, Mode)
  [ ] Institutional Multi-Agent Dashboard & Fleet Management
```

---

## Slide 12: The Ask & Use of Funds

### "Ecosystem Grant / Pre-Seed Target: $50,000"

<div align="center">

```
+---------------------------------------------------------------+
|                      USE OF FUNDS ALLOCATION                  |
+-----------------------------+-----------+---------------------+
| Category                    | Amount    | Percentage          |
+-----------------------------+-----------+---------------------+
| External Security Audit     | $25,000   | 50%                 |
| Mainnet Paymaster Gas Tank  | $15,000   | 30%                 |
| Developer Tools & AI Plugins| $10,000   | 20%                 |
+-----------------------------+-----------+---------------------+
| TOTAL                       | $50,000   | 100%                |
+-----------------------------+-----------+---------------------+
```

</div>

* **Primary Deliverable**: Taking Haptix from Base Sepolia to a fully audited, production-safe Base Mainnet deployment with sponsored gas for the first 10,000 user/agent transactions.
* **Return on Investment for Grantor**: Drives real on-chain transaction volume, advances RIP-7212 precompile adoption, and establishes the gold-standard security framework for AI agents on Base.

---

## Slide 13: Team & Contact

### "Building the Future of Autonomous On-Chain Security"

<div align="center">

### **HAPTIX PROTOCOL**
**The Biometric Hardware Enclave Layer for EVM & AI Agents**

* **Founder & Core Engineer:** Ritesh
* **GitHub:** [github.com/ritesh59697/haptix](https://github.com/ritesh59697/haptix)
* **Smart Account (Base Sepolia):** [`0xB015...796f`](https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f)
* **License:** Open Source MIT

---

### *Let's make autonomous on-chain finance safe.*

</div>
