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
      const type = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml' }[path.extname(filePath)] || 'application/octet-stream';
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-file-media-motion-'));
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
    await cdp.send('Page.navigate', { url:`${origin}/static/design-system/infinite-canvas-ui/file-media-input-case.html?theme=light&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('[data-component-name="ic-reference-thumbnail-image"]')?.dataset?.kind === 'image'`, 'file/media fixture');

    const report = await evaluate(cdp, sessionId, `(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const thumb = document.querySelector('[data-component-name="ic-reference-thumbnail-image"]');
      const preview = () => thumb._preview;
      thumb.dispatchEvent(new PointerEvent('pointerenter'));
      await settle();
      await new Promise(resolve => setTimeout(resolve, 180));
      const openPreview = preview();
      const openStyle = getComputedStyle(openPreview);
      const open = {
        state: openPreview.dataset.motionState,
        hidden: openPreview.hidden,
        ariaHidden: openPreview.getAttribute('aria-hidden'),
        opacity: openStyle.opacity,
        transform: openStyle.transform,
        duration: openStyle.transitionDuration,
      };
      thumb.dispatchEvent(new PointerEvent('pointerleave'));
      const exitPreview = preview();
      await new Promise(resolve => setTimeout(resolve, 30));
      const exitStyle = getComputedStyle(exitPreview);
      const exiting = {
        state: exitPreview.dataset.motionState,
        hidden: exitPreview.hidden,
        ariaHidden: exitPreview.getAttribute('aria-hidden'),
        opacity: exitStyle.opacity,
        transform: exitStyle.transform,
      };
      await new Promise(resolve => setTimeout(resolve, 260));
      const closed = { state:exitPreview.dataset.motionState, hidden:exitPreview.hidden };

      thumb.dispatchEvent(new PointerEvent('pointerenter'));
      await settle();
      thumb.dispatchEvent(new PointerEvent('pointerleave'));
      thumb.dispatchEvent(new PointerEvent('pointerenter'));
      await new Promise(resolve => setTimeout(resolve, 260));
      const interrupted = { state:preview().dataset.motionState, hidden:preview().hidden };

      document.documentElement.dataset.uiMotion = 'reduced';
      thumb.dispatchEvent(new PointerEvent('pointerleave'));
      await new Promise(resolve => setTimeout(resolve, 260));
      thumb.dispatchEvent(new PointerEvent('pointerenter'));
      await new Promise(resolve => setTimeout(resolve, 5));
      const reducedPreview = preview();
      const reducedStyle = getComputedStyle(reducedPreview);
      const reduced = {
        state: reducedPreview.dataset.motionState,
        duration: reducedStyle.transitionDuration,
        transform: reducedStyle.transform,
      };

      const uploadSurface = document.querySelector('[data-component-name="ic-upload-surface-default"]');
      const uploadStyle = getComputedStyle(uploadSurface.shadowRoot.querySelector('.surface'));
      const mediaActions = document.querySelector('[data-component-name="ic-image-frame-ready"]').shadowRoot.querySelector('.actions');
      const mediaActionsStyle = getComputedStyle(mediaActions);
      const removeAction = document.querySelector('[data-component-name="ic-reference-thumbnail-hover"] .input-thumb-remove');
      const removeStyle = getComputedStyle(removeAction);
      return {
        open, exiting, closed, interrupted, reduced,
        retainedMotion: {
          uploadTransition: uploadStyle.transitionProperty,
          mediaActionTransition: mediaActionsStyle.transitionProperty,
          referenceRemoveTransition: removeStyle.transitionProperty,
        },
      };
    })()`);

    const identity = value => value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)';
    const passed = (
      report.open.state === 'open' && !report.open.hidden && report.open.ariaHidden === 'false'
      && report.open.opacity === '1' && identity(report.open.transform)
      && report.exiting.state === 'exiting' && !report.exiting.hidden && report.exiting.ariaHidden === 'true'
      && Number(report.exiting.opacity) < 1 && !identity(report.exiting.transform)
      && report.closed.state === 'closed' && report.closed.hidden
      && report.interrupted.state === 'open' && !report.interrupted.hidden
      && report.reduced.duration.split(',').every(value => value.trim() === '0.001s')
      && identity(report.reduced.transform)
      && report.retainedMotion.uploadTransition.includes('background')
      && report.retainedMotion.mediaActionTransition.includes('opacity')
      && report.retainedMotion.referenceRemoveTransition.includes('opacity')
    );
    if (!passed) throw new Error(`File/media motion contract failed: ${JSON.stringify(report)}`);
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
