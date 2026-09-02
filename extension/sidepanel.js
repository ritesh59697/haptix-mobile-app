// Extension Side Panel Logic
import { CONFIG } from './config.js';

const $ = id => document.getElementById(id);
const accountAddr = CONFIG.defaultAccount;

$('spOpenFullDashboard').onclick = () => {
  chrome.tabs.create({ url: 'http://localhost:57547/app.html' });
};

function refreshSpAgentView() {
  const agentSession = JSON.parse(localStorage.getItem('haptix_agent_session') || JSON.stringify({
    active: true,
    agentKey: '0x8a912e73f912a738c821938491029381029b819e',
    autoLimit: 50.0,
    rollingCap: 100.0,
    rollingSpent: 30.0
  }));

  if ($('spAgentBadge')) {
    if (agentSession.active) {
      $('spAgentBadge').textContent = '● Active';
      $('spAgentBadge').style.color = 'var(--accent-emerald)';
    } else {
      $('spAgentBadge').textContent = '○ Revoked';
      $('spAgentBadge').style.color = 'var(--accent-rose)';
    }
    $('spAgentKey').textContent = agentSession.agentKey;
    const pct = Math.min(100, Math.round((agentSession.rollingSpent / agentSession.rollingCap) * 100));
    $('spAgentFill').style.width = pct + '%';
    $('spAgentUsage').textContent = `${pct}% ($${agentSession.rollingSpent.toFixed(0)} / $${agentSession.rollingCap.toFixed(0)})`;
  }
}
refreshSpAgentView();

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
      $('spEth').textContent = `${ethVal} ETH`;
      $('spTotalBal').textContent = `${ethVal} ETH`;
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
      $('spUsdc').textContent = `${usdcVal} USDC`;
    }
  } catch (e) {
    console.warn('Sidepanel balance error:', e);
  }
}

$('spPanicFreezeBtn').onclick = async () => {
  if (!confirm('🚨 EMERGENCY FREEZE: Lock down wallet immediately?')) return;
  await chrome.storage.local.set({ isFrozen: true });
  alert('🚨 Wallet Frozen! All single-sig transactions disabled.');
};

fetchBalances();
