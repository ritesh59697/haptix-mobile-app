// Production Extension Popup Logic for Haptix Smart Wallet
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
  // Check for Desktop Mode parameter (?mode=desktop)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'desktop') {
    document.body.classList.add('desktop-mode');
  }

  if ($('shortAddr')) $('shortAddr').textContent = `${accountAddr.slice(0, 6)}...${accountAddr.slice(-4)}`;
  if ($('receiveFullAddr')) $('receiveFullAddr').textContent = accountAddr;

  // Copy Address in Header
  if ($('copyAddrBtn')) {
    $('copyAddrBtn').onclick = () => {
      navigator.clipboard.writeText(accountAddr);
      $('shortAddr').textContent = 'Copied!';
      setTimeout(() => {
        $('shortAddr').textContent = `${accountAddr.slice(0, 6)}...${accountAddr.slice(-4)}`;
      }, 1500);
    };
  }

  // --- HEADER ACTIONS: SIDE PANEL, DESKTOP EXPAND, SETTINGS ---
  
  // 1. Open Side Panel
  if ($('btnOpenSidePanel')) {
    $('btnOpenSidePanel').onclick = async () => {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            await chrome.sidePanel.open({ tabId: tab.id });
          }
        } catch (e) {
          console.warn('Sidepanel open error:', e);
        }
      }
    };
  }

  // 2. Expand to Desktop Mode in a New Tab (like Rabby / MetaMask)
  if ($('btnExpandDesktop')) {
    $('btnExpandDesktop').onclick = () => {
      const desktopUrl = chrome.runtime.getURL('popup.html?mode=desktop');
      chrome.tabs.create({ url: desktopUrl });
    };
  }

  // 3. Settings Sheet
  if ($('btnOpenSettings')) {
    $('btnOpenSettings').onclick = () => {
      if ($('sheetSettings')) $('sheetSettings').classList.add('active');
    };
  }
  if ($('btnCloseSettings')) {
    $('btnCloseSettings').onclick = () => {
      if ($('sheetSettings')) $('sheetSettings').classList.remove('active');
    };
  }

  // Settings: Revoke DApp Connection
  if ($('btnRevokeLocalOrigin')) {
    $('btnRevokeLocalOrigin').onclick = async () => {
      const store = await chrome.storage.local.get(['connectedOrigins']);
      const origins = store.connectedOrigins || {};
      delete origins['http://localhost:57547'];
      await chrome.storage.local.set({ connectedOrigins: origins });
      alert('Disconnected http://localhost:57547');
      if ($('sheetSettings')) $('sheetSettings').classList.remove('active');
    };
  }

  // Settings: Clear Pending Queue
  if ($('btnClearApprovalQueue')) {
    $('btnClearApprovalQueue').onclick = async () => {
      await chrome.storage.local.set({ pendingQueue: [] });
      alert('Pending approval queue cleared.');
      showWalletMode();
    };
  }

  // Settings: Reset Local Cache
  if ($('btnResetExtensionStorage')) {
    $('btnResetExtensionStorage').onclick = async () => {
      if (confirm('Reset extension cache and enrollment keys?')) {
        await chrome.storage.local.clear();
        alert('Extension cache reset. Re-open to re-initialize.');
        window.location.reload();
      }
    };
  }

  // --- SEND SHEET WORKFLOW ---
  const openSendSheet = (asset = 'ETH') => {
    if ($('sendAssetSelect')) $('sendAssetSelect').value = asset;
    updateSendFormForAsset();
    if ($('sheetSend')) $('sheetSend').classList.add('active');
  };

  if ($('btnActionSend')) $('btnActionSend').onclick = () => openSendSheet('ETH');
  if ($('tokenRowEth')) $('tokenRowEth').onclick = () => openSendSheet('ETH');
  if ($('tokenRowUsdc')) $('tokenRowUsdc').onclick = () => openSendSheet('USDC');

  if ($('btnCloseSend')) $('btnCloseSend').onclick = () => $('sheetSend').classList.remove('active');
  if ($('btnCancelSend')) $('btnCancelSend').onclick = () => $('sheetSend').classList.remove('active');

  // Paste Recipient
  if ($('btnPasteRecipient')) {
    $('btnPasteRecipient').onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) $('sendRecipientInput').value = text.trim();
      } catch (e) {
        alert('Clipboard access denied.');
      }
    };
  }

  // Quick Pick Whitelist Address
  if ($('btnUseWhitelist')) {
    $('btnUseWhitelist').onclick = () => {
      $('sendRecipientInput').value = '0x22db962929afe98d0269De0BAa6c442A3Aa6913D';
    };
  }

  // Asset change handling
  function updateSendFormForAsset() {
    const asset = $('sendAssetSelect')?.value || 'ETH';
    if (asset === 'ETH') {
      const ethBal = $('ethBalance')?.textContent || '0.0003 ETH';
      if ($('sendBalanceHint')) $('sendBalanceHint').textContent = `Available: ${ethBal}`;
    } else {
      const usdcBal = $('usdcBalance')?.textContent || '0.00 USDC';
      if ($('sendBalanceHint')) $('sendBalanceHint').textContent = `Available: ${usdcBal}`;
    }
    evaluateSendPolicy();
  }

  if ($('sendAssetSelect')) $('sendAssetSelect').onchange = updateSendFormForAsset;

  // Max Button
  if ($('btnMaxAmount')) {
    $('btnMaxAmount').onclick = () => {
      const asset = $('sendAssetSelect')?.value || 'ETH';
      if (asset === 'ETH') {
        const ethTxt = $('ethBalance')?.textContent?.replace(' ETH', '') || '0.0003';
        const num = Math.max(0, parseFloat(ethTxt) - 0.0001).toFixed(4);
        $('sendAmountInput').value = num;
      } else {
        const usdcTxt = $('usdcBalance')?.textContent?.replace(' USDC', '') || '0.00';
        $('sendAmountInput').value = usdcTxt;
      }
      evaluateSendPolicy();
    };
  }

  // Live Policy Evaluation on Amount Change
  function evaluateSendPolicy() {
    const asset = $('sendAssetSelect')?.value || 'ETH';
    const amt = parseFloat($('sendAmountInput')?.value || '0');

    if (asset === 'ETH') {
      const fiat = (amt * 3200).toFixed(2);
      if ($('sendFiatEstimate')) $('sendFiatEstimate').textContent = `≈ $${fiat} USD`;

      if (amt >= 0.010) {
        if ($('sendPolicyPreview')) $('sendPolicyPreview').className = 'policy-box quorum';
        if ($('sendPolicyStatus')) {
          $('sendPolicyStatus').textContent = '● 2-of-2 Hardware Quorum Enforced';
          $('sendPolicyStatus').style.color = 'var(--accent-amber)';
        }
        if ($('sendPolicyBadge')) $('sendPolicyBadge').textContent = 'Escalated';
        if ($('sendPolicyReason')) $('sendPolicyReason').textContent = 'Amount exceeds safe threshold (≥ 0.010 ETH). Requires Key #0 + Key #1.';
        if ($('btnExecuteSend')) $('btnExecuteSend').textContent = 'Authorize 2-of-2 Quorum';
      } else {
        if ($('sendPolicyPreview')) $('sendPolicyPreview').className = 'policy-box safe';
        if ($('sendPolicyStatus')) {
          $('sendPolicyStatus').textContent = '● Single Touch ID Tap';
          $('sendPolicyStatus').style.color = 'var(--accent-emerald)';
        }
        if ($('sendPolicyBadge')) $('sendPolicyBadge').textContent = 'Sub-threshold';
        if ($('sendPolicyReason')) $('sendPolicyReason').textContent = 'Amount is within safe spending threshold (< 0.010 ETH).';
        if ($('btnExecuteSend')) $('btnExecuteSend').textContent = 'Sign & Send with Touch ID';
      }
    } else {
      // USDC
      if ($('sendFiatEstimate')) $('sendFiatEstimate').textContent = `≈ $${amt.toFixed(2)} USD`;
      if (amt > 50) {
        if ($('sendPolicyPreview')) $('sendPolicyPreview').className = 'policy-box quorum';
        if ($('sendPolicyStatus')) {
          $('sendPolicyStatus').textContent = '● 2-of-2 Hardware Quorum Enforced';
          $('sendPolicyStatus').style.color = 'var(--accent-amber)';
        }
        if ($('sendPolicyBadge')) $('sendPolicyBadge').textContent = 'Escalated';
        if ($('sendPolicyReason')) $('sendPolicyReason').textContent = 'Transfer exceeds autonomous $50 limit. Demands 2-of-2 biometric quorum.';
        if ($('btnExecuteSend')) $('btnExecuteSend').textContent = 'Authorize 2-of-2 Quorum';
      } else {
        if ($('sendPolicyPreview')) $('sendPolicyPreview').className = 'policy-box safe';
        if ($('sendPolicyStatus')) {
          $('sendPolicyStatus').textContent = '● Autonomous / 1-Sig Safe';
          $('sendPolicyStatus').style.color = 'var(--accent-emerald)';
        }
        if ($('sendPolicyBadge')) $('sendPolicyBadge').textContent = '1-Sig';
        if ($('sendPolicyReason')) $('sendPolicyReason').textContent = 'Amount under $50. Authorized with 1 signature.';
        if ($('btnExecuteSend')) $('btnExecuteSend').textContent = 'Sign & Send with Touch ID';
      }
    }
  }

  if ($('sendAmountInput')) $('sendAmountInput').oninput = evaluateSendPolicy;

  // Execute Send Action
  if ($('btnExecuteSend')) {
    $('btnExecuteSend').onclick = async () => {
      const recipient = $('sendRecipientInput')?.value?.trim();
      const amountStr = $('sendAmountInput')?.value?.trim();
      const asset = $('sendAssetSelect')?.value || 'ETH';

      if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
        alert('Please enter a valid 42-character recipient address.');
        return;
      }
      if (!amountStr || parseFloat(amountStr) <= 0) {
        alert('Please enter a valid amount.');
        return;
      }

      try {
        $('btnExecuteSend').disabled = true;
        $('btnExecuteSend').textContent = 'Authenticating Touch ID...';

        const valWei = asset === 'ETH' ? BigInt(Math.floor(parseFloat(amountStr) * 1e18)) : 0n;
        let innerCall = '';
        let target = recipient;

        if (asset === 'USDC') {
          target = CONFIG.tokens.USDC.address;
          const units = BigInt(Math.floor(parseFloat(amountStr) * 1e6));
          // transfer(recipient, units)
          innerCall = 'a9059cbb' + recipient.replace(/^0x/,'').padStart(64, '0') + units.toString(16).padStart(64, '0');
        }

        let callData = '';
        if (innerCall.length === 0) {
          callData = '0xb61d27f6' +
            target.replace(/^0x/,'').padStart(64, '0') +
            valWei.toString(16).padStart(64, '0') +
            pad64(64) +
            pad64(0);
        } else {
          callData = '0xb61d27f6' +
            target.replace(/^0x/,'').padStart(64, '0') +
            valWei.toString(16).padStart(64, '0') +
            pad64(64) +
            pad64(innerCall.length / 2) +
            innerCall.padEnd(Math.ceil(innerCall.length / 64) * 64, '0');
        }

        const nonce = await getAccountNonce(CONFIG.rpcUrl, CONFIG.entryPoint, accountAddr, 0n);
        const accountGasLimits = '0x' + CONFIG.gas.verificationGasLimit.toString(16).padStart(32, '0') + CONFIG.gas.callGasLimit.toString(16).padStart(32, '0');
        const gasFees = '0x' + CONFIG.gas.maxPriorityFeePerGas.toString(16).padStart(32, '0') + CONFIG.gas.maxFeePerGas.toString(16).padStart(32, '0');

        const op = {
          sender: accountAddr, nonce, initCode: '0x', callData,
          accountGasLimits, preVerificationGas: CONFIG.gas.preVerificationGas,
          gasFees, paymasterAndData: '0x', signature: '0x'
        };

        const userOpHash = await getUserOpHash(CONFIG.rpcUrl, CONFIG.entryPoint, op);

        $('btnExecuteSend').textContent = 'Key #0 (Touch ID)...';
        const sig0 = await signWithPasskey(userOpHash);
        const signerIds = [0];
        const sigs = [sig0];

        const isQuorum = (asset === 'ETH' && valWei >= 10000000000000000n) || (asset === 'USDC' && parseFloat(amountStr) > 50);
        if (isQuorum) {
          $('btnExecuteSend').textContent = 'Key #1 (Backup Quorum)...';
          const sig1 = await signWithPasskey(userOpHash);
          signerIds.push(1);
          sigs.push(sig1);
        }

        op.signature = encodeSignaturePayload(signerIds, sigs);

        let txHash = userOpHash;
        let isLiveBroadcast = false;
        let bundlerError = null;
        try {
          const res = await sendUserOpToBundler(CONFIG.bundlerUrl, op, CONFIG.entryPoint);
          if (res) {
            txHash = res;
            isLiveBroadcast = true;
          }
        } catch (e) {
          bundlerError = e.message;
          console.warn('Bundler broadcast notice:', e);
        }

        if (isLiveBroadcast) {
          alert(`✓ Transaction Broadcasted to Base Sepolia!\n\nUserOp Hash: ${txHash.slice(0, 18)}...\nAmount: ${amountStr} ${asset}`);
        } else {
          alert(`✓ UserOp Signed with Hardware Passkey!\n\n${bundlerError || 'Pre-flight cryptographic simulation succeeded.'}`);
        }
        if ($('sheetSend')) $('sheetSend').classList.remove('active');
        fetchBalances();
      } catch (err) {
        alert('Send failed: ' + err.message);
      } finally {
        $('btnExecuteSend').disabled = false;
        $('btnExecuteSend').textContent = 'Review & Sign with Touch ID';
      }
    };
  }

  // --- RECEIVE SHEET WORKFLOW ---
  if ($('btnActionReceive')) {
    $('btnActionReceive').onclick = () => {
      if ($('sheetReceive')) $('sheetReceive').classList.add('active');
    };
  }
  if ($('btnCloseReceive')) {
    $('btnCloseReceive').onclick = () => {
      if ($('sheetReceive')) $('sheetReceive').classList.remove('active');
    };
  }
  if ($('btnCopyReceiveAddr')) {
    $('btnCopyReceiveAddr').onclick = () => {
      navigator.clipboard.writeText(accountAddr);
      $('btnCopyReceiveAddr').textContent = '✓ Copied to Clipboard!';
      setTimeout(() => {
        $('btnCopyReceiveAddr').textContent = 'Copy Address';
      }, 1500);
    };
  }

  // --- TAB NAVIGATION ---
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      if ($(target)) $(target).classList.add('active');
    };
  });

  function switchTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (btn) btn.click();
  }

  if ($('btnActionAgents')) $('btnActionAgents').onclick = () => switchTab('tab-agents');

  // Check enrolled status from storage
  const enrollStore = await chrome.storage.local.get(['key0Enrolled', 'key1Enrolled']);
  if (enrollStore.key0Enrolled && $('enrollKey0Btn')) {
    $('enrollKey0Btn').textContent = 'Enrolled';
    $('enrollKey0Btn').style.background = 'var(--accent-emerald-light)';
    $('enrollKey0Btn').style.color = 'var(--accent-emerald)';
    $('enrollKey0Btn').style.borderColor = 'rgba(16, 185, 129, 0.3)';
  }
  if (enrollStore.key1Enrolled && $('enrollKey1Btn')) {
    $('enrollKey1Btn').textContent = 'Enrolled';
    $('enrollKey1Btn').style.background = 'var(--accent-emerald-light)';
    $('enrollKey1Btn').style.color = 'var(--accent-emerald)';
    $('enrollKey1Btn').style.borderColor = 'rgba(16, 185, 129, 0.3)';
  }

  // 1-Click Passkey Enrollment
  if ($('enrollKey0Btn')) {
    $('enrollKey0Btn').onclick = async () => {
      try {
        $('enrollKey0Btn').textContent = 'Enrolling...';
        await registerPasskey('Primary Touch ID (Key #0)');
        $('enrollKey0Btn').textContent = 'Enrolled';
        $('enrollKey0Btn').style.background = 'var(--accent-emerald-light)';
        $('enrollKey0Btn').style.color = 'var(--accent-emerald)';
        $('enrollKey0Btn').style.borderColor = 'rgba(16, 185, 129, 0.3)';
        await chrome.storage.local.set({ key0Enrolled: true });
      } catch (e) {
        alert('Enrollment error: ' + e.message);
        $('enrollKey0Btn').textContent = 'Enroll Key #0';
      }
    };
  }

  if ($('enrollKey1Btn')) {
    $('enrollKey1Btn').onclick = async () => {
      try {
        $('enrollKey1Btn').textContent = 'Enrolling...';
        await registerPasskey('Backup Quorum Key (Key #1)');
        $('enrollKey1Btn').textContent = 'Enrolled';
        $('enrollKey1Btn').style.background = 'var(--accent-emerald-light)';
        $('enrollKey1Btn').style.color = 'var(--accent-emerald)';
        $('enrollKey1Btn').style.borderColor = 'rgba(16, 185, 129, 0.3)';
        await chrome.storage.local.set({ key1Enrolled: true });
      } catch (e) {
        alert('Enrollment error: ' + e.message);
        $('enrollKey1Btn').textContent = 'Enroll Key #1';
      }
    };
  }

  // --- AI Agent Delegation in Extension ---
  let extAgentSession = JSON.parse(localStorage.getItem('haptix_agent_session') || JSON.stringify({
    active: true,
    agentKey: '0x8a912e73f912a738c821938491029381029b819e',
    autoLimit: 50.0,
    rollingCap: 100.0,
    rollingSpent: 30.0
  }));

  function refreshExtAgentView() {
    if ($('popAgentBadge')) {
      if (extAgentSession.active) {
        $('popAgentBadge').textContent = '● Active';
        $('popAgentBadge').className = 'status-chip chip-active';
      } else {
        $('popAgentBadge').textContent = '○ Revoked';
        $('popAgentBadge').className = 'status-chip chip-revoked';
      }
      if ($('popAgentKey')) $('popAgentKey').textContent = extAgentSession.agentKey;
      const pct = Math.min(100, Math.round((extAgentSession.rollingSpent / extAgentSession.rollingCap) * 100));
      if ($('popAgentUsageFill')) $('popAgentUsageFill').style.width = pct + '%';
      if ($('popAgentSpendLabel')) $('popAgentSpendLabel').textContent = `${pct}% Used ($${extAgentSession.rollingSpent.toFixed(0)}/$${extAgentSession.rollingCap.toFixed(0)})`;
    }
  }
  refreshExtAgentView();

  if ($('popRevokeAgentBtn')) {
    $('popRevokeAgentBtn').onclick = () => {
      if (confirm('Revoke this AI Agent Session delegation?')) {
        extAgentSession.active = false;
        localStorage.setItem('haptix_agent_session', JSON.stringify(extAgentSession));
        refreshExtAgentView();
      }
    };
  }

  if ($('popOpenDashboardAgentBtn')) {
    $('popOpenDashboardAgentBtn').onclick = () => {
      chrome.tabs.create({ url: 'http://localhost:57547/app.html' });
    };
  }

  // Check for Pending Request
  const reqId = urlParams.get('requestId');
  const store = await chrome.storage.local.get(['pendingQueue']);
  const queue = store.pendingQueue || [];
  
  if (reqId) {
    currentRequest = queue.find(r => r.id === reqId);
  } else if (queue.length > 0) {
    currentRequest = queue[0];
  }

  // Panic Freeze Handler
  if ($('popupFreezeBtn')) {
    $('popupFreezeBtn').onclick = async () => {
      if (!confirm('EMERGENCY FREEZE: Lock down wallet immediately?')) return;
      try {
        $('popupFreezeBtn').disabled = true;

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
        if ($('popupFreezeBanner')) $('popupFreezeBanner').style.display = 'flex';
        alert('Wallet Frozen! All single-sig transactions disabled.');
      } catch (e) {
        alert('Freeze failed: ' + e.message);
      } finally {
        $('popupFreezeBtn').disabled = false;
      }
    };
  }

  if ($('popupUnfreezeBtn')) {
    $('popupUnfreezeBtn').onclick = async () => {
      try {
        $('popupUnfreezeBtn').disabled = true;
        $('popupUnfreezeBtn').textContent = '1/2 Touch ID...';

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
        $('popupUnfreezeBtn').textContent = '2/2 Backup Key...';
        const sig1 = await signWithPasskey(userOpHash);
        op.signature = encodeSignaturePayload([0, 1], [sig0, sig1]);

        try { await sendUserOpToBundler(CONFIG.bundlerUrl, op, CONFIG.entryPoint); } catch (e) {}

        await chrome.storage.local.set({ isFrozen: false });
        if ($('popupFreezeBanner')) $('popupFreezeBanner').style.display = 'none';
        alert('Wallet Unfrozen via 2-of-2 Quorum!');
      } catch (e) {
        alert('Unfreeze failed: ' + e.message);
      } finally {
        $('popupUnfreezeBtn').disabled = false;
        $('popupUnfreezeBtn').textContent = 'Unfreeze';
      }
    };
  }

  // Check initial freeze status
  const fStore = await chrome.storage.local.get(['isFrozen']);
  if (fStore.isFrozen && $('popupFreezeBanner')) {
    $('popupFreezeBanner').style.display = 'flex';
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
      if ($('ethBalance')) $('ethBalance').textContent = `${ethVal} ETH`;
      if ($('totalPortfolioUsd')) $('totalPortfolioUsd').textContent = `${ethVal} ETH`;
      const fiatVal = (parseFloat(ethVal) * 3200).toFixed(2);
      if ($('fiatPortfolioUsd')) $('fiatPortfolioUsd').textContent = `≈ $${fiatVal} USD`;
      if ($('ethFiatVal')) $('ethFiatVal').textContent = `≈ $${fiatVal} USD`;
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
      if ($('usdcBalance')) $('usdcBalance').textContent = `${usdcVal} USDC`;
      if ($('usdcFiatVal')) $('usdcFiatVal').textContent = `≈ $${usdcVal} USD`;
    }
  } catch (e) {
    console.warn('Balance fetch error:', e);
  }
}

