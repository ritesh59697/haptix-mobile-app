// WebAuthn, ERC-4337 UserOp Builder, and Bundler Client for Passkey Smart Wallet
import { p256 } from './p256.js';
import { keccak_256 } from './keccak256.js';

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = h => new Uint8Array((h.startsWith('0x') ? h.slice(2) : h).match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
export const pad64 = n => (typeof n === 'bigint' ? n.toString(16) : BigInt(n).toString(16)).padStart(64, '0');
export const padBytes32 = h => (typeof h === 'bigint' ? h.toString(16) : typeof h === 'number' ? h.toString(16) : (h.startsWith('0x') ? h.slice(2) : h)).padStart(64, '0');

export function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Parses an ASN.1 DER ECDSA signature into normalized 32-byte (r, s) components.
 * Enforces low-s normalization (s <= N/2).
 */
export function parseDERSignature(sigBuffer) {
  const der = new Uint8Array(sigBuffer);
  let offset = 2; // Skip 0x30 and total length
  
  // Read r
  if (der[offset] !== 0x02) throw new Error('Invalid DER format: expected 0x02 for r');
  const rLen = der[offset + 1];
  let rBytes = der.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;

  // Read s
  if (der[offset] !== 0x02) throw new Error('Invalid DER format: expected 0x02 for s');
  const sLen = der[offset + 1];
  let sBytes = der.slice(offset + 2, offset + 2 + sLen);

  // Trim leading zeros if length > 32
  const trimLeading = b => {
    let i = 0;
    while (i < b.length - 32 && b[i] === 0) i++;
    return b.slice(i);
  };
  
  let rBig = BigInt('0x' + hex(trimLeading(rBytes)));
  let sBig = BigInt('0x' + hex(trimLeading(sBytes)));

  // Low-s normalization: if s > N/2, s = N - s
  if (sBig > P256_N / 2n) {
    sBig = P256_N - sBig;
  }

  return {
    r: '0x' + pad64(rBig),
    s: '0x' + pad64(sBig)
  };
}

/**
 * Registers a new P-256 Passkey on the local device / security key.
 * Returns the credential ID and the uncompressed public key (x, y).
 */
export async function registerPasskey(accountName = 'Passkey Wallet Owner') {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'Passkey Smart Wallet',
        id: window.location.hostname || 'localhost'
      },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: accountName,
        displayName: accountName
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 } // ES256 (P-256 / secp256r1)
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    }
  });

  const rawId = hex(credential.rawId);
  const response = credential.response;
  
  let xHex = '', yHex = '';
  if (typeof response.getPublicKey === 'function') {
    const spki = new Uint8Array(response.getPublicKey());
    const pubPoint = spki.slice(-65);
    if (pubPoint[0] === 0x04) {
      xHex = '0x' + hex(pubPoint.slice(1, 33));
      yHex = '0x' + hex(pubPoint.slice(33, 65));
    }
  }

  return {
    id: credential.id,
    rawId: '0x' + rawId,
    x: xHex,
    y: yHex,
    createdAt: Date.now()
  };
}

/**
 * Prompts user's hardware passkey to sign the 32-byte challenge.
 */
export async function signWithPasskey(challenge32Bytes, allowCredentialIds = []) {
  const challengeBuf = typeof challenge32Bytes === 'string' 
    ? fromHex(challenge32Bytes) 
    : challenge32Bytes;

  const getOptions = {
    challenge: challengeBuf,
    userVerification: 'required',
    timeout: 60000
  };

  if (allowCredentialIds && allowCredentialIds.length > 0) {
    getOptions.allowCredentials = allowCredentialIds.map(id => {
      let buf = id;
      if (typeof id === 'string') {
        if (id.startsWith('0x')) {
          buf = fromHex(id);
        } else {
          try {
            const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            buf = u8;
          } catch {
            buf = fromHex(id);
          }
        }
      }
      return {
        type: 'public-key',
        id: buf
      };
    });
  }

  const assertion = await navigator.credentials.get({
    publicKey: getOptions
  });

  const resp = assertion.response;
  const authDataHex = '0x' + hex(new Uint8Array(resp.authenticatorData));
  const clientDataJSON = new TextDecoder('utf-8').decode(resp.clientDataJSON);
  const derSig = parseDERSignature(resp.signature);

  // Find UTF-8 byte offsets for type and challenge in clientDataJSON
  const encoder = new TextEncoder();
  
  const typeNeedle = '"type":"webauthn.get"';
  const typeCharIndex = clientDataJSON.indexOf(typeNeedle);
  const typeIndex = encoder.encode(clientDataJSON.slice(0, typeCharIndex)).length;

  const challengeB64 = base64url(challengeBuf);
  const challengeNeedle = `"challenge":"${challengeB64}"`;
  const challengeCharIndex = clientDataJSON.indexOf(challengeNeedle);
  const challengeIndex = encoder.encode(clientDataJSON.slice(0, challengeCharIndex)).length;

  return {
    authenticatorData: authDataHex,
    clientDataJSON,
    typeIndex,
    challengeIndex,
    r: derSig.r,
    s: derSig.s
  };
}

