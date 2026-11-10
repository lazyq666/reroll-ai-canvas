const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const port = 19674;
const output = '/private/tmp/model-providers-inline-review';

(async () => {
  fs.mkdirSync(output, {recursive:true});
  const server = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd:root, env:{...process.env, API_SETTINGS_PREVIEW_PORT:String(port)}, stdio:['ignore','pipe','pipe'],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', chunk => {if(String(chunk).includes('API Settings preview:')) resolve();});
      server.on('exit', code => reject(new Error(`Preview exited ${code}`)));
    });
    browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const models = Array.from({length:25}, (_, index) => `custom-image-${String(index + 1).padStart(2,'0')}`);
    let requests = 0;
    await page.route('**/api/providers/fetch-models', async route => {
      requests += 1;
      await route.fulfill({json:{all:models,image_models:models,model_names:Object.fromEntries(models.map(id => [id,id.replace('custom-image-','Custom Image ')]))}});
    });
    await page.goto(`http://127.0.0.1:${port}/api-settings`);
    await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
    await page.locator('#fetchModelsBtn').click();
    await page.locator('#modelDiscoveryResults').waitFor({state:'visible'});
    assert.equal(await page.locator('ic-dialog[open]').count(),0);
    assert.equal(await page.locator('#modelPickerPanel').evaluate(panel => panel.closest('#modelsCard') !== null),true);
    assert.equal(await page.locator('#pickerList ic-checkbox').count(),12);
    await page.locator('#pickerShowMore').click();
    assert.equal(await page.locator('#pickerList ic-checkbox').count(),30);
    assert.equal(await page.locator('#pickerList ic-checkbox[disabled]').count(),5);
    await page.locator('#pickerSelectAll').click();
    assert.equal(await page.locator('#pickerCount').textContent(),'已选 25 个模型');
    await page.locator('#pickerFilter input').fill('custom-image-01');
    await page.locator('#pickerSelectNone').click();
    assert.equal(await page.locator('#pickerCount').textContent(),'已选 24 个模型');
    await page.locator('#pickerFilter input').fill('no-such-model');
    assert.equal(await page.locator('#pickerList ic-empty-state').count(),1);
    assert.equal(await page.locator('#pickerSelectAll').evaluate(button => button.disabled),true);
    await page.locator('#pickerFilter input').fill('');
    await page.locator('#modelSourceTabs [data-value="added"]').click();
    assert.equal(await page.locator('#model-catalog').isVisible(),true);
    await page.locator('#fetchModelsBtn').click();
    assert.equal(requests,1,'Switching views must preserve the fetched catalog and choices');
    assert.equal(await page.locator('#pickerCount').textContent(),'已选 24 个模型');
    await page.locator('#pickerSelectNone').click();
    await page.locator('#picker-choice-0').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#pickerCount').textContent(),'已选 1 个模型');
    await page.waitForFunction(() => document.activeElement.id === 'picker-choice-0');
    for(const language of ['zh','en']){
      await page.evaluate(value => window.StudioI18n.set(value),language);
      assert.equal(await page.locator('#pickerCount').textContent(),language === 'zh' ? '已选 1 个模型' : '1 model selected');
      for(const theme of ['light','dark']){
        await page.evaluate(value => window.StudioTheme.set(value),theme);
        for(const width of [1440,390]){
          await page.setViewportSize({width,height:1000});
          await page.screenshot({path:path.join(output,`catalog-${language}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
          assert.equal(await page.locator('ic-dialog[open]').count(),0);
          assert.notEqual(await page.locator('#fetchModelsBtn').evaluate(button => getComputedStyle(button).backgroundColor),'rgba(0, 0, 0, 0)');
        }
      }
    }
    await page.locator('#applyModelPickerBtn').click();
    await page.locator('#modelPickerPanel').waitFor({state:'hidden'});
    await page.waitForSelector('.model-row[data-model-id="long-provider-name:custom-image-01"]');
    await page.locator('#manualModelToggle').click();
    await page.locator('#manualModelSubmit').click();
    assert.equal(await page.locator('#manualModelError').isVisible(),true);
    await page.locator('#manualModelId input').fill('manual-image');
    await page.locator('#manualModelName input').fill('我的绘图模型');
    assert.equal(await page.locator('#manualModelType ic-radio[value="image"]').getAttribute('label'),'Image');
    await page.locator('#manualModelType ic-radio[value="video"]').click();
    await page.waitForFunction(() => document.getElementById('manualModelType').value === 'video');
    await page.evaluate(() => window.StudioI18n.set('zh'));
    await page.waitForFunction(() => document.querySelector('#manualModelType ic-radio[value="video"]').label === '视频');
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForFunction(() => document.querySelector('#manualModelType ic-radio[value="video"]').label === 'Video');
    assert.equal(await page.locator('#manualModelError').isVisible(),false);
    assert.equal(await page.locator('#manualModelPanel').evaluate(panel => [...panel.querySelectorAll('ic-input,ic-radio-group')].every(field => {
      const bounds = field.getBoundingClientRect();
      const card = document.getElementById('modelsCard').getBoundingClientRect();
      return bounds.left >= card.left && bounds.right <= card.right;
    })),true,'Manual form fields must not clip on narrow screens');
    await page.screenshot({path:path.join(output,'manual-en-dark-390.png'),fullPage:true,animations:'disabled'});
    await page.locator('#manualModelSubmit').click();
    await page.locator('#manualModelPanel').waitFor({state:'hidden'});
    await page.waitForSelector('.model-row[data-model-id="long-provider-name:manual-image"]');
    assert.equal(await page.locator('ic-dialog[open]').count(),0);
    const stored = await page.evaluate(async () => fetch('/api/test/state').then(response => response.json()));
    assert.equal(stored.providers.find(provider => provider.id === 'long-provider-name').model_names['manual-image'],'我的绘图模型');
    await page.unroute('**/api/providers/fetch-models');
    let releaseResponse;
    let signalRequest;
    const requestStarted = new Promise(resolve => {signalRequest = resolve;});
    await page.route('**/api/providers/fetch-models', async route => {
      await new Promise(resolve => {releaseResponse = resolve; signalRequest();});
      await route.fulfill({json:{all:['stale-model'],image_models:['stale-model']}});
    });
    await page.locator('#fetchModelsBtn').click();
    await page.locator('#modelDiscoveryLoading').waitFor({state:'visible'});
    await requestStarted;
    await page.locator('#modelSourceTabs [data-value="added"]').click();
    assert.equal(await page.locator('#modelPickerPanel').isVisible(),false);
    const completed = page.waitForResponse('**/api/providers/fetch-models');
    releaseResponse();
    await completed;
    await page.locator('#manualModelToggle').click();
    assert.equal(await page.locator('#modelPickerPanel').isVisible(),false,'Late discovery must not reopen the catalog');
    assert.equal(await page.locator('#pickerList').textContent().then(text => text.includes('stale-model')),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: inline catalog/manual entry, chips, bulk selection, filtering, expansion, keyboard focus, local names, late responses, languages, themes and widths.');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {console.error(error);process.exitCode=1;});
