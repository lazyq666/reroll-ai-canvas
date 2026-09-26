const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('playwright');

const baseUrl = process.env.T30_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserName = process.env.ISSUE_211_BROWSER || 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshots = {
  wordmark: `/tmp/issue-211-brand-entry-${browserName}-wordmark.png`,
  terminal: `/tmp/issue-211-brand-entry-${browserName}-terminal.png`,
  finished: `/tmp/issue-211-brand-entry-${browserName}-finished.png`,
};

if (!browserType) throw new Error(`Unsupported ISSUE_211_BROWSER: ${browserName}`);

async function openFirstEntry(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: options.reducedMotion || 'no-preference',
    colorScheme: options.colorScheme || 'light',
    storageState: options.storageState,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(settings => {
    if (!localStorage.getItem('__issue211_initialized')) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('__issue211_initialized', '1');
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
  if (options.failRuntime) {
    await page.route('**/static/js/studio-entry-motion.js*', route => route.abort('failed'));
  }
  if (options.slowBootMs) {
    await page.route('**/api/auth/me', async route => {
      await new Promise(resolve => setTimeout(resolve, options.slowBootMs));
      await route.continue();
    });
  }
  await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  if (!options.slowBootMs) {
    await page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
  }
  return { context, page, errors };
}

(async () => {
  const launchOptions = { headless: true };
  if (browserName === 'chromium') launchOptions.executablePath = browserExecutable;
  const browser = await browserType.launch(launchOptions);
  try {
    const standard = await openFirstEntry(browser, { language: 'en' });
    const initial = await standard.page.evaluate(() => ({
      state: document.getElementById('studioEntryMotion')?.dataset.entryState,
      runtime: document.getElementById('studioEntryMotion')?.dataset.entryRuntime,
      pointerEvents: getComputedStyle(document.getElementById('studioEntryMotion')).pointerEvents,
      markPath: Boolean(document.getElementById('studioEntryMarkPath')),
      videoCount: document.querySelectorAll('video').length,
      wordSource: document.querySelector('img.studio-entry-word')?.getAttribute('src')?.split('?')[0] || 'inlined',
      statusText: document.querySelector('.studio-entry-status')?.textContent,
      statusFits: document.querySelector('.studio-entry-status')?.scrollWidth
        <= document.querySelector('.studio-entry-status')?.clientWidth,
    }));
    assert.equal(initial.state, 'mark');
    assert.equal(initial.runtime, 'ready');
    assert.equal(initial.pointerEvents, 'none');
    assert.equal(initial.markPath, true);
    assert.equal(initial.videoCount, 0);
    assert.ok(['/static/images/brand/word.svg', 'inlined'].includes(initial.wordSource));
    assert.equal(initial.statusText, 'Preparing your creative space…');
    assert.equal(initial.statusFits, true);

    await standard.page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'wordmark', null, { timeout: 4000 });
    await standard.page.waitForTimeout(800);
    await standard.page.screenshot({ path: screenshots.wordmark });
    await standard.page.waitForFunction(() => document.getElementById('studioEntryMotion')?.dataset.entryState === 'docked', null, { timeout: 4000 });
    await standard.page.waitForTimeout(660);
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
        glyphs: document.querySelectorAll('#studioEntryWordMask g').length,
      };
    });
    assert.equal(terminal.state, 'finished');
    assert.equal(terminal.glyphs, 5);
    assert.equal(terminal.pinned, true);
    assert.ok(Math.abs(terminal.lockup.x - terminal.target.x) <= 0.25);
    assert.ok(Math.abs(terminal.lockup.y - terminal.target.y) <= 0.25);
    assert.ok(Math.abs(terminal.lockup.width - terminal.target.width) <= 0.25);
    assert.ok(Math.abs(terminal.lockup.height - terminal.target.height) <= 0.25);
    // The docked word keeps wordmark.svg's own proportions: 73.68 × 22.69 at 112px.
    assert.ok(Math.abs(terminal.word.width - 73.68 * terminal.target.width / 112) <= 0.25);
    assert.ok(Math.abs(terminal.word.height - 22.69 * terminal.target.width / 112) <= 0.25);
    await standard.page.screenshot({ path: screenshots.terminal });

    await standard.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 5000 });
    await standard.page.screenshot({ path: screenshots.finished });
    const completion = await standard.page.evaluate(() => ({
      seen: localStorage.getItem('studio_brand_entry_seen'),
      pinnedPreference: localStorage.getItem('studio_sidebar_pinned'),
      states: window.__entryStates,
      topLevelVideoCount: document.querySelectorAll('body > video, body > section video').length,
    }));
    assert.equal(completion.seen, '1');
    assert.equal(completion.pinnedPreference, '0');
    assert.equal(completion.topLevelVideoCount, 0);
    assert.deepEqual([...new Set(completion.states)], ['mark', 'wordmark', 'docked', 'finished']);

    const newTab = await standard.context.newPage();
    await newTab.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await newTab.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    const newTabResult = await newTab.evaluate(() => ({
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      seen: localStorage.getItem('studio_brand_entry_seen'),
    }));
    assert.deepEqual(newTabResult, { overlay: false, seen: '1' });
    await newTab.close();

    await standard.page.reload({ waitUntil: 'domcontentloaded' });
    await standard.page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    const reload = await standard.page.evaluate(() => ({
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      pinned: document.getElementById('studioSidebar').classList.contains('is-pinned'),
    }));
    assert.deepEqual(reload, { overlay: false, pinned: false });
    assert.deepEqual(standard.errors, []);
    const persistedStorage = await standard.context.storageState();
    await standard.context.close();

    const restarted = await openFirstEntry(browser, { storageState: persistedStorage });
    const restartedResult = await restarted.page.evaluate(() => ({
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      seen: localStorage.getItem('studio_brand_entry_seen'),
    }));
    assert.deepEqual(restartedResult, { overlay: false, seen: '1' });
    assert.deepEqual(restarted.errors, []);
    await restarted.context.close();

    const interruptedReload = await openFirstEntry(browser);
    assert.equal(await interruptedReload.page.locator('#studioEntryMotion').count(), 1);
    await interruptedReload.page.reload({ waitUntil: 'domcontentloaded' });
    await interruptedReload.page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    const interruptedReloadResult = await interruptedReload.page.evaluate(() => ({
      overlay: Boolean(document.getElementById('studioEntryMotion')),
      earlySkip: document.documentElement.classList.contains('studio-entry-motion-skip'),
      navigationType: performance.getEntriesByType('navigation')[0]?.type,
      seen: localStorage.getItem('studio_brand_entry_seen'),
    }));
    assert.deepEqual(interruptedReloadResult, {
      overlay: false,
      earlySkip: true,
      navigationType: 'reload',
      seen: null,
    });
    assert.deepEqual(interruptedReload.errors, []);
    await interruptedReload.context.close();

    const failed = await openFirstEntry(browser, { failRuntime: true });
    await failed.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 3000 });
    assert.deepEqual(failed.errors, []);
    await failed.context.close();

    const slow = await openFirstEntry(browser, { slowBootMs: 4000 });
    await slow.page.waitForFunction(() => {
      const root = document.getElementById('studioEntryMotion');
      return root?.classList.contains('is-loading')
        && Number(getComputedStyle(root.querySelector('.studio-entry-status')).opacity) > 0.95;
    }, null, { timeout: 6000 });
    const slowLoading = await slow.page.evaluate(() => ({
      state: document.getElementById('studioEntryMotion')?.dataset.entryState,
      booting: document.documentElement.classList.contains('studio-route-booting'),
    }));
    assert.deepEqual(slowLoading, { state: 'wordmark', booting: true });
    await slow.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 9000 });
    const slowStates = await slow.page.evaluate(() => window.__entryStates);
    assert.deepEqual([...new Set(slowStates)], ['mark', 'wordmark', 'docked', 'finished']);
    assert.deepEqual(slow.errors, []);
    await slow.context.close();

    const reduced = await openFirstEntry(browser, { reducedMotion: 'reduce', colorScheme: 'dark' });
    const reducedState = await reduced.page.evaluate(() => ({
      state: document.getElementById('studioEntryMotion')?.dataset.entryState,
      lockupDisplay: getComputedStyle(document.querySelector('.studio-entry-lockup')).display,
      staticDisplay: getComputedStyle(document.querySelector('.studio-entry-reduced-lockup')).display,
      markPath: document.getElementById('studioEntryMarkPath')?.getAttribute('d'),
    }));
    assert.deepEqual(reducedState, { state: 'reduced', lockupDisplay: 'none', staticDisplay: 'block', markPath: '' });
    await reduced.page.waitForFunction(() => !document.getElementById('studioEntryMotion'), null, { timeout: 3000 });
    assert.deepEqual(reduced.errors, []);
    await reduced.context.close();

    process.stdout.write(`${JSON.stringify({ ok: true, browser: browserName, initial, terminal, completion, newTab: newTabResult, reload, restarted: restartedResult, interruptedReload: interruptedReloadResult, failedRuntime: true, slowBoot: slowLoading, reducedMotion: true, screenshots: Object.values(screenshots) }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
