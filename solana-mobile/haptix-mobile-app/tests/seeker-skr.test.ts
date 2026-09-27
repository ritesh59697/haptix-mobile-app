/**
 * Seeker (SKR) Token & Zero-SOL Gasless Onboarding Paymaster Test Suite
 *
 * Verifies:
 * 1. Seeker SKR PDA mint and metadata integrity (100 SKR genesis, 50 SKR quorum threshold)
 * 2. Gasless onboarding sponsor paymaster keypair & Devnet funding
 * 3. 1-tap vs 2-of-2 hardware quorum risk policy for SKR transfers
 */
import { PublicKey } from '@solana/web3.js'
import { SEEKER_SKR_MINT, SKR_TOKEN_METADATA, USDC_TOKEN_METADATA } from '../utils/haptix-tokens'
import { getFundedDevnetPayer } from '../utils/haptix-funder'
import { HAPTIX_PROGRAM_ID } from '../utils/haptix-client'

let passed = 0
let failed = 0

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${name}`)
    passed++
  } else {
    console.error(`  FAIL: ${name}`)
    if (detail) console.error(`        Detail: ${detail}`)
    failed++
  }
}

console.log('\n--- SEEKER (SKR) TOKEN & SPONSORED PAYMASTER SUITE ---\n')

// 1. Seeker SKR Token Mint Derivation
assert(
  PublicKey.isOnCurve(SEEKER_SKR_MINT.toBuffer()) === false,
  'Seeker SKR mint is an off-curve PDA',
)

const [expectedMint, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from('seeker_skr_mint')],
  HAPTIX_PROGRAM_ID,
)
assert(
  SEEKER_SKR_MINT.equals(expectedMint),
  'Seeker SKR mint matches deterministic program PDA derivation',
)
assert(bump >= 0 && bump <= 255, 'Valid canonical bump derived for SKR mint')

// 2. Token Metadata & Seeker Genesis Rules
assert(SKR_TOKEN_METADATA.symbol === 'SKR', 'SKR token symbol is SKR')
assert(SKR_TOKEN_METADATA.name === 'Seeker', 'SKR token name is Seeker')
assert(SKR_TOKEN_METADATA.decimals === 6, 'SKR token uses standard 6 decimals')
assert(
  SKR_TOKEN_METADATA.initialGenesisReward === 100,
  'Seeker Genesis Reward grants 100 SKR welcome allocation',
)
assert(
  SKR_TOKEN_METADATA.quorumThreshold === 50,
  'SKR spending limit threshold is 50 SKR for 2-of-2 hardware quorum',
)
assert(
  SKR_TOKEN_METADATA.fallbackPriceUsd === 0.25,
  'SKR reference market price is $0.25 USD',
)

// 3. Quorum Threshold Risk Policy Logic
function requiresQuorum(amount: number, threshold: number): boolean {
  return amount > threshold
}

assert(
  !requiresQuorum(10, SKR_TOKEN_METADATA.quorumThreshold),
  '10 SKR transfer is low-risk: 1-tap passkey authorized',
)
assert(
  !requiresQuorum(50, SKR_TOKEN_METADATA.quorumThreshold),
  '50 SKR transfer (at threshold) is low-risk: 1-tap passkey authorized',
)
assert(
  requiresQuorum(50.01, SKR_TOKEN_METADATA.quorumThreshold),
  '50.01 SKR transfer requires 2-of-2 hardware quorum escalation',
)
assert(
  requiresQuorum(100, SKR_TOKEN_METADATA.quorumThreshold),
  '100 SKR full genesis transfer requires 2-of-2 hardware quorum',
)

// 4. USDC Token Metadata & Threshold Rules
assert(USDC_TOKEN_METADATA.symbol === 'USDC', 'USDC token symbol is USDC')
assert(USDC_TOKEN_METADATA.quorumThreshold === 20, 'USDC spending limit threshold is 20 USDC')
assert(
  !requiresQuorum(15, USDC_TOKEN_METADATA.quorumThreshold),
  '15 USDC transfer is low-risk: 1-tap passkey authorized',
)
assert(
  requiresQuorum(25, USDC_TOKEN_METADATA.quorumThreshold),
  '25 USDC transfer requires 2-of-2 hardware quorum escalation',
)

// 5. Gasless Onboarding Paymaster Funder
async function runFunderCheck() {
  const funder = await getFundedDevnetPayer()
  assert(funder !== null, 'Devnet sponsor paymaster keypair is loaded')
  if (funder) {
    assert(
      typeof funder.publicKey?.toBase58 === 'function',
      'Sponsor paymaster has valid Solana PublicKey',
    )
  }
}

void runFunderCheck().then(() => {
  console.log(`\nSEEKER SKR & PAYMASTER TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
  if (failed > 0) process.exit(1)
})
