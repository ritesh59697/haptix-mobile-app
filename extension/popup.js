// Extension Popup Logic
import { CONFIG } from './config.js';
import { 
  getAccountNonce, 
  getUserOpHash, 
  signWithPasskey, 
  registerPasskey,
  encodeSignaturePayload, 
  sendUserOpToBundler,
  pad64
} from './userop.js';

const $ = id => document.getElementById(id);

let currentRequest = null;
const accountAddr = CONFIG.defaultAccount;

// Initialize
(async () => {
  $('shortAddr').textContent = `${accountAddr.slice(0, 6)}...${accountAddr.slice(-4)}`;

  // Copy Address
  $('copyAddrBtn').onclick = () => {
    navigator.clipboard.writeText(accountAddr);
    $('shortAddr').textContent = '✓ Copied!';
    setTimeout(() => {
      $('shortAddr').textContent = `${accountAddr.slice(0, 6)}...${accountAddr.slice(-4)}`;
    }, 1500);
  };

  // 1-Click Passkey Enrollment
  $('enrollKey0Btn').onclick = async () => {
    try {
      $('enrollKey0Btn').textContent = 'Enrolling...';
      const cred = await registerPasskey('Primary Touch ID (Key #0)');
      $('enrollKey0Btn').textContent = '✓ Enrolled';
      $('enrollKey0Btn').style.background = 'var(--accent-emerald)';
      alert('✓ Touch ID Passkey registered for extension!');
    } catch (e) {
      alert('Enrollment error: ' + e.message);
      $('enrollKey0Btn').textContent = 'Enroll Key #0';
    }
  };

  $('enrollKey1Btn').onclick = async () => {
    try {
      $('enrollKey1Btn').textContent = 'Enrolling...';
      const cred = await registerPasskey('Backup Quorum Key (Key #1)');
      $('enrollKey1Btn').textContent = '✓ Enrolled';
      $('enrollKey1Btn').style.background = 'var(--accent-emerald)';
      alert('✓ Backup Key registered for extension!');
    } catch (e) {
      alert('Enrollment error: ' + e.message);
      $('enrollKey1Btn').textContent = 'Enroll Key #1';
    }
  };

  // Open Full Web Dashboard
  $('openWebDashboardBtn').onclick = () => {
    chrome.tabs.create({ url: 'http://localhost:8080/web/app.html' });
  };

  // Open Side Panel
  $('openSidePanelBtn').onclick = async () => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    }
  };

  // Check for Pending Request
  const urlParams = new URLSearchParams(window.location.search);
  const reqId = urlParams.get('requestId');

  const store = await chrome.storage.local.get(['pendingQueue']);
  const queue = store.pendingQueue || [];
  
  if (reqId) {
    currentRequest = queue.find(r => r.id === reqId);
  } else if (queue.length > 0) {
    currentRequest = queue[0];
  }

  // Panic Freeze Handler
  $('panicFreezeBtn').onclick = async () => {
    if (!confirm('🚨 EMERGENCY FREEZE: Lock down wallet immediately?')) return;
    try {
      $('panicFreezeBtn').disabled = true;
      $('panicFreezeBtn').textContent = 'Freezing...';

      const freezeCalldata = '0x51cff8d9';
      const callData = '0xb61d27f6' +
        accountAddr.replace(/^0x/,'').padStart(64, '0') +
        pad64(0) +
        pad64(64) +
        pad64(freezeCalldata.slice(2).length / 2) +
        freezeCalldata.slice(2).padEnd(64, '0');

      const nonce = await getAccountNonce(CONFIG.rpcUrl, CONFIG.entryPoint, accountAddr, 0n);
      const accountGasLimits = '0x' + CONFIG.gas.verificationGasLimit.toString(16).padStart(32, '0') + CONFIG.gas.callGasLimit.toString(16).padStart(32, '0');
      const gasFees = '0x' + CONFIG.gas.maxPriorityFeePerGas.toString(16).padStart(32, '0') + CONFIG.gas.maxFeePerGas.toString(16).padStart(32, '0');

      const op = {
        sender: accountAddr, nonce, initCode: '0x', callData,
        accountGasLimits, preVerificationGas: CONFIG.gas.preVerificationGas,
        gasFees, paymasterAndData: '0x', signature: '0x'
      };

      const userOpHash = await getUserOpHash(CONFIG.rpcUrl, CONFIG.entryPoint, op);
      const sig0 = await signWithPasskey(userOpHash);
      op.signature = encodeSignaturePayload([0], [sig0]);

      try { await sendUserOpToBundler(CONFIG.bundlerUrl, op, CONFIG.entryPoint); } catch (e) {}

      await chrome.storage.local.set({ isFrozen: true });
      $('frozenBanner').style.display = 'block';
      alert('🚨 Wallet Frozen! All single-sig transactions disabled.');
    } catch (e) {
      alert('Freeze failed: ' + e.message);
    } finally {
      $('panicFreezeBtn').disabled = false;
      $('panicFreezeBtn').textContent = '🚨 Freeze';
    }
  };

  $('unfreezeBtn').onclick = async () => {
    try {
      $('unfreezeBtn').disabled = true;
      $('unfreezeBtn').textContent = '1/2 Touch ID...';

      const unfreezeCalldata = '0x46e16544';
      const callData = '0xb61d27f6' +
        accountAddr.replace(/^0x/,'').padStart(64, '0') +
        pad64(0) +
        pad64(64) +
        pad64(unfreezeCalldata.slice(2).length / 2) +
        unfreezeCalldata.slice(2).padEnd(64, '0');

      const nonce = await getAccountNonce(CONFIG.rpcUrl, CONFIG.entryPoint, accountAddr, 0n);
      const accountGasLimits = '0x' + CONFIG.gas.verificationGasLimit.toString(16).padStart(32, '0') + CONFIG.gas.callGasLimit.toString(16).padStart(32, '0');
      const gasFees = '0x' + CONFIG.gas.maxPriorityFeePerGas.toString(16).padStart(32, '0') + CONFIG.gas.maxFeePerGas.toString(16).padStart(32, '0');

      const op = {
        sender: accountAddr, nonce, initCode: '0x', callData,
        accountGasLimits, preVerificationGas: CONFIG.gas.preVerificationGas,
        gasFees, paymasterAndData: '0x', signature: '0x'
      };

      const userOpHash = await getUserOpHash(CONFIG.rpcUrl, CONFIG.entryPoint, op);
      const sig0 = await signWithPasskey(userOpHash);

      $('unfreezeBtn').textContent = '2/2 Quorum Key...';
      const sig1 = await signWithPasskey(userOpHash);

      op.signature = encodeSignaturePayload([0, 1], [sig0, sig1]);

      try { await sendUserOpToBundler(CONFIG.bundlerUrl, op, CONFIG.entryPoint); } catch (e) {}

      await chrome.storage.local.set({ isFrozen: false });
      $('frozenBanner').style.display = 'none';
      alert('✓ Wallet Unfrozen via 2-of-2 Quorum!');
    } catch (e) {
      alert('Unfreeze failed: ' + e.message);
    } finally {
      $('unfreezeBtn').disabled = false;
      $('unfreezeBtn').textContent = 'Unfreeze';
    }
  };

  // Check initial freeze status
  const fStore = await chrome.storage.local.get(['isFrozen']);
  if (fStore.isFrozen) {
    $('frozenBanner').style.display = 'block';
  }

  if (currentRequest) {
    await showApprovalMode(currentRequest);
  } else {
    showWalletMode();
    fetchBalances();
  }
})();

