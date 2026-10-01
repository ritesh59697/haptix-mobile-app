use anchor_lang::prelude::*;

#[error_code]
pub enum HaptixError {
    #[msg("Unauthorized signer for this action.")]
    Unauthorized,
    #[msg("Wallet is currently panic frozen.")]
    WalletFrozen,
    #[msg("Spend policy: amount exceeds threshold and requires 2-of-2 hardware passkey quorum.")]
    QuorumRequired,
    #[msg("Invalid Secp256r1 passkey signature or instruction mismatch.")]
    InvalidPasskeySignature,
    #[msg("Agent session key has expired.")]
    AgentSessionExpired,
    #[msg("Agent spending allowance exceeded.")]
    AgentAllowanceExceeded,
    #[msg("Recovery timelock has not yet elapsed.")]
    RecoveryTimelockNotElapsed,
    #[msg("No recovery process is currently active.")]
    NoRecoveryPending,
    #[msg("Guardians are recovery-only and cannot spend funds.")]
    GuardianCannotSpend,
    #[msg("Maximum number of agent sessions reached.")]
    MaxAgentSessionsReached,
    #[msg("Agent session not found.")]
    AgentSessionNotFound,
    #[msg("Primary and secondary passkey public keys must be distinct.")]
    DuplicatePasskeys,
    #[msg("Invalid public key length (must be 33-byte compressed secp256r1).")]
    InvalidPubkeyLength,
    #[msg("Malformed or untrusted WebAuthn assertion.")]
    InvalidWebAuthnAssertion,
    #[msg("Recovery timelock must not be negative.")]
    InvalidRecoveryTimelock,
    #[msg("A recovery is in flight. Veto it or execute it before unlocking.")]
    RecoveryInProgress,
    #[msg("This authorization was already used or is out of date. Approve the action again.")]
    StaleAuthorization,
    #[msg("That transfer would spend the rent the account needs to stay alive.")]
    BelowRentReserve,
    #[msg("A recovery guardian is required, and it cannot be the zero address.")]
    GuardianRequired,
    #[msg("This agent session is not allowed to do that.")]
    AgentProgramNotAllowed,
    #[msg("The wallet cannot be its own recovery guardian.")]
    InvalidGuardian,
    #[msg("Invalid cluster tag. Must be devnet or mainnet.")]
    InvalidClusterTag,
}
