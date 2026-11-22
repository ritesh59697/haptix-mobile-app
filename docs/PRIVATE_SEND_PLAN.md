# Private Send with Helius Privacy Rings: Plan

Status: draft plan, nothing built yet. Target: a devnet demo of Haptix sending SOL with the amount hidden.
Written 2026-11-22 against `@heliuslabs/spr@0.9.0-alpha` and the Haptix `main` branch at `7726528`.

---

## 0. Decision: a private balance outside passkey control, with a cap

**Decided 2026-11-22:** Phase 1 goes ahead with a device-held private-balance key, limited by a configurable cap (`EXPO_PUBLIC_HAPTIX_PRIVATE_BALANCE_CAP`, section 4.5). The reasoning is below.

**The private balance would sit outside Haptix's passkey security model.**

Privacy Rings need an **ed25519 Solana key** as the owner of a shielded balance, and that key also signs every private transfer. Haptix's money lives in a **program-owned PDA** that only P-256 passkeys can move, and the Haptix program cannot make cross-program calls (CPI). So the only path that works without changing the program is a separate, device-held ed25519 "private balance" key.

Money in that private balance would **not** be covered by:

- the 2-of-2 passkey quorum,
- the on-chain spend threshold and rolling 24h limit,
- guardian freeze and recovery.

Recommendation: accept this for the demo, but **cap the private balance** (for example a configurable maximum, read from config, never hardcoded). Present it in the UI as a "spending pocket" and keep the vault as the place for savings. Phase 2 (section 6) is the route to putting it back under passkey control, if Helius confirms it's possible.

---

## 1. What Privacy Rings actually hide

Copy in the app must match this. Do not promise "anonymous" payments.

| Step                            | Hidden                    | Public                             |
| ------------------------------- | ------------------------- | ---------------------------------- |
| Deposit (public → private)      | nothing                   | sender, asset, amount              |
| Private transfer (Default Ring) | asset, amount, memo       | **sender and recipient addresses** |
| Withdraw (private → public)     | remaining private balance | asset, amount, destination         |

Consequences for the design:

- **Top up once, spend many times.** "Shield then send" for every payment leaks the amount, because the deposit and transfer happen together and the deposit is public. The feature is a private balance the user tops up occasionally, not a per-send toggle.
- **Say "hides amounts", not "hides who".** In the Default Ring both parties are visible.
- **Unregistered recipients.** If the recipient has no Private Wallet record, SDK 0.9.0-alpha **refuses** the private transfer (`WALLET_RECIPIENT_NOT_REGISTERED`, confirmed on devnet). Helius's docs say it falls back to a public withdrawal, but the SDK doesn't do that. The app should check registration before the confirm screen and offer "send publicly instead" as a separate, clearly labelled withdrawal.

---

## 2. Verified facts (checked 2026-11-22)

**Checked by us:**

- **Programs are live on both clusters.** `getMultipleAccounts` on mainnet-beta and devnet shows the Solana Privacy Program and the User Registry Program as executable, upgradeable programs. Helius says both clusters use the same addresses. Read them from the SDK's `addresses` export, don't copy them into code.
- **SDK:** `@heliuslabs/spr`, latest `0.9.0-alpha`. It's ESM-only (`import` exports, no CommonJS), declares `engines.node ^22.12.0 || >=24`, and has a peer dependency on `@solana/kit ^8.3.0`. Haptix uses `@solana/web3.js` v1, so both libraries would ship side by side.
- **The high-level SDK API is what the spike used** (from the package README, which is newer than the docs site): `createSprClient`, `ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed))`, `Wallet`, `LocalKeys`, `syncWallet`, `buildRegistrationTransaction`, `buildDepositTransaction`, `buildTransferTransaction`, `buildWithdrawalTransaction`. The low-level names from the docs (`ConfidentialTransfer`, `WithdrawalTarget`, `decryptToBalances`) also exist but aren't needed.
- **P-256 owners are unsupported.** The SDK README says: "Ed25519 is the supported owner scheme… P-256-owned notes, registry records, viewing keys and wallet snapshots are unsupported." So a passkey can't own a private balance directly, which confirms the section 0 approach.
- **Endpoints that work on devnet:** the Helius RPC from `.env`, and Helius's unified `https://devnet.helius-rpc.com/v1/spr` for **both** the indexer and the prover. The standalone CloudFront indexer and prover URLs listed in the SDK README returned **HTTP 403**.
- **SDK quirk:** the prover only reads the API key from its own URL (`?api-key=`). The client's `apiKey` setting reaches the indexer but not the prover. Without the key in the URL, enclave attestation fails as `CLIENT_PROVER_TEE_ATTESTATION {"check":"unavailable"}`. The spike adds the key to the prover URL automatically.
- **Transactions are version 1, up to 4,096 bytes.** Checked: the spike's private transfer landed on devnet as a version 1 transaction of 899 bytes (`getTransaction` reports `version: 1`, no error).

