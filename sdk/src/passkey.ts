import {
  type Hex,
  toHex,
  fromHex,
  padHex
} from 'viem';
import { P256_N } from './constants.js';
import type {
  WebAuthnPublicKey,
  WebAuthnSignature
} from './types.js';

/**
 * Utility: Converts ArrayBuffer to Base64URL string.
 */
export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Parses an ASN.1 DER-encoded ECDSA signature into normalized (r, s) values with P-256 low-s normalization.
 */
export function parseDERSignature(sigBuffer: ArrayBuffer | Uint8Array): { r: bigint; s: bigint } {
  const der = new Uint8Array(sigBuffer);
  let offset = 2; // Skip 0x30 and sequence length

  // 1. Read r
  if (der[offset] !== 0x02) throw new Error('Invalid DER signature: expected 0x02 for r tag');
  const rLen = der[offset + 1];
  const rBytes = der.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;

  // 2. Read s
  if (der[offset] !== 0x02) throw new Error('Invalid DER signature: expected 0x02 for s tag');
  const sLen = der[offset + 1];
  const sBytes = der.slice(offset + 2, offset + 2 + sLen);

  // Convert to bigint
  let rBig = BigInt(toHex(rBytes));
  let sBig = BigInt(toHex(sBytes));

  // Low-s normalization for P-256: if s > N/2, s = N - s
  const maxS = P256_N / 2n;
  if (sBig > maxS) {
    sBig = P256_N - sBig;
  }

  return { r: rBig, s: sBig };
}

/**
 * Parses a WebAuthn get assertion response into WebAuthn.sol struct format.
 */
export function parseWebAuthnAssertion(
  authenticatorDataBuffer: ArrayBuffer,
  clientDataJSONBuffer: ArrayBuffer,
  signatureBuffer: ArrayBuffer,
  challengeHex: Hex
): WebAuthnSignature {
  const authDataHex = toHex(new Uint8Array(authenticatorDataBuffer));
  const clientDataJSON = new TextDecoder().decode(clientDataJSONBuffer);

  // Extract base64url challenge from challengeHex
  const challengeBytes = fromHex(challengeHex, 'bytes');
  const expectedChallengeBase64Url = bufferToBase64Url(challengeBytes.buffer as ArrayBuffer);

  // Locate challengeIndex and typeIndex in clientDataJSON string
  const challengeSearch = `"challenge":"${expectedChallengeBase64Url}"`;
  const challengeIndex = clientDataJSON.indexOf(challengeSearch);
  if (challengeIndex === -1) {
    throw new Error('Challenge not found in clientDataJSON');
  }

  const typeSearch = '"type":"webauthn.get"';
  const typeIndex = clientDataJSON.indexOf(typeSearch);
  if (typeIndex === -1) {
    throw new Error('"webauthn.get" type not found in clientDataJSON');
  }

  // Parse DER signature
  const { r, s } = parseDERSignature(signatureBuffer);

  return {
    authenticatorData: authDataHex,
    clientDataJSON,
    challengeIndex: BigInt(challengeIndex + 13), // points to starting quote of challenge value
    typeIndex: BigInt(typeIndex + 8), // points to starting quote of type value
    r,
    s
  };
}

/**
 * Registers a new P-256 WebAuthn passkey in the browser environment.
 */
export async function registerPasskey(
  accountName: string = 'Passkey Smart Account',
  rpId?: string,
  rpName: string = 'Haptix Protocol'
): Promise<{ credentialId: Hex; publicKey: WebAuthnPublicKey }> {
  if (typeof window === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn registration requires a browser environment with navigator.credentials');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: challenge.buffer as ArrayBuffer,
      rp: {
        name: rpName,
        id: rpId || window.location.hostname || 'localhost'
      },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer,
        name: accountName,
        displayName: accountName
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 } // ES256 (P-256)
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    }
  }) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Passkey creation was cancelled or timed out');
  }

  const rawId = toHex(new Uint8Array(credential.rawId));
  const response = credential.response as AuthenticatorAttestationResponse;

  let xBig = 0n;
  let yBig = 0n;

  if (typeof response.getPublicKey === 'function') {
    const spki = new Uint8Array(response.getPublicKey()!);
    const pubPoint = spki.slice(-65);
    if (pubPoint[0] === 0x04) {
      xBig = BigInt(toHex(pubPoint.slice(1, 33)));
      yBig = BigInt(toHex(pubPoint.slice(33, 65)));
    }
  }

  if (xBig === 0n || yBig === 0n) {
    throw new Error('Failed to extract P-256 public key coordinates (x, y) from authenticator response');
  }

  return {
    credentialId: rawId,
    publicKey: { x: xBig, y: yBig }
  };
}

/**
 * Prompts the user to biometrically sign a UserOperation hash with their hardware passkey.
 */
export async function signUserOpWithPasskey(
  userOpHash: Hex,
  credentialIdHex?: Hex,
  rpId?: string
): Promise<WebAuthnSignature> {
  if (typeof window === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn signing requires a browser environment with navigator.credentials');
  }

  const challengeBytes = fromHex(userOpHash, 'bytes');

  const getOptions: CredentialRequestOptions = {
    publicKey: {
      challenge: challengeBytes.buffer as ArrayBuffer,
      rpId: rpId || window.location.hostname || 'localhost',
      userVerification: 'required',
      timeout: 60000,
      allowCredentials: credentialIdHex
        ? [
            {
              type: 'public-key',
              id: fromHex(credentialIdHex, 'bytes').buffer as ArrayBuffer
            }
          ]
        : undefined
    }
  };

  const assertion = await navigator.credentials.get(getOptions) as PublicKeyCredential;
  if (!assertion) {
    throw new Error('Passkey signature prompt was cancelled');
  }

  const response = assertion.response as AuthenticatorAssertionResponse;
  return parseWebAuthnAssertion(
    response.authenticatorData,
    response.clientDataJSON,
    response.signature,
    userOpHash
  );
}
