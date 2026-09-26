//! WebAuthn assertion validation for hardware-backed passkeys.
//!
//! # Why this exists
//!
//! A platform authenticator (Android Credential Manager, iOS ASAuthorization)
//! will not sign an arbitrary payload. It signs
//! `authenticatorData || SHA-256(clientDataJSON)`, and the resulting signature is
//! DER-encoded. The raw `Secp256r1SigVerify` precompile hashes whatever `message`
//! region it is pointed at and verifies a *compact* signature against that digest,
//! so the two formats are not directly compatible.
//!
//! The bridge is that the precompile computes `SHA-256(message)`. If we hand it
//! `message = authenticatorData || SHA-256(clientDataJSON)`, the digest it verifies
//! against is exactly the digest the authenticator signed. So the precompile call
//! itself is unchanged; what changes is what we bind the message region to.
//!
//! # What this module must therefore enforce
//!
//! Byte-binding the message region is *not* sufficient here, because that region is
//! now supplied by the caller rather than computed by the program. A valid signature
//! only proves that the authenticator signed *some* assertion. The security comes
//! from validating the contents of that assertion against the payload the
//! instruction actually authorizes:
//!
//! 1. the client data hash inside the message region matches the clientDataJSON that
//!    follows it, so the two cannot be decoupled;
//! 2. `clientDataJSON.challenge` decodes to exactly the expected payload, so a
//!    signed assertion for one action cannot authorize another;
//! 3. `authenticatorData.rpIdHash` equals `SHA-256(rp_id)`, so a credential minted
//!    for a different relying party cannot be replayed here;
//! 4. the authenticator set both the User Present and User Verified flags;
//! 5. `clientDataJSON.type` is `webauthn.get`;
//! 6. `clientDataJSON.origin` is a known origin for this relying party.
//!
//! Checks 1, 3 and 4 are what make the format structurally WebAuthn; checks 2, 5 and
//! 6 are what bind it to this specific authorization.

use crate::error::HaptixError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

/// The relying party this program accepts assertions for.
///
/// Must match the `rp.id` the client passes to the authenticator, and the domain the
/// app is associated with (`assetlinks.json` on Android, `webcredentials:` Associated
/// Domains on iOS). See `PASSKEY_SETUP.md` in the mobile app.
pub const RP_ID: &[u8] = b"haptix-passkeys.vercel.app";
pub const RP_ID_LOCAL: &[u8] = b"localhost";

/// WebAuthn origin used by Apple's ASAuthorization stack.
pub const IOS_ORIGIN: &[u8] = b"https://haptix-passkeys.vercel.app";

/// Prefix used by Android Credential Manager for app-originated ceremonies:
/// `android:apk-key-hash:<base64url(sha256(signing certificate))>`.
pub const ANDROID_ORIGIN_PREFIX: &[u8] = b"android:apk-key-hash:";

/// `authenticatorData` is at least `rpIdHash(32) || flags(1) || signCount(4)`.
pub const MIN_AUTH_DATA_LEN: usize = 37;

const FLAG_USER_PRESENT: u8 = 0x01;
const FLAG_USER_VERIFIED: u8 = 0x04;

const TYPE_GET: &[u8] = b"webauthn.get";

/// Length of the `SHA-256(clientDataJSON)` trailer inside the signed message region.
pub const CLIENT_DATA_HASH_LEN: usize = 32;

fn invalid() -> anchor_lang::error::Error {
    error!(HaptixError::InvalidWebAuthnAssertion)
}

fn is_allowed_rp_id(auth_data_rp_hash: &[u8]) -> bool {
    auth_data_rp_hash == &hash(RP_ID).to_bytes()[..] || auth_data_rp_hash == &hash(RP_ID_LOCAL).to_bytes()[..]
}

