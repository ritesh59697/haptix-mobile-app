const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

const VAULT_HTML_PATH = path.join(__dirname, '../public/vault.html')

// Multi-tenant: Map by ID and by walletPda so multiple users never collide
const pendingById = new Map()
const pendingByWallet = new Map()

// Periodic TTL cleanup (10 min expiration)
setInterval(() => {
  const now = Date.now()
  for (const [id, tx] of pendingById.entries()) {
    if (now - tx.timestamp > 10 * 60 * 1000) {
      pendingById.delete(id)
      if (tx.walletPda && pendingByWallet.get(tx.walletPda)?.id === id) {
        pendingByWallet.delete(tx.walletPda)
      }
    }
  }
}, 30000)

const server = http.createServer((req, res) => {
  // Full CORS headers for any web origin (Vercel, localhost, local IP)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

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

  // Health check
  if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/status' || url.pathname === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify({
      ok: true,
      service: 'Haptix Cloud Relay',
      activePending: pendingById.size,
      uptimeSec: Math.round(process.uptime()),
      timestamp: Date.now(),
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
        const txId = (data.id && typeof data.id === 'string') ? data.id : Math.random().toString(36).substring(2, 10)

        const tx = {
          id: txId,
          messageHex: data.messageHex,
          amountSol: Number(data.amountSol) || 0,
          amountUsd: data.amountUsd,
          feeSol: data.feeSol,
          recipient: data.recipient,
          walletPda: data.walletPda || '',
          walletName: data.walletName || 'Hardware Vault',
          spendThresholdSol: data.spendThresholdSol,
          timestamp: Date.now(),
          status: 'pending',
        }

        pendingById.set(txId, tx)
        if (tx.walletPda) {
          pendingByWallet.set(tx.walletPda, tx)
        }

        console.log(`[Relay] New transfer queued: ${tx.amountSol} SOL to ${tx.recipient} (wallet: ${tx.walletPda || 'any'}, id: ${txId})`)

        if (process.platform === 'darwin') {
          try {
            exec(`osascript -e 'display notification "Transfer of ${tx.amountSol} SOL pending second device approval" with title "Haptix Vault Quorum" sound name "Glass"'`)
          } catch {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, txId }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // Second device checks for pending transfer: GET /pending-tx?wallet=...&id=...
  if (req.method === 'GET' && url.pathname === '/pending-tx') {
    const wallet = url.searchParams.get('wallet')
    const id = url.searchParams.get('id')
    let targetTx

    if (id) {
      targetTx = pendingById.get(id)
    } else if (wallet) {
      targetTx = pendingByWallet.get(wallet)
    } else {
      let latest
      for (const tx of pendingById.values()) {
        if (tx.status !== 'declined' && (!latest || tx.timestamp > latest.timestamp)) {
          latest = tx
        }
      }
      targetTx = latest
    }

    if (targetTx && targetTx.status !== 'declined') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ pending: targetTx }))
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
        const txId = data.txId
        const wallet = data.walletPda
        let targetTx = (txId ? pendingById.get(txId) : undefined) || (wallet ? pendingByWallet.get(wallet) : undefined)

        if (!targetTx) {
          for (const tx of pendingById.values()) {
            if (!tx.signature && tx.status === 'pending') {
              targetTx = tx
              break
            }
          }
        }

        if (!targetTx) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No active transfer pending for this request' }))
          return
        }

        targetTx.signature = {
          signatureHex: data.signatureHex,
          authenticatorDataHex: data.authenticatorDataHex,
          clientDataJSONHex: data.clientDataJSONHex,
        }
        targetTx.status = 'signed'
        console.log(`[Relay] Received second device signature for tx ${targetTx.id} (wallet: ${targetTx.walletPda || 'any'})`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, txId: targetTx.id }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // Phone waits for signature: GET /tx-signature?id=...&wallet=...
  if (req.method === 'GET' && url.pathname === '/tx-signature') {
    const txId = url.searchParams.get('id')
    const wallet = url.searchParams.get('wallet')
    let targetTx = (txId ? pendingById.get(txId) : undefined) || (wallet ? pendingByWallet.get(wallet) : undefined)

    if (targetTx) {
      if (targetTx.status === 'declined') {
        const declinedId = targetTx.id
        pendingById.delete(declinedId)
        if (targetTx.walletPda) pendingByWallet.delete(targetTx.walletPda)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, declined: true, txId: declinedId, error: 'Transfer was declined on second device' }))
        return
      }
      if (targetTx.signature) {
        const sig = targetTx.signature
        pendingById.delete(targetTx.id)
        if (targetTx.walletPda) pendingByWallet.delete(targetTx.walletPda)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, signature: sig }))
        return
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, waiting: true }))
    return
  }

  // Decline or Cancel: POST /decline or /cancel
  if (req.method === 'POST' && (url.pathname === '/decline' || url.pathname === '/cancel')) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {}
        const txId = data.txId || url.searchParams.get('id')
        const wallet = data.walletPda || url.searchParams.get('wallet')
        let targetTx = (txId ? pendingById.get(txId) : undefined) || (wallet ? pendingByWallet.get(wallet) : undefined)

        if (targetTx) {
          console.log(`[Relay] Transfer ${targetTx.id} marked as DECLINED`)
          targetTx.status = 'declined'
          setTimeout(() => {
            if (targetTx) {
              pendingById.delete(targetTx.id)
              if (targetTx.walletPda) pendingByWallet.delete(targetTx.walletPda)
            }
          }, 10000)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, status: 'declined' }))
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, status: 'declined' }))
      }
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Endpoint not found' }))
})

// Cloud platforms (Render, Railway, Heroku, Fly) inject PORT via environment variables
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8082
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Haptix Cloud Relay] Listening on 0.0.0.0:${PORT}`)
})
