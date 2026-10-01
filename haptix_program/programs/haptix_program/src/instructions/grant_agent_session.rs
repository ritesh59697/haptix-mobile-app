use anchor_lang::prelude::*;
use crate::auth::{bump_auth_nonce, grant_agent_message};
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::{is_self_derived, AgentSession, WalletAccount};

#[derive(Accounts)]
pub struct GrantAgentSession<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// CHECK: Instructions sysvar for secp256r1 precompile introspection
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

pub fn grant_agent_session(
    ctx: Context<GrantAgentSession>,
    agent_pubkey: Pubkey,
    valid_for_seconds: i64,
    allowance_lamports: u64,
    allowed_program: Pubkey,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: u16,
) -> Result<()> {
    require!(!ctx.accounts.wallet.is_frozen, HaptixError::WalletFrozen);

    let nonce = ctx.accounts.wallet.auth_nonce;
    let cluster_tag = ctx.accounts.wallet.cluster_tag();
    let expected_message = grant_agent_message(
        &ctx.accounts.wallet.key(),
        &cluster_tag,
        nonce,
        &agent_pubkey,
        allowance_lamports,
        valid_for_seconds,
        &allowed_program,
    );

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

    wallet.agents.retain(|a| a.agent_pubkey != agent_pubkey);

    require!(wallet.agents.len() < 4, HaptixError::MaxAgentSessionsReached);

    let clock = Clock::get()?;
    let valid_until = clock.unix_timestamp.checked_add(valid_for_seconds).unwrap_or(clock.unix_timestamp);

    wallet.agents.push(AgentSession {
        agent_pubkey,
        valid_until,
        allowance_lamports,
        allowed_program,
    });

    msg!("Granted Agent Session Key for {:?}. Allowance: {} lamports, Valid Until: {}", agent_pubkey, allowance_lamports, valid_until);
    Ok(())
}
