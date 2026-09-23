// Real HTTP authentication + real Canvas WebSockets; all state lives in a temporary instance.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PRESENCE_LIVE_PORT || 18861);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PASSWORD = randomBytes(24).toString('hex');
const DURATION = Number(process.env.PRESENCE_LIVE_STEADY_MS || 60000);
const ROUNDS = Number(process.env.PRESENCE_LIVE_CHURN_ROUNDS || 10);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const server = spawn(process.env.PYTHON || path.join(ROOT, '.venv/bin/python'),
    ['-u', '-m', 'tests.realtime_presence_live_app', '--port', String(PORT)], {
      cwd: ROOT, env: { ...process.env, PRESENCE_TEST_PASSWORD: PASSWORD },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let serverLog = '';
  server.stdout.on('data', data => { serverLog = (serverLog + data).slice(-12000); });
  server.stderr.on('data', data => { serverLog = (serverLog + data).slice(-12000); });
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${serverLog}`);
      try { ready = (await fetch(`${ORIGIN}/api/auth/registration`)).ok; } catch (_) {}
      if (ready) break;
      await pause(200);
    }
    assert.ok(ready, `Test server did not start: ${serverLog}`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.SMART_CANVAS_BROWSER
      || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const pageErrors = [];
    const contexts = [];
    const pages = [];
    let canvas;
    for (let index = 0; index < 8; index++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      contexts.push(context);
      const username = index === 0 ? 'presence_admin' : `presence_designer_${Math.min(index, 6)}`;
      const login = await context.request.post(`${ORIGIN}/api/auth/login`, {
        data: { username, password: PASSWORD },
      });
      assert.equal(login.status(), 200, `Login failed for ${username}`);
      if (!canvas) {
        const created = await context.request.post(`${ORIGIN}/api/canvases`, {
          data: { title: 'LAZ-61 disposable presence regression', kind: 'smart', project: 'default' },
        });
        assert.equal(created.status(), 200);
        canvas = (await created.json()).canvas;
      }
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.addInitScript(() => {
        window.__presenceTrace = { opens: 0, closes: [], messages: {} };
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            if (!String(args[0]).includes('/ws/canvases/')) return;
            this.addEventListener('open', () => window.__presenceTrace.opens++);
            this.addEventListener('close', event => window.__presenceTrace.closes.push({ code: event.code, reason: event.reason }));
            this.addEventListener('message', event => {
              const { type } = JSON.parse(event.data);
              const counts = window.__presenceTrace.messages;
              counts[type] = (counts[type] || 0) + 1;
            });
          }
        };
      });
      await page.goto(`${ORIGIN}/static/smart-canvas.html?id=${canvas.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready'
        && window.SmartCanvasModules?.realtimePresence?.state().enabled);
      if (index === 0) {
        // Seed stored settings with a real editor mutation before measuring
        // Presence alone. A new empty Canvas has only in-memory defaults.
        const seeded = await page.evaluate(async rawCanvas => {
          // Compare with the actual stored document, not the editor's already
          // normalized baseline, so every peer starts with persisted defaults.
          canvasPersistenceSendOperation(canvasPersistenceDiff(
            canvasPersistenceCompactDocument(rawCanvas), canvasPersistenceSharedDocument()));
          return window.SmartCanvasModules.canvasPersistence.synced();
        }, canvas);
        assert.ok(seeded, 'Fixture settings must be persisted before the Presence exercise');
      }
    }
    const observer = pages[0];
    await observer.waitForFunction(() => window.SmartCanvasModules.realtimePresence.state().memberCount === 7);
    // Opening an empty Canvas may perform its normal initial normalization.
    // Measure only the Presence exercise after all real editors have settled.
    for (const page of pages) {
      await page.waitForFunction(() => {
        const status = window.SmartCanvasModules.canvasPersistence.status();
        return status.state === 'ready' && !status.pending;
      });
    }
    const baselineCanvas = (await (await contexts[0].request.get(`${ORIGIN}/api/canvases/${canvas.id}`)).json()).canvas;
    const initialCounts = await observer.evaluate(() => ({ ...window.__presenceTrace.messages }));
    process.stdout.write('7 accounts / 8 independent sessions connected; observing heartbeat stability\n');
    await pause(DURATION);
    for (const page of pages) {
      const trace = await page.evaluate(() => window.__presenceTrace);
      assert.deepEqual(trace.closes, [], 'Healthy multi-account sessions must not disconnect');
      assert.equal(trace.opens, 1);
      assert.ok((trace.messages.pong || 0) >= Math.floor(DURATION / 15000) - 1);
    }
    assert.deepEqual(await observer.evaluate(() => window.__presenceTrace.messages.presence_leave || 0), 0);
    // Closing one of two sessions for an account must not emit a Leave.
    await contexts[7].close();
    await pause(300);
    assert.equal(await observer.evaluate(() => window.SmartCanvasModules.realtimePresence.state().memberCount), 7);
    assert.equal(await observer.evaluate(() => window.__presenceTrace.messages.presence_leave || 0), 0);

    await observer.waitForFunction(() => [...document.querySelectorAll('#presenceMembers .presence-avatar-button img')]
      .filter(image => image.complete && image.naturalWidth > 0).length === 5);
    await observer.evaluate(() => {
      const host = document.getElementById('presenceMembers');
      window.__stableAvatars = [...host.querySelectorAll('.presence-avatar-button')];
      window.__stableImages = window.__stableAvatars.map(button => button.querySelector('img'));
      window.__removedStableAvatars = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (window.__stableAvatars.some(button => node === button || node.contains?.(button))) {
            window.__removedStableAvatars++;
          }
        }
      }).observe(host, { childList: true, subtree: true });
    });
    await observer.locator('.presence-overflow-button').press('Enter');
    await observer.locator('.presence-overflow-popover[open]').waitFor();
    const churnPage = pages[6];
    for (let round = 0; round < ROUNDS; round++) {
      // Exercise the application's own reconnect path, not a synthetic Presence receiver.
      await churnPage.evaluate(() => canvasPersistenceRequestResync('heartbeat-revision'));
      await observer.waitForFunction(count => (window.__presenceTrace.messages.presence_leave || 0) >= count, round + 1);
      await observer.waitForFunction(count => (window.__presenceTrace.messages.presence_join || 0) >= count,
        (initialCounts.presence_join || 0) + round + 1);
      assert.deepEqual(await observer.evaluate(() => ({
        buttons: window.__stableAvatars.every(button => button.isConnected),
        images: window.__stableImages.every(image => image.isConnected && image.complete && image.naturalWidth > 0),
        removed: window.__removedStableAvatars,
        popoverOpen: document.querySelector('.presence-overflow-popover').hasAttribute('open'),
      })), { buttons: true, images: true, removed: 0, popoverOpen: true });
    }
    const after = await contexts[0].request.get(`${ORIGIN}/api/canvases/${canvas.id}`);
    const finalCanvas = (await after.json()).canvas;
    assert.equal(finalCanvas.revision, baselineCanvas.revision, 'Presence must not mutate the Canvas');
    assert.deepEqual(pageErrors, []);
    const trace = await churnPage.evaluate(() => window.__presenceTrace);
    assert.equal(trace.closes.length, ROUNDS);
    assert.ok(trace.closes.every(close => close.code === 4000 && close.reason === 'resync:heartbeat-revision'));
    process.stdout.write(JSON.stringify({ accounts: 7, sessions: 8, steadyMs: DURATION,
      unexpectedCloses: 0, reconnectRounds: ROUNDS, stableAvatarRemovals: 0,
      closeCodes: trace.closes.map(close => close.code), canvasRevisionUnchanged: true }) + '\n');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve);
    });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
