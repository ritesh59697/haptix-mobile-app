use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as instructions_sysvar;
use crate::constants::SECP256R1_PROGRAM_ID;
use crate::error::HaptixError;

/// Validates that an instruction at `ix_index` in the transaction is a valid
/// Secp256r1SigVerify precompile instruction for the expected public key and message.
pub fn verify_passkey_precompile_signature(
    instructions_sysvar_account: &AccountInfo,
    ix_index: u16,
    expected_pubkey: &[u8; 33],
    expected_message: &[u8],
) -> Result<()> {
    // Load the instruction at ix_index using sysvar introspection
    let instruction = instructions_sysvar::load_instruction_at_checked(
        ix_index as usize,
        instructions_sysvar_account,
    ).map_err(|_| HaptixError::InvalidPasskeySignature)?;

    // Verify program id is the Secp256r1 precompile
    if instruction.program_id != SECP256R1_PROGRAM_ID {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    let data = &instruction.data;
    // The secp256r1 precompile instruction data format:
    // [0..1]: num_signatures (u8)
    // [1..2]: padding
    // [2..18]: Secp256r1SignatureOffsets
    // Followed by raw signature (64 bytes), public key (33 bytes), and message bytes
    if data.len() < 18 + 64 + 33 {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    // Verify public key matches expected passkey
    // Find expected_pubkey in data
    let mut found_pubkey = false;
    for window in data.windows(33) {
        if window == expected_pubkey {
            found_pubkey = true;
            break;
        }
    }
    if !found_pubkey {
        return err!(HaptixError::Unauthorized);
    }

    // Verify message matches expected message
    if !expected_message.is_empty() {
        let mut found_msg = false;
        for window in data.windows(expected_message.len()) {
            if window == expected_message {
                found_msg = true;
                break;
            }
        }
        if !found_msg {
            return err!(HaptixError::InvalidPasskeySignature);
        }
    }

    Ok(())
}
