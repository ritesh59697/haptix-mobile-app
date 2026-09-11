// WebAuthn, ERC-4337 UserOp Builder, and Bundler Client for Passkey Smart Wallet
import { p256 } from './p256.js';

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

    const sig = signatures[i];
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

    const structTotalBytes = structHead + authDataPayload + cdPayload;
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
 * Encodes grantAgentSession(SessionConfig config) matching PasskeyAccount.sol
 */
export function encodeGrantAgentSession(config) {
  const sel = '5c433885'; // grantAgentSession selector
  const offTuple = pad64(32);

  // Tuple fields (11 fields = 11 words = 352 bytes):
  // 0: agentKey (address)
  // 1: validAfter (uint48)
  // 2: validUntil (uint48)
  // 3: humanApprovalThreshold (uint256)
  // 4: perTxLimitEth (uint256)
  // 5: perTxLimitToken (uint256)
  // 6: windowDuration (uint256)
  // 7: offset to allowedProtocols (relative to start of tuple = 11 * 32 = 352 = 0x160)
  // 8: offset to allowedSelectors
  // 9: offset to allowedTokens
  // 10: offset to tokenWindowCaps
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

