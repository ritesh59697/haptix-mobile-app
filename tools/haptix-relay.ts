import http from 'http'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'

const VAULT_HTML_PATH = path.join(__dirname, '../public/vault.html')

interface PendingTx {
  id: string
  messageHex: string
  amountSol: number
  amountUsd?: string
  feeSol?: string
  recipient: string
  walletPda: string
  walletName?: string
  spendThresholdSol?: number
  timestamp: number
  status?: 'pending' | 'signed' | 'declined'
  signature?: {
    signatureHex: string
    authenticatorDataHex: string
    clientDataJSONHex: string
  }
}

let currentPendingTx: PendingTx | null = null
let lastKnownWalletInfo: { walletName: string; spendThresholdSol: number } = {
  walletName: 'Hardware Vault 2',
  spendThresholdSol: 0.10,
}

const server = http.createServer((req, res) => {
  // Enable CORS for web requests from vault.html on any local port/origin
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  // Serve vault.html directly if requested
  if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/vault.html' || url.pathname === '/vault')) {
    if (fs.existsSync(VAULT_HTML_PATH)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (req.method === 'HEAD') {
        res.end()
      } else {
        res.end(fs.readFileSync(VAULT_HTML_PATH, 'utf-8'))
      }
      return
    }
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      hasPending: !!currentPendingTx,
      walletName: lastKnownWalletInfo.walletName,
      spendThresholdSol: lastKnownWalletInfo.spendThresholdSol,
    }))
    return
  }

  // Phone initiates transfer: POST /pending-tx
  if (req.method === 'POST' && url.pathname === '/pending-tx') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        if (data.walletName) lastKnownWalletInfo.walletName = data.walletName
        if (typeof data.spendThresholdSol === 'number') lastKnownWalletInfo.spendThresholdSol = data.spendThresholdSol

        currentPendingTx = {
          id: Math.random().toString(36).substring(2, 10),
          messageHex: data.messageHex,
          amountSol: data.amountSol,
          amountUsd: data.amountUsd,
          feeSol: data.feeSol,
          recipient: data.recipient,
          walletPda: data.walletPda,
          walletName: data.walletName || lastKnownWalletInfo.walletName,
          spendThresholdSol: data.spendThresholdSol ?? lastKnownWalletInfo.spendThresholdSol,
          timestamp: Date.now(),
        }
        console.log(`[Relay] New transfer queued: ${currentPendingTx.amountSol} SOL (≈ $${currentPendingTx.amountUsd || '?'}) to ${currentPendingTx.recipient}`)
        try {
          exec(`osascript -e 'display notification "Transfer of ${currentPendingTx.amountSol} SOL pending second device approval" with title "Haptix Vault Quorum" sound name "Glass"'`)
          exec(`open http://localhost:8081/vault.html`)
        } catch (e) {
          console.warn('[Relay] Notification dispatch failed:', e)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, txId: currentPendingTx.id }))
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // Second device checks for pending transfer: GET /pending-tx
  if (req.method === 'GET' && url.pathname === '/pending-tx') {
    if (currentPendingTx && currentPendingTx.status !== 'declined') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ pending: currentPendingTx }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ pending: null }))
    return
  }

  // Second device submits signature: POST /submit-signature
  if (req.method === 'POST' && url.pathname === '/submit-signature') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        if (!currentPendingTx) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No active transfer pending' }))
          return
        }
        currentPendingTx.signature = {
          signatureHex: data.signatureHex,
          authenticatorDataHex: data.authenticatorDataHex,
          clientDataJSONHex: data.clientDataJSONHex,
        }
        console.log(`[Relay] Received second device signature for tx ${currentPendingTx.id}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // Phone waits for signature: GET /tx-signature?id=...
  if (req.method === 'GET' && url.pathname === '/tx-signature') {
    const txId = url.searchParams.get('id')
    if (currentPendingTx && (!txId || currentPendingTx.id === txId)) {
      if (currentPendingTx.status === 'declined') {
        const declinedId = currentPendingTx.id
        currentPendingTx = null // consumed
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, declined: true, txId: declinedId, error: 'Transfer was declined on second device' }))
        return
      }
      if (currentPendingTx.signature) {
        const sig = currentPendingTx.signature
        currentPendingTx = null // consumed
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, signature: sig }))
        return
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, waiting: true }))
    return
  }

  // Second device or Phone declines or cancels transfer: POST /decline or /cancel
  if (req.method === 'POST' && (url.pathname === '/decline' || url.pathname === '/cancel')) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {}
        const txId = data.txId || url.searchParams.get('id')
        if (currentPendingTx && (!txId || currentPendingTx.id === txId)) {
          console.log(`[Relay] Transfer ${currentPendingTx.id} marked as DECLINED by user`)
          currentPendingTx.status = 'declined'
          // Retain declined status briefly so phone can read it on next poll, then cleanup
          setTimeout(() => {
            if (currentPendingTx?.status === 'declined') {
              currentPendingTx = null
            }
          }, 8000)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, status: 'declined' }))
      } catch {
        if (currentPendingTx) {
          currentPendingTx.status = 'declined'
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, status: 'declined' }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

const PORT = 8082
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Haptix Relay] Listening on http://localhost:${PORT}/vault.html and on local network.`)
})

// Also serve vault.html on port 8081 if free, ensuring origin 'http://localhost:8081' matches on-chain Devnet policy
const staticServer8081 = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/' || url.pathname === '/vault.html' || url.pathname === '/vault') {
    if (fs.existsSync(VAULT_HTML_PATH)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(fs.readFileSync(VAULT_HTML_PATH, 'utf-8'))
      return
    }
  }
  res.writeHead(404)
  res.end('Not found')
})

staticServer8081.listen(8081, '0.0.0.0', () => {
  console.log(`[Haptix Vault] Serving vault.html on http://localhost:8081/vault.html`)
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Haptix Vault] Port 8081 in use (e.g. Metro bundler). Relay active on :${PORT}.`)
  }
})
