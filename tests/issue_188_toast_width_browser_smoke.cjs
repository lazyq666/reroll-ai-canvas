const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      return response.writeHead(403).end('Forbidden');
    }
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = {
        '.css': 'text/css',
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.json': 'application/json',
      }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
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

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-toast-issue-188-'));
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
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const port = server.address().port;
    const reports = [];
    for (const viewportWidth of [800, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewportWidth,
        height: 600,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      await cdp.send('Page.navigate', {
        url: `http://127.0.0.1:${port}/static/design-system/infinite-canvas-ui/feedback-progress-case.html?theme=light&locale=en`,
      }, sessionId);
      await waitFor(
        cdp,
        sessionId,
        "document.documentElement.dataset.feedbackProgressCaseStatus === 'ready'",
        `${viewportWidth}px Feedback/Progress case`,
      );
      reports.push(await evaluate(cdp, sessionId, `(async () => {
        const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        await paint();
        const measure = async message => {
          const toast = document.createElement('ic-toast');
          toast.setAttribute('tone', 'info');
          toast.textContent = message;
          document.body.append(toast);
          await paint();
          const style = getComputedStyle(toast);
          const rect = toast.getBoundingClientRect();
          const result = {
            width: rect.width,
            minWidth: parseFloat(style.minWidth),
            maxWidth: parseFloat(style.maxWidth),
            left: rect.left,
            right: rect.right,
            centerOffset: Math.abs((rect.left + rect.width / 2) - (document.documentElement.clientWidth / 2)),
          };
          toast.remove();
          await paint();
          return result;
        };
        return {
          viewportWidth: document.documentElement.clientWidth,
          short: await measure('Saved'),
          long: await measure('Synchronization completed for this workspace and every connected canvas view; the detailed result remains available.'),
        };
      })()`));
    }
    const desktop = reports.find(report => report.viewportWidth === 800);
    const narrow = reports.find(report => report.viewportWidth === 320);
    const closeTo = (actual, expected) => Math.abs(actual - expected) <= 1;
    const centeredAndSafe = report => [report.short, report.long].every(item => (
      item.centerOffset <= 1 && item.left >= 16 && item.right <= report.viewportWidth - 16
    ));
    const passed = Boolean(
      desktop
      && closeTo(desktop.short.width, 272)
      && desktop.long.width > desktop.short.width
      && closeTo(desktop.long.width, 435.2)
      && closeTo(desktop.short.minWidth, 272)
      && closeTo(desktop.short.maxWidth, 435.2)
      && centeredAndSafe(desktop)
      && narrow
      && closeTo(narrow.short.width, 272)
      && narrow.long.width > narrow.short.width
      && closeTo(narrow.long.width, 288)
      && closeTo(narrow.short.minWidth, 272)
      && closeTo(narrow.short.maxWidth, 288)
      && centeredAndSafe(narrow)
    );
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
