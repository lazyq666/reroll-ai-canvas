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
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json' }[path.extname(filePath)] || 'application/octet-stream';
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-menu-popover-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const port = server.address().port;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/infinite_canvas_ui_menu_popover_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "['passed','failed'].includes(document.documentElement.dataset.icMenuPopoverTestStatus)", 'Menu/Popover public behavior');
    const status = await evaluate(cdp, sessionId, 'document.documentElement.dataset.icMenuPopoverTestStatus');
    const report = JSON.parse(await evaluate(cdp, sessionId, "document.querySelector('#ic-results').textContent"));
    if (status !== 'passed') throw new Error(`Menu/Popover public behavior failed: ${JSON.stringify(report)}`);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/infinite_canvas_ui_confirm_popover_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "['passed','failed'].includes(document.documentElement.dataset.icConfirmPopoverTestStatus)", 'Confirm Popover public behavior');
    const confirmStatus = await evaluate(cdp, sessionId, 'document.documentElement.dataset.icConfirmPopoverTestStatus');
    const confirmReport = JSON.parse(await evaluate(cdp, sessionId, "document.querySelector('#results').textContent"));
    if (confirmStatus !== 'passed') throw new Error(`Confirm Popover public behavior failed: ${JSON.stringify(confirmReport)}`);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/infinite_canvas_ui_overlay_motion_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "['passed','failed'].includes(document.documentElement.dataset.icOverlayMotionTestStatus)", 'anchored overlay motion');
    const motionStatus = await evaluate(cdp, sessionId, 'document.documentElement.dataset.icOverlayMotionTestStatus');
    const motionReport = JSON.parse(await evaluate(cdp, sessionId, "document.querySelector('#results').textContent"));
    if (motionStatus !== 'passed') throw new Error(`Anchored overlay motion failed: ${JSON.stringify(motionReport)}`);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/design-system/infinite-canvas-ui/menu-popover.html` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.menuPopoverMatrixStatus === 'ready'", 'Menu/Popover matrix');
    const cases = await evaluate(cdp, sessionId, "document.querySelectorAll('[data-menu-popover-case]').length");
    if (cases < 6) throw new Error(`Expected six cases, got ${cases}`);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/ui-component-library.html#menu-popover` }, sessionId);
    await waitFor(cdp, sessionId, "document.body?.dataset?.activeReview === 'menu-popover'", 'Menu/Popover component-library review');
    await waitFor(
      cdp,
      sessionId,
      "document.querySelector('[data-menu-popover-matrix]')?.contentDocument?.documentElement?.dataset?.menuPopoverCaseStatus === 'ready'",
      'Reference Generate Menu business variant',
    );
    const referenceGenerate = await evaluate(cdp, sessionId, `(() => {
      const frame = document.querySelector('[data-menu-popover-matrix]');
      const search = document.querySelector('[data-target-review-search]');
      search.value = '引用该节点生成';
      search.dispatchEvent(new Event('input', { bubbles:true }));
      const variantCase = frame.contentDocument.querySelector('[data-reference-generate-case]');
      const menu = frame.contentDocument.querySelector('[data-reference-generate-menu]');
      const surface = menu?.shadowRoot?.querySelector('[part="surface"]');
      const heading = menu?.querySelector('.reference-generate-label');
      const rect = surface?.getBoundingClientRect();
      const style = surface ? frame.contentWindow.getComputedStyle(surface) : null;
      const headingStyle = heading ? frame.contentWindow.getComputedStyle(heading) : null;
      return {
        registered:Boolean(frame.contentWindow.customElements.get('ic-menu')),
        searchable:Boolean(document.querySelector('[data-target-component="ic-menu-reference-generate"]')),
        componentName:variantCase?.dataset.componentName || '',
        variant:menu?.getAttribute('variant') || '',
        open:Boolean(menu?.hasAttribute('open')),
        visible:Boolean(surface && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0),
        background:style?.backgroundColor || '',
        radius:style?.borderRadius || '',
        headingWeight:headingStyle?.fontWeight || '',
        label:menu?.getAttribute('label') || '',
        itemValues:[...menu.querySelectorAll('ic-menu-item')].map(item => item.getAttribute('value')),
        itemLabels:[...menu.querySelectorAll('ic-menu-item')].map(item => item.getAttribute('label')),
      };
    })()`);
    if (!referenceGenerate.registered
      || !referenceGenerate.searchable
      || referenceGenerate.componentName !== 'ic-menu-reference-generate'
      || referenceGenerate.variant !== 'reference-generate'
      || !referenceGenerate.open
      || !referenceGenerate.visible
      || referenceGenerate.radius !== '16px'
      || referenceGenerate.headingWeight !== '400'
      || referenceGenerate.label !== '引用该节点生成'
      || referenceGenerate.itemValues.join() !== 'text,image,video'
      || referenceGenerate.itemLabels.join() !== '文本,图片,视频') {
      throw new Error(`Reference Generate Menu variant failed: ${JSON.stringify(referenceGenerate)}`);
    }
    const mentionMediaSearchable = await evaluate(cdp, sessionId, `(() => {
      const search = document.querySelector('[data-target-review-search]');
      search.value = '输入图';
      search.dispatchEvent(new Event('input', { bubbles:true }));
      const result = document.querySelector('[data-target-component="ic-mention-picker-media"]');
      const frame = document.querySelector('[data-menu-popover-matrix]');
      const variant = frame.contentDocument.querySelector('.mention-picker-media-case');
      return Boolean(result && variant?.dataset.copyValue === 'ic-mention-picker-media');
    })()`);
    if (!mentionMediaSearchable) throw new Error('Mention Picker input-media variant is not searchable in the component library');
    if (process.env.IC_REFERENCE_GENERATE_SCREENSHOT) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true }, sessionId);
      fs.writeFileSync(process.env.IC_REFERENCE_GENERATE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate(cdp, sessionId, "document.querySelector('[data-target-theme-toggle]').click()");
    await waitFor(
      cdp,
      sessionId,
      "document.querySelector('[data-menu-popover-matrix]')?.contentDocument?.documentElement?.dataset?.uiTheme === 'dark'",
      'Reference Generate Menu dark theme',
    );
    const referenceGenerateDark = await evaluate(cdp, sessionId, `(() => {
      const frame = document.querySelector('[data-menu-popover-matrix]');
      const menu = frame.contentDocument.querySelector('[data-reference-generate-menu]');
      const surface = menu.shadowRoot.querySelector('[part="surface"]');
      const rect = surface.getBoundingClientRect();
      return {
        visible:getComputedStyle(surface).display !== 'none' && rect.width > 0 && rect.height > 0,
        background:getComputedStyle(surface).backgroundColor,
      };
    })()`);
    if (!referenceGenerateDark.visible || referenceGenerateDark.background === referenceGenerate.background) {
      throw new Error(`Reference Generate Menu dark theme failed: ${JSON.stringify({ referenceGenerate, referenceGenerateDark })}`);
    }

    process.stdout.write(`${JSON.stringify({ checks: report.checks, confirmChecks: confirmReport.checks, motionChecks: motionReport.checks, motionObservations: motionReport.observations, cases, referenceGenerate, mentionMediaSearchable, referenceGenerateDark }, null, 2)}\n`);
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
