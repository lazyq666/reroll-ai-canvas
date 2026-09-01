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
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue:true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-search-icon-sizes-'));
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
    await cdp.send('Page.navigate', { url:`${origin}/static/design-system/infinite-canvas-ui/text-entry-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await evaluate(cdp, sessionId, `document.querySelectorAll('[data-component-name^="ic-form-field-search"] ic-icon[slot="start"]').length === 6`)) break;
      await delay(100);
    }

    const actual = await evaluate(cdp, sessionId, `['ic-form-field-search', 'ic-form-field-search-subtle'].flatMap(base => (
      ['s', '', 'l'].map(suffix => {
        const name = \`\${base}\${suffix ? \`-\${suffix}\` : ''}\`;
        const icon = document.querySelector(\`[data-component-name="\${name}"] ic-icon[slot="start"]\`);
        const rect = icon.getBoundingClientRect();
        return { name, width:Math.round(rect.width), height:Math.round(rect.height) };
      })
    ))`);
    const clearPresentation = await evaluate(cdp, sessionId, `(() => {
      const buttons = [...document.querySelectorAll('[data-component-name^="ic-form-field-search"] [data-search-clear]')];
      const background = button => getComputedStyle(button.shadowRoot.querySelector('[part~="base"]')).backgroundColor;
      const normal = buttons.map(button => ({
        component: button.closest('[data-component-name]').dataset.componentName,
        backgroundAttribute: button.getAttribute('background'),
        background: background(button),
      }));
      buttons.forEach(button => { button.dataset.previewState = 'hover'; });
      const hover = buttons.map(button => background(button));
      const probe = document.createElement('span');
      probe.style.background = 'var(--ui-color-action-tertiary)';
      document.body.append(probe);
      const expectedBackground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { normal, hover, expectedBackground };
    })()`);
    const expected = [
      { name:'ic-form-field-search-s', width:16, height:16 },
      { name:'ic-form-field-search', width:20, height:20 },
      { name:'ic-form-field-search-l', width:24, height:24 },
      { name:'ic-form-field-search-subtle-s', width:16, height:16 },
      { name:'ic-form-field-search-subtle', width:20, height:20 },
      { name:'ic-form-field-search-subtle-l', width:24, height:24 },
    ];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Search field leading icons should increase from Small to Medium to Large: ${JSON.stringify(actual)}`);
    }
    if (
      clearPresentation.normal.length !== 6
      || clearPresentation.normal.some(item => item.backgroundAttribute !== 'ghost')
      || clearPresentation.normal.some(item => item.background !== clearPresentation.expectedBackground)
      || clearPresentation.hover.some(background => background !== clearPresentation.expectedBackground)
    ) {
      throw new Error(`Search clear actions should use tertiary icon buttons without a Hover background: ${JSON.stringify(clearPresentation)}`);
    }
    const componentNames = await evaluate(cdp, sessionId, `[...document.querySelectorAll('[data-component-name]')].map(node => node.dataset.componentName)`);
    const expectedCompactNames = [
      'ic-form-field-text-s',
      'ic-form-field-text',
      'ic-form-field-text-l',
      'ic-form-field-text-subtle-s',
      'ic-form-field-text-subtle',
      'ic-form-field-text-subtle-l',
      'ic-form-field-search-s',
      'ic-form-field-search',
      'ic-form-field-search-l',
      'ic-form-field-search-subtle-s',
      'ic-form-field-search-subtle',
      'ic-form-field-search-subtle-l',
      'ic-form-field-password',
      'ic-form-field-text-end-icon',
      'ic-form-field-text-end-button',
      'ic-form-field-text-end-dual',
      'ic-form-field-textarea',
      'ic-form-field-textarea-fixed',
    ];
    const missingCompactNames = expectedCompactNames.filter(name => !componentNames.includes(name));
    const verboseNames = componentNames.filter(name => (
      /-(?:small|large)(?:-|$)/.test(name)
      || name.includes('-hint')
      || /-(?:icon|text|dual)-action(?:-|$)/.test(name)
      || /^ic-form-field-search(?:-subtle)?-end-icon(?:-|$)/.test(name)
      || name.includes('textarea-vertical')
      || name.includes('textarea-none')
    ));
    if (missingCompactNames.length || verboseNames.length) {
      throw new Error(`Text Entry names should use compact token-style dimensions: ${JSON.stringify({ missingCompactNames, verboseNames })}`);
    }
    console.log(JSON.stringify({ searchIconSizes:actual, clearPresentation, componentNames:expectedCompactNames }, null, 2));
  } finally {
    cdp?.socket.close();
    browser.kill('SIGTERM');
    server.close();
    if (browser.exitCode === null) {
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
    }
    fs.rmSync(profile, { recursive:true, force:true, maxRetries:3, retryDelay:100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
