use anchor_lang::prelude::*;
use crate::constants::WALLET_SEED;
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::WalletAccount;

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    #[account(
        mut,
        seeds = [WALLET_SEED, &wallet.primary_passkey[1..33]],
        bump = wallet.bump
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
    let wallet = &ctx.accounts.wallet;

    require!(!wallet.is_frozen, HaptixError::WalletFrozen);

    // Dynamic Spend Policy enforcement
    let quorum_required = amount > wallet.spend_threshold_lamports;

    // Message payload that must be signed: recipient pubkey + amount bytes
    let mut expected_message = Vec::with_capacity(32 + 8);
    expected_message.extend_from_slice(ctx.accounts.recipient.key.as_ref());
    expected_message.extend_from_slice(&amount.to_le_bytes());

    // 1. Verify Primary Passkey signature
    verify_passkey_precompile_signature(
        &ctx.accounts.instructions_sysvar,
        primary_sig_ix_index,
        &wallet.primary_passkey,
        &expected_message,
    )?;

    // 2. If amount exceeds threshold, enforce 2-of-2 Hardware Passkey Quorum
    if quorum_required {
        require!(secondary_sig_ix_index.is_some(), HaptixError::QuorumRequired);
        verify_passkey_precompile_signature(
            &ctx.accounts.instructions_sysvar,
            secondary_sig_ix_index.unwrap(),
            &wallet.secondary_passkey,
            &expected_message,
        )?;
        msg!("High-risk transaction: Verified 2-of-2 Hardware Passkey Quorum.");
    } else {
        msg!("Low-risk transaction: Verified 1-tap Passkey signature.");
    }

    // Transfer lamports from Wallet PDA to Recipient using PDA signer seeds
    **ctx.accounts.wallet.to_account_info().try_borrow_mut_lamports()? = ctx
        .accounts
        .wallet
        .to_account_info()
        .lamports()
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;

    **ctx.accounts.recipient.try_borrow_mut_lamports()? = ctx
        .accounts
        .recipient
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::InvalidAccountData)?;

    msg!("Transferred {} lamports to {:?}", amount, ctx.accounts.recipient.key());
    Ok(())
}
