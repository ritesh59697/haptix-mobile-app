// Inpage Provider injected into web pages (EIP-1193 & EIP-6963)
(() => {
  if (window.passkeyProviderInjected) return;
  window.passkeyProviderInjected = true;

  const PROVIDER_INFO = {
    uuid: 'a891d4e7-3850-4822-bca4-d1b988f572a1',
    name: 'Passkey Smart Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%230052FF"><rect width="24" height="24" rx="6" fill="%230052FF"/><circle cx="12" cy="12" r="8" fill="none" stroke="white" stroke-width="2.5"/><circle cx="12" cy="12" r="3" fill="white"/></svg>',
    rdns: 'io.passkey.wallet'
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
        try { l(...args); } catch (e) { console.error(e); }
      });
      return true;
    }
  }

  class PasskeyProvider extends EventEmitter {
    constructor() {
      super();
      this.isPasskey = true;
      this.isMetaMask = true; // Fallback for legacy dApps
      this.chainId = '0x14a34'; // 84532 Base Sepolia
      this.networkVersion = '84532';
      this.selectedAddress = null;
      this._pendingRequests = new Map();

      window.addEventListener('message', this._handleMessage.bind(this));
    }

    _handleMessage(event) {
      if (event.source !== window || !event.data || event.data.target !== 'passkey-inpage') return;
      const { id, result, error } = event.data;
      if (this._pendingRequests.has(id)) {
        const { resolve, reject } = this._pendingRequests.get(id);
        this._pendingRequests.delete(id);
        if (error) reject(new Error(error.message || 'Request failed'));
        else resolve(result);
      }
    }

    async request(args) {
      if (!args || typeof args !== 'object') {
        throw new Error('Invalid request arguments');
      }
      const { method, params } = args;

      // Handle standard synchronous or simple queries
      if (method === 'eth_chainId') return this.chainId;
      if (method === 'net_version') return this.networkVersion;
      if (method === 'eth_accounts') {
        return this.selectedAddress ? [this.selectedAddress] : [];
      }

      // Forward RPC to content script
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
  window.passkey = provider;

  try {
    if (!window.ethereum) {
      window.ethereum = provider;
    } else {
      // Store in providers array if multi-injected
      if (!window.ethereum.providers) {
        window.ethereum.providers = [window.ethereum];
      }
      window.ethereum.providers.push(provider);
      // Give precedence if explicitly set
      window.passkeyProvider = provider;
    }
  } catch (e) {
    window.passkey = provider;
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
  // Also re-announce after a short tick to win race conditions
  setTimeout(announce, 100);
  setTimeout(announce, 500);
})();
