// Inpage Provider injected into web pages (EIP-1193 & EIP-6963 Standard Discovery)
(() => {
  if (window.haptixProviderInjected) return;
  window.haptixProviderInjected = true;
  window.passkeyProviderInjected = true;

  const HAPTIX_SVG_ICON = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36" fill="none"><defs><linearGradient id="hl" x1="0%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="%23EC4899"/><stop offset="40%" stop-color="%23D946EF"/><stop offset="100%" stop-color="%233B82F6"/></linearGradient><linearGradient id="hr" x1="50%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23C084FC"/><stop offset="60%" stop-color="%230052FF"/><stop offset="100%" stop-color="%2306B6D4"/></linearGradient></defs><path d="M4 9C4 5.69 6.69 3 10 3H11C12.1 3 13 3.9 13 5V13.2L17.2 15.6L13 17.8V31C13 32.1 12.1 33 11 33H10C6.69 33 4 30.31 4 27V9Z" fill="url(%23hl)"/><path d="M26 27C26 30.31 23.31 33 20 33H19C17.9 33 17 32.1 17 31V22.8L12.8 20.4L17 18.2V5C17 3.9 17.9 3 19 3H20C23.31 3 26 5.69 26 9V27Z" fill="url(%23hr)"/></svg>`;

  const PROVIDER_INFO = {
    uuid: 'd1b988f5-3850-4822-bca4-a891d4e772a1',
    name: 'Haptix',
    icon: HAPTIX_SVG_ICON,
    rdns: 'com.haptix.wallet'
  };

  class EventEmitter {
    constructor() {
      this._events = {};
    }
    on(event, listener) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(listener);
      return this;
    }
    removeListener(event, listener) {
      if (!this._events[event]) return this;
      this._events[event] = this._events[event].filter(l => l !== listener);
      return this;
    }
    emit(event, ...args) {
      if (!this._events[event]) return false;
      this._events[event].forEach(l => {
        try { l(...args); } catch (e) { console.error('Haptix listener error:', e); }
      });
      return true;
    }
  }

  class PasskeyProvider extends EventEmitter {
    constructor() {
      super();
      this.isHaptix = true;
      this.isPasskey = true;
      this.isMetaMask = true; // Fallback for legacy dApps detecting window.ethereum.isMetaMask
      this.chainId = '0x14a34'; // Default: 84532 Base Sepolia
      this.networkVersion = '84532';
      this.selectedAddress = null;
      this._pendingRequests = new Map();

      window.addEventListener('message', this._handleMessage.bind(this));
    }

    _handleMessage(event) {
      if (event.source !== window || !event.data) return;

      // Handle unsolicited events (chainChanged, accountsChanged)
      if (event.data.target === 'passkey-inpage-event') {
        const { event: evtName, data } = event.data;
        if (evtName === 'chainChanged' && data?.chainId) {
          const newChainId = data.chainId.startsWith('0x') ? data.chainId : '0x' + Number(data.chainId).toString(16);
          if (this.chainId !== newChainId) {
            this.chainId = newChainId;
            this.networkVersion = parseInt(newChainId, 16).toString();
            this.emit('chainChanged', this.chainId);
          }
        } else if (evtName === 'accountsChanged' && Array.isArray(data?.accounts)) {
          this.selectedAddress = data.accounts[0] || null;
          this.emit('accountsChanged', data.accounts);
        }
        return;
      }

      // Handle RPC responses
      if (event.data.target === 'passkey-inpage') {
        const { id, result, error } = event.data;
        if (this._pendingRequests.has(id)) {
          const { resolve, reject } = this._pendingRequests.get(id);
          this._pendingRequests.delete(id);
          if (error) reject(new Error(error.message || 'Haptix request failed'));
          else resolve(result);
        }
      }
    }

    async request(args) {
      if (!args || typeof args !== 'object') {
        throw new Error('Invalid request arguments');
      }
      const { method, params } = args;

      // Synchronous/cached responses
      if (method === 'eth_chainId') return this.chainId;
      if (method === 'net_version') return this.networkVersion;
      if (method === 'eth_accounts') {
        return this.selectedAddress ? [this.selectedAddress] : [];
      }

      // Forward RPC call through content script to background worker
      const id = 'req_' + Math.random().toString(36).slice(2) + Date.now();
      return new Promise((resolve, reject) => {
        this._pendingRequests.set(id, { resolve, reject });

        window.postMessage({
          target: 'passkey-contentscript',
          id,
          method,
          params: params || [],
          origin: window.location.origin
        }, '*');
      }).then(result => {
        if (method === 'eth_requestAccounts' && Array.isArray(result) && result.length > 0) {
          this.selectedAddress = result[0];
          this.emit('accountsChanged', [this.selectedAddress]);
          this.emit('connect', { chainId: this.chainId });
        } else if (method === 'wallet_switchEthereumChain') {
          if (params?.[0]?.chainId) {
            const targetChainId = params[0].chainId;
            this.chainId = targetChainId;
            this.networkVersion = parseInt(targetChainId, 16).toString();
            this.emit('chainChanged', this.chainId);
          }
        }
        return result;
      });
    }

    // Legacy method wrappers
    sendAsync(payload, callback) {
      this.request(payload)
        .then(result => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
        .catch(error => callback(error, null));
    }

    send(method, params) {
      if (typeof method === 'string') {
        return this.request({ method, params });
      }
      return this.request(method);
    }
  }

  const provider = new PasskeyProvider();
  window.haptix = provider;
  window.passkey = provider;

  try {
    if (!window.ethereum) {
      window.ethereum = provider;
    } else {
      if (!window.ethereum.providers) {
        window.ethereum.providers = [window.ethereum];
      }
      window.ethereum.providers.push(provider);
      window.haptixProvider = provider;
      window.passkeyProvider = provider;
    }
  } catch (e) {
    window.haptix = provider;
  }

  // EIP-6963 Announce Provider
  function announce() {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({
          info: PROVIDER_INFO,
          provider
        })
      })
    );
  }

  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  setTimeout(announce, 50);
  setTimeout(announce, 150);
  setTimeout(announce, 500);
})();
