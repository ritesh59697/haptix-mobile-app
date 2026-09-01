# Haptix (`haptix-labs`)

> **The Biometric Hardware Enclave Layer for EVM.**

An ERC-4337 smart account architecture that enforces **autonomous spending policies on-chain**, authorized by **WebAuthn passkeys** (P-256), and verified through the RIP-7212 hardware precompile on Base.

---

## Live on Base Sepolia

| Parameter | Value |
|---|---|
| Smart Account | [`0x34Aeb3A39fd1838D1C897F879EAB0a258507802c`](https://sepolia.basescan.org/address/0x34Aeb3A39fd1838D1C897F879EAB0a258507802c) |
| ERC-4337 EntryPoint | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (v0.7) |
| Hardware Signers | 2 passkeys (Touch ID / Apple Secure Enclave & YubiKey) |
| First UserOp Receipt | [`0x3c40196f…acc9b1`](https://sepolia.basescan.org/tx/0x3c40196f878b9c9a1630bc8e6181ab10f8a29197ce3561431ef4b7d5a6acc9b1) — 1 passkey, 0.4s Touch ID |
| 2-of-2 Quorum UserOp | [`0x8fb6cb54…f05e4`](https://sepolia.basescan.org/tx/0x8fb6cb5460ebf6a203a450c70094da68bc3738be03f4405d55eb90ede99f05e4) — 2 passkeys, `setWindow` |
| On-Chain Policy Engine | 0.01 ETH per-op threshold · 0.05 ETH 24h rolling cap · Panic Freeze |

That transaction is a real UserOp: a Touch ID passkey authorized an ETH transfer
through the EntryPoint, with `validateUserOp` verifying the P-256 signature
on-chain via the precompile. `UserOperationEvent` reports `success = true`,
240,031 gas, 0.0000132 ETH.

## Quick start

```bash
git clone --recurse-submodules <repo-url>
cd passkey-wallet
forge test
```

`--recurse-submodules` matters: `lib/forge-std` is a submodule. If you already
cloned without it, run `git submodule update --init --recursive`.

---

## The idea it replaces

The instinct "require a second factor for big transfers" is correct. The naive
version — a TOTP prompt in a wallet UI — does not work, because a private key
has no login to gate:

- an attacker imports the stolen key into MetaMask and never sees your app
- they sign offline and broadcast to any public RPC
- the TOTP secret has to live *somewhere*, and every location is either
  custodial or sitting next to the key it protects

The fix is not a better prompt. It is moving enforcement to **code the attacker
must go through**: a contract that will not execute a large transfer without a
second signature, no matter what client produced the transaction.

That is what `validateUserOp` in `src/PasskeyAccount.sol` does.

---

## Policy

The policy looks **inside** the call, not just at the ETH riding along with it.

| Call | Signatures |
|---|---|
| ETH below `threshold` | 1 |
| ETH at or above `threshold` | 2 |
| ERC-20 `transfer` / `transferFrom` below that token's threshold | 1 |
| ERC-20 `transfer` / `transferFrom` at or above it | 2 |
| `approve` / `increaseAllowance` / `setApprovalForAll` | **2, always** |
| Token with no configured threshold | 2 |
| Any unrecognized selector | 2 |
| Malformed ABI encoding | 2 |
| `executeBatch` | summed per asset, see below |

### Batching

`executeBatch` is the natural way to reopen a spending limit: split one large
transfer into eleven small ones, each under the threshold. The policy sums the
batch **per asset** and applies the thresholds once to the totals.

Assets are summed *separately* — ETH and USDC are different units, and a single
running total would also let a large amount of one mask a large amount of the
other. A batch of 0.5 ETH + 500 USDC clears with one signature; 11 × 0.9 ETH
does not.

One unpriceable entry anywhere in a batch (an approve, an unknown selector, an
unconfigured token) escalates the **entire** batch.

Batches longer than `MAX_PRICED_BATCH` (16) escalate rather than being priced
partially — ERC-4337 validation runs under a bundler gas limit, so an unbounded
loop here would be a denial-of-service on the account's own validation.

Measured: ~107k gas baseline (mostly the P-256 verification) + ~6.5k per entry;
16 entries ≈ 194k. Linear, not quadratic.

### The rolling window

Summing within one UserOp is not enough: an attacker just sends twenty of them.
Measured before the fix — **20 ops × 0.99 ETH = 19.8 ETH authorized, one
signature each**, against a 1 ETH per-op threshold.

`SpendWindow` tracks cumulative spend across ops inside a time window. Two
ERC-7562 rules shape the entire design:

- **STO-010** — the account may read *and write* its own storage during
  validation. So the accounting is legal.
- **OP-011** — `TIMESTAMP` and `NUMBER` are **banned** during validation. So
  validation cannot tell whether the window has expired.

That second rule is the whole problem: "reset the counter if the window rolled
over" is exactly the check we are forbidden from making.

The escape hatch is `validationData`'s time range. Validation cannot read the
clock, but it can *return the assumption it made*, and the EntryPoint checks
that assumption against `block.timestamp` afterwards, reverting `AA22 expired
or not due` if it fails. So:

| Case | Returned | Enforced by EntryPoint |
|---|---|---|
| Fits the current window | `validUntil = expiry` | rejects if the window already closed |
| Does not fit | `validAfter = expiry` | not includable until the window rolls |
| No window open yet | neither | unconstrained |

The window is only ever **advanced in `execute`** (post-validation), where
`TIMESTAMP` is legal. Validation only ever reads.

A **two-signature quorum bypasses the window entirely** — deliberately. The
second factor exists precisely so the owner can override their own limit;
without that, a user could lock themselves out of their funds for a day.

### Per-asset windows

Each asset has its **own** window: ETH keyed by `address(0)`, each ERC-20 by its
token address. This is the only correct shape — 1 ETH and 1000 USDC cannot share
a counter without a price oracle, and an oracle would mean reading *external*
storage during validation, which STO-021/022 restrict and which no price feed
satisfies in practice.

STO-010 makes this legal: an account may touch **any** of its own slots during
validation, mapping slots included, regardless of key. So
`mapping(address => Window)` is fine to read in `validateUserOp`.

An op touching several assets is authorized only where **all** of their windows
agree, and the returned time range is the **intersection** of the per-asset
ranges (`max(validAfter)`, `min(validUntil)`). An empty intersection means no
timestamp satisfies every constraint, so the op is rejected outright rather than
being handed a range the EntryPoint would always refuse.

The two limits are independent layers, checked in order:

1. **Per-op threshold** (`tokenThreshold`) — how much one operation may move
2. **Rolling window** (`windowCap`) — how much accumulates across operations

An op over the per-op threshold needs two signatures no matter how empty the
window is.

### Token Decimals & Base Units (e.g. USDC 6 decimals)

Thresholds and window caps are stored in each token's **raw base units** ($10^{\text{decimals}}$).
Because validation runs under strict ERC-7562 storage rules with zero external oracle calls,
`tokenDecimals` is recorded at configuration time (via `setTokenThreshold` and `setWindow`)
for client / UI / script reference:

* **Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals)**:
  - $100\text{ USDC per-op threshold} = 100 \times 10^6 = \mathbf{100{,}000{,}000\text{ base units}}$
  - $500\text{ USDC 24h rolling cap} = 500 \times 10^6 = \mathbf{500{,}000{,}000\text{ base units}}$
  - Set via: `account.setTokenThreshold(USDC, 100_000_000, 6)` and `account.setWindow(USDC, 500_000_000, 1 days, 6)`

* **18-decimal Tokens (e.g. DAI, native ETH)**:
  - $0.05\text{ ETH} = 0.05 \times 10^{18} = \mathbf{50{,}000{,}000{,}000{,}000{,}000\text{ wei}}$

`validateUserOp` evaluates stored base units directly without any external `token.decimals()` SLOADs.

`MAX_PRICED_ASSETS` (4) caps distinct assets per op. Each one costs an SLOAD
plus a merge — measured at ~28k gas, and sixteen distinct tokens reached ~445k,
past common bundler `verificationGasLimit` defaults. Beyond the cap the op
escalates to a full quorum, and the bail-out happens *during* accumulation
rather than after, which is what actually saves the gas (60k instead of 445k).

Cost: ~121k for a single-signature op (from ~107k before windowing); ~198k for a
worst-case 4-asset batch.

Approvals are always full-quorum regardless of amount, because they are
unbounded, persistent delegations of spending authority — strictly more
dangerous than a one-off transfer. This is the `approve()` drain vector that
empties wallets whose owner *is* the legitimate signer.

The design stance is an **allowlist**: anything the policy cannot positively
identify as low-risk requires two signatures. A blocklist would be unfixable —
there are unbounded ways to move value out of an account.

Config changes (`addSigner`, `setThreshold`) are `onlySelf` — they can only be
reached through a UserOp, so they are subject to the same policy. A config path
that bypassed the policy would be a bypass of the policy.

---

## Why passkeys and not TOTP

A passkey's private key is generated inside the Secure Enclave / StrongBox and
is **non-exportable**. Malware on the device can request a signature (with a live
biometric present) but cannot copy the key. A TOTP seed is just bytes on disk —
whoever reads the disk has it forever.

---

## Layout

```
src/
├── PasskeyAccount.sol         the smart account; policy lives in validateUserOp, ERC-1271, and signer lifecycle
├── PasskeyAccountFactory.sol  CREATE2 factory for deterministic counterfactual deployment
├── SpendPolicy.sol            calldata parser & allowlist classifier for ETH, ERC-20, and batch pricing
├── SpendWindow.sol            24h rolling spend limits using ERC-7562 time-bound verification
└── WebAuthn.sol               P-256 + WebAuthn assertion verification via RIP-7212 precompile (0x100)

test/                          10 test suites (148 tests passing, all using real P-256 vectors)
script/                        deployment, counterfactual config, and userOp broadcast scripts
web/                           browser wallet (index.html, app.html, config.js)
tools/                         genvec.mjs vector generator (WebCrypto P-256)
```

## Run the tests

```bash
forge test -vv
```

All tests use **real P-256 signatures** verified by the native precompile at
`0x100` (requires `evm_version = "osaka"`, already set in `foundry.toml`).
Nothing is mocked — a green run means the cryptography actually works.

Regenerate vectors:

```bash
node tools/genvec.mjs > tools/vectors.json
```

## Run the browser harness

```bash
npx serve web -l 5199
```

Then open http://localhost:5199 and click **Create passkey**.

WebAuthn requires a **secure context**. `http://localhost` qualifies;
`file://` and `data:` do **not** — opening the HTML directly will fail with
`crypto.subtle` undefined.

---

## Four things that will bite you

These are the bugs this repo already has tests for. They are the reason passkey
wallets are harder than they look.

**1. The authenticator does not sign your bytes.**
It signs `sha256(authenticatorData || sha256(clientDataJSON))`. Verifying the
raw challenge instead is the most common passkey bug — it passes every test
where you control both sides, then fails against real hardware.

**2. Signature malleability.**
`(r, s)` and `(r, n−s)` are both cryptographically valid over the same message.
The precompile accepts both. `test_Attack_HighS_Rejected` proves this, then
proves the contract rejects the high-s twin anyway.

**3. The precompile needs `staticcall`.**
On some OP-stack nodes, `0x100` returns *empty returndata* when reached through
a state-modifying call frame — while still reporting success. `staticcall` is
the documented fix. This one never reproduces in Foundry, only on real testnets.

**4. Invalid means empty, not zero.**
The precompile returns 32 bytes of `1` on success and **zero bytes** on failure.
`abi.decode`-ing the failure case reverts. Verified live on Base Sepolia:

```
valid   -> 0x0000...0001
corrupt -> 0x   (empty)
```

---

## Deploying to Base Sepolia

EntryPoint addresses, confirmed live on chain 84532:

| Version | Address |
|---|---|
| v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |

This account targets the v0.7/v0.8 `PackedUserOperation` layout.

Base Sepolia USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals) —
*not* the mainnet address, which has no code on this chain.

### Deploy

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --account <your-keystore-name> \
  --broadcast
```

Simulated cost: ~5.2M gas, ~0.000057 ETH at 0.011 gwei.

Drop `--broadcast` to simulate first — that needs no key at all.

### Counterfactual Deployment & Factory (CREATE2)

Accounts can be deployed counterfactually via `PasskeyAccountFactory.sol` using standard CREATE2 salts.
To predict the deterministic wallet address off-chain before broadcast:

```bash
forge script script/Deploy.s.sol:ComputeCounterfactualAddress --rpc-url https://sepolia.base.org
```

For ERC-4337 v0.7 user operations, the factory supports `initCode` deployment:
```solidity
bytes memory initCode = abi.encodePacked(
    address(factory),
    abi.encodeWithSignature(
        "createAccount((uint256,uint256),(uint256,uint256),uint256,bytes32)",
        passkey0,
        passkey1,
        threshold,
        salt
    )
);
```

### Verify after deploying

```bash
ACCOUNT=0x... forge script script/Verify.s.sol:Verify --rpc-url https://sepolia.base.org
```

Read-only. Confirms signer 0 matches the real Touch ID passkey and replays a
genuine hardware signature through the on-chain precompile.

### Configuring an `onlySelf` function

`setWindow`, `setTokenThreshold`, `addSigner`, `removeSigner`, and `replaceSigner` are all `onlySelf`. Reaching
them takes two things that are easy to get wrong:

**1. The call must be wrapped in `execute`.** `onlySelf` requires
`msg.sender == address(this)`. A UserOp whose `callData` is `setWindow(...)`
directly arrives with `msg.sender == EntryPoint` and reverts `NotSelf()`. The
correct form makes the account call itself:

```solidity
execute(address(account), 0, abi.encodeCall(setWindow, (...)))
```

This failure mode is expensive to learn: validation *passes*, both signatures
are accepted, and the revert happens during execution — so the account pays gas
for a UserOp that changed nothing. `UserOperationEvent.success` is `false` while
the transaction itself reports success. **Check the event, not the tx status.**

**2. It takes the full 2-signature quorum,** because the wrapped call is not a
recognised spending selector and the policy fails safe. The rule that guards
spending also guards the limits themselves — one stolen passkey cannot raise its
own cap.

The consequence at deploy time: **an account with one enrolled passkey can never
be configured**, since enrolling the second signer would itself need two
signatures. `PasskeyAccount` and `PasskeyAccountFactory` strictly enforce enrolling
at least 2 passkeys at construction (`MinSignersRequired`).

Working end-to-end example: [`script/SendConfigureWindow.s.sol`](script/SendConfigureWindow.s.sol),
landed on-chain in [`0x8fb6cb54…f05e4`](https://sepolia.basescan.org/tx/0x8fb6cb5460ebf6a203a450c70094da68bc3738be03f4405d55eb90ede99f05e4).

---

## What is deliberately missing

The following architectural choices are deliberate:

- **No proxy / upgradeability** — account implementation is immutable by design
- **No social recovery / guardians** — key recovery relies on the 2-of-N hardware passkey quorum
- **No on-chain price oracle or cross-asset unified USD budget** — each asset maintains independent accounting to stay within ERC-7562 opcode/storage validation rules (no external SLOADs or oracle calls during validation)
- **No multi-chain signer synchronization** — accounts bind `block.chainid` and EntryPoint directly, failing closed across chains
- **No mobile apps / token swap UI** — browser-native WebAuthn P-256 implementation

- **Windows must be configured per token.** A token with no `setWindow` call has
  no rolling limit — it is still bound by its per-op `tokenThreshold`, but does
  not accumulate. Unlike `tokenThreshold`, where zero means "unknown, require a
  quorum", zero here means "no rolling limit". That asymmetry is deliberate but
  worth knowing.
- **Bundler reputation.** Writing account storage during validation is legal,
  but ops whose validation result can be invalidated by *other* ops may be
  dropped or throttled by bundlers. Two ops from the same account in one bundle
  will conflict on the window slot. Real deployments stake the account or
  accept the throttling.

## Five bugs found while building this

Kept as a record, because each one is a class of mistake rather than a typo.

1. **Duplicate-signer check ran after signature verification** — rejection cost
   107k gas instead of 32k. An attacker could force the account to pay for
   verifications that were always going to be discarded. Fix: validate all
   signer ids before any cryptography.

2. **Unguarded calldata slice** — `callData[36:68]` on a truncated call reverted
   inside `validateUserOp` instead of cleanly rejecting.

3. **`file://` has no `crypto.subtle`** — WebAuthn needs a secure context. The
   harness must be served over `http://localhost`.

4. **Empty slice conflated two meanings** — `_extractFunc` returned an empty
   slice both for "no inner calldata" and "ABI decoding failed", so malformed
   calldata masqueraded as a harmless zero-value ETH send and cleared with a
   single signature. Fix: return an explicit `decoded` flag. Caught by
   `test_Attack_MalformedFuncOffset_DoesNotRevert`.

5. **Unconfigured token defaulting to unlimited** — treating `threshold == 0` as
   "no limit" rather than "unknown" would have reopened the ERC-20 bypass for
   every token not explicitly configured.

Bugs 4 and 5 share a root cause worth internalizing: **a missing value and an
unknown value are not the same thing**, and in security code the difference is
usually the vulnerability.
