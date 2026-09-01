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
      response.writeHead(200, { 'Content-Type':`${type}; charset=utf-8` });
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

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-text-entry-fade-actions-'));
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
      if (await evaluate(cdp, sessionId, `document.querySelectorAll('.ic-component-name-tag').length >= 21`)) break;
      await delay(100);
    }

    const report = await evaluate(cdp, sessionId, `(async () => {
      const overflowValue = 'A deliberately long value that exceeds the visible text field width and exercises both inline fade edges.';
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const fadeState = async (name, value, position) => {
        const control = document.querySelector('ic-input[name="' + name + '"]');
        const input = control.shadowRoot.querySelector('[part~="input"]');
        control.value = value;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles:true, composed:true }));
        await settle();
        const maxScrollLeft = Math.max(0, input.scrollWidth - input.clientWidth);
        input.scrollLeft = position === 'start'
          ? 0
          : position === 'middle'
            ? maxScrollLeft / 2
            : maxScrollLeft;
        input.dispatchEvent(new Event('scroll'));
        await settle();
        const style = getComputedStyle(input);
        return {
          name,
          value,
          position,
          clientWidth:input.clientWidth,
          scrollWidth:input.scrollWidth,
          scrollLeft:input.scrollLeft,
          fadeStart:control.hasAttribute('data-inline-fade-start'),
          fadeEnd:control.hasAttribute('data-inline-fade-end'),
          maskImage:style.maskImage || style.webkitMaskImage,
        };
      };
      const metric = name => {
        const control = document.querySelector('ic-input[name="' + name + '"]');
        const base = getComputedStyle(control.shadowRoot.querySelector('[part~="base"]'));
        const input = getComputedStyle(control.shadowRoot.querySelector('[part~="input"]'));
        return {
          name,
          paddingLeft:base.paddingLeft,
          paddingRight:base.paddingRight,
          maskImage:input.maskImage || input.webkitMaskImage,
        };
      };
      const actionMargin = (name, index = 0) => {
        const actions = document.querySelectorAll('ic-input[name="' + name + '"] > [slot="end"]');
        return getComputedStyle(actions[index]).marginInlineStart;
      };
      return {
        sizes:['text-s', 'text-m', 'text-l'].map(metric),
        fadeStates:{
          short:await fadeState('text-m', 'Short', 'start'),
          start:await fadeState('text-m', overflowValue, 'start'),
          middle:await fadeState('text-m', overflowValue, 'middle'),
          end:await fadeState('text-m', overflowValue, 'end'),
        },
        coveredStarts:await Promise.all(
          ['search-m', 'password', 'icon-end-action', 'text-end-action', 'dual-end-action']
            .map(name => fadeState(name, overflowValue, 'start'))
        ),
        actionMargins:{
          icon:actionMargin('icon-end-action'),
          text:actionMargin('text-end-action'),
          dualFirst:actionMargin('dual-end-action'),
          dualSecond:actionMargin('dual-end-action', 1),
        },
      };
    })()`);

    const expectedPaddings = [
      { left:'8px', right:'4px' },
      { left:'8px', right:'8px' },
      { left:'12px', right:'12px' },
    ];
    const actualPaddings = report.sizes.map(item => ({ left:item.paddingLeft, right:item.paddingRight }));
    if (JSON.stringify(actualPaddings) !== JSON.stringify(expectedPaddings)) {
      throw new Error(`Text input inline padding should compensate for the 4px fade: ${JSON.stringify(report.sizes)}`);
    }
    const { short, start, middle, end } = report.fadeStates;
    if (short.fadeStart || short.fadeEnd || short.maskImage !== 'none') {
      throw new Error(`Short, unclipped text must not show a fade: ${JSON.stringify(short)}`);
    }
    if (start.fadeStart || !start.fadeEnd || start.maskImage === 'none') {
      throw new Error(`Overflow at the beginning must fade only the clipped right edge: ${JSON.stringify(start)}`);
    }
    if (!middle.fadeStart || !middle.fadeEnd || middle.maskImage === 'none') {
      throw new Error(`Overflow in the middle must fade both clipped edges: ${JSON.stringify(middle)}`);
    }
    if (!end.fadeStart || end.fadeEnd || end.maskImage === 'none') {
      throw new Error(`Overflow at the end must fade only the clipped left edge: ${JSON.stringify(end)}`);
    }
    const uncoveredInputs = report.coveredStarts.filter(item => item.fadeStart || !item.fadeEnd || item.maskImage === 'none');
    if (uncoveredInputs.length) {
      throw new Error(`Search, password, and end-action inputs must use the same overflow-aware fade: ${JSON.stringify(uncoveredInputs)}`);
    }
    const expectedActionMargins = { icon:'0px', text:'0px', dualFirst:'0px', dualSecond:'4px' };
    if (JSON.stringify(report.actionMargins) !== JSON.stringify(expectedActionMargins)) {
      throw new Error(`End actions should remove the leading gap and preserve only the 4px dual-action gap: ${JSON.stringify(report.actionMargins)}`);
    }
    console.log(JSON.stringify(report, null, 2));
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
