const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const operation = (name, confirmed = true) => ({
  operation: name,
  confirmed,
  inputs: { text: 1, image: name === 'image.edit' ? 2 : 0, video: 0, audio: 0, file: 0 },
  resolutions: ['1K', '2K'],
  aspect_ratios: ['1:1', '16:9'],
  output_count_maximum: 4,
  options: { transparent_png: false, prompt_enhancement: true },
});
const layerDecomposition = {
  ...operation('image.layer_decomposition', false),
  inputs: { text: 1, image: 1, video: 0, audio: 0, file: 0 },
  resolutions: ['1K', '2K'],
  aspect_ratios: [],
  output_count_maximum: 1,
  options: {},
};
const imageEdit = {
  ...operation('image.edit'),
  resolutions: ['1K'],
  aspect_ratios: ['1:1'],
  output_count_maximum: 2,
};
const videoOperation = {
  operation: 'video.generate', confirmed: true,
  inputs: { text: 1, image: 9, video: 3, audio: 3, file: 0 },
  resolutions: ['720p'], aspect_ratios: ['16:9', '9:16'], output_count_maximum: 1,
  options: { enhance_prompt: true, generate_audio: true, enable_upsample: false, camera_fixed: false, watermark: false },
  video: {
    input_total_maximum: 12,
    reference_media_duration_seconds: {
      each: { minimum: 2, maximum: 15 },
      combined_total: { minimum: 2, maximum: 15 },
    },
    audio_only_supported: false,
    modes: { first_last_frames: true, multimodal_all_around: true },
    output_duration_seconds: { minimum: 4, maximum: 15 },
  },
};
const matrix = {
  models: [
    {
      id: 'shared-image', model_id: 'shared-image', name: 'Shared Image', names: ['Shared Image'],
      types: ['image'], providers: [{ id: 'one', name: 'Platform One' }, { id: 'two', name: 'Platform Two' }],
      operations: [operation('image.generate'), imageEdit, layerDecomposition],
      capability_tags: ['layer_decomposition', 'transparent_png'],
      evidence_count: 2, confirmed_count: 2, operation_count: 3,
      review: { draft: 0, in_review: 0, published: 2 },
    },
    {
      id: 'shared-video', model_id: 'shared-video', name: 'Shared Video', names: ['Shared Video'],
      types: ['video'], providers: [{ id: 'video-one', name: 'Video Platform' }],
      operations: [videoOperation], capability_tags: [],
      evidence_count: 1, confirmed_count: 1, operation_count: 1,
      review: { draft: 0, in_review: 0, published: 1 },
    },
    {
      id: 'text-model', model_id: 'text-model', name: 'Text Model', names: ['Text Model'],
      types: ['text'], providers: [{ id: 'three', name: 'Platform Three' }],
      operations: [{
        operation: 'text.generate', confirmed: false,
        inputs: { text: 1, image: 0, video: 0, audio: 0, file: 0 },
        resolutions: [], aspect_ratios: [], output_count_maximum: 1, options: {},
      }],
      capability_tags: [],
      evidence_count: 0, confirmed_count: 0, operation_count: 1,
      review: { draft: 0, in_review: 0, published: 0 },
    },
  ],
  summary: { models: 3, confirmed: 2, needs_sources: 1, with_sources: 2 },
  catalog_revision: 'catalog-revision-1',
};
// Share editor limits with the backend; no external research schema is exported.
const { execFileSync } = require('node:child_process');
const editorData = JSON.parse(execFileSync(path.join(ROOT, '.venv/bin/python'), ['-c',
  'import json; from backend.infinite_canvas.model_capability_matrix import editor_limits,EDITOR_RESOLUTIONS,EDITOR_ASPECT_RATIOS; print(json.dumps({"editor_limits":editor_limits(),"editor_candidates":{"resolutions":EDITOR_RESOLUTIONS,"aspect_ratios":EDITOR_ASPECT_RATIOS}}))'
], { cwd: ROOT, encoding: 'utf8' }));
Object.assign(matrix, editorData);

