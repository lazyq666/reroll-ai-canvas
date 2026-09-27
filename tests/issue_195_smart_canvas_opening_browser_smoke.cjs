const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');


const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const port = Number(process.env.ISSUE_195_PORT || 8815);
const baseUrl = `http://${host}:${port}`;
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const canvasId = 'issue-195-progressive-opening';
const generationCanvasId = 'issue-195-generation-output-opening';
const viewportCanvasId = 'issue-195-viewport-opening';
const fallbackCanvasId = 'issue-195-fallback-opening';
const emptyCanvasId = 'issue-195-empty-opening';
const forbiddenCanvasId = 'issue-195-forbidden-opening';
const requestTimes = new Map();
const responseTimes = new Map();
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);


function canvasDocument(id = canvasId) {
  if (id === viewportCanvasId) {
    return {
      id,
      title: 'Issue #195 · Viewport opening',
      project: 'default',
      revision: 17,
      nodes: [{
        id: 'viewport-stable-node',
        type: 'smart-image',
        x: 180,
        y: 180,
        w: 320,
        h: 240,
        images: [{ url: '/assets/issue-195-preview.png', natural_w: 1200, natural_h: 900 }],
      }],
      connections: [],
      settings: {},
      logs: [],
    };
  }
  if (id === generationCanvasId) {
    return {
      id,
      title: 'Issue #195 · Generation output opening',
      project: 'default',
      revision: 13,
      nodes: [{
        id: 'generation-legacy-gallery',
        type: 'smart-image',
        x: 180,
        y: 180,
        generationOutputNode: true,
        images: [
          { url: '/assets/issue-195-preview.png#a', natural_w: 640, natural_h: 480 },
          { url: '/assets/issue-195-preview.png#b', natural_w: 480, natural_h: 640 },
        ],
      }, {
        id: 'generation-stable-output',
        type: 'smart-image',
        x: 620,
        y: 180,
        generationOutputNode: true,
        generationMediaW: 232,
        generationMediaH: 149,
        images: [{ url: '/assets/issue-195-preview.png#stable', natural_w: 1280, natural_h: 768 }],
      }],
      connections: [],
      settings: {},
      logs: [],
    };
  }
    return {
    id,
    title: 'Issue #195 · Progressive opening',
    project: 'default',
    revision: 9,
    nodes: id === canvasId ? [{
      id: 'node-progressive',
      type: 'smart-image',
      x: 120,
      y: 96,
      images: [{ url: '/assets/issue-195-preview.png', natural_w: 1200, natural_h: 400 }],
    }, {
      id: 'prompt-progressive',
      type: 'smart-prompt',
      x: 720,
      y: 96,
      text: 'x'.repeat(300),
    }] : [],
    connections: [],
    settings: {},
    logs: [],
  };
}


function json(res, body, status = 200) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}


function delayedJson(res, body, delay) {
  setTimeout(() => json(res, body), delay);
}


async function waitForRecordedRequest(pathname, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!requestTimes.has(pathname) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(requestTimes.has(pathname), `${pathname} request was not recorded`);
}

async function captureOpening(page, name) {
  const directory = process.env.ISSUE_195_SCREENSHOT_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}


function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  }[extension] || 'application/octet-stream';
}


function serveStatic(pathname, res) {
  const relative = pathname === '/'
    ? 'static/smart-canvas.html'
    : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    json(res, { detail: 'not found' }, 404);
    return;
  }
  const send = () => {
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': contentType(file),
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };
  if (pathname === '/static/js/infinite-canvas-ui/core.js') setTimeout(send, 650);
  else send();
}


