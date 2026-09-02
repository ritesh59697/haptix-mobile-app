import { describe, it, expect } from 'vitest';
import {
  generateAgentKey,
  importAgentKey,
  deriveAgentAddress,
  signUserOpHash,
  encodeAutonomousAgentSignature,
  encodeEscalatedAgentSignature
} from '../src/agent.js';
import { SIG_TYPE_AGENT, SIG_TYPE_ESCALATED, SECP256K1_N } from '../src/constants.js';
import { keccak256, toHex, fromHex } from 'viem';

describe('Agent Key Management & Signing', () => {
  it('should generate valid secp256k1 key pairs', () => {
    const keyPair = generateAgentKey();
    expect(keyPair.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(keyPair.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(deriveAgentAddress(keyPair.privateKey)).toBe(keyPair.address);
  });

  it('should import existing private keys correctly', () => {
    const knownKey = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
    const imported = importAgentKey(knownKey);
    expect(imported.privateKey).toBe(knownKey);
    expect(imported.address).toBe(deriveAgentAddress(knownKey));
  });

  it('should reject invalid or out-of-bounds private keys', () => {
    expect(() => importAgentKey('0x123' as any)).toThrow();
    expect(() => importAgentKey('0x0000000000000000000000000000000000000000000000000000000000000000')).toThrow();
    // Exceeding SECP256K1_N
    const overN = '0x' + (SECP256K1_N + 1n).toString(16).padStart(64, '0') as any;
    expect(() => importAgentKey(overN)).toThrow();
  });

  it('should sign userOpHash with low-s normalized ECDSA signature', async () => {
    const keyPair = generateAgentKey();
    const testHash = keccak256(toHex('haptix test userop'));
    const sig = await signUserOpHash(keyPair.privateKey, testHash);

    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/); // 65 bytes = 130 hex chars + 0x
    const sHex = '0x' + sig.slice(66, 130);
    const sBig = BigInt(sHex);
    expect(sBig).toBeLessThanOrEqual(SECP256K1_N / 2n);
  });

  it('should pack autonomous agent signature (0x01)', () => {
    const keyPair = generateAgentKey();
    const dummySig = ('0x' + 'aa'.repeat(65)) as any;
    const packed = encodeAutonomousAgentSignature(keyPair.address, dummySig);

    expect(packed.startsWith('0x01')).toBe(true);
    expect(packed.length).toBeGreaterThan(132);
  });

  it('should pack escalated agent signature (0x02) with 2-of-N passkeys', () => {
    const keyPair = generateAgentKey();
    const dummySig = ('0x' + 'aa'.repeat(65)) as any;
    const passkeyIds = [0n, 1n];
    const passkeySigs = [
      {
        authenticatorData: '0x0500000000' as const,
        clientDataJSON: '{"type":"webauthn.get"}',
        challengeIndex: 23n,
        typeIndex: 1n,
        r: 12345n,
        s: 67890n
      },
      {
        authenticatorData: '0x0500000000' as const,
        clientDataJSON: '{"type":"webauthn.get"}',
        challengeIndex: 23n,
        typeIndex: 1n,
        r: 54321n,
        s: 98765n
      }
    ];

    const packed = encodeEscalatedAgentSignature(keyPair.address, dummySig, passkeyIds, passkeySigs);
    expect(packed.startsWith('0x02')).toBe(true);
  });

  it('should reject non-ascending passkey IDs in escalated signature', () => {
    const keyPair = generateAgentKey();
    const dummySig = ('0x' + 'aa'.repeat(65)) as any;
    const unorderedIds = [1n, 0n]; // Unordered!
    const passkeySigs = [
      { authenticatorData: '0x05' as any, clientDataJSON: '', challengeIndex: 0n, typeIndex: 0n, r: 1n, s: 1n },
      { authenticatorData: '0x05' as any, clientDataJSON: '', challengeIndex: 0n, typeIndex: 0n, r: 1n, s: 1n }
    ];

    expect(() =>
      encodeEscalatedAgentSignature(keyPair.address, dummySig, unorderedIds, passkeySigs)
    ).toThrow(/strictly ascending/);
  });
});
