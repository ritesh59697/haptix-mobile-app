// Background Service Worker for Haptix Multi-Chain Smart Wallet (Manifest V3)
import { NETWORKS, getNetwork, DEFAULT_CHAIN_ID } from './config.js';

const DEFAULT_ACCOUNT = '0xB01543453cF31052c769d79e9C755E3b035d796f';

const pendingRequests = new Map();

// Initialize default storage
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['account', 'connectedOrigins', 'activeChainId']);
  await chrome.storage.local.set({
    account: data.account || DEFAULT_ACCOUNT,
    connectedOrigins: data.connectedOrigins || {},
    activeChainId: data.activeChainId || DEFAULT_CHAIN_ID,
    pendingQueue: []
  });
});

// Clear stale queue on service worker wakeup
chrome.storage.local.set({ pendingQueue: [] });

// Enable Side Panel on click if supported
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

  if (message.type === 'SWITCH_NETWORK') {
    const { chainId } = message;
    switchNetworkInternal(chainId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
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

async function switchNetworkInternal(targetChainId) {
  const network = getNetwork(targetChainId);
  await chrome.storage.local.set({ activeChainId: network.chainId });
  broadcastEventToTabs('CHAIN_CHANGED', { chainId: network.chainIdHex });
  return { ok: true, network };
}

function broadcastEventToTabs(type, payload) {
  try {
    chrome.tabs.query({}, tabs => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type, ...payload }).catch(() => {});
        }
      }
    });
  } catch (e) {
    console.warn('Failed to broadcast event to tabs:', e);
  }
}

async function handleRpcRequest(req, sender) {
  const { id, method, params, origin } = req;
  const store = await chrome.storage.local.get(['account', 'connectedOrigins', 'activeChainId']);
  const account = store.account || DEFAULT_ACCOUNT;
  const connected = store.connectedOrigins || {};
  const activeChainId = store.activeChainId || DEFAULT_CHAIN_ID;
  const network = getNetwork(activeChainId);

  if (method === 'eth_chainId') {
    return { result: network.chainIdHex };
  }

  if (method === 'net_version') {
    return { result: network.chainId.toString() };
  }

  if (method === 'wallet_switchEthereumChain') {
    const targetChainHex = params?.[0]?.chainId;
    if (!targetChainHex) {
      return { error: { code: -32602, message: 'Invalid params: chainId required' } };
    }
    const targetId = parseInt(targetChainHex, 16);
    if (!NETWORKS[targetId]) {
      return { 
        error: { 
          code: 4902, 
          message: `Unrecognized chain ID: ${targetChainHex}. Supported chains: Base, Arbitrum, Optimism.` 
        } 
      };
    }
    await switchNetworkInternal(targetId);
    return { result: null };
  }

  if (method === 'wallet_addEthereumChain') {
    const chainParam = params?.[0];
    if (chainParam?.chainId) {
      const targetId = parseInt(chainParam.chainId, 16);
      if (NETWORKS[targetId]) {
        await switchNetworkInternal(targetId);
        return { result: null };
      }
    }
    return { result: null };
  }

  if (method === 'eth_accounts') {
    return { result: connected[origin] ? [account] : [] };
  }

  if (method === 'eth_requestAccounts') {
    if (connected[origin]) {
      return { result: [account] };
    }
    // Queue Connection Prompt in popup
    return queuePopupApproval({
      id,
      type: 'CONNECT',
      origin,
      account,
      method,
      params,
      network
    });
  }

  if (method === 'eth_sendTransaction' || method === 'personal_sign' || method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
    return queuePopupApproval({
      id,
      type: method === 'eth_sendTransaction' ? 'TRANSACTION' : 'SIGNATURE',
      origin,
      account,
      method,
      params,
      network
    });
  }

  // Dynamic forward to active chain RPC for read queries (eth_call, eth_getBalance, eth_blockNumber, etc.)
  try {
    const rpcRes = await fetch(network.rpcUrl, {
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