const server = http.createServer((req, res) => {
  const url = new URL(req.url, baseUrl);
  const pathname = url.pathname;
  requestTimes.set(pathname, requestTimes.get(pathname) || Date.now());
  res.once('finish', () => responseTimes.set(pathname, Date.now()));
  if (pathname === `/api/canvases/${emptyCanvasId}/open`) {
    const canvas = canvasDocument(emptyCanvasId);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    res.write(`${JSON.stringify({ type: 'canvas_outline', canvas_id: emptyCanvasId, revision: canvas.revision, nodes: [] })}\n`);
    setTimeout(() => res.end(`${JSON.stringify({ type: 'canvas_document', canvas })}\n`), 1000);
    return;
  }
  if (pathname === `/api/canvases/${canvasId}/open`) {
    const canvas = canvasDocument();
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'Transfer-Encoding': 'chunked',
    });
    res.write(`${JSON.stringify({
      type: 'canvas_outline',
      canvas_id: canvasId,
      revision: canvas.revision,
      nodes: [{
        id: 'node-progressive',
        type: 'smart-image',
        x: 120,
        y: 96,
        images: [{ natural_w: 1200, natural_h: 400 }],
      }, {
        id: 'prompt-progressive',
        type: 'smart-prompt',
        x: 720,
        y: 96,
        llmEnabled: false,
        promptHasInputMedia: false,
        promptHasUpstreamText: false,
      }],
    })}\n`);
    setTimeout(() => {
      res.end(`${JSON.stringify({ type: 'canvas_document', canvas })}\n`);
    }, 40);
    return;
  }
  if (pathname === `/api/canvases/${canvasId}`) {
    json(res, { canvas: canvasDocument() });
    return;
  }
  if (pathname === `/api/canvases/${generationCanvasId}/open`) {
    const canvas = canvasDocument(generationCanvasId);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'Transfer-Encoding': 'chunked',
    });
    res.write(`${JSON.stringify({
      type: 'canvas_outline',
      canvas_id: generationCanvasId,
      revision: canvas.revision,
      nodes: [{
        id: 'generation-stable-output',
        type: 'smart-image',
        x: 620,
        y: 180,
        generationMediaW: 232,
        generationMediaH: 149,
        images: [{ is_still_image: true, natural_w: 1280, natural_h: 768 }],
      }],
    })}\n`);
    setTimeout(() => {
      res.end(`${JSON.stringify({ type: 'canvas_document', canvas })}\n`);
    }, 400);
    return;
  }
  if (pathname === `/api/canvases/${viewportCanvasId}/open`) {
    const canvas = canvasDocument(viewportCanvasId);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'Transfer-Encoding': 'chunked',
    });
    res.write(`${JSON.stringify({
      type: 'canvas_outline',
      canvas_id: viewportCanvasId,
      revision: canvas.revision,
      nodes: [{
        id: 'viewport-stable-node',
        type: 'smart-image',
        x: 180,
        y: 180,
        w: 320,
        h: 240,
        images: [{ is_still_image: true, natural_w: 1200, natural_h: 900 }],
      }],
    })}\n`);
    setTimeout(() => {
      res.end(`${JSON.stringify({ type: 'canvas_document', canvas })}\n`);
    }, 40);
    return;
  }
  if (pathname === `/api/canvases/${viewportCanvasId}`) {
    json(res, { canvas: canvasDocument(viewportCanvasId) });
    return;
  }
  if (pathname === `/api/canvases/${fallbackCanvasId}/open`) {
    json(res, { detail: 'opening stream is unavailable' }, 404);
    return;
  }
  if (pathname === `/api/canvases/${fallbackCanvasId}`) {
    json(res, { canvas: canvasDocument(fallbackCanvasId) });
    return;
  }
  if (pathname === `/api/canvases/${forbiddenCanvasId}/open`) {
    json(res, { detail: 'forbidden' }, 403);
    return;
  }
  if (pathname === '/api/config') {
    delayedJson(res, { api_providers: [], available_models: {}, comfy_instances: [] }, 1200);
    return;
  }
  if (pathname === '/api/prompt-libraries') {
    delayedJson(res, { library: { common: { id: 'common', categories: [], items: [] } } }, 1200);
    return;
  }
  if (
    pathname === `/api/canvases/${canvasId}/prompt-templates`
    || pathname === `/api/canvases/${fallbackCanvasId}/prompt-templates`
    || pathname === `/api/canvases/${forbiddenCanvasId}/prompt-templates`
  ) {
    delayedJson(res, { templates: [] }, 1200);
    return;
  }
  if (pathname === '/api/media-preview') {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': transparentPng.length });
      res.end(transparentPng);
    }, 900);
    return;
  }
  if (pathname === '/api/auth/me') {
    json(res, { user: { id: 'issue-195-reviewer', username: 'reviewer', role: 'admin' } });
    return;
  }
  if (pathname === `/api/smart-canvas/${viewportCanvasId}/view-state`) {
    delayedJson(res, { view_state: { center_x: 800, center_y: 600, scale: 0.4 } }, 650);
    return;
  }
  if (pathname.endsWith('/view-state')) {
    json(res, { view_state: null });
    return;
  }
  if (pathname === '/api/workflows') {
    json(res, { workflows: [] });
    return;
  }
  if (pathname.startsWith('/api/')) {
    json(res, {});
    return;
  }
  serveStatic(pathname, res);
});


