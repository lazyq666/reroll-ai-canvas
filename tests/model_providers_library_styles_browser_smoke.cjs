const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const port = 19675;
const output = '/private/tmp/model-providers-library-review';
const referenceMarkup = `<!doctype html><html lang="zh" data-ui-scope="api-settings"><head>
<link rel="stylesheet" href="/static/css/design-tokens.css">
<script src="/static/js/theme.js"></script>
<style>:root{font-size:16px}body{font:var(--ui-text-body);color:var(--ui-color-text-primary);background:var(--ui-color-surface-canvas)}</style>
</head><body>
<ic-tabs id="tabs" label="Views" value="added" activation="automatic" data-legal-combination="horizontal-automatic-label">
<button data-value="added">Added</button><button data-value="catalog">Catalog</button></ic-tabs>
<ic-table id="table" label="Models" row-selection="none"><table>
<thead><tr><th scope="col">Name</th><th scope="col">Visible</th></tr></thead>
<tbody><tr><td>Model</td><td>Yes</td></tr></tbody></table></ic-table>
<ic-button id="rename" hierarchy="quiet">Model</ic-button>
<ic-icon-button id="more" hierarchy="quiet" icon="more" label="Model actions"></ic-icon-button>
<ic-switch id="visibility" label="Show model" aria-labelledby="rename" checked></ic-switch>
<ic-checkbox id="added" appearance="checkmark-end" data-component-variant="list" label="Model" tag="已添加" disabled checked></ic-checkbox>
<script type="module" src="/static/js/infinite-canvas-ui/core.js"></script></body></html>`;

async function appearance(page, selector, part) {
  return page.locator(selector).first().evaluate((host, partName) => {
    const element = partName ? host.shadowRoot.querySelector(`[part~="${partName}"]`) : host;
    const style = getComputedStyle(element);
    return Object.fromEntries([
      'backgroundColor','color','borderTopColor','borderTopWidth','borderRadius',
      'paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight',
    ].map(property => [property,style[property]]));
  }, part);
}

(async () => {
  fs.mkdirSync(output,{recursive:true});
  const server = spawn('node',['tests/api_settings_browser_app.cjs'],{
    cwd:root,env:{...process.env,API_SETTINGS_PREVIEW_PORT:String(port)},stdio:['ignore','pipe','pipe'],
  });
  let browser;
  try {
    await new Promise((resolve,reject) => {
      server.stdout.on('data',chunk => {if(String(chunk).includes('API Settings preview:')) resolve();});
      server.on('exit',code => reject(new Error(`Preview exited ${code}`)));
    });
    browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const reference = await browser.newPage();
    await reference.route('**/component-reference',route => route.fulfill({contentType:'text/html',body:referenceMarkup}));
    await reference.goto(`http://127.0.0.1:${port}/component-reference`);
    await reference.waitForFunction(() => customElements.get('ic-table') && document.querySelector('#more')?.shadowRoot?.querySelector('[part~="base"]'));
    await page.goto(`http://127.0.0.1:${port}/api-settings`);
    await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
    await page.waitForSelector('.model-row');
    for(const theme of ['light','dark']){
      await Promise.all([page,reference].map(surface => surface.evaluate(value => window.StudioTheme.set(value),theme)));
      await Promise.all([page,reference].map(surface => surface.screenshot({animations:'disabled'})));
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:1000});
        await page.mouse.move(0,0);
        for(const [actual,expected,part] of [
          ['#modelSourceTabs [aria-selected="true"]','#tabs [aria-selected="true"]'],
          ['#modelSourceTabs [aria-selected="false"]','#tabs [aria-selected="false"]'],
          ['#model-types [aria-selected="true"]','#tabs [aria-selected="true"]'],
          ['.model-table th','#table th'],
          ['.model-row td','#table td'],
          ['.model-name-label','#rename','base'],
          ['.model-more','#more','base'],
          ['.model-visibility-checkbox','#visibility','control'],
        ]){
          assert.deepEqual(await appearance(page,actual,part),await appearance(reference,expected,part),`${theme} ${width} ${actual} must match its public component`);
        }
        assert.equal(await page.locator('.model-row').first().evaluate(row => getComputedStyle(row).display),'table-row');
        assert.equal(await page.locator('.model-table thead').isVisible(),true);
        assert.equal(await page.locator('.model-visibility-checkbox').first().evaluate(control => control.querySelector('[data-ic-owned-label]') === null),true);
        assert.equal(await page.getByRole('switch',{name:'GPT Image 2',exact:true}).count(),1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
        await page.screenshot({path:path.join(output,`added-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
      }
    }
    await page.locator('#fetchModelsBtn').click();
    await page.locator('#modelDiscoveryResults').waitFor({state:'visible'});
    await page.mouse.move(0,0);
    assert.deepEqual(await appearance(page,'#pickerList ic-checkbox[disabled]','base'),await appearance(reference,'#added','base'));
    assert.deepEqual(await appearance(page,'#pickerList ic-checkbox[disabled]','label'),await appearance(reference,'#added','label'));
    await page.screenshot({path:path.join(output,'catalog-dark-390.png'),fullPage:true,animations:'disabled'});
    await page.locator('#modelSourceTabs [data-value="added"]').click();
    await page.locator('.model-name-label').first().click();
    await page.locator('.model-name-input input').first().fill('我的常用模型');
    await page.locator('.model-name-input input').first().press('Tab');
    await page.waitForFunction(async () => {
      const state = await fetch('/api/test/state').then(response => response.json());
      return state.providers.find(provider => provider.id === 'long-provider-name').model_names['gpt-image-2'] === '我的常用模型';
    });
    await page.getByRole('switch',{name:'我的常用模型',exact:true}).waitFor({state:'visible'});
    await reference.route('**/switch-contract',route => route.fulfill({
      contentType:'text/html',
      body:fs.readFileSync(path.join(root,'tests/infinite_canvas_ui_selection_adjustment_browser_harness.html'),'utf8'),
    }));
    await reference.goto(`http://127.0.0.1:${port}/switch-contract`);
    await reference.waitForFunction(() => ['passed','failed'].includes(document.documentElement.dataset.icSelectionAdjustmentTestStatus));
    const contract = await reference.locator('#ic-results').textContent().then(JSON.parse);
    assert.equal(contract.checks.switchExternalName,true,JSON.stringify(contract));
    assert.equal(await reference.locator('html').getAttribute('data-ic-selection-adjustment-test-status'),'passed',JSON.stringify(contract));
    console.log('PASS: added table, tabs, rename, switch, More and added markers match standalone library components in light/dark and desktop/mobile; local naming retained.');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {console.error(error);process.exitCode=1;});
