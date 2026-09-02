import { describe, it, expect } from 'vitest';
import { validateAgentSingleCall } from '../src/policy.js';
import { SELECTORS, NATIVE_ETH_ADDRESS } from '../src/constants.js';
import { encodeFunctionData } from 'viem';
import type { AgentSessionConfig } from '../src/types.js';

describe('Offline Policy & Limit Validator', () => {
  const allowedProtocol = '0x2222222222222222222222222222222222222222' as const;
  const allowedToken = '0x3333333333333333333333333333333333333333' as const;

  const config: AgentSessionConfig = {
    agentKey: '0x1111111111111111111111111111111111111111',
    validAfter: 1000,
    validUntil: 5000,
    humanApprovalThreshold: 200000000n, // $200
    perTxLimitEth: 50000000000000000n, // 0.05 ETH
    perTxLimitToken: 50000000n, // 50 USDC
    windowDuration: 86400n,
    allowedProtocols: [allowedProtocol],
    allowedSelectors: [SELECTORS.TRANSFER],
    allowedTokens: [allowedToken, NATIVE_ETH_ADDRESS],
    tokenWindowCaps: [100000000n, 200000000000000000n]
  };

  it('should approve valid autonomous ERC-20 transfer within limits', () => {
    const calldata = encodeFunctionData({
      abi: [{ type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }],
      functionName: 'transfer',
      args: [allowedProtocol, 30000000n] // 30 USDC <= 50 USDC
    });

    const result = validateAgentSingleCall(config, allowedToken, 0n, calldata, 2000);
    expect(result.valid).toBe(true);
    expect(result.requiresEscalation).toBe(false);
  });

  it('should flag autonomous ERC-20 transfer exceeding perTxLimit for escalation', () => {
    const calldata = encodeFunctionData({
      abi: [{ type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }],
      functionName: 'transfer',
      args: [allowedProtocol, 150000000n] // 150 USDC > 50 USDC but <= 200 USDC
    });

    const result = validateAgentSingleCall(config, allowedToken, 0n, calldata, 2000);
    expect(result.valid).toBe(true);
    expect(result.requiresEscalation).toBe(true);
  });

  it('should strictly reject ERC-20 transfer exceeding humanApprovalThreshold ceiling', () => {
    const calldata = encodeFunctionData({
      abi: [{ type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }],
      functionName: 'transfer',
      args: [allowedProtocol, 250000000n] // 250 USDC > 200 USDC max ceiling
    });

    const result = validateAgentSingleCall(config, allowedToken, 0n, calldata, 2000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('exceeds humanApprovalThreshold');
  });

  it('should strictly reject blocked approval and permit selectors', () => {
    const approveCalldata = (SELECTORS.APPROVE + '00'.repeat(64)) as any;
    const result1 = validateAgentSingleCall(config, allowedToken, 0n, approveCalldata, 2000);
    expect(result1.valid).toBe(false);
    expect(result1.reason).toContain('Security Lockdown');

    const permitCalldata = (SELECTORS.PERMIT + '00'.repeat(128)) as any;
    const result2 = validateAgentSingleCall(config, allowedToken, 0n, permitCalldata, 2000);
    expect(result2.valid).toBe(false);
    expect(result2.reason).toContain('Security Lockdown');
  });

  it('should reject expired session', () => {
    const calldata = '0x' as const;
    const result = validateAgentSingleCall(config, allowedProtocol, 1000n, calldata, 6000); // 6000 > validUntil (5000)
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Session has expired');
  });
});
