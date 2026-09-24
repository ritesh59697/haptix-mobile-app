# Guardian recovery testing

Recovery exists so a wallet outlives the device holding its passkeys. The property it
has to have is asymmetric: a guardian can **start** a takeover and still cannot
**finish** one. Two things enforce that, and both need to be tested.

## Who can call what

| Instruction         | Who signs              | Effect                                                                         |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `initiate_recovery` | guardian alone         | stores the proposed keys, sets `recovery_initiated_at`, **freezes** the wallet |
| `cancel_recovery`   | owner, 2-of-2 passkeys | clears the proposal, unfreezes. Guardian excluded                              |
| `execute_recovery`  | **nobody**             | installs the proposed keys. Gated only by `now >= initiated_at + timelock`     |

`execute_recovery` having no signature is deliberate: after the veto window has passed,
the only thing standing between a proposal and a rotation is the timelock itself. The
owner's protection is _time_, not a signature.

## Why one machine is not a test

On Devnet every wallet is created with the bundled funder key
(`EXPO_PUBLIC_HAPTIX_FUNDER_KEY`) as its guardian, and that key is compiled into the app
bundle. So the in-app "Start Recovery (Guardian)" button does both halves at once: the
phone proposes the keys **and** signs as the guardian. That exercises the state machine,
which is worth doing, but it cannot show that a guardian is powerless to finish, because
there is no second party to be powerless.

Two machines, or one machine and a phone, is the smallest arrangement that can.

## Setup

Point the wallet's guardian at a key the phone does **not** hold. This is the step that
splits the roles, and it needs both passkeys, so it has to happen in the app:

1. On the phone: **Settings**, then the **Guardian & recovery** row under the _Recovery_
   card. That row opens the **Recovery** page.
2. On that page tap **Change guardian**, paste an address only the laptop controls
   (`solana-keygen pubkey <keypair>`), then **Update Guardian (2-of-2)**.
3. Approve both biometric prompts.
4. Fund that keypair with a little Devnet SOL. `initiate` sets
   `feePayer: guardian.publicKey` and signs with the guardian alone, so a guardian holding
   zero lamports cannot start a recovery at all. It fails at simulation with
   `Attempt to debit an account but found no record of a prior credit`, which reads like a
   program error and is not one — it means the guardian has no SOL to pay its own fee.

   ```bash
   solana transfer --from ~/.config/solana/<funder>.json <guardian-pubkey> 0.02 --url devnet
   ```

After this the phone can no longer start a recovery, and **Start Recovery (Guardian)** is
not rendered at all, because the device does not hold the key the button would have to sign
with. A button that dims but can never succeed is still a dead end, so the card falls back
to the sentence explaining who can start one. That is the intended state, not a regression.

Everything recovery-related lives on that one screen. The wallet itself only carries the
freeze state: when a recovery is in flight the wallet shows a banner naming it and
linking straight back to **Settings → Recovery**.

## Run-book

From `solana-mobile/haptix-mobile-app`, with the guardian keypair available. Resolution
order is `--keypair <path>`, then `HAPTIX_GUARDIAN_KEYPAIR` — which is read as a **path**,
not as inline JSON — then `EXPO_PUBLIC_HAPTIX_FUNDER_KEY` from `.env`. Once the guardian
has been moved off the bundled funder key, only the first two resolve to something the
program will accept, and the fallback fails with `This keypair ... is not the guardian`:

```bash
export WALLET=<wallet address>
export HAPTIX_GUARDIAN_KEYPAIR=~/.config/solana/haptix-guardian.json

npm run guardian -- status     $WALLET   # guardian, timelock, integrity check
npm run guardian -- veto-check $WALLET   # is the owner's veto still reachable?
npm run guardian -- initiate   $WALLET   # freeze + propose (guardian signs)
npm run guardian -- execute    $WALLET   # refused until the timelock elapses
```

`initiate` writes the replacement keypair to `~/.haptix-guardian/<wallet>.json` so a
later `execute` installs the pair it proposed. Those keys stand in for "the new phone",
and the file holds their **private** scalars — which is what keeps a rotated wallet
spendable from the machine that staged them, and what makes losing that file the one way
to genuinely strand a wallet. The file is written _before_ the transaction is sent, so a
failed `initiate` still leaves a proposal behind. `initiate` reuses whatever is already
staged rather than generating a fresh pair, because regenerating would leave the machine
holding keys the program will never install.

### Before you run `execute`

`execute` guards itself with `if (remaining > 0 && !force)` — a **local clock check**, not a
dry run. Once the timelock has elapsed it submits for real, and `--force` skips the check
entirely, so after the window `--force` is no longer a simulation. The Dev window is 30s,
which is shorter than it takes to read this paragraph: run `status` first, and if it reads
`in flight, elapsed left`, then `execute` **will** rotate the keys.

### What each step proves

