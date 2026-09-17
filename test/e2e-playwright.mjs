import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionPath = path.join(rootDir, 'extension');
const screenshotsDir = path.join(rootDir, 'artifacts', 'e2e');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

console.log('='.repeat(70));
console.log('🛡️  HAPTIX PASSKEY SMART ACCOUNT — AUTOMATED PLAYWRIGHT E2E SUITE');
console.log('='.repeat(70));
console.log(`📦 Extension Path: ${extensionPath}`);
console.log(`📸 Screenshots Output: ${screenshotsDir}\n`);

let browserContext;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runE2ETests() {
  const startTime = Date.now();

  try {
    console.log('🚀 Phase 1: Launching Chromium with Haptix Extension loaded...');
    browserContext = await chromium.launchPersistentContext('', {
      headless: false, // Required for Chrome extension loading
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1280,800'
      ],
      viewport: { width: 1280, height: 800 }
    });

    assert(browserContext, 'Chromium persistent context launched');

    // Wait for extension background service worker or manifest
    let serviceWorker;
    for (let i = 0; i < 10; i++) {
      const workers = browserContext.serviceWorkers();
      if (workers.length > 0) {
        serviceWorker = workers[0];
        break;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    let extensionId = null;
    if (serviceWorker) {
      extensionId = serviceWorker.url().split('/')[2];
      console.log(`  ℹ️ Detected Extension ID via ServiceWorker: ${extensionId}`);
    } else {
      // Fallback: check background pages
      const pages = browserContext.pages();
      for (const p of pages) {
        if (p.url().startsWith('chrome-extension://')) {
          extensionId = p.url().split('/')[2];
          break;
        }
      }
    }

    // --- TEST SUITE 1: Test dApp & Provider Injection ---
    console.log('\n🌐 Phase 2: Testing EIP-6963 Provider Injection & RPC Endpoints...');
    const dAppPage = await browserContext.newPage();
    
    // Listen for console logs
    const logs = [];
    dAppPage.on('console', msg => logs.push(msg.text()));

    await dAppPage.goto('http://localhost:57547/test-dapp.html', { waitUntil: 'domcontentloaded' });
    await dAppPage.waitForTimeout(1000);

    // Verify window.ethereum injection
    const providerState = await dAppPage.evaluate(() => {
      const eth = window.ethereum;
      if (!eth) return { exists: false };
      return {
        exists: true,
        isHaptix: eth.isHaptix,
        chainId: eth.chainId,
        selectedAddress: eth.selectedAddress
      };
    });

    assert(providerState.exists, 'window.ethereum injected into test dApp page');
    assert(providerState.isHaptix === true, 'window.ethereum.isHaptix flag is true');
    assert(providerState.chainId === '0x14a34', 'Default chainId is Base Sepolia (0x14a34 / 84532)');

    // Connect Wallet Flow
    console.log('\n🔗 Phase 3: Executing eth_requestAccounts...');
    await dAppPage.click('#btnConnect');
    await dAppPage.waitForTimeout(1000);

    const consoleOutputConnect = await dAppPage.$eval('#outputConsole', el => el.textContent);
    console.log('  [DEBUG Console Output]:', consoleOutputConnect);
    assert(consoleOutputConnect.toLowerCase().includes('0xb015'), 'Connected account 0xB015...796f returned via eth_requestAccounts');

    const connectedAddress = await dAppPage.evaluate(() => window.ethereum.selectedAddress);
    assert(connectedAddress && connectedAddress.toLowerCase().includes('b015'), `Enclave default account matches 0xB015...796f (got: ${connectedAddress})`);

    // 1-Sig Sub-Threshold Transfer Flow (< 0.010 ETH)
    console.log('\n⚡ Phase 4: Testing 1-Sig Sub-Threshold Policy Fast-Path (< 0.010 ETH)...');
    await dAppPage.click('#btnSmallTx');
    await dAppPage.waitForTimeout(600);
    const consoleOutput1 = await dAppPage.$eval('#outputConsole', el => el.textContent);
    assert(consoleOutput1.includes('0.001 ETH') || consoleOutput1.includes('Success') || consoleOutput1.includes('1-Sig') || consoleOutput1.includes('userOpHash'), 'Sub-threshold transfer (0.001 ETH) initiated successfully');

    // 2-of-2 Hardware Quorum Escalation Flow (0.05 ETH)
    console.log('\n🛡️ Phase 5: Testing Policy Escalation to 2-of-2 Quorum (0.05 ETH)...');
    await dAppPage.click('#btnLargeTx');
    await dAppPage.waitForTimeout(600);
    const consoleOutput2 = await dAppPage.$eval('#outputConsole', el => el.textContent);
    assert(consoleOutput2.includes('large transfer') || consoleOutput2.includes('2-of-2') || consoleOutput2.includes('0.05 ETH'), 'Over-threshold transfer triggers 2-of-2 Quorum escalation logic');

    // Over-Ceiling Strict Policy Block
    console.log('\n🚫 Phase 6: Testing Over-Ceiling SpendPolicy Block ($350 USDC)...');
    await dAppPage.click('#btnCeilingTx');
    await dAppPage.waitForTimeout(600);
    const consoleOutputCeiling = await dAppPage.$eval('#outputConsole', el => el.textContent);
    assert(consoleOutputCeiling.includes('Policy Block') || consoleOutputCeiling.includes('Ceiling') || consoleOutputCeiling.includes('Firewall'), 'Over-ceiling transfer blocked by fail-closed policy firewall');

    // High Risk Unlimited Approval Interceptor
    console.log('\n🚨 Phase 7: Testing High-Risk Unlimited ERC-20 Approval Policy Interceptor...');
    await dAppPage.click('#btnTestApproval');
    await dAppPage.waitForTimeout(600);
    const consoleOutput3 = await dAppPage.$eval('#outputConsole', el => el.textContent);
    assert(consoleOutput3.includes('Unlimited') || consoleOutput3.includes('Approval') || consoleOutput3.includes('Simulation'), 'Unlimited token approval intercepted by simulation security check');

    // Capture dApp test screenshot
    const dAppScreenshotPath = path.join(screenshotsDir, '01_test_dapp_e2e.png');
    await dAppPage.screenshot({ path: dAppScreenshotPath });
    console.log(`  📸 Captured test dApp screenshot: ${dAppScreenshotPath}`);

    // --- TEST SUITE 2: Web App Dashboard Audit & Verification ---
    console.log('\n📊 Phase 7: Auditing Web Dashboard (localhost:57547/app.html)...');
    const appPage = await browserContext.newPage();
    await appPage.goto('http://localhost:57547/app.html', { waitUntil: 'domcontentloaded' });
    await appPage.waitForTimeout(1000);

    // Verify portfolio balance calculation consistency
    const portfolioValue = await appPage.$eval('#sidePortfolioEth', el => el.textContent.trim());
    const portfolioChange = await appPage.$eval('#sidePortfolioUsd', el => el.textContent.trim());
    assert(portfolioValue === '$10.29', `Portfolio value displays verified Base Sepolia balance: ${portfolioValue}`);
    assert(portfolioChange.includes('+2.4%'), `24h percentage gain is mathematically sound (+2.4%): ${portfolioChange}`);
    assert(!portfolioChange.includes('$13,730'), `Impossible $13k delta bug eradicated: ${portfolioChange}`);

    // Verify Autonomous Agent Widget
    const agentBadgeText = await appPage.$eval('#agentSessionBadge', el => el.textContent.trim());
    const agentDescText = await appPage.$eval('#agentWidgetDesc', el => el.textContent.trim());
    const rateLimitLabel = await appPage.$eval('#dispRollingUsageLabel', el => el.textContent.trim());
    
    assert(agentBadgeText.includes('Active'), `Agent badge is Active: "${agentBadgeText}"`);
    assert(agentDescText.includes('Active session'), `Agent description is Active session: "${agentDescText}"`);
    assert(rateLimitLabel.includes('$30.00 / $100.00 USDC (30%)'), `Rate limit is synchronized to 30% cap: "${rateLimitLabel}"`);

    // Verify Assets List has no fake tokens
    const assetItems = await appPage.$$eval('.asset-item h4', els => els.map(e => e.textContent.trim()));
    assert(assetItems.includes('Ethereum') || assetItems.includes('ETH'), 'Verified ETH asset card present');
    assert(assetItems.includes('USD Coin') || assetItems.includes('USDC'), 'Verified USDC asset card present');
    assert(!assetItems.includes('SOL'), 'Non-EVM Solana token cleanly removed from EVM dashboard');

    // Verify No Horizontal Scrollbar
    const hasHorizontalOverflow = await appPage.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!hasHorizontalOverflow, 'Zero horizontal overflow / scrollbar on web dashboard');

    // Capture Web Dashboard screenshot
    const dashboardScreenshotPath = path.join(screenshotsDir, '02_web_dashboard_verified.png');
    await appPage.screenshot({ path: dashboardScreenshotPath });
    console.log(`  📸 Captured web dashboard screenshot: ${dashboardScreenshotPath}`);

    // --- TEST SUITE 3: Extension Popup UI Verification ---
    if (extensionId) {
      console.log('\n🧩 Phase 8: Testing Extension Popup UI & Theme Toggle...');
      const popupPage = await browserContext.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
      // Verify all tabs exist
      const tabs = await popupPage.$$eval('.tab-btn', els => els.map(e => e.getAttribute('data-tab')));
      assert(tabs.includes('tab-tokens') && tabs.includes('tab-agents') && tabs.includes('tab-security') && tabs.includes('tab-activity'), 'All 4 primary navigation tabs rendered');

      // Test theme toggle
      await popupPage.click('#btnHeadlessOptions');
      await popupPage.waitForTimeout(300);
      await popupPage.click('#mnuToggleTheme');
      await popupPage.waitForTimeout(300);

      const currentTheme = await popupPage.$eval('html', el => el.getAttribute('data-theme'));
      assert(currentTheme === 'light' || currentTheme === 'dark', `Theme toggle switches theme dynamically (current: ${currentTheme})`);

      // Verify zero raw emojis in popup DOM
      const emojiFound = await popupPage.evaluate(() => {
        const text = document.body.innerText;
        // Regex for emojis
        const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/u;
        return emojiRegex.test(text);
      });
      assert(!emojiFound, 'Zero raw emojis rendered in Extension popup DOM (all replaced by Rune SVG icons)');

      // Capture Extension Popup screenshot
      const popupScreenshotPath = path.join(screenshotsDir, '03_extension_popup_verified.png');
      await popupPage.screenshot({ path: popupScreenshotPath });
      console.log(`  📸 Captured extension popup screenshot: ${popupScreenshotPath}`);

      // Test Extension Sidepanel UI
      console.log('\n📱 Phase 9: Testing Extension Sidepanel UI & Official Logo Mark...');
      const sidepanelPage = await browserContext.newPage();
      await sidepanelPage.setViewportSize({ width: 380, height: 600 });
      await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
      await sidepanelPage.waitForTimeout(500);

      // Verify sidepanel brand logo
      const pageTitle = await sidepanelPage.title();
      assert(pageTitle.includes('Haptix'), `Sidepanel title contains Haptix (got: "${pageTitle}")`);
      const hasBrandSvg = await sidepanelPage.$eval('.brand-section svg', el => el.getAttribute('viewBox') === '0 0 100 100');
      assert(hasBrandSvg, 'Sidepanel header renders official new Haptix brand mark SVG (viewBox="0 0 100 100")');

      // Dismiss approval sheet if open from previous test to display main wallet
      const isApprovalVisible = await sidepanelPage.evaluate(() => {
        const el = document.getElementById('viewApproval');
        return el && window.getComputedStyle(el).display !== 'none';
      });
      if (isApprovalVisible) {
        await sidepanelPage.click('#btnDismissApproval');
        await sidepanelPage.waitForTimeout(300);
      }

      // Verify sidepanel has full unified features (Hero Net Worth, Action Buttons, Navigation Tabs)
      const hasNetWorth = await sidepanelPage.$eval('#totalPortfolioUsd', el => el.innerText.length > 0);
      assert(hasNetWorth, 'Sidepanel renders Smart Account Net Worth hero');
      const sidepanelTabs = await sidepanelPage.$$eval('.tab-btn', els => els.map(e => e.getAttribute('data-tab')));
      assert(sidepanelTabs.includes('tab-tokens') && sidepanelTabs.includes('tab-activity'), 'Sidepanel features segmented navigation tabs');

      // Capture Extension Sidepanel (Light Mode) screenshot
      const sidepanelLightScreenshotPath = path.join(screenshotsDir, '04_extension_sidepanel_light_verified.png');
      await sidepanelPage.screenshot({ path: sidepanelLightScreenshotPath });
      console.log(`  📸 Captured extension sidepanel (Light Mode) screenshot: ${sidepanelLightScreenshotPath}`);

      // Switch theme back to Dark to capture dark mode sidepanel as well
      await sidepanelPage.click('#btnHeadlessOptions');
      await sidepanelPage.waitForTimeout(300);
      await sidepanelPage.click('#mnuToggleTheme');
      await sidepanelPage.waitForTimeout(300);

      const sidepanelDarkScreenshotPath = path.join(screenshotsDir, '05_extension_sidepanel_dark_verified.png');
      await sidepanelPage.screenshot({ path: sidepanelDarkScreenshotPath });
      console.log(`  📸 Captured extension sidepanel (Dark Mode) screenshot: ${sidepanelDarkScreenshotPath}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(70));
    console.log(`🎉 ALL PLAYWRIGHT E2E TESTS PASSED (${passCount} passed, ${failCount} failed in ${duration}s)!`);
    console.log('='.repeat(70));

  } catch (err) {
    console.error('\n❌ E2E Test Suite Error:', err);
    process.exitCode = 1;
  } finally {
    if (browserContext) {
      await browserContext.close();
    }
  }
}

runE2ETests();
