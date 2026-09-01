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
    await page.waitForFunction(() => {
      const video = document.getElementById('studioEntryLogoMotion');
      return video?.readyState >= 2 && video.currentTime > 0.05;
    }, null, { timeout: 5000 });
    const layers = await page.evaluate(() => {
      const root = document.getElementById('studioEntryMotion');
      const frame = document.querySelector('.studio-entry-mark-frame');
      const video = document.getElementById('studioEntryLogoMotion');
      return {
        state: root?.dataset.entryState,
        mediaError: root?.classList.contains('has-media-error'),
        frameBackground: getComputedStyle(frame).backgroundImage,
        poster: video?.getAttribute('poster') || '',
        videoOpacity: getComputedStyle(video).opacity,
      };
    });
    assert.equal(layers.state, 'mark');
    assert.equal(layers.mediaError, false);
    assert.equal(layers.frameBackground, 'none');
    assert.equal(layers.poster, '');
    assert.equal(layers.videoOpacity, '1');
    await page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'wordmark', null, { timeout: 8000 });
    const resolved = await page.evaluate(() => {
      const root = document.getElementById('studioEntryMotion');
      const frame = document.querySelector('.studio-entry-mark-frame');
      return {
        state: root?.dataset.entryState,
        resolvedMark: root?.classList.contains('has-resolved-mark'),
        connectedVideoCount: frame?.querySelectorAll('video').length,
        frameBackground: getComputedStyle(frame).backgroundImage,
      };
    });
    assert.equal(resolved.state, 'wordmark');
    assert.equal(resolved.resolvedMark, true);
    assert.equal(resolved.connectedVideoCount, 0);
    assert.match(resolved.frameBackground, /logo\.svg/);
    await page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'finished', null, { timeout: 6000 });
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
      };
    });
    await page.screenshot({ path: '/tmp/issue-211-brand-entry-fading-dark.png' });
    assert.ok(Math.abs(fading.lockup.x - fading.target.x) <= 0.25);
    assert.ok(Math.abs(fading.lockup.y - fading.target.y) <= 0.25);
    assert.ok(Math.abs(fading.lockup.width - fading.target.width) <= 0.25);
    assert.ok(Math.abs(fading.mark.width - 30.07) <= 0.25);
    await page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 6000 });
    await page.screenshot({ path: '/tmp/issue-211-brand-entry-finished-dark.png' });
    const finished = await page.evaluate(() => ({
      dark: document.documentElement.classList.contains('studio-theme-dark'),
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      topLevelVideoCount: document.querySelectorAll('body > video, body > section video').length,
    }));
    assert.deepEqual(finished, { dark: true, overlay: false, topLevelVideoCount: 0 });
    process.stdout.write(`${JSON.stringify({ ok: true, layers, resolved, fading, finished, screenshots: ['/tmp/issue-211-brand-entry-fading-dark.png', '/tmp/issue-211-brand-entry-finished-dark.png'] }, null, 2)}\n`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
