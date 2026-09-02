// Background Service Worker for Passkey Smart Wallet (Manifest V3)

const DEFAULT_ACCOUNT = '0xB01543453cF31052c769d79e9C755E3b035d796f';
const CHAIN_ID_HEX = '0x14a34'; // 84532 Base Sepolia

const pendingRequests = new Map();

// Initialize default storage
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['account', 'connectedOrigins']);
  await chrome.storage.local.set({
    account: data.account || DEFAULT_ACCOUNT,
    connectedOrigins: data.connectedOrigins || {},
    pendingQueue: []
  });
});

// Clear stale queue on service worker wakeup
chrome.storage.local.set({ pendingQueue: [] });

// Enable Side Panel on click
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RPC_REQUEST') {
    handleRpcRequest(message, sender).then(sendResponse).catch(err => {
      sendResponse({ error: { message: err.message || 'Internal RPC error' } });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'RESOLVE_REQUEST') {
    const { id, result } = message;
    if (pendingRequests.has(id)) {
      const { resolve } = pendingRequests.get(id);
      pendingRequests.delete(id);
      resolve({ result });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'REJECT_REQUEST') {
    const { id, error } = message;
    if (pendingRequests.has(id)) {
      const { reject } = pendingRequests.get(id);
      pendingRequests.delete(id);
      reject(new Error(error || 'User rejected the request'));
    }
    sendResponse({ ok: true });
    return true;
  }
});

async function handleRpcRequest(req, sender) {
  const { id, method, params, origin } = req;
  const store = await chrome.storage.local.get(['account', 'connectedOrigins']);
  const account = store.account || DEFAULT_ACCOUNT;
  const connected = store.connectedOrigins || {};

  if (method === 'eth_chainId') {
    return { result: CHAIN_ID_HEX };
  }

  if (method === 'net_version') {
    return { result: '84532' };
  }

  if (method === 'eth_accounts') {
    return { result: connected[origin] ? [account] : [] };
  }

  if (method === 'eth_requestAccounts') {
    if (connected[origin]) {
      return { result: [account] };
    }
    // Queue Connection Prompt
    return queuePopupApproval({
      id,
      type: 'CONNECT',
      origin,
      account,
      method,
      params
    });
  }

  if (method === 'eth_sendTransaction' || method === 'personal_sign' || method === 'eth_signTypedData_v4') {
    return queuePopupApproval({
      id,
      type: method === 'eth_sendTransaction' ? 'TRANSACTION' : 'SIGNATURE',
      origin,
      account,
      method,
      params
    });
  }

  // Fallback to Base Sepolia RPC for read calls (eth_call, eth_getBalance, etc.)
  try {
    const rpcRes = await fetch('https://sepolia.base.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const json = await rpcRes.json();
    return { result: json.result, error: json.error };
  } catch (e) {
    return { error: { message: e.message } };
  }
}

async function queuePopupApproval(reqData) {
  return new Promise(async (resolve, reject) => {
    pendingRequests.set(reqData.id, { resolve, reject });

    // Store in chrome.storage.local so popup can read it
    const data = await chrome.storage.local.get(['pendingQueue']);
    const queue = data.pendingQueue || [];
    queue.push(reqData);
    await chrome.storage.local.set({ pendingQueue: queue });

    // Open approval popup window
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL(`popup.html?requestId=${reqData.id}`),
        type: 'popup',
        width: 380,
        height: 620
      });
    } catch (e) {
      console.warn('Failed to spawn popup window:', e);
    }
  });
}