async function openingState(page) {
  return page.evaluate(() => {
    const shell = document.getElementById('shell');
    const loading = document.getElementById('canvasOpeningStatus');
    const loadingRect = loading?.getBoundingClientRect();
    const media = document.querySelector('.image-node img[data-media-state]');
    const cropSource = document.getElementById('cropImage');
    const cropRect = cropSource?.getBoundingClientRect();
    const outlineNode = document.querySelector('.canvas-opening-node');
    const geometryByAttribute = (selector, attribute) => Object.fromEntries(
      [...document.querySelectorAll(selector)].map(element => {
        const rect = element.getBoundingClientRect();
        return [element.getAttribute(attribute), {
          x: Number.parseFloat(element.style.left || '0'),
          y: Number.parseFloat(element.style.top || '0'),
          screenX: rect.x,
          screenY: rect.y,
          width: rect.width,
          height: rect.height,
        }];
      }),
    );
    return {
      phase: document.documentElement.dataset.canvasOpeningPhase,
      loadingVisible: Boolean(loading && loadingRect.width > 20 && loadingRect.height > 20
        && getComputedStyle(loading).visibility === 'visible'
        && loading.checkVisibility()),
      loadingMarkBox: document.querySelector('.canvas-opening-brand')?.getBoundingClientRect().toJSON(),
      worldTransform: document.getElementById('world')?.style.transform || '',
      shellVisibility: shell ? getComputedStyle(shell).visibility : '',
      rawReferenceVisibility: getComputedStyle(document.getElementById('referenceGenerateMenu')).visibility,
      rawUpstreamVisibility: getComputedStyle(document.getElementById('upstreamInputMenu')).visibility,
      cropSourceVisibility: cropSource ? getComputedStyle(cropSource).visibility : '',
      cropSourcePainted: Boolean(
        cropSource
        && getComputedStyle(cropSource).display !== 'none'
        && getComputedStyle(cropSource).visibility !== 'hidden'
        && cropRect.width > 0
        && cropRect.height > 0
      ),
      skeletons: document.querySelectorAll('.canvas-opening-node').length,
      realNodes: document.querySelectorAll('#world > .image-node').length,
      outlineStyle: outlineNode?.getAttribute('style') || '',
      outlineSizes: geometryByAttribute('.canvas-opening-node', 'data-outline-node-id'),
      realSizes: geometryByAttribute('#world > .image-node', 'data-id'),
      mediaState: media?.dataset.mediaState || '',
      errors: document.documentElement.dataset.canvasOpeningPhase === 'error',
    };
  });
}


