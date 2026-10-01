import { PublicKey } from '@solana/web3.js'

export interface WysiwysVerificationOptions {
  expectedRecipient?: string
  expectedAmountLamports?: bigint | number
  expectedAmountSol?: number
}

export interface WysiwysVerificationResult {
  action: string
  details: string
  recipient?: string
  amountLamports?: bigint
}

/**
 * What You See Is What You Sign (WYSIWYS) payload inspection.
 *
 * Prevents malicious or rogue code from presenting an unknown binary blob to the
 * user's biometric authenticator or platform passkey hardware.
 *
 * Checks:
 * 1. Payload minimum length >= 16 bytes.
 * 2. Exact byte-length validation across all 7 authorized Haptix instruction payloads.
 * 3. Structured parameter parsing (recipient, amounts, thresholds).
 * 4. Screen-to-byte cross-verification: verifies expectedRecipient and expectedAmount
 *    against the payload bytes before biometric authorization is triggered.
 */
export function verifyWysiwysPayload(
  message: Uint8Array,
  options?: WysiwysVerificationOptions,
): WysiwysVerificationResult {
  if (message.length < 16) {
    throw new Error('WYSIWYS violation: payload is too short to be a valid Haptix authorization.')
  }
  const prefix = new TextDecoder().decode(message.subarray(0, 20))

  if (prefix.startsWith('TRANSFER:')) {
    if (message.length !== 97) {
      throw new Error(`WYSIWYS violation: malformed TRANSFER payload (${message.length} bytes, expected 97).`)
    }
    const recipientBytes = message.subarray(57, 89)
    const recipientB58 = new PublicKey(recipientBytes).toBase58()
    const amountLamports = new DataView(message.buffer, message.byteOffset + 89, 8).getBigUint64(0, true)
    const sol = Number(amountLamports) / 1e9

    if (options?.expectedRecipient) {
      if (recipientB58 !== options.expectedRecipient) {
        throw new Error(
          `WYSIWYS violation: recipient mismatch (payload: ${recipientB58}, screen: ${options.expectedRecipient}). Signing aborted.`,
        )
      }
    }
    if (options?.expectedAmountLamports !== undefined) {
      if (amountLamports !== BigInt(options.expectedAmountLamports)) {
        throw new Error(
          `WYSIWYS violation: amount mismatch (payload: ${amountLamports}, screen: ${options.expectedAmountLamports}). Signing aborted.`,
        )
      }
    }
    if (options?.expectedAmountSol !== undefined) {
      if (Math.abs(sol - options.expectedAmountSol) > 0.00000001) {
        throw new Error(
          `WYSIWYS violation: amount mismatch (payload: ${sol} SOL, screen: ${options.expectedAmountSol} SOL). Signing aborted.`,
        )
      }
    }

    return { action: 'Transfer', details: `${sol} SOL to ${recipientB58}`, recipient: recipientB58, amountLamports }
  }

  if (prefix.startsWith('SET_GUARDIAN:')) {
    if (message.length !== 93) {
      throw new Error(`WYSIWYS violation: malformed SET_GUARDIAN payload (${message.length} bytes, expected 93).`)
    }
    const guardianBytes = message.subarray(61, 93)
    const guardianB58 = new PublicKey(guardianBytes).toBase58()
    if (options?.expectedRecipient && options.expectedRecipient !== guardianB58) {
      throw new Error(
        `WYSIWYS violation: guardian mismatch (payload: ${guardianB58}, expected: ${options.expectedRecipient}).`,
      )
    }
    return { action: 'Set Guardian', details: `Guardian: ${guardianB58}`, recipient: guardianB58 }
  }

  if (prefix.startsWith('SET_THRESHOLD:')) {
    if (message.length !== 70) {
      throw new Error(`WYSIWYS violation: malformed SET_THRESHOLD payload (${message.length} bytes, expected 70).`)
    }
    const thresholdLamports = new DataView(message.buffer, message.byteOffset + 62, 8).getBigUint64(0, true)
    const sol = Number(thresholdLamports) / 1e9
    return { action: 'Set Spend Threshold', details: `Threshold: ${sol} SOL`, amountLamports: thresholdLamports }
  }

  if (prefix.startsWith('GRANT_AGENT:')) {
    if (message.length !== 140) {
      throw new Error(`WYSIWYS violation: malformed GRANT_AGENT payload (${message.length} bytes, expected 140).`)
    }
    const agentBytes = message.subarray(60, 92)
    const agentB58 = new PublicKey(agentBytes).toBase58()
    const allowanceLamports = new DataView(message.buffer, message.byteOffset + 92, 8).getBigUint64(0, true)
    const sol = Number(allowanceLamports) / 1e9
    return {
      action: 'Grant Agent Session',
      details: `Agent ${agentB58} cap: ${sol} SOL`,
      recipient: agentB58,
      amountLamports: allowanceLamports,
    }
  }

  if (prefix.startsWith('REVOKE_AGENT:')) {
    if (message.length !== 93) {
      throw new Error(`WYSIWYS violation: malformed REVOKE_AGENT payload (${message.length} bytes, expected 93).`)
    }
    const agentBytes = message.subarray(61, 93)
    const agentB58 = new PublicKey(agentBytes).toBase58()
    return { action: 'Revoke Agent Session', details: `Revoke agent ${agentB58}`, recipient: agentB58 }
  }

  if (prefix.startsWith('UNFREEZE_WALLET:')) {
    if (message.length !== 64) {
      throw new Error(`WYSIWYS violation: malformed UNFREEZE_WALLET payload (${message.length} bytes, expected 64).`)
    }
    return { action: 'Unfreeze Wallet', details: 'Wallet unfreeze authorization' }
  }

  if (prefix.startsWith('CANCEL_RECOVERY:')) {
    if (message.length !== 64) {
      throw new Error(`WYSIWYS violation: malformed CANCEL_RECOVERY payload (${message.length} bytes, expected 64).`)
    }
    return { action: 'Cancel Recovery', details: 'Guardian recovery veto authorization' }
  }

  throw new Error('WYSIWYS violation: refusing to sign unrecognized transaction payload. Biometric signing aborted.')
}