/**
 * Serializes a single WebAuthn.Signature struct into ABI-encoded bytes
 */
export function encodeSingleWebAuthnSignature(sig) {
  const authDataBytes = fromHex(sig.authenticatorData);
  const cdBytes = new TextEncoder().encode(sig.clientDataJSON);

  const offAuth = 192;
  const authPaddedLen = Math.ceil(authDataBytes.length / 32) * 32;
  const offCd = offAuth + 32 + authPaddedLen;

  let structHead = pad64(offAuth) +
                   pad64(offCd) +
                   pad64(sig.challengeIndex) +
                   pad64(sig.typeIndex) +
                   padBytes32(sig.r) +
                   padBytes32(sig.s);

  let authDataPayload = pad64(authDataBytes.length) + hex(authDataBytes).padEnd(authPaddedLen * 2, '0');

  const cdPaddedLen = Math.ceil(cdBytes.length / 32) * 32;
  let cdPayload = pad64(cdBytes.length) + hex(cdBytes).padEnd(cdPaddedLen * 2, '0');

  return structHead + authDataPayload + cdPayload;
}

/**
 * ABI encodes (uint256 signerId, WebAuthn.Signature sig) matching PasskeyAccount.sol:isValidSignature
 */
export function encode1271Signature(signerId, signature) {
  // Head: (uint256 signerId, offsetToSigStruct)
  // uint256 is 32 bytes, offsetToSigStruct is at 64 (0x40)
  const head = pad64(signerId) + pad64(64);
  const structBody = encodeSingleWebAuthnSignature(signature);
  return '0x' + head + structBody;
}

/**
 * Computes standard Ethereum personal_sign message hash: keccak256("\x19Ethereum Signed Message:\n" + len + msg)
 */
export function hashPersonalMessage(message) {
  let msgBytes;
  if (typeof message === 'string' && message.startsWith('0x') && message.length % 2 === 0) {
    msgBytes = fromHex(message);
  } else if (typeof message === 'string') {
    msgBytes = new TextEncoder().encode(message);
  } else {
    msgBytes = message;
  }
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
  const combined = new Uint8Array(prefix.length + msgBytes.length);
  combined.set(prefix, 0);
  combined.set(msgBytes, prefix.length);
  return '0x' + hex(keccak_256(combined));
}

/**
 * Computes standard Keccak256 hash
 */
export function keccak256(data) {
  let bytes;
  if (typeof data === 'string') {
    bytes = data.startsWith('0x') ? fromHex(data) : new TextEncoder().encode(data);
  } else {
    bytes = data;
  }
  return '0x' + hex(keccak_256(bytes));
}

/**
 * Computes the EIP-712 getMessageHash digest matching PasskeyAccount.sol
 */
export function computeErc1271MessageHash(accountAddress, chainId, rawMessageHash) {
  const TYPE_HASH = '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f'; // EIP712Domain
  const NAME_HASH = '0xd0c6519a9308df8f9cbcaac8360e47a90886ae7239177d7ab4d94377ff0b9e6e'; // Haptix
  const VERSION_HASH = '0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6'; // 1
  const MSG_TYPEHASH = '0xa793968e60b54b6717f772385bc379443c5a4171b73850d1d8a1b6c756949fdc'; // HaptixMessage(bytes32)

  const cleanAddr = accountAddress.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const cleanChain = BigInt(chainId).toString(16).padStart(64, '0');

  // domainSeparator = keccak256(abi.encode(TYPE_HASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)))
  const domainData = fromHex(TYPE_HASH + NAME_HASH.slice(2) + VERSION_HASH.slice(2) + cleanChain + cleanAddr);
  const domainSeparator = '0x' + hex(keccak_256(domainData));

  // structHash = keccak256(abi.encode(MSG_TYPEHASH, messageHash))
  const cleanMsgHash = padBytes32(rawMessageHash);
  const structData = fromHex(MSG_TYPEHASH + cleanMsgHash);
  const structHash = '0x' + hex(keccak_256(structData));

  // digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
  const prefix = new Uint8Array([0x19, 0x01]);
  const domBytes = fromHex(domainSeparator);
  const structBytes = fromHex(structHash);
  const total = new Uint8Array(prefix.length + domBytes.length + structBytes.length);
  total.set(prefix, 0);
  total.set(domBytes, prefix.length);
  total.set(structBytes, prefix.length + domBytes.length);

  return '0x' + hex(keccak_256(total));
}

/**
 * Queries getMessageHash from on-chain smart account via eth_call with fallback to local computation
 */
export async function getAccountMessageHash(rpcUrl, accountAddress, chainId, rawMessageHash) {
  try {
    const callData = '0x399b77da' + padBytes32(rawMessageHash);
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_call',
        params: [{ to: accountAddress, data: callData }, 'latest']
      })
    });
    const json = await resp.json();
    if (json.result && json.result.length === 66 && json.result !== '0x' + '0'.repeat(64)) {
      return json.result;
    }
  } catch (e) {
    console.warn('On-chain getMessageHash query fell back to local computation:', e);
  }
  return computeErc1271MessageHash(accountAddress, chainId, rawMessageHash);
}

