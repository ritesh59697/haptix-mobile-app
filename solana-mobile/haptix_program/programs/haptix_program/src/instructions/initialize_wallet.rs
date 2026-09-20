use anchor_lang::prelude::*;
use crate::constants::{WALLET_SEED, DEFAULT_SPEND_THRESHOLD, DEFAULT_RECOVERY_TIMELOCK};
use crate::error::HaptixError;
use crate::state::WalletAccount;

#[derive(Accounts)]
#[instruction(primary_passkey: [u8; 33])]
pub struct InitializeWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = WalletAccount::LEN,
        seeds = [WALLET_SEED, &primary_passkey[1..33]],
        bump
    )]
    pub wallet: Account<'info, WalletAccount>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_wallet(
    ctx: Context<InitializeWallet>,
    primary_passkey: [u8; 33],
    secondary_passkey: [u8; 33],
    spend_threshold_lamports: Option<u64>,
    guardian: Option<Pubkey>,
) -> Result<()> {
    require!(primary_passkey != secondary_passkey, HaptixError::DuplicatePasskeys);

    let wallet = &mut ctx.accounts.wallet;
    wallet.bump = ctx.bumps.wallet;
    wallet.primary_passkey = primary_passkey;
    wallet.secondary_passkey = secondary_passkey;
    wallet.spend_threshold_lamports = spend_threshold_lamports.unwrap_or(DEFAULT_SPEND_THRESHOLD);
    wallet.guardian = guardian.unwrap_or(ctx.accounts.payer.key());
    wallet.recovery_timelock = DEFAULT_RECOVERY_TIMELOCK;
    wallet.recovery_initiated_at = 0;
    wallet.pending_primary_passkey = [0u8; 33];
    wallet.pending_secondary_passkey = [0u8; 33];
    wallet.is_frozen = false;
    wallet.agents = Vec::new();

    msg!("Haptix Wallet initialized. PDA: {:?}", wallet.key());
    msg!("Spend Threshold: {} lamports", wallet.spend_threshold_lamports);
    msg!("Guardian: {:?}", wallet.guardian);
    Ok(())
}
