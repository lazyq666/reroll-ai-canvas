const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = require('node:path').resolve(__dirname, '..');
const PORT = 19000 + Math.floor(Math.random() * 500);
const browserExecutable = process.env.API_SETTINGS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function waitForPreview(server) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Preview did not start: ${output}`)), 10000);
    const inspect = chunk => {
      output += chunk.toString();
      if (!output.includes('API Settings preview:')) return;
      clearTimeout(timer);
      resolve();
    };
    server.stdout.on('data', inspect);
    server.stderr.on('data', inspect);
    server.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Preview exited before startup (${code}): ${output}`));
    });
  });
}

(async () => {
  const preview = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd: ROOT,
    env: { ...process.env, API_SETTINGS_PREVIEW_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    await waitForPreview(preview);
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/providers/fetch-models', route => {
      const protocol = route.request().postDataJSON()?.protocol;
      const payload = protocol === 'codex' ? {
        all: ['gpt-image-2', 'gpt-5.5'],
        image_models: ['gpt-image-2'],
        chat_models: ['gpt-5.5'],
        video_models: [],
        model_names: {},
        total: 2,
        protocol: 'codex',
        image_request_mode: 'openai',
      } : {
        all: ['5.0', '5.0Pro', '4.7', 'seedance2.5'],
        image_models: ['5.0', '5.0Pro', '4.7'],
        chat_models: [],
        video_models: ['seedance2.5'],
        model_names: { '5.0': '5.0 Lite', '5.0Pro': '5.0 Pro' },
        total: 4,
        protocol: 'jimeng',
        image_request_mode: 'openai',
        capability_review: {
          ok: true,
          source_count: 1,
          record_count: 24,
          drafts_created: 3,
          evidence_created: 3,
          sources: [],
          errors: [],
        },
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
    await page.goto(`http://127.0.0.1:${PORT}/api-settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof selectProvider === 'function'
      && document.querySelector('[data-value="modelscope"]'));

    await page.evaluate(async () => {
      await addCliProvider('jimeng');
      await fetchModels();
    });
    await page.waitForFunction(() => typeof pickerState !== 'undefined'
      && Object.prototype.hasOwnProperty.call(pickerState.selected, '4.7'));
    const capabilityFeedback = await page.evaluate(() => ({
      zh: modelCapabilityReviewNote({
        ok: true,
        source_count: 1,
        record_count: 24,
        drafts_created: 3,
      }),
      en: (() => {
        StudioI18n.set('en');
        return modelCapabilityReviewNote({
          ok: true,
          source_count: 1,
          record_count: 24,
          drafts_created: 3,
        });
      })(),
    }));
    assert.match(capabilityFeedback.zh, /已提取 24 项能力资料，新增 3 个待审核建议/);
    assert.match(capabilityFeedback.en, /Extracted 24 capability records and added 3 review drafts/);
    await page.evaluate(() => StudioI18n.set('zh'));
    await page.evaluate(() => {
      pickerState.selected['4.7'] = false;
      applyModelPicker();
    });
    await page.waitForFunction(() => autoSaveState.phase === 'saved');

    const savedState = await page.evaluate(async () => {
      const serverState = await fetch('/api/test/state').then(response => response.json());
      return {
        uiModels: [...provider().image_models],
        persistedModels: serverState.providers.find(item => item.id === 'jimeng')?.image_models || [],
      };
    });
    assert.ok(!savedState.uiModels.includes('4.7'), 'deleted model was restored in the editor');
    assert.ok(!savedState.persistedModels.includes('4.7'), 'deleted model was restored before persistence');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof selectProvider === 'function'
      && document.querySelector('[data-value="jimeng"]'));
    const reloadedModels = await page.evaluate(() => {
      selectProvider('jimeng');
      return [...provider().image_models];
    });
    assert.ok(!reloadedModels.includes('4.7'), 'deleted model returned after reloading API Settings');

    await page.evaluate(async () => {
      await addCliProvider('codex');
      await fetchModels();
    });
    await page.waitForFunction(() => Object.prototype.hasOwnProperty.call(
      pickerState.selected,
      'gpt-image-2',
    ));
    await page.evaluate(() => {
      pickerState.selected['gpt-image-2'] = false;
      applyModelPicker();
    });
    await page.waitForFunction(() => autoSaveState.phase === 'saved');
    const codexSavedModels = await page.evaluate(() => [...provider().image_models]);
    assert.ok(!codexSavedModels.includes('gpt-image-2'), 'deleted Codex CLI model was restored during save');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof selectProvider === 'function'
      && document.querySelector('[data-value="codex"]'));
    const codexReloadedModels = await page.evaluate(() => {
      selectProvider('codex');
      return [...provider().image_models];
    });
    assert.ok(!codexReloadedModels.includes('gpt-image-2'), 'deleted Codex CLI model returned after reload');
    process.stdout.write(`${JSON.stringify({ capabilityFeedback, savedState, reloadedModels, codexSavedModels, codexReloadedModels })}\n`);
  } finally {
    await browser?.close();
    preview.kill('SIGTERM');
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
