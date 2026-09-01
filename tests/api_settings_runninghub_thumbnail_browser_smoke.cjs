const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 19000 + Math.floor(Math.random() * 1000);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function waitForPreview(server) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Preview did not start: ${stderr}`)), 10000);
    server.stdout.on('data', chunk => {
      if (!chunk.toString().includes('API Settings preview:')) return;
      clearTimeout(timer);
      resolve();
    });
    server.stderr.on('data', chunk => { stderr += chunk.toString(); });
    server.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Preview exited before startup (${code}): ${stderr}`));
    });
  });
}

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chrome debugger did not start: ${stderr}`)), 10000);
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
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (!operation) return;
    pending.delete(payload.id);
    if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
    else operation.resolve(payload.result);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForExit(child, timeout = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const preview = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd: ROOT,
    env: { ...process.env, API_SETTINGS_PREVIEW_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-rh-thumbnail-'));
  let browser;
  let cdp;
  try {
    await waitForPreview(preview);
    browser = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/api-settings` }, sessionId);
    await waitFor(cdp, sessionId, `customElements.get('ic-image-frame') && document.querySelector('[data-value="runninghub"]')`, 'API Settings');
    await evaluate(cdp, sessionId, `selectProvider('runninghub')`);
    await waitFor(cdp, sessionId, `(() => {
      const frame = document.querySelector('ic-image-frame[data-rh-kind="app"]');
      return frame?.getAttribute('state') === 'upload' && frame.dataset.rhFallbacks === '';
    })()`, 'failed automatic thumbnail fallback');
    const result = await evaluate(cdp, sessionId, `(() => {
      const frame = document.querySelector('ic-image-frame[data-rh-kind="app"]');
      const picker = document.querySelector('#rhAssetFileInput');
      let openCalls = 0;
      picker.open = () => { openCalls += 1; return true; };
      frame.shadowRoot.querySelector('[data-empty]').click();
      return {
        state: frame.getAttribute('state'),
        contract: frame.dataset.icContractStatus,
        ariaDisabled: frame.getAttribute('aria-disabled'),
        openCalls,
        pendingMode: rhPendingAssetRequest?.mode || '',
        pendingKind: rhPendingAssetRequest?.kind || '',
        pendingIndex: rhPendingAssetRequest?.index,
      };
    })()`);
    const checks = {
      recoveredToUpload: result.state === 'upload' && result.contract === 'ready',
      enabledAfterFallback: result.ariaDisabled === null,
      clickOpensPicker: result.openCalls === 1,
      thumbnailRequest: result.pendingMode === 'thumbnail' && result.pendingKind === 'app' && result.pendingIndex === 0,
    };
    process.stdout.write(`${JSON.stringify({ result, checks })}\n`);
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  } finally {
    try { if (cdp) await cdp.send('Browser.close'); } catch {}
    if (browser) {
      await waitForExit(browser);
      if (browser.exitCode === null) browser.kill('SIGTERM');
    }
    if (preview.exitCode === null) preview.kill('SIGTERM');
    await waitForExit(preview);
    if (profile.startsWith(`${os.tmpdir()}${path.sep}ic-rh-thumbnail-`)) fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