/**
 * ABI encodes (uint256[] signerIds, WebAuthn.Signature[] sigs) matching PasskeyAccount.sol
 */
export function encodeSignaturePayload(signerIds, signatures) {
  const offsetSignerIds = 64;
  
  let idsData = pad64(signerIds.length);
  for (const id of signerIds) {
    idsData += pad64(id);
  }
  const idsByteLen = (1 + signerIds.length) * 32;

  const offsetSigs = offsetSignerIds + idsByteLen;
  let head = pad64(offsetSignerIds) + pad64(offsetSigs);

  const sigCount = signatures.length;
  let sigArrayCount = pad64(sigCount);
  
  let sigStructOffsets = '';
  let sigStructBodies = '';

  let currentStructOffset = sigCount * 32;

  for (let i = 0; i < sigCount; i++) {
    sigStructOffsets += pad64(currentStructOffset);
    const structTotalBytes = encodeSingleWebAuthnSignature(signatures[i]);
    sigStructBodies += structTotalBytes;
    currentStructOffset += structTotalBytes.length / 2;
  }

  return '0x' + head + idsData + sigArrayCount + sigStructOffsets + sigStructBodies;
}

/**
 * Fetches Account Nonce from EntryPoint v0.7
 */
export async function getAccountNonce(rpcUrl, entryPointAddress, senderAddress, key = 0n) {
  const callData = '0x35567e1a' +
    senderAddress.replace(/^0x/, '').padStart(64, '0') +
    key.toString(16).padStart(64, '0');

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: entryPointAddress, data: callData }, 'latest']
    })
  });

  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'Failed to fetch nonce');
  return BigInt(json.result || '0x0');
}

/**
 * Computes UserOpHash via EntryPoint v0.7 getUserOpHash call
 */
export async function getUserOpHash(rpcUrl, entryPointAddress, packedOp) {
  const sender = padBytes32(packedOp.sender);
  const nonce = pad64(packedOp.nonce);
  
  const initCodeBytes = fromHex(packedOp.initCode || '0x');
  const callDataBytes = fromHex(packedOp.callData || '0x');
  const accountGasLimits = padBytes32(packedOp.accountGasLimits);
  const preVerificationGas = pad64(packedOp.preVerificationGas);
  const gasFees = padBytes32(packedOp.gasFees);
  const paymasterAndDataBytes = fromHex(packedOp.paymasterAndData || '0x');
  const signatureBytes = fromHex(packedOp.signature || '0x');

  const headSize = 9 * 32;
  
  let dynamicOffset = headSize;
  const offInitCode = dynamicOffset;
  const initPadded = Math.ceil(initCodeBytes.length / 32) * 32;
  dynamicOffset += 32 + initPadded;

  const offCallData = dynamicOffset;
  const callPadded = Math.ceil(callDataBytes.length / 32) * 32;
  dynamicOffset += 32 + callPadded;

  const offPaymaster = dynamicOffset;
  const paymasterPadded = Math.ceil(paymasterAndDataBytes.length / 32) * 32;
  dynamicOffset += 32 + paymasterPadded;

  const offSig = dynamicOffset;
  const sigPadded = Math.ceil(signatureBytes.length / 32) * 32;

  const head = sender +
               nonce +
               pad64(offInitCode) +
               pad64(offCallData) +
               accountGasLimits +
               preVerificationGas +
               gasFees +
               pad64(offPaymaster) +
               pad64(offSig);

  const initData = pad64(initCodeBytes.length) + hex(initCodeBytes).padEnd(initPadded * 2, '0');
  const callData = pad64(callDataBytes.length) + hex(callDataBytes).padEnd(callPadded * 2, '0');
  const paymasterData = pad64(paymasterAndDataBytes.length) + hex(paymasterAndDataBytes).padEnd(paymasterPadded * 2, '0');
  const sigData = pad64(signatureBytes.length) + hex(signatureBytes).padEnd(sigPadded * 2, '0');

  // EntryPoint v0.7 getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) -> 0x22cdde4c
  const fullCalldata = '0x22cdde4c' + pad64(32) + head + initData + callData + paymasterData + sigData;

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_call',
      params: [{ to: entryPointAddress, data: fullCalldata }, 'latest']
    })
  });

  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'Failed to compute userOpHash');
  return json.result;
}

/**
 * Submits UserOperation to ERC-4337 Bundler
 */
