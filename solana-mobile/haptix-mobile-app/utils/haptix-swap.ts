/**
 * Instant SOL <-> USDC swaps.
 *
 * There is no swap implementation behind this module. Devnet has no Jupiter
 * liquidity to route against, and shipping a fabricated fill would violate the
 * "no simulated trades" rule the rest of the app follows. Until real routing
 * exists, the UI shows an inert "Coming Soon" placeholder instead of a control
 * that can be tapped into a trade.
 */
export const SWAP_ENABLED = false

export const SWAP_COMING_SOON_LABEL = 'Coming Soon'