**From Helius's docs, not yet checked by us:**

- **Proving** runs server-side by default through Helius's attested enclave prover; local proving is "coming soon". The prover receives the plaintext transaction inputs and nullifier keys, so it is trusted with privacy, though it has no power to spend. (The spike confirmed the SDK attests the prover's AWS Nitro enclave before sending anything.)
- **Costs:** 5,000 lamports tree fee per tree touched, plus normal fees. Proofs cost 1,000 Helius credits each. The Free plan allows 1 proof per second. (The spike measured about 141k CU per transfer or withdrawal, in line with the docs.)
- **Key derivation:** the owner signs a fixed derivation message with ed25519. That signature is the seed for the nullifier and viewing keys, so **whoever has the signature can decrypt the user's private history.**

### Expected React Native blockers (found in the SDK source, settled in 3.2)

The SDK does use these APIs. Whether this Hermes build lacks them, and whether each one is on the core send path, is what the spike settles.

| Dependency                              | Problem on Hermes                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@lightprotocol/hasher.rs` (Poseidon)   | Ships `.wasm` binaries and loads them with `WebAssembly`. **Hermes has no WebAssembly.** The SDK calls it from `hasher/index.js`.    |
| `wallet/snapshot-cipher.js`             | Uses `globalThis.crypto.subtle` (HKDF, AES-GCM). **Avoidable:** only needed for `walletSnapshotCipher`; the spike passed without it. |
| ESM-only package, Node ≥22 engines      | Metro needs to resolve ESM `exports`; untested.                                                                                      |
| `@phala/dcap-qvl` (enclave attestation) | Not checked yet; may also need WASM or Node APIs.                                                                                    |

**This is the biggest risk in the whole plan.** Phase 0 exists to settle it before any UI work.

---

## 3. Phase 0: spike (go/no-go)

Goal: prove the Helius side works, then prove it loads in the app. No UI.

1. **Node devnet script. Done 2026-11-22, 13/13 passing.** It lives at `tools/privacy-rings-spike/spike.ts`, with its own `package.json`, so the alpha SDK stays out of the app bundle and out of CI (excluded in `tsconfig.json` and `eslint.config.js`). See the results below.
2. **Hermes import test.** In a dev build, import the SDK and run `initializePoseidon()`, one key derivation, `client.attestProver()`, and one real proof request (a tiny devnet transfer). The spike showed every transfer goes through enclave attestation and a remote proof, and that path brings its own crypto (HPKE, attestation checks). Record exactly what fails.
3. **If it fails, test the fallbacks in this order** (options to try, none is chosen yet):
   - a WebAssembly polyfill for Hermes plus a WebCrypto polyfill such as `react-native-quick-crypto`,
   - a hidden WebView that runs the SDK in a real JS engine with WASM and WebCrypto, bridged to RN,
   - a pure-JS Poseidon swapped in for `hasher.rs` (slow, but there are no proofs on-device, since proving is remote).
4. **Measure:** time to derive keys, build a transfer, get a proof back and confirm it, on a real Android device. Also count **how many transactions one private send takes** (the SDK exports cache-account instructions, so a send may span several) and the **total cost** in lamports and Helius credits.

**Go** if a private transfer completes from the app on devnet. **No-go** → stop and write to Helius with the specific blocker (see section 7).

### 3.1 Results: Node devnet spike (2026-11-22)

**The Helius side works end to end with plain ed25519 keys.** It ran with two throwaway wallets funded from the devnet funder, using 1% of its balance.

| Check                                                                              | Result |
| ---------------------------------------------------------------------------------- | ------ |
| Register both owners; a second registration reads back as already registered       | pass   |
| Deposit; A's decrypted private balance equals the deposit exactly                  | pass   |
| Private transfer A → B; B decrypts exactly the amount sent                         | pass   |
| A's private balance drops by exactly the amount sent                               | pass   |
| Transfer to an unregistered address is refused (`WALLET_RECIPIENT_NOT_REGISTERED`) | pass   |
| Withdraw B → public address; the public balance and B's private balance both match | pass   |

Measured on a Mac, from Node 24 to Helius devnet. Each operation was **one transaction**, so no cache-account splitting was needed.

| Step                                  | Time       | Tx size   | Compute units |
| ------------------------------------- | ---------- | --------- | ------------- |
| Register                              | ~1.9-2.7 s | 317 bytes | ~5.5k         |
| Deposit                               | ~3.0 s     | 362 bytes | ~38k          |
| Private transfer (incl. remote proof) | ~4.3 s     | 900 bytes | ~142k         |
| Withdraw (incl. remote proof)         | ~2.7 s     | 944 bytes | ~142k         |
| Wallet sync (discover inbound)        | ~1.1 s     | -         | -             |

Devnet signatures from the passing run, for the record:

- deposit: `5Dx3zC3Fub2wwpiMDaGGPcXLUJT3WBPpwAb2yPz1TmCH6XeKHPXR9SKVtGgDV51aagzjmwDqGiS1AMUgSUUsXpx5`
- private transfer: `2KTs1p61oLq7jmPeW63PNjBnLsRiTQvPk5SfMLRWcWBPJzqbwtTDuz4c3egozZJnqqBafTYqAVJ8u2NzVVpRNGN6`
- withdraw: `5YVvYwn8JCRrSKxJTxaMWbJUDaHapKacUdN1hvfh8iqM1Mt13VRXJXSTGzLYCFmirSwvcpUEzM5XpGPwhzSA7Ccv`

At the end, the spike withdraws both remaining private balances back to the funder (2 more proofs, both pass) and sweeps the public SOL. **A full run costs about 0.006 devnet SOL**, mostly registration rent and fees. Earlier runs, before this return step existed, left about 0.1 devnet SOL each on throwaway keys.

To reproduce: put `HAPTIX_SPR_DEVNET_INDEXER_URL` and `HAPTIX_SPR_DEVNET_PROVER_URL` in `.env` (both set to the unified devnet `/v1/spr` URL, without the key), then run `npm install && npm run spike` in `tools/privacy-rings-spike/`.

**Next:** step 3.2, the Hermes import test. That's the real go/no-go, and it needs a dev build on a phone.

---

## 4. Phase 1: private balance (no program change)

### 4.1 Keys

- New file `utils/haptix-private-key.ts`: generate an ed25519 keypair on first use and store the secret in **SecureStore with biometric-gated access** (`requireAuthentication`).
- Derive the shielded keypair with `ShieldedKeypair.fromKeypair`. Keep the derivation signature only in memory and never log it.
- **Don't reuse the guardian-key pattern.** The guardian secret is currently saved as plaintext hex in AsyncStorage (`app/sign-in.tsx:664-670`). That's a separate bug worth fixing (section 8).
- Backup and recovery: the guardian flow can't recover this key. Phase 1 needs at least an explicit "export private key" screen and a warning. Proper recovery is part of Phase 2.

### 4.2 Flows

| Flow                  | How it works                                                                                                                                                   | Signs with                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Top up**            | Existing `execute_transfer` from the vault PDA to the private-balance key, followed by `deposit`. The TRANSFER payload, WYSIWYS and thresholds stay unchanged. | passkey (vault), then private key (deposit) |
| **Register**          | `buildRegistrationTransaction` on first top-up (returns `undefined` once registered)                                                                           | private key                                 |
| **Private send**      | `buildTransferTransaction({ wallet, keys, recipient, amount })`; the proof comes from the attested Helius prover                                               | private key                                 |
| **Withdraw to vault** | `buildWithdrawalTransaction({ wallet, keys, recipient: vaultPda, amount })`                                                                                    | private key                                 |
| **Balance / history** | `syncWallet`, then `wallet.balance(SOL_MINT)` / `getPrivateTransactions`, decrypted locally (not delegated)                                                    | viewing key                                 |

- **Fees:** the private key pays its own fees and tree fees for Ring operations out of what it holds. Those operations avoid the dev-only funder (`utils/haptix-funder.ts`), which throws outside dev mode. The **top-up itself is still a vault `execute_transfer`, so it still uses the funder** and works on devnet only, like every vault send today. Every top-up should keep a fee reserve, computed from the live fee estimate rather than a fixed number.
- **Tokens:** SOL only, to match the vault (which can only move SOL today).

### 4.3 What-you-see-is-what-you-sign for Ring transactions

Ring transactions skip `utils/haptix-wysiwys.ts`, because they aren't passkey payloads. Add an equivalent check before the private key signs:

- Decode the built transfer and confirm that the recipient, mint and amount match the confirm screen.
- Confirm the recipient is registered before showing confirm. If they aren't, the private send can't happen (the SDK refuses it), so offer a separate, clearly labelled **public send** instead.

### 4.4 UI

- A **"Private balance"** card on the wallet screen with Top up, Send privately, and Move to vault.
- A send sheet variant with the copy "Amount hidden · sender and recipient visible".
- A registered/unregistered badge on the recipient before confirm.
- Activity rows marked Private, with amounts that only this device can see.

### 4.5 Config, with nothing hardcoded

- `EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL` is already wired (`utils/rpc-endpoints.ts`), so point it at Helius devnet.
- Add `EXPO_PUBLIC_HAPTIX_PRIVATE_BALANCE_CAP` and a feature flag `EXPO_PUBLIC_HAPTIX_PRIVATE_SEND`.
- Program IDs and the tree come from the SDK's `addresses` export, and fees from RPC.
- **API key exposure:** an `EXPO_PUBLIC_*` value is inlined into the APK, and proofs cost credits. For the demo, restrict the key in the Helius dashboard (allowed origins/IPs, a dedicated low-quota key). Before any public release, put the prover and indexer calls behind a small proxy that holds the key. The existing `tools/haptix-relay.ts` server could host it.

---

## 5. Prerequisite fix

**Done 2026-11-22 (uncommitted).** The send sheet used to ignore the rolling 24h window (`windowStart`/`windowSpent`) and only compare the single amount with the threshold, so the chain could reject a one-passkey send with `QuorumRequired`.

- `utils/haptix-spend-window.ts` now copies the program's rule (single amount **or** rolling 24h total over the on-chain threshold).
- The send sheet uses it with the wallet's on-chain state, judged at the chain's clock, for both the "1 passkey / 2 passkeys" label and the actual signing.
- `tests/spend-window.test.ts` (13 checks) reads `VELOCITY_WINDOW_SECONDS` and the rule straight from `execute_transfer.rs`, so drift between the app and the program fails the test.

---

## 6. Phase 2: vault-native private balance (gated, not scheduled)

Goal: the shielded balance owned by, and spent through, the passkey vault, so it is covered again by quorum, limits and recovery. Three checks decide whether this is possible:

1. **Deposit source.** The SDK's SOL deposit lists the `depositor` as a writable **signer** and passes the System Program (`interface/instructions/index.js:162-171`). Our inference (not confirmed): lamports are pulled with a System transfer. The same file also has an optional `ringAuth` account, commented "The ring program signs this account inside its CPI" (lines 166-167), so **a program-CPI deposit path does exist**, at least for ring programs. A data-carrying PDA like `WalletAccount` can't be the `from` of a System transfer, even with `invoke_signed`. A workaround is a zero-data, system-owned "staging" PDA that the Haptix program funds and then signs for. That needs new program instructions and CPI support.
2. **Ownership.** Helius docs say a UTXO owner can be a "Solana keypair or PDA", and that "Rings can support smart accounts", but give no detail. The SDK README rules out **P-256 owners**, so the passkey itself can never be the owner. The open question is whether a **PDA** can own a note and sign `transact` through CPI, with Haptix's program checking the passkey first. That's the key question for Helius.
3. **Transaction size: less tight than feared.** The SDK builds **version 1 transactions of up to 4,096 bytes**. The spike's transfer was 900 bytes and its withdraw 944. Even with one or two WebAuthn precompile instructions added (Haptix's are a few hundred bytes each), a passkey-authorised Ring spend looks likely to fit in one v1 transaction. Still to check: whether the secp256r1 precompile and Haptix's lookup-table path both work inside a v1 transaction.

If all three pass, Phase 2 is: new `ring_deposit`/`ring_transact` instructions with new signed-message prefixes (plus WYSIWYS entries), CPI into the privacy program, and a security review before anything goes near mainnet.

---

## 7. The question to ask Helius

This is a much stronger message to Mert or @HeliusPrivacy than a general request for support. It's specific, technical, and shows real usage:

> Haptix is a passkey (secp256r1) smart wallet on Solana Mobile, live on the dApp Store, with funds held in a program PDA. We have private send working on devnet with a device ed25519 key [after Phase 1]. To put shielded balances under the passkey vault itself: can a program PDA own a Ring UTXO and authorise `transact` through CPI, and is there a supported way to deposit from a data-carrying PDA? [link to demo video + repo]

---

## 8. Out of scope here, but found while planning

- **Guardian secret in plaintext AsyncStorage** (`app/sign-in.tsx:664-670`, `haptix-account-switcher-sheet.tsx:385-390`). It should move to SecureStore. This is a real security issue and is independent of this feature. A fix is ready on its own branch (`claude/reverent-shannon-1f2e67`), not yet committed or merged.
- **The MWA module is not wired into the app.** `modules/haptix-mwa` exists, but no app code calls it, and it is devnet-only and sign-messages-only. Don't claim "ships MWA" in grant applications until it's connected.
- **Mainnet:** needs a production fee payer (the funder is dev-only), the program deployed to mainnet, and an audit. These aren't part of this plan.

---

## 9. Order of work

| #   | Step                                                           | Done when                                                |
| --- | -------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | ~~Fix the `windowSpent` quorum check (section 5)~~ done        | single-passkey sends never hit `QuorumRequired`          |
| 2   | ~~Node devnet spike (section 3.1)~~ done, 13/13                | register, deposit, transfer, withdraw all pass on devnet |
| 3   | Hermes import test, then fallbacks (sections 3.2-3.3)          | go/no-go recorded                                        |
| 4   | Private key storage and derivation (section 4.1)               | key in biometric SecureStore, no plaintext anywhere      |
| 5   | Top up, send, withdraw, balance (section 4.2)                  | full loop from the app on devnet                         |
| 6   | Ring display-check and recipient badge (section 4.3)           | mismatch or unregistered recipient blocks or warns       |
| 7   | UI and copy (section 4.4)                                      | demo video recorded                                      |
| 8   | Post the demo publicly, then ask Helius the section 7 question | —                                                        |
| 9   | Phase 2 checks (section 6)                                     | decided with Helius's answer                             |

Sources: [Helius Privacy docs](https://www.helius.dev/docs/privacy), [Introducing Solana Privacy Rings](https://www.helius.dev/blog/solana-privacy-rings), the `@heliuslabs/spr@0.9.0-alpha` package source, and on-chain account checks on 2026-11-22.
