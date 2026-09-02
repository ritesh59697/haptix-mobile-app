import type { Hex, Address } from 'viem';

/**
 * Canonical ERC-4337 v0.7 EntryPoint Address across supported EVM networks.
 */
export const CANONICAL_ENTRYPOINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/**
 * Native ETH representation (address zero).
 */
export const NATIVE_ETH_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Signature Dispatch Encodings in PasskeyAccount.sol:
 * 0x00: Standard Passkey Owner Quorum
 * 0x01: Autonomous Agent ECDSA Signature
 * 0x02: Escalated Agent ECDSA Signature + 2-of-N Hardware Passkey Quorum
 */
export const SIG_TYPE_PASSKEY_ONLY: number = 0x00;
export const SIG_TYPE_AGENT: number = 0x01;
export const SIG_TYPE_ESCALATED: number = 0x02;

/**
 * SECP256R1 (P-256) Curve Order for WebAuthn low-s normalization.
 */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/**
 * SECP256K1 Curve Order for agent signature low-s normalization.
 */
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Default slippage tolerance: 50 basis points (0.50%).
 */
export const DEFAULT_SLIPPAGE_BPS = 50n;

/**
 * Maximum permitted slippage tolerance: 500 basis points (5.00%).
 */
export const MAX_SLIPPAGE_BPS = 500n;

/**
 * Function Selectors derived from Solidity ABI.
 */
export const SELECTORS = {
  // PasskeyAccount Agent Management
  EXECUTE_BY_AGENT: '0xaea6adc6' as Hex,
  EXECUTE_BATCH_BY_AGENT: '0x115347f7' as Hex,
  GRANT_AGENT_SESSION: '0x5c433885' as Hex,
  REVOKE_AGENT_SESSION: '0x73f82346' as Hex,
  SET_AGENT_SELECTOR: '0x2bf99c96' as Hex,

  // ERC-20 Standard
  TRANSFER: '0xa9059cbb' as Hex,
  TRANSFER_FROM: '0x23b872dd' as Hex,
  APPROVE: '0x095ea7b3' as Hex,
  INCREASE_ALLOWANCE: '0x39509351' as Hex,
  DECREASE_ALLOWANCE: '0xa457c2d7' as Hex,

  // Uniswap V3 SwapRouters
  UNISWAP_V3_EXACT_INPUT_SINGLE: '0x04e45aaf' as Hex, // SwapRouter02
  UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1: '0x414bf389' as Hex, // SwapRouter01

  // ERC-721 / ERC-1155 NFT
  SAFE_TRANSFER_FROM: '0x42842e0e' as Hex,
  SET_APPROVAL_FOR_ALL: '0xa22cb465' as Hex,

  // Gasless Permits (Blocked for Autonomous Agents)
  PERMIT: '0xd505accf' as Hex,
  PERMIT_DAI: '0x8fcbaf0c' as Hex,
  PERMIT2_PERMIT: '0x2b67b570' as Hex,
  PERMIT2_PERMIT_BATCH: '0x2a2b8275' as Hex,
  PERMIT2_TRANSFER_FROM: '0x30f28b7a' as Hex
} as const;

/**
 * Standard Network Configurations.
 */
export const SUPPORTED_NETWORKS = {
  BASE_MAINNET: {
    chainId: 8453,
    name: 'Base',
    entryPoint: CANONICAL_ENTRYPOINT_V07,
    uniswapV3Router: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address, // SwapRouter02
    tokens: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, decimals: 6, symbol: 'USDC' },
      WETH: { address: '0x4200000000000000000000000000000000000006' as Address, decimals: 18, symbol: 'WETH' }
    }
  },
  BASE_SEPOLIA: {
    chainId: 84532,
    name: 'Base Sepolia',
    entryPoint: CANONICAL_ENTRYPOINT_V07,
    uniswapV3Router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as Address,
    tokens: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address, decimals: 6, symbol: 'USDC' },
      WETH: { address: '0x4200000000000000000000000000000000000006' as Address, decimals: 18, symbol: 'WETH' }
    }
  }
} as const;

/**
 * Standard ERC-4337 v0.7 EntryPoint Error Codes and Diagnostic Explanations
 */
export const ENTRYPOINT_ERRORS: Record<string, { code: string; title: string; hint: string }> = {
  AA10: { code: 'AA10', title: 'Sender already constructed', hint: 'InitCode was provided but account already exists on-chain.' },
  AA13: { code: 'AA13', title: 'InitCode failed or reverted', hint: 'The factory failed to deploy the account.' },
  AA14: { code: 'AA14', title: 'InitCode must return sender address', hint: 'The factory did not return the expected sender address.' },
  AA15: { code: 'AA15', title: 'InitCode must create sender', hint: 'After initCode execution, the sender address has no deployed bytecode.' },
  AA20: { code: 'AA20', title: 'Account not deployed', hint: 'Sender has no code and no initCode was provided.' },
  AA21: { code: 'AA21', title: "Didn't pay prefund", hint: 'The account has insufficient native ETH or EntryPoint deposit to cover the maximum gas cost.' },
  AA22: { code: 'AA22', title: 'Expired or not due', hint: 'The operation time-range (validUntil/validAfter) is not satisfied at the current block timestamp.' },
  AA23: { code: 'AA23', title: 'Reverted (or OOG)', hint: 'Account validation reverted inside validateUserOp (e.g. policy violation, unauthorized agent, or invalid parameters).' },
  AA24: { code: 'AA24', title: 'Signature error', hint: 'The signature could not be verified, is malformed, or curve verification failed.' },
  AA25: { code: 'AA25', title: 'Invalid account nonce', hint: 'The UserOperation nonce does not match the EntryPoint nonce sequence.' },
  AA31: { code: 'AA31', title: 'Paymaster deposit too low', hint: 'The paymaster has insufficient deposit in EntryPoint to sponsor gas.' },
  AA32: { code: 'AA32', title: 'Paymaster expired or not due', hint: 'Paymaster validation time-range expired.' },
  AA33: { code: 'AA33', title: 'Paymaster reverted', hint: 'Paymaster validation logic reverted.' },
  AA34: { code: 'AA34', title: 'Paymaster signature error', hint: 'Paymaster signature verification failed.' }
};

/**
 * Standard ERC-4337 Bundler JSON-RPC Error Codes
 */
export const BUNDLER_RPC_ERRORS: Record<number, string> = {
  [-32602]: 'Invalid method parameters',
  [-32500]: 'Transaction rejected by bundler rules or simulation validation',
  [-32501]: 'ExtCodeHash or opcode rule violation during ERC-7562 simulation',
  [-32502]: 'Paymaster / Account reputation or stake too low',
  [-32503]: 'UserOperation out of time-range (validUntil expired)',
  [-32504]: 'Bundler throttling: too many operations from this entity',
  [-32505]: 'Paymaster deposit too low for requested gas limits',
  [-32506]: 'Unsupported EntryPoint version',
  [-32507]: 'UserOperation rejected: existing op in mempool cannot be replaced (fee bump too low)'
};