(async () => {
  await new Promise(resolve => server.listen(port, host, resolve));
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  try {
    const navigation = page.goto(`${baseUrl}/static/smart-canvas.html?id=${canvasId}`, {
      waitUntil: 'commit',
    });
    await page.locator('#shell').waitFor({ state: 'attached' });
    await page.waitForTimeout(120);
    const booting = await openingState(page);
    assert.equal(booting.phase, 'booting');
    assert.equal(booting.loadingVisible, true, 'Opening a canvas must show loading feedback before components are ready');
    assert.equal(await page.locator('.canvas-opening-brand-fallback').isVisible(), true);
    assert.equal(booting.shellVisibility, 'hidden');
    assert.equal(booting.rawReferenceVisibility, 'hidden');
    assert.equal(booting.rawUpstreamVisibility, 'hidden');
    assert.equal(booting.cropSourceVisibility, 'hidden');
    assert.equal(booting.cropSourcePainted, false);

    await page.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'skeleton');
    const skeletonObservedAt = Date.now();
    const skeleton = await openingState(page);
    assert.equal(skeleton.loadingVisible, true, 'Loading feedback must remain while the canvas document is pending');
    for (const field of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(skeleton.loadingMarkBox[field] - booting.loadingMarkBox[field]) < 1,
        `Brand loading ${field} must remain stable across opening phases: ${booting.loadingMarkBox[field]} -> ${skeleton.loadingMarkBox[field]}`);
    }
    assert.equal(skeleton.skeletons, 2);
    assert.equal(skeleton.realNodes, 0);
    assert.match(skeleton.outlineStyle, /left: 120px/);
    assert.equal(
      await page.locator('.canvas-opening-layer').evaluate(
        element => getComputedStyle(element).transitionDuration,
      ),
      '0.32s',
    );
    const lightSkeletonSurface = await page.locator('.canvas-opening-node').first().evaluate(
      element => getComputedStyle(element).backgroundColor,
    );
    await page.evaluate(() => window.StudioTheme.set('dark'));
    const darkSkeletonSurface = await page.locator('.canvas-opening-node').first().evaluate(
      element => getComputedStyle(element).backgroundColor,
    );
    assert.notEqual(darkSkeletonSurface, lightSkeletonSurface);
    await page.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'ready');
    assert.ok(Date.now() - skeletonObservedAt >= 180);
    const hydrated = await openingState(page);
    assert.equal(hydrated.loadingVisible, false, 'Loading feedback must disappear once the canvas is ready');
    await waitForRecordedRequest('/api/config');
    // Requests may start in either order; opening must not wait for config's response.
    assert.ok(!responseTimes.has('/api/config')
      || requestTimes.get(`/api/canvases/${canvasId}/open`) < responseTimes.get('/api/config'));
    assert.equal(hydrated.realNodes, 2);
    for (const nodeId of ['node-progressive', 'prompt-progressive']) {
      assert.ok(
        Math.abs(skeleton.outlineSizes[nodeId].width - hydrated.realSizes[nodeId].width) <= 1,
        `${nodeId} outline width ${skeleton.outlineSizes[nodeId].width} must match hydrated width ${hydrated.realSizes[nodeId].width}`,
      );
      assert.ok(
        Math.abs(skeleton.outlineSizes[nodeId].height - hydrated.realSizes[nodeId].height) <= 1,
        `${nodeId} outline height ${skeleton.outlineSizes[nodeId].height} must match hydrated height ${hydrated.realSizes[nodeId].height}`,
      );
    }
    assert.equal(hydrated.mediaState, 'loading');
    assert.equal(hydrated.errors, false);
    await page.waitForFunction(() => !document.querySelector('.canvas-opening-layer'));
    await page.waitForFunction(() => document.querySelector('.image-node img[data-media-state]')?.dataset.mediaState === 'ready');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedMotion = await page.evaluate(async () => {
      const layer = document.createElement('div');
      layer.className = 'canvas-opening-layer';
      const skeletonProbe = document.createElement('ic-skeleton');
      document.getElementById('world').append(layer);
      document.body.append(skeletonProbe);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const state = {
        layerTransition: getComputedStyle(layer).transitionDuration,
        shimmerAnimation: getComputedStyle(
          skeletonProbe.shadowRoot.querySelector('.shine'),
        ).animationName,
        mediaTransition: getComputedStyle(
          document.querySelector('.image-node img[data-media-state]'),
        ).transitionDuration,
      };
      layer.remove();
      skeletonProbe.remove();
      return state;
    });
    assert.equal(reducedMotion.layerTransition, '0s');
    assert.equal(reducedMotion.shimmerAnimation, 'none');
    assert.equal(reducedMotion.mediaTransition, '0s');
    await navigation;
    assert.deepEqual(pageErrors, []);

    const viewportPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await viewportPage.goto(`${baseUrl}/static/smart-canvas.html?id=${viewportCanvasId}`);
    await viewportPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'skeleton');
    const viewportOutline = await openingState(viewportPage);
    await viewportPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'ready');
    const viewportHydrated = await openingState(viewportPage);
    assert.equal(
      viewportOutline.worldTransform,
      viewportHydrated.worldTransform,
      'opening skeleton must use the restored World transform before its first paint',
    );
    for (const field of ['screenX', 'screenY', 'width', 'height']) {
      assert.ok(
        Math.abs(
          viewportOutline.outlineSizes['viewport-stable-node'][field]
          - viewportHydrated.realSizes['viewport-stable-node'][field]
        ) <= 1,
        `viewport skeleton ${field} must match hydrated Node ${field}`,
      );
    }
    await viewportPage.close();

    const generationPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await generationPage.addInitScript(canvasIdForLocalRestore => {
      localStorage.setItem(
        `infiniteCanvasRealtimePending:v1:${canvasIdForLocalRestore}`,
        JSON.stringify({
          schema: 1,
          canvas_id: canvasIdForLocalRestore,
          base_revision: 13,
          saved_at: Date.now(),
          changes: {
            node_creates: [],
            node_updates: [{
              id: 'generation-stable-output',
              path: ['images'],
              value: [{
                url: '/assets/issue-195-preview.png#stable-local',
                natural_w: 768,
                natural_h: 1280,
              }],
            }],
            node_unsets: [{ id: 'generation-stable-output', path: ['generationMediaW'] }, {
              id: 'generation-stable-output', path: ['generationMediaH']
            }],
            node_deletes: [],
            connection_adds: [],
            connection_removes: [],
            canvas_updates: [],
            canvas_unsets: [],
          },
        }),
      );
    }, generationCanvasId);
    await generationPage.goto(`${baseUrl}/static/smart-canvas.html?id=${generationCanvasId}`);
    await generationPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'skeleton');
    const generationOutline = await openingState(generationPage);
    await generationPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'ready');
    const generationHydrated = await openingState(generationPage);
    assert.deepEqual(Object.keys(generationOutline.outlineSizes), ['generation-stable-output']);
    assert.equal(generationHydrated.realNodes, 3);
    assert.equal('generation-legacy-gallery' in generationOutline.outlineSizes, false);
    for (const nodeId of Object.keys(generationOutline.outlineSizes)) {
      for (const field of ['x', 'y', 'width', 'height']) {
        assert.ok(
          Math.abs(generationOutline.outlineSizes[nodeId][field] - generationHydrated.realSizes[nodeId][field]) <= 1,
          `${nodeId} outline ${field} ${generationOutline.outlineSizes[nodeId][field]} must match hydrated ${field} ${generationHydrated.realSizes[nodeId][field]}`,
        );
      }
    }
    await generationPage.close();

    const fallbackPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await fallbackPage.emulateMedia({ reducedMotion:'reduce' });
    let releaseCore;
    const coreGate = new Promise(resolve => { releaseCore = resolve; });
    await fallbackPage.route('**/infinite-canvas-ui/core.js*', async route => {
      await coreGate;
      await route.continue();
    });
    const fallbackErrors = [];
    fallbackPage.on('pageerror', error => fallbackErrors.push(String(error)));
    let releaseFallback;
    const fallbackGate = new Promise(resolve => { releaseFallback = resolve; });
    await fallbackPage.route(`**/api/canvases/${fallbackCanvasId}`, async route => {
      await fallbackGate;
      await route.continue();
    });
    await fallbackPage.goto(`${baseUrl}/static/smart-canvas.html?id=${fallbackCanvasId}`, { waitUntil:'commit' });
    await fallbackPage.locator('.canvas-opening-brand-fallback').waitFor({ state:'visible' });
    const staticLogoBox = await fallbackPage.locator('.canvas-opening-brand-fallback').boundingBox();
    releaseCore();
    await fallbackPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'awaiting-outline');
    const animatedLogoBox = await fallbackPage.locator('.canvas-opening-brand').evaluate(el => {
      const svg = el.shadowRoot.querySelector('svg');
      const box = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const scale = box.width / viewBox.width;
      return { x:box.x - viewBox.x * scale, y:box.y - viewBox.y * scale, width:355 * scale, height:355 * scale };
    });
    for (const field of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(staticLogoBox[field] - animatedLogoBox[field]) < 0.1,
        `Static and animated Logo ${field} must match: ${staticLogoBox[field]} -> ${animatedLogoBox[field]}`);
    }
    await fallbackPage.emulateMedia({ reducedMotion:'no-preference' });
    assert.equal((await openingState(fallbackPage)).loadingVisible, true);
    const loading = fallbackPage.locator('#canvasOpeningStatus');
    assert.equal(await loading.textContent(), '正在准备画布…');
    await fallbackPage.evaluate(() => window.StudioI18n.set('en'));
    assert.equal(await loading.textContent(), 'Preparing canvas…');
    const lightMark = await fallbackPage.locator('.canvas-opening-brand').evaluate(el =>
      getComputedStyle(el.shadowRoot.querySelector('.brand')).color);
    await fallbackPage.evaluate(() => window.StudioTheme.set('dark'));
    const darkMark = await fallbackPage.locator('.canvas-opening-brand').evaluate(el =>
      getComputedStyle(el.shadowRoot.querySelector('.brand')).color);
    assert.notEqual(darkMark, lightMark);
    await captureOpening(fallbackPage, 'canvas-loading-dark-en');
    const mark = fallbackPage.locator('.canvas-opening-brand path');
    const movingPath = await mark.getAttribute('d');
    await fallbackPage.waitForFunction(d => document.querySelector('.canvas-opening-brand').shadowRoot.querySelector('path').getAttribute('d') !== d, movingPath);
    await fallbackPage.emulateMedia({ reducedMotion: 'reduce' });
    await fallbackPage.waitForTimeout(80);
    const reducedPath = await mark.getAttribute('d');
    await fallbackPage.waitForTimeout(160);
    assert.equal(await mark.getAttribute('d'), reducedPath);
    await fallbackPage.emulateMedia({ reducedMotion: 'no-preference' });
    await fallbackPage.waitForFunction(d => document.querySelector('.canvas-opening-brand').shadowRoot.querySelector('path').getAttribute('d') !== d, reducedPath);
    await fallbackPage.evaluate(() => { document.documentElement.dataset.uiMotion = 'reduced'; });
    await fallbackPage.waitForTimeout(80);
    const pageReducedPath = await mark.getAttribute('d');
    await fallbackPage.waitForTimeout(160);
    assert.equal(await mark.getAttribute('d'), pageReducedPath);
    await fallbackPage.evaluate(() => {
      document.documentElement.dataset.uiMotion = 'full';
      window.StudioI18n.set('zh');
    });
    assert.equal(await loading.textContent(), '正在准备画布…');
    assert.equal(await fallbackPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await fallbackPage.evaluate(() => window.StudioTheme.set('light'));
    await captureOpening(fallbackPage, 'canvas-loading-light-zh');
    releaseFallback();
    await fallbackPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'ready');
    const fallback = await openingState(fallbackPage);
    assert.equal(fallback.skeletons, 0);
    assert.equal(fallback.realNodes, 0);
    assert.equal(fallback.loadingVisible, false);
    assert.ok(requestTimes.has(`/api/canvases/${fallbackCanvasId}/open`));
    assert.ok(requestTimes.has(`/api/canvases/${fallbackCanvasId}`));
    assert.deepEqual(fallbackErrors, []);
    await fallbackPage.close();

    const emptyPage = await browser.newPage();
    await emptyPage.goto(`${baseUrl}/static/smart-canvas.html?id=${emptyCanvasId}`);
    await waitForRecordedRequest(`/api/canvases/${emptyCanvasId}/open`);
    const emptyPending = await openingState(emptyPage);
    assert.equal(emptyPending.loadingVisible, true, 'Empty outlines must keep visible loading until the document arrives');
    assert.equal(emptyPending.skeletons, 0);
    await emptyPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'ready');
    assert.equal((await openingState(emptyPage)).loadingVisible, false);
    await emptyPage.close();

    const forbiddenPage = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await forbiddenPage.goto(`${baseUrl}/static/smart-canvas.html?id=${forbiddenCanvasId}`);
    await forbiddenPage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'error');
    const forbidden = await forbiddenPage.evaluate(() => ({
      shellDisplay: getComputedStyle(document.getElementById('shell')).display,
      panelDisplay: getComputedStyle(document.getElementById('canvasOpeningError')).display,
      panelAriaHidden: document.getElementById('canvasOpeningError').getAttribute('aria-hidden'),
      message: document.getElementById('canvasOpeningErrorMessage').textContent.trim(),
      focused: document.activeElement?.id,
    }));
    assert.equal(forbidden.shellDisplay, 'none');
    assert.equal(forbidden.panelDisplay, 'grid');
    assert.equal(forbidden.panelAriaHidden, null);
    assert.equal(forbidden.message, '你没有打开此画布的权限。');
    assert.equal(forbidden.focused, 'canvasOpeningRetry');
    assert.equal((await openingState(forbiddenPage)).loadingVisible, false);
    await forbiddenPage.close();

    const brokenModulePage = await browser.newPage();
    await brokenModulePage.route('**/infinite-canvas-ui/core.js*', route => route.abort());
    await brokenModulePage.goto(`${baseUrl}/static/smart-canvas.html?id=${canvasId}`);
    await brokenModulePage.waitForFunction(() => document.documentElement.dataset.canvasOpeningPhase === 'error');
    assert.equal((await openingState(brokenModulePage)).loadingVisible, false);
    assert.equal(await brokenModulePage.locator('#canvasOpeningRetry').isVisible(), true);
    await brokenModulePage.close();
    process.stdout.write('Issue #195 Smart Canvas progressive opening browser smoke passed.\n');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  server.close(() => process.exit(1));
});
