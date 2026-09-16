// Content Script: injects inpage.js and bridges messages between page & background worker

function injectScript() {
  try {
    const container = document.head || document.documentElement;
    const script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.src = chrome.runtime.getURL('inpage.js');
    script.onload = () => script.remove();
    container.insertBefore(script, container.firstChild);
  } catch (e) {
    console.error('Haptix: failed to inject inpage provider', e);
  }
}

injectScript();

// Forward messages from Inpage Provider to Extension Background Worker
window.addEventListener('message', async event => {
  if (event.source !== window || !event.data || event.data.target !== 'passkey-contentscript') return;

  const { id, method, params, origin } = event.data;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'RPC_REQUEST',
      id,
      method,
      params,
      origin: origin || window.location.origin
    });

    window.postMessage({
      target: 'passkey-inpage',
      id,
      result: response?.result,
      error: response?.error
    }, '*');
  } catch (err) {
    window.postMessage({
      target: 'passkey-inpage',
      id,
      error: { message: err.message || 'Extension communication error' }
    }, '*');
  }
});

// Forward push notifications from background service worker to inpage provider
chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'CHAIN_CHANGED') {
    window.postMessage({
      target: 'passkey-inpage-event',
      event: 'chainChanged',
      data: { chainId: msg.chainId }
    }, '*');
  } else if (msg?.type === 'ACCOUNTS_CHANGED') {
    window.postMessage({
      target: 'passkey-inpage-event',
      event: 'accountsChanged',
      data: { accounts: msg.accounts }
    }, '*');
  }
});
