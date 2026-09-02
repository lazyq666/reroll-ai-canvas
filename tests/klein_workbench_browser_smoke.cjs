const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOVER_SCREENSHOT = process.env.KLEIN_HOVER_SCREENSHOT || '';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const combinations = [
  { name: 'desktop-light', theme: 'light', lang: 'en', width: 1440, height: 900 },
  { name: 'desktop-dark', theme: 'dark', lang: 'zh', width: 1440, height: 900 },
  { name: 'narrow-light', theme: 'light', lang: 'en', width: 390, height: 844 },
  { name: 'narrow-dark', theme: 'dark', lang: 'zh', width: 390, height: 844 },
];

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { resolve({}); }
    });
  });
}

function startServer(state) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
    if (url.pathname === '/api/history' && request.method === 'GET') {
      return json(response, 200, [
        {
          prompt: '玻璃材质的未来产品，柔和侧光', images: ['/static/images/brand/logo.png'], timestamp: 101,
          type: 'klein', model: 'black-forest-labs/FLUX.2-klein-9B',
          params: { '278': { image: 'history-main.png' }, '270': { image: '' }, '292': { image: '' } },
        },
        { prompt: '极简建筑与蓝色天空', images: ['/static/images/brand/logo.png'], timestamp: 102, type: 'klein' },
      ]);
    }
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      state.uploads += 1;
      request.resume();
      request.on('end', () => json(response, 200, { files: [{ filename: 'main.png', comfy_name: 'mock-main.png' }] }));
      return;
    }
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      const payload = await readJson(request);
      state.local.push(payload);
      return json(response, 200, {
        prompt: payload.prompt,
        images: ['/static/images/brand/logo.png'],
        timestamp: 201,
        type: 'klein',
        params: payload.params,
      });
    }
    if (url.pathname === '/api/ms/generate' && request.method === 'POST') {
      const payload = await readJson(request);
      state.cloud.push(payload);
      return json(response, 200, { url: '/static/images/brand/logo.png' });
    }
    if (url.pathname === '/api/history/delete' && request.method === 'POST') {
      const payload = await readJson(request);
      state.deletes.push(payload.timestamp);
      return json(response, 200, { success: true });
    }
    if (url.pathname === '/api/view') {
      const file = ROOT + '/static/images/brand/logo.png';
      return fs.readFile(file, (error, body) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(body);
      });
    }

    const requestPath = url.pathname === '/klein' ? '/static/klein.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, `.${requestPath}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      const type = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
        '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
      }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
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
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function navigate(cdp, sessionId, port, combination) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: combination.width, height: combination.height, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  const url = `http://127.0.0.1:${port}/klein`;
  await cdp.send('Page.navigate', { url }, sessionId);
  await waitFor(cdp, sessionId, "location.pathname === '/klein'", `${combination.name} origin`);
  await evaluate(cdp, sessionId, `localStorage.setItem('studio_theme', ${JSON.stringify(combination.theme)})`);
  await evaluate(cdp, sessionId, `localStorage.setItem('studio_lang', ${JSON.stringify(combination.lang)})`);
  await cdp.send('Page.navigate', { url }, sessionId);
  await waitFor(
    cdp,
    sessionId,
    "customElements.get('ic-image-frame') && document.querySelectorAll('.history-item').length === 2",
    `${combination.name} workbench`,
  );
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const state = { uploads: 0, local: [], cloud: [], deletes: [] };
  const server = await startServer(state);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-klein-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const evidence = [];
  let buttonHoverShape = null;
  let referenceImageFit = null;
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    const port = server.address().port;

    for (const combination of combinations) {
      await navigate(cdp, sessionId, port, combination);
      const layout = await evaluate(cdp, sessionId, `(() => {
        const workbench = document.querySelector('.klein-workbench');
        return {
          name: ${JSON.stringify(combination.name)},
          lang: ${JSON.stringify(combination.lang)},
          theme: document.documentElement.dataset.uiTheme || (document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'),
          language: document.documentElement.lang,
          columns: getComputedStyle(workbench).gridTemplateColumns.split(' ').length,
          gap: getComputedStyle(workbench).gap,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
          vendorTags: document.querySelectorAll('wa-button,wa-input,wa-switch,wa-slider').length,
          fileInputs: document.querySelectorAll('ic-file-input').length,
          imageFrames: document.querySelectorAll('ic-image-frame').length,
        };
      })()`);
      evidence.push(layout);

      if (combination.name !== 'desktop-light') continue;
      buttonHoverShape = await evaluate(cdp, sessionId, `(() => {
        const host = document.querySelector('#genBtn');
        const base = host.shadowRoot.querySelector('[part~="base"]');
        const hostRect = host.getBoundingClientRect();
        const baseRect = base.getBoundingClientRect();
        const style = getComputedStyle(base);
        return {
          point: { x: baseRect.left + baseRect.width / 2, y: baseRect.top + baseRect.height / 2 },
          host: { width: hostRect.width, height: hostRect.height },
          base: { width: baseRect.width, height: baseRect.height },
          radius: style.borderRadius,
          cornerRadii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
          formControlRadius: style.getPropertyValue('--wa-form-control-border-radius').trim(),
        };
      })()`);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: buttonHoverShape.point.x, y: buttonHoverShape.point.y,
      }, sessionId);
      await delay(250);
      buttonHoverShape.hoverBackground = await evaluate(
        cdp,
        sessionId,
        "getComputedStyle(document.querySelector('#genBtn').shadowRoot.querySelector('[part~=\"base\"]')).backgroundColor",
      );
      delete buttonHoverShape.point;
      if (HOVER_SCREENSHOT) {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(HOVER_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
      }
      await evaluate(cdp, sessionId, `(async () => {
        const uploadSvg = (selector, name, width, height, color) => {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="' + color + '"/></svg>';
          const transfer = new DataTransfer();
          transfer.items.add(new File([svg], name, { type: 'image/svg+xml' }));
          document.querySelector(selector).acceptFiles(transfer.files, { source: 'smoke' });
        };
        uploadSvg('#file1', 'landscape-3x2.svg', 300, 200, '#2563eb');
        uploadSvg('#file3', 'portrait-2x3.svg', 200, 300, '#7c3aed');
      })()`);
      await waitFor(cdp, sessionId, "['slotFrame1', 'slotFrame3'].every(id => document.querySelector('#' + id).getAttribute('state') === 'normal')", 'landscape and portrait image uploads');
      referenceImageFit = await evaluate(cdp, sessionId, `(() => {
        const inspect = id => {
          const host = document.querySelector('#' + id);
          const image = host.shadowRoot.querySelector('img');
          return {
            objectFit: getComputedStyle(image).objectFit,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            fitAttribute: host.getAttribute('fit'),
          };
        };
        return { landscape: inspect('slotFrame1'), portrait: inspect('slotFrame3') };
      })()`);

      await evaluate(cdp, sessionId, `(() => {
        document.querySelector('#promptInput').value = '电影感产品摄影';
        document.querySelector('#genBtn').click();
      })()`);
      await waitFor(cdp, sessionId, "!document.querySelector('#resultMedia').hidden", 'local generation result');

      await evaluate(cdp, sessionId, "document.querySelector('#previewResultBtn').click()");
      await waitFor(cdp, sessionId, "document.querySelector('#lightbox').open", 'result dialog');
      await evaluate(cdp, sessionId, "document.querySelector('#lightbox').hide('smoke')");

      await evaluate(cdp, sessionId, "document.querySelector('#engineSwitch [data-value=\"cloud\"]').click()");
      await waitFor(cdp, sessionId, "!document.querySelector('#loraSection').hidden", 'cloud controls');
      await evaluate(cdp, sessionId, "document.querySelector('#loraSwitch').click()");
      await waitFor(cdp, sessionId, "document.querySelector('#loraSwitch').checked && !document.querySelector('#loraStrengthRow').hidden", 'LoRA enabled');
      await evaluate(cdp, sessionId, `(() => {
        document.querySelector('#loraStrengthSlider').value = 0.9;
        document.querySelector('#loraStrengthSlider').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#genBtn').click();
      })()`);
      await waitFor(cdp, sessionId, "document.querySelectorAll('.history-item').length === 4", 'cloud generation result');

      await evaluate(cdp, sessionId, "document.querySelector('#manageHistoryBtn').click()");
      await waitFor(cdp, sessionId, "!document.querySelector('#selectAllHistoryBtn').hidden", 'history management mode');
      await evaluate(cdp, sessionId, "document.querySelector('#selectAllHistoryBtn').click()");
      await waitFor(cdp, sessionId, "document.querySelector('#historySelectionCount').textContent.includes('4') && !document.querySelector('#deleteHistoryBtn').disabled", 'history selection');
      await evaluate(cdp, sessionId, "document.querySelector('#deleteHistoryBtn').click()");
      await waitFor(cdp, sessionId, "document.querySelector('#deleteHistoryDialog').open", 'bulk delete confirmation');
      await evaluate(cdp, sessionId, "document.querySelector('#deleteHistoryDialog').confirm()");
      await waitFor(cdp, sessionId, "document.querySelectorAll('.history-item').length === 0", 'bulk deletion');
    }

    const consoleErrors = cdp.events.flatMap(event => (
      event.method === 'Runtime.exceptionThrown'
        ? [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text]
        : event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'
          ? [event.params.args?.map(argument => argument.value || argument.description).join(' ')]
          : []
    ));
    const invalidLayouts = evidence.filter(item => (
      item.theme !== (item.name.endsWith('dark') ? 'dark' : 'light')
      || item.language !== (item.lang === 'en' ? 'en' : 'zh-CN')
      || item.overflow > 0
      || item.invalidContracts !== 0
      || item.vendorTags !== 0
      || item.fileInputs !== 3
      || item.imageFrames !== 3
      || (item.name.startsWith('desktop') ? item.columns !== 2 || item.gap !== '16px' : item.columns !== 1)
    ));
    const checks = {
      visualCombinations: evidence.length === 4 && invalidLayouts.length === 0,
      upload: state.uploads === 2,
      referenceAspectFit: (
        referenceImageFit?.landscape.objectFit === 'contain'
        && referenceImageFit?.portrait.objectFit === 'contain'
        && referenceImageFit?.landscape.naturalWidth / referenceImageFit?.landscape.naturalHeight === 1.5
        && referenceImageFit?.portrait.naturalWidth / referenceImageFit?.portrait.naturalHeight === 2 / 3
        && referenceImageFit?.landscape.fitAttribute === null
        && referenceImageFit?.portrait.fitAttribute === null
      ),
      localGeneration: state.local.length === 1 && state.local[0].workflow_json === 'Flux2-Klein.json',
      cloudGeneration: state.cloud.length === 1 && state.cloud[0].loras?.['Daniel8152/Klein-enhance'] === 0.9,
      resultOperations: state.local[0]?.params?.['278']?.image === 'mock-main.png',
      historyManagement: state.deletes.length === 4,
      buttonShape: (
        buttonHoverShape?.host.width === buttonHoverShape?.base.width
        && buttonHoverShape?.host.height === buttonHoverShape?.base.height
        && buttonHoverShape?.formControlRadius === '999px'
        && buttonHoverShape?.cornerRadii.every(radius => radius === '999px')
      ),
      console: consoleErrors.length === 0,
    };
    const requests = {
      uploads: state.uploads,
      localGenerationCount: state.local.length,
      cloudGenerationCount: state.cloud.length,
      cloudHasLora: Boolean(state.cloud[0]?.loras?.['Daniel8152/Klein-enhance']),
      historyDeleteCount: state.deletes.length,
    };
    process.stdout.write(`${JSON.stringify({ ok: Object.values(checks).every(Boolean), checks, evidence, referenceImageFit, buttonHoverShape, requests, consoleErrors }, null, 2)}\n`);
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
}

if (process.env.KLEIN_PREVIEW === '1') {
  const state = { uploads: 0, local: [], cloud: [], deletes: [] };
  startServer(state)
    .then(server => process.stdout.write(`Klein preview: http://127.0.0.1:${server.address().port}/klein\n`))
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
