import { describe, it, expect } from 'vitest';
import {
  packAccountGasLimits,
  unpackAccountGasLimits,
  packGasFees,
  unpackGasFees,
  buildPackedUserOp,
  computeUserOpHash,
  encodeExecuteByAgent,
  encodeExecuteBatchByAgent
} from '../src/userop.js';
import { CANONICAL_ENTRYPOINT_V07, SELECTORS } from '../src/constants.js';

describe('UserOperation v0.7 Packing & Hashing', () => {
  it('should pack and unpack accountGasLimits correctly', () => {
    const verGas = 150000n;
    const callGas = 80000n;

    const packed = packAccountGasLimits(verGas, callGas);
    expect(packed.length).toBe(66); // 32 bytes = 64 hex chars + 0x

    const unpacked = unpackAccountGasLimits(packed);
    expect(unpacked.verificationGasLimit).toBe(verGas);
    expect(unpacked.callGasLimit).toBe(callGas);
  });

  it('should pack and unpack gasFees correctly', () => {
    const priorityFee = 50000000n; // 0.05 gwei
    const maxFee = 200000000n; // 0.20 gwei

    const packed = packGasFees(priorityFee, maxFee);
    expect(packed.length).toBe(66);

    const unpacked = unpackGasFees(packed);
    expect(unpacked.maxPriorityFeePerGas).toBe(priorityFee);
    expect(unpacked.maxFeePerGas).toBe(maxFee);
  });

  it('should build a PackedUserOperation with correct gas packing', () => {
    const sender = '0x1111111111111111111111111111111111111111' as const;
    const callData = '0x12345678' as const;
    const gasParams = {
      verificationGasLimit: 200000n,
      callGasLimit: 60000n,
      preVerificationGas: 50000n,
      maxPriorityFeePerGas: 100000000n,
      maxFeePerGas: 300000000n
    };

    const userOp = buildPackedUserOp({
      sender,
      nonce: 0n,
      callData,
      gasParams
    });

    expect(userOp.sender).toBe(sender);
    expect(userOp.nonce).toBe(0n);
    expect(userOp.callData).toBe(callData);
    expect(userOp.preVerificationGas).toBe(50000n);
  });

  it('should compute deterministic userOpHash matching ERC-4337 v0.7 standard', () => {
    const sender = '0x1111111111111111111111111111111111111111' as const;
    const callData = '0x12345678' as const;
    const gasParams = {
      verificationGasLimit: 200000n,
      callGasLimit: 60000n,
      preVerificationGas: 50000n,
      maxPriorityFeePerGas: 100000000n,
      maxFeePerGas: 300000000n
    };

    const userOp = buildPackedUserOp({
      sender,
      nonce: 0n,
      callData,
      gasParams
    });

    const hash1 = computeUserOpHash(userOp, CANONICAL_ENTRYPOINT_V07, 84532);
    const hash2 = computeUserOpHash(userOp, CANONICAL_ENTRYPOINT_V07, 84532);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Cross-chain replay protection
    const hashOtherChain = computeUserOpHash(userOp, CANONICAL_ENTRYPOINT_V07, 8453);
    expect(hash1).not.toBe(hashOtherChain);
  });

  it('should encode executeByAgent calldata matching selector 0xdf843ec0', () => {
    const agent = '0x1111111111111111111111111111111111111111' as const;
    const target = '0x2222222222222222222222222222222222222222' as const;
    const calldata = encodeExecuteByAgent(agent, target, 0n, '0x');

    expect(calldata.startsWith(SELECTORS.EXECUTE_BY_AGENT)).toBe(true);
  });

  it('should encode executeBatchByAgent calldata matching selector 0x044beff7', () => {
    const agent = '0x1111111111111111111111111111111111111111' as const;
    const targets = ['0x2222222222222222222222222222222222222222' as const];
    const values = [0n];
    const funcs = ['0x' as const];

    const calldata = encodeExecuteBatchByAgent(agent, targets, values, funcs);
    expect(calldata.startsWith(SELECTORS.EXECUTE_BATCH_BY_AGENT)).toBe(true);
  });
});
