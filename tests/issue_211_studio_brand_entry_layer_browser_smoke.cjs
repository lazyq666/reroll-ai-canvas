const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.T30_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('studio_theme', 'dark');
    });
    await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // The mark is one traced vector path redrawn every frame; there is no
    // video surface and no static logo underneath it.
    await page.waitForFunction(() => (document.getElementById('studioEntryMarkPath')?.getAttribute('d') || '').length > 0, null, { timeout: 5000 });
    const layers = await page.evaluate(async () => {
      const root = document.getElementById('studioEntryMotion');
      const path = document.getElementById('studioEntryMarkPath');
      const frame = document.querySelector('.studio-entry-mark-frame');
      const first = path.getAttribute('d');
      await new Promise(resolve => setTimeout(resolve, 200));
      return {
        state: root?.dataset.entryState,
        animating: path.getAttribute('d') !== first,
        frameBackground: getComputedStyle(frame).backgroundImage,
        videoCount: document.querySelectorAll('video').length,
        markColor: getComputedStyle(path).fill,
        textColor: getComputedStyle(root).color,
      };
    });
    assert.equal(layers.state, 'mark');
    assert.equal(layers.animating, true);
    assert.equal(layers.frameBackground, 'none');
    assert.equal(layers.videoCount, 0);
    assert.equal(layers.markColor, layers.textColor);
    await page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'wordmark', null, { timeout: 4000 });
    await page.waitForTimeout(900);
    const wordmark = await page.evaluate(() => ({
      glyphs: document.querySelectorAll('#studioEntryWordMask g').length,
      wordFill: document.querySelector('svg.studio-entry-word > rect')?.getAttribute('fill'),
      wordColor: getComputedStyle(document.querySelector('svg.studio-entry-word')).color,
      rootColor: getComputedStyle(document.getElementById('studioEntryMotion')).color,
      fallbackImage: Boolean(document.querySelector('img.studio-entry-word')),
    }));
    assert.equal(wordmark.glyphs, 5);
    assert.equal(wordmark.wordFill, 'currentColor');
    assert.equal(wordmark.wordColor, wordmark.rootColor);
    assert.equal(wordmark.fallbackImage, false);
    await page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'finished', null, { timeout: 4000 });
    await page.waitForTimeout(320);
    const fading = await page.evaluate(() => {
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        target: box(document.querySelector('.sidebar-logo-wordmark')),
        lockup: box(document.querySelector('.studio-entry-lockup')),
        mark: box(document.querySelector('.studio-entry-mark-frame')),
        path: document.getElementById('studioEntryMarkPath').getAttribute('d'),
      };
    });
    await page.screenshot({ path: '/tmp/issue-211-brand-entry-fading-dark.png' });
    assert.ok(Math.abs(fading.lockup.x - fading.target.x) <= 0.25);
    assert.ok(Math.abs(fading.lockup.y - fading.target.y) <= 0.25);
    assert.ok(Math.abs(fading.lockup.width - fading.target.width) <= 0.25);
    assert.ok(Math.abs(fading.mark.width - 30.07) <= 0.25);
    assert.match(fading.path, /^M3 71C3 33 34 2 72 2H106/);
    await page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 3000 });
    await page.screenshot({ path: '/tmp/issue-211-brand-entry-finished-dark.png' });
    const finished = await page.evaluate(() => ({
      dark: document.documentElement.classList.contains('studio-theme-dark'),
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      videoCount: document.querySelectorAll('video').length,
    }));
    assert.deepEqual(finished, { dark: true, overlay: false, videoCount: 0 });
    process.stdout.write(`${JSON.stringify({ ok: true, layers, wordmark, fading: { ...fading, path: undefined }, finished, screenshots: ['/tmp/issue-211-brand-entry-fading-dark.png', '/tmp/issue-211-brand-entry-finished-dark.png'] }, null, 2)}\n`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
