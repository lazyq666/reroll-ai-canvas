const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function json(response, value) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function apiPayload(pathname) {
  if (pathname === '/api/auth/me') return { user: { id: 'issue-170', username: 'reviewer', role: 'admin' } };
  if (pathname === '/api/projects') return { projects: [] };
  if (pathname === '/api/canvases') return { canvases: [], next_cursor: '', total: 0, rebuilding: false };
  if (pathname === '/api/canvases/trash') return { canvases: [], retention_days: 30 };
  if (pathname === '/api/config') return { api_providers: [], available_models: {}, comfy_instances: [] };
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/canvases/issue-170-grid') {
    return { canvas: { id: 'issue-170-grid', title: 'Grid review', project: 'default', revision: 1, nodes: [], connections: [], settings: {}, logs: [] } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  return {};
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) return json(response, apiPayload(url.pathname));
    const requestPath = url.pathname === '/canvas-list' ? '/static/canvas-list.html' : url.pathname;
    const filePath = path.resolve(ROOT, `.${decodeURIComponent(requestPath)}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
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
    const timer = setTimeout(() => reject(new Error(stderr || 'Chrome debugger timeout')), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
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
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (!operation) return;
    pending.delete(payload.id);
    payload.error ? operation.reject(new Error(JSON.stringify(payload.error))) : operation.resolve(payload.result);
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function inspectPage(cdp, sessionId, url, theme, parentSelector) {
  await cdp.send('Page.navigate', { url }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState !== 'loading'", `${url} origin`);
  await evaluate(cdp, sessionId, `localStorage.setItem('studio_theme', ${JSON.stringify(theme)})`);
  await cdp.send('Page.navigate', { url }, sessionId);
  await waitFor(
    cdp,
    sessionId,
    "customElements.get('ic-canvas-grid') && document.querySelector('ic-canvas-grid')?.dataset.icContractStatus === 'ready'",
    `${url} canvas grid`,
  );
  return evaluate(cdp, sessionId, `(() => {
    const parent = document.querySelector(${JSON.stringify(parentSelector)});
    const grid = parent?.querySelector(':scope > ic-canvas-grid');
    const parentRect = parent.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const parentStyle = getComputedStyle(parent);
    const hit = document.elementFromPoint(parentRect.left + parentRect.width / 2, parentRect.top + parentRect.height / 2);
    return {
      theme: document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light',
      component: grid.localName,
      ready: grid.dataset.icContractStatus,
      ariaHidden: grid.getAttribute('aria-hidden'),
      pointerEvents: style.pointerEvents,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      parentBackgroundImage: parentStyle.backgroundImage,
      fillsParent: Math.abs(parentRect.left - gridRect.left) < 1
        && Math.abs(parentRect.top - gridRect.top) < 1
        && Math.abs(parentRect.width - gridRect.width) < 1
        && Math.abs(parentRect.height - gridRect.height) < 1,
      hitPassesThrough: hit !== grid,
    };
  })()`);
}

async function main() {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-issue-170-grid-'));
  const browser = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const reports = [];
    for (const theme of ['light', 'dark']) {
      reports.push({ page: 'canvas-list', requestedTheme: theme, ...(await inspectPage(cdp, sessionId, `${baseUrl}/static/canvas-list.html`, theme, '#board')) });
      reports.push({ page: 'smart-canvas', requestedTheme: theme, ...(await inspectPage(cdp, sessionId, `${baseUrl}/static/smart-canvas.html?id=issue-170-grid`, theme, '#shell')) });
    }
    const passed = reports.every(report => report.theme === report.requestedTheme
      && report.component === 'ic-canvas-grid'
      && report.ready === 'ready'
      && report.ariaHidden === 'true'
      && report.pointerEvents === 'none'
      && report.backgroundImage.startsWith('radial-gradient(')
      && report.backgroundSize === '15px 15px'
      && report.parentBackgroundImage === 'none'
      && report.fillsParent
      && report.hitPassesThrough)
      && ['light', 'dark'].every(theme => {
        const pair = reports.filter(report => report.theme === theme);
        return pair.length === 2
          && pair[0].backgroundImage === pair[1].backgroundImage
          && pair[0].backgroundColor === pair[1].backgroundColor;
      });
    console.log(JSON.stringify({ passed, reports }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
