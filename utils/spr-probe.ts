/**
 * Privacy Rings runtime probe (docs/PRIVATE_SEND_PLAN.md, section 3.2: the Hermes go/no-go).
 *
 * Runs the plan's checks in order and records each one instead of stopping at the first
 * failure, so one run on a phone says exactly which piece of the SDK the runtime can't carry:
 *   0. capability report (always runs)
 *   1. import the SDK
 *   2. `initializePoseidon()` (WASM)
 *   3. `@solana/kit` WebCrypto ed25519 signer (informational; the probe signs with noble instead)
 *   4. shielded key derivation
 *   5. client + `attestProver()` (HPKE / enclave attestation)
 *   6. funded devnet loop: register two owners, deposit, private transfer A -> B (remote proof),
 *      then return both private balances to the funder and sweep the public SOL
 *
 * The SDK is loaded with `import()` inside each step, never at module top level, so a runtime
 * that can't evaluate it fails that step rather than the app's startup.
 *
 * Platform-neutral on purpose: the settings screen runs it under Hermes, and
 * `tools/spr-probe-node.ts` runs the same code under Node to prove the probe itself is right.
 * Never records seeds or key material; API keys in URLs are redacted from every detail.
 */
import { ed25519 } from '@noble/curves/ed25519'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

export interface SprProbeConfig {
  /** Devnet RPC URL; its `api-key` query is also the Helius key for the prover. */
  rpcUrl: string
  /** Privacy Rings indexer base URL, without a key. */
  indexerUrl: string
  /** Privacy Rings prover base URL, without a key (added from `rpcUrl`). */
  proverUrl: string
  /** Devnet funder, 64-byte secret key. Only its first 32 bytes (the seed) are used. */
  funderSecret: Uint8Array
  /** Lamports the run may spend; defaults to 1% of the funder balance, as in the Node spike. */
  budgetLamports?: bigint
  /** Random bytes from the platform CSPRNG. */
  randomBytes: (length: number) => Uint8Array
}

export type SprProbeStatus = 'pass' | 'fail' | 'skip' | 'info'

export interface SprProbeStep {
  name: string
  status: SprProbeStatus
  ms?: number
  detail?: string
}

export interface SprProbeTx {
  step: string
  ms: number
  bytes: number
  signature: string
}

export interface SprProbeReport {
  runtime: string
  startedAt: string
  capabilities: Record<string, string>
  steps: SprProbeStep[]
  txs: SprProbeTx[]
  netSpentLamports?: bigint
  /** Go only if a private transfer completed (plan section 3). */
  verdict: 'go' | 'no-go' | 'running'
}

type Sdk = typeof import('@heliuslabs/spr')
type SdkClient = Awaited<ReturnType<Sdk['createSprClient']>>
type KitTransaction = Parameters<typeof import('@solana/kit').getBase64EncodedWireTransaction>[0]

/** The error and its cause chain, with any api-key in a URL redacted. */
export function describeProbeError(err: unknown): string {
  const parts: string[] = []
  let cur = err as { code?: unknown; message?: unknown; details?: unknown; cause?: unknown } | undefined
  for (let depth = 0; cur && depth < 6; depth++) {
    const head = typeof cur.code === 'string' ? cur.code : String(cur.message ?? cur)
    const details = cur.details
      ? ` ${JSON.stringify(cur.details, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`
      : ''
    const message = typeof cur.code === 'string' && typeof cur.message === 'string' ? ` (${cur.message})` : ''
    parts.push(`${head}${message}${details}`)
    cur = cur.cause as typeof cur
  }
  return redact(parts.join(' <- '))
}

