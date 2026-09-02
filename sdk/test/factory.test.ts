import { describe, it, expect } from 'vitest';
import { buildAccountInitCode } from '../src/factory.js';

describe('Factory & Counterfactual Account Helpers', () => {
  const factoryAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
  const p0 = { x: 12345n, y: 67890n };
  const p1 = { x: 54321n, y: 98765n };
  const salt = '0x0000000000000000000000000000000000000000000000000000000000000001' as const;
  const threshold = 10000000000000000n; // 0.01 ETH

  it('should build valid ERC-4337 v0.7 initCode starting with factory address', () => {
    const initCode = buildAccountInitCode({
      factoryAddress,
      initialSigners: [p0, p1],
      threshold,
      salt
    });

    expect(initCode.toLowerCase().startsWith(factoryAddress.toLowerCase())).toBe(true);
    expect(initCode.length).toBeGreaterThan(42);
  });

  it('should reject initCode creation with fewer than 2 signers', () => {
    expect(() =>
      buildAccountInitCode({
        factoryAddress,
        initialSigners: [p0], // only 1 signer
        threshold,
        salt
      })
    ).toThrow(/requires at least 2 initial passkey signers/);
  });
});