export async function sendUserOpToBundler(bundlerUrl, packedOp, entryPointAddress) {
  // Unpack accountGasLimits: verificationGasLimit (first 16 bytes) | callGasLimit (last 16 bytes)
  const limitsHex = packedOp.accountGasLimits.replace(/^0x/, '').padStart(64, '0');
  const verificationGasLimit = BigInt('0x' + limitsHex.slice(0, 32));
  const callGasLimit = BigInt('0x' + limitsHex.slice(32, 64));

  // Unpack gasFees: maxPriorityFeePerGas (first 16 bytes) | maxFeePerGas (last 16 bytes)
  const feesHex = packedOp.gasFees.replace(/^0x/, '').padStart(64, '0');
  const maxPriorityFeePerGas = BigInt('0x' + feesHex.slice(0, 32));
  const maxFeePerGas = BigInt('0x' + feesHex.slice(32, 64));

  const rpcUserOp = {
    sender: packedOp.sender,
    nonce: '0x' + BigInt(packedOp.nonce).toString(16),
    callData: packedOp.callData,
    callGasLimit: '0x' + callGasLimit.toString(16),
    verificationGasLimit: '0x' + verificationGasLimit.toString(16),
    preVerificationGas: '0x' + BigInt(packedOp.preVerificationGas).toString(16),
    maxFeePerGas: '0x' + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
    signature: packedOp.signature
  };

  if (packedOp.initCode && packedOp.initCode !== '0x' && packedOp.initCode.length >= 42) {
    rpcUserOp.factory = packedOp.initCode.slice(0, 42);
    rpcUserOp.factoryData = '0x' + packedOp.initCode.slice(42);
  }
  if (packedOp.paymasterAndData && packedOp.paymasterAndData !== '0x' && packedOp.paymasterAndData.length >= 42) {
    rpcUserOp.paymaster = packedOp.paymasterAndData.slice(0, 42);
  }

  let response;
  try {
    response = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_sendUserOperation',
        params: [rpcUserOp, entryPointAddress]
      })
    });
  } catch (netErr) {
    throw new Error(`Bundler Network Connection Failed: ${netErr.message}. Check your bundler endpoint URL.`);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Bundler Authentication Failed (HTTP ${response.status}): Missing or invalid API key. Please configure a valid Base Sepolia bundler endpoint in Settings.`);
    }
    throw new Error(`Bundler HTTP Error ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();
  if (json.error) {
    const msg = json.error.message || '';
    if (msg.includes('AA21')) {
      throw new Error(`EntryPoint Revert [AA21]: Account does not have enough native ETH or EntryPoint deposit to pay gas prefund. Fund ${packedOp.sender} with Base Sepolia ETH.`);
    }
    if (msg.includes('AA22')) {
      throw new Error(`EntryPoint Revert [AA22]: Operation expired or not due (timestamp outside window).`);
    }
    if (msg.includes('AA23')) {
      throw new Error(`EntryPoint Revert [AA23]: Validation logic reverted inside account (policy violation or unauthorized agent).`);
    }
    if (msg.includes('AA24')) {
      throw new Error(`EntryPoint Revert [AA24]: Signature verification failed.`);
    }
    throw new Error(`Bundler Error (${json.error.code}): ${msg}`);
  }
  return json.result;
}

/**
 * Polls for UserOperation Receipt
 */
export async function pollUserOpReceipt(bundlerUrl, userOpHash, maxAttempts = 20, delayMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, delayMs));
    try {
      const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'eth_getUserOperationReceipt',
          params: [userOpHash]
        })
      });
      const json = await response.json();
      if (json.result) return json.result;
    } catch (e) {
      console.warn('Polling receipt attempt error:', e);
    }
  }
  return null;
}

/**
 * Automatically identifies which on-chain signer index (0, 1, etc.) produced the passkey signature.
 */
export async function identifySignerId(sig, signers) {
  try {
    const authDataBytes = fromHex(sig.authenticatorData);
    const cdBytes = new TextEncoder().encode(sig.clientDataJSON);
    const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', cdBytes));
    const total = new Uint8Array(authDataBytes.length + cdHash.length);
    total.set(authDataBytes, 0);
    total.set(cdHash, authDataBytes.length);
    const msgHash = new Uint8Array(await crypto.subtle.digest('SHA-256', total));

    const signature = new p256.Signature(BigInt(sig.r), BigInt(sig.s));

    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      if (!s || !s.x || !s.y) continue;
      const xBig = BigInt(s.x);
      const yBig = BigInt(s.y);
      const pub = new p256.ProjectivePoint(xBig, yBig, 1n);
      if (p256.verify(signature, msgHash, pub.toHex(false))) {
        return i;
      }
    }
  } catch (e) {
    console.warn('Signer auto-identification fallback:', e);
  }
  return 0;
}

/**
 * Builds the ERC-4337 v0.7 initCode for a counterfactual account deployment:
 * initCode = factoryAddress (20 bytes) || factoryCalldata (createAccount)
 */
export function buildAccountInitCode(factoryAddress, passkey0, passkey1, threshold = 10000000000000000n, salt = 1n) {
  const cleanFactory = factoryAddress.toLowerCase().replace(/^0x/, '');
  const p0x = padBytes32(passkey0.x);
  const p0y = padBytes32(passkey0.y);
  const p1x = padBytes32(passkey1.x);
  const p1y = padBytes32(passkey1.y);
  const threshHex = pad64(threshold);
  const saltHex = padBytes32(salt);

  const calldata = '0xf261e8a5' + p0x + p0y + p1x + p1y + threshHex + saltHex;
  return '0x' + cleanFactory + calldata.slice(2);
}

