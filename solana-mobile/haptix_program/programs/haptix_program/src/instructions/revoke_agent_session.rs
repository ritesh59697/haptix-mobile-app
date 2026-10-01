use anchor_lang::prelude::*;
use crate::auth::{bump_auth_nonce, revoke_agent_message};
use crate::error::HaptixError;
use crate::secp256r1::verify_passkey_precompile_signature;
use crate::state::{is_self_derived, WalletAccount};

#[derive(Accounts)]
pub struct RevokeAgentSession<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// CHECK: Instructions sysvar for secp256r1 precompile introspection
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

/// Removes an agent session key.
///
/// Deliberately callable while the wallet is frozen: revoking a delegation is a
/// safety action, and a freeze that blocks it would leave a live session key
/// unable to be shut down.
pub fn revoke_agent_session(
    ctx: Context<RevokeAgentSession>,
    agent_pubkey: Pubkey,
    primary_sig_ix_index: u16,
    secondary_sig_ix_index: u16,
) -> Result<()> {
    let nonce = ctx.accounts.wallet.auth_nonce;
    let cluster_tag = ctx.accounts.wallet.cluster_tag();
    let expected_message = revoke_agent_message(&ctx.accounts.wallet.key(), &cluster_tag, nonce, &agent_pubkey);

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

    let sessions_before = wallet.agents.len();
    wallet.agents.retain(|a| a.agent_pubkey != agent_pubkey);
    require!(
        wallet.agents.len() < sessions_before,
        HaptixError::AgentSessionNotFound
    );

    msg!("Revoked Agent Session Key for {:?}.", agent_pubkey);
    Ok(())
}
