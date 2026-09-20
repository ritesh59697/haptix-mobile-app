use anchor_lang::prelude::*;
use crate::constants::WALLET_SEED;
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::WalletAccount;

#[derive(Accounts)]
pub struct InitiateRecovery<'info> {
    #[account(
        mut,
        seeds = [WALLET_SEED, &wallet.primary_passkey[1..33]],
        bump = wallet.bump
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// The designated recovery guardian signer
    pub guardian: Signer<'info>,
}

pub fn handle_initiate_recovery(
    ctx: Context<InitiateRecovery>,
    new_primary_passkey: [u8; 33],
    new_secondary_passkey: [u8; 33],
) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;

    // Verify caller is the authorized guardian
    require!(ctx.accounts.guardian.key() == wallet.guardian, HaptixError::Unauthorized);
    require!(new_primary_passkey != new_secondary_passkey, HaptixError::DuplicatePasskeys);

    wallet.pending_primary_passkey = new_primary_passkey;
    wallet.pending_secondary_passkey = new_secondary_passkey;
    wallet.recovery_initiated_at = Clock::get()?.unix_timestamp;
    wallet.is_frozen = true; // Lock wallet while recovery timelock is active

    msg!(
        "Guardian initiated recovery. Timelock: {} seconds. Recovery Active.",
        wallet.recovery_timelock
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CancelRecovery<'info> {
    #[account(
        mut,
        seeds = [WALLET_SEED, &wallet.primary_passkey[1..33]],
        bump = wallet.bump
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// CHECK: Instructions sysvar for secp256r1 precompile introspection
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

pub fn handle_cancel_recovery(
    ctx: Context<CancelRecovery>,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: u16,
) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;
    require!(wallet.recovery_initiated_at > 0, HaptixError::NoRecoveryPending);

    let expected_message = b"CANCEL_RECOVERY";

    // Owner aborts recovery using 2-of-2 Hardware Passkeys
    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &wallet.primary_passkey,
        expected_message,
    )?;

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        secondary_sig_ix_index,
        &wallet.secondary_passkey,
        expected_message,
    )?;

    wallet.recovery_initiated_at = 0;
    wallet.pending_primary_passkey = [0u8; 33];
    wallet.pending_secondary_passkey = [0u8; 33];
    wallet.is_frozen = false;

    msg!("Guardian recovery successfully cancelled by hardware passkeys.");
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteRecovery<'info> {
    #[account(
        mut,
        seeds = [WALLET_SEED, &wallet.primary_passkey[1..33]],
        bump = wallet.bump
    )]
    pub wallet: Account<'info, WalletAccount>,
}

pub fn handle_execute_recovery(ctx: Context<ExecuteRecovery>) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;
    require!(wallet.recovery_initiated_at > 0, HaptixError::NoRecoveryPending);

    let current_time = Clock::get()?.unix_timestamp;
    let unlock_time = wallet
        .recovery_initiated_at
        .checked_add(wallet.recovery_timelock)
        .unwrap_or(i64::MAX);

    require!(current_time >= unlock_time, HaptixError::RecoveryTimelockNotElapsed);

    // Apply the new passkeys
    wallet.primary_passkey = wallet.pending_primary_passkey;
    wallet.secondary_passkey = wallet.pending_secondary_passkey;

    // Reset recovery state
    wallet.recovery_initiated_at = 0;
    wallet.pending_primary_passkey = [0u8; 33];
    wallet.pending_secondary_passkey = [0u8; 33];
    wallet.is_frozen = false;

    msg!("Recovery executed successfully. Hardware passkeys updated and wallet unlocked.");
    Ok(())
}
