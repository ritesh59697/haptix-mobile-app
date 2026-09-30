//! What a passkey signature is allowed to mean, and how lamports may leave the account.
//!
//! A signature over `recipient || amount` can be copied out of a confirmed transaction
//! and submitted again, because nothing in those bytes ever changes. Every owner
//! authorization therefore commits to `auth_nonce`. The program only accepts the nonce
//! currently stored on the wallet, then increments it, so a captured signature dies
//! with the transaction that used it.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::rent::Rent;

use crate::error::HaptixError;
use crate::state::WalletAccount;

pub fn bump_auth_nonce(wallet: &mut WalletAccount) -> Result<()> {
    wallet.auth_nonce = wallet
        .auth_nonce
        .checked_add(1)
        .ok_or_else(|| error!(HaptixError::StaleAuthorization))?;
    Ok(())
}

/// `TRANSFER:` || nonce u64 LE || recipient || amount u64 LE
pub fn transfer_message(nonce: u64, recipient: &Pubkey, amount: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(9 + 8 + 32 + 8);
    message.extend_from_slice(b"TRANSFER:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(recipient.as_ref());
    message.extend_from_slice(&amount.to_le_bytes());
    message
}

/// `GRANT_AGENT:` || nonce || agent || allowance u64 LE || valid_for i64 LE || allowed program
pub fn grant_agent_message(
    nonce: u64,
    agent: &Pubkey,
    allowance_lamports: u64,
    valid_for_seconds: i64,
    allowed_program: &Pubkey,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(12 + 8 + 32 + 8 + 8 + 32);
    message.extend_from_slice(b"GRANT_AGENT:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(agent.as_ref());
    message.extend_from_slice(&allowance_lamports.to_le_bytes());
    message.extend_from_slice(&valid_for_seconds.to_le_bytes());
    message.extend_from_slice(allowed_program.as_ref());
    message
}

/// `REVOKE_AGENT:` || nonce || agent
pub fn revoke_agent_message(nonce: u64, agent: &Pubkey) -> Vec<u8> {
    let mut message = Vec::with_capacity(13 + 8 + 32);
    message.extend_from_slice(b"REVOKE_AGENT:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(agent.as_ref());
    message
}

/// `SET_GUARDIAN:` || nonce || new guardian
pub fn set_guardian_message(nonce: u64, new_guardian: &Pubkey) -> Vec<u8> {
    let mut message = Vec::with_capacity(13 + 8 + 32);
    message.extend_from_slice(b"SET_GUARDIAN:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(new_guardian.as_ref());
    message
}

/// `SET_THRESHOLD:` || nonce || new threshold u64 LE
pub fn set_threshold_message(nonce: u64, new_threshold_lamports: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(14 + 8 + 8);
    message.extend_from_slice(b"SET_THRESHOLD:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(&new_threshold_lamports.to_le_bytes());
    message
}

/// `CANCEL_RECOVERY:` || nonce
pub fn cancel_recovery_message(nonce: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(16 + 8);
    message.extend_from_slice(b"CANCEL_RECOVERY:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message
}

/// `UNFREEZE_WALLET:` || nonce
pub fn unfreeze_message(nonce: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(16 + 8);
    message.extend_from_slice(b"UNFREEZE_WALLET:");
    message.extend_from_slice(&nonce.to_le_bytes());
    message
}

/// Move `amount` lamports without spending the rent-exempt reserve.
///
/// The wallet's balance is the account's own lamports. Subtracting past the
/// rent-exempt minimum lets the runtime delete the account and, with it, the keys.
pub fn debit_keeping_rent<'a>(
    source: &AccountInfo<'a>,
    recipient: &AccountInfo<'a>,
    amount: u64,
) -> Result<()> {
    require!(
        source.key() != recipient.key(),
        HaptixError::BelowRentReserve
    );

    let reserve = Rent::get()?.minimum_balance(source.data_len());
    let remaining = source
        .lamports()
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    require!(remaining >= reserve, HaptixError::BelowRentReserve);

    **source.try_borrow_mut_lamports()? = remaining;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::InvalidAccountData)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_message_binds_a_nonce_and_a_tag() {
        let recipient = Pubkey::new_from_array([0x11; 32]);
        let first = transfer_message(0, &recipient, 42);
        let second = transfer_message(1, &recipient, 42);

        assert_eq!(&first[..9], b"TRANSFER:");
        assert_eq!(first.len(), 57);
        assert_ne!(first, second);
        assert_eq!(u64::from_le_bytes(first[9..17].try_into().unwrap()), 0);
        assert_eq!(u64::from_le_bytes(second[9..17].try_into().unwrap()), 1);
    }

    #[test]
    fn fixed_strings_are_not_reusable_across_nonces() {
        assert_ne!(cancel_recovery_message(0), cancel_recovery_message(1));
        assert_ne!(unfreeze_message(0), unfreeze_message(1));
        assert_eq!(&cancel_recovery_message(4)[..16], b"CANCEL_RECOVERY:");
        assert_eq!(&unfreeze_message(4)[..16], b"UNFREEZE_WALLET:");
    }

    #[test]
    fn grant_message_covers_the_allowed_program() {
        let agent = Pubkey::new_from_array([0x22; 32]);
        let system = Pubkey::default();
        let other = Pubkey::new_from_array([0x33; 32]);
        let left = grant_agent_message(3, &agent, 10, 60, &system);
        let right = grant_agent_message(3, &agent, 10, 60, &other);
        assert_ne!(left, right);
        assert_eq!(left.len(), 12 + 8 + 32 + 8 + 8 + 32);
    }
}
