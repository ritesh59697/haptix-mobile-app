use anchor_lang::prelude::*;
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
    let wallet = &mut ctx.accounts.wallet;
    require!(!wallet.is_frozen, HaptixError::WalletFrozen);

    // Message payload that must be signed by both hardware passkeys:
    // b"GRANT_AGENT:" + agent_pubkey + allowance + valid_for
    let mut expected_message = Vec::with_capacity(12 + 32 + 8 + 8);
    expected_message.extend_from_slice(b"GRANT_AGENT:");
    expected_message.extend_from_slice(agent_pubkey.as_ref());
    expected_message.extend_from_slice(&allowance_lamports.to_le_bytes());
    expected_message.extend_from_slice(&valid_for_seconds.to_le_bytes());

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

    // Remove existing session for same agent if present
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