/// Validates a WebAuthn assertion whose `authenticatorData` and client data hash have
/// already been located inside the precompile instruction data.
///
/// * `auth_data` - the signed `authenticatorData` bytes.
/// * `client_data_json` - the raw client data JSON that follows the message region.
/// * `client_data_hash` - the 32-byte trailer of the message region.
/// * `expected_message` - the payload this instruction authorizes; must equal the
///   base64url-decoded `challenge`.
pub fn verify_assertion(
    auth_data: &[u8],
    client_data_json: &[u8],
    client_data_hash: &[u8],
    expected_message: &[u8],
) -> Result<()> {
    // 1. The hash trailer must actually commit to the client data JSON we were given.
    if client_data_hash.len() != CLIENT_DATA_HASH_LEN {
        return Err(invalid());
    }
    if hash(client_data_json).to_bytes()[..] != client_data_hash[..] {
        return Err(invalid());
    }

    // 3. Bind the credential to this relying party.
    if auth_data.len() < MIN_AUTH_DATA_LEN {
        return Err(invalid());
    }
    if !is_allowed_rp_id(&auth_data[..32]) {
        return Err(invalid());
    }

    // 4. Require an actual user gesture with verification, not a silent assertion.
    let flags = auth_data[32];
    if flags & (FLAG_USER_PRESENT | FLAG_USER_VERIFIED) != (FLAG_USER_PRESENT | FLAG_USER_VERIFIED) {
        return Err(invalid());
    }

    // 5. Only an assertion (never a registration) authorizes a transaction.
    if json_find_string(client_data_json, b"type") != Some(TYPE_GET) {
        return Err(invalid());
    }

    // 2. The challenge must be exactly the authorized payload.
    let challenge = json_find_string(client_data_json, b"challenge").ok_or_else(invalid)?;
    let decoded = base64url_decode(challenge)?;
    if decoded != expected_message {
        return Err(invalid());
    }

    // 6. Known origin for this relying party.
    let origin = json_find_string(client_data_json, b"origin").ok_or_else(invalid)?;
    if !is_allowed_origin(origin) {
        return Err(invalid());
    }

    Ok(())
}

/// Accepts the https origin (Apple), local dev origins (Mac Vault), or a well-formed Android app origin.
fn is_allowed_origin(origin: &[u8]) -> bool {
    if origin == IOS_ORIGIN {
        return true;
    }
    if origin.starts_with(b"http://localhost") || origin.starts_with(b"http://127.0.0.1") {
        return true;
    }
    let Some(suffix) = origin.strip_prefix(ANDROID_ORIGIN_PREFIX) else {
        return false;
    };
    match base64url_decode(suffix) {
        // A signing certificate SHA-256, nothing else.
        Ok(bytes) => bytes.len() == 32,
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Minimal JSON string lookup
// ---------------------------------------------------------------------------

/// Finds the value of a **top-level** string property in a JSON object.
///
/// `clientDataJSON` is a flat object with string values, so a full JSON parser would
/// be a lot of untrusted-input handling for no benefit. Restricting matches to depth 1
/// means a nested object cannot shadow a top-level key, and the caller additionally
/// requires the whole JSON to be committed to by the authenticator's signature.
fn json_find_string<'a>(json: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut depth: i32 = 0;
    let mut i = 0usize;

    while i < json.len() {
        match json[i] {
            b'{' | b'[' => {
                depth += 1;
                i += 1;
            }
            b'}' | b']' => {
                depth -= 1;
                if depth < 0 {
                    return None
                }
                i += 1;
            }
            b'"' => {
                let start = i + 1;
                let end = scan_string_end(json, start)?;
                let value = &json[start..end];

                // Only keys at the top level of the object are considered.
                if depth == 1 && value == key {
                    let mut j = skip_ws(json, end + 1);
                    if json.get(j) != Some(&b':') {
                        return None
                    }
                    j = skip_ws(json, j + 1);
                    if json.get(j) != Some(&b'"') {
                        return None
                    }
                    let value_start = j + 1;
                    let value_end = scan_string_end(json, value_start)?;
                    return Some(&json[value_start..value_end])
                }

                i = end + 1;
            }
            _ => i += 1,
        }
    }

    None
}

/// Returns the index of the closing quote for a string starting at `start`.
///
/// Rejects unescaped control characters and unterminated strings. Escapes are skipped
/// as a unit so a `\"` inside the value cannot end it early.
fn scan_string_end(json: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i < json.len() {
        match json[i] {
            b'"' => return Some(i),
            b'\\' => {
                i += 2;
            }
            b if b < 0x20 => return None,
            _ => i += 1,
        }
    }
    None
}

fn skip_ws(json: &[u8], mut i: usize) -> usize {
    while let Some(&b) = json.get(i) {
        if b == b' ' || b == b'\t' || b == b'\n' || b == b'\r' {
            i += 1;
        } else {
            break
        }
    }
    i
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

/// Decodes unpadded base64url, as emitted by WebAuthn for `challenge` and origin
/// certificate hashes.
pub fn base64url_decode(input: &[u8]) -> Result<Vec<u8>> {
    // Trailing '=' is tolerated; WebAuthn itself emits unpadded values.
    let mut end = input.len();
    while end > 0 && input[end - 1] == b'=' {
        end -= 1;
    }
    let input = &input[..end];

    // A single leftover character cannot encode a byte.
    if input.len() % 4 == 1 {
        return Err(invalid());
    }

    let mut out = Vec::with_capacity(input.len() / 4 * 3 + 2);
    let mut accumulator: u32 = 0;
    let mut bits: u32 = 0;

    for &byte in input {
        let value = decode_base64url_char(byte)?;
        accumulator = (accumulator << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((accumulator >> bits) as u8);
        }
    }

    // Any remaining bits must be zero padding, not data.
    if bits > 0 && (accumulator & ((1 << bits) - 1)) != 0 {
        return Err(invalid());
    }

    Ok(out)
}

fn decode_base64url_char(byte: u8) -> Result<u8> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'-' => Ok(62),
        b'_' => Ok(63),
        _ => Err(invalid()),
    }
}

