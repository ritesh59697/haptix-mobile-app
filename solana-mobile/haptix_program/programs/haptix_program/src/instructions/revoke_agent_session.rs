use anchor_lang::prelude::*;
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
    let wallet = &mut ctx.accounts.wallet;

    // Message payload that must be signed by both passkeys:
    // b"REVOKE_AGENT:" + agent_pubkey
    let mut expected_message = Vec::with_capacity(13 + 32);
    expected_message.extend_from_slice(b"REVOKE_AGENT:");
    expected_message.extend_from_slice(agent_pubkey.as_ref());

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

    let sessions_before = wallet.agents.len();
    wallet.agents.retain(|a| a.agent_pubkey != agent_pubkey);
    require!(
        wallet.agents.len() < sessions_before,
        HaptixError::AgentSessionNotFound
    );

    msg!("Revoked Agent Session Key for {:?}.", agent_pubkey);
    Ok(())
}
