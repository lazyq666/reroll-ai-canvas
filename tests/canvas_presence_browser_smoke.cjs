const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('./canvas_presence_browser_app.cjs');

(async () => {
  const port = Number(process.env.PRESENCE_CARD_TEST_PORT || 8805);
  const { server, state } = await startServer(port);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto(`http://127.0.0.1:${port}/`);
    const frame = page.frames().find(item => item.url().includes('/static/canvas-list.html'));
    const card = frame.locator('.ws-card[data-canvas-id="canvas-5"]');
    await card.locator('.ws-presence-overflow').waitFor();
    assert.equal(await frame.locator('.ws-card[data-canvas-id="canvas-0"] .ws-card-presence').isVisible(), false);
    assert.equal(await frame.locator('.ws-card[data-canvas-id="canvas-1"] .ws-presence-avatar').count(), 1);
    assert.equal(await frame.locator('.ws-card[data-canvas-id="canvas-3"] .ws-presence-avatar').count(), 3);
    assert.equal(await card.locator('.ws-presence-avatar').count(), 3);
    assert.equal(await card.locator('.ws-presence-overflow').textContent(), '+2');
    assert.equal(await frame.locator('.ws-card[data-canvas-id="classic"] .ws-card-presence').count(), 0);
    assert.deepEqual([...state.lastIds].sort(), ['canvas-0', 'canvas-1', 'canvas-3', 'canvas-5']);
    assert.equal(state.sockets, 0);

    async function checkGeometry() {
      const layout = await card.evaluate(element => {
        const content = element.querySelector('.ws-card-content').getBoundingClientRect();
        const description = element.querySelector('.ws-card-description').getBoundingClientRect();
        const members = element.querySelector('.ws-card-presence').getBoundingClientRect();
        const title = element.querySelector('.ws-card-title');
        return { gap: members.left - description.right, centered: Math.abs((members.top + members.bottom - content.top - content.bottom) / 2), inside: members.right <= content.right, clipped: title.scrollHeight > title.clientHeight, widths: [...element.querySelectorAll('.ws-presence-avatar')].map(item => item.getBoundingClientRect().width) };
      });
      assert.ok(layout.gap >= 7);
      assert.ok(layout.centered <= 1);
      assert.ok(layout.inside && layout.clipped);
      assert.deepEqual(layout.widths, [24, 24, 24]);
    }
    await checkGeometry();
    const originalPosition = await card.evaluate(element => [element.style.left, element.style.top]);
    await card.evaluate(element => { element.dataset.testIdentity = 'mounted'; });
    const avatar = card.locator('.ws-presence-avatar').first();
    await avatar.focus();
    await avatar.locator('..').getByRole('tooltip').waitFor({ state: 'visible' });
    await avatar.click();
    assert.equal(await card.count(), 1);
    const rect = await avatar.boundingBox();
    await page.mouse.move(rect.x + 10, rect.y + 10);
    await page.mouse.down();
    await page.mouse.move(rect.x + 65, rect.y + 40);
    await page.mouse.up();
    assert.deepEqual(await card.evaluate(element => [element.style.left, element.style.top]), originalPosition);
    assert.equal(state.writes, 0);
    const overflow = card.locator('.ws-presence-overflow');
    await overflow.evaluate(element => { element.dataset.testIdentity = 'same-trigger'; });
    await overflow.press('Enter');
    await card.locator('ic-popover[open]').waitFor();
    assert.equal(await card.locator('.ws-presence-member').count(), 5);
    await page.keyboard.press('Escape');
    await card.locator('ic-popover[open]').waitFor({ state: 'detached' });
    await overflow.press('Space');
    await card.locator('ic-popover[open]').waitFor();
    assert.equal(await frame.locator('.ws-board.temporary-pan').count(), 0);
    const requests = state.requests;
    await new Promise(resolve => setTimeout(resolve, 5200));
    assert.ok(state.requests > requests);
    assert.equal(await card.getAttribute('data-test-identity'), 'mounted');
    assert.equal(await overflow.getAttribute('data-test-identity'), 'same-trigger');
    assert.equal(await card.locator('ic-popover[open]').count(), 1);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'English', exact: true }).click();
    await card.getByRole('button', { name: '2 more online members', exact: true }).waitFor();
    assert.ok((await card.locator('.ws-presence-avatar').last().getAttribute('aria-label')).endsWith(' · You'));
    await page.getByRole('button', { name: 'Light / Dark', exact: true }).click();
    assert.equal(await frame.locator('html.theme-dark').count(), 1);
    await checkGeometry();
    await page.setViewportSize({ width: 720, height: 820 });
    await checkGeometry();
    await page.setViewportSize({ width: 1280, height: 800 });

    state.mode = 'failed';
    await card.getByRole('button', { name: 'Online status unavailable', exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await frame.locator('.ws-presence-avatar').count(), 0);
    state.mode = 'ready';
    await card.getByRole('button', { name: '2 more online members', exact: true }).waitFor({ timeout: 10000 });
    state.mode = 'empty';
    await card.locator('.ws-card-presence').waitFor({ state: 'hidden', timeout: 10000 });

    // A foreground return clears stale identity immediately and fetches again.
    state.mode = 'ready';
    await frame.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const pausedCount = state.requests;
    await new Promise(resolve => setTimeout(resolve, 5100));
    assert.equal(state.requests, pausedCount);
    await frame.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await card.locator('.ws-presence-overflow').waitFor();
    assert.ok(state.requests > pausedCount);

    // Once a response has arrived, aborting fetch alone cannot undo subsequent
    // async work. Complete an older body after a newer refresh on the same card.
    await frame.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[0]) !== '/api/canvases/presence') return response;
        window.fetch = originalFetch;
        return { ok: response.ok, json: () => new Promise(resolve => {
          window.releaseOldPresenceBody = () => resolve({ canvases: { 'canvas-5': [] } });
        }) };
      };
      window.CanvasListPresence.refresh();
    });
    await frame.waitForFunction(() => typeof window.releaseOldPresenceBody === 'function');
    await frame.evaluate(() => window.CanvasListPresence.refresh());
    await frame.evaluate(() => window.releaseOldPresenceBody());
    await page.waitForTimeout(100);
    assert.equal(await card.locator('.ws-presence-avatar').count(), 3);
    assert.equal(state.writes, 0);
    assert.equal(state.sockets, 0);
    assert.deepEqual(errors, []);
    console.log('Card presence: layout, keyboard, polling, language, theme, failure/recovery and foreground checks passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
