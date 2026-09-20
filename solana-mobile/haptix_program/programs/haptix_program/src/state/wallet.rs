use anchor_lang::prelude::*;

#[account]
pub struct WalletAccount {
    /// Program bump
    pub bump: u8,
    /// 33-byte compressed secp256r1 public key of primary passkey (TouchID/FaceID)
    pub primary_passkey: [u8; 33],
    /// 33-byte compressed secp256r1 public key of secondary backup hardware passkey (Quorum)
    pub secondary_passkey: [u8; 33],
    /// Transactions exceeding this threshold require 2-of-2 hardware passkey quorum
    pub spend_threshold_lamports: u64,
    /// Recovery guardian address (cannot spend funds, can only initiate timelocked recovery)
    pub guardian: Pubkey,
    /// Timelock delay in seconds required before recovery can be executed
    pub recovery_timelock: i64,
    /// Timestamp when current recovery was initiated (0 if none active)
    pub recovery_initiated_at: i64,
    /// Candidate new primary passkey proposed during recovery
    pub pending_primary_passkey: [u8; 33],
    /// Candidate new secondary passkey proposed during recovery
    pub pending_secondary_passkey: [u8; 33],
    /// Emergency panic freeze flag
    pub is_frozen: bool,
    /// Dynamic agent sessions authorized with scoped budgets
    pub agents: Vec<AgentSession>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq)]
pub struct AgentSession {
    /// Agent Ed25519 signer pubkey
    pub agent_pubkey: Pubkey,
    /// Timestamp until session is valid
    pub valid_until: i64,
    /// Remaining allowance budget in lamports
    pub allowance_lamports: u64,
    /// Target program allowed (or Pubkey::default() for general)
    pub allowed_program: Pubkey,
}

impl WalletAccount {
    pub const LEN: usize = 8 + 1 + 33 + 33 + 8 + 32 + 8 + 8 + 33 + 33 + 1 + 4 + (4 * 80) + 64;
}