/**
 * Checks if smart account is deployed on-chain; if not, returns initCode for just-in-time creation
 */
export async function ensureAccountInitCode(rpcUrl, factoryAddress, accountAddress, signers, threshold = 10000000000000000n, salt = 1n) {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_getCode',
        params: [accountAddress, 'latest']
      })
    });
    const json = await res.json();
    if (json.result && json.result !== '0x' && json.result !== '0x0') {
      return '0x';
    }
  } catch (e) {
    console.warn('eth_getCode query failed:', e);
    return '0x';
  }

  if (!factoryAddress || !signers || signers.length < 2) {
    return '0x';
  }

  return buildAccountInitCode(factoryAddress, signers[0], signers[1], threshold, salt);
}

/**
 * Solicits gas sponsorship from an ERC-4337 Paymaster (Pimlico / Alchemy pm_sponsorUserOperation)
 */
export async function getPaymasterSponsorship(bundlerUrl, userOp, entryPoint) {
  if (!bundlerUrl) return null;
  try {
    const toHex = (val) => {
      if (typeof val === 'bigint') return '0x' + val.toString(16);
      if (typeof val === 'number') return '0x' + val.toString(16);
      return val;
    };

    const payload = {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      initCode: userOp.initCode || '0x',
      callData: userOp.callData || '0x',
      accountGasLimits: userOp.accountGasLimits,
      preVerificationGas: toHex(userOp.preVerificationGas),
      gasFees: userOp.gasFees,
      paymasterAndData: '0x',
      signature: '0x'
    };

    const res = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'pm_sponsorUserOperation',
        params: [payload, entryPoint]
      }, (key, value) => typeof value === 'bigint' ? '0x' + value.toString(16) : value)
    });
    const json = await res.json();
    if (json.result) {
      return json.result;
    }
  } catch (e) {
    console.warn('Paymaster sponsorship attempt failed, falling back to unsponsored:', e);
  }
  return null;
}

/**
 * Decodes high-level operation details from raw calldata
 */
export function decodeCalldataOperation(to = '', valueWei = 0n, calldata = '0x') {
  const cleanData = (calldata || '').replace(/^0x/, '');
  const cleanTo = (to || '').toLowerCase();
  
  // 1. Native ETH transfer
  if (!cleanData || cleanData.length === 0) {
    const ethVal = Number(BigInt(valueWei || '0')) / 1e18;
    return {
      type: 'ETH_TRANSFER',
      label: 'Native ETH Transfer',
      target: to,
      amountFormatted: `${ethVal.toFixed(4)} ETH`,
      amountValue: ethVal,
      isApproval: false,
      isUnlimitedApproval: false,
      riskLevel: 'safe',
      summary: `Transfer ${ethVal.toFixed(4)} ETH to ${to ? to.slice(0, 6) + '...' + to.slice(-4) : 'recipient'}`
    };
  }

  const selector = cleanData.slice(0, 8).toLowerCase();

  // 2. ERC-20 transfer(address to, uint256 amount) -> 0xa9059cbb
  if (selector === 'a9059cbb' && cleanData.length >= 72) {
    const recipient = '0x' + cleanData.slice(32, 72);
    const amountHex = cleanData.slice(72, 136);
    const rawAmount = BigInt('0x' + (amountHex || '0'));
    return {
      type: 'ERC20_TRANSFER',
      label: 'Token Transfer',
      tokenAddress: to,
      recipient,
      rawAmount: rawAmount.toString(),
      isApproval: false,
      isUnlimitedApproval: false,
      riskLevel: 'safe',
      summary: `Transfer tokens from ${to.slice(0, 6)}... to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`
    };
  }

  // 3. ERC-20 approve(address spender, uint256 amount) -> 0x095ea7b3
  if (selector === '095ea7b3' && cleanData.length >= 72) {
    const spender = '0x' + cleanData.slice(32, 72);
    const amountHex = cleanData.slice(72, 136);
    const rawAmount = BigInt('0x' + (amountHex || '0'));
    // Check if unlimited approval: >= 2^96 or 0xffffffff...
    const isUnlimited = rawAmount >= (1n << 96n) || rawAmount === (2n ** 256n - 1n);
    return {
      type: 'ERC20_APPROVE',
      label: isUnlimited ? 'Unlimited Token Approval' : 'Token Approval',
      tokenAddress: to,
      spender,
      rawAmount: rawAmount.toString(),
      isApproval: true,
      isUnlimitedApproval: isUnlimited,
      riskLevel: isUnlimited ? 'critical' : 'warning',
      summary: isUnlimited
        ? `Grant UNLIMITED token allowance to ${spender.slice(0, 6)}...${spender.slice(-4)}! DApp can drain approved balance.`
        : `Approve token allowance for ${spender.slice(0, 6)}...${spender.slice(-4)}`
    };
  }

  // 4. Uniswap V3 exactInputSingle -> 0x414bf382 or 0x04e45aaf
  if (selector === '414bf382' || selector === '04e45aaf') {
    return {
      type: 'SWAP',
      label: 'Uniswap V3 Swap',
      router: to,
      isApproval: false,
      isUnlimitedApproval: false,
      riskLevel: 'safe',
      summary: `Execute decentralized swap on Uniswap V3 router ${to.slice(0, 6)}...`
    };
  }

  // 5. Generic / Custom Contract Call
  return {
    type: 'CONTRACT_CALL',
    label: 'Contract Interaction',
    target: to,
    selector: '0x' + selector,
    isApproval: false,
    isUnlimitedApproval: false,
    riskLevel: 'warning',
    summary: `Execute contract method 0x${selector} on ${to.slice(0, 6)}...${to.slice(-4)}`
  };
}

