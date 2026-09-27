const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');

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
  await waitFor(
    cdp, sessionId, parentSelector === '#shell'
      ? "document.documentElement.dataset.canvasOpeningPhase === 'ready'"
      : "document.getElementById('board')?.getAttribute('aria-busy') === 'false'",
    `${url} page ready`,
  );
  await evaluate(cdp, sessionId, `(() => {
    Object.assign(viewport, {x:0, y:0, scale:1});
    ${parentSelector === '#shell' ? 'window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false})' : 'applyViewport()'};
  })()`);
  const report = await evaluate(cdp, sessionId, `(() => {
    const parent = document.querySelector(${JSON.stringify(parentSelector)});
    const grid = parent?.querySelector(':scope > ic-canvas-grid');
    const parentRect = parent.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const pattern = grid.shadowRoot.querySelector('pattern');
    const dot = grid.shadowRoot.querySelector('circle');
    const parentStyle = getComputedStyle(parent);
    const hit = document.elementFromPoint(parentRect.left + parentRect.width / 2, parentRect.top + parentRect.height / 2);
    return {
      theme: document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light',
      component: grid.localName,
      ready: grid.dataset.icContractStatus,
      ariaHidden: grid.getAttribute('aria-hidden'),
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      backgroundColor: style.backgroundColor,
      dotColor: getComputedStyle(dot).fill,
      gap: Number(pattern.getAttribute('width')),
      radius: Number(dot.getAttribute('r')),
      parentBackgroundImage: parentStyle.backgroundImage,
      fillsParent: Math.abs(parentRect.left - gridRect.left) < 1
        && Math.abs(parentRect.top - gridRect.top) < 1
        && Math.abs(parentRect.width - gridRect.width) < 1
        && Math.abs(parentRect.height - gridRect.height) < 1,
      hitPassesThrough: hit !== grid,
    };
  })()`);
  // SVG geometry alone cannot prove that dots reach the screen.
  // Compare the same empty canvas area with just the grid's paint disabled.
  const capture = async () => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png', clip: { x: 300, y: 550, width: 150, height: 150, scale: 1 },
    }, sessionId);
    return sharp(Buffer.from(data, 'base64')).resize(150, 150).removeAlpha().raw().toBuffer();
  };
  const painted = await capture();
  await evaluate(cdp, sessionId, "document.querySelector('ic-canvas-grid').shadowRoot.querySelector('svg').style.visibility = 'hidden'");
  const withoutDots = await capture();
  await evaluate(cdp, sessionId, "document.querySelector('ic-canvas-grid').shadowRoot.querySelector('svg').style.removeProperty('visibility')");
  report.dotPixelsVisible = !painted.equals(withoutDots);
  report.dotContrast = painted.reduce((peak, value, index) => Math.max(peak, Math.abs(value - withoutDots[index])), 0);
  // At CSS display size, dots must retain at least half the token contrast.
  // A 0.5px radius can produce nonzero but imperceptible pixels after scaling.
  const dotColor = Number(report.dotColor.match(/rgb\((\d+)/)?.[1]);
  const surfaceColor = Number(report.backgroundColor.match(/rgb\((\d+)/)?.[1]);
  report.minimumDotContrast = Math.abs(dotColor - surfaceColor) / 2;
  // Exercise the page's viewport owner, not the component in isolation.
  report.projections = [];
  for (const scale of [0.5, 2, 1]) {
    const projection = await evaluate(cdp, sessionId, `(() => {
      viewport.x = -37.25;
      viewport.y = 63.5;
      viewport.scale = ${scale};
      ${parentSelector === '#shell' ? 'window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false})' : 'applyViewport()'};
      const grid = document.querySelector('ic-canvas-grid');
      const pattern = grid.shadowRoot.querySelector('pattern');
      const dot = grid.shadowRoot.querySelector('circle');
      const world = document.querySelector('#world, #boardWorld');
      const matrix = new DOMMatrix(getComputedStyle(world).transform);
      return { scale: matrix.a, x: matrix.e, y: matrix.f,
        gap: Number(pattern.getAttribute('width')),
        offsetX: Number(pattern.getAttribute('x')),
        offsetY: Number(pattern.getAttribute('y')),
        radius: Number(dot.getAttribute('r')) };
    })()`);
    const scaledDots = await capture();
    await evaluate(cdp, sessionId, "document.querySelector('ic-canvas-grid').shadowRoot.querySelector('svg').style.visibility = 'hidden'");
    const scaledSurface = await capture();
    await evaluate(cdp, sessionId, "document.querySelector('ic-canvas-grid').shadowRoot.querySelector('svg').style.removeProperty('visibility')");
    projection.dotPixelsVisible = !scaledDots.equals(scaledSurface);
    report.projections.push(projection);
  }
  // A real Ctrl+wheel gesture must update both content and grid together.
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: -120, modifiers: 2,
  }, sessionId);
  await waitFor(cdp, sessionId, `new DOMMatrix(getComputedStyle(document.querySelector('#world, #boardWorld')).transform).a !== 1`, 'wheel zoom');
  report.wheelSynced = await evaluate(cdp, sessionId, `(() => {
    const scale = new DOMMatrix(getComputedStyle(document.querySelector('#world, #boardWorld')).transform).a;
    const gap = Number(document.querySelector('ic-canvas-grid').shadowRoot.querySelector('pattern').getAttribute('width'));
    return Math.abs(gap - 20 * scale) < 0.001;
  })()`);
  return report;
}

async function main() {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-issue-170-grid-'));
  const browser = spawn(CHROME, [
    '--headless=new',
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
    const pixelRatios = [1, 1.8, 2];
    for (const pixelRatio of pixelRatios) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1662, height: 846, deviceScaleFactor: pixelRatio, mobile: false,
      }, sessionId);
      for (const theme of ['light', 'dark']) {
        reports.push({ page: 'canvas-list', pixelRatio, requestedTheme: theme, ...(await inspectPage(cdp, sessionId, `${baseUrl}/static/canvas-list.html`, theme, '#board')) });
        reports.push({ page: 'smart-canvas', pixelRatio, requestedTheme: theme, ...(await inspectPage(cdp, sessionId, `${baseUrl}/static/smart-canvas.html?id=issue-170-grid`, theme, '#shell')) });
      }
    }
    const passed = reports.every(report => report.theme === report.requestedTheme
      && report.component === 'ic-canvas-grid'
      && report.ready === 'ready'
      && report.ariaHidden === 'true'
      && report.pointerEvents === 'none'
      && report.visibility === 'visible'
      && report.dotPixelsVisible
      && report.dotContrast >= report.minimumDotContrast
      && report.gap === 20
      && report.radius === 1
      && report.wheelSynced
      && report.projections.every(p => p.dotPixelsVisible && p.gap === 20 * p.scale
        && p.radius === p.scale
        && Math.abs(p.offsetX - ((p.x % p.gap) + p.gap) % p.gap) < 0.001
        && Math.abs(p.offsetY - ((p.y % p.gap) + p.gap) % p.gap) < 0.001)
      && report.parentBackgroundImage === 'none'
      && report.fillsParent
      && report.hitPassesThrough)
      && pixelRatios.every(pixelRatio => ['light', 'dark'].every(theme => {
        const pair = reports.filter(report => report.theme === theme && report.pixelRatio === pixelRatio);
        return pair.length === 2
          && pair[0].dotColor === pair[1].dotColor
          && pair[0].backgroundColor === pair[1].backgroundColor;
      }));
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
