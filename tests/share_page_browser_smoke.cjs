const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const canvasFixture = {
  title: 'Moodboard Review',
  nodes: [
    { id: 'frame-1', type: 'smart-frame', title: 'Campaign direction', frameColor: 'violet', x: 40, y: 40, w: 760, h: 430, items: ['image-1', 'text-1'] },
    { id: 'image-1', type: 'smart-image', x: 100, y: 130, w: 300, h: 190, promptDraftText: 'frozen image composer prompt', images: [{ url: '/api/shares/visual-token/media/hero?name=cover.svg', name: 'cover.svg' }] },
    { id: 'text-1', type: 'smart-text', x: 450, y: 160, textSize: 'large', text: 'Quiet energy\nfor the launch' },
    { id: 'brush-1', type: 'smart-brush', x: 450, y: 290, w: 210, h: 80, color: '#f59e0b', brushSize: 7, points: [[5, 65], [55, 25], [115, 55], [200, 10]] },
    { id: 'prompt-1', type: 'smart-prompt', title: 'Campaign prompt', x: 0, y: 0, w: 300, h: 180, text: `shared prompt content ${'with production-length detail '.repeat(80)}` },
    { id: 'prompt-generation-1', type: 'smart-prompt', title: 'Prompt generator', x: 820, y: 80, w: 320, h: 200, llmEnabled: true, llmInstruction: 'expand the campaign prompt' },
    { id: 'group-empty', type: 'smart-group', title: 'Empty group', x: 820, y: 320, w: 320, h: 180, items: [] },
    {
      id: 'group-media', type: 'smart-group', title: 'Media group', x: 1160, y: 320, w: 320, h: 220,
      items: ['group-member-image'],
      images: [{ url: '/api/shares/visual-token/media/hero?name=group-cover.svg', name: 'group-cover.svg', groupMemberId: 'group-direct-media' }],
      memberOrderVersion: 1,
      memberOrder: [{ kind: 'media', id: 'group-direct-media' }, { kind: 'node', id: 'group-member-image' }],
    },
    { id: 'group-member-image', type: 'smart-image', x: 2600, y: 900, w: 420, h: 280, images: [{ url: '/api/shares/visual-token/media/hero?name=group-node-cover.svg', name: 'group-node-cover.svg' }] },
    { id: 'splitter-1', type: 'smart-splitter', title: 'Prompt splitter', x: 1160, y: 40, w: 300, h: 220, separator: ';', items: ['alpha', 'beta'] },
    { id: 'loop-1', type: 'smart-loop', title: 'Batch loop', x: 1500, y: 40, w: 360, h: 320, mode: 'parallel', count: 4, showPrompt: true, prompt: 'repeat this prompt' },
    { id: 'generation-1', type: 'smart-image', title: 'Reference generation', x: 1500, y: 400, w: 300, h: 190, referenceGenerationKind: 'image' },
    { id: 'upload-1', type: 'smart-image', title: 'Empty upload', x: 1840, y: 400, w: 300, h: 190 },
    { id: 'single-image-auto', type: 'smart-image', title: 'Auto single image', x: 1840, y: 40, referenceGenerationKind: 'image', images: [{ url: '/api/shares/visual-token/media/hero?name=portrait.svg', name: 'portrait.svg', natural_w: 340, natural_h: 512 }] },
    { id: 'multi-image-auto', type: 'smart-image', title: 'Auto media group', x: 2180, y: 40, images: [{ url: '/api/shares/visual-token/media/hero?name=square.svg', name: 'square.svg', natural_w: 1122, natural_h: 1088 }, { url: '/api/shares/visual-token/media/hero?name=wide.svg', name: 'wide.svg', natural_w: 1124, natural_h: 736 }] },
  ],
  connections: [{ from: 'image-1', to: 'text-1' }, { from: 'prompt-1', to: 'image-1' }, { from: 'prompt-1', to: 'prompt-generation-1' }, { from: 'group-member-image', to: 'text-1' }],
};

