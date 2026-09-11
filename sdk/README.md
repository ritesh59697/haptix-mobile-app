# @haptix/sdk

Production TypeScript SDK for **Haptix** — the on-chain authorization and delegation engine enabling users to delegate bounded financial authority to autonomous AI agents via ERC-4337 smart accounts and WebAuthn hardware passkeys.

---

## 1. Features

- **Agent Key Management**: Generate, import, and manage `secp256k1` session keys with low-s normalization.
- **Session Configuration**: Construct, validate, and encode `grantAgentSession` and `revokeAgentSession` UserOps.
- **ERC-4337 v0.7 Compatible**: Native support for `PackedUserOperation` packing, hashing, and bundler RPC dispatch.
- **2-Tier Authorization**:
  - `sigType 0x01`: Autonomous operations ($\le$ per-tx limit).
  - `sigType 0x02`: Escalated operations ($>$ per-tx limit $\le$ human approval ceiling) with 2-of-N WebAuthn passkey quorum.
- **Off-Chain Slippage Guard**: Quoting and integer-based `calculateAmountOutMinimum` to prevent MEV sandwiching.
- **Offline Pre-Flight Validator**: Fail-closed client validation for allowed protocols, selectors, tokens, rolling limits, and blocked approval calls.
- **Guardian Social Recovery**: Helpers for encoding timelocked guardian proposals, completions, fast-path single-sig emergency cancellations, and querying on-chain status.
- **Browser Passkey Client**: WebAuthn P-256 assertion parser and DER low-s normalizer.

---

## 2. Installation

```bash
npm install @haptix/sdk viem
```

---

## 3. Quickstart

### 3.1. Generating an Agent Key & Initializing Client

```typescript
import {
  HaptixAccountClient,
  generateAgentKey,
  CANONICAL_ENTRYPOINT_V07,
  parseTokenAmount
} from '@haptix/sdk';

// 1. Generate autonomous agent session key
const agent = generateAgentKey();
console.log('Agent Address:', agent.address);

// 2. Initialize smart account client
const client = new HaptixAccountClient({
  accountAddress: '0x34Aeb3A39fd1838D1C897F879EAB0a258507802c',
  chainId: 84532, // Base Sepolia
  entryPoint: CANONICAL_ENTRYPOINT_V07,
  bundlerUrl: 'https://api.pimlico.io/v2/84532/rpc?apikey=YOUR_API_KEY',
  agentPrivateKey: agent.privateKey
});
```

### 3.2. Submitting an Autonomous ERC-20 Transfer

```typescript
// 30 USDC transfer (under the autonomous $50 limit)
const usdcToken = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const recipient = '0x1234567890123456789012345678901234567890';
const amount = parseTokenAmount('30', 6);

// Build UserOperation
const userOp = client.buildTransferUserOp({
  tokenAddress: usdcToken,
  recipient,
  amount,
  gasParams: {
    verificationGasLimit: 150000n,
    callGasLimit: 60000n,
    preVerificationGas: 50000n,
    maxPriorityFeePerGas: 50000000n,
    maxFeePerGas: 200000000n
  }
});

// Sign autonomously with agent private key
const signedOp = await client.signAutonomousUserOp(userOp);

// Dispatch to bundler and await on-chain receipt
const receipt = await client.sendUserOpAndWait(signedOp);
console.log('UserOperation Executed! Tx Hash:', receipt.receipt.transactionHash);
```

### 3.3. Submitting an Autonomous Uniswap V3 Swap

```typescript
import { calculateAmountOutMinimum } from '@haptix/sdk';

const router = '0x2626664c2603336E57B271c5C0b26F421741e481';
const wethToken = '0x4200000000000000000000000000000000000006';

const amountIn = parseTokenAmount('40', 6); // 40 USDC
const quotedOut = parseTokenAmount('0.015', 18); // 0.015 WETH from quote
const amountOutMinimum = calculateAmountOutMinimum(quotedOut, 50n); // 0.5% slippage

const swapUserOp = client.buildSwapUserOp({
  routerAddress: router,
  swapParams: {
    tokenIn: usdcToken,
    tokenOut: wethToken,
    fee: 3000,
    recipient: client.accountAddress, // Locked to account
    amountIn,
    amountOutMinimum
  },
  gasParams: {
    verificationGasLimit: 200000n,
    callGasLimit: 120000n,
    preVerificationGas: 60000n,
    maxPriorityFeePerGas: 50000000n,
    maxFeePerGas: 200000000n
  }
});

const signedSwapOp = await client.signAutonomousUserOp(swapUserOp);
const swapReceipt = await client.sendUserOpAndWait(signedSwapOp);
```

---

## 4. Architecture & Security Boundaries

Refer to [SECURITY_BOUNDARIES.md](../SECURITY_BOUNDARIES.md) for full formal specifications of:
- On-chain invariants vs off-chain trust assumptions.
- Fail-closed rules for persistent allowances, unapproved protocols, and NFT approvals.
- Ceiling limits on human escalation.
