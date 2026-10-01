use anchor_lang::prelude::*;
use crate::auth::{bump_auth_nonce, debit_keeping_rent, transfer_message};
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::{is_self_derived, WalletAccount};

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// CHECK: Recipient receiving the lamports
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    /// CHECK: Instructions sysvar for secp256r1 precompile introspection
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn execute_transfer(
    ctx: Context<ExecuteTransfer>,
    amount: u64,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: Option<u16>,
) -> Result<()> {
    require!(!ctx.accounts.wallet.is_frozen, HaptixError::WalletFrozen);

    let current_time = Clock::get()?.unix_timestamp;
    const VELOCITY_WINDOW_SECONDS: i64 = 86_400; // 24 hours

    // Quorum is required if single transfer exceeds threshold OR rolling 24h cumulative spend exceeds threshold
    let (window_spent, is_new_window) = if ctx.accounts.wallet.window_start == 0
        || current_time.saturating_sub(ctx.accounts.wallet.window_start) >= VELOCITY_WINDOW_SECONDS
    {
        (0u64, true)
    } else {
        (ctx.accounts.wallet.window_spent, false)
    };

    let cumulative_spent = window_spent.saturating_add(amount);
    let quorum_required = amount > ctx.accounts.wallet.spend_threshold_lamports
        || cumulative_spent > ctx.accounts.wallet.spend_threshold_lamports;

    let nonce = ctx.accounts.wallet.auth_nonce;
    let cluster_tag = ctx.accounts.wallet.cluster_tag();
    let expected_message = transfer_message(
        &ctx.accounts.wallet.key(),
        &cluster_tag,
        nonce,
        ctx.accounts.recipient.key,
        amount,
    );

    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &ctx.accounts.wallet.primary_passkey,
        &expected_message,
    )?;

    if quorum_required {
        require!(secondary_sig_ix_index.is_some(), HaptixError::QuorumRequired);
        verify_passkey_precompile_signature(
            &ctx.accounts.instructions_sysvar,
            secondary_sig_ix_index.unwrap(),
            &ctx.accounts.wallet.secondary_passkey,
            &expected_message,
        )?;
        msg!("High-risk transaction: Verified 2-of-2 Hardware Passkey Quorum.");
    } else {
        // Track 1-tap velocity window spend
        if is_new_window {
            ctx.accounts.wallet.window_start = current_time;
            ctx.accounts.wallet.window_spent = amount;
        } else {
            ctx.accounts.wallet.window_spent = cumulative_spent;
        }
        msg!("Low-risk transaction: Verified 1-tap Passkey signature within 24h velocity budget.");
    }

    // Only a signature the program just accepted may advance the nonce. A failed
    // check above returns before this, so a rejected attempt can be retried.
    bump_auth_nonce(&mut ctx.accounts.wallet)?;
    debit_keeping_rent(
        &ctx.accounts.wallet.to_account_info(),
        &ctx.accounts.recipient,
        amount,
    )?;

    msg!("Transferred {} lamports to {:?}", amount, ctx.accounts.recipient.key());
    Ok(())
}
