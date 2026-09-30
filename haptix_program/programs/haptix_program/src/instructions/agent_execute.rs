use anchor_lang::prelude::*;
use crate::auth::debit_keeping_rent;
use crate::error::HaptixError;
use crate::state::{is_self_derived, WalletAccount};

#[derive(Accounts)]
pub struct AgentExecute<'info> {
    #[account(
        mut,
        constraint = is_self_derived(&wallet, &wallet.key(), &crate::ID)
    )]
    pub wallet: Account<'info, WalletAccount>,

    /// The autonomous agent session key signer
    pub agent: Signer<'info>,

    /// CHECK: Recipient receiving funds
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn agent_execute(ctx: Context<AgentExecute>, amount: u64) -> Result<()> {
    let remaining_allowance = {
        let wallet = &mut ctx.accounts.wallet;
        require!(!wallet.is_frozen, HaptixError::WalletFrozen);

        let agent_key = ctx.accounts.agent.key();
        let current_time = Clock::get()?.unix_timestamp;

        // Locate active agent session
        let agent_session = wallet
            .agents
            .iter_mut()
            .find(|a| a.agent_pubkey == agent_key)
            .ok_or(HaptixError::AgentSessionNotFound)?;

        require!(current_time <= agent_session.valid_until, HaptixError::AgentSessionExpired);

        // The only thing this instruction can do is move SOL. A session granted for
        // some other program must not be treated as permission to send lamports.
        require!(
            agent_session.allowed_program == Pubkey::default()
                || agent_session.allowed_program == System::id(),
            HaptixError::AgentProgramNotAllowed
        );

        require!(amount <= agent_session.allowance_lamports, HaptixError::AgentAllowanceExceeded);

        // 3. Deduct from allowance
        agent_session.allowance_lamports = agent_session
            .allowance_lamports
            .checked_sub(amount)
            .ok_or(HaptixError::AgentAllowanceExceeded)?;

        agent_session.allowance_lamports
    };

    debit_keeping_rent(
        &ctx.accounts.wallet.to_account_info(),
        &ctx.accounts.recipient,
        amount,
    )?;

    msg!("Autonomous Agent {:?} executed transfer of {} lamports. Remaining allowance: {}", ctx.accounts.agent.key(), amount, remaining_allowance);
    Ok(())
}
