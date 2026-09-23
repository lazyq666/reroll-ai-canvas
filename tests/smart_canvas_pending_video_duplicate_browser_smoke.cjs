const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const chrome = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function startServer() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn('python3', ['tests/smart_canvas_manual_server.py'], {
    cwd: root,
    env: { ...process.env, SMART_CANVAS_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Manual server startup timed out')), 10000);
    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes('Smart Canvas manual server:')) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', code => reject(new Error(`Manual server exited with ${code}`)));
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

(async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chrome });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/local-generation-submissions', route => route.fulfill({ json: { enabled: false } }));
    await page.goto(`${server.url}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`);
    try {
      await page.waitForFunction(() => canvas?.id === 'issue-47-text-composer' && window.SmartCanvasModules?.canvasPersistence?.online(), null, { timeout: 15000 });
    } catch (error) {
      throw new Error(`Smart Canvas startup failed: ${JSON.stringify({ url: page.url(), pageErrors, body: (await page.locator('body').innerText()).slice(0, 500) })}`, { cause: error });
    }
    const state = await page.evaluate(() => {
      const settings = {
        engine: 'api', apiKind: 'video', videoAspect: '9:16',
        videoResolution: '720p', videoProvider: 'manual-mock', videoModel: 'mock-video-1',
      };
      const reference = { url: '/static/images/test/fixture.svg', kind: 'image', name: '图1', inputInstanceId: 'ref-one' };
      const source = {
        id: 'pending-video', type: 'smart-image', x: 600, y: 180, w: 520, h: 292,
        generationOutputNode: true, referenceGenerationKind: 'video', outputKind: 'video',
        generationMediaW: 520, generationMediaH: 292, generationStableOuterSize: true,
        pending: 1, images: [], runSettings: settings,
        promptDraftHtml: `生成 <span class="mention-image-token" contenteditable="false" data-url="${reference.url}" data-kind="image" data-name="图1" data-input-instance-id="ref-one"><img src="${reference.url}"><span class="mention-token-label">图1</span></span>`,
        promptDraftText: '生成 @图1', runPrompt: '生成 @图1', runPromptRefs: [reference],
        runInputRefs: [reference], recipeSourceRefs: [reference],
      };
      nodes.push(source);
      canvas.nodes = nodes;
      render();
      const box = pendingBoxSize(1, { sourceNode: source, settings, refs: [reference] });
      const result = window.SmartCanvasModules.canvasMutation.duplicate({
        nodeIds: [source.id], mode: 'offset', preserveConnections: true,
      });
      const copy = result.nodes[0];
      selectedId = copy.id;
      selectedIds = [];
      updateComposer();
      const token = document.querySelector('#promptInput .mention-image-token');
      const tokenStyle = token ? getComputedStyle(token) : null;
      const editorStyle = getComputedStyle(document.querySelector('#promptInput'));
      return {
        box, copy: { w: copy.w, h: copy.h, generationMediaW: copy.generationMediaW, generationMediaH: copy.generationMediaH },
        token: token?.outerHTML || '', tokenImage: Boolean(token?.querySelector('img,video')),
        tokenVisual: tokenStyle ? {
          fontSize: tokenStyle.fontSize, editorFontSize: editorStyle.fontSize,
          borderWidth: tokenStyle.borderTopWidth, background: tokenStyle.backgroundColor,
        } : null,
        composerHtml: document.querySelector('#promptInput').innerHTML,
      };
    });
    assert.ok(state.tokenImage, `Duplicate lost mention thumbnail: ${JSON.stringify(state)}`);
    assert.equal(state.tokenVisual.fontSize, state.tokenVisual.editorFontSize, 'Duplicate mention typography differs from editor');
    assert.equal(state.tokenVisual.borderWidth, '0px', 'Duplicate mention regained a border');
    assert.ok(state.box.h > state.box.w, `Pending video ignores 9:16 setting: ${JSON.stringify(state)}`);
    assert.ok(state.copy.h > state.copy.w, `Duplicate retains pre-generation landscape size: ${JSON.stringify(state)}`);
    assert.equal(state.copy.generationMediaW, undefined, 'Duplicate retains stale generation media width');
    assert.equal(state.copy.generationMediaH, undefined, 'Duplicate retains stale generation media height');
    const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await live.route('**/api/local-generation-submissions', route => route.fulfill({ json: { enabled: false } }));
    await live.route('**/api/config', async route => {
      const response = await route.fetch();
      const config = await response.json();
      config.available_models.video = [{ id: 'mock-video-1', provider_id: 'manual-mock', provider_name: 'Manual', model: 'mock-video-1', name: 'mock-video-1' }];
      config.api_providers[0].video_models = ['mock-video-1'];
      await route.fulfill({ json: config });
    });
    await live.route('**/api/model-capabilities?**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('operation') !== 'video.generate') return route.continue();
      await route.fulfill({ json: {
        provider_id: 'manual-mock', model_id: 'mock-video-1', operation: 'video.generate',
        capability_schema_version: 1, catalog_revision: 'pending-video-duplicate', support_state: 'supported',
        inputs: { text: { minimum: 0, maximum: 1 }, image: { minimum: 0, maximum: 8 }, video: { minimum: 0, maximum: 1 }, audio: { minimum: 0, maximum: 0 } },
        output: { kind: 'video', count: { minimum: 1, maximum: 1 } },
        parameters: { duration_seconds: { type: 'integer', minimum: 1, maximum: 10 }, aspect_ratio: { type: 'enum', values: ['9:16'] }, resolution: { type: 'enum', values: ['720p'] } },
        media_contract: { known: true, commands: { multimodal2video: { image: { minimum: 0, maximum: 8 }, video: { minimum: 0, maximum: 1 }, duration_seconds: { minimum: 1, maximum: 10 }, aspect_ratios: ['9:16'], video_resolutions: ['720p'] } } },
      } });
    });
    await live.route('**/api/canvas-video-tasks', route => route.fulfill({ json: { task_id: 'pending-video-copy', status: 'queued', actor_id: 'manual-test' } }));
    await live.route('**/api/canvas-video-tasks/*', route => route.fulfill({ json: { id: 'pending-video-copy', status: 'running' } }));
    await live.goto(`${server.url}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`);
    await live.waitForFunction(() => canvas?.id === 'issue-47-text-composer' && window.SmartCanvasModules.canvasPersistence.online());
    await live.evaluate(() => {
      const source = nodes.find(node => node.id === 'media-a');
      source.referenceGenerationKind = 'video';
      source.runSettings = {
        ...source.runSettings, engine: 'api', apiKind: 'video',
        videoProvider: 'manual-mock', videoModel: 'mock-video-1',
        videoAspect: '9:16', videoResolution: '720p', videoDuration: 5,
      };
      nodes.push({ id: 'live-reference', type: 'smart-image', x: 60, y: 540, w: 180, h: 180, images: [{ url: '/static/images/test/fixture.svg', kind: 'image', name: '图1' }] });
      selectedId = source.id;
      selectedIds = [];
      render();
      updateComposer();
      promptInput.innerHTML = '生成 <span class="mention-image-token" contenteditable="false" data-url="/static/images/test/fixture.svg" data-kind="image" data-name="图1" data-node-id="live-reference" data-image-index="0"><img src="/static/images/test/fixture.svg"><span class="mention-token-label">图1</span></span>';
      promptInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await live.locator('#runBtn').click();
    await live.waitForFunction(() => nodes.some(node => node.outputKind === 'video' && (node.pending || node.pendingTasks?.length)));
    const actual = await live.evaluate(() => {
      const running = nodes.find(node => node.outputKind === 'video' && (node.pending || node.pendingTasks?.length));
      if (!running) return { error: nodes.map(node => ({ id: node.id, kind: node.outputKind, pending: node.pending, tasks: node.pendingTasks?.length })) };
      selectedId = running.id;
      selectedIds = [];
      updateComposer();
      const sourceToken = Boolean(promptInput.querySelector('.mention-image-token img'));
      const copy = window.SmartCanvasModules.canvasMutation.duplicate({ nodeIds: [running.id], mode: 'offset' }).nodes[0];
      selectedId = copy.id;
      selectedIds = [];
      updateComposer();
      const copyToken = promptInput.querySelector('.mention-image-token');
      const copyTokenStyle = copyToken ? getComputedStyle(copyToken) : null;
      return {
        sourceToken, copyToken: Boolean(copyToken?.querySelector('img')),
        copyTokenVisual: copyTokenStyle ? { fontSize: copyTokenStyle.fontSize, borderWidth: copyTokenStyle.borderTopWidth, background: copyTokenStyle.backgroundColor } : null,
        sourceHtml: running.promptDraftHtml || '', copyHtml: copy.promptDraftHtml || '',
        sourceSize: [running.w, running.h], copySize: [copy.w, copy.h],
      };
    });
    assert.equal(actual.error, undefined, `Running video disappeared before duplication: ${JSON.stringify(actual)}`);
    assert.ok(actual.sourceToken, `Running video lost its mention before duplication: ${JSON.stringify(actual)}`);
    assert.ok(actual.copyToken, `Running video duplicate lost its mention: ${JSON.stringify(actual)}`);
    assert.equal(actual.copyTokenVisual.borderWidth, '0px');
    assert.equal(actual.copyTokenVisual.background, 'rgba(0, 0, 0, 0)');
    assert.ok(actual.sourceSize[1] > actual.sourceSize[0], `Running video ignores its selected aspect: ${JSON.stringify(actual)}`);
    assert.ok(actual.copySize[1] > actual.copySize[0], `Running video duplicate kept an old aspect: ${JSON.stringify(actual)}`);
    const beforeSecondIds = await live.evaluate(() => {
      selectedId = 'media-a';
      selectedIds = [];
      updateComposer();
      return nodes.map(node => node.id);
    });
    await live.locator('#runBtn').click();
    await live.waitForFunction(ids => nodes.some(node => !ids.includes(node.id) && node.outputKind === 'video' && (node.pending || node.pendingTasks?.length)), beforeSecondIds);
    const branch = await live.evaluate(ids => {
      const output = nodes.find(node => !ids.includes(node.id) && node.outputKind === 'video' && (node.pending || node.pendingTasks?.length));
      if (!output) return { error: nodes.map(node => ({ id: node.id, kind: node.outputKind, pending: node.pending, tasks: node.pendingTasks?.length })) };
      selectedId = output.id;
      selectedIds = [];
      updateComposer();
      const sourceToken = Boolean(promptInput.querySelector('.mention-image-token img'));
      const copy = window.SmartCanvasModules.canvasMutation.duplicate({ nodeIds: [output.id], mode: 'offset' }).nodes[0];
      selectedId = copy.id;
      selectedIds = [];
      updateComposer();
      const resolved = window.SmartCanvasModules.promptAuthoring.resolve({ node: copy, settings: copy.runSettings });
      return { sourceToken, copyToken: Boolean(promptInput.querySelector('.mention-image-token img')), promptHtml: output.promptDraftHtml || '', copyHtml: copy.promptDraftHtml || '', referenceCount: resolved.refs.length };
    }, beforeSecondIds);
    assert.equal(branch.error, undefined, `Parallel video node was not ready: ${JSON.stringify(branch)}`);
    assert.ok(branch.copyToken, `Parallel pending video duplicate lost mention thumbnail: ${JSON.stringify(branch)}`);
    assert.equal(branch.referenceCount, 1, `Preserved token duplicated the input reference: ${JSON.stringify(branch)}`);
    console.log('PASS: inline mentions and 9:16 geometry survive pending video duplication, including parallel runs');
  } finally {
    await browser?.close();
    server.child.kill('SIGINT');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
