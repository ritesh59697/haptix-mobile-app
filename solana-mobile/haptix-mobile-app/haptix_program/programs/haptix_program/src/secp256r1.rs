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

/// Mode selector carried in the precompile instruction's `padding` byte.
///
/// The runtime's precompile deliberately does not read or validate `data[1]`
/// (`// We do not check or use the byte at data[1]` in the Agave `secp256r1`
/// precompile), so it is free for the program to use as a discriminator between
/// the two accepted signature formats.
pub const MODE_LEGACY: u8 = 0x00;
pub const MODE_WEBAUTHN: u8 = 0x01;

/// Offset of the `clientDataJSON` length prefix, present only in WebAuthn mode.
///
/// The precompile hashes whatever byte range the message offsets point at, and does
/// not care what sits between the 16-byte offsets header and the first region, so the
/// extra length can live there without disturbing the runtime.
const WEBAUTHN_CDJ_LEN_OFFSET: usize = HEADER_SIZE;
const WEBAUTHN_SIGNATURE_OFFSET: usize = WEBAUTHN_CDJ_LEN_OFFSET + 2;
const WEBAUTHN_PUBKEY_OFFSET: usize = WEBAUTHN_SIGNATURE_OFFSET + SIGNATURE_LEN;
const WEBAUTHN_MESSAGE_OFFSET: usize = WEBAUTHN_PUBKEY_OFFSET + PUBKEY_LEN;

