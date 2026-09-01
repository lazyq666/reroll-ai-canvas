const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.T30_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  try {
    const context = await browser.newContext({viewport:{width:1280, height:800}});
    await context.addCookies([{name:'t30-role', value:'admin', url:baseUrl}]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('studio_theme', 'light');
    });
    await page.goto(`${baseUrl}/studio`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => (
      !document.documentElement.classList.contains('studio-route-booting')
      && document.querySelector('.stage iframe.active')
    ));
    const result = await page.evaluate(() => ({
      savedPage:localStorage.getItem('studio_active_page'),
      activeFrame:document.querySelector('.stage iframe.active')?.id,
      currentNavigation:document.querySelector('ic-nav-item[current]')?.dataset.page,
      canvasSource:document.getElementById('frame-canvas')?.getAttribute('src'),
    }));
    assert.equal(result.savedPage, null);
    assert.equal(result.activeFrame, 'frame-canvas');
    assert.equal(result.currentNavigation, 'canvas');
    assert.match(result.canvasSource, /^\/static\/canvas-list\.html(?:\?|$)/);
    assert.deepEqual(pageErrors, []);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
