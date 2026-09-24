use anchor_lang::prelude::*;

pub const WALLET_SEED: &[u8] = b"haptix_wallet";
pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");
pub const DEFAULT_SPEND_THRESHOLD: u64 = 100_000_000; // 0.1 SOL (100,000,000 lamports)
pub const DEFAULT_RECOVERY_TIMELOCK: i64 = 86_400; // 24 hours
