const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5199/app.html');
  await page.waitForTimeout(1000); // Wait for data fetch
  // Click the Security tab
  await page.evaluate(() => {
    document.querySelectorAll('.nav-item')[5].click(); // tab-security
  });
  await page.waitForTimeout(500); // Wait for transition
  await page.screenshot({ path: '/Users/ritesh/.gemini/antigravity-ide/brain/0f6d7101-50f1-4cd4-9486-72d56c77ff34/guardian_security_tab.png' });
  await browser.close();
})();
