// WebAuthn and UserOp Module for Chrome Extension

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = h => new Uint8Array((h.startsWith('0x') ? h.slice(2) : h).match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
export const pad64 = n => (typeof n === 'bigint' ? n.toString(16) : BigInt(n).toString(16)).padStart(64, '0');
export const padBytes32 = h => (h.startsWith('0x') ? h.slice(2) : h).padStart(64, '0');

export function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseDERSignature(sigBuffer) {
  const der = new Uint8Array(sigBuffer);
  let offset = 2;
  
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for r');
  const rLen = der[offset + 1];
  let rBytes = der.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;

  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for s');
  const sLen = der[offset + 1];
  let sBytes = der.slice(offset + 2, offset + 2 + sLen);

  const trimLeading = b => {
    let i = 0;
    while (i < b.length - 32 && b[i] === 0) i++;
    return b.slice(i);
  };
  
  let rBig = BigInt('0x' + hex(trimLeading(rBytes)));
  let sBig = BigInt('0x' + hex(trimLeading(sBytes)));

  if (sBig > P256_N / 2n) {
    sBig = P256_N - sBig;
  }

  return {
    r: '0x' + pad64(rBig),
    s: '0x' + pad64(sBig)
  };
}

export async function registerPasskey(accountName = 'Passkey Extension Key') {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'Passkey Smart Wallet Extension'
      },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: accountName,
        displayName: accountName
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required'
      },
      timeout: 60000
    }
  });

  return {
    id: credential.id,
    rawId: '0x' + hex(credential.rawId),
    createdAt: Date.now()
  };
}

export async function signWithPasskey(challenge32Bytes) {
  const challengeBuf = typeof challenge32Bytes === 'string' 
    ? fromHex(challenge32Bytes) 
    : challenge32Bytes;

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuf,
        userVerification: 'required',
        timeout: 60000
      }
    });
  } catch (err) {
    console.warn('No passkey found on extension origin, prompting 1-tap enrollment...', err);
    await registerPasskey('Primary Biometric (Key #0)');
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuf,
        userVerification: 'required',
        timeout: 60000
      }
    });
  }

  const resp = assertion.response;
  const authDataHex = '0x' + hex(new Uint8Array(resp.authenticatorData));
  const clientDataJSON = new TextDecoder('utf-8').decode(resp.clientDataJSON);
  const derSig = parseDERSignature(resp.signature);

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

export function encodeSignaturePayload(signerIds, signatures) {
  const offsetSignerIds = 64;
  let idsData = pad64(signerIds.length);
  for (const id of signerIds) idsData += pad64(id);
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
  return BigInt(json.result || '0x0');
}

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

export async function sendUserOpToBundler(bundlerUrl, packedOp, entryPointAddress) {
  const rpcUserOp = {
    sender: packedOp.sender,
    nonce: '0x' + BigInt(packedOp.nonce).toString(16),
    initCode: packedOp.initCode || '0x',
    callData: packedOp.callData,
    accountGasLimits: packedOp.accountGasLimits,
    preVerificationGas: '0x' + BigInt(packedOp.preVerificationGas).toString(16),
    gasFees: packedOp.gasFees,
    paymasterAndData: packedOp.paymasterAndData || '0x',
    signature: packedOp.signature
  };

  const response = await fetch(bundlerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_sendUserOperation',
      params: [rpcUserOp, entryPointAddress]
    })
  });

  const json = await response.json();
  if (json.error) throw new Error(`Bundler: ${json.error.message}`);
  return json.result;
}
