const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json' }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
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
      if (!match) return;
      clearTimeout(timeout);
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
    if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
    else operation.resolve(payload.result);
  });
  return {
    socket,
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
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-containers-motion-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio:['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url:'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId:target.targetId, flatten:true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await cdp.send('Page.navigate', { url:`${origin}/static/design-system/infinite-canvas-ui/containers-data-case.html?theme=light&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('ic-card')?.dataset?.icContractStatus === 'ready'`, 'containers fixture');

    const report = await evaluate(cdp, sessionId, `(() => {
      const card = document.querySelector('ic-card');
      const cardSurface = card.shadowRoot.querySelector('.card');
      const divider = document.querySelector('ic-divider');
      const list = document.querySelector('ic-list');
      const media = document.querySelector('ic-media-container');
      const table = document.querySelector('ic-table');
      const cell = table.querySelector('tbody td');
      const standard = {
        tableDuration:getComputedStyle(cell).transitionDuration,
        tableProperties:getComputedStyle(cell).transitionProperty,
        tableTransform:getComputedStyle(cell).transform,
        cardAnimation:getComputedStyle(cardSurface).animationName,
        cardTransition:getComputedStyle(cardSurface).transitionProperty,
        cardTransform:getComputedStyle(cardSurface).transform,
        dividerAnimation:getComputedStyle(divider).animationName,
        listAnimation:getComputedStyle(list).animationName,
        mediaAnimation:getComputedStyle(media).animationName,
      };
      document.documentElement.dataset.uiMotion = 'reduced';
      return { standard, reducedTableDuration:getComputedStyle(cell).transitionDuration };
    })()`);
    const passed = report.standard.tableDuration === '0.15s'
      && report.standard.tableProperties === 'background-color'
      && report.standard.tableTransform === 'none'
      && report.standard.cardAnimation === 'none'
      && report.standard.cardTransition === 'all'
      && report.standard.cardTransform === 'none'
      && report.standard.dividerAnimation === 'none'
      && report.standard.listAnimation === 'none'
      && report.standard.mediaAnimation === 'none'
      && report.reducedTableDuration === '0.001s';
    if (!passed) throw new Error(`Containers motion contract failed: ${JSON.stringify(report)}`);
    console.log(JSON.stringify({ passed, report }, null, 2));
  } finally {
    cdp?.socket.close();
    browser.kill('SIGTERM');
    server.close();
    if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
    fs.rmSync(profile, { recursive:true, force:true, maxRetries:3, retryDelay:100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
