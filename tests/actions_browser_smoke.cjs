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
    } else if (payload.method) events.push(payload);
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
    const status = await evaluate(cdp, sessionId, "document.documentElement.dataset.icActionsStatus || ''");
    if (status === 'passed' || status === 'failed') return status;
    await delay(100);
  }
  throw new Error('Timed out waiting for the Actions harness');
}

async function waitFor(cdp, sessionId, expression, description, timeout = 20000) {
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-actions-browser-'));
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
      url: `http://127.0.0.1:${address.port}/tests/infinite_canvas_ui_actions_browser_harness.html`,
    }, sessionId);
    const status = await waitForResult(cdp, sessionId);
    const report = JSON.parse(await evaluate(
      cdp,
      sessionId,
      "document.querySelector('#actions-results').textContent",
    ));
    const accessibilityTree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const accessibleButtons = accessibilityTree.nodes
      .filter(node => !node.ignored && node.role?.value === 'button')
      .map(node => ({
        name: node.name?.value || '',
        pressed: node.properties?.find(property => property.name === 'pressed')?.value?.value,
        disabled: node.properties?.find(property => property.name === 'disabled')?.value?.value,
      }));
    const accessibleGroups = accessibilityTree.nodes
      .filter(node => !node.ignored && node.role?.value === 'group')
      .map(node => node.name?.value || '');
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${address.port}/static/design-system/infinite-canvas-ui/actions.html`,
    }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      "document.documentElement?.dataset.actionMatrixStatus === 'ready'",
      'six Actions live matrix cases',
    );
    const matrix = await evaluate(cdp, sessionId, `(() => {
      const cards = [...document.querySelectorAll('.actions-live-card')];
      const frames = [...document.querySelectorAll('[data-action-case]')];
      const documents = frames.map(frame => frame.contentDocument);
      return {
        cases: frames.length,
        status: document.querySelector('[data-actions-live-status]').textContent,
        themes: [...new Set(cards.map(card => card.dataset.theme))].sort(),
        viewports: [...new Set(cards.map(card => card.dataset.viewport))].sort(),
        locales: [...new Set(cards.map(card => card.dataset.locale))].sort(),
        content: [...new Set(cards.map(card => card.dataset.content))].sort(),
        motions: [...new Set(cards.map(card => card.dataset.motion))].sort(),
        legalCounts: documents.map(item => item.querySelectorAll('[data-legal-combinations] > article').length),
        sizeCounts: documents.map(item => item.querySelectorAll('[data-action-sizes] > div').length),
        sizeMetrics: documents.map(item => [...item.querySelectorAll('[data-action-sizes] ic-button')].map(control => {
          const base = control.shadowRoot.querySelector('[part~="base"]');
          return {
            name: control.closest('[data-size]')?.dataset.size,
            height: base.getBoundingClientRect().height,
            fontSize: getComputedStyle(base).fontSize,
            radius: getComputedStyle(base).borderRadius,
          };
        })),
        stateCounts: documents.map(item => item.querySelectorAll('[data-action-states] > div').length),
        groupCounts: documents.map(item => item.querySelectorAll('ic-button-group').length),
        contractsReady: documents.every(item => (
          item.documentElement.dataset.actionCaseStatus === 'ready'
          && [...item.querySelectorAll('ic-button, ic-icon-button, ic-button-group')]
            .every(control => control.dataset.icContractStatus === 'ready')
        )),
        focusVisible: documents.every(item => {
          const control = item.querySelector('[data-state="focus-visible"] ic-button');
          control?.focus();
          return item.activeElement === control;
        }),
        reducedDurations: documents
          .filter(item => item.documentElement.dataset.uiMotion === 'reduced')
          .map(item => getComputedStyle(item.documentElement).getPropertyValue('--ui-motion-duration-fast').trim()),
      };
    })()`);
    report.consoleErrors = cdp.events.flatMap(event => {
      if (event.method === 'Runtime.exceptionThrown') {
        return [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text || 'Runtime exception'];
      }
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        return [event.params.args?.map(arg => arg.value || arg.description || '').join(' ') || 'console.error'];
      }
      if (event.method === 'Log.entryAdded' && event.params.entry?.level === 'error') return [event.params.entry.text];
      return [];
    });
    report.accessibility = { buttons: accessibleButtons, groups: accessibleGroups };
    report.matrix = matrix;
    report.checks.accessibility = (
      accessibleButtons.some(button => button.name === 'Canvas settings')
      && accessibleButtons.some(button => button.name === 'Snap to grid' && button.pressed === 'true')
      && accessibleButtons.filter(button => button.disabled !== true).every(button => button.name.trim() !== '')
      && accessibleGroups.filter(name => name === 'Canvas actions').length === 1
      && accessibleGroups.every(name => name.trim() !== '')
    );
    report.checks.matrix = (
      matrix.cases === 6
      && matrix.status.includes('6/6')
      && JSON.stringify(matrix.themes) === JSON.stringify(['dark', 'light'])
      && JSON.stringify(matrix.viewports) === JSON.stringify(['desktop', 'narrow'])
      && JSON.stringify(matrix.locales) === JSON.stringify(['en', 'zh-CN'])
      && JSON.stringify(matrix.content) === JSON.stringify(['long', 'normal'])
      && JSON.stringify(matrix.motions) === JSON.stringify(['reduced', 'standard'])
      && matrix.legalCounts.every(count => count === 15)
      && matrix.sizeCounts.every(count => count === 4)
      && matrix.sizeMetrics.every(metrics => (
        JSON.stringify(metrics.map(item => item.name)) === JSON.stringify(['xs', 'small', 'medium', 'large'])
        && JSON.stringify(metrics.map(item => item.height)) === JSON.stringify([20, 28, 36, 40])
        && JSON.stringify(metrics.map(item => item.fontSize)) === JSON.stringify(['10px', '12px', '14px', '16px'])
        && metrics.every(item => item.radius === '16px')
      ))
      && matrix.stateCounts.every(count => count === 7)
      && matrix.groupCounts.every(count => count === 2)
      && matrix.contractsReady
      && matrix.focusVisible
      && matrix.reducedDurations.every(duration => duration === '1ms')
    );
    report.checks.console = report.consoleErrors.length === 0;
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
    if (profile.startsWith(`${os.tmpdir()}${path.sep}ic-actions-browser-`)) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
