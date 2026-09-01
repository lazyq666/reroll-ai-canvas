const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const MIME_TYPES = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      response.writeHead(200, { 'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(body);
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
      if (match) { clearTimeout(timer); resolve(match[1]); }
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
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-halftone-reference-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio:['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url:'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId:target.targetId, flatten:true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false }, sessionId);
    await cdp.send('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/static/ui-component-library.html` }, sessionId);
    await waitFor(cdp, sessionId, "customElements.get('ic-slider') && document.querySelector('[data-pending-halftone-reference]')", 'component library');
    await evaluate(cdp, sessionId, `document.querySelector('ic-nav-item[data-target-review="pending-halftone-reference"]').click()`);
    await waitFor(cdp, sessionId, `(() => {
      const frame = document.querySelector('[data-pending-halftone-reference]');
      return !frame.hidden && frame.contentDocument?.documentElement.dataset.pendingHalftoneReferenceStatus === 'ready';
    })()`, 'halftone reference');

    await evaluate(cdp, sessionId, `(() => {
      const frame = document.querySelector('[data-pending-halftone-reference]');
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const set = (selector, value) => {
        const control = doc.querySelector(selector);
        control.value = value;
        control.dispatchEvent(new win.InputEvent('input', { bubbles:true, composed:true }));
      };
      set('ic-slider[data-setting="speed"]', 3.2);
      set('ic-select[data-setting="count"]', '6');
      document.querySelector('[data-target-theme-toggle]').click();
      doc.documentElement.dataset.uiMotion = 'reduced';
      return true;
    })()`);
    await waitFor(cdp, sessionId, `document.querySelector('[data-pending-halftone-reference]').contentDocument.querySelector('.pending-halftone-node')?.dataset.motionState === 'paused'`, 'reduced motion pause');

    const report = await evaluate(cdp, sessionId, `(() => {
      const frame = document.querySelector('[data-pending-halftone-reference]');
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const first = doc.querySelector('.pending-halftone-node');
      const bounds = first.getBoundingClientRect();
      const canvas = first.querySelector('canvas');
      return {
        activeReview:document.body.dataset.activeReview,
        title:document.querySelector('[data-target-review-title]').textContent.trim(),
        ready:doc.documentElement.dataset.pendingHalftoneReferenceStatus,
        controls:doc.querySelectorAll('[data-setting]').length,
        nodes:doc.querySelectorAll('.pending-halftone-node').length,
        canvases:doc.querySelectorAll('canvas.pending-halftone-canvas').length,
        canvasWidth:canvas.width,
        ratio:bounds.width / bounds.height,
        theme:doc.documentElement.dataset.uiTheme,
        motionState:first.dataset.motionState,
        query:new URL(win.location.href).searchParams.toString(),
        forbiddenUi:doc.querySelectorAll('.pending-progress, .pending-status').length,
      };
    })()`);
    if (report.activeReview !== 'pending-halftone-reference') throw new Error(JSON.stringify(report));
    if (report.title !== '动画实验 B' || report.ready !== 'ready') throw new Error(JSON.stringify(report));
    if (report.controls !== 7 || report.nodes !== 6 || report.canvases !== 6 || report.canvasWidth <= 0) throw new Error(JSON.stringify(report));
    if (Math.abs(report.ratio - (2 / 3)) > 0.02) throw new Error(JSON.stringify(report));
    if (report.theme !== 'dark' || report.motionState !== 'paused' || report.forbiddenUi !== 0) throw new Error(JSON.stringify(report));
    if (!report.query.includes('speed=3.2') || !report.query.includes('count=6')) throw new Error(JSON.stringify(report));
    await cdp.send('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/static/design-system/infinite-canvas-ui/feedback-progress-case.html?theme=light&motion=standard&locale=zh-CN&viewport=desktop` }, sessionId);
    await waitFor(cdp, sessionId, `document.documentElement.dataset.feedbackProgressCaseStatus === 'ready'`, 'production pending component');
    await waitFor(cdp, sessionId, `[...document.querySelectorAll('ic-generation-pending')].every(element => {
      const canvas = element.shadowRoot?.querySelector('canvas.generation-pending-halftone');
      return canvas?.width > 0 && canvas?.height > 0 && canvas.dataset.halftoneBackground;
    })`, 'production halftones to paint');
    const productionLight = await evaluate(cdp, sessionId, `(() => {
      const elements=[...document.querySelectorAll('ic-generation-pending')];
      const canvases=elements.map(element=>element.shadowRoot.querySelector('canvas.generation-pending-halftone'));
      const video=elements.find(element=>element.getAttribute('kind')==='video');
      const videoCanvas=video.shadowRoot.querySelector('canvas.generation-pending-halftone');
      video.setAttribute('state','generating');
      video.setAttribute('count','2');
      const continuous=video.shadowRoot.querySelector('canvas.generation-pending-halftone')===videoCanvas
        && video.shadowRoot.querySelectorAll('[part="cell"]').length===2;
      video.setAttribute('state','queued');
      video.setAttribute('count','1');
      return {
        kinds:elements.map(element=>element.getAttribute('kind')),
        ready:elements.every(element=>element.dataset.icContractStatus==='ready'&&element.getAttribute('role')==='status'&&element.getAttribute('aria-busy')==='true'),
        canvases:canvases.length,
        painted:canvases.every(canvas=>canvas.width>0&&canvas.height>0),
        colors:canvases.map(canvas=>[canvas.dataset.halftoneBackground,canvas.dataset.halftoneDot]),
        expectedColors:elements.map(element=>{
          const canvas=element.shadowRoot.querySelector('canvas.generation-pending-halftone');
          return [getComputedStyle(element.shadowRoot.querySelector('.pending')).backgroundColor,getComputedStyle(canvas).color];
        }),
        motion:canvases.map(canvas=>canvas.dataset.motionState),
        documentHidden:document.hidden,
        continuous,
        legacyLayers:elements.reduce((count,element)=>count+element.shadowRoot.querySelectorAll('img,video,.generation-pending-loader-visual').length,0),
      };
    })()`);
    await evaluate(cdp, sessionId, `(() => {
      document.documentElement.dataset.uiTheme='dark';
      document.documentElement.dataset.uiMotion='reduced';
    })()`);
    await waitFor(cdp, sessionId, `[...document.querySelectorAll('ic-generation-pending')].every(element => {
      const canvas=element.shadowRoot?.querySelector('canvas.generation-pending-halftone');
      return canvas?.dataset.motionState==='static'
        && canvas.dataset.halftoneBackground===getComputedStyle(element.shadowRoot.querySelector('.pending')).backgroundColor
        && canvas.dataset.halftoneDot===getComputedStyle(canvas).color;
    })`, 'production dark reduced-motion state');
    const productionDark = await evaluate(cdp, sessionId, `(() => [...document.querySelectorAll('ic-generation-pending')].map(element => {
      const canvas=element.shadowRoot.querySelector('canvas.generation-pending-halftone');
      return {
        background:canvas.dataset.halftoneBackground,
        dot:canvas.dataset.halftoneDot,
        expectedBackground:getComputedStyle(element.shadowRoot.querySelector('.pending')).backgroundColor,
        expectedDot:getComputedStyle(canvas).color,
        motion:canvas.dataset.motionState
      };
    }))()`);
    if (productionLight.kinds.join(',') !== 'image,video,text' || !productionLight.ready || productionLight.canvases !== 3 || !productionLight.painted || !productionLight.continuous || productionLight.legacyLayers !== 0) throw new Error(JSON.stringify(productionLight));
    if (!productionLight.colors.every((colors,index)=>colors[0]===productionLight.expectedColors[index][0]&&colors[1]===productionLight.expectedColors[index][1]) || !productionLight.motion.every(state=>['running','paused'].includes(state))) throw new Error(JSON.stringify(productionLight));
    if (!productionDark.every(value=>value.background===value.expectedBackground&&value.dot===value.expectedDot&&value.motion==='static')) throw new Error(JSON.stringify(productionDark));
    console.log(JSON.stringify({...report,productionLight,productionDark}));
  } finally {
    browser.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
