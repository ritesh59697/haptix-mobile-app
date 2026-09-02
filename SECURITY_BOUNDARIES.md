# Haptix Security Boundaries & Production Trust Model

---

## 1. On-Chain Guarantees

The smart account architecture (`PasskeyAccount`, `SpendPolicy`, `SpendWindow`, `WebAuthn`) enforces the following invariants strictly in EVM bytecode:

1. **Compromised Agent Key Containment**:
   - An attacker holding an authorized `secp256k1` agent private key **cannot**:
     - Modify account signers, thresholds, windows, or agent session configurations (`onlySelf` boundary).
     - Execute calls targeting `address(this)`.
     - Execute any top-level call selector other than `executeByAgent` or `executeBatchByAgent`.
     - Modify, re-grant, or revoke agent sessions.
     - Bypass emergency panic `freeze()`.

2. **Strict Financial Limits & Escalation Ceilings**:
   - **Autonomous Per-Tx Cap**: Transfers/swaps where amount exceeds `session.perTxLimitEth` or `session.perTxLimitToken` are rejected unless signed by a 2-of-N hardware passkey quorum.
   - **Human Escalation Ceiling**: If `session.humanApprovalThreshold > 0`, any escalated operation where amount exceeds `humanApprovalThreshold` is rejected **even if accompanied by a 2-of-N passkey quorum**. Operations exceeding this ceiling must be executed directly via master passkey account execution.
   - **Rolling Window Accumulator**: Operations within an active window cannot exceed the configured per-asset `agentWindowCap`.

3. **Autonomous Approval & Permit Lockdown**:
   - Autonomous agents are strictly forbidden from calling:
     - `approve` (`0x095ea7b3`)
     - `increaseAllowance` (`0x39509351`)
     - `decreaseAllowance` (`0xa457c2d7`)
     - `setApprovalForAll` (`0xa22cb465`)
     - `permit` (EIP-2612 `0xd505accf`)
     - `permit` (DAI `0x8fcbaf0c`)
     - `Permit2` single/batch/transferFrom (`0x2b67b570`, `0x2a2b8275`, `0x30f28b7a`)
   - Autonomous agents cannot establish persistent on-chain allowances.

4. **DeFi Output Containment (Uniswap V3)**:
   - For `exactInputSingle` swaps on whitelisted routers:
     - `tokenIn` must be explicitly allowlisted in `agentAllowedTokens`.
     - `tokenOut` must be explicitly allowlisted in `agentAllowedTokens`.
     - `recipient` must strictly equal `address(this)` (the smart account).
     - `amountIn > 0` and `amountOutMinimum > 0` are strictly required for autonomous ops.
     - Native ETH `value` must be 0 for token swaps.

5. **Batch Atomicity & Aggregate Summation**:
   - `executeBatchByAgent` calculates the aggregate sum across all calls in the batch per distinct asset before evaluating per-transaction limits or rolling window caps.
   - Splitting $100 into three $33 calls within a batch is evaluated as $99 against the per-transaction limit and rejected.

6. **Cryptographic Replay Resistance**:
   - `userOpHash` cryptographically binds `sender`, `nonce`, `initCode`, `callData`, `accountGasLimits`, `preVerificationGas`, `gasFees`, `paymasterAndData`, `entryPoint`, and `block.chainid`.
   - Hardware passkey signatures (`WebAuthn.verify`) require `FLAG_USER_VERIFIED (0x04)` (biometric / PIN) and strictly ascending, non-duplicate signer IDs (`ids[i] < ids[i+1]`).

---

## 2. Off-Chain Trust Assumptions

The on-chain policy engine relies on the following off-chain systems operating faithfully within their domain:

1. **AI Agent Off-Chain Quoting & Slippage Engine**:
   - The on-chain contract enforces `amountOutMinimum > 0` to block zero-slippage sandwich attacks, but does not query an on-chain oracle during validation (to comply with ERC-7562 STO-021).
   - **Assumption**: The agent's off-chain runtime or execution solver calculates a tight `amountOutMinimum` based on live RPC liquidity quotes (e.g. max 0.5% – 1% slippage).

