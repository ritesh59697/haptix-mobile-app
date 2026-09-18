# Circle Developer Grants & Arc Microgrants — Application Kit

> **Primary Focus Area:** Agentic Economic Activity (Autonomous AI Agents)  
> **Blockchain:** Arc (Circle's Layer-1 Blockchain, Native USDC Gas)  
> **Project Name:** Haptix Protocol (`passkey-wallet`)  
> **Tagline:** The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents  
> **GitHub Repository:** [https://github.com/ritesh59697/haptix](https://github.com/ritesh59697/haptix)  

---

## 1. Quick Program Comparison

| Program | Grant Value | Platform | Link | Strategy |
|---|---|---|---|---|
| **Arc Microgrants** | **$500 USDC** (20 grants) | DoraHacks | [DoraHacks Portal](https://dorahacks.io/hackathon/arc-microgrants/detail#arc-microgrants) | Fast proof of deployment, rolling reviews through Oct 14. |
| **Circle Developer Grants** | **$5,000 to $100,000 USDC** | Circle Portal | [Circle Grants](https://www.circle.com/grant) | Milestone-based funding, technical mentorship, Circle Ventures referral. |

---

## 2. Live On-Chain Receipts (Arc Testnet)

| Contract | Address | ArcScan Explorer Link |
|---|---|---|
| **PasskeyAccount Implementation** | `0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3` | [View on ArcScan](https://testnet.arcscan.app/address/0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3) |
| **PasskeyAccountFactory** | `0x60319237e8dd2D661eBcF8E6933458BD78Ce146d` | [View on ArcScan](https://testnet.arcscan.app/address/0x60319237e8dd2D661eBcF8E6933458BD78Ce146d) |
| **Implementation Deploy Tx** | `0xb132a12b4171fce54b7e02e3d9dac596d1e62299b5a728d2b24ff56cbdd07923` | [View Tx](https://testnet.arcscan.app/tx/0xb132a12b4171fce54b7e02e3d9dac596d1e62299b5a728d2b24ff56cbdd07923) |
| **Factory Deploy Tx** | `0xfb49b60c72b721d1ddcd47d37c2e0a47aacc523e28b082261e7b9d1ec2fa92a4` | [View Tx](https://testnet.arcscan.app/tx/0xfb49b60c72b721d1ddcd47d37c2e0a47aacc523e28b082261e7b9d1ec2fa92a4) |
| **Canonical EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | [View on ArcScan](https://testnet.arcscan.app/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) |

---

## 3. DoraHacks Arc Microgrants Form Answers

### Project Title
`Haptix Protocol — Biometric Enclave & Policy Firewall for Autonomous AI Agents`

### Project One-Liner
`An ERC-4337 smart account architecture on Arc enforcing on-chain spending policy guardrails for autonomous AI agents with hardware biometric passkey quorum.`

### Short Description (Why Arc?)
> Haptix brings WebAuthn biometric security (Apple Touch ID, Face ID, Windows Hello) and autonomous AI agent session keys to Arc.
>
> Because Arc uses native USDC for gas fees, it represents the ideal settlement layer for autonomous AI trading agents and automated micro-solvers. However, giving AI agents unconstrained private keys in VPS memory or `.env` files is an existential security hazard.
>
> Haptix solves this directly in EVM bytecode on Arc:
> 1. **Autonomous Micro-Actions**: AI agents hold scoped session keys and can execute micro-payments and DCA swaps autonomously with zero human friction.
> 2. **Hardware Biometric Escalation**: Any transfer or swap exceeding configured limits automatically requires a 2-of-2 hardware passkey quorum from the human owner.
> 3. **Fail-Closed Policy Firewall**: Unconstrained token approvals and transactions exceeding the maximum ceiling are permanently blocked at the smart contract level.

### Live Deployment Link
`https://testnet.arcscan.app/address/0x60319237e8dd2D661eBcF8E6933458BD78Ce146d`

### GitHub Repository
`https://github.com/ritesh59697/haptix`

---

## 4. Circle Developer Grants Form Answers ($5k–$100k)

### Track Selection
**Agentic Economic Activity**  
*(Circle Description: "Enable autonomous AI agents to coordinate, contract, and settle value in real time with programmable, stablecoin-native infrastructure.")*

### Executive Pitch
> Haptix is the non-custodial biometric hardware enclave and spending policy layer for autonomous AI agents on Arc.
>
> With Arc's sub-second finality and native USDC gas asset, autonomous agents will conduct high-frequency micro-settlements, portfolio rebalancing, and decentralized service subscriptions. Today, agent developers either rely on centralized custody APIs or expose full-custody private keys in cloud runtimes.
>
> Haptix provides a native on-chain policy firewall:
> - Scoped session keys with hard per-transaction thresholds and 24h rolling windows.
> - Hardware enclave escalation: high-value transactions demand a 2-of-2 WebAuthn passkey quorum from the human principal before execution.
> - Pre-built integration with Circle Developer Platform (Wallets, CCTP, Gateway).

### Proposed Grant Milestones ($50,000 Total)

| Milestone | Deliverables | Target Timeline | Amount |
|---|---|:---:|:---:|
| **Milestone 1: Smart Contract Security Audit & Hardening** | External audit of `PasskeyAccount.sol`, `SpendPolicy.sol`, and `SpendWindow.sol`. Formal verification of spend window calculations. | Month 1–2 | $20,000 USDC |
| **Milestone 2: Arc Mainnet Canonical Deployment & AI SDKs** | Deploy factory and canonical accounts to Arc Mainnet. Ship ElizaOS, LangChain, and Virtuals Agent plugins for 1-click Haptix agent deployment. | Month 3 | $15,000 USDC |
| **Milestone 3: Chrome Web Store Extension & Developer Hub** | Launch official Haptix Chrome Extension on Chrome Web Store. Ship developer documentation portal for agentic USDC payments. | Month 4 | $15,000 USDC |
