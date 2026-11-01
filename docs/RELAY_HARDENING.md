# Relay Hardening Backlog

Findings from an audit of `tools/haptix-relay.js` (the file Render runs, via
`npm run start:relay`). **Nothing here is applied.** Deferred until after
hackathon judging so a running production service is not changed under a
deadline.

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

## 1. Unbounded request body (highest priority)

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

## 4. `GET /pending-tx` falls back to the newest transfer from any wallet

With neither `id` nor `wallet` supplied, the handler scans for the most recent
non-declined transfer across all users. With two people demoing at once, the
vault can display someone else's transfer.

It cannot be signed into anything valid, because the signed message commits to
the recipient and amount, but it looks broken.

**Fix**: require `id` or `wallet`; drop the fallback and return 400.

## 5. Minor

- The `osascript` notification block only runs on macOS and is dead code on
  Render's Linux hosts.
- `tools/haptix-relay.ts` and `tools/haptix-relay.js` are parallel copies of the
  same service. Render runs the `.js`, so a fix applied only to the `.ts` would
  silently miss production. Worth collapsing to one source.
