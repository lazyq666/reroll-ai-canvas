#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function readInput() {
  return new Promise((resolve, reject) => {
    let source = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { source += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(source)); }
      catch (error) { reject(error); }
    });
    process.stdin.on('error', reject);
  });
}

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`Chrome debugger did not start: ${stderr}`)),
      10000,
    );
    browser.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    browser.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before debugger startup (${code}): ${stderr}`));
    });
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (operation) {
      pending.delete(payload.id);
      if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
      else operation.resolve(payload.result);
    } else if (payload.method) {
      events.push(payload);
    }
  });
  return {
    events,
    close: () => socket.close(),
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Browser evaluation failed',
    );
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForExit(child, timeout = 3000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function consoleErrorText(event) {
  return (event.params?.args || []).map(argument => (
    typeof argument.value === 'string'
      ? argument.value
      : String(argument.description || '')
  )).join(' ');
}

function consoleErrorKind(event) {
  const value = consoleErrorText(event).toLowerCase();
  if (value.includes('websocket')) return 'websocket';
  if (value.includes('failed to load') || value.includes('network')) {
    return 'network';
  }
  if (value.includes('permission') || value.includes('forbidden')) {
    return 'permission';
  }
  if (value.includes('canvas') || value.includes('revision')) {
    return 'canvas_sync';
  }
  if (value.includes('error')) return 'javascript_error';
  return 'console_error';
}

function consoleErrorSource(event) {
  const frames = event.params?.stackTrace?.callFrames || [];
  for (const frame of frames) {
    try {
      const basename = path.basename(new URL(String(frame.url || '')).pathname);
      if (basename && /^[A-Za-z0-9._-]+$/.test(basename)) return basename;
    } catch (_error) {
      // A missing or non-URL frame is reported as an opaque source below.
    }
  }
  return 'unknown';
}

async function main() {
  const input = await readInput();
  const browserExecutable = String(input.browserExecutable || '');
  const baseUrl = String(input.baseUrl || '');
  const traceKind = String(input.traceKind || 'settings');
  const canvasId = String(input.canvasId || '');
  const expectedNodeCount = Number(input.expectedNodeCount || 0);
  const cookies = Array.isArray(input.cookies) ? input.cookies : [];
  if (!browserExecutable || !fs.existsSync(browserExecutable)) {
    throw new Error('Browser executable was not available');
  }
  if (!baseUrl.startsWith('http://127.0.0.1:')) {
    throw new Error('Browser tracer only accepts the isolated localhost service');
  }
  if (!['settings', 'canvas-open'].includes(traceKind)) {
    throw new Error('Browser tracer received an unsupported interaction');
  }
  if (traceKind === 'canvas-open' && (!canvasId || expectedNodeCount <= 0)) {
    throw new Error('Canvas-open tracer requires its isolated Canvas identity');
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-settings-tracer-'));
  let browser;
  let cdp;
  try {
    browser = spawn(browserExecutable, [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send(
      'Target.attachToTarget',
      { targetId: target.targetId, flatten: true },
    );
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    for (const cookie of cookies) {
      await cdp.send('Network.setCookie', {
        name: String(cookie.name || ''),
        value: String(cookie.value || ''),
        url: baseUrl,
        path: String(cookie.path || '/'),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
      }, sessionId);
    }
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try { localStorage.setItem('studio_brand_entry_seen', '1'); } catch (_error) {}
        window.__icLongTasks = [];
        window.__icUnhandledRejections = [];
        window.addEventListener('unhandledrejection', event => {
          window.__icUnhandledRejections.push(String(event.reason?.message || event.reason || 'unhandled rejection'));
        });
        try {
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.__icLongTasks.push(entry.duration);
          }).observe({ type: 'longtask', buffered: true });
        } catch (_error) {}
      `,
    }, sessionId);

    const navigationStarted = process.hrtime.bigint();
    await cdp.send(
      'Page.navigate',
      { url: `${baseUrl}/` },
      sessionId,
    );
    await waitFor(
      cdp,
      sessionId,
      `(() => document.readyState === 'complete'
        && ${traceKind === 'settings'
          ? "window.__IC_USER?.role === 'admin'"
          : "Boolean(window.__IC_USER?.id)"}
        && typeof window.switchUI === 'function')()`,
      'application navigation',
    );
    const appReadyMs = Number(
      process.hrtime.bigint() - navigationStarted,
    ) / 1_000_000;
    let targetFrameId = 'frame-api-settings';
    let firstOperableMs = 0;
    let canvasCardReadyMs = 0;
    let canvasOpenToReadyMs = 0;
    let canvasOpenToFeedbackMs = 0;
    let appNavigationToFeedbackMs = 0;
    if (traceKind === 'canvas-open') {
      targetFrameId = 'frame-canvas';
      await evaluate(cdp, sessionId, `document.querySelector('ic-nav-item[data-page="canvas"]').click()`);
      await waitFor(
        cdp,
        sessionId,
        `(() => {
          const frame = document.querySelector('#frame-canvas');
          const card = [...(frame?.contentDocument?.querySelectorAll('.ws-card') || [])]
            .find(item => item.dataset.canvasId === ${JSON.stringify(canvasId)});
          return frame?.classList.contains('active')
            && card
            && card.querySelector('.ws-card-nodes')?.textContent.trim().startsWith(${JSON.stringify(String(expectedNodeCount))});
        })()`,
        'representative Canvas card',
      );
      canvasCardReadyMs = Number(
        process.hrtime.bigint() - navigationStarted,
      ) / 1_000_000;
      await evaluate(cdp, sessionId, `(() => {
        window.__icLongTasks = [];
        const child = document.querySelector('#frame-canvas')?.contentWindow;
        if (child) child.__icLongTasks = [];
      })()`);
      const canvasOpenStarted = process.hrtime.bigint();
      await evaluate(cdp, sessionId, `(() => {
        const frame = document.querySelector('#frame-canvas');
        const card = [...frame.contentDocument.querySelectorAll('.ws-card')]
          .find(item => item.dataset.canvasId === ${JSON.stringify(canvasId)});
        card.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, button: 0, clientX: 40, clientY: 40
        }));
        frame.contentDocument.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, button: 0, clientX: 40, clientY: 40
        }));
      })()`);
      await waitFor(
        cdp,
        sessionId,
        `(() => {
          const frame = document.querySelector('#frame-canvas');
          const child = frame?.contentWindow;
          return child?.location.pathname.endsWith('/static/smart-canvas.html')
            && new URLSearchParams(child.location.search).get('id') === ${JSON.stringify(canvasId)}
            && child.SmartCanvasModules?.canvasPersistence?.status?.().state === 'ready'
            && frame.contentDocument.querySelectorAll('.image-node').length > 0
            && Boolean(frame.contentDocument.querySelector('#smartHandTool'));
        })()`,
        'representative Canvas interaction readiness',
      );
      canvasOpenToReadyMs = Number(
        process.hrtime.bigint() - canvasOpenStarted,
      ) / 1_000_000;
      await evaluate(cdp, sessionId, `document.querySelector('#frame-canvas').contentDocument.querySelector('#smartHandTool').click()`);
      await waitFor(
        cdp,
        sessionId,
        `document.querySelector('#frame-canvas').contentDocument.querySelector('#smartHandTool')?.getAttribute('aria-pressed') === 'true'`,
        'Canvas hand tool feedback',
      );
      canvasOpenToFeedbackMs = Number(
        process.hrtime.bigint() - canvasOpenStarted,
      ) / 1_000_000;
      appNavigationToFeedbackMs = Number(
        process.hrtime.bigint() - navigationStarted,
      ) / 1_000_000;
      firstOperableMs = canvasOpenToFeedbackMs;
      await evaluate(cdp, sessionId, `document.querySelector('#frame-canvas').contentDocument.querySelector('#smartPointerTool').click()`);
      await waitFor(
        cdp,
        sessionId,
        `document.querySelector('#frame-canvas').contentDocument.querySelector('#smartPointerTool')?.getAttribute('aria-pressed') === 'true'`,
        'original Canvas pointer tool',
      );
    } else {
      await waitFor(
        cdp,
        sessionId,
        `(() => document.querySelector('#settings-menu')?.hidden === false
          && document.querySelector('[value="api-settings"]')?.hidden === false)()`,
        'application settings navigation',
      );
      await evaluate(cdp, sessionId, `document.querySelector('#settings-fold-toggle').click()`);
      await waitFor(
        cdp,
        sessionId,
        `document.querySelector('#settings-menu')?.hasAttribute('open') === true`,
        'settings menu',
      );
      await evaluate(cdp, sessionId, `document.querySelector('[value="api-settings"]').click()`);
      await waitFor(
        cdp,
        sessionId,
        `(() => {
          const frame = document.querySelector('#frame-api-settings');
          return frame?.classList.contains('active')
            && frame.contentDocument?.readyState === 'complete'
            && frame.contentDocument.querySelectorAll('#providerList [data-value]').length > 0
            && frame.contentDocument.querySelector('#videoModelTab')?.getAttribute('role') === 'tab';
        })()`,
        'API settings controls',
      );
      await evaluate(cdp, sessionId, `document.querySelector('#frame-api-settings').contentDocument.querySelector('#videoModelTab').click()`);
      await waitFor(
        cdp,
        sessionId,
        `(() => {
          const page = document.querySelector('#frame-api-settings').contentDocument;
          return page.querySelector('#modelCategoryTabs')?.getAttribute('value') === 'video'
            && page.querySelector('#videoModelPanel')?.hidden === false
            && page.querySelector('#imageModelPanel')?.hidden === true;
        })()`,
        'video settings interaction feedback',
      );
      firstOperableMs = Number(
        process.hrtime.bigint() - navigationStarted,
      ) / 1_000_000;
      await evaluate(cdp, sessionId, `document.querySelector('#frame-api-settings').contentDocument.querySelector('#imageModelTab').click()`);
      await waitFor(
        cdp,
        sessionId,
        `(() => {
          const page = document.querySelector('#frame-api-settings').contentDocument;
          return page.querySelector('#modelCategoryTabs')?.getAttribute('value') === 'image'
            && page.querySelector('#imageModelPanel')?.hidden === false
            && page.querySelector('#videoModelPanel')?.hidden === true;
        })()`,
        'original image settings state',
      );
    }
    await delay(100);
    const pageSignals = await evaluate(cdp, sessionId, `(() => {
      const child = document.querySelector(${JSON.stringify(`#${targetFrameId}`)})?.contentWindow;
      return {
        topFrameObservedLongTasks: Array.isArray(window.__icLongTasks)
          ? window.__icLongTasks
          : [],
        targetFrameLongTasks: Array.isArray(child?.__icLongTasks)
          ? child.__icLongTasks
          : [],
        unhandledRejections: [
          ...(Array.isArray(window.__icUnhandledRejections) ? window.__icUnhandledRejections : []),
          ...(Array.isArray(child?.__icUnhandledRejections) ? child.__icUnhandledRejections : []),
        ],
      };
    })()`);
    const consoleErrors = cdp.events.filter(event => (
      event.method === 'Runtime.consoleAPICalled'
      && event.params.type === 'error'
    ));
    const consoleErrorKindCounts = {};
    for (const event of consoleErrors) {
      const kind = consoleErrorKind(event);
      consoleErrorKindCounts[kind] = (consoleErrorKindCounts[kind] || 0) + 1;
    }
    const consoleErrorSources = [...new Set(
      consoleErrors.map(consoleErrorSource),
    )].sort();
    const pageErrors = cdp.events.filter(event => (
      event.method === 'Runtime.exceptionThrown'
      || (event.method === 'Log.entryAdded' && event.params.entry?.level === 'error')
    ));
    const topFrameObservedLongTasks = (
      pageSignals.topFrameObservedLongTasks || []
    )
      .map(Number)
      .filter(Number.isFinite);
    const targetFrameLongTasks = (pageSignals.targetFrameLongTasks || [])
      .map(Number)
      .filter(Number.isFinite);
    // The top-level observer can include same-origin iframe work. Use it as the
    // aggregate rather than adding the target-frame samples a second time.
    const longTasks = topFrameObservedLongTasks;
    process.stdout.write(JSON.stringify({
      status: 'passed',
      isolatedProfile: true,
      firstOperableMs: Math.round(firstOperableMs * 1000) / 1000,
      appReadyMs: Math.round(appReadyMs * 1000) / 1000,
      canvasCardReadyMs: Math.round(canvasCardReadyMs * 1000) / 1000,
      canvasOpenToReadyMs: Math.round(canvasOpenToReadyMs * 1000) / 1000,
      canvasOpenToFeedbackMs: Math.round(canvasOpenToFeedbackMs * 1000) / 1000,
      appNavigationToFeedbackMs: Math.round(appNavigationToFeedbackMs * 1000) / 1000,
      interactionAccepted: true,
      interactionRestored: true,
      longTaskCount: longTasks.length,
      longTaskMaxMs: longTasks.length ? Math.max(...longTasks) : 0,
      topFrameObservedLongTaskCount: topFrameObservedLongTasks.length,
      topFrameObservedLongTaskMaxMs: topFrameObservedLongTasks.length
        ? Math.max(...topFrameObservedLongTasks)
        : 0,
      targetFrameLongTaskCount: targetFrameLongTasks.length,
      targetFrameLongTaskMaxMs: targetFrameLongTasks.length
        ? Math.max(...targetFrameLongTasks)
        : 0,
      consoleErrorCount: consoleErrors.length,
      consoleErrorKindCounts,
      consoleErrorSources,
      pageErrorCount: pageErrors.length,
      unhandledRejectionCount: (pageSignals.unhandledRejections || []).length,
    }));
  } finally {
    if (cdp) cdp.close();
    if (browser && browser.exitCode === null) browser.kill('SIGTERM');
    await waitForExit(browser);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stdout.write(JSON.stringify({
    status: 'failed',
    errorType: error?.name || 'Error',
    errorMessage: String(error?.message || error || 'Browser tracer failed'),
  }));
  process.exitCode = 0;
});