/// Validates precompile instruction data against the exact passkey and message that
/// the caller requires, by parsing the offsets struct and binding each region.
///
/// Two formats are accepted, selected by [`MODE_LEGACY`] / [`MODE_WEBAUTHN`] in the
/// padding byte. Both bind the public key region to `expected_pubkey` byte-for-byte,
/// so a signature from any other key is rejected before anything else is considered.
pub fn parse_precompile_data(
    data: &[u8],
    expected_pubkey: &[u8; PUBKEY_LEN],
    expected_message: &[u8],
) -> Result<()> {
    if data.len() < HEADER_SIZE {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    // Exactly one signature verified in this instruction.
    if data[0] != 1 {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    // A signature over nothing is never a valid authorization.
    if expected_message.is_empty() {
        return err!(HaptixError::InvalidPasskeySignature);
    }

    match data[1] {
        MODE_LEGACY => parse_legacy_data(data, expected_pubkey, expected_message),
        MODE_WEBAUTHN => parse_webauthn_data(data, expected_pubkey, expected_message),
        _ => err!(HaptixError::InvalidPasskeySignature),
    }
}

/// The original format: the message region must be byte-identical to the payload the
/// instruction authorizes, so the precompile's digest covers exactly that payload.
fn parse_legacy_data(
    data: &[u8],
    expected_pubkey: &[u8; PUBKEY_LEN],
    expected_message: &[u8],
) -> Result<()> {
    // Zero padding: the slot is unused in this mode.
    if data[1] != MODE_LEGACY {
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

    if message_size as usize != expected_message.len() {
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

/// The hardware (WebAuthn) format.
///
/// A platform authenticator will not sign an arbitrary payload: it signs
/// `authenticatorData || SHA-256(clientDataJSON)`. Pointing the precompile's message
/// region at exactly those bytes makes the digest it verifies identical to the digest
/// the authenticator produced, so the precompile call is unchanged in substance.
///
/// `clientDataJSON` itself must sit *outside* that region — including it would change
/// the digest — and is bound by the signature through the 32-byte hash inside it.
///
/// What changes is that the message region is now *caller-supplied* rather than
/// computed by this program, so byte-binding it to the payload is impossible and
/// useless. [`crate::webauthn::verify_assertion`] replaces that binding by validating
/// the assertion's structure and requiring its `challenge` to decode to exactly
/// `expected_message`.
///
/// Layout (offsets are fixed so nothing can be smuggled into the gaps):
///
/// ```text
/// [0]        num_signatures = 1
/// [1]        mode = 0x01
/// [2..4]     signature_offset = 18
/// [4..6]     signature_instruction_index = u16::MAX
/// [6..8]     public_key_offset = 82
/// [8..10]    public_key_instruction_index = u16::MAX
/// [10..12]   message_offset = 115
/// [12..14]   message_size = M
/// [14..16]   message_instruction_index = u16::MAX
/// [16..18]   clientDataJSON length L (u16 LE)
/// [18..82]   signature (64)
/// [82..115]  compressed public key (33)
/// [115..115+M]     message region = authData || sha256(clientDataJSON)
/// [115+M..115+M+L] clientDataJSON
/// ```
fn parse_webauthn_data(
    data: &[u8],
    expected_pubkey: &[u8; PUBKEY_LEN],
    expected_message: &[u8],
) -> Result<()> {
    if read_u16(data, 2)? != WEBAUTHN_SIGNATURE_OFFSET as u16
        || read_u16(data, 4)? != u16::MAX
        || read_u16(data, 6)? != WEBAUTHN_PUBKEY_OFFSET as u16
        || read_u16(data, 8)? != u16::MAX
        || read_u16(data, 10)? != WEBAUTHN_MESSAGE_OFFSET as u16
        || read_u16(data, 14)? != u16::MAX
    {
        return err!(HaptixError::InvalidWebAuthnAssertion);
    }

    let message_size = read_u16(data, 12)? as usize;
    let client_data_len = read_u16(data, WEBAUTHN_CDJ_LEN_OFFSET)? as usize;

    // Exact length: this mode has no spare room for smuggled data either.
    let expected_len = WEBAUTHN_MESSAGE_OFFSET
        .checked_add(message_size)
        .and_then(|len| len.checked_add(client_data_len))
        .ok_or_else(|| error!(HaptixError::InvalidWebAuthnAssertion))?;
    if data.len() != expected_len {
        return err!(HaptixError::InvalidWebAuthnAssertion);
    }

    // `authData || sha256(clientDataJSON)`: the hash trailer pins the clientDataJSON
    // suffix, so the split is committed by the signature rather than trusted.
    let hash_len = crate::webauthn::CLIENT_DATA_HASH_LEN;
    if message_size < crate::webauthn::MIN_AUTH_DATA_LEN + hash_len {
        return err!(HaptixError::InvalidWebAuthnAssertion);
    }
    let region = &data[WEBAUTHN_MESSAGE_OFFSET..WEBAUTHN_MESSAGE_OFFSET + message_size];
    let split = message_size - hash_len;
    let auth_data = &region[..split];
    let client_data_hash = &region[split..];
    let client_data_json = &data[WEBAUTHN_MESSAGE_OFFSET + message_size..];

    if data[WEBAUTHN_PUBKEY_OFFSET..WEBAUTHN_PUBKEY_OFFSET + PUBKEY_LEN] != expected_pubkey[..] {
        return err!(HaptixError::Unauthorized);
    }

    crate::webauthn::verify_assertion(auth_data, client_data_json, client_data_hash, expected_message)
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
    use crate::webauthn::test_support::{signed_message, signed_message_from, PAYLOAD};
    use crate::webauthn::RP_ID;

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

    // -----------------------------------------------------------------------
    // WebAuthn (hardware passkey) mode
    // -----------------------------------------------------------------------

    use anchor_lang::solana_program::hash::hash;

    /// A real assertion: `authData` for `haptix.io` plus the clientDataJSON that
    /// commits to `PAYLOAD` as the challenge.
    fn assertion(origin: &str, flags: u8) -> (Vec<u8>, Vec<u8>) {
        let auth_data = crate::webauthn::test_support::auth_data(RP_ID, flags);
        let client_data_json = crate::webauthn::test_support::client_data(
            &crate::webauthn::test_support::b64url(PAYLOAD),
            "webauthn.get",
            origin,
        );
        (auth_data, client_data_json)
    }

    /// Builds a precompile instruction in the fixed WebAuthn layout: the message
    /// region is `authData || sha256(clientDataJSON)`, and the clientDataJSON itself
    /// follows it, outside the signed region.
    fn build_webauthn(
        sig: &[u8; SIGNATURE_LEN],
        key: &[u8; PUBKEY_LEN],
        auth_data: &[u8],
        client_data_json: &[u8],
    ) -> Vec<u8> {
        let mut region = auth_data.to_vec();
        region.extend_from_slice(&hash(client_data_json).to_bytes());

        let mut data = vec![0u8; WEBAUTHN_MESSAGE_OFFSET];
        data[0] = 1;
        data[1] = MODE_WEBAUTHN;
        data[2..4].copy_from_slice(&(WEBAUTHN_SIGNATURE_OFFSET as u16).to_le_bytes());
        data[4..6].copy_from_slice(&u16::MAX.to_le_bytes());
        data[6..8].copy_from_slice(&(WEBAUTHN_PUBKEY_OFFSET as u16).to_le_bytes());
        data[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        data[10..12].copy_from_slice(&(WEBAUTHN_MESSAGE_OFFSET as u16).to_le_bytes());
        data[12..14].copy_from_slice(&(region.len() as u16).to_le_bytes());
        data[14..16].copy_from_slice(&u16::MAX.to_le_bytes());
        data[16..18].copy_from_slice(&(client_data_json.len() as u16).to_le_bytes());

        data[WEBAUTHN_SIGNATURE_OFFSET..WEBAUTHN_SIGNATURE_OFFSET + SIGNATURE_LEN].copy_from_slice(sig);
        data[WEBAUTHN_PUBKEY_OFFSET..WEBAUTHN_PUBKEY_OFFSET + PUBKEY_LEN].copy_from_slice(key);
        data.extend_from_slice(&region);
        data.extend_from_slice(client_data_json);
        data
    }

    /// The happy path for both origins an authenticator can report.
    fn valid_instruction(origin: &str) -> (Vec<u8>, [u8; PUBKEY_LEN]) {
        let key = pubkey(0xAA);
        let (ad, cdj) = assertion(origin, 0x05);
        (build_webauthn(&signature(0x01), &key, &ad, &cdj), key)
    }

    #[test]
    fn accepts_hardware_webauthn_assertion() {
        let (data, key) = valid_instruction("https://haptix-passkeys.vercel.app");
        assert!(parse_precompile_data(&data, &key, PAYLOAD).is_ok());
    }

    #[test]
    fn accepts_hardware_assertion_with_android_origin() {
        let cert_hash = crate::webauthn::test_support::b64url(&[0x11u8; 32]);
        let (data, key) = valid_instruction(&format!("android:apk-key-hash:{cert_hash}"));
        assert!(parse_precompile_data(&data, &key, PAYLOAD).is_ok());
    }

    /// The whole point of the format: an assertion the authenticator really produced,
    /// but for somebody else's transfer, must not authorize this one.
    #[test]
    fn rejects_hardware_assertion_for_a_different_payload() {
        let (data, key) = valid_instruction("https://haptix-passkeys.vercel.app");

        let mut other = PAYLOAD.to_vec();
        other[0] = b'X';
        assert!(parse_precompile_data(&data, &key, &other).is_err());
    }

    #[test]
    fn rejects_hardware_assertion_under_a_foreign_pubkey() {
        let (data, _) = valid_instruction("https://haptix-passkeys.vercel.app");
        assert!(parse_precompile_data(&data, &pubkey(0xBB), PAYLOAD).is_err());
    }

    #[test]
    fn rejects_hardware_assertion_with_wrong_relying_party() {
        let key = pubkey(0xAA);
        let auth_data = crate::webauthn::test_support::auth_data(b"evil.example", 0x05);
        let (_, cdj) = assertion("https://haptix-passkeys.vercel.app", 0x05);
        let data = build_webauthn(&signature(0x01), &key, &auth_data, &cdj);

        assert!(parse_precompile_data(&data, &key, PAYLOAD).is_err());
    }

    #[test]
    fn rejects_hardware_assertion_without_user_verification() {
        for flags in [0u8, 0x01, 0x04] {
            let (data, key) = valid_instruction("https://haptix-passkeys.vercel.app");
            let mut weakened = build_webauthn(
                &signature(0x01),
                &key,
                &crate::webauthn::test_support::auth_data(RP_ID, flags),
                &assertion("https://haptix-passkeys.vercel.app", flags).1,
            );
            // Keep the region/hash split honest by rebuilding rather than patching.
            assert!(parse_precompile_data(&data, &key, PAYLOAD).is_ok());
            assert!(
                parse_precompile_data(&mut weakened, &key, PAYLOAD).is_err(),
                "flags {flags} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_unknown_mode_byte() {
        let key = pubkey(0xAA);
        let message = transfer_message(0x11, 42);
        let mut data = build(&signature(0x01), &key, &message, &[]);

        for mode in [2u8, 3, 0xFF] {
            data[1] = mode;
            assert!(parse_precompile_data(&data, &key, &message).is_err(), "mode {mode}");
        }
    }

    #[test]
    fn rejects_webauthn_layout_deviations() {
        let (data, key) = valid_instruction("https://haptix-passkeys.vercel.app");

        // Trailing bytes after the clientDataJSON.
        let mut trailing = data.clone();
        trailing.extend_from_slice(&key);
        assert!(parse_precompile_data(&trailing, &key, PAYLOAD).is_err());

        // A shifted signature offset, so a gap could hide data.
        let mut shifted = data.clone();
        shifted[2..4].copy_from_slice(&20u16.to_le_bytes());
        assert!(parse_precompile_data(&shifted, &key, PAYLOAD).is_err());

        // A shifted message offset, so the hashed region could be moved.
        let mut moved = data.clone();
        moved[10..12].copy_from_slice(&117u16.to_le_bytes());
        assert!(parse_precompile_data(&moved, &key, PAYLOAD).is_err());

        // Sibling-instruction reference instead of the current instruction.
        let mut sibling = data.clone();
        sibling[4..6].copy_from_slice(&0u16.to_le_bytes());
        assert!(parse_precompile_data(&sibling, &key, PAYLOAD).is_err());

        // Only one signature is allowed, in either mode.
        let mut two = data.clone();
        two[0] = 2;
        assert!(parse_precompile_data(&two, &key, PAYLOAD).is_err());
    }

    /// Including the clientDataJSON inside the signed region would change the digest
    /// the authenticator produced, so that layout must not be silently accepted.
    #[test]
    fn rejects_client_data_inside_the_signed_region() {
        let key = pubkey(0xAA);
        let (ad, cdj) = assertion("https://haptix-passkeys.vercel.app", 0x05);

        let mut region = ad.clone();
        region.extend_from_slice(&hash(&cdj).to_bytes());
        region.extend_from_slice(&cdj); // the mistake this test pins shut

        let mut data = vec![0u8; WEBAUTHN_MESSAGE_OFFSET];
        data[0] = 1;
        data[1] = MODE_WEBAUTHN;
        data[2..4].copy_from_slice(&(WEBAUTHN_SIGNATURE_OFFSET as u16).to_le_bytes());
        data[4..6].copy_from_slice(&u16::MAX.to_le_bytes());
        data[6..8].copy_from_slice(&(WEBAUTHN_PUBKEY_OFFSET as u16).to_le_bytes());
        data[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        data[10..12].copy_from_slice(&(WEBAUTHN_MESSAGE_OFFSET as u16).to_le_bytes());
        data[12..14].copy_from_slice(&(region.len() as u16).to_le_bytes());
        data[14..16].copy_from_slice(&u16::MAX.to_le_bytes());
        data[16..18].copy_from_slice(&(cdj.len() as u16).to_le_bytes());
        data[WEBAUTHN_SIGNATURE_OFFSET..WEBAUTHN_SIGNATURE_OFFSET + SIGNATURE_LEN]
            .copy_from_slice(&signature(0x01));
        data[WEBAUTHN_PUBKEY_OFFSET..WEBAUTHN_PUBKEY_OFFSET + PUBKEY_LEN].copy_from_slice(&key);
        data.extend_from_slice(&region);
        data.extend_from_slice(&cdj);

        assert!(parse_precompile_data(&data, &key, PAYLOAD).is_err());
    }

    #[test]
    fn rejects_hardware_assertion_with_short_authenticator_data() {
        let key = pubkey(0xAA);
        let (ad, cdj) = assertion("https://haptix-passkeys.vercel.app", 0x05);

        // Only 36 bytes of "authData" before the hash.
        let data = build_webauthn(&signature(0x01), &key, &ad[..36], &cdj);
        assert!(parse_precompile_data(&data, &key, PAYLOAD).is_err());

        // A generous clientDataJSON length cannot underflow into a valid split.
        let mut oversized = build_webauthn(&signature(0x01), &key, &ad, &cdj);
        oversized[16..18].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(parse_precompile_data(&oversized, &key, PAYLOAD).is_err());
    }

    #[test]
    fn webauthn_mode_still_requires_a_non_empty_payload() {
        let (data, key) = valid_instruction("https://haptix-passkeys.vercel.app");
        assert!(parse_precompile_data(&data, &key, &[]).is_err());
    }

    #[test]
    fn webauthn_fixture_uses_the_real_relying_party() {
        assert_eq!(RP_ID, b"haptix-passkeys.vercel.app");
        let (ad, _) = assertion("https://haptix-passkeys.vercel.app", 0x05);
        assert_eq!(&ad[..32], &hash(RP_ID).to_bytes()[..]);
    }
}
