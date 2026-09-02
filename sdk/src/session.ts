import {
  type Address,
  type Hex,
  encodeFunctionData,
  isAddress,
  isAddressEqual
} from 'viem';
import { SELECTORS, NATIVE_ETH_ADDRESS } from './constants.js';
import type { AgentSessionConfig } from './types.js';

const GRANT_SESSION_ABI = [
  {
    type: 'function',
    name: 'grantAgentSession',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'agentKey', type: 'address' },
          { name: 'validAfter', type: 'uint48' },
          { name: 'validUntil', type: 'uint48' },
          { name: 'humanApprovalThreshold', type: 'uint256' },
          { name: 'perTxLimitEth', type: 'uint256' },
          { name: 'perTxLimitToken', type: 'uint256' },
          { name: 'windowDuration', type: 'uint256' },
          { name: 'allowedProtocols', type: 'address[]' },
          { name: 'allowedSelectors', type: 'bytes4[]' },
          { name: 'allowedTokens', type: 'address[]' },
          { name: 'tokenWindowCaps', type: 'uint256[]' }
        ]
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const;

const REVOKE_SESSION_ABI = [
  {
    type: 'function',
    name: 'revokeAgentSession',
    inputs: [{ name: 'agentKey', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const;

/**
 * Validates and normalizes session parameters before encoding.
 */
export function validateSessionConfig(config: AgentSessionConfig): void {
  if (!isAddress(config.agentKey) || isAddressEqual(config.agentKey, NATIVE_ETH_ADDRESS)) {
    throw new Error('Invalid agentKey: must be a valid non-zero EVM address');
  }

  if (config.validUntil <= config.validAfter) {
    throw new Error(`Invalid session duration: validUntil (${config.validUntil}) must be strictly greater than validAfter (${config.validAfter})`);
  }

  if (config.windowDuration <= 0n) {
    throw new Error('Invalid windowDuration: must be greater than 0 seconds');
  }

  if (config.allowedProtocols.length !== config.allowedSelectors.length) {
    throw new Error(
      `Array length mismatch: allowedProtocols (${config.allowedProtocols.length}) must match allowedSelectors (${config.allowedSelectors.length})`
    );
  }

  if (config.allowedTokens.length !== config.tokenWindowCaps.length) {
    throw new Error(
      `Array length mismatch: allowedTokens (${config.allowedTokens.length}) must match tokenWindowCaps (${config.tokenWindowCaps.length})`
    );
  }

  // Validate addresses
  for (const protocol of config.allowedProtocols) {
    if (!isAddress(protocol)) {
      throw new Error(`Invalid protocol address in allowlist: ${protocol}`);
    }
  }

  for (const token of config.allowedTokens) {
    if (!isAddress(token)) {
      throw new Error(`Invalid token address in allowlist: ${token}`);
    }
  }
}

/**
 * Encodes the calldata for grantAgentSession(config).
 */
export function encodeGrantAgentSessionCall(config: AgentSessionConfig): Hex {
  validateSessionConfig(config);

  return encodeFunctionData({
    abi: GRANT_SESSION_ABI,
    functionName: 'grantAgentSession',
    args: [
      {
        agentKey: config.agentKey,
        validAfter: config.validAfter,
        validUntil: config.validUntil,
        humanApprovalThreshold: config.humanApprovalThreshold,
        perTxLimitEth: config.perTxLimitEth,
        perTxLimitToken: config.perTxLimitToken,
        windowDuration: config.windowDuration,
        allowedProtocols: config.allowedProtocols,
        allowedSelectors: config.allowedSelectors,
        allowedTokens: config.allowedTokens,
        tokenWindowCaps: config.tokenWindowCaps
      }
    ]
  });
}

/**
 * Encodes the calldata for revokeAgentSession(agentKey).
 */
export function encodeRevokeAgentSessionCall(agentKey: Address): Hex {
  if (!isAddress(agentKey) || isAddressEqual(agentKey, NATIVE_ETH_ADDRESS)) {
    throw new Error('Invalid agentKey: must be a valid non-zero EVM address');
  }

  return encodeFunctionData({
    abi: REVOKE_SESSION_ABI,
    functionName: 'revokeAgentSession',
    args: [agentKey]
  });
}
