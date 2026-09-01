const assert = require('node:assert/strict');
const { chromium } = require('playwright');


const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8795';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';


function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') {
    return { api_providers: [], available_models: {}, comfy_instances: [] };
  }
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/auth/me') {
    return { user: { id: 'keyboard-zoom-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === '/api/canvases/keyboard-zoom-regression') {
    return {
      canvas: {
        id: 'keyboard-zoom-regression',
        title: 'Keyboard zoom regression',
        project: 'default',
        revision: 1,
        nodes: [],
        connections: [],
        settings: {},
        logs: [],
      },
    };
  }
  return {};
}


function closeTo(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}


(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  try {
    await page.addInitScript(() => {
      class KeyboardZoomWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
          this.readyState = KeyboardZoomWebSocket.CONNECTING;
          setTimeout(() => {
            this.readyState = KeyboardZoomWebSocket.OPEN;
            this.onopen?.({});
          }, 0);
        }

        send() {}

        close(code = 1000) {
          this.readyState = KeyboardZoomWebSocket.CLOSED;
          this.onclose?.({ code });
        }
      }
      window.WebSocket = KeyboardZoomWebSocket;
    });
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apiPayload(route.request().url())),
    }));
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=keyboard-zoom-regression`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.viewportSelection?.viewport
      && document.getElementById('shell')
      && document.getElementById('world'),
    ));
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = `window.__keyboardZoomProbe = {
        read: () => ({...viewport}),
        reset: () => {
          viewport.x = 100;
          viewport.y = 50;
          viewport.scale = 1;
          window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        }
      };`;
      document.body.append(script);
      script.remove();
      window.__keyboardZoomEvents = [];
      window.addEventListener('keydown', event => {
        if (['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(event.code)) {
          window.__keyboardZoomEvents.push({
            key: event.key,
            code: event.code,
            defaultPrevented: event.defaultPrevented,
          });
        }
      });
    });

    const reset = async () => {
      await page.evaluate(() => {
        window.__keyboardZoomProbe.reset();
        document.getElementById('shell').focus();
      });
    };
    const read = () => page.evaluate(() => window.__keyboardZoomProbe.read());

    await reset();
    const before = await read();
    const centerBefore = {
      x: (1280 / 2 - before.x) / before.scale,
      y: (800 / 2 - before.y) / before.scale,
    };
    await page.keyboard.press('Meta+Shift+=');
    const commandPlus = await read();
    const centerAfter = {
      x: (1280 / 2 - commandPlus.x) / commandPlus.scale,
      y: (800 / 2 - commandPlus.y) / commandPlus.scale,
    };
    assert.ok(commandPlus.scale > before.scale, JSON.stringify({ before, commandPlus }));
    closeTo(centerAfter.x, centerBefore.x);
    closeTo(centerAfter.y, centerBefore.y);

    await reset();
    await page.keyboard.press('Meta+-');
    const commandMinus = await read();
    assert.ok(commandMinus.scale < 1, JSON.stringify(commandMinus));

    await reset();
    await page.keyboard.press('Control+=');
    const controlPlus = await read();
    assert.ok(controlPlus.scale > 1, JSON.stringify(controlPlus));

    await reset();
    await page.keyboard.press('Control+-');
    const controlMinus = await read();
    assert.ok(controlMinus.scale < 1, JSON.stringify(controlMinus));

    await reset();
    const modifiedWheel = await page.evaluate(() => {
      const shell = document.getElementById('shell');
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        clientX: 640,
        clientY: 400,
        deltaY: -120,
      });
      shell.dispatchEvent(event);
      return {
        state: window.__keyboardZoomProbe.read(),
        defaultPrevented: event.defaultPrevented,
      };
    });
    assert.ok(modifiedWheel.state.scale > 1, JSON.stringify(modifiedWheel));
    assert.equal(modifiedWheel.defaultPrevented, true);

    await reset();
    const numpad = await page.evaluate(() => {
      const shell = document.getElementById('shell');
      const result = [];
      for (const init of [
        { key: 'Add', code: 'NumpadAdd', metaKey: true },
        { key: 'Subtract', code: 'NumpadSubtract', metaKey: true },
      ]) {
        window.__keyboardZoomProbe.reset();
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        shell.dispatchEvent(event);
        result.push({ code: init.code, state: window.__keyboardZoomProbe.read() });
      }
      return result;
    });
    assert.ok(numpad[0].state.scale > 1, JSON.stringify(numpad));
    assert.ok(numpad[1].state.scale < 1, JSON.stringify(numpad));

    await reset();
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'keyboardZoomEditableProbe';
      document.getElementById('shell').append(input);
      input.focus();
    });
    await page.keyboard.press('Meta+Shift+=');
    const editable = await read();
    closeTo(editable.scale, 1);

    const events = await page.evaluate(() => window.__keyboardZoomEvents);
    assert.ok(events.length >= 7, JSON.stringify(events));
    assert.ok(events.every(event => event.defaultPrevented), JSON.stringify(events));
    assert.deepEqual(errors, []);
    console.log('Smart Canvas keyboard zoom browser smoke passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
