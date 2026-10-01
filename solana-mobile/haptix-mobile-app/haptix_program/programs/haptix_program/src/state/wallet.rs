use anchor_lang::prelude::*;
use crate::constants::WALLET_SEED;

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
    /// The 32 bytes the PDA was derived from, captured at creation.
    ///
    /// Every instruction re-derives this account's address from its own state, so the
    /// bytes in here can never change -- which is exactly the problem `primary_passkey`
    /// has. Recovery overwrites `primary_passkey`, and an account whose address is
    /// derived from a field that rotation rewrites becomes unreachable: the account and
    /// its lamports stay on-chain at an address no instruction can derive again. So the
    /// seed lives in its own field that only `execute_recovery` writes, and only once.
    pub wallet_seed: [u8; 32],
    /// Incremented on every successful owner authorization.
    ///
    /// Sits after `wallet_seed` so accounts allocated before this field existed still
    /// decode: their spare zero bytes read as nonce 0. The first successful
    /// authorization on an upgraded account consumes that 0.
    pub auth_nonce: u64,
    /// Timestamp when current 24-hour spend velocity window started (0 if not started).
    pub window_start: i64,
    /// Lamports spent so far in the current 24-hour rolling window under 1-passkey threshold.
    pub window_spent: u64,
    /// Cluster binding: *b"mainnet\0" or *b"devnet\0\0" (prevents cross-cluster signature replay)
    pub cluster: [u8; 8],
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
    /// The PDA seed for this wallet. Accounts created before `wallet_seed` existed read
    /// back as all zeroes, and for those the original primary passkey is still the seed
    /// -- they have never been rotated, or the old program would have stranded them.
    pub fn identity(&self) -> [u8; 32] {
        if self.wallet_seed == [0u8; 32] {
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&self.primary_passkey[1..33]);
            seed
        } else {
            self.wallet_seed
        }
    }

    /// The cluster tag for this wallet. Defaults to devnet if uninitialized.
    pub fn cluster_tag(&self) -> [u8; 8] {
        if self.cluster == [0u8; 8] {
            crate::constants::CLUSTER_DEVNET
        } else {
            self.cluster
        }
    }

    /// Allocated space: fixed fields, four agent sessions, the 32-byte seed, the
    /// 8-byte auth nonce, 8-byte window start, 8-byte window spent, 8-byte cluster, and 8 bytes of spare.
    /// Preserves existing total size (586 bytes) for compatibility.
    pub const LEN: usize = 8 + 1 + 33 + 33 + 8 + 32 + 8 + 8 + 33 + 33 + 1 + 4 + (4 * 80) + 32 + 8 + 8 + 8 + 8 + 8;
}

/// True when `key` is the address this account's own state derives.
///
/// This replaces Anchor's `seeds`/`bump` constraint, which can only read a field that
/// rotation must not touch. `create_program_address` is used rather than
/// `find_program_address` because only the former is allowed inside a constraint.
pub fn is_self_derived(wallet: &WalletAccount, key: &Pubkey, program_id: &Pubkey) -> bool {
    Pubkey::create_program_address(&[WALLET_SEED, &wallet.identity(), &[wallet.bump]], program_id)
        .map(|derived| derived == *key)
        .unwrap_or(false)
}
