# Relay Hardening Backlog

Findings from an audit of `tools/haptix-relay.js`, which Render runs via
`npm run start:relay`.

**Status**: issue 1 is fixed and deployed. Issue 4 was withdrawn — it described
behaviour the Web Vault depends on. Issues 2, 3 and 5 are still open.

Deploy note: the Render service now tracks this repo with Auto-Deploy on, so a
push to `main` restarts the relay. It previously deployed from a nested copy
inside `ritesh59697/haptix`, which left production ~19 days behind this repo.

## Why none of this is urgent

The relay holds no private keys and submits no transactions. It is a passive
message bus: the phone posts a pending transfer, the Web Vault reads it, the
vault posts back a passkey signature, the phone collects it and submits the
transaction itself.

On top of that, the on-chain program binds every passkey signature to a
specific recipient, amount and `auth_nonce`. A tampered or mismatched payload
cannot produce a transaction the program will accept.

So the issues below are **availability and robustness**, not theft. The worst
realistic outcome is a failed or confusing demo, not lost funds.

## 1. Unbounded request body — FIXED

Fixed in `fix(relay): cap POST body size to prevent memory exhaustion`.
`readLimitedBody()` caps every POST body at 10 KB, answers 413 past it and
destroys the socket. Measured before the fix: a 5 MB POST to `/pending-tx`
returned HTTP 200 and was buffered in full. After: 413, relay still serving.

Original finding below.

`POST /pending-tx` and `POST /submit-signature` accumulate the request body
without a size limit:

```js
let body = ''
req.on('data', (chunk) => (body += chunk))
```

A large enough POST exhausts memory and kills the instance. Real payloads are
well under a kilobyte.

**Fix**: cap the body (~10 KB), destroy the request past the cap, respond 413.

## 2. No rate limiting

Every endpoint is open and uncounted. Combined with (1), the service is easy to
knock over.

**Fix**: a per-IP counter over a short window, 429 past the limit. An in-memory
`Map` is enough at this scale; it resets on restart, which is acceptable here.

## 3. State is lost on restart

`pendingById` and `pendingByWallet` are in-process `Map`s. Render's free tier
sleeps when idle, so a cold start drops every pending transfer.

This is the most likely cause of a visible demo failure: a 2-of-2 transfer
started before the nap disappears before the vault can answer it.

**Fix**: persist pending transfers (Redis, or a small file) with the existing
10-minute TTL. Related operational note: warm the relay immediately before any
live demo, since a cold start already costs 30-50 seconds.

## 4. `GET /pending-tx` fallback — WITHDRAWN, do not "fix"

With neither `id` nor `wallet` supplied, the handler returns the most recent
non-declined transfer across all wallets. That reads like a bug, but
`public/vault.html:2374` polls this endpoint with no parameters at all:

```js
var res = await fetch(relayOrigin + '/pending-tx')
```

So the fallback is the mechanism the Web Vault relies on to discover a pending
transfer. Requiring `id` or `wallet` would silently break 2-of-2 signing.

The real limitation is multi-tenancy: with two sessions live at once, a vault
can display the other one's transfer. It cannot be signed into anything valid —
the signed message commits to recipient and amount — but it looks wrong.

**If this is ever addressed**, change `vault.html` to pass the wallet it is
co-signing for _first_, and only then tighten the endpoint. Both sides have to
move together.

## 5. Minor

- The `osascript` notification block only runs on macOS and is dead code on
  Render's Linux hosts.
- `tools/haptix-relay.ts` and `tools/haptix-relay.js` are parallel copies of the
  same service. Render runs the `.js`, so a fix applied only to the `.ts` would
  silently miss production. Worth collapsing to one source.
