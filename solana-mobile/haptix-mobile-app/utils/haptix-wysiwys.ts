/**
 * What You See Is What You Sign (WYSIWYS) payload inspection.
 *
 * Prevents malicious or rogue code from presenting an unknown binary blob to the
 * user's biometric authenticator or platform passkey hardware. If the payload
 * is not a recognized, structured Haptix instruction, signing is rejected.
 */
export function verifyWysiwysPayload(message: Uint8Array): { action: string; details: string } {
  if (message.length < 16) {
    throw new Error('WYSIWYS violation: payload is too short to be a valid Haptix authorization.')
  }
  const prefix = new TextDecoder().decode(message.subarray(0, 20))
  if (prefix.startsWith('TRANSFER:')) {
    if (message.length !== 97) {
      throw new Error(`WYSIWYS violation: malformed TRANSFER payload (${message.length} bytes, expected 97).`)
    }
    const amountLamports = new DataView(message.buffer, message.byteOffset + 89, 8).getBigUint64(0, true)
    const sol = Number(amountLamports) / 1e9
    return { action: 'Transfer', details: `${sol} SOL` }
  }
  if (prefix.startsWith('SET_GUARDIAN:')) {
    if (message.length !== 93) {
      throw new Error(`WYSIWYS violation: malformed SET_GUARDIAN payload (${message.length} bytes, expected 93).`)
    }
    return { action: 'Set Guardian', details: 'Guardian policy update' }
  }
  if (prefix.startsWith('SET_THRESHOLD:')) {
    if (message.length !== 70) {
      throw new Error(`WYSIWYS violation: malformed SET_THRESHOLD payload (${message.length} bytes, expected 70).`)
    }
    return { action: 'Set Spend Threshold', details: 'Spending guardrail update' }
  }
  if (prefix.startsWith('GRANT_AGENT:')) {
    return { action: 'Grant Agent Session', details: 'Autonomous agent session authorization' }
  }
  if (prefix.startsWith('REVOKE_AGENT:')) {
    return { action: 'Revoke Agent Session', details: 'Agent session revocation' }
  }
  if (prefix.startsWith('UNFREEZE_WALLET:')) {
    return { action: 'Unfreeze Wallet', details: 'Wallet unfreeze authorization' }
  }
  if (prefix.startsWith('CANCEL_RECOVERY:')) {
    return { action: 'Cancel Recovery', details: 'Guardian recovery veto authorization' }
  }
  throw new Error('WYSIWYS violation: refusing to sign unrecognized transaction payload. Biometric signing aborted.')
}
