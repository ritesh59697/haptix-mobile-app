# Moove Developer Program: Haptix Integration Plan & Grant Proposal

> **Target Program**: [Moove Developer Fund ($100,000)](https://www.moove.xyz/news/moovexyz-launches-100000-moove-developer-fund-to-drive-agentic-payments)  
> **Grant Request**: Up to $10,000 in USDC (Non-dilutive, Milestone-based)  
> **Official Application Form**: [Microsoft Forms Link](https://forms.cloud.microsoft/r/fZ0Z7xsDuh)  
> **Status**: Ready to Submit  

---

## 1. Executive Summary

**Haptix** is the Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents. Built as an ERC-4337 smart account architecture on Base, Haptix enforces on-chain spending policies authorized by WebAuthn hardware passkeys (Touch ID, Face ID, YubiKey) verified via the RIP-7212 precompile.

### The Winning Thesis for Moove
**Moove Agentic Payments** provides the multi-chain settlement rails (37+ blockchains, 16,000+ tokens) allowing AI agents and web apps to transact seamlessly. However, the #1 bottleneck facing autonomous agentic payments today is **risk and custody**:
- If an agent holds raw private keys, a single prompt injection or software exploit drains the treasury.
- If a human must approve every micro-transaction, autonomy is destroyed.

**Haptix provides the missing security layer for Moove:**
1. **Zero-Prompt Autonomous Spending:** AI agents use scoped session keys to automatically discover and settle Moove Payment Links under pre-authorized daily budgets.
2. **Biometric Hardware Escalation:** If a Moove checkout link exceeds the agent's autonomous limit, the transaction reverts on-chain and triggers a hardware biometric passkey prompt (Touch ID) on the user's personal device.

---

## 2. Architecture: Haptix x Moove

```
                      +------------------------------------------+
                      |         Moove Payment Link / API         |
                      |   (e.g., 37 Chains / 16,000+ Assets)    |
                      +------------------------------------------+
                                           |
                                           v
                      +------------------------------------------+
                      |           Autonomous AI Agent            |
                      |   Equipped with Haptix Scoped Key        |
                      +------------------------------------------+
                                           |
                                           v
                      +------------------------------------------+
                      |    Haptix ERC-4337 Smart Account        |
                      |          (Base Sepolia Live)             |
                      +------------------------------------------+
                                           |
                     +---------------------+---------------------+
                     |                                           |
        [Within Rolling Budget]                         [Exceeds Ceiling]
                     |                                           |
                     v                                           v
     +-------------------------------+           +-------------------------------+
     | Autonomous On-Chain UserOp    |           |  On-Chain Revert (AA24)       |
     | Zero Passkey Prompts Needed   |           |  Escalates to Biometric Quorum|
     | Moove Link Settled Instantly  |           |  (Touch ID / P-256 Passkey)   |
     +-------------------------------+           +-------------------------------+
```

---

## 3. Scope of Work & Technical Deliverables

### A. Moove API Client (`sdk/src/moove/`)
- TypeScript integration for Moove's live REST API (`https://api.moove.xyz/v1/payment-link`).
- Support for generating dynamic payment links (`POST /v1/payment-link`) and checking settlement state (`GET /v1/payment-link/{id}`).
- Scoped API key integration via environment variables (`MOOVE_API_KEY`).

### B. Agentic Purchasing Engine (`scripts/moove-agent.ts`)
- An autonomous buyer script extending Haptix's existing `demo:agent` runner:
  1. Ingests a Moove payment link (or merchant order).
  2. Parses target amount and token denomination.
  3. Checks local policy against Haptix's on-chain session allowance.
  4. Dispatches an ERC-4337 `UserOperation` to settle the payment link.
  5. If payment > threshold, gracefully halts and outputs a WebAuthn challenge link for the user to sign with Touch ID.

### C. Webhook & Merchant Reconciliation Service
- Express/Next.js webhook receiver for Moove payment settlement events.
- Emits real-time SSE / WebSocket updates to the Haptix Web Dashboard when an agent finishes an autonomous checkout.

### D. Interactive Web Demonstration
- Interactive visual interface in `web/` where users can:
  - Configure autonomous daily spending limits for their Moove-enabled agent.
  - Watch the agent pay mock and live Moove payment links in real-time with zero prompts.
  - Test a high-value purchase and observe the Touch ID prompt pop up for hardware approval.

---

## 4. Proposed Milestone Roadmap ($10,000 Total)

The Moove Developer Fund releases capital in tranches against verified milestones. Here is our proposed breakdown:

| Milestone | Deliverables | Target Timeline | Tranche Amount |
|---|---|---|---|
| **Milestone 1: Core API & Agent Integration** | • Moove TypeScript API client integrated into Haptix SDK<br>• CLI demo script (`npm run demo:moove`) executing autonomous UserOps to settle Moove links<br>• Open-source GitHub PR & unit tests | 2–3 Weeks | **$3,000 USDC** |
| **Milestone 2: Security Firewall & Escalation Flow** | • On-chain policy firewall integration (rejection proof on over-budget Moove links)<br>• WebAuthn biometric fallback prompt UI for escalated payments<br>• Moove webhook reconciliation service | 3–4 Weeks | **$3,500 USDC** |
| **Milestone 3: Production Showcase & Community Release** | • End-to-end interactive web UI deployed on Base Sepolia / Mainnet<br>• Technical documentation & tutorial blog post on building safe agentic payments<br>• Co-marketing launch across Moove and Base builder ecosystems | 2–3 Weeks | **$3,500 USDC** |

---

## 5. Ready-to-Submit Application Form Answers

Use these prepared responses when filling out the [Official Moove Application Form](https://forms.cloud.microsoft/r/fZ0Z7xsDuh):

### 1. Project / Team Name
> **Haptix**

### 2. Contact Email & Telegram / Discord Handle
> *[Insert your email and Telegram handle, e.g., @ritesh...]*

### 3. Your Moove Handle (`@handle`)
> *[Insert your registered handle from moove.xyz, e.g., @haptix or @ritesh]*

### 4. Project Link / GitHub Repository
> `https://github.com/ritesh59697/haptix` (or your active repository link)

### 5. Brief Description of What You Are Building
> Haptix is the Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents. It is a live ERC-4337 smart account system on Base Sepolia verified via the RIP-7212 P-256 precompile. Haptix enables autonomous AI agents to transact on-chain with scoped session keys while enforcing hardware-backed spending ceilings authorized by WebAuthn passkeys (Apple Touch ID, Face ID, Secure Enclave).

### 6. Which Moove Agentic Payments features will you integrate, and how?
> We are integrating the Moove Payment Link API and Moove Receive Agent to power safe, autonomous agentic commerce. 
> 
> Currently, users are hesitant to let AI agents make autonomous purchases due to fear of treasury drains or prompt injection. By combining Haptix with Moove:
> 1. AI agents use Haptix scoped session keys to autonomously settle Moove Payment Links across 37+ chains and 16,000+ assets with zero user friction—as long as the payment is within the daily spending ceiling.
> 2. If a Moove checkout exceeds the pre-authorized budget, Haptix's on-chain policy firewall automatically halts the transaction and triggers a hardware Touch ID passkey prompt on the user's device.
> 
> We are also building a merchant service agent that issues Moove payment links dynamically and sweeps revenue into a multi-passkey protected smart account.

### 7. What is your development roadmap and proposed milestones?
> - **Milestone 1 ($3,000 USDC):** Moove API Client integration + CLI Agent Runner (`npm run demo:moove`) executing autonomous settlement of Moove payment links on Base Sepolia.
> - **Milestone 2 ($3,500 USDC):** Hardware policy firewall enforcement + WebAuthn biometric escalation UI for over-limit Moove checkouts + Webhook settlement listeners.
> - **Milestone 3 ($3,500 USDC):** Public interactive web application, open-source SDK release, comprehensive developer documentation, and live co-marketing launch.

### 8. Project Stage
> **Prototype / Testnet Live** (Smart contracts, 243 Foundry test suites, Base Sepolia deployments, and TypeScript SDK are already fully functional).

---

## 6. Pre-Submission Checklist

- [ ] Visit [moove.xyz](https://www.moove.xyz) and claim a Moove Handle (`@yourname`).
- [ ] Visit [moove.xyz/dashboard/api-keys](https://www.moove.xyz/dashboard/api-keys) and generate an API key with `Moove Receive Agent` scope.
- [ ] Fill out the [Official Application Form](https://forms.cloud.microsoft/r/fZ0Z7xsDuh) using the answers above.
- [ ] Schedule/attend the short onboarding call with the Moove founding team.
- [ ] Execute Milestone 1 upon confirmation.
