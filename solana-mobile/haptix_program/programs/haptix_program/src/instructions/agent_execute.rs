use anchor_lang::prelude::*;
use crate::constants::WALLET_SEED;
use crate::error::HaptixError;
use crate::state::WalletAccount;

#[derive(Accounts)]
pub struct AgentExecute<'info> {
    #[account(
        mut,
        seeds = [WALLET_SEED, &wallet.primary_passkey[1..33]],
        bump = wallet.bump
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

        // 1. Verify session validity timestamp
        require!(current_time <= agent_session.valid_until, HaptixError::AgentSessionExpired);

        // 2. Verify spending ceiling / allowance
        require!(amount <= agent_session.allowance_lamports, HaptixError::AgentAllowanceExceeded);

        // 3. Deduct from allowance
        agent_session.allowance_lamports = agent_session
            .allowance_lamports
            .checked_sub(amount)
            .ok_or(HaptixError::AgentAllowanceExceeded)?;

        agent_session.allowance_lamports
    };

    // Execute transfer from Wallet PDA to recipient
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

    msg!("Autonomous Agent {:?} executed transfer of {} lamports. Remaining allowance: {}", ctx.accounts.agent.key(), amount, remaining_allowance);
    Ok(())
}
