<div align="center">
  <img src="assets/haptix_official_logo.jpg" alt="Haptix Logo" width="720px" style="border-radius: 14px; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);" />
  <p><strong>The Biometric Hardware Enclave Layer for EVM & Autonomous AI Agents.</strong></p>
</div>

An ERC-4337 smart account architecture that enforces **autonomous spending policies on-chain**, authorized by **WebAuthn passkeys** (P-256 / secp256r1), verified through the RIP-7212 hardware precompile on Base, and featuring **scoped session key delegation for AI agents** with hardware-enforced escalation ceilings.

---

## Live on Base Sepolia

| Parameter | Value |
|---|---|
| **Live Smart Account** | [`0xB01543453cF31052c769d79e9C755E3b035d796f`](https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f) |
| **Canonical EntryPoint** | [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://sepolia.basescan.org/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) (ERC-4337 v0.7) |
| **RIP-7212 Precompile** | `0x0000000000000000000000000000000000000100` (P-256 Curve Verification) |
| **Enrolled Hardware Signers** | 2 Hardware Passkeys (Touch ID Apple Secure Enclave & Chrome Profile / iCloud Keychain) |
| **Verified Tx 1 (Direct WebApp)** | [`0x5c4c413d…404d`](https://sepolia.basescan.org/tx/0x5c4c413d486754cf8098d4ca4dd2f82a17a72aabc9680174a0bc583bffeb404d) — Live Touch ID Biometric UserOp |
| **Verified Tx 2 (Extension dApp)** | [`0x428fe58b…1d11`](https://sepolia.basescan.org/tx/0x428fe58b08360238c33bfc6a92264e977283aab0b05965d3abe0f034b5d21d11) — EIP-1193 dApp Simulator via Enclave Signer |
| **Autonomous Agent Delegation** | `0x01` scoped ECDSA session key with on-chain firewall ($50 limit, $200 ceiling) |
| **Base Sepolia USDC** | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) (6 decimals) |
| **On-Chain Policy Engine** | 0.01 ETH / 25 USDC per-op threshold · 24h rolling budget · Emergency Panic Freeze |

---

## Quick Start

### 1. Clone & Run Smart Contract Tests
```bash
git clone --recurse-submodules https://github.com/ritesh59697/haptix.git
cd haptix
forge test -vv
```
*(All 220 Foundry tests pass using real WebCrypto P-256 vectors against the Osaka RIP-7212 precompile).*

### 2. Run the TypeScript SDK Tests
```bash
cd sdk
npm install
npm test
```
*(All 40 SDK tests pass across 8 test suites).*

### 3. Launch the Local Web Dashboard
```bash
npx serve web -l 5199
```
Open [http://localhost:5199](http://localhost:5199) in Chrome to access the biometric passkey dashboard and AI delegation simulator.

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
| Uniswap V3 Swaps (Escalated Agent) | 1 Agent Key + 2 Passkeys ($50 - $200) |
| Configuration Changes (`setWindow`, `addSigner`, `revokeAgent`) | **2 Passkeys via `onlySelf`** |
| Emergency Freeze (`setEmergencyFreeze`) | 1 Enrolled Signer (Fast-path panic) |
| Unfreeze (`setEmergencyFreeze(false)`) | **2 Passkeys (Quorum)** |

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
│   ├── PasskeyAccount.sol         Smart Account, validation logic & agent session execution
│   ├── PasskeyAccountFactory.sol  Deterministic CREATE2 counterfactual factory
│   ├── SpendPolicy.sol            Calldata parser & DeFi swap policy classifier
│   ├── SpendWindow.sol            ERC-7562 compliant 24h rolling budget accounting
│   └── WebAuthn.sol               P-256 WebAuthn verification via RIP-7212 (0x100)
├── sdk/                           @haptix/sdk TypeScript library
│   ├── src/                       Account, passkey, session, policy & bundler modules
│   └── test/                      Vitest test suites (40 tests passing)
├── extension/                     Production Manifest V3 Chrome Extension
│   ├── icons/                     Official high-res icons (16px, 48px, 128px, 512px)
│   ├── popup.html / popup.js      Main wallet UI & interactive drawers
│   ├── sidepanel.html             Chrome side panel interface
│   └── background.js              Service worker & RPC request broker
├── test/                          Foundry test suites (220 tests passing)
│   ├── AgentIntegration.t.sol     End-to-end agent session execution & lifecycle
│   ├── AgentSecurity.t.sol        Security invariant checks & escalation thresholds
│   ├── AgentRedTeamAudit.t.sol    Adversarial attacks (reentrancy, calldata fuzzing)
│   ├── RealPasskey.t.sol          Live Touch ID & WebAuthn hardware signatures
│   └── BatchPolicy.t.sol          Batch execution pricing & bypass prevention
├── examples/
│   └── agent-runner.ts            Headless AI agent daemon runner
├── script/
│   └── Deploy.s.sol               Base Sepolia on-chain broadcast script
└── web/                           Interactive web dashboard & delegation simulator
```

---

## Comprehensive Test Matrix (260 Total Tests)

```
Ran 15 Foundry test suites: 220 tests passed, 0 failed, 0 skipped
Ran 8 Vitest SDK suites:     40 tests passed, 0 failed, 0 skipped
================================================================
TOTAL:                       260 tests passed, 0 failed (100%)
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
