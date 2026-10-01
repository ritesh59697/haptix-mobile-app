use anchor_lang::prelude::*;
use crate::auth::{bump_auth_nonce, set_guardian_message, set_threshold_message, unfreeze_message};
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::{is_self_derived, WalletAccount};

#[derive(Accounts)]
pub struct SetGuardian<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
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
    require!(new_guardian != Pubkey::default(), HaptixError::GuardianRequired);
    require!(new_guardian != ctx.accounts.wallet.key(), HaptixError::InvalidGuardian);

    let nonce = ctx.accounts.wallet.auth_nonce;
    let cluster_tag = ctx.accounts.wallet.cluster_tag();
    let expected_message = set_guardian_message(&ctx.accounts.wallet.key(), &cluster_tag, nonce, &new_guardian);

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &ctx.accounts.wallet.primary_passkey,
        &expected_message,
    )?;

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        secondary_sig_ix_index,
        &ctx.accounts.wallet.secondary_passkey,
        &expected_message,
    )?;

    let wallet = &mut ctx.accounts.wallet;
    bump_auth_nonce(wallet)?;
    wallet.guardian = new_guardian;
    msg!("Guardian updated to {:?}", new_guardian);
    Ok(())
}

#[derive(Accounts)]
pub struct SetSpendThreshold<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
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
    let nonce = ctx.accounts.wallet.auth_nonce;
    let cluster_tag = ctx.accounts.wallet.cluster_tag();
    let expected_message = set_threshold_message(&ctx.accounts.wallet.key(), &cluster_tag, nonce, new_threshold_lamports);

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &ctx.accounts.wallet.primary_passkey,
        &expected_message,
    )?;

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        secondary_sig_ix_index,
        &ctx.accounts.wallet.secondary_passkey,
        &expected_message,
    )?;

    let wallet = &mut ctx.accounts.wallet;
    bump_auth_nonce(wallet)?;
    wallet.spend_threshold_lamports = new_threshold_lamports;
    msg!("Spend threshold updated to {} lamports", new_threshold_lamports);
    Ok(())
}

#[derive(Accounts)]
pub struct PanicFreeze<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
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
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
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

    // The freeze applied by `initiate_recovery` is what makes a pending recovery
    // visible and keeps the wallet quiet while the owner decides. Unfreezing during
    // that window would leave the recovery in flight with the wallet looking normal,
    // and the guardian could still rotate the keys once the timelock elapsed. The only
    // exits from a recovery are to veto it or to execute it, and each of those unfreezes
    // the wallet itself.
    require!(
        wallet.recovery_initiated_at == 0,
        HaptixError::RecoveryInProgress
    );

    let nonce = wallet.auth_nonce;
    let cluster_tag = wallet.cluster_tag();
    let expected_message = unfreeze_message(&wallet.key(), &cluster_tag, nonce);

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

    bump_auth_nonce(wallet)?;
    wallet.is_frozen = false;
    msg!("Wallet unfrozen successfully with 2-of-2 Quorum.");
    Ok(())
}
