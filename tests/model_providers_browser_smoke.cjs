const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const port = 19670;
const output = process.env.MODEL_PROVIDERS_OUTPUT || '/private/tmp/model-providers-review';

async function checkReadability(page) {
  const measurements = await page.evaluate(() => {
    const luminance = color => {
      const values = color.match(/[\d.]+/g).slice(0,3).map(value => {
        const channel = Number(value) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    };
    const ratio = (foreground, background) => {
      const first = luminance(foreground), second = luminance(background);
      return (Math.max(first,second) + .05) / (Math.min(first,second) + .05);
    };
    const backgroundOf = element => {
      for(let current = element; current; current = current.assignedSlot || current.parentElement || current.getRootNode().host) {
        const color = getComputedStyle(current).backgroundColor;
        const values = color.match(/[\d.]+/g);
        if(values && (values.length === 3 || Number(values[3]) === 1)) return color;
      }
      return 'rgb(255,255,255)';
    };
    const results = ['#providerName','#providerSaveStatus','.model-id-subline'].map(selector => {
      const element = document.querySelector(selector);
      return {selector, ratio:ratio(getComputedStyle(element).color,backgroundOf(element)), minimum:4.5};
    });
    document.querySelectorAll('.model-visibility-checkbox').forEach(element => {
      const control = element.shadowRoot.querySelector('[part="control"]');
      results.push({selector:`model switch ${element.checked}`,ratio:ratio(getComputedStyle(control).borderColor,backgroundOf(element)),minimum:3});
    });
    return results;
  });
  for(const measurement of measurements) assert.ok(measurement.ratio >= measurement.minimum, JSON.stringify(measurement));
  return measurements;
}

(async () => {
  fs.mkdirSync(output, {recursive:true});
  const server = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd:root, env:{...process.env, API_SETTINGS_PREVIEW_PORT:String(port)}, stdio:['ignore','pipe','pipe'],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', chunk => { if(String(chunk).includes('API Settings preview:')) resolve(); });
      server.on('exit', code => reject(new Error(`Preview exited ${code}`)));
    });
    browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto(`http://127.0.0.1:${port}/static/api-settings.html`);
    await page.waitForSelector('.provider-summary');
    const buttonContrast = await page.locator('#providerOverview ic-button[hierarchy="primary"] button').evaluate(button => {
      const style = getComputedStyle(button);
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(buttonContrast >= 4.5, `Primary button contrast: ${buttonContrast}`);
    await page.screenshot({path:path.join(output,'providers-light.png'),fullPage:true});
    await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
    await page.waitForSelector('#providerEditor:not([hidden])');
    await page.waitForSelector('#model-list .model-row');
    assert.equal(await page.locator('#model-list .model-row').count(),2);
    assert.equal(await page.locator('.model-row').first().evaluate(row => getComputedStyle(row).display),'table-row');
    assert.equal(await page.locator('#connectionDetails').evaluate(details => details.open),false);
    await page.locator('#model-list .model-name-label').first().click();
    const localName = page.locator('#model-list .model-name-input input').first();
    await localName.fill('我的主力绘图');
    await localName.press('Tab');
    await page.waitForFunction(() => document.querySelector('.model-name-input')?.value === '我的主力绘图');
    await page.waitForFunction(async () => {
      const data = await fetch('/api/test/state').then(response => response.json());
      return data.providers.find(item => item.id === 'long-provider-name').model_names['gpt-image-2'] === '我的主力绘图';
    });
    await page.locator('#model-list .model-visibility-checkbox').first().click();
    await page.waitForFunction(async () => {
      const data = await fetch('/api/test/state').then(response => response.json());
      return data.modelSettings.visible.image && !data.modelSettings.visible.image.includes('long-provider-name:gpt-image-2');
    });
    await page.locator('#model-list .model-more').first().click();
    await page.locator('#model-list .move-down button').first().click();
    await page.waitForFunction(() => document.querySelector('.model-row')?.dataset.modelId === 'long-provider-name:gpt-image-2-4k-preview');
    await page.locator('#fetchModelsBtn').click();
    await page.locator('#manualModelToggle').click();
    await page.locator('#manualModelId input').fill('custom-image');
    await page.locator('#manualModelName input').fill('自定义绘图');
    await page.locator('#manualModelSubmit').click();
    await page.waitForSelector('#manualModelPanel[hidden]',{state:'attached'});
    await page.waitForFunction(() => document.querySelectorAll('#model-list .model-row').length === 3);
    await page.locator('#fetchModelsBtn').click();
    await page.waitForSelector('#modelPickerPanel:not([hidden])',{state:'attached'});
    await page.locator('#modelSourceTabs [data-value="added"]').click();
    await page.waitForSelector('#modelPickerPanel[hidden]',{state:'attached'});
    assert.equal(await page.locator('#model-list .model-row').count(),3);
    await page.screenshot({path:path.join(output,'provider-detail-light.png'),fullPage:true});
    for (const lang of ['en','zh']) {
      await page.evaluate(language => window.StudioI18n.set(language),lang);
      await page.waitForFunction(language => document.querySelector('main h1').textContent === (language === 'en' ? 'Model providers' : '模型供应商'),lang);
      assert.equal(await page.locator('.model-name-label button').filter({visible:true}).count(),3);
    }
    await page.evaluate(() => window.StudioTheme.set('dark'));
    await page.screenshot({path:path.join(output,'provider-detail-dark.png'),fullPage:true,animations:'disabled'});
    for(const width of [768,390]) {
      await page.setViewportSize({width,height:900});
      await page.screenshot({path:path.join(output,`provider-detail-${width}.png`),fullPage:true,animations:'disabled'});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'模型供应商',exact:true}).click();
    await page.waitForSelector('#providerEditor[hidden]',{state:'attached'});
    await page.locator('[data-provider-id="long-provider-name"] .provider-enabled').click();
    await page.waitForFunction(async () => {
      const data = await fetch('/api/test/state').then(response => response.json());
      return data.providers.find(item => item.id === 'long-provider-name').enabled === false;
    });
    await page.reload();
    await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
    await page.waitForSelector('#model-list .model-row');
    assert.ok((await page.locator('.model-name-input input').evaluateAll(inputs => inputs.map(input => input.value))).includes('我的主力绘图'));
    await page.getByRole('button',{name:'模型供应商',exact:true}).click();
    await page.getByRole('button',{name:'添加供应商',exact:true}).click();
    await page.locator('#providerChooser').getByRole('button',{name:'APIMart',exact:true}).click();
    await page.waitForSelector('#providerEditor:not([hidden])');
    assert.equal(await page.locator('#baseInput input').inputValue(),'https://api.apimart.ai/v1');
    assert.equal(await page.locator('#connectionDetails').evaluate(details => details.open),true);
    await page.locator('#fetchModelsBtn').click();
    assert.equal(await page.locator('#modelPickerPanel').evaluate(panel => panel.hidden),true);
    await page.waitForSelector('#keyFormField[invalid]');
    await page.locator('#keyInput input').fill('demo-key-not-a-real-credential');
    await page.locator('#keyInput input').press('Tab');
    await page.waitForFunction(async () => {
      const data = await fetch('/api/test/state').then(response => response.json());
      return data.providers.find(item => item.id === 'apimart')?.has_key;
    });
    await page.locator('#fetchModelsBtn').click();
    await page.waitForSelector('#modelDiscoveryResults:not([hidden])');
    await page.locator('#pickerList ic-checkbox').first().click();
    assert.equal(await page.locator('#pickerCount').textContent(),'已选 1 个模型');
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForFunction(() => document.querySelector('#pickerCount').textContent === '1 model selected');
    await page.evaluate(() => window.StudioI18n.set('zh'));
    let failSelection = true;
    await page.route('**/api/providers', route => route.request().method() === 'PUT' && failSelection
      ? route.fulfill({status:503,contentType:'application/json',body:'{}'}) : route.continue());
    await page.locator('#applyModelPickerBtn').click();
    await page.waitForSelector('#modelDiscoveryError:not([hidden])');
    assert.equal(await page.locator('#modelPickerPanel').evaluate(panel => panel.hidden),false);
    failSelection = false;
    await page.locator('#applyModelPickerBtn').click();
    await page.waitForSelector('#modelPickerPanel[hidden]',{state:'attached'});
    await page.waitForSelector('.model-row[data-model-id="apimart:gpt-5.5"]');
    assert.equal(await page.locator('#model-types').getAttribute('value'),'text');
    await page.unroute('**/api/providers');
    await page.getByRole('button',{name:'模型供应商',exact:true}).click();
    await page.goto(`http://127.0.0.1:${port}/static/available-model-management.html`);
    await page.waitForURL('**/static/api-settings.html');
    await page.waitForSelector('.provider-summary');
    await page.getByRole('button',{name:'备份',exact:true}).click();
    await page.locator('#export-model-settings button').click();
    await page.waitForFunction(() => document.getElementById('apiTransferDialog').open);
    await page.locator('#apiTransferPassword input').fill('test-password');
    await page.locator('#apiTransferPasswordConfirm input').fill('does-not-match');
    await page.locator('#api-transfer-submit').click();
    assert.equal(await page.locator('#api-transfer-error').isVisible(),true);
    await page.locator('#api-transfer-cancel').click();
    await page.waitForFunction(() => document.getElementById('apiTransferDialog').dataset.motionState === 'closed');
    let failProviders = true;
    await page.route('**/api/providers', route => failProviders
      ? route.fulfill({status:503,contentType:'application/json',body:'{}'}) : route.continue());
    await page.reload();
    await page.waitForSelector('#retryProviders:not([hidden])');
    assert.equal(await page.locator('#providers-message').isVisible(),true);
    failProviders = false;
    await page.locator('#retryProviders').click();
    await page.waitForSelector('.provider-summary');
    let failModels = true;
    await page.route('**/api/admin/available-models', route => failModels
      ? route.fulfill({status:503,contentType:'application/json',body:'{}'}) : route.continue());
    await page.reload();
    await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
    await page.waitForSelector('#retryModels:not([hidden])');
    failModels = false;
    await page.locator('#retryModels').click();
    await page.waitForSelector('#model-list .model-row');
    await page.waitForSelector('#retryModels[hidden]',{state:'attached'});
    await page.route('**/api/providers/fetch-models', route => route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await page.locator('#fetchModelsBtn').click();
    await page.waitForSelector('#modelDiscoveryError:not([hidden])');
    await page.locator('#manualModelToggle').click();
    await page.waitForSelector('#manualModelPanel:not([hidden])',{state:'attached'});
    assert.equal(await page.locator('ic-dialog[open]').count(),0);
    await page.locator('#manualModelId input').fill('fallback-image');
    await page.locator('#manualModelName input').fill('备用绘图');
    await page.locator('#manualModelSubmit').click();
    await page.waitForSelector('.model-row[data-model-id="long-provider-name:fallback-image"]');
    const fallbackRow = page.locator('.model-row[data-model-id="long-provider-name:fallback-image"]');
    const orderBeforeRemoval = await page.locator('#model-list .model-row').evaluateAll(rows => rows.map(row => row.dataset.modelId));
    await fallbackRow.locator('.model-visibility-checkbox').click();
    await page.waitForFunction(async () => {
      const data = await fetch('/api/test/state').then(response => response.json());
      return !data.modelSettings.visible.image.includes('long-provider-name:fallback-image');
    });
    await fallbackRow.locator('.model-more').click();
    await fallbackRow.locator('.remove-model button').click();
    await page.waitForSelector('#modelUndo:not([hidden])');
    await page.waitForSelector('.model-row[data-model-id="long-provider-name:fallback-image"]',{state:'detached'});
    assert.equal(await page.locator('#apiActionConfirmation').evaluate(dialog => dialog.open),false);
    await page.getByRole('button',{name:'撤销',exact:true}).click();
    await page.waitForSelector('.model-row[data-model-id="long-provider-name:fallback-image"]');
    assert.equal(await fallbackRow.locator('.model-name-label').textContent(),'备用绘图');
    await page.waitForFunction(() => !document.querySelector('.model-row[data-model-id="long-provider-name:fallback-image"] .model-visibility-checkbox').checked);
    assert.deepEqual(await page.locator('#model-list .model-row').evaluateAll(rows => rows.map(row => row.dataset.modelId)),orderBeforeRemoval);
    await page.unroute('**/api/providers/fetch-models');
    await page.locator('#model-list .model-more').first().click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.model-actions-menu[open]'));
    await page.evaluate(() => window.StudioTheme.set('light'));
    await page.setViewportSize({width:1440,height:1000});
    const visibleSizes = await page.evaluate(() => {
      const sizes = new Set();
      const inspect = root => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while(walker.nextNode()) {
          const node = walker.currentNode;
          if(node.nodeType === Node.ELEMENT_NODE && node.shadowRoot && node.localName !== 'ic-icon') inspect(node.shadowRoot);
          if(node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const parent = node.parentElement;
          if(!parent || ['STYLE','SCRIPT','SVG','PATH'].includes(parent.tagName) || !parent.checkVisibility({visibilityProperty:true, opacityProperty:true})) continue;
          const bounds = parent.getBoundingClientRect();
          if(bounds.width < 2 || bounds.height < 2) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if(![...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) continue;
          sizes.add(Number.parseFloat(getComputedStyle(parent).fontSize));
        }
      };
      inspect(document.body);
      return [...sizes].sort((left,right) => left-right);
    });
    assert.ok(visibleSizes.length <= 4, `Visible text sizes: ${visibleSizes}`);
    assert.ok(visibleSizes.every(size => size >= 12), `Visible text sizes: ${visibleSizes}`);
    await page.screenshot({path:path.join(output,'provider-simplified-light.png'),fullPage:true});
    const lightReadability = await checkReadability(page);
    await page.evaluate(() => window.StudioTheme.set('dark'));
    await page.setViewportSize({width:375,height:900});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path:path.join(output,'provider-simplified-mobile.png'),fullPage:true,animations:'disabled'});
    const darkReadability = await checkReadability(page);
    fs.writeFileSync(path.join(output,'readability.json'),JSON.stringify({visibleSizes,lightReadability,darkReadability},null,2));
    const fixture = await page.request.get(`http://127.0.0.1:${port}/api/test/state`).then(response => response.json());
    const countedProvider = fixture.providers.find(provider => provider.id === 'long-provider-name');
    countedProvider.chat_models.push(countedProvider.image_models[0]);
    await page.unroute('**/api/providers');
    await page.route('**/api/providers', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({providers:fixture.providers})}));
    await page.reload();
    await page.waitForSelector('.provider-summary');
    assert.match(await page.locator('.provider-summary[data-provider-id="long-provider-name"]').textContent(),/7 个模型/);
    assert.deepEqual(errors,[]);
    console.log('PASS: provider selection, local names, visibility, order, first setup, key validation, selection save/retry, singular counts, discovery fallback, undo, keyboard menus, languages, themes, widths, disabled retention, presets, legacy redirect');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
