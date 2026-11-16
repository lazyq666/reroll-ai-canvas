const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const port = 19679;
  const output = '/private/tmp/laz139-review';
  fs.mkdirSync(output, {recursive: true});
  const server = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    env: {...process.env, API_SETTINGS_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', chunk => { if (String(chunk).includes('API Settings preview:')) resolve(); });
      server.on('exit', code => reject(new Error(`Preview exited ${code}`)));
    });
    browser = await chromium.launch({headless: true, args: ['--disable-gpu'], executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let requests = 0;
    let failFetch = false;
    let parameterSave;
    let parameterRestore;
    const matrix = providerId => ({
      models: providerId ? [{
        model_id: 'gpt-image-2', name: 'GPT Image 2', provider_id: providerId,
        types: ['image'], evidence_count: 1, has_auto_fill_backup: true,
        operations: ['image.generate', 'image.edit'].map(operation => ({
          operation, confirmed: true, inputs: {text: 1, image: operation === 'image.edit' ? 3 : 0},
          resolutions: ['1K', '2K'], aspect_ratios: ['1:1'], output_count_maximum: 4,
          options: {}, qualities: [], formats: [],
        })),
      }] : [],
    });
    await page.route('**/api/admin/model-capability-matrix**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'PUT') parameterSave = request.postDataJSON();
      if (url.pathname.endsWith('/restore')) parameterRestore = request.postDataJSON();
      const providerId = url.searchParams.get('provider_id') || request.postDataJSON()?.provider_id || '';
      await route.fulfill({json: request.method() === 'GET' ? matrix(providerId) : {matrix: matrix(providerId)}});
    });
    const candidates = Array.from({length: 20}, (_, index) => `image-candidate-${index}`);
    await page.route('**/api/providers/fetch-models', async route => {
      requests += 1;
      await route.fulfill(failFetch ? {status: 502, json: {detail: 'upstream unavailable'}} : {
        json: {all: candidates, image_models: candidates, chat_models: [], video_models: [],
          capability_review: {ok: true, applied_count: 2}},
      });
    });
    const openProvider = async () => {
      await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
      await page.waitForFunction(() => !document.getElementById('modelDiscoveryResults').hidden
        && document.getElementById('modelDiscoveryLoading').hidden
        && document.querySelector('#pickerList ic-checkbox'));
    };
    await page.goto(`http://127.0.0.1:${port}/api-settings`);
    await openProvider();
    assert.equal(requests, 1);
    assert.equal(await page.locator('#modelSourceTabs').count(), 0);
    assert.equal(await page.locator('[onclick="goToCreation()"]').count(), 0);
    assert.equal(await page.locator('#pickerList ic-checkbox[disabled]').count(), 0);
    assert.equal(await page.locator('#pickerCount').textContent(), '已选 5 个模型');
    let failSave = true;
    await page.route('**/api/admin/available-models', async route => {
      if (failSave && route.request().method() === 'PUT') {
        failSave = false;
        await route.fulfill({status: 500, json: {detail: 'save failed'}});
      } else await route.continue();
    });
    await page.locator('#pickerList ic-checkbox[title="gpt-image-2"]').click();
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerList ic-checkbox[title="gpt-image-2"]').evaluate(control => control.checked), true);
    await page.locator('#modelDiscoveryError').waitFor({state: 'visible'});
    await page.evaluate(() => window.StudioI18n.set('en'));
    assert.equal(await page.locator('#modelDiscoveryError').textContent(),
      await page.evaluate(() => window.StudioI18n.t('api.saveFailed')));
    await page.evaluate(() => window.StudioI18n.set('zh'));
    await page.locator('#pickerList ic-checkbox[title="gpt-image-2"]').click();
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerCount').textContent(), '已选 4 个模型');
    assert.equal(await page.locator('#retryDiscovery').isVisible(), false);
    await page.locator('#editProviderModels').click();
    assert.equal(await page.locator('#model-list .model-row').count(), 4);
    assert.equal(await page.locator('#model-list ic-switch').count(), 0);
    assert.equal(await page.locator('#model-list .model-capability-edit').count(), 4);
    await page.locator('[data-i18n="providers.backToModels"]').click();
    await page.locator('#pickerList ic-checkbox[title="gpt-image-2"]').click();
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerCount').textContent(), '已选 5 个模型');
    await page.locator('#pickerShowMore').click();
    await page.locator('#pickerList ic-checkbox[title="image-candidate-0"]').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerCount').textContent(), '已选 6 个模型');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('title')), 'image-candidate-0');
    await page.locator('#editProviderModels').click();
    await page.locator('.model-row[data-model-id="long-provider-name:gpt-image-2"] .model-capability-edit').click();
    await page.locator('#capability-editor').waitFor({state: 'visible'});
    await page.locator('#capability-apply').click();
    await page.locator('#capability-editor-dialog').waitFor({state: 'hidden'});
    assert.equal(parameterSave.provider_id, 'long-provider-name');
    assert.equal(parameterSave.model_id, 'gpt-image-2');
    await page.locator('.model-row[data-model-id="long-provider-name:gpt-image-2"] .model-capability-edit').click();
    await page.locator('#capability-editor').waitFor({state: 'visible'});
    await page.locator('#capability-more [slot="trigger"]').click();
    await page.locator('#capability-restore').click();
    await page.locator('#capability-editor-dialog').waitFor({state: 'hidden'});
    assert.deepEqual(parameterRestore, {provider_id: 'long-provider-name', model_id: 'gpt-image-2'});
    await page.locator('[data-i18n="providers.backToModels"]').click();
    for (const language of ['zh', 'en']) {
      await page.evaluate(value => window.StudioI18n.set(value), language);
      assert.equal(await page.locator('#editProviderModels').textContent(), language === 'zh' ? '编辑模型参数' : 'Edit model parameters');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => window.StudioTheme.set(value), theme);
        for (const width of [1440, 390]) {
          await page.setViewportSize({width, height: 1000});
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await page.locator('#manualModelToggle').evaluate(button => button.getBoundingClientRect().right <= innerWidth), true);
          await page.screenshot({path: `${output}/${language}-${theme}-${width}.png`, animations: 'disabled'});
        }
      }
    }
    await page.reload();
    await openProvider();
    assert.equal(requests, 1, 'fresh cache prevents another request');
    assert.equal(await page.locator('#pickerCount').textContent(), '6 models selected');
    const cacheKey = 'reroll:provider-models:v1:long-provider-name';
    await page.evaluate(key => {
      const entry = JSON.parse(localStorage.getItem(key));
      entry.fetchedAt -= 8 * 24 * 60 * 60 * 1000;
      localStorage.setItem(key, JSON.stringify(entry));
    }, cacheKey);
    failFetch = true;
    await page.reload();
    await openProvider();
    await page.locator('#modelDiscoveryError').waitFor({state: 'visible'});
    assert.equal(requests, 2);
    assert.equal(await page.locator('#pickerList ic-checkbox').count(), 12);
    const failedTimestamp = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).fetchedAt, cacheKey);
    assert.ok(Date.now() - failedTimestamp > 7 * 24 * 60 * 60 * 1000);
    failFetch = false;
    await page.locator('#fetchModelsBtn').click();
    await page.waitForFunction(() => document.getElementById('modelDiscoveryLoading').hidden);
    assert.equal(requests, 3);
    assert.equal(await page.locator('#modelDiscoveryError').isVisible(), false);
    await page.locator('#pickerFilter input').fill('image-candidate-');
    await page.locator('#pickerSelectAll').click();
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerCount').textContent(), '25 models selected');
    await page.locator('#pickerSelectNone').click();
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerCount').textContent(), '5 models selected');
    await page.locator('#pickerFilter input').fill('not-a-model');
    assert.equal(await page.locator('#pickerList ic-empty-state').count(), 1);
    await page.locator('#pickerFilter input').fill('');
    await page.locator('#manualModelToggle').click();
    await page.locator('#manualModelId input').fill('manual-image');
    await page.locator('#manualModelName input').fill('Manual Image');
    await page.locator('#manualModelSubmit').click();
    await page.waitForFunction(() => !document.getElementById('modelsCard').inert);
    assert.equal(await page.locator('#pickerList ic-checkbox[title="manual-image"]').evaluate(control => control.checked), true);
    assert.deepEqual(errors, []);
    console.log('LAZ-139 browser checks passed: selection, scoped editor, cache, retry, keyboard, languages, themes, mobile.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
