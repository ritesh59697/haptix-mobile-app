# 🚀 Haptix Cloud Relay Deployment Guide

The **Haptix Cloud Relay** is a lightweight, zero-dependency Node.js service that orchestrates cross-device **2-of-2 Hardware Vault Quorum** between the mobile phone (Seeker / Android APK) and the secondary device ([vault.html](https://haptix-passkeys.vercel.app/vault.html)).

---

## ⚡ Option 1: Deploy on Render.com (Recommended — 100% Free)

1. Sign up or log into [Render.com](https://render.com).
2. On your dashboard, click **New +** ➔ **Web Service**.
3. Select **Build and deploy from a Git repository** and connect:
   - **Repository:** `ritesh59697/haptix` (or `ritesh59697/haptix-mobile-app`)
   - **Branch:** `main`
4. Configure the service settings:
   - **Name:** `haptix-relay`
   - **Region:** Any (e.g. Frankfurt, Oregon, Singapore)
   - **Language:** `Node`
   - **Root Directory:** (leave empty if deploying `ritesh59697/haptix`, or set `haptix-mobile-app` if deploying `haptix-mobile-app` repo)
   - **Build Command:** `npm install`
   - **Start Command:** `npm run start:relay` *(or `node solana-mobile/haptix-mobile-app/tools/haptix-relay.js`)*
   - **Plan:** Free
5. Click **Create Web Service**.
6. Render will automatically provision a public HTTPS URL:
   ```
   https://haptix-relay.onrender.com
   ```
7. Verify by opening in your browser:
   `https://haptix-relay.onrender.com/status`  
   Should return: `{"ok":true,"service":"Haptix Cloud Relay","activePending":0,...}`

---

## ⚡ Option 2: Deploy on Railway.app

1. Log into [Railway.app](https://railway.app).
2. Click **New Project** ➔ **Deploy from GitHub repo**.
3. Select `ritesh59697/haptix`.
4. Go to **Settings** ➔ **Deploy**:
   - **Custom Start Command:** `node solana-mobile/haptix-mobile-app/tools/haptix-relay.js`
5. Go to **Networking** ➔ Click **Generate Domain**.
6. Railway will assign an HTTPS domain:
   ```
   https://haptix-relay.up.railway.app
   ```

---

## 🔗 Connecting the App & Web Vault to Your Relay

1. **Web Vault ([vault.html](https://haptix-passkeys.vercel.app/vault.html)):**
   By default, `vault.html` automatically routes to `https://haptix-relay.onrender.com`.
   If you use a custom domain, you can pass it directly via URL parameter:
   `https://haptix-passkeys.vercel.app/vault.html?relay=https://your-custom-relay.com`

2. **Mobile App:**
   In `constants/app-config.ts`:
   ```typescript
   static vaultRelayUrl = 'https://haptix-relay.onrender.com'
   ```
   Or set the environment variable when building:
   ```bash
   EXPO_PUBLIC_HAPTIX_RELAY_URL=https://haptix-relay.onrender.com
   ```

---

## 🛡️ Multi-Tenant & Security Features

- **Multi-Tenant Isolation:** Pending transfers are keyed by `walletPda`. Multiple users and accounts never collide.
- **TTL Memory Cleanup:** Stale requests automatically expire after 10 minutes.
- **No Private Keys Stored:** The relay never sees or stores private keys or seeds. It only forwards public Secp256r1 precompile challenges and WebAuthn signatures.
- **Offline / Out-of-Band Fallback:** If the relay is ever unreachable, users can copy the transfer request link and paste the signature code directly into the mobile app.