2. **Frontend Token Decimal Translation**:
   - The on-chain contract enforces limits in **token base units** (e.g., 6 decimals for USDC, 8 for WBTC, 18 for DAI/ETH).
   - **Assumption**: The client application converts human-entered fiat/USD values into exact token base units using `tokenDecimals` stored on-chain.

3. **Secure Hardware Authenticator Enclave**:
   - WebAuthn P-256 private keys are stored in secure hardware (Apple Secure Enclave, Android Keystore, YubiKey FIDO2).
   - **Assumption**: The physical device hardware and operating system browser WebAuthn API correctly protect private key extraction.

---

## 3. User Responsibilities

1. **Session Scope Configuration**:
   - The user must only allowlist trusted protocols (e.g. Uniswap V3 SwapRouter02) and verified token contracts.
   - Granting session permissions to an untrusted or malicious contract could allow that contract's logic to execute within the bounded limit.

2. **Setting Realistic Ceilings**:
   - The user should configure `perTxLimitToken` for autonomous daily operations and `humanApprovalThreshold` as a strict upper ceiling for escalated operations.

3. **Revocation on Agent Compromise**:
   - If the user suspects their AI agent's infrastructure or host environment has been compromised, they should invoke `revokeAgentSession` or trigger emergency `freeze()`.

---

## 4. Agent Responsibilities

1. **Private Key Storage**:
   - The AI agent runtime must safeguard its `secp256k1` session private key in a secure enclave, KMS, or isolated environment.

2. **Pre-Execution Quoting & Simulation**:
   - The agent must simulate UserOperations off-chain via `eth_estimateUserOperationGas` and ensure valid routing before dispatching to the bundler.

3. **Escalation Notification**:
   - When an intended action exceeds `perTxLimit`, the agent must present the constructed `PackedUserOperation` hash to the user for WebAuthn biometric authorization.

---

## 5. Bundler & Paymaster Trust Model

1. **ERC-7562 Validation Compliance**:
   - `validateUserOp` executes in constant time with bounded loops (`MAX_PRICED_BATCH = 16`, `MAX_PRICED_ASSETS = 16`), consuming ~100k–220k gas.
   - Validation performs zero banned opcodes (`TIMESTAMP`, `NUMBER`) and accesses only the account's own storage slots (STO-010).

2. **Paymaster Sponsoring**:
   - If `trustedPaymaster` is set, only that specific paymaster address can sponsor operations. If `trustedPaymaster == address(0)`, any standard ERC-4337 paymaster may sponsor gas.

3. **Bundle Collision on Account Storage**:
   - Because `SpendWindow` updates storage during execution, multiple UserOperations from the same account in a single bundle will conflict on the window storage slot. Bundlers sequence multiple ops across consecutive blocks.

---

## 6. Known Economic & Operational Risks

1. **Sub-Threshold Loss on Agent Compromise**:
   - If an agent's private key is fully compromised, the attacker can extract funds up to the pre-authorized `perTxLimitToken` and cumulative rolling `agentWindowCap`. Loss cannot exceed these parameters.

2. **MEV Sandwiching within Slippage**:
   - If an agent sets a loose `amountOutMinimum` (e.g. 10% slippage), searchers in public mempools can extract value up to that 10% bound.

3. **Fee-on-Transfer / Rebasing Tokens**:
   - Fee-on-transfer tokens deduct fees at the token layer; the smart account accounts for the gross `amount` transferred.
   - Rebasing tokens adjust balances dynamically; transfers are bounded by the nominal token amount specified in `transfer()`.

---

## 7. Unsupported Protocols (V1 Fail-Closed Policy)

1. **ERC-721 / ERC-1155 NFTs**:
   - Autonomous agent transfers and approvals (`safeTransferFrom`, `setApprovalForAll`) fail closed and require human passkey escalation.

2. **Multi-Hop Swaps (`exactInput` with Path Calldata)**:
   - Multi-hop path calldata decoding is not supported in V1; autonomous swaps must use `exactInputSingle`.

3. **Generic Lending / Borrowing Protocols**:
   - Direct deposit/borrow/repay selectors on Aave/Compound require human passkey escalation in V1.

4. **Arbitrary Delegatecalls**:
   - The account does not expose `delegatecall` primitives to agents or single-signers.
