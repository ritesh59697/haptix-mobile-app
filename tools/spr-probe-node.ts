/**
 * Runs the in-app Privacy Rings probe (`utils/spr-probe.ts`) under Node, against devnet.
 *
 * This checks the probe, not the runtime: if it passes here and fails on the phone, the
 * failure is Hermes. Same variables as the app reads, from the repo's `.env`:
 *   EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL, EXPO_PUBLIC_HAPTIX_FUNDER_KEY,
 *   EXPO_PUBLIC_HAPTIX_SPR_DEVNET_INDEXER_URL, EXPO_PUBLIC_HAPTIX_SPR_DEVNET_PROVER_URL,
 *   EXPO_PUBLIC_HAPTIX_SPR_PROBE_BUDGET_LAMPORTS (optional)
 *
 * Run:  npx -y tsx tools/spr-probe-node.ts
 */
import { join } from 'node:path'
import { formatSprProbeReport, runSprProbe } from '../utils/spr-probe'

process.loadEnvFile(join(__dirname, '..', '.env'))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set. See .env.example.`)
  return value
}

async function main() {
  const funderSecret = Uint8Array.from(JSON.parse(required('EXPO_PUBLIC_HAPTIX_FUNDER_KEY')) as number[])
  const budget = process.env.EXPO_PUBLIC_HAPTIX_SPR_PROBE_BUDGET_LAMPORTS?.trim()
  const report = await runSprProbe({
    rpcUrl: required('EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL'),
    indexerUrl: required('EXPO_PUBLIC_HAPTIX_SPR_DEVNET_INDEXER_URL'),
    proverUrl: required('EXPO_PUBLIC_HAPTIX_SPR_DEVNET_PROVER_URL'),
    funderSecret,
    budgetLamports: budget ? BigInt(budget) : undefined,
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  })
  funderSecret.fill(0)
  console.log(`\n${formatSprProbeReport(report)}\n`)
  process.exit(report.verdict === 'go' ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