/**
 * Simulates user operation against security policies & rolling spend windows
 */
export function simulateUserOpPolicy({
  valueWei = 0n,
  innerCall = '',
  dest = '',
  isFrozen = false,
  allowedAddresses = [],
  ethThreshold = 10000000000000000n, // 0.01 ETH
  ethWindowCap = 50000000000000000n, // 0.05 ETH
  spentInWindow = 0n
}) {
  const decoded = decodeCalldataOperation(dest, valueWei, innerCall);
  const isUntrusted = allowedAddresses.length > 0 && 
    !allowedAddresses.map(a => a.toLowerCase()).includes(dest.toLowerCase());

  const valBig = BigInt(valueWei || '0');
  const exceedsThreshold = valBig >= ethThreshold;
  const exceedsWindow = (spentInWindow + valBig) > ethWindowCap;
  const hasInnerCall = (innerCall && innerCall !== '0x' && innerCall.length > 0);
  
  let requiredSignatures = 1;
  let policyTag = '1-Sig (Instant)';
  let badgeClass = 'safe';
  let title = '● Safe Instant Operation';
  let description = 'Sub-threshold transfer. Authorized with 1 Touch ID biometric signature.';

  if (isFrozen) {
    requiredSignatures = 2;
    policyTag = '2-Sig (Frozen)';
    badgeClass = 'danger';
    title = '● Wallet is Frozen';
    description = 'All operations require 2-of-2 Hardware Passkey Quorum while wallet is frozen.';
  } else if (decoded.isUnlimitedApproval) {
    requiredSignatures = 2;
    policyTag = '2-Sig (High Risk)';
    badgeClass = 'danger';
    title = '● Unlimited Token Approval (High Risk)';
    description = 'DApp requests unlimited spend access. Requires 2-of-2 Hardware Quorum confirmation.';
  } else if (exceedsThreshold || exceedsWindow || hasInnerCall || isUntrusted) {
    requiredSignatures = 2;
    policyTag = '2-Sig (Quorum)';
    badgeClass = 'warning';
    title = '● 2-of-2 Hardware Quorum Required';

    const reasons = [];
    if (exceedsThreshold) reasons.push('amount exceeds per-op limit (0.01 ETH / $32)');
    if (exceedsWindow) reasons.push('exceeds 24h rolling spend window (0.05 ETH / $160)');
    if (hasInnerCall) reasons.push('custom contract execution');
    if (isUntrusted) reasons.push('unrecognized contract address');

    description = `Requires dual biometric hardware signers (${reasons.join(', ')}).`;
  }

  const windowUsagePercent = ethWindowCap > 0n 
    ? Math.min(100, Math.round(Number(((spentInWindow + valBig) * 100n) / ethWindowCap)))
    : 0;

  return {
    requiredSignatures,
    policyTag,
    badgeClass,
    title,
    description,
    decoded,
    windowUsagePercent
  };
}

/**
 * Encodes grantAgentSession(SessionConfig config) matching PasskeyAccount.sol
 */
export function encodeGrantAgentSession(config) {
  const sel = '5c433885'; // grantAgentSession selector
  const offTuple = pad64(32);

  const agentKeyWord = padBytes32(config.agentKey);
  const validAfterWord = pad64(config.validAfter);
  const validUntilWord = pad64(config.validUntil);
  const humanThresholdWord = pad64(config.humanApprovalThreshold || 0n);
  const perTxEthWord = pad64(config.perTxLimitEth || 0n);
  const perTxTokenWord = pad64(config.perTxLimitToken || 0n);
  const windowDurationWord = pad64(config.windowDuration || 86400n);

  let currentArrayOffset = 11 * 32; // 352

  const offProtocols = currentArrayOffset;
  const protocolsData = pad64(config.allowedProtocols.length) +
    config.allowedProtocols.map(p => padBytes32(p)).join('');
  currentArrayOffset += (1 + config.allowedProtocols.length) * 32;

  const offSelectors = currentArrayOffset;
  const selectorsData = pad64(config.allowedSelectors.length) +
    config.allowedSelectors.map(s => {
      const clean = (s.startsWith('0x') ? s.slice(2) : s).padEnd(8, '0');
      return clean.padEnd(64, '0');
    }).join('');
  currentArrayOffset += (1 + config.allowedSelectors.length) * 32;

  const offTokens = currentArrayOffset;
  const tokensData = pad64(config.allowedTokens.length) +
    config.allowedTokens.map(t => padBytes32(t)).join('');
  currentArrayOffset += (1 + config.allowedTokens.length) * 32;

  const offCaps = currentArrayOffset;
  const capsData = pad64(config.tokenWindowCaps.length) +
    config.tokenWindowCaps.map(c => pad64(c)).join('');

  const tupleBody = agentKeyWord +
    validAfterWord +
    validUntilWord +
    humanThresholdWord +
    perTxEthWord +
    perTxTokenWord +
    windowDurationWord +
    pad64(offProtocols) +
    pad64(offSelectors) +
    pad64(offTokens) +
    pad64(offCaps) +
    protocolsData +
    selectorsData +
    tokensData +
    capsData;

  return '0x' + sel + offTuple + tupleBody;
}