const largeCanvasFixture = {
  title: 'Large canvas scale regression',
  nodes: [
    { id: 'large-image', type: 'smart-image', x: 0, y: 0, w: 320, h: 220, images: [{ url: '/api/shares/large-token/media/hero?name=cover.svg', name: 'cover.svg' }] },
    ...Array.from({ length: 164 }, (_, index) => ({
      id: `large-text-${index}`,
      type: 'smart-text',
      x: 360 + (index % 41) * 285,
      y: Math.floor(index / 41) * 280,
      textSize: 'medium',
      text: `Read-only node ${index + 1}`,
    })),
    { id: 'large-text', type: 'smart-text', x: 12000, y: 1200, textSize: 'large', text: 'Far destination' },
  ],
  connections: [{ from: 'large-image', to: 'large-text' }],
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function startServer(state, port = 0) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET') state.writeRequests.push(`${request.method} ${url.pathname}`);
    if (url.pathname === '/api/shares/visual-token') {
      state.shareReads += 1;
      state.cookieHeaders.push(request.headers.cookie || '');
      return json(response, 200, { canvas: canvasFixture });
    }
    if (url.pathname === '/api/shares/expired-token') {
      state.failedReads += 1;
      return json(response, 404, { detail: 'This share link does not exist or has expired' });
    }
    if (url.pathname === '/api/shares/large-token') {
      state.largeReads += 1;
      return json(response, 200, { canvas: largeCanvasFixture });
    }
    if (['/api/shares/visual-token/media/hero', '/api/shares/large-token/media/hero'].includes(url.pathname)) {
      state.mediaReads += 1;
      state.mediaPreviewWidths.push(Number(url.searchParams.get('w')) || 0);
      response.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      if (url.searchParams.get('name') === 'portrait.svg') {
        return response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 512"><rect width="340" height="512" fill="#6d5dfc"/><circle cx="170" cy="150" r="95" fill="#c3fb78"/><rect x="70" y="300" width="200" height="150" rx="24" fill="#0f0f0f"/></svg>');
      }
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 380"><defs><linearGradient id="g"><stop stop-color="#6d5dfc"/><stop offset="1" stop-color="#c3fb78"/></linearGradient></defs><rect width="600" height="380" rx="30" fill="url(#g)"/><circle cx="455" cy="105" r="72" fill="#fff" fill-opacity=".65"/><path d="M70 300 230 145l92 90 84-65 125 130Z" fill="#0f0f0f" fill-opacity=".7"/></svg>');
    }
    const requestPath = url.pathname.startsWith('/share/') ? '/static/share.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, `.${requestPath}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      const type = {
        '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
        '.ttf': 'font/ttf', '.woff2': 'font/woff2',
      }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': `${type}; charset=utf-8`,
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'self'",
      });
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

