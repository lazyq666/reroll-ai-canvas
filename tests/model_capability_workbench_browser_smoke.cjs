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
const matrix = {
  models: [
    {
      id: 'shared-image', model_id: 'shared-image', name: 'Shared Image', names: ['Shared Image'],
      types: ['image'], providers: [{ id: 'one', name: 'Platform One' }, { id: 'two', name: 'Platform Two' }],
      operations: [operation('image.generate'), operation('image.edit'), layerDecomposition],
      evidence_count: 2, confirmed_count: 2, operation_count: 3,
      review: { draft: 0, in_review: 0, published: 2 },
    },
    {
      id: 'text-model', model_id: 'text-model', name: 'Text Model', names: ['Text Model'],
      types: ['text'], providers: [{ id: 'three', name: 'Platform Three' }],
      operations: [{
        operation: 'text.generate', confirmed: false,
        inputs: { text: 1, image: 0, video: 0, audio: 0, file: 0 },
        resolutions: [], aspect_ratios: [], output_count_maximum: 1, options: {},
      }],
      evidence_count: 0, confirmed_count: 0, operation_count: 1,
      review: { draft: 0, in_review: 0, published: 0 },
    },
  ],
  summary: { models: 2, confirmed: 1, needs_sources: 1, with_sources: 1 },
  catalog_revision: 'catalog-revision-1',
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function startServer(state) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/admin/available-models') return json(response, 200, { models: { image: [], video: [], text: [] } });
    if (url.pathname === '/api/admin/model-capability-matrix' && request.method === 'GET') return json(response, 200, matrix);
    if (url.pathname === '/api/admin/model-capability-matrix' && request.method === 'PUT') {
      state.applied += 1;
      request.resume();
      return request.on('end', () => json(response, 200, { result: { published: 2 }, matrix }));
    }
    if (url.pathname === '/api/admin/model-capability-matrix/import' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      return request.on('end', () => {
        const payload = JSON.parse(body);
        const preview = { models: 1, operations: 1, platform_variants: 2, models_unchanged: 1 };
        if (payload.apply) state.imported += 1;
        else state.previewed += 1;
        return json(response, 200, payload.apply
          ? { applied: true, preview, published: 2, matrix }
          : { applied: false, preview });
      });
    }
    if (url.pathname === '/api/admin/model-capabilities/refresh' && request.method === 'POST') {
      state.refreshed += 1;
      return json(response, 200, { refresh: { evidence_created: 0, drafts_created: 0 } });
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
  const state = { applied: 0, refreshed: 0, previewed: 0, imported: 0 };
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
    await page.locator('#management-sections > button[data-value="capabilities"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#capability-model-rows tr').length === 2);

    const desktop = await page.evaluate(() => ({
      rows: document.querySelectorAll('#capability-model-rows tr').length,
      platformsInFirstRow: document.querySelectorAll('#capability-model-rows tr:first-child td:nth-child(2) .capability-chip').length,
      modelCount: document.querySelector('#capability-model-count').textContent.trim(),
      hasJsonEditor: document.body.textContent.includes('Inputs JSON'),
      hasProviderIdField: Boolean(document.querySelector('#capability-provider')),
      hasBuiltInAi: document.body.textContent.includes('AI 补全能力'),
      dark: document.documentElement.dataset.uiTheme === 'dark' || document.documentElement.classList.contains('theme-dark'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(desktop.rows, 2);
    assert.equal(desktop.platformsInFirstRow, 2);
    assert.equal(desktop.modelCount, '2');
    assert.equal(desktop.hasJsonEditor, false);
    assert.equal(desktop.hasProviderIdField, false);
    assert.equal(desktop.hasBuiltInAi, false);
    assert.equal(desktop.dark, true);
    assert.ok(desktop.overflow <= 1);

    await page.locator('#capability-model-rows tr:first-child ic-button').click();
    await page.waitForFunction(() => !document.querySelector('#capability-editor').hidden);
    assert.equal(await page.locator('.capability-operation-card').count(), 3);
    assert.ok(await page.locator('[data-input-type]').count() >= 15);
    assert.ok(await page.locator('[data-choice-kind="resolution"]').count() >= 4);
    const layerCard = page.locator('.capability-operation-card[data-operation="image.layer_decomposition"]');
    assert.equal(await layerCard.locator('[data-input-type]').count(), 5);
    assert.equal(await layerCard.locator('[data-input-type]:disabled').count(), 5);
    assert.equal(
      await layerCard.locator('[data-output-maximum]').evaluate(control => control.hasAttribute('disabled')),
      true,
    );
    await page.locator('#capability-apply').click();
    await page.waitForFunction(() => document.querySelector('#capability-message').textContent.includes('已保存'));
    assert.equal(state.applied, 1);

    await page.locator('#capability-refresh').click();
    await page.waitForFunction(() => document.querySelector('#capability-message').textContent.includes('仍有 1 个模型缺少资料'));
    assert.equal(state.refreshed, 1);

    await page.locator('#capability-import-open').click();
    await page.waitForFunction(() => document.querySelector('#capability-import-dialog')?.open);
    const importBundle = {
      schema_version: 1,
      models: [{
        model_id: 'shared-image', name: 'Shared Image',
        operations: [{
          operation: 'image.generate', confirmed: true,
          inputs: { text: 1, image: 0, video: 0, audio: 0, file: 0 },
          resolutions: ['1K'], aspect_ratios: ['1:1'], output_count_maximum: 1,
          options: [],
          sources: [{
            type: 'official_docs', url: 'https://example.com/shared-image',
            title: 'Official docs', excerpt: 'The model generates one image.',
          }],
        }],
      }],
    };
    await page.locator('#capability-import-data').evaluate((control, value) => {
      control.value = value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }, JSON.stringify(importBundle));
    await page.locator('#capability-import-preview').click();
    await page.waitForFunction(() => document.querySelector('#capability-import-status').textContent.includes('校验通过'));
    assert.equal(state.previewed, 1);
    const importApplyState = await page.locator('#capability-import-apply').evaluate(control => ({
      attribute: control.hasAttribute('disabled'),
      property: control.disabled,
      internal: control.shadowRoot?.querySelector('button')?.disabled,
    }));
    assert.deepEqual(importApplyState, { attribute: false, property: false, internal: false });
    if (process.env.MODEL_CAPABILITY_IMPORT_SCREENSHOT) {
      await page.screenshot({ path: process.env.MODEL_CAPABILITY_IMPORT_SCREENSHOT, fullPage: true });
    }
    await page.locator('#capability-import-apply').click();
    await page.waitForFunction(() => !document.querySelector('#capability-import-dialog')?.open);
    assert.equal(state.imported, 1);
    assert.ok((await page.locator('#capability-message').textContent()).includes('已导入'));
    if (process.env.MODEL_CAPABILITY_SCREENSHOT) await page.screenshot({ path: process.env.MODEL_CAPABILITY_SCREENSHOT, fullPage: true });

    await page.evaluate(() => {
      localStorage.setItem('studio_lang', 'en');
      document.documentElement.lang = 'en';
      window.StudioI18n.apply();
      window.dispatchEvent(new CustomEvent('studio-lang-change', { detail: { lang: 'en' } }));
    });
    assert.equal((await page.locator('#capability-workbench-title').textContent()).trim(), 'Model capabilities');

    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await page.evaluate(() => ({
      editorColumns: getComputedStyle(document.querySelector('.capability-choice-grid')).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(narrow.editorColumns, 1);
    assert.ok(narrow.overflow <= 1, JSON.stringify(narrow));
    await page.locator('#capability-import-open').click();
    await page.waitForFunction(() => document.querySelector('#capability-import-dialog')?.open);
    narrow.importOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(narrow.importOverflow <= 1, JSON.stringify(narrow));
    await page.locator('#capability-import-cancel').click();
    await page.evaluate(() => window.StudioTheme.set('light'));
    const lightTheme = await page.evaluate(() => document.documentElement.dataset.uiTheme === 'light' || document.documentElement.classList.contains('theme-light'));
    assert.equal(lightTheme, true);
    assert.deepEqual(pageErrors, []);
    process.stdout.write(`${JSON.stringify({ desktop, narrow, lightTheme, applied: state.applied, refreshed: state.refreshed, previewed: state.previewed, imported: state.imported })}\n`);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
