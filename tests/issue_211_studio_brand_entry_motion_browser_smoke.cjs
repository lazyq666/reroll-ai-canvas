const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.T30_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function openFirstEntry(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: options.reducedMotion || 'no-preference',
    colorScheme: options.colorScheme || 'light',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(settings => {
    if (!sessionStorage.getItem('__issue211_initialized')) {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__issue211_initialized', '1');
      localStorage.setItem('studio_theme', settings.theme);
      localStorage.setItem('studio_lang', settings.language);
      localStorage.setItem('studio_sidebar_pinned', '0');
    }
    window.__entryStates = [];
    addEventListener('DOMContentLoaded', () => {
      const root = document.getElementById('studioEntryMotion');
      if (!root) return;
      const record = () => window.__entryStates.push(root.dataset.entryState);
      record();
      new MutationObserver(record).observe(root, { attributes: true, attributeFilter: ['data-entry-state'] });
    }, { once: true });
  }, {
    theme: options.colorScheme || 'light',
    language: options.language || 'zh',
  });
  if (options.failMedia) {
    await page.route('**/reroll-logo-motion-transparent.webm', route => route.abort('failed'));
  }
  await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
  return { context, page, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const standard = await openFirstEntry(browser, { language: 'en' });
    const initial = await standard.page.evaluate(() => ({
      state: document.getElementById('studioEntryMotion')?.dataset.entryState,
      pointerEvents: getComputedStyle(document.getElementById('studioEntryMotion')).pointerEvents,
      videoSource: document.querySelector('#studioEntryLogoMotion source')?.getAttribute('src'),
      wordSource: document.querySelector('.studio-entry-word')?.getAttribute('src'),
      statusText: document.querySelector('.studio-entry-status')?.textContent,
      statusFits: document.querySelector('.studio-entry-status')?.scrollWidth
        <= document.querySelector('.studio-entry-status')?.clientWidth,
    }));
    assert.equal(initial.state, 'mark');
    assert.equal(initial.pointerEvents, 'none');
    assert.equal(initial.videoSource, '/static/images/reroll-logo-motion-transparent.webm');
    assert.equal(initial.wordSource, '/static/images/word.svg');
    assert.equal(initial.statusText, 'Preparing your creative space…');
    assert.equal(initial.statusFits, true);

    await standard.page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'wordmark', null, { timeout: 8000 });
    await standard.page.waitForTimeout(1700);
    await standard.page.screenshot({ path: '/tmp/issue-211-brand-entry-wordmark.png' });
    await standard.page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'docked', null, { timeout: 4000 });
    await standard.page.waitForTimeout(850);
    const terminal = await standard.page.evaluate(() => {
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      };
      return {
        target: box(document.querySelector('.sidebar-logo-wordmark')),
        lockup: box(document.querySelector('.studio-entry-lockup')),
        mark: box(document.querySelector('.studio-entry-mark-frame')),
        word: box(document.querySelector('.studio-entry-word-frame')),
        pinned: document.getElementById('studioSidebar').classList.contains('is-pinned'),
        state: document.getElementById('studioEntryMotion').dataset.entryState,
      };
    });
    assert.equal(terminal.state, 'docked');
    assert.equal(terminal.pinned, true);
    assert.ok(Math.abs(terminal.lockup.x - terminal.target.x) <= 0.25);
    assert.ok(Math.abs(terminal.lockup.y - terminal.target.y) <= 0.25);
    assert.ok(Math.abs(terminal.lockup.width - terminal.target.width) <= 0.25);
    assert.ok(Math.abs(terminal.lockup.height - terminal.target.height) <= 0.25);
    assert.ok(Math.abs(terminal.word.height - terminal.target.height) <= 0.25);
    await standard.page.screenshot({ path: '/tmp/issue-211-brand-entry-terminal.png' });

    await standard.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 5000 });
    await standard.page.screenshot({ path: '/tmp/issue-211-brand-entry-finished.png' });
    const completion = await standard.page.evaluate(() => ({
      seen: sessionStorage.getItem('studio_brand_entry_seen'),
      pinnedPreference: localStorage.getItem('studio_sidebar_pinned'),
      states: window.__entryStates,
      topLevelVideoCount: document.querySelectorAll('body > video, body > section video').length,
    }));
    assert.equal(completion.seen, '1');
    assert.equal(completion.pinnedPreference, '0');
    assert.equal(completion.topLevelVideoCount, 0);
    assert.deepEqual([...new Set(completion.states)], ['mark', 'wordmark', 'docked', 'finished']);

    await standard.page.reload({ waitUntil: 'domcontentloaded' });
    await standard.page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    const reload = await standard.page.evaluate(() => ({
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      pinned: document.getElementById('studioSidebar').classList.contains('is-pinned'),
    }));
    assert.deepEqual(reload, { overlay: false, pinned: false });
    assert.deepEqual(standard.errors, []);
    await standard.context.close();

    const interruptedReload = await openFirstEntry(browser);
    assert.equal(await interruptedReload.page.locator('#studioEntryMotion').count(), 1);
    await interruptedReload.page.reload({ waitUntil: 'domcontentloaded' });
    await interruptedReload.page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    const interruptedReloadResult = await interruptedReload.page.evaluate(() => ({
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      earlySkip: document.documentElement.classList.contains('studio-entry-motion-skip'),
      navigationType: performance.getEntriesByType('navigation')[0]?.type,
      seen: sessionStorage.getItem('studio_brand_entry_seen'),
    }));
    assert.deepEqual(interruptedReloadResult, {
      overlay: false,
      earlySkip: true,
      navigationType: 'reload',
      seen: null,
    });
    assert.deepEqual(interruptedReload.errors, []);
    await interruptedReload.context.close();

    const failed = await openFirstEntry(browser, { failMedia: true });
    await failed.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 10000 });
    assert.deepEqual(failed.errors, []);
    await failed.context.close();

    const reduced = await openFirstEntry(browser, { reducedMotion: 'reduce', colorScheme: 'dark' });
    const reducedState = await reduced.page.evaluate(() => ({
      state: document.getElementById('studioEntryMotion')?.dataset.entryState,
      videoDisplay: getComputedStyle(document.querySelector('.studio-entry-lockup')).display,
      staticDisplay: getComputedStyle(document.querySelector('.studio-entry-reduced-lockup')).display,
    }));
    assert.deepEqual(reducedState, { state: 'reduced', videoDisplay: 'none', staticDisplay: 'block' });
    await reduced.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 3000 });
    assert.deepEqual(reduced.errors, []);
    await reduced.context.close();

    process.stdout.write(`${JSON.stringify({ ok: true, initial, terminal, completion, reload, interruptedReload: interruptedReloadResult, failedMedia: true, reducedMotion: true, screenshots: ['/tmp/issue-211-brand-entry-wordmark.png', '/tmp/issue-211-brand-entry-terminal.png', '/tmp/issue-211-brand-entry-finished.png'] }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