/**
 * Encodes account.execute(dest, value, func)
 */
export function encodeExecute(dest, valueWei, funcHex) {
  const cleanFunc = (funcHex || '0x').replace(/^0x/, '');
  const funcByteLen = cleanFunc.length / 2;
  const funcPadded = cleanFunc.padEnd(Math.ceil(cleanFunc.length / 64) * 64, '0');

  return '0xb61d27f6' +
    dest.replace(/^0x/, '').padStart(64, '0') +
    (typeof valueWei === 'bigint' ? valueWei.toString(16) : BigInt(valueWei).toString(16)).padStart(64, '0') +
    pad64(96) +
    pad64(funcByteLen) +
    funcPadded;
}

/**
 * Encodes account.executeByAgent(agentKey, dest, value, func)
 */
export function encodeExecuteByAgent(agentKey, dest, valueWei, funcHex) {
  const cleanFunc = (funcHex || '0x').replace(/^0x/, '');
  const funcByteLen = cleanFunc.length / 2;
  const funcPadded = cleanFunc.padEnd(Math.ceil(cleanFunc.length / 64) * 64, '0');

  return '0xaea6adc6' +
    agentKey.replace(/^0x/, '').padStart(64, '0').toLowerCase() +
    dest.replace(/^0x/, '').padStart(64, '0').toLowerCase() +
    (typeof valueWei === 'bigint' ? valueWei.toString(16) : BigInt(valueWei).toString(16)).padStart(64, '0') +
    pad64(128) +
    pad64(funcByteLen) +
    funcPadded;
}

/**
 * Packs an autonomous agent signature (sigType 0x01).
 * Layout: 0x01 || abi.encode(address agentKey, bytes agentSig)
 */
export function encodeAutonomousAgentSignature(agentAddress, ecdsaSigHex) {
  const cleanAddr = agentAddress.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const cleanSig = ecdsaSigHex.replace(/^0x/, '');
  const sigLen = cleanSig.length / 2;
  const paddedSig = cleanSig.padEnd(Math.ceil(sigLen / 32) * 64, '0');

  const encoded = cleanAddr +
    pad64(64) +
    pad64(sigLen) +
    paddedSig;

  return '0x01' + encoded;
}

/**
 * Encodes account.validateUserOp(PackedUserOperation, bytes32, uint256)
 * Selector: 0x19822f7c
 */
export function encodeValidateUserOp(packedOp, userOpHash, missingFunds = 0n) {
  const sender = padBytes32(packedOp.sender);
  const nonce = pad64(packedOp.nonce);
  const initCodeBytes = fromHex(packedOp.initCode || '0x');
  const callDataBytes = fromHex(packedOp.callData || '0x');
  const accountGasLimits = padBytes32(packedOp.accountGasLimits);
  const preVerificationGas = pad64(packedOp.preVerificationGas);
  const gasFees = padBytes32(packedOp.gasFees);
  const paymasterAndDataBytes = fromHex(packedOp.paymasterAndData || '0x');
  const signatureBytes = fromHex(packedOp.signature || '0x');

  const headSize = 9 * 32;
  let dynamicOffset = headSize;
  const offInitCode = dynamicOffset;
  const initPadded = Math.ceil(initCodeBytes.length / 32) * 32;
  dynamicOffset += 32 + initPadded;

  const offCallData = dynamicOffset;
  const callPadded = Math.ceil(callDataBytes.length / 32) * 32;
  dynamicOffset += 32 + callPadded;

  const offPaymaster = dynamicOffset;
  const paymasterPadded = Math.ceil(paymasterAndDataBytes.length / 32) * 32;
  dynamicOffset += 32 + paymasterPadded;

  const offSig = dynamicOffset;
  const sigPadded = Math.ceil(signatureBytes.length / 32) * 32;

  const tupleHead = sender +
               nonce +
               pad64(offInitCode) +
               pad64(offCallData) +
               accountGasLimits +
               preVerificationGas +
               gasFees +
               pad64(offPaymaster) +
               pad64(offSig);

  const initData = pad64(initCodeBytes.length) + hex(initCodeBytes).padEnd(initPadded * 2, '0');
  const callData = pad64(callDataBytes.length) + hex(callDataBytes).padEnd(callPadded * 2, '0');
  const paymasterData = pad64(paymasterAndDataBytes.length) + hex(paymasterAndDataBytes).padEnd(paymasterPadded * 2, '0');
  const sigData = pad64(signatureBytes.length) + hex(signatureBytes).padEnd(sigPadded * 2, '0');

  const tupleBody = tupleHead + initData + callData + paymasterData + sigData;
  const offTuple = pad64(96);
  const userOpHashWord = padBytes32(userOpHash);
  const missingFundsWord = pad64(missingFunds);

  return '0x19822f7c' + offTuple + userOpHashWord + missingFundsWord + tupleBody;
}

