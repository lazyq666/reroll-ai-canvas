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
    if (url.pathname === '/api/auth/me') return json(response,200,{user:{id:'fixture-admin',username:'designer',role:'admin'}});
    if (url.pathname === '/api/admin/onboarding') return json(response,200,{pending:!state.completed,services:state.services||{},workspace:{configured_workspace_directory:'/workspace/picked'}});
    if (url.pathname.startsWith('/api/admin/onboarding/cli/')) return json(response,200,{installed:url.pathname.endsWith('/jimeng'),logged_in:!!state.cliLogin,version_ok:true});
    if (url.pathname === '/api/jimeng/login/start') {state.cliLogin=true;return json(response,200,{running:true,text:'Fixture sign-in',qr_url:''});}
    if (url.pathname === '/api/jimeng/login/status') return json(response,200,{running:false,logged_in:!!state.cliLogin});
    if (url.pathname === '/api/admin/onboarding/connect') {
      const payload=await requestBody(request);
      const failed=payload.api_key==='fail';
      if(!failed){state.services||={};state.services[payload.service]={name:payload.name||payload.service,count:3};}
      response.writeHead(200,{'Content-Type':'application/x-ndjson'});
      for(const stage of ['saving','verifying',...(failed?[]:['fetching'])])response.write(JSON.stringify({stage})+'\n');
      return response.end(JSON.stringify(failed?{stage:'error',code:payload.service==='other'?'auto_failed':'connection_failed'}:{stage:'complete',provider_id:payload.service,count:3})+'\n');
    }
    if(url.pathname === '/api/admin/onboarding/complete') {
      if(!Object.keys(state.services||{}).length)return json(response,409,{detail:{code:'no_source'}});
      state.completed=true;return json(response,200,{next_url:'/static/canvas-list.html'});
    }
    if(url.pathname === '/static/canvas-list.html') {
      response.writeHead(200,{'Content-Type':'text/html'});return response.end('<p id="canvas-list-destination">Canvas list fixture</p>');
    }
    if (url.pathname === '/api/setup/select-directory') {
      state.pickerRequests += 1;
      return json(response, 200, { workspace_directory: '/workspace/picked' });
    }
    if (url.pathname === '/api/setup/prepare-directory') return json(response,200,await requestBody(request));
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
      return response.end('<!doctype html><script>location.replace("/setup")</script>');
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
    const target = document.querySelector(${JSON.stringify(selector)});
    target.scrollIntoView({block: "center"});
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
}

async function setValue(cdp, sessionId, selector, value) {
  await evaluate(cdp,sessionId,`(() => {
    const host=document.querySelector(${JSON.stringify(selector)});
    const input=host.shadowRoot.querySelector('input');
    input.value=${JSON.stringify(value)};
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
  })()`);
}

async function navigateSetup(cdp, sessionId, port, theme) {
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/setup?token-review-theme=${theme}`},sessionId);
  await waitFor(cdp,sessionId,"Boolean(document.querySelector('#setup-username')?.shadowRoot?.querySelector('input'))",'administrator first');
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
    const administratorFirst=await evaluate(cdp,sessionId,"!document.querySelector('#workspace-selection-step')");
    await setValue(cdp,sessionId,'#setup-username','designer');
    await setValue(cdp,sessionId,'#setup-password','fixture-password');
    await setValue(cdp,sessionId,'#setup-password-confirm','different-password');
    await click(cdp,sessionId,'#admin-next');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('ic-alert[open]'))",'password mismatch');
    await setValue(cdp,sessionId,'#setup-password-confirm','fixture-password');
    await click(cdp,sessionId,'#admin-next');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('#workspace-directory')?.shadowRoot)",'workspace');
    const inlinePicker=await evaluate(cdp,sessionId,"document.querySelector('#choose-workspace-directory').parentElement.id==='workspace-directory'");
    await setValue(cdp,sessionId,'#workspace-directory','/workspace/error');
    await click(cdp,sessionId,'#inspect-workspace');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('ic-alert[open]'))",'inspection failure');
    await click(cdp,sessionId,'#choose-workspace-directory');
    await waitFor(cdp,sessionId,"document.querySelector('#workspace-directory').value==='/workspace/picked'",'directory picker');
    await click(cdp,sessionId,'#inspect-workspace');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('#configure'))",'resume after restart');
    const noPreselection=await evaluate(cdp,sessionId,"document.querySelector('#configure').disabled");
    await click(cdp,sessionId,'[data-service="apimart"]');
    await click(cdp,sessionId,'[data-service="jimeng"]');
    await click(cdp,sessionId,'#configure');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('#api-key')?.shadowRoot)",'API key');
    await setValue(cdp,sessionId,'#api-key','fail');
    await click(cdp,sessionId,'#connect');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('ic-alert[open]'))",'key failure');
    const inputRetained=await evaluate(cdp,sessionId,"document.querySelector('#api-key').value==='fail'");
    await setValue(cdp,sessionId,'#api-key','fixture-key');
    await click(cdp,sessionId,'#connect');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('#login'))",'next CLI service');
    await click(cdp,sessionId,'#login');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('#start-creating'))",'CLI login and Ready');
    await evaluate(cdp,sessionId,"window.StudioI18n.set('en')");
    await waitFor(cdp,sessionId,"document.querySelector('#start-creating').textContent==='Start creating'",'English completion');
    await click(cdp,sessionId,'#setup-theme');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false},sessionId);
    const narrow=await evaluate(cdp,sessionId,"document.documentElement.scrollWidth<=document.documentElement.clientWidth");
    await click(cdp,sessionId,'#start-creating');
    await waitFor(cdp,sessionId,"Boolean(document.querySelector('#canvas-list-destination'))",'canvas list');
    const consoleErrors = cdp.events.flatMap(event => (
      event.method === 'Runtime.exceptionThrown'
        ? [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text]
        : event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'
          ? [event.params.args?.map(argument => argument.value || argument.description).join(' ')]
          : []
    ));
    report={checks:{administratorFirst,inlinePicker,noPreselection,inputRetained,narrow,
      inspectionBeforeSetup:state.inspections.length>=2&&state.setups.length===1,
      resumedAfterRestart:state.restarts===1,
      apiAndCliConnected:Object.keys(state.services).length===2,
      completed:state.completed,console:consoleErrors.length===0},consoleErrors};

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
