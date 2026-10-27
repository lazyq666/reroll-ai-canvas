const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const { apiPayload } = require('./issue_31_layer_decomposition_browser_smoke.cjs');

const root = path.resolve(__dirname, '..');
const chrome = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  // This server owns a fresh temporary SQLite Workspace. Real account auth,
  // Agent HTTP, CanvasSync persistence and WebSocket broadcasts remain active.
  const child = spawn(path.join(root, '.venv/bin/python'), ['tests/agent_draft_repairs_browser_fixture.py'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stderr.on('data', data => { logs += data; });
  let browser;
  try {
    const auth = await new Promise((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(() => reject(new Error(`Fixture did not start: ${logs}`)), 15000);
      child.stdout.on('data', data => {
        stdout += data;
        const line = stdout.split('\n').find(value => value.startsWith('{"port"'));
        if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Fixture exited: ${logs}`)); });
    });
    const base = `http://127.0.0.1:${auth.port}`;
    browser = await chromium.launch({ headless: true, executablePath: chrome });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addCookies([{ name: 'ic_session', value: auth.cookie, url: base }]);
    const chargedRequests = [];
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST' && /(?:generate|canvas-(?:video|image|llm)-tasks|run-requests)/.test(url.pathname)) {
        chargedRequests.push(url.pathname);
        return route.abort('blockedbyclient');
      }
      if (url.pathname.startsWith('/api/agent/') || url.pathname.startsWith('/api/account/')
          || ['/api/canvases/canvas-test', '/api/config', '/api/model-capabilities'].includes(url.pathname)) return route.continue();
      if (url.pathname === '/api/local-generation-submissions') return route.fulfill({ json: { enabled: false } });
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: auth.user } });
      return route.fulfill({ json: apiPayload(url.href) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    const loaded = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (response.status() === 200 && pathname.endsWith('.js')) loaded.add(pathname);
    });
    const detail = async id => {
      const response = await fetch(`${base}/api/agent/v1/canvases/canvas-test/tasks/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    };
    const open = async () => {
      await page.goto(`${base}/static/smart-canvas.html?id=canvas-test`);
      await page.waitForFunction(() => canvas?.id === 'canvas-test' && window.SmartCanvasModules.canvasPersistence.online());
      await page.waitForFunction(() => window.SmartCanvasModules.videoCapabilities.supportedModels('jimeng').includes('seedance2.5'));
    };
    // The real legacy persisted task is read before any page save. No historical
    // fixture correction is needed for the independent Agent projection.
    const oldDetail = await detail('legacy-video');
    assert.equal(oldDetail.recipe.kind, 'video');
    assert.equal(oldDetail.recipe.model.model.toLowerCase(), 'seedance2.5');
    assert.equal(oldDetail.recipe.params.duration_seconds, 22);

    await open();
    for (const name of ['smart-canvas.js', 'smart-canvas/generation-output.js', 'smart-canvas/generation-provider.js', 'smart-canvas/video-capabilities.js', 'i18n/smart-canvas.js']) {
      assert.ok(loaded.has(`/static/js/${name}`), `real page must load the actual ${name}`);
    }

    await page.evaluate(async () => {
      selectedId = 'alias-draft'; selectedIds = []; updateComposer();
      await loadSmartVideoCapabilityForCurrentSettings();
      renderDynamicParams({ force: true });
      canvasPersistence.schedule(); await canvasPersistence.synced();
    });
    const alias = await page.evaluate(() => ({
      model: settings.videoModel, duration: settings.videoDuration,
      persisted: nodes.find(node => node.id === 'alias-draft').runSettings,
      labels: document.querySelector('[data-smart-select-param="videoModelChoice"]')?.textContent || '',
    }));
    assert.equal(alias.model, 'seedance2.5');
    assert.equal(alias.duration, 22);
    assert.equal(alias.persisted.videoModel, 'seedance2.5');
    assert.equal(alias.persisted.videoDuration, 22);
    assert.match(alias.labels, /Seedance 2\.5 custom/);

    // Simulate only Provider completion delivery. The real editor module applies
    // results and the real CanvasSync saves them; no Provider run is requested.
    await page.evaluate(async () => {
      const source = nodes.find(node => node.id === 'alias-draft');
      const drafts = ['pending', 'queued', 'task'].map((strategy, index) => ({
        id: `completed-${strategy}`, type: 'smart-image', title: `Video ${strategy}`,
        x: 0, y: 0, w: 260, h: 180, generationOutputNode: true,
        referenceGenerationKind: 'video', outputKind: 'video', images: [],
        pending: strategy === 'queued' ? 0 : 1,
        ...(strategy === 'queued' ? { jimengPending: { submitId: 'fixture-queue', kind: 'video' } } : {}),
        ...(strategy === 'task' ? { pendingTasks: [{ taskId: 'fixture-run', kind: 'video' }] } : {}),
        runSettings: JSON.parse(JSON.stringify(source.runSettings)),
        generationInputSnapshot: { settings: JSON.parse(JSON.stringify(source.runSettings)), prompt: 'Preserved video prompt', refs: [] },
        promptDraftText: 'Preserved video prompt', promptDraftHtml: 'Preserved video prompt',
        runStartedAt: Date.now() - 1000,
      }));
      const created = canvasMutation.createBatch({
        drafts, intent: { anchor: { kind: 'point', x: 800, y: 0 }, relation: 'free', arrangement: 'horizontal-batch' },
        options: { select: false, reveal: false, save: false },
      });
      for (const [index, node] of created.entries()) {
        window.SmartCanvasModules.generationOutput.apply({
          node, strategy: ['pending', 'queued', 'task'][index], taskId: 'fixture-run', kind: 'video',
          outputs: [{ url: '/static/images/test/fixture.mp4', kind: 'video' }],
        });
      }
      render(); canvasPersistence.schedule(); await canvasPersistence.synced();
    });
    await page.reload();
    await page.waitForFunction(() => window.SmartCanvasModules.canvasPersistence.online() && nodes.some(node => node.id === 'completed-task'));
    const reloaded = await page.evaluate(() => nodes.filter(node => node.id.startsWith('completed-')).map(node => ({
      id: node.id, kind: node.referenceGenerationKind, outputKind: node.outputKind,
      model: node.runSettings.videoModel, duration: node.runSettings.videoDuration,
      mediaKind: node.images[0]?.kind, prompt: node.promptDraftText,
    })));
    assert.equal(reloaded.length, 3);
    for (const node of reloaded) {
      assert.equal(node.kind, 'video'); assert.equal(node.outputKind, 'video'); assert.equal(node.mediaKind, 'video');
      assert.equal(node.model, 'seedance2.5'); assert.equal(node.duration, 22); assert.equal(node.prompt, 'Preserved video prompt');
      const saved = await detail(node.id);
      assert.equal(saved.recipe.kind, 'video'); assert.equal(saved.recipe.model.model, 'seedance2.5');
      assert.equal(saved.recipe.params.duration_seconds, 22);
    }
    const aliasReadback = await detail('alias-draft');
    assert.equal(aliasReadback.recipe.model.model, 'seedance2.5');
    assert.equal(aliasReadback.recipe.params.duration_seconds, 22);
    await page.evaluate(() => { selectedId = 'completed-task'; selectedIds = []; render(); updateComposer(); });
    await page.waitForTimeout(600); // Capture settled Composer entry motion.
    await page.screenshot({ path: '/tmp/reroll-draft-repairs-video-reloaded.png' });

    // Configured visibility changes keep an invalid saved choice visible and
    // reject submission in both languages without starting a generation.
    const visibility = await context.request.patch(`${base}/fixture/model-visibility`, { data: { hidden: true } });
    assert.equal(visibility.status(), 200);
    await page.reload();
    await page.waitForFunction(() => window.SmartCanvasModules.canvasPersistence.online());
    for (const lang of ['en', 'zh']) {
      const unavailable = await page.evaluate(async language => {
        window.StudioI18n.set(language);
        selectedId = 'alias-draft'; selectedIds = []; updateComposer();
        await loadSmartVideoCapabilityForCurrentSettings(); renderDynamicParams({ force: true });
        let error = '';
        try { await window.SmartCanvasModules.generationProvider.submit({ prompt: 'Blocked fixture', settings: { ...settings }, refs: [] }); }
        catch (failure) { error = failure.message; }
        const option = document.querySelector('[data-smart-select-param="videoModelChoice"] option[value="__unavailable_model__"]');
        return { model: settings.videoModel, duration: settings.videoDuration, label: option?.textContent || '',
          expectedLabel: trf('smart.modelUnavailableLabel', { model: 'seedance2.5 · jimeng' }),
          error, expectedError: tr('smart.modelUnavailable') };
      }, lang);
      assert.equal(unavailable.model, 'seedance2.5'); assert.equal(unavailable.duration, 22);
      assert.equal(unavailable.label, unavailable.expectedLabel); assert.equal(unavailable.error, unavailable.expectedError);
      assert.match(unavailable.error, lang === 'en' ? /Choose another model/ : /重新选择模型/);
      await page.waitForTimeout(600); // Capture the translated control and visible notice after entry motion.
      await page.screenshot({ path: `/tmp/reroll-draft-repairs-unavailable-${lang}.png` });
    }
    await page.evaluate(async () => { canvasPersistence.schedule(); await canvasPersistence.synced(); });
    await page.reload();
    await page.waitForFunction(() => window.SmartCanvasModules.canvasPersistence.online());
    assert.deepEqual(await page.evaluate(() => {
      const node = nodes.find(item => item.id === 'alias-draft');
      return [node.runSettings.videoModel, node.runSettings.videoDuration];
    }), ['seedance2.5', 22], 'saving an unavailable selection must preserve its model and duration after reload');
    assert.deepEqual(chargedRequests, []);
    assert.deepEqual(errors, []);
    console.log('PASS: real Chrome + temporary SQLite/CanvasSync save/reload + independent Agent readback preserve video type and Seedance 2.5/22 seconds; hidden-model controls and refusal are bilingual; zero Provider requests');
    console.log('Screenshots: /tmp/reroll-draft-repairs-video-reloaded.png, /tmp/reroll-draft-repairs-unavailable-en.png, /tmp/reroll-draft-repairs-unavailable-zh.png');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