- **On the phone, during the window.** Sends are refused, and _unfreeze is refused too_ —
  a freeze that can be lifted by hand is not a veto window. **Settings → Recovery** shows
  the time left and offers **Keep My Keys**, which is the owner's veto under a label that
  names what the owner keeps instead of the CLI's noun. Three places must name the recovery rather than
  offer an Unlock the program would reject, and they should read exactly:
  - Home banner: title `RECOVERY IN FLIGHT`, action **Open Recovery**.
  - Security page card: title `Recovery In Flight`, action **Open Recovery**.
  - A send attempted inside the window: dialog `Wallet Locked`, body naming the recovery
    and pointing at Settings → Recovery.

  Every one of those actions must land on the Recovery page. An **Unlock** button in any
  of these three spots is the old bug: the program rejects an unfreeze while a recovery is
  pending, so the button could only ever fail.

- **On the Recovery page, the safe action has to be the loud one.** A live recovery offers
  two answers: keep the current keys (**Keep My Keys**) or install the proposal (Execute,
  permissionless and irreversible). Keeping the keys is the owner's answer, so it is the
  filled button and it leads. Execute sits below it as a **hold** (`HoldToConfirmButton`,
  `variant="danger"`), and before the window closes it is a disabled row reading
  `Execute unlocks in …`. The first live run tapped Execute by accident while reaching for
  the veto, because Execute was the filled button and the veto the dim one. The disabled row also
  has to _look_ disabled: an inert control that renders like a live one is how the wrong
  button gets pressed.

- **`execute` before the timelock** declines to submit and says how long is left. Add
  `--force` to submit anyway and read the program's own refusal, rather than take the
  local prediction for it. This is the guardian being unable to finish.
- **`veto-check`** is read-only and answers the failure that matters most in practice:
  whether the account is still derivable at all. A rejection for missing passkey
  signatures is expected; the phone supplies those.
- **`execute` after the timelock** rotates the keys and leaves the address unchanged.
  `status` prints `address integrity` for exactly this: the PDA must stay derivable from
  the pinned `wallet_seed`, or the account is stranded with its lamports intact and no
  instruction able to reach it.

### The lost-phone run

1. `initiate` from the laptop — the wallet freezes, the phone can no longer act.
2. Let the timelock elapse without vetoing.
3. `execute` from the laptop — the new keys are in force and the old device is out.

The address never moves, so anything sent to it during the window is still there
afterwards.

Step 3 has no undo. The phone is not bricked so much as irrelevant: it still holds
passkeys the account no longer accepts, and nothing on the device can change that. The
guardian key itself survives the rotation, so the wallet stays reachable — but only by
starting another recovery from the machine holding the staged pair, and the phone can no
longer veto that one, because a veto needs the signatures it just lost.

### Verified against Devnet

Run on 2026-09-24 against `HziZimWjrC3TZCSPA8EzqJCCnsk7hUxu8QVpxCjs3kNb` — 30s timelock,
0.1 SOL threshold, guardian moved to a laptop-held key first. `initiate` landed, the phone
showed the `RECOVERY IN FLIGHT` banner, a send was refused with `Wallet Frozen`, the window
elapsed, and `execute` rotated the keys. The resulting account state was then read back
directly and compared against what the CLI had staged:

| Check                                        | Result    |
| -------------------------------------------- | --------- |
| `primary_passkey` equals the staged public   | yes       |
| `secondary_passkey` equals the staged public | yes       |
| `frozen`                                     | false     |
| `recovery_initiated_at`                      | 0         |
| the pinned seed derives the same PDA         | yes       |
| SOL balance                                  | unchanged |

That is the whole property in a single run: the device that lost the argument still has
its lamports, and the address never moved.

The veto half was verified separately, on a `30s` wallet created with the laptop key set
as guardian at creation (`Recovery Guardian (optional)` on the create sheet, which is
cheaper than the Change guardian round-trip — it needs no passkeys because the wallet does
not exist yet). That run also exercised both states of the Recovery page's action column:
inside the window the row reads `Execute unlocks in …`, disabled, under the filled
**Keep My Keys**;
once the window closes it becomes the danger-styled hold. `cancel_recovery` landed, and
`status` afterwards read `frozen false` / `recovery none`.

Worth noting what that proves: `cancel_recovery` only succeeds if the supplied passkey
signatures match the passkeys stored on the account, so a successful veto is itself the
evidence that a rotation did _not_ touch them. The keys the owner had when the recovery
started are the keys they still have.

## Timelocks

The window is fixed at creation and there is no setter, so **a wallet that already exists
cannot be shortened.** A 24h default makes the execute leg untestable, so with
`EXPO_PUBLIC_HAPTIX_DEV_MODE=true` the create sheet (sign-in) exposes a dev-only field
that accepts `30s`, `5m`, `24h` and similar. To watch `execute` actually rotate the keys
inside one session, create a **fresh wallet** with a `30s` window and run the whole
run-book against that one.

## Still missing

- `set_spend_threshold` has a builder in `utils/haptix-client.ts` and tests, but no UI,
  so the threshold — like the guardian before this — is fixed at creation.
- `set_guardian` requires the owner's passkeys, so a wallet whose both keys are lost
  cannot have its guardian moved. The guardian is a recovery _starter_, not a
  replacement owner.
