const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(filePath)] || 'application/octet-stream';
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
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-empty-state-category-'));
  const browser = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const port = server.address().port;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/ui-component-library.html#empty-states` }, sessionId);
    await waitFor(cdp, sessionId, `(() => {
      const emptyFrame=document.querySelector('[data-empty-states-matrix]');
      return Boolean(emptyFrame&&!emptyFrame.hidden&&emptyFrame.contentDocument?.documentElement?.dataset.emptyStatesStatus!=='loading');
    })()`, 'empty-state category result');
    const report = await evaluate(cdp, sessionId, `(() => {
      const emptyFrame=document.querySelector('[data-empty-states-matrix]');
      const feedbackFrame=document.querySelector('[data-feedback-progress-matrix]');
      const emptyDoc=emptyFrame.contentDocument;
      const feedbackDoc=feedbackFrame.contentDocument;
      const promptNode=emptyDoc.querySelector('[data-component-name="smart-canvas-far-prompt-skeleton"] .image-node');
      const promptHeight=Number.parseFloat(promptNode ? getComputedStyle(promptNode).height : '0');
      const promptExpectedLines=Math.min(24,Math.max(1,Math.floor((promptHeight-2-40+10)/19)));
      const emptyUploadNode=emptyDoc.querySelector('[data-component-name="smart-canvas-far-empty-upload"] .image-node');
      const emptyUploadMarker=emptyUploadNode?.querySelector('.far-node-marker');
      const boundaryState=componentName=>{
        const node=emptyDoc.querySelector('[data-component-name="'+componentName+'"] .image-node');
        const style=node?getComputedStyle(node):null;
        return {
          borderRadius:style?.borderRadius||'',
          borderStyle:style?.borderStyle||'',
          overflow:style?.overflow||'',
        };
      };
      return {
        category:document.body.dataset.activeReview,
        status:emptyDoc.documentElement.dataset.emptyStatesStatus,
        sampleCount:emptyDoc.querySelectorAll('[data-component-name]').length,
        emptyStateCount:emptyDoc.querySelectorAll('ic-empty-state').length,
        emptyStatesReady:[...emptyDoc.querySelectorAll('ic-empty-state')].every(item=>item.dataset.icContractStatus==='ready'),
        namedSample:Boolean(emptyDoc.querySelector('[data-component-name="ic-empty-state"]')),
        promptSkeletonLines:promptNode?.querySelectorAll('.far-prompt-skeleton-line').length??-1,
        promptExpectedLines,
        emptyUploadBackground:emptyUploadMarker?getComputedStyle(emptyUploadMarker).backgroundColor:'',
        emptyUploadNodeBackground:emptyUploadNode?getComputedStyle(emptyUploadNode).backgroundColor:'',
        audioBoundary:boundaryState('smart-canvas-far-audio-placeholder'),
        videoBoundary:boundaryState('smart-canvas-far-video-placeholder'),
        feedbackHidden:feedbackFrame.hidden,
        absentFromFeedback:feedbackDoc.querySelectorAll('ic-empty-state').length===0,
      };
    })()`);
    const passed = report.category === 'empty-states' && report.status === 'ready'
      && report.sampleCount === 7 && report.emptyStateCount === 2 && report.emptyStatesReady
      && report.promptSkeletonLines === report.promptExpectedLines && report.promptSkeletonLines >= 5
      && report.emptyUploadBackground === report.emptyUploadNodeBackground && report.emptyUploadBackground !== 'rgba(0, 0, 0, 0)'
      && report.audioBoundary.borderStyle !== 'none' && report.audioBoundary.borderRadius !== '0px' && report.audioBoundary.overflow === 'hidden'
      && report.videoBoundary.borderStyle !== 'none' && report.videoBoundary.borderRadius !== '0px' && report.videoBoundary.overflow === 'hidden'
      && report.namedSample && report.feedbackHidden && report.absentFromFeedback;
    console.log(JSON.stringify({ passed, report }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