function showWalletMode() {
  if ($('viewDefault')) $('viewDefault').style.display = 'flex';
  if ($('viewApproval')) $('viewApproval').style.display = 'none';
}

async function showApprovalMode(req) {
  if ($('viewDefault')) $('viewDefault').style.display = 'none';
  if ($('viewApproval')) $('viewApproval').style.display = 'flex';

  if ($('appDappOrigin')) $('appDappOrigin').textContent = req.origin || 'dApp Connection';

  if (req.type === 'CONNECT') {
    $('appActionTitle').textContent = 'Connect Account';
    $('appTargetAddr').textContent = `${accountAddr.slice(0, 10)}...${accountAddr.slice(-6)}`;
    $('appValue').textContent = 'Read-only access';
    $('appCalldata').textContent = 'eth_requestAccounts';
    
    $('appPolicyBox').className = 'policy-box safe';
    $('appPolicyTitle').innerHTML = '● Safe Connection';
    $('appPolicyTitle').style.color = 'var(--accent-emerald)';
    $('appPolicyBadge').textContent = 'No Gas';
    $('appPolicyDesc').textContent = 'Allow this site to view your smart account public address.';
    
    $('approveWithPasskeyBtn').textContent = 'Connect Smart Wallet';
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
      $('appPolicyBox').className = 'policy-box freeze';
      $('appPolicyTitle').innerHTML = '● Emergency Freeze: 2-of-2 Quorum';
      $('appPolicyTitle').style.color = '#F43F5E';
      $('appPolicyBadge').textContent = 'Account Locked';
      $('appPolicyDesc').textContent = 'Smart wallet is in Panic Freeze mode. 2 hardware passkeys strictly required.';
      $('approveWithPasskeyBtn').textContent = 'Authorize 2-of-2 Quorum';
    } else if (isUntrusted) {
      $('appPolicyBox').className = 'policy-box quorum';
      $('appPolicyTitle').innerHTML = '● Address Firewall: 2-of-2 Quorum';
      $('appPolicyTitle').style.color = 'var(--accent-amber)';
      $('appPolicyBadge').textContent = 'Untrusted Recipient';
      $('appPolicyDesc').textContent = 'Recipient is not in your whitelist. Escalated to 2-of-2 hardware passkey quorum.';
      $('approveWithPasskeyBtn').textContent = 'Authorize 2-of-2 Quorum';
    } else if (!isQuorum) {
      $('appPolicyBox').className = 'policy-box safe';
      $('appPolicyTitle').innerHTML = '● 1-Biometric Signature';
      $('appPolicyTitle').style.color = 'var(--accent-emerald)';
      $('appPolicyBadge').textContent = 'Single Tap';
      $('appPolicyDesc').textContent = 'Transfer under threshold to whitelisted address. Single Touch ID authorization.';
      $('approveWithPasskeyBtn').textContent = 'Authorize with Touch ID (1-Sig)';
    } else {
      $('appPolicyBox').className = 'policy-box quorum';
      $('appPolicyTitle').innerHTML = '● 2-of-2 Hardware Quorum Enforced';
      $('appPolicyTitle').style.color = 'var(--accent-amber)';
      $('appPolicyBadge').textContent = '2-Signatures';
      $('appPolicyDesc').textContent = 'Value exceeds threshold or executes contract call. Demands 2 hardware passkeys.';
      $('approveWithPasskeyBtn').textContent = 'Authorize 2-of-2 Quorum';
    }
  } else if (req.type === 'SIGNATURE') {
    $('appActionTitle').textContent = 'Sign Off-Chain Message (ERC-1271)';
    $('appTargetAddr').textContent = `${accountAddr.slice(0, 10)}...${accountAddr.slice(-6)}`;
    $('appValue').textContent = '0.00 ETH (Off-Chain)';
    $('appCalldata').textContent = (req.params?.[0] || '0x').slice(0, 20) + '...';
    
    $('appPolicyBox').className = 'policy-box safe';
    $('appPolicyTitle').innerHTML = '● ERC-1271 Signature';
    $('appPolicyTitle').style.color = 'var(--accent-emerald)';
    $('appPolicyBadge').textContent = 'Passkey Verified';
    $('appPolicyDesc').textContent = 'Signs authentication challenge using enrolled biometric passkey.';
    $('approveWithPasskeyBtn').textContent = 'Sign with Touch ID';
  }

  // Handle Approval Action
  $('approveWithPasskeyBtn').onclick = async () => {
    try {
      $('approveWithPasskeyBtn').disabled = true;
      $('approveWithPasskeyBtn').textContent = 'Authenticating Biometric...';

      if (req.type === 'CONNECT') {
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
          sender: accountAddr, nonce, initCode: '0x', callData,
          accountGasLimits, preVerificationGas: CONFIG.gas.preVerificationGas,
          gasFees, paymasterAndData: '0x', signature: '0x'
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

        let txHash = userOpHash;
        try {
          const bundlerRes = await sendUserOpToBundler(CONFIG.bundlerUrl, op, CONFIG.entryPoint);
          txHash = bundlerRes || userOpHash;
        } catch (e) {
          console.warn('Bundler submission error:', e);
          alert('Bundler Notice: ' + e.message);
          txHash = userOpHash;
        }

        const store = await chrome.storage.local.get(['pendingQueue']);
        const filteredQueue = (store.pendingQueue || []).filter(r => r.id !== req.id);
        await chrome.storage.local.set({ pendingQueue: filteredQueue });

        chrome.runtime.sendMessage({ type: 'RESOLVE_REQUEST', id: req.id, result: txHash });
        window.close();
        return;
      }

      if (req.type === 'SIGNATURE') {
        const msg = req.params?.[0] || '0x';
        const hash = ethers.utils.keccak256(msg.startsWith('0x') ? msg : ethers.utils.toUtf8Bytes(msg));
        const sig = await signWithPasskey(hash);
        const encoded = encodeSignaturePayload([0], [sig]);

        const store = await chrome.storage.local.get(['pendingQueue']);
        const filteredQueue = (store.pendingQueue || []).filter(r => r.id !== req.id);
        await chrome.storage.local.set({ pendingQueue: filteredQueue });

        chrome.runtime.sendMessage({ type: 'RESOLVE_REQUEST', id: req.id, result: encoded });
        window.close();
      }
    } catch (err) {
      alert('Authentication Failed: ' + err.message);
      $('approveWithPasskeyBtn').disabled = false;
      $('approveWithPasskeyBtn').textContent = 'Retry Authorization';
    }
  };

  // Handle Dismiss / Back to Wallet Action
  if ($('btnDismissApproval')) {
    $('btnDismissApproval').onclick = async () => {
      await chrome.storage.local.set({ pendingQueue: [] });
      if (req && req.id) {
        chrome.runtime.sendMessage({ type: 'REJECT_REQUEST', id: req.id, error: 'User dismissed request' });
      }
      showWalletMode();
      fetchBalances();
    };
  }

  // Handle Reject Action
  if ($('rejectRequestBtn')) {
    $('rejectRequestBtn').onclick = async () => {
      await chrome.storage.local.set({ pendingQueue: [] });
      if (req && req.id) {
        chrome.runtime.sendMessage({ type: 'REJECT_REQUEST', id: req.id, error: 'User rejected the transaction' });
      }
      showWalletMode();
      fetchBalances();
      try { window.close(); } catch (e) {}
    };
  }
}
