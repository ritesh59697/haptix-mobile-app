import {
  type Address,
  type Hex,
  isAddressEqual,
  sliceHex
} from 'viem';
import {
  SELECTORS,
  NATIVE_ETH_ADDRESS
} from './constants.js';
import type { AgentSessionConfig } from './types.js';

export interface PolicyValidationResult {
  valid: boolean;
  requiresEscalation: boolean;
  reason?: string;
  token?: Address;
  tokenAmount?: bigint;
  ethAmount?: bigint;
}

/**
 * Validates a single agent call locally before constructing/submitting a UserOperation.
 * Fails closed if any security rule is breached.
 */
export function validateAgentSingleCall(
  config: AgentSessionConfig,
  target: Address,
  value: bigint,
  calldata: Hex,
  currentTimeSec: number = Math.floor(Date.now() / 1000)
): PolicyValidationResult {
  // 1. Session Expiry Check
  if (currentTimeSec < config.validAfter) {
    return { valid: false, requiresEscalation: false, reason: 'Session is not yet valid' };
  }
  if (currentTimeSec > config.validUntil) {
    return { valid: false, requiresEscalation: false, reason: 'Session has expired' };
  }

  // 2. Plain ETH transfer
  if (calldata === '0x' || calldata.length <= 2) {
    const isEthAllowed = config.allowedTokens.some(t => isAddressEqual(t, NATIVE_ETH_ADDRESS));
    if (!isEthAllowed) {
      return { valid: false, requiresEscalation: false, reason: 'ETH is not in allowedTokens' };
    }
    const isProtocolAllowed = config.allowedProtocols.some(p => isAddressEqual(p, target));
    if (!isProtocolAllowed) {
      return { valid: false, requiresEscalation: false, reason: 'Target is not in allowedProtocols' };
    }

    if (value === 0n) {
      return { valid: false, requiresEscalation: false, reason: 'Zero-value ETH transfer is invalid' };
    }

    if (value > config.perTxLimitEth) {
      if (config.humanApprovalThreshold > 0n && value > config.humanApprovalThreshold) {
        return {
          valid: false,
          requiresEscalation: false,
          reason: `Value (${value}) exceeds humanApprovalThreshold ceiling (${config.humanApprovalThreshold})`
        };
      }
      return {
        valid: true,
        requiresEscalation: true,
        reason: 'Value exceeds autonomous perTxLimitEth; requires passkey escalation',
        ethAmount: value
      };
    }

    return { valid: true, requiresEscalation: false, ethAmount: value };
  }

  // 3. Extract 4-byte selector
  if (calldata.length < 10) {
    return { valid: false, requiresEscalation: false, reason: 'Calldata too short (< 4 bytes)' };
  }
  const selector = sliceHex(calldata, 0, 4);

  // 4. Blocked Approval and Permit selectors
  const blockedSelectors = [
    SELECTORS.APPROVE,
    SELECTORS.INCREASE_ALLOWANCE,
    SELECTORS.DECREASE_ALLOWANCE,
    SELECTORS.SET_APPROVAL_FOR_ALL,
    SELECTORS.PERMIT,
    SELECTORS.PERMIT_DAI,
    SELECTORS.PERMIT2_PERMIT,
    SELECTORS.PERMIT2_PERMIT_BATCH,
    SELECTORS.PERMIT2_TRANSFER_FROM
  ];
  if (blockedSelectors.some(s => s.toLowerCase() === selector.toLowerCase())) {
    return {
      valid: false,
      requiresEscalation: false,
      reason: `Security Lockdown: Autonomous agents cannot call approval/permit selector ${selector}`
    };
  }

  // 5. ERC-20 transfer
  if (selector.toLowerCase() === SELECTORS.TRANSFER.toLowerCase()) {
    if (value > 0n) {
      return { valid: false, requiresEscalation: false, reason: 'Native ETH value attached to ERC-20 transfer' };
    }
    if (calldata.length < 138) { // 4 bytes sel + 32 bytes recipient + 32 bytes amount
      return { valid: false, requiresEscalation: false, reason: 'Malformed ERC-20 transfer calldata' };
    }

    const isTokenAllowed = config.allowedTokens.some(t => isAddressEqual(t, target));
    if (!isTokenAllowed) {
      return { valid: false, requiresEscalation: false, reason: `Token ${target} is not in allowedTokens` };
    }

    const recipientHex = ('0x' + calldata.slice(34, 74)) as Address;
    const isRecipientAllowed = config.allowedProtocols.some(p => isAddressEqual(p, recipientHex));
    if (!isRecipientAllowed) {
      return { valid: false, requiresEscalation: false, reason: `Recipient ${recipientHex} is not in allowedProtocols` };
    }

    const amountHex = ('0x' + calldata.slice(74, 138)) as Hex;
    const amount = BigInt(amountHex);

    if (amount === 0n) {
      return { valid: false, requiresEscalation: false, reason: 'Zero-amount ERC-20 transfer is rejected' };
    }

    if (amount > config.perTxLimitToken) {
      if (config.humanApprovalThreshold > 0n && amount > config.humanApprovalThreshold) {
        return {
          valid: false,
          requiresEscalation: false,
          reason: `Amount (${amount}) exceeds humanApprovalThreshold ceiling (${config.humanApprovalThreshold})`
        };
      }
      return {
        valid: true,
        requiresEscalation: true,
        reason: 'Amount exceeds autonomous perTxLimitToken; requires passkey escalation',
        token: target,
        tokenAmount: amount
      };
    }

    return { valid: true, requiresEscalation: false, token: target, tokenAmount: amount };
  }

  // 6. Uniswap V3 Swap
  if (
    selector.toLowerCase() === SELECTORS.UNISWAP_V3_EXACT_INPUT_SINGLE.toLowerCase() ||
    selector.toLowerCase() === SELECTORS.UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1.toLowerCase()
  ) {
    if (value > 0n) {
      return { valid: false, requiresEscalation: false, reason: 'Native ETH attached to Uniswap V3 swap' };
    }

    const isRouterAllowed = config.allowedProtocols.some(p => isAddressEqual(p, target));
    if (!isRouterAllowed) {
      return { valid: false, requiresEscalation: false, reason: `Router ${target} is not in allowedProtocols` };
    }

    return { valid: true, requiresEscalation: false };
  }

  // 7. Generic whitelisted protocol call
  const isTargetAllowed = config.allowedProtocols.some(p => isAddressEqual(p, target));
  if (isTargetAllowed) {
    return {
      valid: true,
      requiresEscalation: true,
      reason: 'Generic contract call requires human passkey escalation'
    };
  }

  return { valid: false, requiresEscalation: false, reason: `Target ${target} is not allowlisted` };
}
