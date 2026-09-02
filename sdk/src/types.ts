import type { Address, Hex } from 'viem';

/**
 * ERC-4337 v0.7 PackedUserOperation definition.
 */
export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex; // bytes32: (verificationGasLimit << 128) | callGasLimit
  preVerificationGas: bigint;
  gasFees: Hex; // bytes32: (maxPriorityFeePerGas << 128) | maxFeePerGas
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * Unpacked Gas and Fee parameters for UserOperation construction.
 */
export interface UserOperationGasParams {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
}

/**
 * On-chain Session Configuration matching PasskeyAccount.SessionConfig.
 */
export interface AgentSessionConfig {
  agentKey: Address;
  validAfter: number; // uint48 timestamp
  validUntil: number; // uint48 timestamp
  humanApprovalThreshold: bigint; // Max cap for human escalation (0 = unlimited up to window)
  perTxLimitEth: bigint; // Autonomous per-tx limit for native ETH
  perTxLimitToken: bigint; // Autonomous per-tx limit for ERC-20 tokens
  windowDuration: bigint; // Duration of rolling spend window in seconds
  allowedProtocols: Address[];
  allowedSelectors: Hex[];
  allowedTokens: Address[];
  tokenWindowCaps: bigint[];
}

/**
 * Stored session state matching PasskeyAccount.AgentSession.
 */
export interface AgentSessionState {
  validAfter: number;
  validUntil: number;
  isRegistered: boolean;
  revoked: boolean;
  humanApprovalThreshold: bigint;
  perTxLimitEth: bigint;
  perTxLimitToken: bigint;
  windowSeconds: bigint;
}

/**
 * WebAuthn P-256 Public Key (Uncompressed x, y coordinates).
 */
export interface WebAuthnPublicKey {
  x: bigint;
  y: bigint;
}

/**
 * WebAuthn Signature struct matching WebAuthn.sol.
 */
export interface WebAuthnSignature {
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeIndex: bigint;
  typeIndex: bigint;
  r: bigint;
  s: bigint;
}

/**
 * Uniswap V3 exactInputSingle Parameters.
 */
export interface UniswapV3SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number; // uint24 (e.g. 500, 3000, 10000)
  recipient: Address; // Must equal smart account address
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

/**
 * Swap Quote with explicit slippage protection.
 */
export interface SwapQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  quotedAmountOut: bigint;
  amountOutMinimum: bigint;
  slippageBps: bigint;
  timestamp: number;
  routerAddress: Address;
  fee: number;
}

/**
 * Token Metadata.
 */
export interface TokenMetadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Bundler RPC UserOperation Receipt.
 */
export interface UserOperationReceipt {
  userOpHash: Hex;
  entryPoint: Address;
  sender: Address;
  nonce: bigint;
  paymaster?: Address;
  actualGasCost: bigint;
  actualGasUsed: bigint;
  success: boolean;
  reason?: string;
  receipt: {
    transactionHash: Hex;
    blockNumber: bigint;
    blockHash: Hex;
    from: Address;
    to: Address;
  };
}

/**
 * Bundler RPC UserOperation details by hash.
 */
export interface UserOperationByHash {
  userOperation: PackedUserOperation;
  entryPoint: Address;
  transactionHash?: Hex;
  blockNumber?: bigint;
  blockHash?: Hex;
}