const availableModels = {
  image: [{
    id: 'one\0shared-image', model: 'shared-image', name: 'Shared Image',
    provider_id: 'one', provider_name: 'Platform One', visible: true,
  }],
  video: [{
    id: 'video-one\0shared-video', model: 'shared-video', name: 'Shared Video',
    provider_id: 'video-one', provider_name: 'Video Platform', visible: true,
  }],
  text: [{
    id: 'three\0text-model', model: 'text-model', name: 'Text Model',
    provider_id: 'three', provider_name: 'Platform Three', visible: true,
  }],
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function startServer(state) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/admin/available-models') return json(response, 200, { models: availableModels });
    if (url.pathname === '/api/admin/model-capability-matrix' && request.method === 'GET') return json(response, 200, matrix);
    if (url.pathname === '/api/admin/model-capability-matrix' && request.method === 'PUT') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      return request.on('end', () => {
        state.applied += 1;
        state.appliedPayload = JSON.parse(body);
        json(response, 200, { result: { published: 2 }, matrix });
      });
    }
    const requestPath = url.pathname === '/available-model-management'
      ? '/static/available-model-management.html'
      : decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, `.${requestPath}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      const type = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
        '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
      }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const state = { applied: 0, appliedPayload: null, refreshed: 0 };
  const server = await startServer(state);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-matrix-'));
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('studio_theme', 'dark');
      localStorage.setItem('studio_lang', 'zh');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/available-model-management`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#model-list .model-row').length === 1);
    await page.waitForFunction(() => document.querySelectorAll('#model-list .model-capability-tags ic-badge').length === 2);

    const desktop = await page.evaluate(() => ({
      rows: document.querySelectorAll('#model-list .model-row').length,
      tags: [...document.querySelectorAll('#model-list .model-capability-tags ic-badge')].map(tag => tag.textContent.trim()),
      hasCapabilityTab: Boolean(document.querySelector('#management-sections, #capability-workbench-view')),
      providerId: document.querySelector('#model-list .provider-id').textContent.trim(),
      hasEdit: Boolean(document.querySelector('#model-list .model-capability-edit')),
      hasJsonEditor: document.body.textContent.includes('Inputs JSON'),
      hasProviderIdField: Boolean(document.querySelector('#capability-provider')),
      hasBuiltInAi: document.body.textContent.includes('AI 补全能力'),
      dark: document.documentElement.dataset.uiTheme === 'dark' || document.documentElement.classList.contains('theme-dark'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(desktop.rows, 1);
    assert.deepEqual(desktop.tags, ['拆分图层', '透明 PNG']);
    assert.equal(desktop.hasCapabilityTab, false);
    assert.equal(desktop.providerId, 'one');
    assert.equal(desktop.hasEdit, true);
    assert.equal(desktop.hasJsonEditor, false);
    assert.equal(desktop.hasProviderIdField, false);
    assert.equal(desktop.hasBuiltInAi, false);
    assert.equal(desktop.dark, true);
    assert.ok(desktop.overflow <= 1);

    await page.locator('#model-list .model-capability-edit').click();
    await page.waitForFunction(() => document.querySelector('#capability-editor-dialog')?.open);
    assert.equal(await page.locator('.capability-image-profile').count(), 1);
    assert.equal(await page.locator('.capability-operation-card').count(), 0);
    assert.equal((await page.locator('.capability-image-profile h4').textContent()).trim(), '图片能力');
    assert.equal(await page.locator('.capability-image-profile').getByText('生成图片', { exact: true }).count(), 0);
    assert.equal(await page.locator('.capability-image-profile').getByText('编辑图片', { exact: true }).count(), 0);
    const imageRatios = [
      '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5',
      '21:9', '1:4', '4:1', '1:8', '8:1', '2:1', '1:2', '3:1', '1:3', '9:21',
    ];
    const ratioButtons = page.locator('.capability-image-profile ic-aspect-ratio-picker button[data-value]');
    assert.deepEqual(await ratioButtons.evaluateAll(buttons => buttons.map(button => button.dataset.value)), imageRatios);
    assert.deepEqual((await page.locator('[data-choice-kind="resolution"]').evaluateAll(buttons => buttons.map(button => button.dataset.choiceValue))), ['0.5K', '1K', '1.5K', '2K', '4K', 'auto']);
    const reusedControls = await page.locator('.capability-image-profile').evaluate(profile => {
      const ratios = profile.querySelector('ic-aspect-ratio-picker');
      const count = profile.querySelector('[data-output-maximum]');
      return {
        ratioMultiple: ratios?.hasAttribute('multiple'),
        ratioVariant: ratios?.dataset.componentVariant,
        ratioValues: ratios?.values,
        countVariant: count?.dataset.componentVariant,
        referenceEnabled: profile.querySelector('[data-reference-enabled]')?.checked,
        referenceMaximum: profile.querySelector('[data-reference-maximum]')?.value,
        hasLayerFeature: Boolean(profile.querySelector('[data-layer-decomposition]')),
      };
    });
    assert.deepEqual(reusedControls, {
      ratioMultiple: true,
      ratioVariant: 'multiple',
      ratioValues: ['1:1'],
      countVariant: 'generation-count',
      referenceEnabled: true,
      referenceMaximum: '2',
      hasLayerFeature: true,
    });
    if (process.env.MODEL_CAPABILITY_EDITOR_SCREENSHOT) {
      await page.waitForFunction(() => document.querySelector('#capability-editor-dialog')?.dataset.motionState === 'open');
      await page.screenshot({ path: process.env.MODEL_CAPABILITY_EDITOR_SCREENSHOT, fullPage: true });
    }
    await page.locator('[data-choice-value="0.5K"]').click();
    await page.locator('.capability-image-profile ic-aspect-ratio-picker button[data-value="1:8"]').click();
    await page.locator('.capability-image-profile ic-aspect-ratio-picker button[data-value="5:4"]').click();
    await page.locator('#capability-apply').click();
    await page.waitForFunction(() => document.querySelector('#capability-message').textContent.includes('已保存'));
    await page.waitForFunction(() => !document.querySelector('#capability-editor-dialog')?.open);
    assert.equal(state.applied, 1);
    assert.equal(state.appliedPayload.operations.length, 3);
    const appliedGenerate = state.appliedPayload.operations.find(item => item.operation === 'image.generate');
    const appliedEdit = state.appliedPayload.operations.find(item => item.operation === 'image.edit');
    const appliedLayer = state.appliedPayload.operations.find(item => item.operation === 'image.layer_decomposition');
    assert.equal(appliedGenerate.inputs.image, 0);
    assert.equal(appliedEdit.inputs.image, 2);
    assert.equal(appliedGenerate.output_count_maximum, 2);
    assert.deepEqual(appliedGenerate.resolutions, ['0.5K', '1K']);
    assert.deepEqual([...appliedGenerate.aspect_ratios].sort(), ['1:1', '1:8', '5:4']);
    assert.deepEqual(appliedEdit.resolutions, appliedGenerate.resolutions);
    assert.deepEqual(appliedEdit.aspect_ratios, appliedGenerate.aspect_ratios);
    assert.equal(appliedLayer.confirmed, false);
    const generationOrder = await page.evaluate(() => {
      const picker = document.createElement('ic-generation-settings-picker');
      picker.setAttribute('ratio-presets', 'source,16:9,1:1,21:9,2:3,3:2,4:3,3:4,9:16,4:5,5:4,8:1,1:8');
      picker.setAttribute('ratio', '16:9');
      picker.setAttribute('resolutions', '1K,2K,4K,0.5K');
      picker.setAttribute('resolution', '2K');
      document.body.appendChild(picker);
      const ratios = picker.shadowRoot.querySelector('ic-aspect-ratio-picker');
      const result = {
        ratios: [...ratios.shadowRoot.querySelectorAll('button[data-value]')].map(button => button.dataset.value),
        resolutions: [...picker.shadowRoot.querySelectorAll('[data-resolution]')].map(button => button.dataset.resolution),
        selectedRatio: ratios.value,
        selectedResolution: picker.shadowRoot.querySelector('[data-resolution][aria-checked="true"]').dataset.resolution,
      };
      picker.remove();
      return result;
    });
    assert.deepEqual(generationOrder, {
      ratios: ['source', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5', '21:9', '1:8', '8:1'],
      resolutions: ['0.5K', '1K', '2K', '4K'],
      selectedRatio: '16:9', selectedResolution: '2K',
    });


    await page.locator('#model-types [data-value="video"]').click();
    await page.waitForFunction(() => document.querySelector('#catalog-title')?.textContent.trim() === '视频模型');
    await page.waitForFunction(() => document.querySelectorAll('#model-list .model-row').length === 1);
    await page.locator('#model-list .model-capability-edit').click();
    await page.waitForFunction(() => document.querySelector('#capability-editor-dialog')?.open);
    assert.equal(await page.locator('.capability-video-profile').count(), 1);
    assert.deepEqual(await page.locator('.capability-video-profile ic-aspect-ratio-picker button[data-value]').evaluateAll(buttons => buttons.map(button => button.dataset.value)), ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']);
    assert.equal(await page.locator('.capability-operation-card').count(), 0);
    assert.equal((await page.locator('.capability-video-profile h4').textContent()).trim(), '视频能力');
    const videoControls = await page.locator('.capability-video-profile').evaluate(profile => ({
      imageMaximum: profile.querySelector('[data-input-maximum="image"]')?.value,
      videoMaximum: profile.querySelector('[data-input-maximum="video"]')?.value,
      audioMaximum: profile.querySelector('[data-input-maximum="audio"]')?.value,
      totalMaximum: profile.querySelector('[data-video-input-total-maximum]')?.value,
      eachMinimum: profile.querySelector('[data-video-reference-each-minimum]')?.value,
      eachMaximum: profile.querySelector('[data-video-reference-each-maximum]')?.value,
      combinedMinimum: profile.querySelector('[data-video-reference-combined-minimum]')?.value,
      combinedMaximum: profile.querySelector('[data-video-reference-combined-maximum]')?.value,
      audioOnly: profile.querySelector('[data-video-audio-only]')?.checked,
      firstLastFrames: profile.querySelector('[data-video-mode="first_last_frames"]')?.checked,
      allAroundReference: profile.querySelector('[data-video-mode="multimodal_all_around"]')?.checked,
      outputMinimum: profile.querySelector('[data-video-output-minimum]')?.value,
      outputMaximum: profile.querySelector('[data-video-output-maximum]')?.value,
      ratioMultiple: profile.querySelector('ic-aspect-ratio-picker')?.hasAttribute('multiple'),
    }));
    assert.deepEqual(videoControls, {
      imageMaximum: '9', videoMaximum: '3', audioMaximum: '3', totalMaximum: '12',
      eachMinimum: '2', eachMaximum: '15', combinedMinimum: '2', combinedMaximum: '15',
      audioOnly: false, firstLastFrames: true, allAroundReference: true,
      outputMinimum: '4', outputMaximum: '15', ratioMultiple: true,
    });
    if (process.env.MODEL_CAPABILITY_VIDEO_EDITOR_SCREENSHOT) {
      await page.waitForFunction(() => document.querySelector('#capability-editor-dialog')?.dataset.motionState === 'open');
      await page.screenshot({ path: process.env.MODEL_CAPABILITY_VIDEO_EDITOR_SCREENSHOT, fullPage: true });
    }
    await page.locator('#capability-apply').click();
    await page.waitForFunction(() => !document.querySelector('#capability-editor-dialog')?.open);
    assert.equal(state.applied, 2);
    assert.equal(state.appliedPayload.operations.length, 1);
    const appliedVideo = state.appliedPayload.operations[0];
    assert.equal(appliedVideo.operation, 'video.generate');
    assert.deepEqual(appliedVideo.inputs, { text: 1, image: 9, video: 3, audio: 3, file: 0 });
    assert.deepEqual(appliedVideo.video, videoOperation.video);
    assert.deepEqual(appliedVideo.resolutions, ['720p']);
    assert.deepEqual(appliedVideo.aspect_ratios, ['16:9', '9:16']);

    assert.equal(await page.locator('#capability-refresh').count(), 0);

    assert.equal(await page.locator('#capability-import-open').count(), 0);
    assert.equal(await page.locator('#capability-import-dialog').count(), 0);
    if (process.env.MODEL_CAPABILITY_SCREENSHOT) await page.screenshot({ path: process.env.MODEL_CAPABILITY_SCREENSHOT, fullPage: true });

    await page.locator('#model-types [data-value="image"]').click();
    await page.waitForFunction(() => document.querySelector('#catalog-title')?.textContent.trim() === '图片模型');

    await page.evaluate(() => {
      localStorage.setItem('studio_lang', 'en');
      document.documentElement.lang = 'en';
      window.StudioI18n.apply();
      window.dispatchEvent(new CustomEvent('studio-lang-change', { detail: { lang: 'en' } }));
    });
    assert.equal((await page.locator('#catalog-title').textContent()).trim(), 'Image models');
    assert.equal((await page.locator('#model-list .model-capability-edit').textContent()).trim(), 'Edit');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#model-list .model-capability-edit').click();
    await page.waitForFunction(() => document.querySelector('#capability-editor-dialog')?.open);
    assert.equal((await page.locator('.capability-image-profile h4').textContent()).trim(), 'Image capabilities');
    assert.equal(
      await page.locator('.capability-image-profile [data-reference-enabled]').getAttribute('label'),
      'Supports reference images',
    );
    const narrow = await page.evaluate(() => ({
      editorColumns: getComputedStyle(document.querySelector('.capability-choice-grid')).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(narrow.editorColumns, 1);
    assert.ok(narrow.overflow <= 1, JSON.stringify(narrow));
    await page.locator('#capability-editor-close').click();
    await page.waitForFunction(() => !document.querySelector('#capability-editor-dialog')?.open);
    await page.locator('#model-types [data-value="video"]').click();
    await page.waitForFunction(() => document.querySelector('#catalog-title')?.textContent.trim() === 'Video models');
    await page.locator('#model-list .model-capability-edit').click();
    await page.waitForFunction(() => document.querySelector('#capability-editor-dialog')?.open);
    assert.equal((await page.locator('.capability-video-profile h4').textContent()).trim(), 'Video capabilities');
    narrow.videoOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(narrow.videoOverflow <= 1, JSON.stringify(narrow));
    await page.locator('#capability-editor-close').click();
    await page.waitForFunction(() => !document.querySelector('#capability-editor-dialog')?.open);
    await page.evaluate(() => window.StudioTheme.set('light'));
    const lightTheme = await page.evaluate(() => document.documentElement.dataset.uiTheme === 'light' || document.documentElement.classList.contains('theme-light'));
    assert.equal(lightTheme, true);
    assert.deepEqual(pageErrors, []);
    process.stdout.write(`${JSON.stringify({ desktop, narrow, lightTheme, applied: state.applied, refreshed: state.refreshed })}\n`);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
