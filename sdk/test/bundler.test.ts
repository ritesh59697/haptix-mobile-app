import { describe, it, expect, vi } from 'vitest';
import {
  BundlerClient,
  validateEntryPoint,
  decodeEntryPointError,
  unpackAccountGasLimits,
  unpackGasFees,
  checkPreflightBalance,
  CANONICAL_ENTRYPOINT_V07,
  ENTRYPOINT_ERRORS
} from '../src/index.js';
import type { PackedUserOperation } from '../src/types.js';

describe('Bundler Integration & Error Handling', () => {
  it('validates canonical EntryPoint v0.7 and supported chainIds', () => {
    expect(() => validateEntryPoint(CANONICAL_ENTRYPOINT_V07, 84532)).not.toThrow();
    expect(() => validateEntryPoint(CANONICAL_ENTRYPOINT_V07, 8453)).not.toThrow();
    
    // Invalid EntryPoint
    expect(() => validateEntryPoint('0x1111111111111111111111111111111111111111', 84532)).toThrow(/canonical ERC-4337 v0.7/);
    
    // Unsupported chainId
    expect(() => validateEntryPoint(CANONICAL_ENTRYPOINT_V07, 1)).toThrow(/Unsupported chainId/);
  });

  it('decodes EntryPoint error codes with actionable diagnostics', () => {
    const err21 = decodeEntryPointError('Failed to simulate: AA21 didn\'t pay prefund');
    expect(err21).not.toBeNull();
    expect(err21?.code).toBe('AA21');
    expect(err21?.hint).toContain('insufficient native ETH or EntryPoint deposit');

    const err22 = decodeEntryPointError('Revert: AA22 expired or not due');
    expect(err22?.code).toBe('AA22');

    const err23 = decodeEntryPointError('Execution error: AA23 reverted');
    expect(err23?.code).toBe('AA23');

    const err24 = decodeEntryPointError('Validation error: AA24 signature error');
    expect(err24?.code).toBe('AA24');

    expect(decodeEntryPointError('Generic unknown error')).toBeNull();
  });

  it('unpacks accountGasLimits and gasFees correctly', () => {
    // 200,000 (0x30d40) and 80,000 (0x13880) packed as bytes32
    const packedGasLimits = '0x00000000000000000000000000030d4000000000000000000000000000013880';
    const unpackedGas = unpackAccountGasLimits(packedGasLimits);
    expect(unpackedGas.verificationGasLimit).toBe(200000n);
    expect(unpackedGas.callGasLimit).toBe(80000n);

    // 0.05 gwei (50,000,000 = 0x2faf080) and 0.20 gwei (200,000,000 = 0xbebc200)
    const packedFees = '0x00000000000000000000000002faf0800000000000000000000000000bebc200';
    const unpackedFees = unpackGasFees(packedFees);
    expect(unpackedFees.maxPriorityFeePerGas).toBe(50000000n);
    expect(unpackedFees.maxFeePerGas).toBe(200000000n);
  });

  it('detects insufficient prefund before sending UserOperation (AA21)', async () => {
    const mockClient = {
      getBalance: vi.fn().mockResolvedValue(0n),
      readContract: vi.fn().mockResolvedValue(0n)
    } as any;

    const userOp: PackedUserOperation = {
      sender: '0x8ad53FB549707686c1D6484119Fb2D5842A83229',
      nonce: 0n,
      initCode: '0x',
      callData: '0x',
      accountGasLimits: '0x00000000000000000000000000030d4000000000000000000000000000013880',
      preVerificationGas: 60000n,
      gasFees: '0x00000000000000000000000002faf0800000000000000000000000000bebc200',
      paymasterAndData: '0x',
      signature: '0x'
    };

    const check = await checkPreflightBalance(mockClient, userOp);
    expect(check.ok).toBe(false);
    expect(check.error).toContain('AA21');
    expect(check.hint).toContain('insufficient native ETH');
    expect(check.requiredPrefundWei).toBeGreaterThan(0n);
  });

  it('passes preflight check when account has sufficient balance', async () => {
    const mockClient = {
      getBalance: vi.fn().mockResolvedValue(100000000000000000n), // 0.1 ETH
      readContract: vi.fn().mockResolvedValue(0n)
    } as any;

    const userOp: PackedUserOperation = {
      sender: '0x8ad53FB549707686c1D6484119Fb2D5842A83229',
      nonce: 0n,
      initCode: '0x',
      callData: '0x',
      accountGasLimits: '0x00000000000000000000000000030d4000000000000000000000000000013880',
      preVerificationGas: 60000n,
      gasFees: '0x00000000000000000000000002faf0800000000000000000000000000bebc200',
      paymasterAndData: '0x',
      signature: '0x'
    };

    const check = await checkPreflightBalance(mockClient, userOp);
    expect(check.ok).toBe(true);
    expect(check.error).toBeUndefined();
  });

  it('wraps bundler 401/403 authentication failures with actionable guidance', async () => {
    const bundler = new BundlerClient('https://mock-bundler.xyz', CANONICAL_ENTRYPOINT_V07, 84532);
    
    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    });

    try {
      await expect(bundler.rpcCall('eth_supportedEntryPoints', [])).rejects.toThrow(
        /Bundler Authentication Failed \[HTTP 401\]: Missing or invalid API key/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
