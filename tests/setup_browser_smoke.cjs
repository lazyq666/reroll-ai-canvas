const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function requestBody(request) {
  return new Promise(resolve => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => resolve(body ? JSON.parse(body) : {}));
  });
}

function startServer(state, port = 0) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/setup/status') {
      return json(response, 200, {
        required: state.required,
        configured_workspace_directory: '/workspace/suggested',
        workspace_error: '',
      });
    }
    if (url.pathname === '/api/setup/select-directory') {
      state.pickerRequests += 1;
      return json(response, 200, { workspace_directory: '/workspace/picked' });
    }
    if (url.pathname === '/api/setup/inspect-workspace') {
      const payload = await requestBody(request);
      state.inspections.push(payload);
      if (payload.workspace_directory === '/workspace/error') {
        return json(response, 400, {
          detail: '工作区目录不可用',
          reason: 'workspace_inspection_failed',
        });
      }
      if (payload.workspace_directory === '/workspace/existing') {
        return json(response, 200, {
          workspace_directory: payload.workspace_directory,
          next_step: 'login',
          message: '已找到现有工作区',
          message_code: 'setup_workspace_existing_accounts',
        });
      }
      return json(response, 200, {
        workspace_directory: payload.workspace_directory,
        next_step: 'create_admin',
        message: '可以创建管理员',
        message_code: 'setup_workspace_empty',
      });
    }
    if (url.pathname === '/api/setup/open-workspace') {
      const payload = await requestBody(request);
      state.opens.push(payload);
      return json(response, 200, { workspace_directory: payload.workspace_directory });
    }
    if (url.pathname === '/api/setup') {
      const payload = await requestBody(request);
      state.setups.push(payload);
      if (payload.username === 'broken') return json(response, 400, {
        detail: '管理员创建失败',
        reason: 'workspace_setup_failed',
      });
      state.required = false;
      return json(response, 200, { user: { username: payload.username, role: 'admin' } });
    }
    if (url.pathname === '/api/runtime/restart') {
      state.restarts += 1;
      return json(response, 200, { ok: true });
    }
    if (url.pathname === '/startup') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end('<!doctype html><p id="startup-destination">Startup</p>');
    }
    if (url.pathname === '/login') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end('<!doctype html><p id="login-destination">Login</p>');
    }
    const requestPath = url.pathname === '/setup' ? '/static/setup.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, `.${requestPath}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      const type = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf',
      }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'Chrome debugger timeout')), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
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
      payload.error ? operation.reject(new Error(JSON.stringify(payload.error))) : operation.resolve(payload.result);
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function click(cdp, sessionId, selector) {
  const point = await evaluate(cdp, sessionId, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
}

async function setValue(cdp, sessionId, selector, value) {
  await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`);
}

async function navigateSetup(cdp, sessionId, port, theme) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/setup?token-review-theme=${theme}` }, sessionId);
  await waitFor(
    cdp,
    sessionId,
    `customElements.get('ic-input') && document.querySelector('#workspace-directory').value === '/workspace/suggested'`,
    `${theme} setup components`,
  );
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const state = { required: true, pickerRequests: 0, inspections: [], opens: [], setups: [], restarts: 0 };
  const server = await startServer(state);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-setup-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let report;
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Accessibility.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false }, sessionId);
    const port = server.address().port;

    await navigateSetup(cdp, sessionId, port, 'light');
    const desktop = await evaluate(cdp, sessionId, `(() => {
      const card = document.querySelector('ic-card').getBoundingClientRect();
      const directoryInput = document.querySelector('#workspace-directory').getBoundingClientRect();
      const chooseButton = document.querySelector('#choose-workspace-directory');
      const chooseBounds = chooseButton.getBoundingClientRect();
      const chooseBase = chooseButton.shadowRoot?.querySelector('[part~="base"]');
      return {
        theme: document.documentElement.dataset.uiTheme,
        scaled: document.documentElement.classList.contains('studio-ui-scaled'),
        tags: ['ic-card','ic-form-field','ic-input','ic-alert','ic-button'].every(tag => customElements.get(tag)),
        vendorTags: document.querySelectorAll('wa-button,wa-input').length,
        nativeControls: document.querySelectorAll('input,button').length,
        selectionVisible: !document.querySelector('#workspace-selection-step').hidden,
        formHidden: document.querySelector('#initial-setup-form').hidden,
        card: { width: Math.round(card.width), height: Math.round(card.height) },
        directoryPicker: {
          centerOffset: Math.abs((directoryInput.top + directoryInput.height / 2) - (chooseBounds.top + chooseBounds.height / 2)),
          width: Math.round(chooseBounds.width),
          textUnclipped: Boolean(chooseBase && chooseBase.scrollWidth <= chooseBase.clientWidth),
        },
      };
    })()`);
    const accessibilityTree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const roles = accessibilityTree.nodes.filter(node => !node.ignored).map(node => node.role?.value).filter(Boolean);

    await setValue(cdp, sessionId, '#workspace-directory', '');
    await click(cdp, sessionId, '#inspect-workspace');
    await waitFor(cdp, sessionId, "!document.querySelector('#directory-error').hidden", 'empty directory validation');
    const emptyValidation = await evaluate(cdp, sessionId, "document.querySelector('#directory-error').textContent");

    await click(cdp, sessionId, '#choose-workspace-directory');
    await waitFor(cdp, sessionId, "document.querySelector('#workspace-directory').value === '/workspace/picked'", 'directory picker');

    await setValue(cdp, sessionId, '#workspace-directory', '/workspace/error');
    await click(cdp, sessionId, '#inspect-workspace');
    await waitFor(cdp, sessionId, "document.querySelector('#directory-error').textContent.includes('不可用')", 'inspection failure');

    await setValue(cdp, sessionId, '#workspace-directory', '/workspace/existing');
    await click(cdp, sessionId, '#inspect-workspace');
    await waitFor(cdp, sessionId, "!document.querySelector('#existing-workspace-actions').hidden", 'existing workspace action');
    const existing = await evaluate(cdp, sessionId, `({
      message: document.querySelector('#workspace-inspection-result').textContent,
      selectionVisible: !document.querySelector('#workspace-selection-step').hidden,
    })`);
    await click(cdp, sessionId, '#open-existing-workspace');
    await waitFor(cdp, sessionId, "Boolean(document.querySelector('#startup-destination'))", 'existing workspace startup');

    await navigateSetup(cdp, sessionId, port, 'light');
    await setValue(cdp, sessionId, '#workspace-directory', '/workspace/new');
    await click(cdp, sessionId, '#inspect-workspace');
    await waitFor(cdp, sessionId, "!document.querySelector('#initial-setup-form').hidden", 'create admin step');
    const adminStep = await evaluate(cdp, sessionId, `({
      title: document.querySelector('#setup-title').textContent,
      selectionHidden: document.querySelector('#workspace-selection-step').hidden,
      workspace: document.querySelector('#selected-workspace').textContent,
    })`);

    await setValue(cdp, sessionId, '#setup-username', 'broken');
    await setValue(cdp, sessionId, '#setup-password', 'password-one');
    await setValue(cdp, sessionId, '#setup-password-confirm', 'password-two');
    await click(cdp, sessionId, '#complete-initial-setup');
    await waitFor(cdp, sessionId, "!document.querySelector('#setup-error').hidden", 'password mismatch');
    const mismatch = await evaluate(cdp, sessionId, "document.querySelector('#setup-error').textContent");

    await setValue(cdp, sessionId, '#setup-password-confirm', 'password-one');
    await click(cdp, sessionId, '#complete-initial-setup');
    await waitFor(cdp, sessionId, "document.querySelector('#setup-error').textContent.includes('管理员创建失败')", 'setup failure');

    await evaluate(cdp, sessionId, "window.StudioI18n.set('en')");
    await click(cdp, sessionId, '#workspace-back');
    await setValue(cdp, sessionId, '#workspace-directory', '/workspace/error');
    await click(cdp, sessionId, '#inspect-workspace');
    await waitFor(cdp, sessionId, "document.querySelector('#directory-error').textContent.includes('Workspace inspection failed')", 'localized English setup failure');
    const englishFailure = await evaluate(cdp, sessionId, "document.querySelector('#directory-error').textContent");
    await evaluate(cdp, sessionId, "window.StudioI18n.set('zh')");

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }, sessionId);
    await navigateSetup(cdp, sessionId, port, 'dark');
    await setValue(cdp, sessionId, '#workspace-directory', '/workspace/new');
    await click(cdp, sessionId, '#inspect-workspace');
    await waitFor(cdp, sessionId, "!document.querySelector('#initial-setup-form').hidden", 'dark narrow admin step');
    const narrow = await evaluate(cdp, sessionId, `(() => {
      const card = document.querySelector('ic-card').getBoundingClientRect();
      return {
        theme: document.documentElement.dataset.uiTheme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardWidth: Math.round(card.width),
        viewportWidth: document.documentElement.clientWidth,
      };
    })()`);

    await setValue(cdp, sessionId, '#setup-username', 'admin');
    await setValue(cdp, sessionId, '#setup-password', 'password-one');
    await setValue(cdp, sessionId, '#setup-password-confirm', 'password-one');
    await click(cdp, sessionId, '#complete-initial-setup');
    await waitFor(cdp, sessionId, "Boolean(document.querySelector('#startup-destination'))", 'successful initial setup');

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/setup` }, sessionId);
    await waitFor(cdp, sessionId, "Boolean(document.querySelector('#login-destination'))", 'setup no longer required');

    const consoleErrors = cdp.events.flatMap(event => (
      event.method === 'Runtime.exceptionThrown'
        ? [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text]
        : event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'
          ? [event.params.args?.map(argument => argument.value || argument.description).join(' ')]
          : []
    ));
    report = {
      checks: {
        publicComponents: desktop.tags && desktop.vendorTags === 0 && desktop.nativeControls === 0,
        initialOrder: desktop.selectionVisible && desktop.formHidden,
        emptyValidation: Boolean(emptyValidation),
        picker: state.pickerRequests === 1,
        inspectFailure: state.inspections.some(item => item.workspace_directory === '/workspace/error'),
        existingOpen: existing.selectionVisible && existing.message.includes('现有工作区') && state.opens.length === 1,
        createAdmin: adminStep.selectionHidden && adminStep.workspace.includes('/workspace/new'),
        mismatch: mismatch.includes('不一致'),
        setupFailure: state.setups.some(item => item.username === 'broken'),
        englishFailure: englishFailure.includes('Workspace inspection failed') && !/[\u3400-\u9fff]/u.test(englishFailure),
        setupSuccess: state.setups.some(item => item.username === 'admin' && item.display_name === '') && state.restarts === 1,
        permissionBoundary: state.required === false,
        accessibility: roles.includes('textbox') && roles.filter(role => role === 'button').length >= 2,
        lightDesktop: desktop.theme === 'light' && !desktop.scaled && desktop.card.width <= 608,
        directoryPicker: desktop.directoryPicker.centerOffset < 1 && desktop.directoryPicker.width >= 96 && desktop.directoryPicker.textUnclipped,
        darkNarrow: narrow.theme === 'dark' && !narrow.overflow && narrow.cardWidth <= narrow.viewportWidth,
        console: consoleErrors.length === 0,
      },
      desktop,
      adminStep,
      narrow,
      requests: state,
      consoleErrors,
      browser: await cdp.send('Browser.getVersion'),
    };
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
}

if (process.env.SETUP_PREVIEW === '1') {
  const state = { required: true, pickerRequests: 0, inspections: [], opens: [], setups: [], restarts: 0 };
  startServer(state, Number(process.env.SETUP_PREVIEW_PORT || 8791))
    .then(server => process.stdout.write(`Setup preview: http://127.0.0.1:${server.address().port}/setup\n`))
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