function redact(text: string): string {
  return text.replace(/api-key=[^&"\s)]+/g, 'api-key=REDACTED')
}

function describeRuntime(): string {
  const g = globalThis as { HermesInternal?: { getRuntimeProperties?: () => Record<string, string> } }
  if (g.HermesInternal) {
    const props = g.HermesInternal.getRuntimeProperties?.() ?? {}
    return `Hermes ${props['OSS Release Version'] ?? props['Build'] ?? '(version unknown)'}`
  }
  const p = (globalThis as { process?: { versions?: { node?: string } } }).process
  return p?.versions?.node ? `Node ${p.versions.node}` : 'unknown JS runtime'
}

/** What the SDK's dependencies reach for, so a failure can be read against what's missing. */
export function probeCapabilities(): Record<string, string> {
  const g = globalThis as Record<string, unknown>
  const crypto = g.crypto as { subtle?: unknown; getRandomValues?: unknown } | undefined
  const abortSignal = g.AbortSignal as { timeout?: unknown } | undefined
  const wasm = g.WebAssembly as { instantiate?: unknown } | undefined
  return {
    WebAssembly: typeof g.WebAssembly,
    'WebAssembly.instantiate': typeof wasm?.instantiate,
    'crypto.getRandomValues': typeof crypto?.getRandomValues,
    'crypto.subtle': typeof crypto?.subtle,
    TextEncoder: typeof g.TextEncoder,
    TextDecoder: typeof g.TextDecoder,
    atob: typeof g.atob,
    structuredClone: typeof g.structuredClone,
    'AbortSignal.timeout': typeof abortSignal?.timeout,
    WebSocket: typeof g.WebSocket,
    fetch: typeof g.fetch,
    URL: typeof g.URL,
    BigInt: typeof g.BigInt,
  }
}

/** Run every probe step; `onUpdate` gets a fresh copy of the report after each step. */
export async function runSprProbe(
  config: SprProbeConfig,
  onUpdate?: (report: SprProbeReport) => void,
): Promise<SprProbeReport> {
  const report: SprProbeReport = {
    runtime: describeRuntime(),
    startedAt: new Date().toISOString(),
    capabilities: probeCapabilities(),
    steps: [],
    txs: [],
    verdict: 'running',
  }
  const publish = () => onUpdate?.({ ...report, steps: [...report.steps], txs: [...report.txs] })
  const record = (step: SprProbeStep) => {
    report.steps.push(step.detail ? { ...step, detail: redact(step.detail) } : step)
    publish()
  }
  const skip = (name: string, why: string) => record({ name, status: 'skip', detail: why })

  /** Runs one step, records pass/fail and timing, and returns its value (undefined on failure). */
  async function step<T>(name: string, fn: () => Promise<T>, describe?: (value: T) => string): Promise<T | undefined> {
    const t = Date.now()
    try {
      const value = await fn()
      record({ name, status: 'pass', ms: Date.now() - t, detail: describe?.(value) })
      return value
    } catch (err) {
      record({ name, status: 'fail', ms: Date.now() - t, detail: describeProbeError(err) })
      return undefined
    }
  }

  record({
    name: 'capability report',
    status: 'info',
    detail: Object.entries(report.capabilities)
      .map(([k, v]) => `${k}=${v}`)
      .join(', '),
  })

  // 1. Import. Metro bundles these, but evaluates them only here.
  const sdk = await step('import @heliuslabs/spr', () => import('@heliuslabs/spr'))
  const sdkClient = await step('import @heliuslabs/spr/client', () => import('@heliuslabs/spr/client'))
  const sdkKeypair = await step('import @heliuslabs/spr/keypair', () => import('@heliuslabs/spr/keypair'))
  const kit = await step('import @solana/kit', () => import('@solana/kit'))

  // 2. Poseidon hasher (WASM).
  let poseidonOk = false
  if (sdk) {
    poseidonOk = Boolean(
      await step('initializePoseidon() (WASM hasher)', async () => {
        await sdk.initializePoseidon()
        return true
      }),
    )
  } else {
    skip('initializePoseidon() (WASM hasher)', 'SDK did not import')
  }

  // 3. kit's own signer, for the record. The probe signs with noble, so this can't mask SDK results.
  if (kit) {
    await step('@solana/kit WebCrypto ed25519 signer (info only)', async () => {
      const signer = await kit.generateKeyPairSigner()
      return signer.address
    })
  } else {
    skip('@solana/kit WebCrypto ed25519 signer (info only)', '@solana/kit did not import')
  }

  // 4. Shielded key derivation.
  const makeOwner = (s: Sdk, kp: NonNullable<typeof sdkKeypair>, k: NonNullable<typeof kit>) => {
    const seed = config.randomBytes(32)
    const address = k.getAddressDecoder().decode(ed25519.getPublicKey(seed))
    const keypair = s.ShieldedKeypair.fromKeypair(s.SigningKey.fromEd25519Bytes(kp.bytes32(seed.slice())))
    const web3 = Keypair.fromSeed(seed)
    return { seed, address, keypair, web3 }
  }
  type Owner = ReturnType<typeof makeOwner>
  let A: Owner | undefined
  let B: Owner | undefined
  if (sdk && sdkKeypair && kit && poseidonOk) {
    await step(
      'derive shielded keypairs (ShieldedKeypair.fromKeypair)',
      async () => {
        A = makeOwner(sdk, sdkKeypair, kit)
        B = makeOwner(sdk, sdkKeypair, kit)
        return A.keypair.shieldedAddress()
      },
      () => 'two throwaway owners',
    )
  } else {
    skip('derive shielded keypairs (ShieldedKeypair.fromKeypair)', 'needs the SDK, kit and Poseidon')
  }

  // 5. Client and prover attestation.
  const apiKey = new URL(config.rpcUrl).searchParams.get('api-key') ?? undefined
  // The prover client reads its key from its own URL's `api-key` only (seen in 0.9.0-alpha).
  const proverUrl = (() => {
    const url = new URL(config.proverUrl)
    if (apiKey && !url.searchParams.has('api-key')) url.searchParams.set('api-key', apiKey)
    return url.toString()
  })()
  let client: SdkClient | undefined
  if (sdkClient) {
    const clientConfig = {
      solanaRpcUrl: config.rpcUrl,
      indexerUrl: config.indexerUrl,
      proverUrl,
      apiKey,
      proverTee: sdkClient.SignedTeePolicy.forNetwork('devnet'),
    }
    // `createSprClient` only adds `initializePoseidon()` to the constructor. Without Poseidon,
    // build the client directly so attestation (HPKE, WebCrypto) still gets its own verdict.
    client =
      sdk && poseidonOk
        ? await step('createSprClient()', () => sdk.createSprClient(clientConfig))
        : await step('new SprClient() without Poseidon (attestation only)', async () => {
            return new sdkClient.SprClient(clientConfig) as SdkClient
          })
  } else {
    skip('createSprClient()', 'the client module did not import')
  }
  let attestOk = false
  if (client) {
    const c = client
    attestOk = Boolean(
      await step('client.attestProver() (HPKE + enclave attestation)', async () => {
        await c.attestProver()
        return true
      }),
    )
  } else {
    skip('client.attestProver() (HPKE + enclave attestation)', 'no client')
  }

  // 6. Funded loop.
  let transferred = false
  const connection = new Connection(config.rpcUrl, 'confirmed')
  const funder = Keypair.fromSeed(config.funderSecret.slice(0, 32))
  let funderBefore: bigint | undefined
  if (sdk && kit && client && A && B && attestOk) {
    const c = client
    const k = kit
    const owners = [A, B]
    const ready = { a: A, b: B }

    const signWith = (tx: KitTransaction, owner: Owner): KitTransaction => {
      const signatures = { ...tx.signatures } as Record<string, Uint8Array | null>
      for (const addr of Object.keys(signatures)) {
        if (addr !== owner.address) throw new Error(`transaction needs a signature from ${addr}, not the owner`)
        signatures[addr] = ed25519.sign(Uint8Array.from(tx.messageBytes), owner.seed)
      }
      return Object.freeze({ ...tx, signatures }) as unknown as KitTransaction
    }
    const wireSize = (tx: KitTransaction) => {
      const n = Object.keys(tx.signatures).length
      return tx.messageBytes.length + (n < 128 ? 1 : 2) + 64 * n
    }
    /** Sign with noble, send, and wait for the SDK's own confirmation. Returns the landed slot. */
    const submit = async (label: string, tx: KitTransaction, owner: Owner, started: number) => {
      const signed = signWith(tx, owner)
      const signature = await c.solanaRpc
        .sendTransaction(k.getBase64EncodedWireTransaction(signed), { encoding: 'base64' })
        .send()
      const slot = await c.confirmTransaction(signature)
      report.txs.push({ step: label, ms: Date.now() - started, bytes: wireSize(signed), signature })
      return slot
    }
    const transferSol = async (from: Keypair, to: PublicKey, lamports: bigint) => {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }))
      const latest = await connection.getLatestBlockhash('confirmed')
      tx.recentBlockhash = latest.blockhash
      tx.feePayer = from.publicKey
      tx.sign(from)
      const sig = await connection.sendRawTransaction(tx.serialize())
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
    }
    const balance = async (pk: PublicKey) => BigInt(await connection.getBalance(pk, 'confirmed'))

    funderBefore = await step(
      'read funder balance',
      () => balance(funder.publicKey),
      (v) => sol(v),
    )
    const budget = config.budgetLamports ?? (funderBefore ?? 0n) / 100n
    const fundA = budget / 2n
    const fundB = budget / 4n
    const depositAmount = fundA / 2n
    const transferAmount = depositAmount / 2n

    const funded =
      funderBefore !== undefined &&
      (await step(
        'fund A and B from the devnet funder',
        async () => {
          await transferSol(funder, ready.a.web3.publicKey, fundA)
          await transferSol(funder, ready.b.web3.publicKey, fundB)
          return true
        },
        () => `${sol(fundA)} + ${sol(fundB)}`,
      ))

    let registered = Boolean(funded)
    for (const [label, owner] of [
      ['A', ready.a],
      ['B', ready.b],
    ] as const) {
      if (!registered) break
      const t = Date.now()
      const ok = await step(`register ${label}`, async () => {
        const reg = await sdk.buildRegistrationTransaction({
          client: c,
          owner: owner.address,
          address: owner.keypair.shieldedAddress(),
        })
        if (reg) await submit(`register ${label}`, reg as KitTransaction, owner, t)
        return true
      })
      registered = Boolean(ok)
    }

    const wallets = new Map(
      owners.map((o) => [
        o,
        {
          wallet: new sdk.Wallet({ identity: o.keypair.shieldedAddress() }),
          keys: sdk.LocalKeys.fromKeypair(o.keypair, c.proofService),
        },
      ]),
    )
    const wa = wallets.get(ready.a)!
    const wb = wallets.get(ready.b)!

    let depositSlot: bigint | undefined
    if (registered) {
      const t = Date.now()
      depositSlot = await step(
        'deposit into A (public)',
        async () => {
          await sdk.syncWallet({ client: c, wallet: wa.wallet, keys: wa.keys })
          const tx = await sdk.buildDepositTransaction({
            client: c,
            feePayer: ready.a.address,
            recipient: ready.a.keypair.shieldedAddress(),
            amount: depositAmount,
          })
          return submit('deposit', tx as KitTransaction, ready.a, t)
        },
        () => sol(depositAmount),
      )
    } else {
      skip('deposit into A (public)', 'registration did not complete')
    }

    if (depositSlot !== undefined) {
      const t = Date.now()
      const slot = await step(
        'private transfer A -> B (remote proof)',
        async () => {
          await sdk.syncWallet({ client: c, wallet: wa.wallet, keys: wa.keys, config: { requireSlot: depositSlot } })
          const tx = await sdk.buildTransferTransaction({
            client: c,
            wallet: wa.wallet,
            keys: wa.keys,
            feePayer: ready.a.address,
            recipient: ready.b.address,
            amount: transferAmount,
          })
          return submit('private transfer (incl. remote proof)', tx as KitTransaction, ready.a, t)
        },
        () => sol(transferAmount),
      )
      if (slot !== undefined) {
        await step(
          'B decrypts the amount it received',
          async () => {
            await sdk.syncWallet({ client: c, wallet: wb.wallet, keys: wb.keys, config: { requireSlot: slot } })
            await sdk.syncWallet({ client: c, wallet: wa.wallet, keys: wa.keys, config: { requireSlot: slot } })
            const got = wb.wallet.balance(sdk.SOL_MINT).amount
            if (got !== transferAmount) throw new Error(`B sees ${got}, expected ${transferAmount}`)
            transferred = true
            return got
          },
          (v) => sol(v),
        )
      }
    } else {
      skip('private transfer A -> B (remote proof)', 'no deposit')
    }

    // Return what is left in both private balances, then sweep public SOL. Best effort.
    for (const [label, owner] of [
      ['A', ready.a],
      ['B', ready.b],
    ] as const) {
      const w = wallets.get(owner)!
      const left = depositSlot === undefined ? 0n : w.wallet.balance(sdk.SOL_MINT).amount
      if (left <= 0n) continue
      const t = Date.now()
      await step(`return ${label}'s private balance to the funder (remote proof)`, async () => {
        const tx = await sdk.buildWithdrawalTransaction({
          client: c,
          wallet: w.wallet,
          keys: w.keys,
          feePayer: owner.address,
          recipient: k.address(funder.publicKey.toBase58()),
          amount: left,
        })
        return submit(`return ${label} private balance`, tx as KitTransaction, owner, t)
      })
    }
    if (funded) {
      await step('sweep public SOL back to the funder', async () => {
        const rentMin = BigInt(await connection.getMinimumBalanceForRentExemption(0))
        for (const owner of owners) {
          const bal = await balance(owner.web3.publicKey)
          // Leave two rent minimums so the fee never drops the remainder below rent.
          const sweep = bal - 2n * rentMin
          if (sweep > 0n) await transferSol(owner.web3, funder.publicKey, sweep)
        }
        return true
      })
    }
  } else {
    skip('funded devnet loop', 'needs the SDK, kit, keys, client and a passing attestation')
  }

  for (const owner of [A, B]) owner?.seed.fill(0)
  if (funderBefore !== undefined) {
    try {
      report.netSpentLamports = funderBefore - BigInt(await connection.getBalance(funder.publicKey, 'confirmed'))
    } catch {
      // the summary line is optional
    }
  }
  report.verdict = transferred ? 'go' : 'no-go'
  publish()
  return report
}

function sol(lamports: bigint): string {
  return `${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
}

/** Plain-text report for the clipboard and the console. */
export function formatSprProbeReport(r: SprProbeReport): string {
  const lines = [
    `Privacy Rings probe — ${r.verdict.toUpperCase()}`,
    `runtime: ${r.runtime}`,
    `started: ${r.startedAt}`,
    '',
    ...r.steps.map(
      (s) =>
        `[${s.status}] ${s.name}${s.ms !== undefined ? ` (${s.ms} ms)` : ''}${s.detail ? `\n    ${s.detail}` : ''}`,
    ),
  ]
  if (r.txs.length) {
    lines.push('', 'transactions (devnet):')
    for (const t of r.txs) lines.push(`  ${t.step}: ${t.ms} ms, ${t.bytes} bytes, ${t.signature}`)
  }
  if (r.netSpentLamports !== undefined) lines.push('', `net devnet SOL spent: ${sol(r.netSpentLamports)}`)
  const passed = r.steps.filter((s) => s.status === 'pass').length
  const failed = r.steps.filter((s) => s.status === 'fail').length
  lines.push('', `PASSED: ${passed} | FAILED: ${failed}`)
  return lines.join('\n')
}