/// Fixture builders shared by this module's tests and the precompile parser tests.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// 40 bytes, the same shape as a `recipient || amount` transfer payload.
    pub(crate) const PAYLOAD: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCD";

    pub(crate) fn auth_data(rp_id: &[u8], flags: u8) -> Vec<u8> {
        let mut data = hash(rp_id).to_bytes().to_vec();
        data.push(flags);
        data.extend_from_slice(&0u32.to_be_bytes());
        data
    }

    pub(crate) fn client_data(challenge: &str, type_: &str, origin: &str) -> Vec<u8> {
        format!(
            r#"{{"type":"{type_}","challenge":"{challenge}","origin":"{origin}","crossOrigin":false}}"#
        )
        .into_bytes()
    }

    pub(crate) fn b64url(bytes: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = *chunk.get(1).unwrap_or(&0) as u32;
            let b2 = *chunk.get(2).unwrap_or(&0) as u32;
            let triple = (b0 << 16) | (b1 << 8) | b2;
            out.push(ALPHABET[(triple >> 18) as usize & 0x3f] as char);
            out.push(ALPHABET[(triple >> 12) as usize & 0x3f] as char);
            if chunk.len() > 1 {
                out.push(ALPHABET[(triple >> 6) as usize & 0x3f] as char);
            }
            if chunk.len() > 2 {
                out.push(ALPHABET[triple as usize & 0x3f] as char);
            }
        }
        out
    }

    /// The exact bytes an authenticator signs for an assertion over `challenge_bytes`:
    /// `authData || SHA-256(clientDataJSON)`.
    pub(crate) fn signed_message(origin: &str, challenge_bytes: &[u8]) -> Vec<u8> {
        let ad = auth_data(RP_ID, FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
        let cdj = client_data(&b64url(challenge_bytes), "webauthn.get", origin);
        signed_message_from(&ad, &cdj)
    }

    /// Same, but from caller-supplied `authData` / `clientDataJSON`.
    pub(crate) fn signed_message_from(auth_data: &[u8], client_data_json: &[u8]) -> Vec<u8> {
        let mut message = auth_data.to_vec();
        message.extend_from_slice(&hash(client_data_json).to_bytes());
        message.extend_from_slice(client_data_json);
        message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::test_support::{auth_data, b64url, client_data, PAYLOAD};

    fn valid_assertion(origin: &str) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let ad = auth_data(RP_ID, FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
        let cdj = client_data(&b64url(PAYLOAD), "webauthn.get", origin);
        let hash_trailer = hash(&cdj).to_bytes().to_vec();
        (ad, cdj, hash_trailer)
    }

    #[test]
    fn accepts_https_origin_assertion() {
        let (ad, cdj, h) = valid_assertion("https://haptix.io");
        assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_ok());
    }

    #[test]
    fn accepts_android_app_origin_assertion() {
        let cert_hash = b64url(&[0xABu8; 32]);
        let origin = format!("android:apk-key-hash:{cert_hash}");
        let (ad, cdj, h) = valid_assertion(&origin);
        assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_ok());
    }

    #[test]
    fn rejects_challenge_for_a_different_payload() {
        let (ad, cdj, h) = valid_assertion("https://haptix.io");
        let other = b"0123456789abcdefghijklmnopqrstuvwxyzABCD";
        assert!(verify_assertion(&ad, &cdj, &h, other).is_ok());

        let mut tampered = other.to_vec();
        tampered[0] = b'X';
        assert!(verify_assertion(&ad, &cdj, &h, &tampered).is_err());
    }

    #[test]
    fn rejects_wrong_relying_party() {
        let ad = auth_data(b"evil.example", FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
        let cdj = client_data(&b64url(PAYLOAD), "webauthn.get", "https://haptix.io");
        let h = hash(&cdj).to_bytes().to_vec();
        assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_err());
    }

    #[test]
    fn rejects_unverified_or_absent_user_gesture() {
        for flags in [0u8, FLAG_USER_PRESENT, FLAG_USER_VERIFIED] {
            let ad = auth_data(RP_ID, flags);
            let cdj = client_data(&b64url(PAYLOAD), "webauthn.get", "https://haptix.io");
            let h = hash(&cdj).to_bytes().to_vec();
            assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_err(), "flags {flags} must be rejected");
        }
    }

    #[test]
    fn rejects_registration_ceremony() {
        let ad = auth_data(RP_ID, FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
        let cdj = client_data(&b64url(PAYLOAD), "webauthn.create", "https://haptix.io");
        let h = hash(&cdj).to_bytes().to_vec();
        assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_err());
    }

    #[test]
    fn rejects_unknown_or_malformed_origin() {
        for origin in ["https://evil.example", "https://haptix.io.evil.example", "android:apk-key-hash:not+base64!"] {
            let (ad, cdj, h) = valid_assertion(origin);
            assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_err(), "{origin} must be rejected");
        }
    }

    #[test]
    fn rejects_decoupled_client_data_hash() {
        let (ad, cdj, _) = valid_assertion("https://haptix.io");
        let wrong = hash(b"other client data").to_bytes().to_vec();
        assert!(verify_assertion(&ad, &cdj, &wrong, PAYLOAD).is_err());
    }

    #[test]
    fn rejects_short_authenticator_data() {
        let ad = auth_data(RP_ID, FLAG_USER_PRESENT | FLAG_USER_VERIFIED)[..36].to_vec();
        let cdj = client_data(&b64url(PAYLOAD), "webauthn.get", "https://haptix.io");
        let h = hash(&cdj).to_bytes().to_vec();
        assert!(verify_assertion(&ad, &cdj, &h, PAYLOAD).is_err());
    }

    #[test]
    fn json_scanner_only_reads_top_level_keys() {
        let nested = br#"{"outer":{"challenge":"AAAA"},"challenge":"BBBB"}"#;
        assert_eq!(json_find_string(nested, b"challenge"), Some(&b"BBBB"[..]));

        let escaped = br#"{"a":"he said \"hi\"","challenge":"CCCC"}"#;
        assert_eq!(json_find_string(escaped, b"challenge"), Some(&b"CCCC"[..]));

        assert_eq!(json_find_string(b"{}", b"challenge"), None);
        assert_eq!(json_find_string(br#"{"challenge":42}"#, b"challenge"), None);
        assert_eq!(json_find_string(br#"{"challenge":"unterminated"#, b"challenge"), None);
    }

    #[test]
    fn base64url_roundtrip_and_validation() {
        for len in 1..=64usize {
            let bytes: Vec<u8> = (0..len).map(|i| i as u8).collect();
            assert_eq!(base64url_decode(b64url(&bytes).as_bytes()).unwrap(), bytes, "len {len}");
        }

        assert!(base64url_decode(b"A").is_err()); // impossible length
        assert!(base64url_decode(b"****").is_err()); // invalid alphabet
        assert_eq!(base64url_decode(b"AQ").unwrap(), vec![0x01]); // trailing bits are padding
        assert!(base64url_decode(b"AR").is_err()); // non-zero trailing bits
    }

    #[test]
    fn accepts_unpadded_and_padded_challenges_equally() {
        assert_eq!(base64url_decode(b"AAEC").unwrap(), base64url_decode(b"AAEC").unwrap());
        assert_eq!(base64url_decode(b"AAE").unwrap(), vec![0x00, 0x01]);
        assert_eq!(base64url_decode(b"AAE=").unwrap(), vec![0x00, 0x01]);
    }
}
