use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as instructions_sysvar;
use crate::constants::SECP256R1_PROGRAM_ID;
use crate::error::HaptixError;

/// Length of a compact secp256r1 signature, `r || s`.
pub const SIGNATURE_LEN: usize = 64;

/// Length of a compressed secp256r1 public key.
pub const PUBKEY_LEN: usize = 33;

/// Size of the fixed preamble of a single-entry `Secp256r1SigVerify` instruction:
/// `num_signatures: u8`, `padding: u8`, then one 14-byte offsets struct.
const HEADER_SIZE: usize = 16;

/// A byte range inside the precompile instruction data.
#[derive(Clone, Copy)]
struct Region {
    start: usize,
    end: usize,
}

impl Region {
    fn new(start: u16, len: usize) -> Result<Self> {
        let start = start as usize;
        let end = start
            .checked_add(len)
            .ok_or_else(|| error!(HaptixError::InvalidPasskeySignature))?;
        Ok(Self { start, end })
    }

    fn overlaps(self, other: Self) -> bool {
        self.start < other.end && other.start < self.end
    }
}

fn read_u16(data: &[u8], at: usize) -> Result<u16> {
    let end = at
        .checked_add(2)
        .ok_or_else(|| error!(HaptixError::InvalidPasskeySignature))?;
    let bytes = data
        .get(at..end)
        .ok_or_else(|| error!(HaptixError::InvalidPasskeySignature))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// Validates precompile instruction data against the exact passkey and message that
/// the caller requires, by parsing the offsets struct and binding each region.
///
/// The runtime only guarantees that the signature is valid for *whichever* key and
/// message the offsets point at, so this must bind them explicitly:
///
/// - exactly one signature, zero padding;
/// - all three offsets must resolve within this instruction;
/// - the public key region must equal `expected_pubkey` byte-for-byte;
/// - the message region must equal `expected_message` byte-for-byte, same length;
/// - the three regions must not overlap, so no region can impersonate another;
/// - no trailing bytes after the last region, so nothing can be smuggled in.
pub fn parse_precompile_data(
    data: &[u8],
    expected_pubkey: &[u8; PUBKEY_LEN],
    expected_message: &[u8],
) -> Result<()> {
    if data.len() < HEADER_SIZE {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    // Exactly one signature verified in this instruction, and zero padding.
    if data[0] != 1 || data[1] != 0 {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    let signature_offset = read_u16(data, 2)?;
    let signature_instruction_index = read_u16(data, 4)?;
    let public_key_offset = read_u16(data, 6)?;
    let public_key_instruction_index = read_u16(data, 8)?;
    let message_offset = read_u16(data, 10)?;
    let message_size = read_u16(data, 12)?;
    let message_instruction_index = read_u16(data, 14)?;

    // All three regions must come from *this* instruction. `u16::MAX` is the
    // sentinel for the current instruction; any other index refers to a sibling
    // instruction and is not covered by the binding below.
    if signature_instruction_index != u16::MAX
        || public_key_instruction_index != u16::MAX
        || message_instruction_index != u16::MAX
    {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    // A signature over nothing is never a valid authorization.
    if expected_message.is_empty() || message_size as usize != expected_message.len() {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    let signature = Region::new(signature_offset, SIGNATURE_LEN)?;
    let public_key = Region::new(public_key_offset, PUBKEY_LEN)?;
    let message = Region::new(message_offset, expected_message.len())?;

    // Overlapping regions would let one field masquerade as another.
    if signature.overlaps(public_key) || signature.overlaps(message) || public_key.overlaps(message) {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    // Reject trailing bytes: otherwise unrelated data could be appended to the
    // instruction, which is exactly how a mismatched key could be smuggled in.
    let expected_len = signature.end.max(public_key.end).max(message.end);
    if data.len() != expected_len {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    if data[public_key.start..public_key.end] != expected_pubkey[..] {
        return err!(HaptixError::Unauthorized);
    }

    if data[message.start..message.end] != expected_message[..] {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    Ok(())
}

/// Validates that the instruction at `ix_index` in the transaction is a well-formed
/// Secp256r1SigVerify precompile instruction bound to `expected_pubkey` over
/// `expected_message`.
///
/// The precompile itself aborts the transaction if the signature is cryptographically
/// invalid, so the remaining obligation is that it verified the key and payload we
/// actually asked for.
pub fn verify_passkey_precompile_signature(
    instructions_sysvar_account: &AccountInfo,
    ix_index: u16,
    expected_pubkey: &[u8; PUBKEY_LEN],
    expected_message: &[u8],
) -> Result<()> {
    let instruction = instructions_sysvar::load_instruction_at_checked(
        ix_index as usize,
        instructions_sysvar_account,
    )
    .map_err(|_| error!(HaptixError::InvalidPasskeySignature))?;

    if instruction.program_id != SECP256R1_PROGRAM_ID {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    parse_precompile_data(&instruction.data, expected_pubkey, expected_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pubkey(seed: u8) -> [u8; PUBKEY_LEN] {
        let mut key = [0u8; PUBKEY_LEN];
        key[0] = 0x02;
        key[1..].fill(seed);
        key
    }

    fn signature(seed: u8) -> [u8; SIGNATURE_LEN] {
        [seed; SIGNATURE_LEN]
    }

    /// Builds well-formed precompile data, optionally appending unbound junk.
    fn build(sig: &[u8; SIGNATURE_LEN], key: &[u8; PUBKEY_LEN], message: &[u8], junk: &[u8]) -> Vec<u8> {
        let mut data = vec![0u8; HEADER_SIZE];
        data[0] = 1;

        let signature_offset = HEADER_SIZE as u16;
        let public_key_offset = signature_offset + SIGNATURE_LEN as u16;
        let message_offset = public_key_offset + PUBKEY_LEN as u16;

        data[2..4].copy_from_slice(&signature_offset.to_le_bytes());
        data[4..6].copy_from_slice(&u16::MAX.to_le_bytes());
        data[6..8].copy_from_slice(&public_key_offset.to_le_bytes());
        data[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        data[10..12].copy_from_slice(&message_offset.to_le_bytes());
        data[12..14].copy_from_slice(&(message.len() as u16).to_le_bytes());
        data[14..16].copy_from_slice(&u16::MAX.to_le_bytes());

        data.extend_from_slice(sig);
        data.extend_from_slice(key);
        data.extend_from_slice(message);
        data.extend_from_slice(junk);
        data
    }

    fn transfer_message(recipient: u8, amount: u64) -> Vec<u8> {
        let mut message = vec![recipient; 32];
        message.extend_from_slice(&amount.to_le_bytes());
        message
    }

    #[test]
    fn accepts_well_formed_instruction() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let data = build(&signature(0x01), &key, &message, &[]);

        assert!(parse_precompile_data(&data, &key, &message).is_ok());
    }

    #[test]
    fn rejects_attacker_signature_with_victim_key_appended() {
        // The forgery this check exists to stop: a real signature from the attacker's
        // key over the right message, with the victim's key in trailing junk.
        let victim_key = pubkey(0xAA);
        let attacker_key = pubkey(0xBB);
        let message = transfer_message(0x11, 42);
        let data = build(&signature(0x01), &attacker_key, &message, &victim_key);

        assert!(parse_precompile_data(&data, &victim_key, &message).is_err());
    }

    #[test]
    fn rejects_victim_key_appended_with_padding_between() {
        let victim_key = pubkey(0xAA);
        let attacker_key = pubkey(0xBB);
        let message = transfer_message(0x11, 42);
        let mut junk = vec![0u8; 32];
        junk.extend_from_slice(&victim_key);
        let data = build(&signature(0x01), &attacker_key, &message, &junk);

        assert!(parse_precompile_data(&data, &victim_key, &message).is_err());
    }

    #[test]
    fn rejects_public_key_mismatch() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let data = build(&signature(0x01), &key, &message, &[]);

        assert!(parse_precompile_data(&data, &pubkey(0xBB), &message).is_err());
    }

    #[test]
    fn rejects_message_mismatch() {
        let key = pubkey(0xAA);
        let signed = transfer_message(0x11, 42);
        let claimed = transfer_message(0x11, 1_000_000);
        let data = build(&signature(0x01), &key, &signed, &[]);

        assert!(parse_precompile_data(&data, &key, &claimed).is_err());
    }

    #[test]
    fn rejects_message_length_change_without_trailing_junk() {
        let key = pubkey(0xAA);
        let signed = transfer_message(0x11, 42);
        let data = build(&signature(0x01), &key, &signed, &[]);

        // A shorter claimed message must not match a prefix of the signed payload.
        assert!(parse_precompile_data(&data, &key, &signed[..39]).is_err());
    }

    #[test]
    fn rejects_overlapping_public_key_and_message_regions() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let mut data = build(&signature(0x01), &key, &message, &[]);

        // Point the public key at the message region so it cannot be inspected apart.
        let message_offset = (HEADER_SIZE + SIGNATURE_LEN + PUBKEY_LEN) as u16;
        data[6..8].copy_from_slice(&message_offset.to_le_bytes());

        assert!(parse_precompile_data(&data, &key, &message).is_err());
    }

    #[test]
    fn rejects_sibling_instruction_reference() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let mut data = build(&signature(0x01), &key, &message, &[]);

        data[4..6].copy_from_slice(&0u16.to_le_bytes());

        assert!(parse_precompile_data(&data, &key, &message).is_err());
    }

    #[test]
    fn rejects_multiple_signatures_or_padding() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);

        let mut two_signatures = build(&signature(0x01), &key, &message, &[]);
        two_signatures[0] = 2;
        assert!(parse_precompile_data(&two_signatures, &key, &message).is_err());

        let mut padded = build(&signature(0x01), &key, &message, &[]);
        padded[1] = 1;
        assert!(parse_precompile_data(&padded, &key, &message).is_err());
    }

    #[test]
    fn rejects_truncated_and_empty_input() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let data = build(&signature(0x01), &key, &message, &[]);

        assert!(parse_precompile_data(&data[..HEADER_SIZE], &key, &message).is_err());
        assert!(parse_precompile_data(&[], &key, &message).is_err());
        assert!(parse_precompile_data(&data, &key, &[]).is_err());
    }

    #[test]
    fn rejects_out_of_bounds_offsets() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let mut data = build(&signature(0x01), &key, &message, &[]);

        data[10..12].copy_from_slice(&60_000u16.to_le_bytes());

        assert!(parse_precompile_data(&data, &key, &message).is_err());
    }

    /// Bytes produced by the real client builder
    /// (`solana-mobile/haptix-mobile-app/utils/secp256r1-instruction.ts`) for a
    /// 40-byte transfer payload: recipient `0x11` x32, amount `42` u64 LE.
    ///
    /// This pins the on-chain parser to the client's actual output, so a layout
    /// change on either side breaks the build instead of failing at runtime.
    const CLIENT_FIXTURE_HEX: &str = concat!(
        "01001000ffff5000ffff71002800ffff", // counts + offsets struct
        "0101010101010101010101010101010101010101010101010101010101010101", // signature r
        "0101010101010101010101010101010101010101010101010101010101010101", // signature s
        "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // pubkey
        "1111111111111111111111111111111111111111111111111111111111111111", // recipient
        "2a00000000000000", // amount u64 LE
    );

    fn decode_hex(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex fixture"))
            .collect()
    }

    #[test]
    fn accepts_exact_client_builder_output() {
        let data = decode_hex(CLIENT_FIXTURE_HEX);
        assert_eq!(data.len(), 153);

        let mut key = [0u8; PUBKEY_LEN];
        key[0] = 0x02;
        key[1..].fill(0xAA);

        let mut message = vec![0x11u8; 32];
        message.extend_from_slice(&42u64.to_le_bytes());

        assert!(parse_precompile_data(&data, &key, &message).is_ok());
    }

    #[test]
    fn rejects_client_fixture_with_victim_key_appended() {
        let mut forged = decode_hex(CLIENT_FIXTURE_HEX);

        let mut key = [0u8; PUBKEY_LEN];
        key[0] = 0x02;
        key[1..].fill(0xAA);

        let mut message = vec![0x11u8; 32];
        message.extend_from_slice(&42u64.to_le_bytes());

        forged.extend_from_slice(&key);

        assert!(parse_precompile_data(&forged, &key, &message).is_err());
    }
}
