import { describe, it, expect } from 'vitest';
import {
  validateSessionConfig,
  encodeGrantAgentSessionCall,
  encodeRevokeAgentSessionCall
} from '../src/session.js';
import { SELECTORS, NATIVE_ETH_ADDRESS } from '../src/constants.js';
import type { AgentSessionConfig } from '../src/types.js';

describe('Agent Session Management', () => {
  const validConfig: AgentSessionConfig = {
    agentKey: '0x1111111111111111111111111111111111111111',
    validAfter: 1000,
    validUntil: 2000,
    humanApprovalThreshold: 200000000n, // $200
    perTxLimitEth: 50000000000000000n, // 0.05 ETH
    perTxLimitToken: 50000000n, // 50 USDC
    windowDuration: 86400n, // 1 day
    allowedProtocols: ['0x2222222222222222222222222222222222222222'],
    allowedSelectors: [SELECTORS.UNISWAP_V3_EXACT_INPUT_SINGLE],
    allowedTokens: ['0x3333333333333333333333333333333333333333'],
    tokenWindowCaps: [100000000n]
  };

  it('should validate a correct session configuration', () => {
    expect(() => validateSessionConfig(validConfig)).not.toThrow();
  });

  it('should encode grantAgentSession calldata matching selector 0xa4fe361a', () => {
    const calldata = encodeGrantAgentSessionCall(validConfig);
    expect(calldata.startsWith(SELECTORS.GRANT_AGENT_SESSION)).toBe(true);
  });

  it('should encode revokeAgentSession calldata matching selector 0x42f70356', () => {
    const calldata = encodeRevokeAgentSessionCall(validConfig.agentKey);
    expect(calldata.startsWith(SELECTORS.REVOKE_AGENT_SESSION)).toBe(true);
  });

  it('should reject invalid session duration (validUntil <= validAfter)', () => {
    const badConfig: AgentSessionConfig = {
      ...validConfig,
      validAfter: 2000,
      validUntil: 1000
    };
    expect(() => validateSessionConfig(badConfig)).toThrow(/Invalid session duration/);
  });

  it('should reject array length mismatches', () => {
    const mismatchProtocols: AgentSessionConfig = {
      ...validConfig,
      allowedProtocols: ['0x2222222222222222222222222222222222222222'],
      allowedSelectors: [] // mismatch
    };
    expect(() => validateSessionConfig(mismatchProtocols)).toThrow(/allowedProtocols/);

    const mismatchTokens: AgentSessionConfig = {
      ...validConfig,
      allowedTokens: ['0x3333333333333333333333333333333333333333'],
      tokenWindowCaps: [] // mismatch
    };
    expect(() => validateSessionConfig(mismatchTokens)).toThrow(/allowedTokens/);
  });

  it('should reject zero address agentKey', () => {
    const zeroAgent: AgentSessionConfig = {
      ...validConfig,
      agentKey: NATIVE_ETH_ADDRESS
    };
    expect(() => validateSessionConfig(zeroAgent)).toThrow(/Invalid agentKey/);
  });
});
