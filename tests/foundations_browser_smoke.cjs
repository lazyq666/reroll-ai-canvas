const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');


const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Chrome debugger did not start: ${stderr}`)), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    browser.once('exit', code => {
      clearTimeout(timeout);
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
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

async function waitForResult(cdp, sessionId) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const status = await evaluate(cdp, sessionId, "document.documentElement.dataset.icFoundationsStatus || ''");
    if (status === 'passed' || status === 'failed') return status;
    await delay(100);
  }
  throw new Error('Timed out waiting for the Foundations harness');
}

async function waitFor(cdp, sessionId, expression, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForExit(child, timeout = 5000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const address = server.address();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-foundations-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Accessibility.enable', {}, sessionId);
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${address.port}/tests/infinite_canvas_ui_foundations_browser_harness.html`,
    }, sessionId);
    const status = await waitForResult(cdp, sessionId);
    const resultText = await evaluate(cdp, sessionId, "document.querySelector('#foundation-results').textContent");
    const report = JSON.parse(resultText);
    if (status === 'failed' || report.error) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
      process.exitCode = 1;
      return;
    }
    const tree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const accessibleIcons = tree.nodes
      .filter(node => !node.ignored && node.role?.value === 'image')
      .map(node => node.name?.value || '');
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${address.port}/static/design-system/infinite-canvas-ui/foundations.html`,
    }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      "document.documentElement.dataset.foundationsMatrixStatus === 'ready'",
      'six standard foundation matrix cases',
    );
    const standardMatrix = await evaluate(cdp, sessionId, `(() => {
      const cards = [...document.querySelectorAll('[data-density][data-theme]')];
      const frames = [...document.querySelectorAll('[data-foundation-case]')];
      return {
        cases: frames.length,
        densities: [...new Set(cards.map(card => card.dataset.density))],
        themes: [...new Set(cards.map(card => card.dataset.theme))].sort(),
        motions: [...new Set(frames.map(frame => frame.contentDocument?.body.dataset.motion))],
        details: frames.map(frame => frame.contentDocument?.body.dataset.detail),
        fullCoverage: frames
          .filter(frame => frame.contentDocument?.body.dataset.detail === 'full')
          .every(frame => [
            '.foundation-layer-stack',
            '.foundation-swatch-grid',
            '.foundation-state-groups',
            '.foundation-status-grid',
            '.foundation-text-levels',
            '.foundation-effects-grid',
            '.foundation-narrow-preview',
          ].every(selector => frame.contentDocument.querySelector(selector))),
        ready: frames.every(frame => frame.contentDocument?.documentElement.dataset.foundationCaseStatus === 'ready'),
      };
    })()`);
    await evaluate(cdp, sessionId, `(() => {
      const select = document.querySelector('[data-motion-mode]');
      select.value = 'reduced';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      cdp,
      sessionId,
      `document.documentElement.dataset.foundationsMatrixStatus === 'ready'
        && [...document.querySelectorAll('[data-foundation-case]')]
          .every(frame => frame.contentDocument?.body.dataset.motion === 'reduced')`,
      'six reduced-motion foundation matrix cases',
    );
    const reducedMatrix = await evaluate(cdp, sessionId, `(() => ({
      cases: document.querySelectorAll('[data-foundation-case]').length,
      motions: [...new Set([...document.querySelectorAll('[data-foundation-case]')]
        .map(frame => frame.contentDocument?.body.dataset.motion))],
      status: document.querySelector('[data-foundations-status]').textContent,
    }))()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${address.port}/static/design-system/infinite-canvas-ui/foundation-case.html?density=medium&theme=dark&motion=standard&detail=full&case=narrow-browser`,
    }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      "document.documentElement.dataset.foundationCaseStatus === 'ready'",
      'narrow full Foundations case',
    );
    const narrowCase = await evaluate(cdp, sessionId, `(() => {
      const root = document.documentElement;
      const preview = document.querySelector('.foundation-narrow-preview');
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        previewWidth: preview?.getBoundingClientRect().width || 0,
        detailsVisible: getComputedStyle(document.querySelector('.foundation-semantic-details')).display !== 'none',
        stateRows: document.querySelectorAll('.foundation-state-row').length,
      };
    })()`);
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    const consoleErrors = cdp.events.flatMap(event => {
      if (event.method === 'Runtime.exceptionThrown') {
        return [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text || 'Runtime exception'];
      }
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        return [event.params.args?.map(arg => arg.value || arg.description || '').join(' ') || 'console.error'];
      }
      if (event.method === 'Log.entryAdded' && event.params.entry?.level === 'error') return [event.params.entry.text];
      return [];
    });
    const roundedHeights = ['medium', 'small', 'large'].map(key => Math.round(report.density[key].actionHeight));
    report.accessibleIcons = accessibleIcons;
    report.matrix = { standard: standardMatrix, reduced: reducedMatrix, narrow: narrowCase };
    report.consoleErrors = consoleErrors;
    report.checks = {
      density: JSON.stringify(roundedHeights) === JSON.stringify([40, 32, 48]),
      theme:
        report.theme.light.contrast >= 4.5
        && report.theme.dark.contrast >= 4.5
        && report.theme.light.background !== report.theme.dark.background
        && report.themeInterface.legacyDarkBackground === report.theme.dark.background
        && report.themeInterface.standardLightWinsBackground === report.theme.light.background,
      states:
        ['light', 'dark'].every(theme => {
          const state = report.theme[theme];
          const colors = state.colors;
          return new Set([
            colors['--ui-color-action-primary'],
            colors['--ui-color-action-primary-hover'],
          ]).size === 2
            && state.controlBorderContrast >= 3
            && state.disabledContrast >= 4.5
            && state.focusContrast >= 3;
        }),
      motion: report.motion.standard !== report.motion.reduced && report.motion.reduced === '1ms',
      focus: report.focus.hostFocused && Boolean(report.focus.ring) && Boolean(report.focus.offset),
      icon:
        Math.round(report.icons.labeled.width) === 20
        && Math.round(report.icons.labeled.height) === 20
        && JSON.stringify(report.icons.strokeWidths) === JSON.stringify({ xs: 1.33, s: 1.33, m: 1.5, l: 2, xl: 2.5 })
        && report.icons.labeled.role === 'img'
        && report.icons.labeled.label === 'Canvas settings'
        && report.icons.decorative.hidden === 'true'
        && accessibleIcons.includes('Canvas settings'),
      matrix:
        standardMatrix.cases === 6
        && standardMatrix.ready
        && standardMatrix.fullCoverage
        && JSON.stringify(standardMatrix.densities) === JSON.stringify(['medium', 'small', 'large'])
        && JSON.stringify(standardMatrix.themes) === JSON.stringify(['dark', 'light'])
        && JSON.stringify(standardMatrix.motions) === JSON.stringify(['standard'])
        && standardMatrix.details.filter(detail => detail === 'full').length === 2
        && standardMatrix.details.filter(detail => detail === 'compact').length === 4
        && reducedMatrix.cases === 6
        && JSON.stringify(reducedMatrix.motions) === JSON.stringify(['reduced'])
        && reducedMatrix.status.includes('6/6')
        && narrowCase.scrollWidth <= narrowCase.clientWidth
        && narrowCase.previewWidth <= 320
        && narrowCase.detailsVisible
        && narrowCase.stateRows === 2,
      console: consoleErrors.length === 0,
    };
    report.browser = await cdp.send('Browser.getVersion');
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (status !== 'passed' || !Object.values(report.checks).every(Boolean)) process.exitCode = 1;
  } finally {
    try { if (cdp) await cdp.send('Browser.close'); } catch {}
    server.close();
    await waitForExit(browser);
    if (browser.exitCode === null) {
      browser.kill('SIGTERM');
      await waitForExit(browser);
    }
    if (profile.startsWith(`${os.tmpdir()}${path.sep}ic-foundations-browser-`)) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
