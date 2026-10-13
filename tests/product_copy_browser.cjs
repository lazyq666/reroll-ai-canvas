const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});
const user = {id:'copy-admin',username:'Copy reviewer',role:'admin'};
const canvas = {id:'copy-canvas',name:'Review canvas',title:'Review canvas',project_id:'default',owner_id:user.id,visibility:'private',nodes:[]};
const payloads = {
  '/api/auth/me':{user}, '/api/projects':{projects:[{id:'default',name:'Default',order:0}]},
  '/api/canvases':{canvases:[canvas],total:1}, '/api/canvases/trash':{canvases:[]},
  '/api/config':{}, '/api/providers':{providers:[]},
  '/api/available-models':{models:{image:[],video:[],text:[]}},
  '/api/admin/available-models':{models:{image:[],video:[],text:[]}},
  '/api/admin/model-capability-matrix':{models:[]},
  '/api/comfyui/instances':{instances:[]}, '/api/workflows':{workflows:[]},
  '/api/admin/users':{users:[user]}, '/api/admin/account-applications':{applications:[]},
  '/api/prompt-optimization-settings':{version:2,image:{provider:'',model:'',instructions:{}},video:{provider:'',model:'',instructions:{}}},
};
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,executablePath:process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    page.setDefaultTimeout(10000);
    const errors = [];
    // This acceptance checks language changes after custom elements are ready.
    let checkingLanguage = false;
    page.on('pageerror', error => { if (checkingLanguage) errors.push(error.message); });
    await page.route('**/api/**', route => route.fulfill({contentType:'application/json',body:JSON.stringify(payloads[new URL(route.request().url()).pathname] || {})}));
    const base = `http://127.0.0.1:${server.address().port}`;
    const cases = [
      ['api-settings','ic-heading[data-i18n="api.title"]','API 设置','API settings'],
      ['available-model-management','h1[data-i18n="models.title"]','模型管理','Manage models'],
      ['comfyui-settings','ic-heading[data-i18n="comfy.title"]','工作流设置','Workflow settings'],
      ['account-management','[data-i18n="auth.accountCapacity"]','账号上限','Account limit'],
      ['prompt-optimization-settings','#restoreInstructions','恢复默认','Restore defaults'],
      ['online','#batchHistoryButton','生成历史','Generation history'],
    ];
    for (const [file,selector,zh,en] of cases) {
      checkingLanguage = false;
      await page.goto(`${base}/static/${file}.html`);
      await page.waitForFunction(() => window.StudioI18n && customElements.get('ic-button'));
      await page.waitForFunction(() => !document.querySelector('#batchRatioChoices') || Array.isArray(document.querySelector('#batchRatioChoices').values));
      checkingLanguage = true;
      for (const [language,expected] of [['zh',zh],['en',en],['zh',zh]]) {
        await page.evaluate(lang => StudioI18n.set(lang),language);
        await page.waitForFunction(({selector,expected}) => document.querySelector(selector)?.textContent.trim() === expected,{selector,expected});
        assert.equal(await page.locator(selector).first().isVisible(),true,`${file}: ${language} label is visible`);
      }
    }
    // The prompt module is created dynamically; changing language must preserve input.
    await page.locator('#addPromptModule').click();
    const textarea = page.locator('#batchPromptModules textarea').first();
    await textarea.fill('A red fox');
    for (const [language,label] of [['en','Split by line'],['zh','按行拆分']]) {
      await page.evaluate(lang => StudioI18n.set(lang),language);
      assert.equal(await textarea.inputValue(),'A red fox');
      assert.ok(await page.getByText(label,{exact:true}).count() > 0);
    }
    // A menu already on screen must translate without reopening it or mutating privacy.
    checkingLanguage = false;
    await page.goto(`${base}/static/canvas-list.html`);
    await page.waitForFunction(() => typeof openCardMenu === 'function' && canvases.length === 1);
    checkingLanguage = true;
    await page.evaluate(() => openCardMenu('copy-canvas',document.querySelector('.ws-card')));
    const sharing = page.locator('[data-act="privacy"]');
    for (const [language,label] of [['en','Share with project'],['zh','项目可见']]) {
      await page.evaluate(lang => StudioI18n.set(lang),language);
      assert.equal(await sharing.getAttribute('label'),label);
      assert.equal(await page.evaluate(() => canvases[0].visibility),'private');
    }
    await page.evaluate(() => { closeCardMenu(); openSharePopover('copy-canvas',location.origin+'/share/fixture',document.querySelector('.ws-card')); });
    for (const [language,label] of [['en','Stop sharing'],['zh','停止分享']]) {
      await page.evaluate(lang => StudioI18n.set(lang),language);
      assert.equal(await page.locator('[data-share-revoke]').getAttribute('label'),label);
      assert.equal(await page.locator('.ws-share-popover-title').textContent(),language === 'en' ? 'Share link' : '分享链接');
    }
    await page.setViewportSize({width:900,height:800});
    await page.screenshot({path:'/tmp/reroll-copy-canvas-zh.png'});
    await page.evaluate(() => StudioI18n.set('en'));
    await page.screenshot({path:'/tmp/reroll-copy-canvas-en.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: six real pages, bilingual dynamic controls, open sharing menus and preserved user input/privacy');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
