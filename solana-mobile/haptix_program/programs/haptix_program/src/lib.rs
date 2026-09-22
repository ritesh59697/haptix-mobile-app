pub mod constants;
pub mod error;
pub mod instructions;
pub mod secp256r1;
pub mod state;
pub mod webauthn;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("YTdPGhiX7wgA9mQPJpUXqXRFzRvMBLwRAJBWdTVUHWL");

#[program]
pub mod haptix_program {
    use super::*;

    /// Initialize a new Passkey Account with primary biometric key, secondary backup key, and spend policy
    pub fn initialize_wallet(
        ctx: Context<InitializeWallet>,
        primary_passkey: [u8; 33],
        secondary_passkey: [u8; 33],
        spend_threshold_lamports: Option<u64>,
        guardian: Option<Pubkey>,
    ) -> Result<()> {
        instructions::initialize_wallet::initialize_wallet(
            ctx,
            primary_passkey,
            secondary_passkey,
            spend_threshold_lamports,
            guardian,
        )
    }

    /// Execute a transfer under dynamic spend policy:
    /// - If amount <= spend_threshold: requires 1 passkey signature
    /// - If amount > spend_threshold: requires 2-of-2 hardware passkey quorum
    pub fn execute_transfer(
        ctx: Context<ExecuteTransfer>,
        amount: u64,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: Option<u16>,
    ) -> Result<()> {
        instructions::execute_transfer::execute_transfer(
            ctx,
            amount,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }

    /// Authorize an autonomous AI agent session key (requires 2-of-2 Hardware Passkey Quorum)
    pub fn grant_agent_session(
        ctx: Context<GrantAgentSession>,
        agent_pubkey: Pubkey,
        valid_for_seconds: i64,
        allowance_lamports: u64,
        allowed_program: Pubkey,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: u16,
    ) -> Result<()> {
        instructions::grant_agent_session::grant_agent_session(
            ctx,
            agent_pubkey,
            valid_for_seconds,
            allowance_lamports,
            allowed_program,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }

    /// Execute an autonomous transaction signed by an agent session key (zero passkey prompts)
    pub fn agent_execute(ctx: Context<AgentExecute>, amount: u64) -> Result<()> {
        instructions::agent_execute::agent_execute(ctx, amount)
    }

    /// Update the social recovery guardian address (requires 2-of-2 Hardware Passkey Quorum)
    pub fn set_guardian(
        ctx: Context<SetGuardian>,
        new_guardian: Pubkey,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: u16,
    ) -> Result<()> {
        instructions::governance::handle_set_guardian(
            ctx,
            new_guardian,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }

    /// Update the spend policy threshold (requires 2-of-2 Hardware Passkey Quorum)
    pub fn set_spend_threshold(
        ctx: Context<SetSpendThreshold>,
        new_threshold_lamports: u64,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: u16,
    ) -> Result<()> {
        instructions::governance::handle_set_spend_threshold(
            ctx,
            new_threshold_lamports,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }

    /// Emergency panic freeze (can be triggered immediately by guardian)
    pub fn panic_freeze(ctx: Context<PanicFreeze>) -> Result<()> {
        instructions::governance::handle_panic_freeze(ctx)
    }

    /// Unfreeze the wallet (requires 2-of-2 Hardware Passkey Quorum)
    pub fn unfreeze(
        ctx: Context<Unfreeze>,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: u16,
    ) -> Result<()> {
        instructions::governance::handle_unfreeze(
            ctx,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }

    /// Initiate social recovery of passkeys (guardian only, activates timelock)
    pub fn initiate_recovery(
        ctx: Context<InitiateRecovery>,
        new_primary_passkey: [u8; 33],
        new_secondary_passkey: [u8; 33],
    ) -> Result<()> {
        instructions::recovery::handle_initiate_recovery(
            ctx,
            new_primary_passkey,
            new_secondary_passkey,
        )
    }

    /// Cancel an active recovery attempt (owner only, via 2-of-2 Hardware Passkeys)
    pub fn cancel_recovery(
        ctx: Context<CancelRecovery>,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: u16,
    ) -> Result<()> {
        instructions::recovery::handle_cancel_recovery(
            ctx,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }

    /// Execute recovery after timelock duration has elapsed
    pub fn execute_recovery(ctx: Context<ExecuteRecovery>) -> Result<()> {
        instructions::recovery::handle_execute_recovery(ctx)
    }

    /// Revoke an authorized agent session key (requires 2-of-2 Hardware Passkey Quorum)
    pub fn revoke_agent_session(
        ctx: Context<RevokeAgentSession>,
        agent_pubkey: Pubkey,
        primary_sig_ix_index: u16,
        secondary_sig_ix_index: u16,
    ) -> Result<()> {
        instructions::revoke_agent_session::revoke_agent_session(
            ctx,
            agent_pubkey,
            primary_sig_ix_index,
            secondary_sig_ix_index,
        )
    }
}
