<div align="center">
  <img src="assets/haptix_official_logo.jpg" alt="Haptix Logo" width="720px" style="border-radius: 14px; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);" />
  <p><strong>The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents.</strong></p>
</div>

An ERC-4337 smart account architecture that enforces **autonomous spending policies on-chain**, authorized by **WebAuthn passkeys** (P-256 / secp256r1), verified through the RIP-7212 hardware precompile on Base, and featuring **scoped session key delegation for AI agents** with hardware-enforced escalation ceilings.

---

## Live Deployments & Receipts

### Base Sepolia (Chain ID: `84532`)

| Parameter | Value |
|---|---|
| **Live Smart Account** | [`0xB01543453cF31052c769d79e9C755E3b035d796f`](https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f) |
| **PasskeyAccountFactory** | [`0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b`](https://sepolia.basescan.org/address/0x1bB7cCf96cB211045982fC8a0069D9C0d718B83b) |
| **PasskeyAccount Implementation** | [`0x9B553dF98bbC1c7152698c4739A93281F0FBB110`](https://sepolia.basescan.org/address/0x9B553dF98bbC1c7152698c4739A93281F0FBB110) |
| **Canonical EntryPoint** | [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://sepolia.basescan.org/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) (ERC-4337 v0.7) |
| **RIP-7212 Precompile** | `0x0000000000000000000000000000000000000100` (P-256 Curve Verification) |
| **Enrolled Hardware Signers** | 2 Hardware Passkeys (Touch ID Apple Secure Enclave & iCloud Keychain / Chrome Profile) |
| **Verified Tx 1 (Session Grant 2-of-2 Passkeys)** | [`0x1aa7d520…2ccb`](https://sepolia.basescan.org/tx/0x1aa7d520a4f74e5ec84f4c51cd00402b898e33f3c1bf04277bbaebc824dd2ccb) (Block 46457789) — Live 2-of-2 Passkey Quorum Session Delegation |
| **Verified Tx 2 (Autonomous AI Agent UserOp)** | [`0x4ca3ea90…5840`](https://sepolia.basescan.org/tx/0x4ca3ea90dfa75ceef593c381a75b6cab9e36188fc03db26ccf064e2ca9785840) (Block 46457806) — Live Execution with **Zero Passkey Prompts** |
| **Verified Tx 3 (Autonomous Demo Run)** | [`0xa5130be0…055d`](https://sepolia.basescan.org/tx/0xa5130be0e01acb26176cf87f6776c52877360ecc06872df8b67042517b49055d) — Verified Clean Autonomous Agent UserOp |
| **Verified Tx 4 (Direct WebApp Biometric)** | [`0x5c4c413d…404d`](https://sepolia.basescan.org/tx/0x5c4c413d486754cf8098d4ca4dd2f82a17a72aabc9680174a0bc583bffeb404d) — Live Touch ID Biometric UserOp |
| **Verified Tx 5 (Extension dApp Simulator)** | [`0x428fe58b…1d11`](https://sepolia.basescan.org/tx/0x428fe58b08360238c33bfc6a92264e977283aab0b05965d3abe0f034b5d21d11) — EIP-1193 dApp Simulator via Enclave Signer |
| **Live Policy Enforcement Proof** | 0.005 ETH over-limit transfer rejected on-chain: `SIG_VALIDATION_FAILED (1)` & EntryPoint `AA24` |
| **Active Session Key Address** | [`0x093F8575a87cdb2919E5B3f1677eD8d7815c9461`](https://sepolia.basescan.org/address/0x093F8575a87cdb2919E5B3f1677eD8d7815c9461) (0.001 ETH limit, active on-chain) |
| **Base Sepolia USDC** | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) (6 decimals) |
| **On-Chain Policy Engine** | 0.001 ETH per-op session limit · 24h rolling budget · Emergency Panic Freeze · Timelocked Guardian Recovery |

### Arbitrum Sepolia (Chain ID: `421614`)

| Parameter | Value |
|---|---|
| **PasskeyAccountFactory** | [`0x60319237e8dd2D661eBcF8E6933458BD78Ce146d`](https://sepolia.arbiscan.io/address/0x60319237e8dd2D661eBcF8E6933458BD78Ce146d) |
| **Factory Deployment Tx** | [`0xe2acbad9d20e1cdfbb9b4a0a329684ab92727dc904025974f9e0a5c23b98cda0`](https://sepolia.arbiscan.io/tx/0xe2acbad9d20e1cdfbb9b4a0a329684ab92727dc904025974f9e0a5c23b98cda0) |
| **PasskeyAccount Implementation** | [`0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3`](https://sepolia.arbiscan.io/address/0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3) |
| **Implementation Deployment Tx** | [`0xe87b7b21a1da1837304e0156418a29f5ef6765f93a3fc7b09f6fb7ae39988f10`](https://sepolia.arbiscan.io/tx/0xe87b7b21a1da1837304e0156418a29f5ef6765f93a3fc7b09f6fb7ae39988f10) |
| **Canonical EntryPoint** | [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://sepolia.arbiscan.io/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) (ERC-4337 v0.7) |
| **RIP-7212 Precompile** | `0x0000000000000000000000000000000000000100` (Native Arbitrum Nitro P-256 Curve Verification) |
| **Arbitrum Sepolia USDC** | [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/address/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d) (6 decimals) |
| **Paxos Global Dollar (USDG)** | [`0xDDF7d873F5738c2A191624b1ba1Aba7042621E43`](https://sepolia.arbiscan.io/address/0xDDF7d873F5738c2A191624b1ba1Aba7042621E43) (6 decimals) · Mainnet: [`0x004B506865409877C9fA29bfb1ebA929984B9bbC`](https://arbiscan.io/address/0x004B506865409877C9fA29bfb1ebA929984B9bbC) |

### Arc Testnet (Chain ID: `5042002`)

| Parameter | Value |
|---|---|
| **PasskeyAccountFactory** | [`0x60319237e8dd2D661eBcF8E6933458BD78Ce146d`](https://testnet.arcscan.app/address/0x60319237e8dd2D661eBcF8E6933458BD78Ce146d) |
| **Factory Deployment Tx** | [`0xfb49b60c72b721d1ddcd47d37c2e0a47aacc523e28b082261e7b9d1ec2fa92a4`](https://testnet.arcscan.app/tx/0xfb49b60c72b721d1ddcd47d37c2e0a47aacc523e28b082261e7b9d1ec2fa92a4) |
| **PasskeyAccount Implementation** | [`0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3`](https://testnet.arcscan.app/address/0xd5e179970f8aBA0CB049b95c2A4D4dcC64F1a0A3) |
| **Implementation Deployment Tx** | [`0xb132a12b4171fce54b7e02e3d9dac596d1e62299b5a728d2b24ff56cbdd07923`](https://testnet.arcscan.app/tx/0xb132a12b4171fce54b7e02e3d9dac596d1e62299b5a728d2b24ff56cbdd07923) |
| **Canonical EntryPoint** | [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://testnet.arcscan.app/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) (ERC-4337 v0.7) |
| **Native Gas Currency** | **Native USDC** (18 decimals at protocol layer) |

---

## Quick Start & Demo Flow

### Run the Live Demo (3 Commands)

Demonstrate the complete live security lifecycle on Base Sepolia directly from the terminal:

```bash
# 1. Run the unified end-to-end security demo flow
npm run demo

# 2. Run standalone autonomous AI agent execution (Zero Passkey Prompts)
npm run demo:agent

# 3. Test on-chain policy enforcement (Over-limit rejection proof)
npm run demo:reject
```

### Run Full Test Suites

```bash
# Smart contract test suite (Osaka RIP-7212 precompile vectors)
forge test -vv

# TypeScript SDK test suite
npm run test:sdk
```
*(All 243 Foundry tests and 50 TypeScript SDK tests pass with 100% success rate).*

### Interactive Web UI

```bash
npx serve web -l 5199
```
Open [http://localhost:5199/grant-session.html](http://localhost:5199/grant-session.html) in your browser:
- **Phase 1 & 2**: Authorize an on-chain session with an interactive 2-of-2 hardware passkey quorum (Touch ID $\to$ iCloud Keychain).
- **Phase 3 Console**: 1-click **Run Autonomous Spend** (proves zero passkey prompts) & **Test Policy Firewall** (proves on-chain rejection).

### 4. Load the Chrome Extension
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the [`extension/`](extension/) directory.
4. Pin **Haptix** to your browser toolbar.

---

## Core Security Model: Moving Enforcement to Code

The instinct *"require a second factor for high-value transfers"* is universally correct. However, standard wallet implementations fail because a software private key has no login gate:
- An attacker who extracts a private key or seed phrase imports it directly into MetaMask or scripts a broadcast via public RPC.
- Software 2FA (TOTP, SMS) lives in the wallet client, which the attacker simply bypasses.

**Haptix moves enforcement to the smart contract itself:**
`validateUserOp` in `PasskeyAccount.sol` intercepts every operation before execution. If a transfer or DeFi swap exceeds the configured safety threshold, the contract will **revert on-chain** unless signed by a full 2-of-2 hardware passkey quorum.

```
                  +----------------------------------------------+
                  |         Incoming ERC-4337 UserOperation      |
                  +----------------------------------------------+
                                         |
                                         v
                         +-------------------------------+
                         |   validateUserOp (On-Chain)   |
                         +-------------------------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
              [Under Safe Limit]                  [Exceeds Threshold]
                       |                                   |
                       v                                   v
             +--------------------+              +--------------------+
             |  1-Sig Passkey     |              |  2-of-2 Hardware   |
             |  Touch ID / FaceID |              |  Passkey Quorum    |
             |  (~109k gas)       |              |  (Enclave + Key)   |
             +--------------------+              +--------------------+
                       |                                   |
                       +-----------------+-----------------+
                                         |
                                         v
                      +-------------------------------------+
                      |   RIP-7212 P-256 Precompile (0x100) |
                      +-------------------------------------+
                                         |
                                         v
                      +-------------------------------------+
                      |     execute() On-Chain Execution    |
                      +-------------------------------------+
```

---

## Phase 3: Autonomous AI Agent Delegation

Phase 3 introduces **autonomous session keys** (`executeByAgent` and `executeBatchByAgent`) allowing AI agents to interact with DeFi protocols without human intervention—until safety limits are breached.

### Signature Dispatch Encodings

| Encoding Byte | Authorization Mode | Description |
|---|---|---|
| `0x00` | **Passkey Owner Quorum** | Standard human operations. Requires 1 or 2 WebAuthn P-256 hardware signatures depending on value. |
| `0x01` | **Autonomous Agent** | Signed by the agent's ECDSA (`secp256k1`) session key. Strictly bounded by policy rules. |
| `0x02` | **Escalated Agent + Quorum** | Agent ECDSA signature **plus** 2-of-2 Hardware Passkey signatures for human authorization. |

### 3-Tier Security Policy Firewall

```
 Spend Amount
      ^
      |   [Tier 3: BLOCKED] > $200
      |   ------------------------------------------------------------
      |   Hard Ceiling Violation: Immediate Fail-Closed Revert
      |
      |   [Tier 2: ESCALATED] $50 - $200
      |   ------------------------------------------------------------
      |   Agent Signature + 2-of-2 Biometric Passkey Quorum (Touch ID)
      |
      |   [Tier 1: AUTONOMOUS] < $50
      |   ------------------------------------------------------------
      |   Agent Key Only: Instant On-Chain Micro-Execution
      +--------------------------------------------------------------> Time
```

1. **Tier 1 (Autonomous Micro-Execution <= $50)**:
   - The agent signs with its local session key (`0x01`).
   - Transaction executes autonomously on-chain without human prompting.
   - Spend accumulates in the agent's 24-hour rolling window.
2. **Tier 2 (Human Biometric Escalation $50 - $200)**:
   - Exceeds the autonomous limit but remains within the maximum authorized human ceiling.
   - The agent generates the UserOp and requests human approval.
   - The user authorizes the transaction using a **2-of-2 WebAuthn Passkey Quorum** (`0x02`).
3. **Tier 3 (Hard Ceiling Revert > $200)**:
   - Any transaction exceeding the maximum ceiling is **rejected immediately on-chain** (`AgentSpendExceedsLimit`), protecting the account even if the agent is compromised.

### Agent DeFi Safeguards
- **Selector Allowlist**: Agents can only execute approved function selectors (e.g. `exactInputSingle`).
- **Protocol Allowlist**: Execution restricted to audited protocols (e.g. Uniswap V3 SwapRouter02).
- **Recipient Lock**: Swap recipient is cryptographically validated to ensure funds return directly to the smart account.
- **Slippage Bounds**: Enforces on-chain minimum return parameters (`amountOutMinimum > 0`), preventing sandwich and MEV extraction attacks.
- **Anti-Drain Blanket**: Approvals (`approve`, `setApprovalForAll`) and gasless permits (`permit`, `permit2`) are **strictly forbidden** for autonomous agent calls.

---

## On-Chain Policy Specifications

The on-chain policy engine inspects calldata directly during ERC-4337 validation:

| Operation | Signatures Required |
|---|---|
| Native ETH below `threshold` (0.01 ETH) | 1 Passkey |
| Native ETH at or above `threshold` | 2 Passkeys (Quorum) |
| Whitelisted ERC-20 below token threshold ($25 USDC) | 1 Passkey |
| Whitelisted ERC-20 at or above threshold | 2 Passkeys (Quorum) |
| Unconfigured ERC-20 token | 2 Passkeys (Quorum) |
| Token Approvals (`approve`, `increaseAllowance`, `setApprovalForAll`) | **2 Passkeys Always** |
| Gasless Permits (`permit`, `permit2`) | **2 Passkeys Always** |
| Uniswap V3 Swaps (Autonomous Agent) | 1 Agent Key (Under $50) |
| Configuration Changes (`setWindow`, `addSigner`, `revokeAgent`) | **2 Passkeys via `onlySelf`** |
| Configure Guardian (`setGuardian`) | **2 Passkeys via `onlySelf`** |
| Initiate Recovery (`initiateRecovery`) | **Guardian** (Enforces min 2 signers & timelock) |
| Emergency Cancel Recovery (`cancelRecovery`) | **1 Passkey (Fast-path)** or Guardian |
| Complete Recovery (`completeRecovery`) | Anyone after timelock expires |
| Emergency Freeze (`freeze`) | 1 Enrolled Signer (Fast-path panic) |
| Unfreeze (`unfreeze`) | **2 Passkeys (Quorum)** |

### Timelocked Guardian Social Recovery
To eliminate the single-point-of-failure risk where a user loses physical hardware devices, `PasskeyAccount` features an on-chain **Guardian Recovery** mechanism:
- **Designation**: The owner configures a `guardian` address (cold wallet, trusted delegate, or multisig) and a security timelock (minimum 24h, default 48h) via a 2-of-2 passkey quorum.
- **Proposal**: If passkeys are lost, the guardian calls `initiateRecovery(PublicKey[] newSigners)`. The replacement set must strictly contain at least 2 distinct, valid P-256 keys.
- **Timelock Delay**: An on-chain timelock begins (`executeAfter = block.timestamp + timelock`). After expiry, `completeRecovery()` wipes old signers and installs the replacement set.
- **Fast-Path Dispute**: If an unauthorized recovery is initiated by a compromised guardian, the account owner can abort it immediately with a **single passkey signature UserOp** (`cancelRecovery`) or trigger emergency `freeze()`.

### Per-Asset Rolling Spend Windows (`SpendWindow.sol`)
To prevent "slow-drain" attacks (e.g. 20 consecutive $40 transfers), `SpendWindow` enforces cumulative spending caps over rolling 24-hour periods.

Because ERC-7562 opcode rules ban `TIMESTAMP` during ERC-4337 validation, `SpendWindow` leverages the EntryPoint's native time-range mechanism:
- If an op fits the remaining window: returns `validUntil = windowExpiry`.
- If an op exceeds the window: returns `validAfter = windowExpiry`, deferring execution until the window rolls over.
- A 2-of-2 hardware passkey quorum overrides the window, preventing account lockout in legitimate emergencies.

---

## TypeScript SDK (`@haptix/sdk`)

The repository includes a type-safe TypeScript SDK built on `viem` and `@simplewebauthn/browser`.

### Installation
```bash
cd sdk
npm install
npm run build
```

### Usage: Generating and Submitting an Autonomous Agent Op
```typescript
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { 
  PasskeyAccount, 
  AgentSessionManager, 
  CANONICAL_ENTRYPOINT_V07 
} from '@haptix/sdk';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org')
});

const agentAccount = privateKeyToAccount('0x...');

const account = new PasskeyAccount({
  address: '0x8ad53FB549707686c1D6484119Fb2D5842A83229',
  entryPoint: CANONICAL_ENTRYPOINT_V07,
  client: publicClient
});

const sessionManager = new AgentSessionManager(account, agentAccount);

// Build autonomous agent execution
const userOp = await sessionManager.buildAgentTransferOp({
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC
  recipient: '0xRecipientAddress...',
  amount: 20_000_000n // 20 USDC
});

console.log('Autonomous UserOp prepared with signature encoding 0x01:', userOp);
```

---

## Headless Autonomous Agent Bot (`examples/agent-runner.ts`)

A production demonstration of an autonomous trading bot operating against the deployed smart account:

```bash
npx tsx examples/agent-runner.ts
```

**Demonstrated Capabilities**:
1. **Autonomous Swap**: Executes a $20 USDC -> WETH swap signed solely by the agent key.
2. **Escalation Detection**: Triggers human approval when attempting a $120 USDC swap.
3. **Emergency Ceiling Rejection**: Fails closed and blocks execution if attempting a $350 USDC transaction.

---

## Chrome Browser Extension (`extension/`)

A Rabby-grade Web3 wallet extension providing biometric passkey authorization directly inside the browser.

### Key Features
- **Strict Anti-Slop UI**: Clean obsidian dark interface with 100% componentized inline SVGs (zero Unicode emojis).
- **Hardware Passkey Enrollment**: Direct WebAuthn integration with iCloud Keychain, Touch ID, Windows Hello, and YubiKeys.
- **Rabby-Style Desktop Mode**: Pop out to full widescreen via `popup.html?mode=desktop`.
- **Chrome Side Panel**: Dedicated sidebar monitoring via `chrome.sidePanel`.
- **Built-in Sheets**: Interactive drawers for Send, Receive (with QR code), and Settings (DApp permission management).
- **Real-Time Policy Risk Inspection**: Visual green/amber/red indicators detailing whether an approval requires 1 signature, 2 signatures, or is blocked.

---

## Repository Architecture

```
├── src/
│   ├── PasskeyAccount.sol         Smart Account, validation logic, agent sessions & guardian recovery
│   ├── PasskeyAccountFactory.sol  Deterministic CREATE2 counterfactual factory
│   ├── SpendPolicy.sol            Calldata parser & DeFi swap policy classifier
│   ├── SpendWindow.sol            ERC-7562 compliant 24h rolling budget accounting
│   └── WebAuthn.sol               P-256 WebAuthn verification via RIP-7212 (0x100)
├── sdk/                           @haptix/sdk TypeScript library
│   ├── src/                       Account, passkey, session, policy, recovery & bundler modules
│   └── test/                      Vitest test suites (50 tests passing)
├── extension/                     Production Manifest V3 Chrome Extension
│   ├── icons/                     Official high-res icons (16px, 48px, 128px, 512px)
│   ├── popup.html / popup.js      Main wallet UI & interactive drawers
│   ├── sidepanel.html             Chrome side panel interface
│   └── background.js              Service worker & RPC request broker
├── test/                          Foundry test suites (243 tests passing)
│   ├── AgentIntegration.t.sol     End-to-end agent session execution & lifecycle
│   ├── AgentSecurity.t.sol        Security invariant checks & escalation thresholds
│   ├── AgentRedTeamAudit.t.sol    Adversarial attacks (reentrancy, calldata fuzzing)
│   ├── Recovery.t.sol             Timelocked Guardian Social Recovery unit & adversarial tests
│   ├── RealPasskey.t.sol          Live Touch ID & WebAuthn hardware signatures
│   └── BatchPolicy.t.sol          Batch execution pricing & bypass prevention
├── scripts/
│   ├── demo-flow.mjs              Unified end-to-end demo flow runner (`npm run demo`)
│   ├── execute-autonomous-agent.mjs Standalone autonomous agent execution (`npm run demo:agent`)
│   ├── test-policy-violation.mjs  On-chain policy firewall rejection audit (`npm run demo:reject`)
│   └── package-extension.mjs      Chrome Web Store release packager (`npm run package:extension`)
├── examples/
│   └── agent-runner.ts            Headless AI agent daemon runner
├── script/
│   └── Deploy.s.sol               Base Sepolia on-chain broadcast script
├── GRANT_PROPOSAL.md              Submission-ready proposal for Base & Optimism grants
├── PITCH_DECK.md                  13-Slide presentation deck for grants & investors
├── PRIVACY_POLICY.md              Chrome Web Store compliant privacy policy
└── web/                           Interactive web dashboard & delegation simulator
```

---

## Comprehensive Test Matrix (293 Total Tests)

```
Ran 17 Foundry test suites: 243 tests passed, 0 failed, 0 skipped
Ran 10 Vitest SDK suites:    50 tests passed, 0 failed, 0 skipped
================================================================
TOTAL:                       293 tests passed, 0 failed (100%)
```

- **Cryptographic Ground Truth**: Every signature test exercises real secp256r1 and secp256k1 curves.
- **Fuzzing**: Calldata parser, batch aggregators, and rolling windows validated with 256 fuzz runs each.
- **Gas Benchmarks**: Single-signature Touch ID validation runs in **~109k gas** on Base Sepolia.

---

## Security Insights & Common Pitfalls

These are the real-world cryptographic edge cases tested and secured in this repository:

1. **The Authenticator Does Not Sign Raw Bytes**:
   It signs `sha256(authenticatorData || sha256(clientDataJSON))`. Verifying the raw challenge instead is the most common passkey bug—it passes in mocked environments, then fails against real Apple Secure Enclave / YubiKey hardware.
2. **Signature Malleability**:
   `(r, s)` and `(r, n - s)` are both cryptographically valid over the same curve message. The precompile accepts both. `PasskeyAccount` enforces canonical low-s normalization on-chain (`s <= n/2`) and rejects high-s malleability attacks (`test_Attack_HighS_Rejected`).
3. **The Precompile Requires `staticcall`**:
   On OP-stack nodes, `0x100` returns empty returndata when reached through a state-modifying call frame while still reporting success. `WebAuthn.sol` strictly enforces `staticcall`.
4. **Invalid Precompile Returns Empty, Not Zero**:
   The RIP-7212 precompile returns 32 bytes of `0x0000...0001` on success and **0 bytes** on failure. `abi.decode`-ing the failure case reverts.
5. **Configuring `onlySelf` Functions**:
   `setWindow`, `setTokenThreshold`, `addSigner`, `grantAgentSession`, and `revokeAgentSession` are strictly `onlySelf`. Reaching them requires wrapping the call in `execute(address(this), 0, calldata)` via an EntryPoint UserOp, backed by the 2-of-2 Hardware Passkey Quorum.

---

## Five Bugs Found & Fixed During Development

Recorded for posterity and security reference:

1. **Duplicate-Signer Check Ran After Cryptography** — Rejection cost 107k gas instead of 32k. An attacker could force the account to burn gas verifying keys that were always going to be discarded. *Fix*: Validate all signer IDs before executing precompile calls.
2. **Unguarded Calldata Slice** — `callData[36:68]` on truncated calls reverted inside `validateUserOp` instead of cleanly rejecting.
3. **`file://` Lacks `crypto.subtle`** — WebAuthn requires a secure context (`https://` or `http://localhost`).
4. **Empty Calldata Slice Conflated Two Meanings** — `_extractFunc` returned an empty slice both for "no inner calldata" and "ABI decoding failed", which could allow malformed calldata to masquerade as a zero-value ETH send. *Fix*: Return an explicit `decoded` boolean flag.
5. **Unconfigured Token Defaulting to Unlimited** — Treating unconfigured tokens as "no limit" would allow attackers to drain newly listed ERC-20s with 1 signature. *Fix*: Unconfigured tokens always fail safe and require a full 2-of-2 Hardware Passkey Quorum.

---

## License

MIT © 2026 Haptix Core Contributors.
