const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(404).end();
      const type = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'Chrome debugger timeout')), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once:true });
    socket.addEventListener('error', reject, { once:true });
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
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for nested ic-tabs harness');
}

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-tabs-shadow-selected-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio:['ignore', 'ignore', 'pipe'] });
  try {
    const port = server.address().port;
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url:'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId:target.targetId, flatten:true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url:`http://127.0.0.1:${port}/tests/ic_tabs_shadow_selected_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, `['passed','failed'].includes(document.documentElement?.dataset.icTabsShadowSelectedTestStatus)`);
    const status = await evaluate(cdp, sessionId, 'document.documentElement.dataset.icTabsShadowSelectedTestStatus');
    const checks = JSON.parse(await evaluate(cdp, sessionId, 'document.body.dataset.checks'));
    if (status !== 'passed') throw new Error(`Nested vertical ic-tabs selected background failed: ${JSON.stringify(checks)}`);
    process.stdout.write(`${JSON.stringify({ nestedVerticalSelectedBackground:true, checks }, null, 2)}\n`);
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
