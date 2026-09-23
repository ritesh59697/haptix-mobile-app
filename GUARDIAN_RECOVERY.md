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

1. On the phone: Settings → Recovery → **Change guardian**.
2. Paste an address only the laptop controls — `solana-keygen pubkey <keypair>`.
3. Approve both biometric prompts.

After this the phone can no longer start a recovery, and the button in that card goes
dead. That is the intended state, not a regression.

## Run-book

From `solana-mobile/haptix-mobile-app`, with the guardian keypair available (either
`EXPO_PUBLIC_HAPTIX_FUNDER_KEY` in `.env`, or `--keypair <path>`):

```bash
WALLET=<wallet address>

npm run guardian -- status     $WALLET   # guardian, timelock, integrity check
npm run guardian -- veto-check $WALLET   # is the owner's veto still reachable?
npm run guardian -- initiate   $WALLET   # freeze + propose (guardian signs)
npm run guardian -- execute    $WALLET   # refused until the timelock elapses
```

`initiate` writes the replacement keypair to `~/.haptix-guardian/<wallet>.json` so a
later `execute` installs the pair it proposed. Those keys stand in for "the new phone".

### What each step proves

- **On the phone, during the window.** Sends are refused, and _unfreeze is refused too_ —
  a freeze that can be lifted by hand is not a veto window. The phone should offer
  Veto (2-of-2).
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

## Timelocks

The window is fixed at creation and there is no setter. A 24h default makes the execute
leg untestable, so with `EXPO_PUBLIC_HAPTIX_DEV_MODE=true` the create sheet exposes a
dev-only field that accepts `30s`, `5m`, `24h` and similar.

## Still missing

- `set_spend_threshold` has a builder in `utils/haptix-client.ts` and tests, but no UI,
  so the threshold — like the guardian before this — is fixed at creation.
- `set_guardian` requires the owner's passkeys, so a wallet whose both keys are lost
  cannot have its guardian moved. The guardian is a recovery _starter_, not a
  replacement owner.
