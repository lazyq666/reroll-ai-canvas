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
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-badge-issue-164-'));
  const browser = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const port = server.address().port;
    const reports = [];
    for (const query of ['theme=light&viewport=desktop&locale=zh-CN', 'theme=dark&viewport=narrow&locale=en', 'theme=dark&viewport=narrow&locale=zh-CN&motion=reduced']) {
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/design-system/infinite-canvas-ui/feedback-progress-case.html?${query}` }, sessionId);
      await waitFor(cdp, sessionId, "document.documentElement.dataset.feedbackProgressCaseStatus === 'ready'", query);
      reports.push(await evaluate(cdp, sessionId, `(async()=>{
        const tokenProbe=document.createElement('span');
        tokenProbe.style.cssText='position:absolute;background:var(--ui-color-surface);border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);font-weight:var(--ui-font-weight-regular)';
        document.body.append(tokenProbe);
        const tokenStyle=getComputedStyle(tokenProbe);
        const labelTokens={backgroundColor:tokenStyle.backgroundColor,borderColor:tokenStyle.borderTopColor,borderWidth:tokenStyle.borderTopWidth,fontWeight:tokenStyle.fontWeight};
        const sizes=['small','medium','large'].map(size=>{
          const badge=document.querySelector('[data-component-name="ic-badge-label'+(size==='medium'?'':'-'+size)+'"]');
          const surface=badge.shadowRoot.querySelector('.badge');
          const style=getComputedStyle(surface);
          return {size,height:Math.round(surface.getBoundingClientRect().height),fontSize:style.fontSize,fontWeight:style.fontWeight,backgroundColor:style.backgroundColor,borderColor:style.borderTopColor,borderWidth:style.borderTopWidth,ready:badge.dataset.icContractStatus==='ready'};
        });
        const statusSection=document.querySelector('[data-copy="badge-statuses"]').closest('section');
        const statuses=[...statusSection.querySelectorAll('ic-badge')];
        const probe=document.createElement('div');
        for(const kind of ['label','count','status']) for(const size of ['small','medium','large']){
          const badge=document.createElement('ic-badge');badge.dataset.probe=kind+'-'+size;badge.setAttribute('kind',kind);badge.setAttribute('size',size);if(kind==='status'){badge.setAttribute('tone','info');badge.setAttribute('loading','');}badge.textContent=kind==='count'?'12':'Probe';probe.append(badge);
        }
        document.body.append(probe);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const statusSizes=['small','medium','large'].map(size=>{
          const badge=probe.querySelector('[data-probe="status-'+size+'"]');
          const style=getComputedStyle(badge.shadowRoot.querySelector('.badge'));
          return {size,fontSize:style.fontSize,fontWeight:style.fontWeight};
        });
        const badgeSpinnerStyle=getComputedStyle(statuses[0].shadowRoot.querySelector('.spinner'));
        const processingSpinner={name:badgeSpinnerStyle.animationName,duration:badgeSpinnerStyle.animationDuration,transparentInlineEnd:badgeSpinnerStyle.borderInlineEndColor==='rgba(0, 0, 0, 0)'};
        return {lang:document.documentElement.lang,motion:document.documentElement.dataset.uiMotion,labelTokens,sizes,statusSizes,statusNames:statuses.map(badge=>badge.dataset.componentName),statusText:statuses.map(badge=>badge.textContent.trim()),processingSpinner,idleAbsent:![...document.querySelectorAll('ic-badge')].some(badge=>['空闲','Idle'].includes(badge.textContent.trim())),allKindSizesReady:[...probe.querySelectorAll('ic-badge')].every(badge=>badge.dataset.icContractStatus==='ready'&&(badge.getAttribute('kind')==='status'?badge.getAttribute('role')==='status':!badge.hasAttribute('role'))),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      })()`));
    }
    const passed = reports.every(report => JSON.stringify(report.sizes.map(item => item.height)) === JSON.stringify([16, 20, 24])
      && JSON.stringify(report.sizes.map(item => item.fontSize)) === JSON.stringify(['10px', '12px', '14px'])
      && report.sizes.every(item => item.fontWeight === report.labelTokens.fontWeight
        && item.backgroundColor === report.labelTokens.backgroundColor
        && item.borderColor === report.labelTokens.borderColor
        && item.borderWidth === report.labelTokens.borderWidth)
      && report.sizes.every(item => item.ready)
      && JSON.stringify(report.statusSizes.map(item => item.fontSize)) === JSON.stringify(['10px', '12px', '14px'])
      && report.statusSizes.every(item => item.fontWeight === report.labelTokens.fontWeight)
      && report.statusNames.join(',') === 'ic-badge-status-processing,ic-badge-status-success,ic-badge-status-warning,ic-badge-status-danger'
      && report.processingSpinner.transparentInlineEnd
      && (report.motion === 'reduced'
        ? report.processingSpinner.name === 'none' && report.processingSpinner.duration === '0s'
        : report.processingSpinner.name === 'ic-badge-spin' && report.processingSpinner.duration === '1.2s')
      && report.idleAbsent && report.allKindSizesReady && !report.overflow)
      && reports.find(report => report.lang === 'en')?.statusText.join(',') === 'Processing,Completed,Needs attention,Failed';
    console.log(JSON.stringify({ passed, reports }, null, 2));
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
