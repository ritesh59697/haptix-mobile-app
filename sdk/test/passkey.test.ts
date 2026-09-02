import { describe, it, expect } from 'vitest';
import {
  parseDERSignature,
  bufferToBase64Url,
  parseWebAuthnAssertion
} from '../src/passkey.js';
import { P256_N } from '../src/constants.js';
import { toHex, fromHex } from 'viem';

describe('WebAuthn Passkey Client & Signature Parsing', () => {
  it('should convert ArrayBuffer to Base64URL string correctly', () => {
    const bytes = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
    const base64url = bufferToBase64Url(bytes.buffer);
    expect(base64url).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('should parse valid ASN.1 DER ECDSA signature with low-s normalization', () => {
    // Construct valid ASN.1 DER signature: 0x30 0x44 0x02 0x20 [32-byte r] 0x02 0x20 [32-byte s]
    const rBytes = new Uint8Array(32).fill(0x11);
    const sBytes = new Uint8Array(32).fill(0x22);

    const der = new Uint8Array(2 + 2 + 32 + 2 + 32);
    der[0] = 0x30; // sequence
    der[1] = 68; // length
    der[2] = 0x02; // r tag
    der[3] = 32; // r length
    der.set(rBytes, 4);
    der[36] = 0x02; // s tag
    der[37] = 32; // s length
    der.set(sBytes, 38);

    const parsed = parseDERSignature(der.buffer);
    expect(parsed.r).toBeGreaterThan(0n);
    expect(parsed.s).toBeGreaterThan(0n);
    expect(parsed.s).toBeLessThanOrEqual(P256_N / 2n);
  });

  it('should normalize high-s to low-s (s = N - s) when s > N/2', () => {
    const rBytes = new Uint8Array(32).fill(0x11);
    // s value = P256_N - 100n (which is > P256_N / 2n)
    const highS = P256_N - 100n;
    const sHex = highS.toString(16).padStart(64, '0');
    const sBytes = fromHex(('0x' + sHex) as any, 'bytes');

    const der = new Uint8Array(2 + 2 + 32 + 2 + 32);
    der[0] = 0x30;
    der[1] = 68;
    der[2] = 0x02;
    der[3] = 32;
    der.set(rBytes, 4);
    der[36] = 0x02;
    der[37] = 32;
    der.set(sBytes, 38);

    const parsed = parseDERSignature(der.buffer);
    expect(parsed.s).toBe(100n); // Successfully normalized!
  });

  it('should parse complete WebAuthn assertion response', () => {
    const authData = new Uint8Array([0x05, 0x00, 0x00, 0x00, 0x00]);
    const challengeHex = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
    const challengeBytes = fromHex(challengeHex, 'bytes');
    const challengeBase64Url = bufferToBase64Url(challengeBytes.buffer);

    const clientDataJSONStr = `{"type":"webauthn.get","challenge":"${challengeBase64Url}","origin":"http://localhost:5173"}`;
    const clientDataJSONBytes = new TextEncoder().encode(clientDataJSONStr);

    const rBytes = new Uint8Array(32).fill(0x11);
    const sBytes = new Uint8Array(32).fill(0x22);
    const der = new Uint8Array(2 + 2 + 32 + 2 + 32);
    der[0] = 0x30;
    der[1] = 68;
    der[2] = 0x02;
    der[3] = 32;
    der.set(rBytes, 4);
    der[36] = 0x02;
    der[37] = 32;
    der.set(sBytes, 38);

    const parsed = parseWebAuthnAssertion(
      authData.buffer,
      clientDataJSONBytes.buffer,
      der.buffer,
      challengeHex
    );

    expect(parsed.authenticatorData).toBe('0x0500000000');
    expect(parsed.clientDataJSON).toBe(clientDataJSONStr);
    expect(parsed.r).toBeGreaterThan(0n);
    expect(parsed.s).toBeGreaterThan(0n);
  });
});
