const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('playwright');

const baseUrl = process.env.T30_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserName = process.env.ISSUE_211_BROWSER || 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!browserType) throw new Error(`Unsupported ISSUE_211_BROWSER: ${browserName}`);

(async () => {
  const launchOptions = { headless: true };
  if (browserName === 'chromium') launchOptions.executablePath = browserExecutable;
  const browser = await browserType.launch(launchOptions);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('studio_brand_entry_seen', '1');
    });
    await page.route('**/static/js/studio-entry-motion.js*', route => route.abort('blockedbyclient'));
    await page.goto(`${baseUrl}/studio?entry-early-skip=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const result = await page.evaluate(() => {
      const overlay = document.getElementById('studioEntryMotion');
      return {
        navigationType: performance.getEntriesByType('navigation')[0]?.type,
        earlySkip: document.documentElement.classList.contains('studio-entry-motion-skip'),
        overlayExists: Boolean(overlay),
        overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
      };
    });
    assert.deepEqual(result, {
      navigationType: 'navigate',
      earlySkip: true,
      overlayExists: true,
      overlayDisplay: 'none',
    });
    process.stdout.write(`${JSON.stringify({ ok: true, browser: browserName, result })}\n`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