async function screenshot(cdp, sessionId, file) {
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  fs.writeFileSync(file, Buffer.from(capture.data, 'base64'));
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const state = { shareReads: 0, failedReads: 0, largeReads: 0, mediaReads: 0, mediaPreviewWidths: [], cookieHeaders: [], writeRequests: [] };
  const server = await startServer(state);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-share-browser-'));
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
    const port = server.address().port;
    const lightScreenshot = path.join(os.tmpdir(), 'ic-t23-share-light.png');
    const selectionScreenshot = path.join(os.tmpdir(), 'ic-t23-share-selection.png');
    const darkScreenshot = path.join(os.tmpdir(), 'ic-t23-share-dark-narrow.png');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/share/visual-token?token-review-theme=light` }, sessionId);
    await waitFor(cdp, sessionId, "customElements.get('ic-media-container') && customElements.get('ic-canvas-node') && customElements.get('ic-prompt-composer') && document.querySelector('#share-loading')?.hidden === true && document.querySelectorAll('.share-node').length === 14", 'light share canvas');
    const desktop = await evaluate(cdp, sessionId, `(() => {
      const minimap = document.querySelector('#share-minimap').getBoundingClientRect();
      const stage = document.querySelector('#share-stage');
      const linkLayer = document.querySelector('#share-links');
      const link = linkLayer.querySelector('.share-link');
      const frame = document.querySelector('.share-frame-node');
      const linkStyle = getComputedStyle(link);
      const linkLayerStyle = getComputedStyle(linkLayer);
      const linkLayerRect = linkLayer.getBoundingClientRect();
      const frameStyle = getComputedStyle(frame);
      const stageScale = Number(stage.style.transform.match(/scale\\(([^)]+)\\)/)?.[1] || 1);
      const strokeWidth = Number.parseFloat(linkStyle.strokeWidth);
      const linkMidpoint = link.getPointAtLength(link.getTotalLength() / 2);
      const linkScreenPoint = new DOMPoint(linkMidpoint.x, linkMidpoint.y).matrixTransform(link.getScreenCTM());
      const originalPointerEvents = link.style.pointerEvents;
      const originalStrokeWidth = link.style.strokeWidth;
      link.style.pointerEvents = 'stroke';
      link.style.strokeWidth = '12px';
      const midpointHit = document.elementFromPoint(linkScreenPoint.x, linkScreenPoint.y);
      link.style.pointerEvents = originalPointerEvents;
      link.style.strokeWidth = originalStrokeWidth;
      return {
        theme: document.documentElement.dataset.uiTheme,
        title: document.querySelector('#canvas-title').textContent,
        readOnly: document.querySelector('ic-badge').textContent.trim(),
        components: ['ic-alert','ic-badge','ic-card','ic-loading','ic-media-container','ic-canvas-node','ic-prompt-composer'].every(tag => customElements.get(tag)),
        vendorTags: document.querySelectorAll('wa-badge,wa-card,wa-spinner,wa-alert').length,
        enabledMutationControls: [...document.querySelectorAll('[data-resize],[data-node-quick-add],[data-upload-action],input,textarea,select,button,ic-button,ic-icon-button,ic-input,ic-select,ic-upload-surface')]
          .filter(control => !control.hasAttribute('disabled') && control.getAttribute('aria-disabled') !== 'true').length,
        enabledMutationControlDetails: [...document.querySelectorAll('[data-resize],[data-node-quick-add],[data-upload-action],input,textarea,select,button,ic-button,ic-icon-button,ic-input,ic-select,ic-upload-surface')]
          .filter(control => !control.hasAttribute('disabled') && control.getAttribute('aria-disabled') !== 'true')
          .map(control => ({ tag:control.localName, id:control.id, className:control.className, label:control.getAttribute('aria-label') })),
        mediaContainers: document.querySelectorAll('ic-media-container').length,
        unresolvedCopy: /\{(?:n|count)\}/.test(document.body.innerText),
        promptNodes: document.querySelectorAll('[data-node-type="smart-prompt"]').length,
        readOnlyPromptEditors: document.querySelectorAll('ic-prompt-composer[contenteditable="false"]').length,
        promptTitleBars: [...document.querySelectorAll('[data-node-type="smart-prompt"] .node-head')]
          .filter(element => getComputedStyle(element).display !== 'none').length,
        promptLayouts: [...document.querySelectorAll('[data-node-type="smart-prompt"]')].map(node => ({
          id: node.dataset.id,
          width: Math.round(Number.parseFloat(getComputedStyle(node).width)),
          height: Math.round(Number.parseFloat(getComputedStyle(node).height)),
        })),
        promptSurface: (() => {
          const node = document.querySelector('.share-node[data-id="prompt-1"]');
          const card = node?.querySelector('.prompt-node-card');
          const editor = node?.querySelector('.prompt-node-text');
          return {
            cardPadding: card ? Number.parseFloat(getComputedStyle(card).paddingTop) : 0,
            editorPadding: editor ? Number.parseFloat(getComputedStyle(editor).paddingTop) : 0,
          };
        })(),
        nodeCount: document.querySelectorAll('.share-node').length,
        nodeFamily: {
          hosts: document.querySelectorAll('ic-canvas-node.share-node').length,
          customStructureCards: document.querySelectorAll('.share-structure-card').length,
          smartGroups: document.querySelectorAll('.smart-group-card').length,
          smartGroupMedia: document.querySelectorAll('[data-id="group-media"] .smart-group-card.has-thumbs').length,
          smartGroupThumbs: document.querySelectorAll('[data-id="group-media"] .thumb-item').length,
          hiddenGroupMembers: document.querySelectorAll('[data-id="group-member-image"]').length,
          splitters: document.querySelectorAll('.splitter-node-card').length,
          loops: document.querySelectorAll('.loop-smart-card').length,
          generationTargets: document.querySelectorAll('.reference-generation-target[data-reference-generation-target]').length,
          uploadSurfaces: document.querySelectorAll('.node-drop-readonly').length,
        },
        automaticImageLayouts: ['single-image-auto','multi-image-auto'].map(id => {
          const node = document.querySelector('[data-id="' + id + '"]');
          const image = node?.querySelector('.node-img');
          const imageRect = image?.getBoundingClientRect();
          return {
            id,
            width:Math.round(Number.parseFloat(getComputedStyle(node).width)),
            height:Math.round(Number.parseFloat(getComputedStyle(node).height)),
            naturalRatio:image ? image.naturalWidth / Math.max(1, image.naturalHeight) : 0,
            renderedRatio:imageRect ? imageRect.width / Math.max(1, imageRect.height) : 0,
          };
        }),
        composer: (() => {
          const root = document.querySelector('#share-composer');
          const controls = [...root.querySelectorAll('button,input,select,ic-button,ic-icon-button,ic-input,ic-select,ic-generation-settings-picker')];
          return {
            originalStructure: root.classList.contains('composer') && !!root.querySelector('.composer-card .prompt-row.prompt-editor-shell'),
            customReadonlyCopy: root.textContent.includes('只读 Composer'),
            visible: getComputedStyle(root).visibility !== 'hidden' && getComputedStyle(root).opacity !== '0',
            footerControls: root.querySelectorAll('.composer-focus-toggle,.param-row,.composer-actions').length,
            allControlsDisabled: controls.every(control => control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true'),
          };
        })(),
        links: {
          count: linkLayer.querySelectorAll('.share-link').length,
          stroke: linkStyle.stroke,
          strokeWidth,
          effectiveScreenStrokeWidth: strokeWidth * stageScale,
          layerWidth: Math.round(linkLayerRect.width),
          layerHeight: Math.round(linkLayerRect.height),
          layer: linkLayerStyle.zIndex,
          frameLayer: frameStyle.zIndex,
          pathLength: Math.round(link.getTotalLength()),
          midpointTopmost: midpointHit === link,
          midpointHit: midpointHit?.className?.baseVal || midpointHit?.className || midpointHit?.localName || '',
        },
        minimap: { width: Math.round(minimap.width), height: Math.round(minimap.height) },
        stageTransform: stage.style.transform,
        canvas: getComputedStyle(document.documentElement).getPropertyValue('--ui-color-surface-canvas').trim(),
      };
    })()`);
    const promptHeadPoint = await evaluate(cdp, sessionId, `(() => {
      const rect = document.querySelector('.share-node[data-id="prompt-1"] .prompt-node-text').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...promptHeadPoint }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...promptHeadPoint }, sessionId);
    const pointerComposerOpened = await evaluate(cdp, sessionId, `document.querySelector('#share-composer')?.classList.contains('open')`);
    const readOnlyComposer = await evaluate(cdp, sessionId, `(() => {
      const promptNode = document.querySelector('.share-node[data-id="prompt-1"]');
      promptNode.click();
      const panel = document.querySelector('#share-composer');
      const editor = document.querySelector('#promptInput');
      const promptResult = {
        open:panel.classList.contains('open'),
        text:editor.textContent,
        editable:editor.getAttribute('contenteditable'),
      };
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      const remainsVisibleAfterEscape = panel.classList.contains('open');
      document.querySelector('.share-node[data-id="prompt-generation-1"]').click();
      const generationPrompt = editor.textContent;
      const generationKind = document.querySelector('.share-node[data-id="prompt-generation-1"]').getAttribute('kind');
      document.querySelector('.share-node[data-id="image-1"]').click();
      return {
        promptResult,
        remainsVisibleAfterEscape,
        generationPrompt,
        generationKind,
        imagePrompt:editor.textContent,
        imageOpen:panel.classList.contains('open'),
      };
    })()`);
    const imageSelection = await evaluate(cdp, sessionId, `(() => {
      const node = document.querySelector('.share-node[data-id="image-1"]');
      const image = node.querySelector('.image-wrap > .node-img');
      const nodeRect = node.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        publicSelectedState:node.classList.contains('selected'),
        shareSpecificSelectedState:node.classList.contains('share-node-selected'),
        nodeWidth:Math.round(nodeRect.width),
        nodeHeight:Math.round(nodeRect.height),
        imageWidth:Math.round(imageRect.width),
        imageHeight:Math.round(imageRect.height),
      };
    })()`);
    await screenshot(cdp, sessionId, selectionScreenshot);
    const blankPoint = await evaluate(cdp, sessionId, `(() => {
      const rect = document.querySelector('#share-viewport').getBoundingClientRect();
      return { x:rect.left + 20, y:rect.top + 20 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...blankPoint }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...blankPoint }, sessionId);
    const blankDismissal = await evaluate(cdp, sessionId, `(() => ({
      composerOpen:document.querySelector('#share-composer')?.classList.contains('open'),
      selectedNodes:document.querySelectorAll('.share-node.selected,.share-node-selected').length,
    }))()`);
    await screenshot(cdp, sessionId, lightScreenshot);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -180 }, sessionId);
    await delay(250);
    const zoomed = await evaluate(cdp, sessionId, `(() => {
      const stage = document.querySelector('#share-stage');
      const scale = Number(stage.style.transform.match(/scale\\(([^)]+)\\)/)?.[1] || 1);
      const strokeWidth = Number.parseFloat(getComputedStyle(document.querySelector('.share-link')).strokeWidth);
      return { transform: stage.style.transform, nodes: document.querySelectorAll('.share-node').length, scale, strokeWidth, effectiveScreenStrokeWidth: strokeWidth * scale };
    })()`);

    const accessibilityTree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const accessibilityNodes = accessibilityTree.nodes.filter(node => !node.ignored);
    const roles = accessibilityNodes.map(node => node.role?.value).filter(Boolean);
    const accessibleNames = accessibilityNodes.map(node => node.name?.value).filter(Boolean);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/share/large-token?token-review-theme=light` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('#share-loading')?.hidden === true && document.documentElement.dataset.canvasLod === 'far' && document.querySelectorAll('.share-node').length === ${largeCanvasFixture.nodes.length}`, 'large share canvas');
    const largeCanvas = await evaluate(cdp, sessionId, `(() => {
      const stage = document.querySelector('#share-stage');
      const scale = Number(stage.style.transform.match(/scale\\(([^)]+)\\)/)?.[1] || 1);
      const link = document.querySelector('.share-link');
      const strokeWidth = Number.parseFloat(getComputedStyle(link).strokeWidth);
      return {
        scale,
        strokeWidth,
        effectiveScreenStrokeWidth: strokeWidth * scale,
        lodMode:document.documentElement.dataset.canvasLod || '',
        farNodes:document.querySelectorAll('.share-node.canvas-lod-node-far').length,
        mountedNodes:document.querySelectorAll('.share-node').length,
        imageSource:document.querySelector('.share-node img')?.currentSrc || '',
        virtualization:window.SmartCanvasModules?.canvasVirtualization?.diagnostics?.() || null,
      };
    })()`);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 120, y: 320, deltaX: 0, deltaY: -1000 }, sessionId);
    await waitFor(cdp, sessionId, `document.documentElement.dataset.canvasLod === 'detail' && document.querySelectorAll('.share-node').length > 0 && document.querySelectorAll('.share-node').length < ${largeCanvasFixture.nodes.length}`, 'detail virtualized share canvas');
    const largeCanvasDetail = await evaluate(cdp, sessionId, `(() => ({
      lodMode:document.documentElement.dataset.canvasLod || '',
      mountedNodes:document.querySelectorAll('.share-node').length,
      totalNodes:window.SmartCanvasModules?.canvasVirtualization?.diagnostics?.().totalNodeCount || 0,
      imageSource:document.querySelector('.share-node img')?.currentSrc || '',
    }))()`);

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/share/visual-token?token-review-theme=dark` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.uiTheme === 'dark' && document.querySelector('#share-loading')?.hidden === true && document.querySelectorAll('.share-node').length === 14", 'dark narrow share canvas');
    const narrow = await evaluate(cdp, sessionId, `(() => {
      const minimap = document.querySelector('#share-minimap').getBoundingClientRect();
      const title = document.querySelector('#canvas-title').getBoundingClientRect();
      return {
        theme: document.documentElement.dataset.uiTheme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        minimapWidth: Math.round(minimap.width),
        titleWidth: Math.round(title.width),
        viewportWidth: document.documentElement.clientWidth,
        canvas: getComputedStyle(document.documentElement).getPropertyValue('--ui-color-surface-canvas').trim(),
      };
    })()`);
    await screenshot(cdp, sessionId, darkScreenshot);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/share/expired-token?token-review-theme=light` }, sessionId);
    await waitFor(cdp, sessionId, "document.querySelector('#share-loading')?.hidden === true && document.querySelector('#share-error')?.hidden === false", 'expired share state');
    const failure = await evaluate(cdp, sessionId, `(() => ({
      role: document.querySelector('#share-error').getAttribute('role'),
      detail: document.querySelector('#share-error-detail').textContent,
      loadingHidden: document.querySelector('#share-loading').hidden,
    }))()`);

    const consoleErrors = cdp.events.flatMap(event => (
      event.method === 'Runtime.exceptionThrown'
        ? [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text]
        : event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'
          ? [event.params.args?.map(argument => argument.value || argument.description).join(' ')]
          : []
    ));
    report = {
      checks: {
        publicComponents: desktop.components && desktop.vendorTags === 0,
        readOnlySurface: desktop.readOnly === '只读' && desktop.enabledMutationControls === 0 && desktop.readOnlyPromptEditors >= 3,
        content: desktop.title === canvasFixture.title && desktop.mediaContainers === 0 && desktop.nodeCount === 14 && desktop.promptNodes === 2,
        productionImageLayout: desktop.automaticImageLayouts.some(node => node.id === 'single-image-auto' && node.width === 292 && node.height === 440 && Math.abs(node.renderedRatio - node.naturalRatio) < .01) && desktop.automaticImageLayouts.some(node => node.id === 'multi-image-auto' && node.width === 304 && node.height === 176),
        sharedNodeFamily: desktop.nodeFamily.hosts === desktop.nodeCount && desktop.nodeFamily.customStructureCards === 0 && desktop.nodeFamily.smartGroups === 2 && desktop.nodeFamily.smartGroupMedia === 1 && desktop.nodeFamily.smartGroupThumbs === 2 && desktop.nodeFamily.hiddenGroupMembers === 0 && desktop.nodeFamily.splitters === 1 && desktop.nodeFamily.loops === 1 && desktop.nodeFamily.generationTargets === 1 && desktop.nodeFamily.uploadSurfaces === 1,
        originalDisabledComposer: desktop.composer.originalStructure && !desktop.composer.customReadonlyCopy && !desktop.composer.visible && desktop.composer.footerControls === 0 && desktop.composer.allControlsDisabled,
        existingPromptNodeSurface: desktop.promptTitleBars === 0,
        existingPromptNodeSpacing: desktop.promptSurface.cardPadding === 12 && desktop.promptSurface.editorPadding === 8,
        mediaFallbackHidden: !accessibleNames.includes('Media unavailable'),
        nativeUploadFallbackHidden: !accessibleNames.includes('Choose File') && !accessibleNames.includes('No file chosen'),
        localizedNodeCopy: !desktop.unresolvedCopy,
        promptNodeLayout: desktop.promptLayouts.some(node => node.id === 'prompt-1' && node.width === 300 && node.height === 180) && desktop.promptLayouts.some(node => node.id === 'prompt-generation-1' && node.width === 320 && node.height === 200),
        readOnlyComposer: pointerComposerOpened && readOnlyComposer.promptResult.open && readOnlyComposer.promptResult.text === canvasFixture.nodes.find(node => node.id === 'prompt-1').text.trim() && readOnlyComposer.promptResult.editable === 'false' && readOnlyComposer.remainsVisibleAfterEscape && readOnlyComposer.generationPrompt === 'expand the campaign prompt' && readOnlyComposer.generationKind === 'prompt-generation' && readOnlyComposer.imageOpen && readOnlyComposer.imagePrompt === 'frozen image composer prompt',
        imageSelectionParity: imageSelection.publicSelectedState && !imageSelection.shareSpecificSelectedState && Math.abs(imageSelection.nodeWidth - imageSelection.imageWidth) <= 4 && Math.abs(imageSelection.nodeHeight - imageSelection.imageHeight) <= 4,
        blankDismissesComposer: !blankDismissal.composerOpen && blankDismissal.selectedNodes === 0,
        visibleConnections: desktop.links.count === 4 && desktop.links.pathLength > 0 && desktop.links.layerWidth > 0 && desktop.links.layerHeight > 0 && desktop.links.midpointTopmost && desktop.links.strokeWidth === 2,
        anonymousRead: state.shareReads === 2 && state.cookieHeaders.every(value => !value),
        noWrites: state.writeRequests.length === 0,
        mediaBoundary: state.mediaReads >= 2,
        panZoom: zoomed.transform !== desktop.stageTransform && zoomed.nodes === desktop.nodeCount,
        connectionStrokeScales: zoomed.strokeWidth === desktop.links.strokeWidth && zoomed.effectiveScreenStrokeWidth > desktop.links.effectiveScreenStrokeWidth,
        largeCanvasConnections: largeCanvas.scale < 0.2 && largeCanvas.strokeWidth === 2 && largeCanvas.effectiveScreenStrokeWidth < 0.4,
        largeCanvasPerformance: largeCanvas.lodMode === 'far' && largeCanvas.farNodes === largeCanvasFixture.nodes.length && largeCanvas.imageSource.includes('w=512') && largeCanvas.virtualization?.totalNodeCount === largeCanvasFixture.nodes.length && largeCanvasDetail.lodMode === 'detail' && largeCanvasDetail.mountedNodes > 0 && largeCanvasDetail.mountedNodes < largeCanvasDetail.totalNodes && largeCanvasDetail.totalNodes === largeCanvasFixture.nodes.length && /[?&]w=(512|1024|2048)(?:&|$)/.test(largeCanvasDetail.imageSource),
        accessibility: roles.includes('main') && roles.includes('group'),
        lightDesktop: desktop.theme === 'light' && desktop.minimap.width <= 200,
        darkNarrow: narrow.theme === 'dark' && !narrow.overflow && narrow.minimapWidth <= 160 && narrow.titleWidth < narrow.viewportWidth,
        themesDiffer: desktop.theme === 'light' && narrow.theme === 'dark',
        failureState: failure.role === 'alert' && failure.loadingHidden && failure.detail.includes('expired'),
        console: consoleErrors.length === 0,
      },
      desktop,
      pointerComposerOpened,
      readOnlyComposer,
      imageSelection,
      blankDismissal,
      narrow,
      largeCanvas,
      largeCanvasDetail,
      failure,
      requests: state,
      screenshots: { lightDesktop: lightScreenshot, selection: selectionScreenshot, darkNarrow: darkScreenshot },
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

if (process.env.SHARE_PREVIEW === '1') {
  const state = { shareReads: 0, failedReads: 0, largeReads: 0, mediaReads: 0, mediaPreviewWidths: [], cookieHeaders: [], writeRequests: [] };
  startServer(state, Number(process.env.SHARE_PREVIEW_PORT || 8793))
    .then(server => process.stdout.write(`Share preview: http://127.0.0.1:${server.address().port}/share/visual-token?token-review-theme=light\n`))
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
