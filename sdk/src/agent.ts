import {
  type Address,
  type Hex,
  concatHex,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  keccak256
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  SIG_TYPE_AGENT,
  SIG_TYPE_ESCALATED,
  SECP256K1_N
} from './constants.js';
import type { WebAuthnSignature } from './types.js';

export interface AgentKeyPair {
  privateKey: Hex;
  address: Address;
}

/**
 * Generates a fresh, cryptographically secure secp256k1 agent private key and derived address.
 */
export function generateAgentKey(): AgentKeyPair {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address
  };
}

/**
 * Imports an existing hex-encoded secp256k1 private key.
 * Validates key length and bounds.
 */
export function importAgentKey(privateKeyHex: Hex): AgentKeyPair {
  if (!privateKeyHex.startsWith('0x') || privateKeyHex.length !== 66) {
    throw new Error('Invalid private key: must be 32-byte 0x-prefixed hex string');
  }
  const keyBig = BigInt(privateKeyHex);
  if (keyBig === 0n || keyBig >= SECP256K1_N) {
    throw new Error('Invalid private key: out of secp256k1 scalar field bounds');
  }
  const account = privateKeyToAccount(privateKeyHex);
  return {
    privateKey: privateKeyHex,
    address: account.address
  };
}

/**
 * Derives the Ethereum address from a secp256k1 private key.
 */
export function deriveAgentAddress(privateKeyHex: Hex): Address {
  const account = privateKeyToAccount(privateKeyHex);
  return account.address;
}

/**
 * Signs a 32-byte userOpHash using the agent's secp256k1 key.
 * Returns 65-byte compact signature (r || s || v) with EIP-2 low-s normalization.
 */
export async function signUserOpHash(privateKeyHex: Hex, userOpHash: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKeyHex);
  const sig = await account.sign({
    hash: userOpHash
  });

  // Extract r, s, v
  const r = sig.slice(0, 66) as Hex;
  const s = ('0x' + sig.slice(66, 130)) as Hex;
  let v = parseInt(sig.slice(130, 132), 16);

  // Normalize v to 27/28 if returned as 0/1
  if (v < 27) {
    v += 27;
  }

  // Ensure low-s normalization (s <= N/2)
  const maxS = SECP256K1_N / 2n;
  let sBig = BigInt(s);
  if (sBig > maxS) {
    sBig = SECP256K1_N - sBig;
    v = v === 27 ? 28 : 27;
  }

  const normalizedS = sBig.toString(16).padStart(64, '0');
  const vHex = v.toString(16).padStart(2, '0');

  return (r + normalizedS + vHex) as Hex;
}

/**
 * Packs an autonomous agent signature (sigType 0x01).
 * Layout: 0x01 || abi.encode(address agentKey, bytes agentSig)
 */
export function encodeAutonomousAgentSignature(agentAddress: Address, ecdsaSig: Hex): Hex {
  if (ecdsaSig.length !== 132) { // 65 bytes = 130 hex chars + '0x'
    throw new Error('Invalid ECDSA signature length: expected 65 bytes');
  }

  const encodedPayload = encodeAbiParameters(
    parseAbiParameters('address agentKey, bytes agentSig'),
    [agentAddress, ecdsaSig]
  );

  const prefix = toHex(SIG_TYPE_AGENT, { size: 1 });
  return concatHex([prefix, encodedPayload]);
}

/**
 * Packs an escalated agent signature with 2-of-N WebAuthn passkey quorum (sigType 0x02).
 * Layout: 0x02 || abi.encode(address agentKey, bytes agentSig, uint256[] passkeyIds, WebAuthn.Signature[] passkeySigs)
 */
export function encodeEscalatedAgentSignature(
  agentAddress: Address,
  ecdsaSig: Hex,
  passkeyIds: bigint[],
  passkeySignatures: WebAuthnSignature[]
): Hex {
  if (ecdsaSig.length !== 132) {
    throw new Error('Invalid ECDSA signature length: expected 65 bytes');
  }
  if (passkeyIds.length < 2 || passkeyIds.length !== passkeySignatures.length) {
    throw new Error('Escalation requires at least 2 passkey signatures matching passkey IDs');
  }

  // Enforce strictly ascending signer IDs before encoding
  for (let i = 0; i < passkeyIds.length - 1; i++) {
    if (passkeyIds[i] >= passkeyIds[i + 1]) {
      throw new Error(`Passkey IDs must be strictly ascending: got ${passkeyIds[i]} >= ${passkeyIds[i + 1]}`);
    }
  }

  const formattedPasskeySigs = passkeySignatures.map(sig => ({
    authenticatorData: sig.authenticatorData,
    clientDataJSON: sig.clientDataJSON,
    challengeIndex: sig.challengeIndex,
    typeIndex: sig.typeIndex,
    r: sig.r,
    s: sig.s
  }));

  const encodedPayload = encodeAbiParameters(
    parseAbiParameters(
      'address agentKey, bytes agentSig, uint256[] passkeyIds, (bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s)[] passkeySigs'
    ),
    [agentAddress, ecdsaSig, passkeyIds, formattedPasskeySigs]
  );

  const prefix = toHex(SIG_TYPE_ESCALATED, { size: 1 });
  return concatHex([prefix, encodedPayload]);
}