/**
 * Encodes Uniswap V3 exactInputSingle for SwapRouter02.
 * Selector: 0x04e45aaf
 */
export function encodeUniswapV3ExactInputSingle({
  tokenIn,
  tokenOut,
  fee = 3000,
  recipient,
  amountIn,
  amountOutMinimum,
  sqrtPriceLimitX96 = 0n
}) {
  const sel = '04e45aaf';
  const cleanTokenIn = tokenIn.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const cleanTokenOut = tokenOut.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const feeHex = BigInt(fee).toString(16).padStart(64, '0');
  const cleanRecipient = recipient.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const amtInHex = (typeof amountIn === 'bigint' ? amountIn.toString(16) : BigInt(amountIn).toString(16)).padStart(64, '0');
  const minOutHex = (typeof amountOutMinimum === 'bigint' ? amountOutMinimum.toString(16) : BigInt(amountOutMinimum).toString(16)).padStart(64, '0');
  const sqrtPriceHex = (typeof sqrtPriceLimitX96 === 'bigint' ? sqrtPriceLimitX96.toString(16) : BigInt(sqrtPriceLimitX96).toString(16)).padStart(64, '0');

  return '0x' + sel +
    cleanTokenIn +
    cleanTokenOut +
    feeHex +
    cleanRecipient +
    amtInHex +
    minOutHex +
    sqrtPriceHex;
}

/**
 * Encodes account.executeBatch(address[] dests, uint256[] values, bytes[] funcs)
 * Selector: 0x47e1da2a
 */
export function encodeExecuteBatch(dests, values, funcs) {
  if (dests.length !== values.length || dests.length !== funcs.length) {
    throw new Error('Array length mismatch in executeBatch');
  }
  const sel = '47e1da2a';
  const count = dests.length;

  const offsetDests = 96; // 0x60
  const destsSizeBytes = 32 + count * 32;
  const offsetValues = offsetDests + destsSizeBytes;
  const valuesSizeBytes = 32 + count * 32;
  const offsetFuncs = offsetValues + valuesSizeBytes;

  const head = pad64(offsetDests) + pad64(offsetValues) + pad64(offsetFuncs);

  let destsData = pad64(count);
  for (const d of dests) {
    destsData += d.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  }

  let valuesData = pad64(count);
  for (const v of values) {
    valuesData += (typeof v === 'bigint' ? v.toString(16) : BigInt(v).toString(16)).padStart(64, '0');
  }

  let funcsHead = pad64(count);
  let funcsBody = '';
  let currentFuncOffset = count * 32;

  const funcItems = funcs.map(f => {
    const clean = (f || '0x').replace(/^0x/, '');
    const byteLen = clean.length / 2;
    const padded = clean.padEnd(Math.ceil(clean.length / 64) * 64, '0');
    return { byteLen, padded };
  });

  for (const item of funcItems) {
    funcsHead += pad64(currentFuncOffset);
    funcsBody += pad64(item.byteLen) + item.padded;
    currentFuncOffset += 32 + (item.padded.length / 2);
  }

  return '0x' + sel + head + destsData + valuesData + funcsHead + funcsBody;
}

/**
 * Fetches live Uniswap V3 quote from QuoterV2 on Base Sepolia.
 */
export async function fetchUniswapQuote({
  rpcUrl,
  quoterAddress,
  tokenIn,
  tokenOut,
  amountIn,
  fee = 3000
}) {
  const sel = 'c6a5026a';
  const cleanIn = tokenIn.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const cleanOut = tokenOut.replace(/^0x/, '').padStart(64, '0').toLowerCase();
  const amtHex = (typeof amountIn === 'bigint' ? amountIn.toString(16) : BigInt(amountIn).toString(16)).padStart(64, '0');
  const feeHex = BigInt(fee).toString(16).padStart(64, '0');
  const sqrtPriceHex = '0'.padStart(64, '0');

  const calldata = '0x' + sel + cleanIn + cleanOut + amtHex + feeHex + sqrtPriceHex;

  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_call',
      params: [{ to: quoterAddress, data: calldata }, 'latest']
    })
  });

  if (!resp.ok) throw new Error(`Quoter RPC call failed: ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || 'Quoter error');
  if (!json.result || json.result === '0x') throw new Error('Quoter returned empty result');

  const hexResult = json.result.replace(/^0x/, '');
  const amountOutHex = hexResult.slice(0, 64);
  return BigInt('0x' + amountOutHex);
}