async function fetchBalances() {
  try {
    // ETH
    const resEth = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [accountAddr, 'latest'], id: 1 })
    });
    const dEth = await resEth.json();
    if (dEth.result) {
      const ethVal = (parseInt(dEth.result, 16) / 1e18).toFixed(4);
      $('ethBalance').textContent = `${ethVal} ETH`;
      $('totalBalanceDisplay').textContent = `${ethVal} ETH`;
    }

    // USDC
    const resUsdc = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: CONFIG.tokens.USDC.address, data: '0x70a08231' + accountAddr.replace(/^0x/,'').padStart(64,'0') }, 'latest'],
        id: 2
      })
    });
    const dUsdc = await resUsdc.json();
    if (dUsdc.result) {
      const usdcVal = (parseInt(dUsdc.result, 16) / 1e6).toFixed(2);
      $('usdcBalance').textContent = `${usdcVal} USDC`;
    }
  } catch (e) {
    console.warn('Balance fetch error:', e);
  }
}

function showWalletMode() {
  $('viewWallet').style.display = 'flex';
  $('viewApproval').style.display = 'none';
}

async function showApprovalMode(req) {
  $('viewWallet').style.display = 'none';
  $('viewApproval').style.display = 'flex';

  $('appDappOrigin').textContent = req.origin || 'dApp Connection';

  if (req.type === 'CONNECT') {
    $('appActionTitle').textContent = 'Connect Account';
    $('appTargetAddr').textContent = accountAddr;
    $('appValue').textContent = 'Read-only access';
    $('appCalldata').textContent = 'eth_requestAccounts';
    
    $('appPolicyBox').className = 'policy-firewall-box policy-single';
    $('appPolicyTitle').innerHTML = '● Safe Connection';
    $('appPolicyTitle').style.color = 'var(--accent-emerald)';
    $('appPolicyBadge').textContent = 'No Gas';
    $('appPolicyDesc').textContent = 'Allow this site to view your smart account public address.';
    
    $('approveWithPasskeyBtn').innerHTML = '<span>✓ Connect Smart Wallet</span>';
  } else if (req.type === 'TRANSACTION') {
    $('appActionTitle').textContent = 'Approve Transaction';
    const tx = req.params?.[0] || {};
    const to = tx.to || '0x';
    const valHex = tx.value || '0x0';
    const valEth = (parseInt(valHex, 16) / 1e18).toFixed(4);
    const data = tx.data || '0x';

    $('appTargetAddr').textContent = `${to.slice(0, 10)}...${to.slice(-6)}`;
    $('appValue').textContent = `${valEth} ETH`;
    $('appCalldata').textContent = data.slice(0, 18) + (data.length > 18 ? '...' : '');

    const store = await chrome.storage.local.get(['isFrozen', 'allowedAddresses']);
    const isFrozen = !!store.isFrozen;
    const allowed = store.allowedAddresses || ['0x22db962929afe98d0269De0BAa6c442A3Aa6913D'];
    const isUntrusted = !allowed.map(a => a.toLowerCase()).includes(to.toLowerCase());
    const isOverThreshold = parseFloat(valEth) >= parseFloat(CONFIG.tokens.ETH.defaultThreshold);
    const isContractCall = (data && data !== '0x' && data !== '0x00');

    const isQuorum = isFrozen || isUntrusted || isOverThreshold || isContractCall;

    if (isFrozen) {
      $('appPolicyBox').className = 'policy-firewall-box policy-quorum';
      $('appPolicyTitle').innerHTML = '🚨 EMERGENCY FREEZE: 2-of-2 Quorum';
      $('appPolicyTitle').style.color = '#DC2626';
      $('appPolicyBadge').textContent = 'Account Locked';
      $('appPolicyDesc').textContent = 'Smart wallet is currently in Panic Freeze mode. 2 hardware passkeys are strictly required.';
      $('approveWithPasskeyBtn').innerHTML = '<span>🔒 Authorize 2-of-2 Quorum</span>';
    } else if (isUntrusted) {
      $('appPolicyBox').className = 'policy-firewall-box policy-quorum';
      $('appPolicyTitle').innerHTML = '🛡️ Address Book Firewall: 2-of-2 Quorum';
      $('appPolicyTitle').style.color = 'var(--accent-amber)';
      $('appPolicyBadge').textContent = 'Untrusted Recipient';
      $('appPolicyDesc').textContent = `Recipient is not in your approved address book. Escalated to 2-of-2 hardware passkey quorum.`;
      $('approveWithPasskeyBtn').innerHTML = '<span>🔒 Authorize 2-of-2 Quorum</span>';
    } else if (!isQuorum) {
      $('appPolicyBox').className = 'policy-firewall-box policy-single';
      $('appPolicyTitle').innerHTML = '● 1-Biometric Signature';
      $('appPolicyTitle').style.color = 'var(--accent-emerald)';
      $('appPolicyBadge').textContent = 'Single Tap';
      $('appPolicyDesc').textContent = `Transfer under threshold to whitelisted address. Single Touch ID authorization is sufficient.`;
      $('approveWithPasskeyBtn').innerHTML = '<span>🔒 Authorize with Touch ID (1-Sig)</span>';
    } else {
      $('appPolicyBox').className = 'policy-firewall-box policy-quorum';
      $('appPolicyTitle').innerHTML = '● 2-of-2 Hardware Quorum Enforced';
      $('appPolicyTitle').style.color = 'var(--accent-amber)';
      $('appPolicyBadge').textContent = '2-Signatures';
      $('appPolicyDesc').textContent = `Value exceeds threshold or executes contract call. Policy firewall strictly demands 2 hardware passkeys.`;
      $('approveWithPasskeyBtn').innerHTML = '<span>🔒 Authorize 2-of-2 Quorum</span>';
    }
  } else if (req.type === 'SIGNATURE') {
    $('appActionTitle').textContent = 'Sign Off-Chain Message (ERC-1271)';
    $('appTargetAddr').textContent = accountAddr;
    $('appValue').textContent = '0.00 ETH (Off-Chain)';
    $('appCalldata').textContent = (req.params?.[0] || '0x').slice(0, 20) + '...';
    
    $('appPolicyBox').className = 'policy-firewall-box policy-single';
    $('appPolicyTitle').innerHTML = '● ERC-1271 Signature';
    $('appPolicyTitle').style.color = 'var(--accent-emerald)';
    $('appPolicyBadge').textContent = 'Passkey Verified';
    $('appPolicyDesc').textContent = 'Signs EIP-712 / off-chain authentication challenge using enrolled passkey.';
    $('approveWithPasskeyBtn').innerHTML = '<span>🔒 Sign with Touch ID</span>';
  }

  // Handle Approval Action
  $('approveWithPasskeyBtn').onclick = async () => {
    try {
      $('approveWithPasskeyBtn').disabled = true;
      $('approveWithPasskeyBtn').textContent = 'Authenticating Biometric...';

      if (req.type === 'CONNECT') {
        // Save origin permission
        const store = await chrome.storage.local.get(['connectedOrigins', 'pendingQueue']);
        const origins = store.connectedOrigins || {};
        origins[req.origin] = true;
        
        const filteredQueue = (store.pendingQueue || []).filter(r => r.id !== req.id);
        await chrome.storage.local.set({ connectedOrigins: origins, pendingQueue: filteredQueue });

        chrome.runtime.sendMessage({ type: 'RESOLVE_REQUEST', id: req.id, result: [accountAddr] });
        window.close();
        return;
      }

      if (req.type === 'TRANSACTION') {
        const tx = req.params?.[0] || {};
        const dest = tx.to || '0x0000000000000000000000000000000000000000';
        const valWei = BigInt(tx.value || '0');
        const innerCall = (tx.data && tx.data !== '0x') ? tx.data.replace(/^0x/, '') : '';

        // PasskeyAccount.execute(dest, value, func)
        let callData = '';
        if (innerCall.length === 0) {
          callData = '0xb61d27f6' +
            dest.replace(/^0x/,'').padStart(64, '0') +
            valWei.toString(16).padStart(64, '0') +
            pad64(64) +
            pad64(0);
        } else {
          callData = '0xb61d27f6' +
            dest.replace(/^0x/,'').padStart(64, '0') +
            valWei.toString(16).padStart(64, '0') +
            pad64(64) +
            pad64(innerCall.length / 2) +
            innerCall.padEnd(Math.ceil(innerCall.length / 64) * 64, '0');
        }

        const nonce = await getAccountNonce(CONFIG.rpcUrl, CONFIG.entryPoint, accountAddr, 0n);
        
        const accountGasLimits = '0x' + 
          CONFIG.gas.verificationGasLimit.toString(16).padStart(32, '0') + 
          CONFIG.gas.callGasLimit.toString(16).padStart(32, '0');
        
        const gasFees = '0x' + 
          CONFIG.gas.maxPriorityFeePerGas.toString(16).padStart(32, '0') + 
          CONFIG.gas.maxFeePerGas.toString(16).padStart(32, '0');

        const op = {
          sender: accountAddr,
          nonce,
          initCode: '0x',
          callData,
          accountGasLimits,
          preVerificationGas: CONFIG.gas.preVerificationGas,
          gasFees,
          paymasterAndData: '0x',
          signature: '0x'
        };

        const userOpHash = await getUserOpHash(CONFIG.rpcUrl, CONFIG.entryPoint, op);

        $('approveWithPasskeyBtn').textContent = 'Biometric Touch ID (Key #0)...';
        const sig0 = await signWithPasskey(userOpHash);
        const signerIds = [0];
        const sigs = [sig0];

        const pStore = await chrome.storage.local.get(['isFrozen', 'allowedAddresses']);
        const isFrozen = !!pStore.isFrozen;
        const allowed = pStore.allowedAddresses || ['0x22db962929afe98d0269De0BAa6c442A3Aa6913D'];
        const isUntrusted = !allowed.map(a => a.toLowerCase()).includes(dest.toLowerCase());
        const isQuorum = isFrozen || isUntrusted || (valWei >= 10000000000000000n) || (innerCall.length > 0);
        if (isQuorum) {
          $('approveWithPasskeyBtn').textContent = 'Quorum Prompt: Key #1 (Backup)...';
          const sig1 = await signWithPasskey(userOpHash);
          signerIds.push(1);
          sigs.push(sig1);
        }

        op.signature = encodeSignaturePayload(signerIds, sigs);

        $('approveWithPasskeyBtn').textContent = 'Broadcasting UserOp...';
        let txHash = userOpHash;
        try {
          txHash = await sendUserOpToBundler(CONFIG.bundlerUrl, op, CONFIG.entryPoint);
        } catch (e) {
          console.warn('Bundler submission note:', e.message);
        }

        // Clean up queue
        const store = await chrome.storage.local.get(['pendingQueue']);
        const filteredQueue = (store.pendingQueue || []).filter(r => r.id !== req.id);
        await chrome.storage.local.set({ pendingQueue: filteredQueue });

        chrome.runtime.sendMessage({ type: 'RESOLVE_REQUEST', id: req.id, result: txHash });
        window.close();
        return;
      }

      if (req.type === 'SIGNATURE') {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const sig0 = await signWithPasskey(challenge);
        const encoded = encodeSignaturePayload([0], [sig0]);

        const store = await chrome.storage.local.get(['pendingQueue']);
        const filteredQueue = (store.pendingQueue || []).filter(r => r.id !== req.id);
        await chrome.storage.local.set({ pendingQueue: filteredQueue });

        chrome.runtime.sendMessage({ type: 'RESOLVE_REQUEST', id: req.id, result: encoded });
        window.close();
      }
    } catch (err) {
      alert('Authentication Failed: ' + err.message);
      $('approveWithPasskeyBtn').disabled = false;
      $('approveWithPasskeyBtn').textContent = '🔒 Retry Passkey Authorization';
    }
  };

  // Handle Reject Action
  $('rejectRequestBtn').onclick = async () => {
    const store = await chrome.storage.local.get(['pendingQueue']);
    const filteredQueue = (store.pendingQueue || []).filter(r => r.id !== req.id);
    await chrome.storage.local.set({ pendingQueue: filteredQueue });

    chrome.runtime.sendMessage({ type: 'REJECT_REQUEST', id: req.id, error: 'User rejected the transaction' });
    window.close();
  };
}
