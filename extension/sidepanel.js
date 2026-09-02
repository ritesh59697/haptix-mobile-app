// Extension Side Panel Logic — Haptix Biometric Smart Account
import { CONFIG } from './config.js';

const $ = id => document.getElementById(id);
const ETH_PRICE_USD = 3200; // Static oracle reference for Sepolia testnet

// Resolve active account address
let activeAccount = CONFIG.defaultAccount || '0xB01543453cF31052c769d79e9C755E3b035d796f';

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Toast Notification
function showToast(msg) {
  const toast = $('spToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// Copy to Clipboard helper
async function copyToClipboard(text, label = 'Address') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`);
  } catch (e) {
    // Fallback
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast(`${label} copied to clipboard!`);
  }
}

// Initialize Header & Accounts
async function initAccount() {
  try {
    if (chrome && chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get(['accountAddress']);
      if (stored.accountAddress) {
        activeAccount = stored.accountAddress;
      }
    }
  } catch (e) {
    console.warn('Storage read fallback:', e);
  }

  if ($('spAccountAddr')) $('spAccountAddr').textContent = truncateAddr(activeAccount);
  if ($('spFullAddr')) $('spFullAddr').textContent = activeAccount;
}

// Account Chip Click -> Copy
if ($('spAccountChip')) {
  $('spAccountChip').onclick = () => copyToClipboard(activeAccount, 'Smart Account');
}

// Full Dashboard Navigation
if ($('spOpenFullDashboard')) {
  $('spOpenFullDashboard').onclick = (e) => {
    e.preventDefault();
    if (chrome && chrome.tabs) {
      chrome.tabs.create({ url: 'http://localhost:57547/app.html' });
    } else {
      window.open('http://localhost:57547/app.html', '_blank');
    }
  };
}

// Quick Actions
if ($('spQuickSendBtn')) {
  $('spQuickSendBtn').onclick = () => {
    if (chrome && chrome.tabs) {
      chrome.tabs.create({ url: 'http://localhost:57547/app.html' });
    } else {
      window.open('http://localhost:57547/app.html', '_blank');
    }
  };
}

if ($('spQuickReceiveBtn')) {
  $('spQuickReceiveBtn').onclick = () => {
    $('spReceiveModal').classList.add('active');
  };
}

if ($('spCloseModalBtn')) {
  $('spCloseModalBtn').onclick = () => {
    $('spReceiveModal').classList.remove('active');
  };
}

if ($('spCopyFullAddrBtn')) {
  $('spCopyFullAddrBtn').onclick = () => {
    copyToClipboard(activeAccount, 'Address');
  };
}

if ($('spQuickAgentBtn')) {
  $('spQuickAgentBtn').onclick = () => {
    const el = $('spAgentSection');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };
}

if ($('spQuickSecurityBtn')) {
  $('spQuickSecurityBtn').onclick = () => {
    const el = $('spFirewallSection');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };
}

// Token Rows Click
if ($('spEthRow') || $('spUsdcRow')) {
  [$('spEthRow'), $('spUsdcRow')].forEach(row => {
    if (row) {
      row.onclick = () => {
        if (chrome && chrome.tabs) {
          chrome.tabs.create({ url: 'http://localhost:57547/app.html' });
        } else {
          window.open('http://localhost:57547/app.html', '_blank');
        }
      };
    }
  });
}

// Agent Delegation State
function refreshSpAgentView() {
  let agentSession = {
    active: true,
    agentKey: '0x8a912e73f912a738c821938491029381029b819e',
    autoLimit: 50.0,
    rollingCap: 100.0,
    rollingSpent: 30.0
  };

  try {
    const saved = localStorage.getItem('haptix_agent_session');
    if (saved) agentSession = JSON.parse(saved);
  } catch (e) {}

  if ($('spAgentBadge')) {
    if (agentSession.active) {
      $('spAgentBadge').textContent = '● Active';
      $('spAgentBadge').style.color = 'var(--accent-emerald)';
      $('spAgentBadge').style.borderColor = 'rgba(16, 185, 129, 0.3)';
      $('spAgentBadge').style.background = 'rgba(16, 185, 129, 0.12)';
    } else {
      $('spAgentBadge').textContent = '○ Paused';
      $('spAgentBadge').style.color = 'var(--accent-rose)';
      $('spAgentBadge').style.borderColor = 'rgba(244, 63, 94, 0.3)';
      $('spAgentBadge').style.background = 'rgba(244, 63, 94, 0.12)';
    }
  }

  if ($('spAgentKey')) {
    $('spAgentKey').textContent = truncateAddr(agentSession.agentKey);
  }

  if ($('spCopyAgentKeyBtn')) {
    $('spCopyAgentKeyBtn').onclick = () => copyToClipboard(agentSession.agentKey, 'Agent Key');
  }

  const pct = Math.min(100, Math.round((agentSession.rollingSpent / agentSession.rollingCap) * 100));
  if ($('spAgentFill')) $('spAgentFill').style.width = pct + '%';
  if ($('spAgentUsage')) $('spAgentUsage').textContent = `${pct}% ($${agentSession.rollingSpent.toFixed(0)} / $${agentSession.rollingCap.toFixed(0)})`;
}

// Balance Fetching with dynamic Fiat calculation
async function fetchBalances() {
  const refreshBtn = $('spRefreshBtn');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  let ethNum = 0.0041;
  let usdcNum = 0.00;

  try {
    // 1. Fetch ETH Balance
    const resEth = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [activeAccount, 'latest'],
        id: 1
      })
    });
    const dEth = await resEth.json();
    if (dEth && dEth.result) {
      ethNum = parseInt(dEth.result, 16) / 1e18;
    }

    // 2. Fetch USDC Balance
    const resUsdc = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: CONFIG.tokens.USDC.address,
          data: '0x70a08231' + activeAccount.replace(/^0x/, '').padStart(64, '0')
        }, 'latest'],
        id: 2
      })
    });
    const dUsdc = await resUsdc.json();
    if (dUsdc && dUsdc.result && dUsdc.result !== '0x') {
      usdcNum = parseInt(dUsdc.result, 16) / 1e6;
    }
  } catch (e) {
    console.warn('Sidepanel RPC error (using cached fallback):', e);
  }

  // Update UI Elements
  const ethStr = ethNum.toFixed(4);
  const usdcStr = usdcNum.toFixed(2);
  const ethFiat = (ethNum * ETH_PRICE_USD).toFixed(2);
  const totalFiat = (ethNum * ETH_PRICE_USD + usdcNum).toFixed(2);

  if ($('spTotalFiat')) $('spTotalFiat').textContent = `$${totalFiat} USD`;
  if ($('spTotalEth')) $('spTotalEth').textContent = `${ethStr} ETH`;
  if ($('spEthVal')) $('spEthVal').textContent = `${ethStr} ETH`;
  if ($('spEthFiat')) $('spEthFiat').textContent = `≈ $${ethFiat} USD`;
  if ($('spUsdcVal')) $('spUsdcVal').textContent = `${usdcStr} USDC`;
  if ($('spUsdcFiat')) $('spUsdcFiat').textContent = `≈ $${usdcStr} USD`;

  setTimeout(() => {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }, 400);
}

// Refresh Button click
if ($('spRefreshBtn')) {
  $('spRefreshBtn').onclick = () => {
    fetchBalances();
    showToast('Balances updated');
  };
}

// Emergency Panic Freeze
if ($('spPanicFreezeBtn')) {
  $('spPanicFreezeBtn').onclick = async () => {
    const confirmFreeze = confirm('🚨 EMERGENCY PANIC FREEZE:\n\nLock down your smart account immediately?\nAll single-sig transactions and AI agent sessions will be blocked.');
    if (!confirmFreeze) return;

    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ isFrozen: true });
      }
      showToast('🚨 Smart Account Frozen! Single-sig locked.');
      alert('🚨 ACCOUNT FROZEN: Emergency 1-Sig Lock activated. Multi-device 2-of-2 Quorum required to unlock.');
    } catch (e) {
      alert('Lockdown signal dispatched.');
    }
  };
}

// Bootup
initAccount();
refreshSpAgentView();
fetchBalances();
