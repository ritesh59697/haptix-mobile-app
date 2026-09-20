use anchor_lang::prelude::*;
use crate::constants::WALLET_SEED;
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::WalletAccount;

#[derive(Accounts)]
pub struct SetGuardian<'info> {
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

pub fn handle_set_guardian(
    ctx: Context<SetGuardian>,
    new_guardian: Pubkey,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: u16,
) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;

    let mut expected_message = Vec::with_capacity(13 + 32);
    expected_message.extend_from_slice(b"SET_GUARDIAN:");
    expected_message.extend_from_slice(new_guardian.as_ref());

    // Governance requirement: 2-of-2 Hardware Passkey Quorum
    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &wallet.primary_passkey,
        &expected_message,
    )?;

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        secondary_sig_ix_index,
        &wallet.secondary_passkey,
        &expected_message,
    )?;

    wallet.guardian = new_guardian;
    msg!("Guardian updated to {:?}", new_guardian);
    Ok(())
}

#[derive(Accounts)]
pub struct SetSpendThreshold<'info> {
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

pub fn handle_set_spend_threshold(
    ctx: Context<SetSpendThreshold>,
    new_threshold_lamports: u64,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: u16,
) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;

    let mut expected_message = Vec::with_capacity(14 + 8);
    expected_message.extend_from_slice(b"SET_THRESHOLD:");
    expected_message.extend_from_slice(&new_threshold_lamports.to_le_bytes());

    // Governance requirement: 2-of-2 Hardware Passkey Quorum
    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &wallet.primary_passkey,
        &expected_message,
    )?;

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        secondary_sig_ix_index,
        &wallet.secondary_passkey,
        &expected_message,
    )?;

    wallet.spend_threshold_lamports = new_threshold_lamports;
    msg!("Spend threshold updated to {} lamports", new_threshold_lamports);
    Ok(())
}

#[derive(Accounts)]
pub struct PanicFreeze<'info> {
    #[account(
        mut,
        seeds = [WALLET_SEED, &wallet.primary_passkey[1..33]],
        bump = wallet.bump
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// Signer triggering the freeze (can be guardian or user)
    pub signer: Signer<'info>,
}

pub fn handle_panic_freeze(ctx: Context<PanicFreeze>) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;
    // Allow either the guardian OR anyone authorizing emergency freeze
    require!(
        ctx.accounts.signer.key() == wallet.guardian,
        HaptixError::Unauthorized
    );

    wallet.is_frozen = true;
    msg!("EMERGENCY PANIC FREEZE ACTIVATED. Wallet is now locked.");
    Ok(())
}

#[derive(Accounts)]
pub struct Unfreeze<'info> {
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

pub fn handle_unfreeze(
    ctx: Context<Unfreeze>,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: u16,
) -> Result<()> {
    let wallet = &mut ctx.accounts.wallet;

    let expected_message = b"UNFREEZE_WALLET";

    // Unfreezing requires 2-of-2 Hardware Passkey Quorum
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

    wallet.is_frozen = false;
    msg!("Wallet unfrozen successfully with 2-of-2 Quorum.");
    Ok(())
}
