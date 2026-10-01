use anchor_lang::prelude::*;
use crate::constants::{
    WALLET_SEED, DEFAULT_SPEND_THRESHOLD, DEFAULT_RECOVERY_TIMELOCK, CLUSTER_DEVNET, CLUSTER_MAINNET,
};
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
    recovery_timelock_seconds: Option<i64>,
    cluster: Option<[u8; 8]>,
) -> Result<()> {
    require!(primary_passkey != secondary_passkey, HaptixError::DuplicatePasskeys);
    let guardian = guardian.ok_or_else(|| error!(HaptixError::GuardianRequired))?;
    require!(guardian != Pubkey::default(), HaptixError::GuardianRequired);
    require!(guardian != ctx.accounts.wallet.key(), HaptixError::InvalidGuardian);

    let selected_cluster = cluster.unwrap_or(CLUSTER_DEVNET);
    require!(
        selected_cluster == CLUSTER_DEVNET || selected_cluster == CLUSTER_MAINNET,
        HaptixError::InvalidClusterTag
    );

    // The timelock is the owner's veto window, so a negative value would mean a guardian
    // could rotate the keys before the owner ever sees the prompt. Zero is allowed but
    // deliberately explicit: it is an opt-out of the veto, not a shortcut.
    if let Some(seconds) = recovery_timelock_seconds {
        require!(seconds >= 0, HaptixError::InvalidRecoveryTimelock);
    }

    let wallet = &mut ctx.accounts.wallet;
    wallet.bump = ctx.bumps.wallet;
    wallet.primary_passkey = primary_passkey;
    wallet.secondary_passkey = secondary_passkey;
    wallet.spend_threshold_lamports = spend_threshold_lamports.unwrap_or(DEFAULT_SPEND_THRESHOLD);
    wallet.guardian = guardian;
    wallet.recovery_timelock = recovery_timelock_seconds.unwrap_or(DEFAULT_RECOVERY_TIMELOCK);
    wallet.recovery_initiated_at = 0;
    wallet.pending_primary_passkey = [0u8; 33];
    wallet.pending_secondary_passkey = [0u8; 33];
    wallet.is_frozen = false;
    wallet.agents = Vec::new();
    // Pinned at creation: this is what every later instruction re-derives the address
    // from, and it has to stay put across a recovery rotation.
    wallet.wallet_seed = primary_passkey[1..33].try_into().unwrap();
    wallet.auth_nonce = 0;
    wallet.window_start = 0;
    wallet.window_spent = 0;
    wallet.cluster = selected_cluster;

    msg!("Haptix Wallet initialized. PDA: {:?}", wallet.key());
    msg!("Spend Threshold: {} lamports", wallet.spend_threshold_lamports);
    msg!("Guardian: {:?}", wallet.guardian);
    msg!("Cluster: {:?}", std::str::from_utf8(&wallet.cluster).unwrap_or("unknown"));
    msg!("Recovery Timelock: {} seconds", wallet.recovery_timelock);
    Ok(())
}
