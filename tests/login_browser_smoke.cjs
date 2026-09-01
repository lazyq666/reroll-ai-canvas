const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const backendSource = fs.readFileSync(path.join(ROOT, 'backend/main.py'), 'utf8');
const loginRouteSource = backendSource.slice(
  backendSource.indexOf('@app.get("/login")'),
  backendSource.indexOf('@app.get("/share/{token}")'),
);
const LOGIN_CSP = loginRouteSource.match(/Content-Security-Policy"\] = "([^"]+)"/)?.[1];
if (!LOGIN_CSP) throw new Error('Unable to read the /login Content-Security-Policy');

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
    if (url.pathname === '/api/auth/me') return json(response, 200, { user: null });
    if (url.pathname === '/api/auth/registration') return json(response, 200, { enabled: true, remaining: 3 });
    if (url.pathname === '/api/auth/logout') { state.logouts += 1; return json(response, 200, { ok: true }); }
    if (url.pathname === '/api/auth/register') {
      const payload = await requestBody(request);
      state.registrations.push(payload);
      return json(response, 202, { application: { username: payload.username } });
    }
    if (url.pathname === '/api/auth/login') {
      const payload = await requestBody(request);
      state.logins.push(payload);
      if (payload.username === 'guest') return json(response, 200, { user: { username: 'guest', role: 'guest' } });
      if (payload.username === 'designer' && payload.password === 'designer-pass') {
        return json(response, 200, { user: { username: 'designer', role: 'designer' } });
      }
      return json(response, 401, { detail: '用户名或密码错误' });
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end('<!doctype html><p id="destination">Workspace</p>');
    }
    const requestPath = url.pathname === '/login' ? '/static/login.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, `.${requestPath}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' }[path.extname(file)] || 'application/octet-stream';
      const headers = { 'Content-Type': `${type}; charset=utf-8` };
      if (url.pathname === '/login') headers['Content-Security-Policy'] = LOGIN_CSP;
      response.writeHead(200, headers);
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

async function click(cdp, sessionId, selector) {
  const point = await evaluate(cdp, sessionId, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
}

async function waitFor(cdp, sessionId, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const state = { logins: [], registrations: [], logouts: 0 };
  const server = await startServer(state);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-login-browser-'));
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    const port = server.address().port;

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/login?token-review-theme=light` }, sessionId);
    await waitFor(cdp, sessionId, "customElements.get('ic-input') && !document.querySelector('#register-tab').hidden", 'login components');
    await evaluate(cdp, sessionId, `localStorage.setItem('infinite_canvas_remembered_login', JSON.stringify({
      username: 'remembered-user',
      password: 'remembered-pass',
    }))`);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/login?token-review-theme=light&remembered=1` }, sessionId);
    await waitFor(cdp, sessionId, "document.querySelector('#remember-password')?.checked === true", 'remembered password state');
    await waitFor(cdp, sessionId, `(() => {
      const icon = document.querySelector('#remember-password')?.shadowRoot?.querySelector('wa-icon[part~="check-icon"]');
      const svg = icon?.shadowRoot?.querySelector('svg');
      const shape = svg?.querySelector('path,polyline,line,circle,rect');
      return Boolean(shape && svg.getBoundingClientRect().width > 0 && svg.getBoundingClientRect().height > 0);
    })()`, 'remembered password check icon');
    const desktop = await evaluate(cdp, sessionId, `(() => {
      const card = document.querySelector('ic-card').getBoundingClientRect();
      const remember = document.querySelector('#remember-password');
      const rememberInput = remember.shadowRoot.querySelector('input[type="checkbox"]');
      const rememberControl = remember.shadowRoot.querySelector('[part="control"]');
      const rememberIcon = remember.shadowRoot.querySelector('wa-icon[part~="check-icon"]');
      const rememberSvg = rememberIcon.shadowRoot?.querySelector('svg');
      return {
        theme: document.documentElement.dataset.uiTheme,
        scaled: document.documentElement.classList.contains('studio-ui-scaled'),
        tags: ['ic-card','ic-segmented-control','ic-form-field','ic-input','ic-checkbox','ic-alert','ic-button'].every(tag => customElements.get(tag)),
        vendorTags: document.querySelectorAll('wa-button,wa-input,wa-checkbox').length,
        options: document.querySelectorAll('#auth-mode [role="radio"]').length,
        loginVisible: !document.querySelector('#login-form').hidden,
        registerHidden: document.querySelector('#register-form').hidden,
        card: { width: Math.round(card.width), height: Math.round(card.height) },
        rememberPassword: {
          checked: remember.checked,
          inputChecked: rememberInput.checked,
          iconSvg: Boolean(rememberSvg),
          iconShapeCount: rememberSvg?.querySelectorAll('path,polyline,line,circle,rect').length || 0,
          iconVisibility: getComputedStyle(rememberIcon).visibility,
          iconDisplay: getComputedStyle(rememberIcon).display,
          iconColor: getComputedStyle(rememberIcon).color,
          controlBackground: getComputedStyle(rememberControl).backgroundColor,
        },
      };
    })()`);

    await evaluate(cdp, sessionId, "document.querySelector('#register-tab').click()");
    await waitFor(cdp, sessionId, "!document.querySelector('#register-form').hidden", 'register mode');
    await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#register-username').value = 'new-designer';
      document.querySelector('#register-password').value = 'password-one';
      document.querySelector('#register-password-confirm').value = 'password-two';
    })()`);
    await click(cdp, sessionId, '#register-submit');
    await waitFor(cdp, sessionId, "!document.querySelector('#register-error').hidden", 'password mismatch');
    const mismatch = await evaluate(cdp, sessionId, "document.querySelector('#register-error').textContent");

    await evaluate(cdp, sessionId, "document.querySelector('#register-password-confirm').value = 'password-one'");
    await click(cdp, sessionId, '#register-submit');
    await waitFor(cdp, sessionId, "!document.querySelector('#register-success').hidden", 'registration success');
    const registration = await evaluate(cdp, sessionId, "document.querySelector('#register-success').textContent");

    await evaluate(cdp, sessionId, "document.querySelector('#login-tab').click()");
    await waitFor(cdp, sessionId, "!document.querySelector('#login-form').hidden", 'login mode');
    await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#username').value = 'wrong';
      document.querySelector('#password').value = 'wrong-pass';
    })()`);
    await click(cdp, sessionId, '#login-submit');
    await waitFor(cdp, sessionId, "!document.querySelector('#login-error').hidden", 'login failure');
    const failure = await evaluate(cdp, sessionId, "document.querySelector('#login-error').textContent");

    await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#username').value = 'guest';
      document.querySelector('#password').value = 'guest-pass';
    })()`);
    await click(cdp, sessionId, '#login-submit');
    await waitFor(cdp, sessionId, "document.querySelector('#login-error').textContent.includes('游客账号')", 'guest denial');
    const guestDenied = await evaluate(cdp, sessionId, "document.querySelector('#login-error').textContent");

    const accessibilityTree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const roles = accessibilityTree.nodes.filter(node => !node.ignored).map(node => node.role?.value).filter(Boolean);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/login?token-review-theme=dark` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.uiTheme === 'dark' && customElements.get('ic-card')", 'dark narrow login');
    const narrow = await evaluate(cdp, sessionId, `(() => {
      const card = document.querySelector('ic-card').getBoundingClientRect();
      return {
        theme: document.documentElement.dataset.uiTheme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardWidth: Math.round(card.width),
        viewportWidth: document.documentElement.clientWidth,
      };
    })()`);

    await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#username').value = 'designer';
      document.querySelector('#password').value = 'designer-pass';
    })()`);
    await click(cdp, sessionId, '#login-submit');
    await waitFor(cdp, sessionId, "Boolean(document.querySelector('#destination'))", 'session destination');

    const consoleErrors = cdp.events.flatMap(event => (
      event.method === 'Runtime.exceptionThrown'
        ? [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text]
        : event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'
          ? [event.params.args?.map(argument => argument.value || argument.description).join(' ')]
          : []
    ));
    report = {
      checks: {
        publicComponents: desktop.tags && desktop.vendorTags === 0,
        modeSwitch: desktop.options === 2 && desktop.loginVisible && desktop.registerHidden,
        validation: mismatch.includes('不一致'),
        registration: registration.includes('new-designer') && state.registrations.length === 1,
        failureFeedback: failure === '用户名或密码错误',
        permissionBoundary: guestDenied.includes('游客账号') && state.logouts === 1,
        session: state.logins.some(item => item.username === 'designer'),
        accessibility: roles.includes('radiogroup') && roles.filter(role => role === 'textbox').length >= 2 && roles.includes('checkbox'),
        rememberPasswordIcon: desktop.rememberPassword.checked
          && desktop.rememberPassword.inputChecked
          && desktop.rememberPassword.iconSvg
          && desktop.rememberPassword.iconShapeCount > 0
          && desktop.rememberPassword.iconVisibility === 'visible'
          && desktop.rememberPassword.iconDisplay !== 'none'
          && desktop.rememberPassword.iconColor !== desktop.rememberPassword.controlBackground,
        lightDesktop: desktop.theme === 'light' && !desktop.scaled && desktop.card.width <= 480,
        darkNarrow: narrow.theme === 'dark' && !narrow.overflow && narrow.cardWidth <= narrow.viewportWidth,
        console: consoleErrors.length === 0,
      },
      desktop,
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

if (process.env.LOGIN_PREVIEW === '1') {
  const state = { logins: [], registrations: [], logouts: 0 };
  startServer(state, Number(process.env.LOGIN_PREVIEW_PORT || 8790))
    .then(server => process.stdout.write(`Login preview: http://127.0.0.1:${server.address().port}/login\n`))
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
