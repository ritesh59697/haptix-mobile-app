# Passkey setup — relying party `haptix-passkeys.vercel.app`

Haptix wallet keys are WebAuthn credentials scoped to the relying party **`haptix-passkeys.vercel.app`**.
This value is load-bearing in three places and they must all agree:

| Where                                     | What                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `utils/haptix-passkey.ts`                 | `PASSKEY_RP_ID = 'haptix-passkeys.vercel.app'` — sent as `rp.id` / `rpId` |
| `programs/haptix_program/src/webauthn.rs` | `RP_ID` — compared against `authenticatorData.rpIdHash` on-chain          |
| this document                             | the domain that must publish the association files below                  |

Two OS-level associations make that work. **They are a prerequisite for creating a
wallet, not for building the app** — everything else can be developed and tested
without them, but on a device the platform authenticator will refuse to mint a
credential for an unassociated RP ID.

---

## 1. Android — Digital Asset Links

Host **exactly** this at:

```
https://haptix-passkeys.vercel.app/.well-known/assetlinks.json
```

```json
[
  {
    "relation": ["delegate_permission/common.get_login_creds"],
    "target": {
      "namespace": "android_app",
      "package_name": "io.haptix.wallet",
      "sha256_cert_fingerprints": ["REPLACE_WITH_UPPERCASE_COLON_SEPARATED_SHA256"]
    }
  }
]
```

Requirements:

- HTTP `200`, `Content-Type: application/json`, and **no redirects** (`http → https`
  included). Android's Digital Asset Links client does not follow them.
- Reachable without authentication, cookies, or a user agent check.
- One entry per signing certificate. Add a second entry for the EAS-managed release
  keystore; debug and release fingerprints differ.
- `package_name` must match `expo.android.package` in `app.json` (`io.haptix.wallet`).

### Getting the SHA-256 fingerprint

Local debug keystore (the one `expo run:android` uses by default):

```sh
keytool -list -v \
  -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android \
  | grep 'SHA256:'
```

EAS-managed credentials:

```sh
eas credentials -p android      # → Keystore → "SHA1 Fingerprint"/"SHA256 Fingerprint"
```

Or read it straight out of an APK EAS already built, which avoids the interactive
prompt and works when the keystore is stored on EAS rather than on this machine.
Release APKs are signed with the v2/v3 scheme only, so there is no `META-INF/*.RSA`
entry for `keytool -printcert -jarfile` to read; the certificate has to come out of
the APK Signing Block, which is what the helper in this repo does:

```sh
curl -sSL -o /tmp/haptix.apk "<Application Archive URL from `eas build:list`>"
python3 tools/apk-signing-fingerprint.py /tmp/haptix.apk
```

The value goes into `sha256_cert_fingerprints` in the colon-separated uppercase hex
form that both commands above print, e.g. `AB:CD:...:EF`.

**Registered as of 2026-09-24.** The `preview` profile's EAS keystore hashes to
`63:FE:F2:23:9B:12:70:EC:37:81:E0:39:AB:7A:71:EA:8D:D0:CA:D5:F5:7B:F7:4F:6C:12:A4:CC:79:89:B7:D8`,
and that value is what `assetlinks.json` currently publishes. A `preview` APK
therefore passes Digital Asset Links as-is. The keystore is stored on EAS, so every
`preview` build reuses it and the association keeps holding. Rotating it (or adding a
`production` build, which signs with a different keystore) means publishing a second
entry before hardware passkeys work in that build.

### The `android:apk-key-hash:` origin

Android Credential Manager reports a different `origin` than the web:
`android:apk-key-hash:<base64url>` where the suffix is the **base64url of the same
32 digest bytes**, not the hex string. The on-chain verifier accepts any well-formed
value here (the relying-party binding is carried by `rpIdHash`), so you do not need to
publish it — but it is useful when debugging. Convert the hex above with:

```sh
printf '%s' 'AB:CD:...:EF' | tr -d ':' | xxd -r -p | basenc --base64url | tr -d '='
```

### Verifying

- Google's checker: <https://developers.google.com/digital-asset-links/tools/generator>
  (enter `haptix-passkeys.vercel.app`, `io.haptix.wallet`, the fingerprint).
- Or, on a device, attempt wallet creation and watch for the
  `BadConfiguration` error, which `utils/haptix-passkey.ts` maps to an explicit
  "not correctly associated with the haptix-passkeys.vercel.app relying party" message.

`react-native-passkey` needs no manifest work of its own: it talks to Credential
Manager through `androidx.credentials`, which it bundles. The permissions the biometric
gate does need are contributed by the `expo-local-authentication` config plugin, already
registered in `app.json`, so a prebuild adds them automatically:

- `android.permission.USE_BIOMETRIC`
- `android.permission.USE_FINGERPRINT`

No `<queries>` entry is required: passkeys are served by the platform credential
provider rather than an intent the app has to declare.

---

## 2. iOS — Associated Domains

Host **exactly** this at:

```
https://haptix-passkeys.vercel.app/.well-known/apple-app-site-association
```

```json
{
  "applinks": {},
  "webcredentials": {
    "apps": ["REPLACE_WITH_APPLE_TEAM_ID.io.haptix.wallet"]
  },
  "appclips": {}
}
```

Requirements:

- `Content-Type: application/json`, HTTP 200, no redirects, no authentication.
- The `.well-known` path must not require a filename extension — iOS fetches the
  extensionless path above.
- `REPLACE_WITH_APPLE_TEAM_ID` is the 10-character Team ID from the Apple Developer
  account; the bundle identifier must match `expo.ios.bundleIdentifier`.

### App-side configuration

The entitlement is declared in `app.json` and applied by Expo's config step
(no bare workflow needed):

```json
"ios": {
  "bundleIdentifier": "io.haptix.wallet",
  "associatedDomains": ["webcredentials:haptix-passkeys.vercel.app"]
}
```

Confirm it landed after a prebuild by checking
`ios/HaptixWallet/HaptixWallet.entitlements` contains
`webcredentials:haptix-passkeys.vercel.app` under `com.apple.developer.associated-domains`.

> **Verify before shipping.** `app.json` now sets `ios.bundleIdentifier` to
> `io.haptix.wallet`, matching `expo.android.package`. If the released iOS app ends up
> with a different bundle identifier, change it in **both** places — `app.json` and the
> `webcredentials.apps` entry of the AASA file — because they are compared literally.

---

## 3. How the assertion reaches the chain

Both key modes are verified by Solana's native `Secp256r1SigVerify` precompile, in two
wire formats selected by the byte in the precompile instruction's `padding` slot —
which the runtime explicitly ignores, so it is free for the program to use:

**Software keys (wallets created before this change) — mode `0x00`**

The precompile's message region is the raw payload (`recipient ‖ amount`,
`GRANT_AGENT: ‖ …`, …). The program recomputes that payload from the instruction
arguments and requires the region to match byte-for-byte. Unchanged.

**Platform passkeys — mode `0x01`**

An authenticator will not sign an arbitrary payload; it signs
`authenticatorData ‖ SHA-256(clientDataJSON)`. Pointing the precompile's message
region at exactly those bytes makes the digest it verifies the digest the
authenticator produced, so the precompile call is unchanged in substance. The region
is then caller-supplied rather than computed on-chain, so
`programs/haptix_program/src/webauthn.rs` takes over the binding and requires:

1. the 32-byte trailer to equal `SHA-256(clientDataJSON)`;
2. `authenticatorData.rpIdHash == SHA-256("haptix-passkeys.vercel.app")`;
3. the User Present **and** User Verified flags to be set;
4. `clientDataJSON.type == "webauthn.get"`;
5. base64url(`clientDataJSON.challenge`) to equal the authorized payload;
6. `clientDataJSON.origin` to be `https://haptix-passkeys.vercel.app` or a well-formed
   `android:apk-key-hash:<32-byte digest>`.

Client data must sit **outside** the hashed region. `clientDataJSON` is carried _after_
the message region, not inside `message_data_size`, and the parser requires the total
instruction length to be exactly `115 + (len(authData) + 32) + len(clientDataJSON)`.
Folding it into the signed bytes changes the digest the precompile computes, so the
transaction aborts with `custom program error: 0x2` before any of the checks above run.
The two cannot be decoupled: the 32-byte trailer inside the signed region is compared
against `SHA-256` of the carried `clientDataJSON` (check 1).

Both wire formats, byte for byte, are pinned offline by
`tests/secp256r1-layout.test.ts`, and the parser's side by the Rust tests in
`programs/haptix_program/src/secp256r1.rs`.

The client builds that layout in
`utils/secp256r1-instruction.ts → createWebAuthnSecp256r1Instruction`.

### What is deliberately not claimed

Registration requests `attestation: 'none'`. Nothing here cryptographically proves
the key lives in a TPM, Secure Enclave, or StrongBox rather than a software
authenticator the user installed. The honest claim — and the only one the UI should
make — is that the key is a _platform passkey_: generated in and used by the OS
authenticator, and not exportable.

---

## 4. Quick checklist

- [ ] `https://haptix-passkeys.vercel.app/.well-known/assetlinks.json` returns the JSON above, 200,
      `application/json`, no redirect.
- [ ] The debug **and** release keystore SHA-256 fingerprints are both listed.
- [ ] `package_name` matches `expo.android.package`.
- [ ] `https://haptix-passkeys.vercel.app/.well-known/apple-app-site-association` returns the JSON
      above with the real Team ID.
- [ ] `expo.ios.bundleIdentifier` is set and matches the AASA entry.
- [ ] `expo.ios.associatedDomains` contains `webcredentials:haptix-passkeys.vercel.app`.
- [ ] The on-chain `RP_ID` and `PASSKEY_RP_ID` still read `haptix-passkeys.vercel.app`.
