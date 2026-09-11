import { describe, it, expect } from 'vitest';
import {
  encodeSetGuardian,
  encodeInitiateRecovery,
  encodeCompleteRecovery,
  encodeCancelRecovery,
  RECOVERY_ABI
} from '../src/recovery.js';
import { decodeFunctionData } from 'viem';

describe('Guardian & Social Recovery SDK Helpers', () => {
  const guardianAddress = '0x1111111111111111111111111111111111111111' as const;
  const timelock = 172800; // 48 hours
  const newSigners = [
    { x: 123456789n, y: 987654321n },
    { x: 1122334455n, y: 9988776655n }
  ];

  it('should encode setGuardian correctly', () => {
    const calldata = encodeSetGuardian(guardianAddress, timelock);
    expect(calldata.startsWith('0x')).toBe(true);

    const decoded = decodeFunctionData({
      abi: RECOVERY_ABI,
      data: calldata
    });

    expect(decoded.functionName).toBe('setGuardian');
    expect(decoded.args?.[0]?.toLowerCase()).toBe(guardianAddress.toLowerCase());
    expect(Number(decoded.args?.[1])).toBe(timelock);
  });

  it('should encode initiateRecovery correctly', () => {
    const calldata = encodeInitiateRecovery(newSigners);
    expect(calldata.startsWith('0x')).toBe(true);

    const decoded = decodeFunctionData({
      abi: RECOVERY_ABI,
      data: calldata
    });

    expect(decoded.functionName).toBe('initiateRecovery');
    const args = decoded.args?.[0] as Array<{ x: bigint; y: bigint }>;
    expect(args.length).toBe(2);
    expect(args[0].x).toBe(123456789n);
  });

  it('should encode completeRecovery correctly', () => {
    const calldata = encodeCompleteRecovery(newSigners);
    expect(calldata.startsWith('0x')).toBe(true);

    const decoded = decodeFunctionData({
      abi: RECOVERY_ABI,
      data: calldata
    });

    expect(decoded.functionName).toBe('completeRecovery');
    const args = decoded.args?.[0] as Array<{ x: bigint; y: bigint }>;
    expect(args.length).toBe(2);
    expect(args[1].y).toBe(9988776655n);
  });

  it('should encode cancelRecovery correctly', () => {
    const calldata = encodeCancelRecovery();
    expect(calldata.startsWith('0x')).toBe(true);

    const decoded = decodeFunctionData({
      abi: RECOVERY_ABI,
      data: calldata
    });

    expect(decoded.functionName).toBe('cancelRecovery');
  });
});
