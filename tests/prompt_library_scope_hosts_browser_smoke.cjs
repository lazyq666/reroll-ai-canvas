const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let copyToCanvasRequests = 0;
const promptCreateRequests = [];
const classicSaveRequests = [];

function canvasFixture(id, kind) {
  return {
    id,
    kind,
    title:`${kind} prompt scope`,
    project:'default',
    revision:4,
    updated_at:100,
    viewport:{x:0, y:0, scale:1},
    nodes:[{
      id:`${kind}-prompt`,
      type:kind === 'smart' ? 'smart-prompt' : 'prompt',
      title:'角色规则',
      text:'初始提示词',
      textHtml:'初始提示词',
      x:180,
      y:160,
      w:340,
      h:220,
      images:[],
    }, ...(kind === 'smart' ? [{
      id:'smart-composer-target',
      type:'smart-image',
      title:'Composer 目标',
      x:580,
      y:160,
      w:260,
      h:220,
      images:[],
    }] : [])],
    connections:[],
    settings:{},
    logs:[],
  };
}

function commonLibrary() {
  return {
    id:'common',
    name:'通用',
    description:'当前工作区内的所有画布均可使用',
    scope:'common',
    readonly:false,
    categories:[{id:'system::general', name:'常用', library_id:'system', category_id:'general'}],
    items:[{
      id:'system::common-one',
      source_id:'common-one',
      library_id:'system',
      libraryId:'common',
      category:'system::general',
      name:'通用镜头',
      positive:'广角建立镜头',
      scope:'common',
    }],
  };
}

async function fulfillFile(route) {
  const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath)) {
    await route.fulfill({status:404, body:'Not found'});
    return;
  }
  await route.fulfill({path:filePath});
}

async function installRoutes(context) {
  await context.route('http://prompt-host.local/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/config') {
      await route.fulfill({status:200, contentType:'application/json', body:'{"api_providers":[],"available_models":{},"comfy_instances":[]}'});
      return;
    }
    if (url.pathname === '/api/workflows') {
      await route.fulfill({status:200, contentType:'application/json', body:'{"workflows":[]}'});
      return;
    }
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({status:200, contentType:'application/json', body:'{"user":{"id":"designer-1","username":"designer","role":"designer"}}'});
      return;
    }
    if (url.pathname === '/api/prompt-libraries') {
      const common = commonLibrary();
      await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({library:{common, libraries:[]}})});
      return;
    }
    if (url.pathname.endsWith('/prompt-templates') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const smart = url.pathname.includes('smart-prompt-scope');
      const revision = smart ? Number(body.base_revision || 0) + 1 : 5;
      const item = {
        id:`saved-${promptCreateRequests.length + 1}`,
        name:body.name,
        positive:body.positive,
        scope:'canvas',
        item_version:`version-${promptCreateRequests.length + 1}`,
      };
      promptCreateRequests.push({canvas:smart ? 'smart' : 'classic', body});
      if(smart){
        await route.request().frame().page().evaluate(value => {
          window.__promptServerRevision = value;
        }, revision);
      }
      await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({
        revision,
        updated_at:smart ? 600 : 300,
        templates:[item],
        item,
        duplicate:false,
      })});
      return;
    }
    if (url.pathname.endsWith('/prompt-templates')) {
      await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({revision:4, templates:[{
        id:'canvas-one', name:'当前画布角色规则', positive:'角色始终佩戴红色围巾', scope:'canvas', updated_at:100,
      }]})});
      return;
    }
    if (url.pathname.endsWith('/copy-to-canvas')) {
      copyToCanvasRequests += 1;
      await route.fulfill({status:200, contentType:'application/json', body:'{}'});
      return;
    }
    if (url.pathname.endsWith('/view-state')) {
      await route.fulfill({status:200, contentType:'application/json', body:'{"view_state":null}'});
      return;
    }
    const canvasMatch = url.pathname.match(/^\/api\/canvases\/(classic|smart)-prompt-scope$/);
    if (canvasMatch) {
      const fixture = canvasFixture(`${canvasMatch[1]}-prompt-scope`, canvasMatch[1]);
      if(route.request().method() === 'PUT'){
        const body = route.request().postDataJSON();
        classicSaveRequests.push(body);
        fixture.nodes = body.nodes;
        fixture.updated_at = 200 + classicSaveRequests.length;
      }
      await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({canvas:fixture})});
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await route.fulfill({status:200, contentType:'application/json', body:'{}'});
      return;
    }
    await fulfillFile(route);
  });
}

async function assertScopeContract(page) {
  const dialog = page.locator('#promptTemplateDialog');
  const panel = page.locator('#promptTemplatePanel');
  await page.waitForFunction(() => document.getElementById('promptTemplateDialog')?.open);
  assert.equal(await panel.getAttribute('active-library'), 'common');
  assert.equal(await panel.getAttribute('active-category'), 'all');
  const commonAll = panel.locator('[data-category-tabs] > [data-value="all"]');
  assert.equal(await commonAll.getAttribute('aria-selected'), 'true');
  assert.equal(await panel.locator('[data-template-id="system::common-one"]').count(), 1);
  const commonSelectedVisual = await commonAll.evaluate(item => {
    const style = getComputedStyle(item);
    return {background:style.backgroundColor, color:style.color, fontWeight:style.fontWeight};
  });
  assert.equal(await panel.locator('[data-library-count="common"]').innerText(), '1');
  assert.equal(await panel.locator('[data-library-count="canvas"]').innerText(), '1');
  assert.equal(await panel.locator('#ic-prompt-library-canvas-title span').innerText(), '当前画布');
  assert.equal(await panel.locator('[part="library-group"]').count(), 0);
  assert.equal(await panel.locator('#ic-prompt-library-common-title').evaluate(title => title.parentElement?.getAttribute('part')), 'category-tabs');
  assert.equal(await panel.locator('#ic-prompt-library-common-title').getAttribute('role'), null);
  assert.equal(await panel.locator('#ic-prompt-library-canvas-title').evaluate(title => title.parentElement?.getAttribute('part')), 'category-tabs');
  assert.equal(await panel.locator('#ic-prompt-library-canvas-title').getAttribute('role'), null);
  assert.equal(await panel.locator('[part="category-tabs"]').count(), 2);
  assert.deepEqual(await panel.locator('[part="category-tabs"]').evaluateAll(tabs => tabs.map(tab => ({space:tab.getAttribute('space'), gap:getComputedStyle(tab).gap}))), [
    {space:'0.125rem', gap:'2px'},
    {space:'0.125rem', gap:'2px'},
  ]);
  assert.equal(await panel.locator('[part="library-switch"]').evaluate(element => getComputedStyle(element).gap), '12px');
  assert.equal(await panel.locator('#ic-prompt-library-common-title').evaluate(title => getComputedStyle(title).height), '32px');
  const categoryActionMetrics = await panel.locator('[data-category-edit], [data-category-delete]').evaluateAll(buttons => buttons.slice(0, 2).map(button => {
    const style = getComputedStyle(button);
    const base = button.shadowRoot?.querySelector('[part~="base"]');
    const baseStyle = base ? getComputedStyle(base) : null;
    const iconStyle = button.querySelector('ic-icon') ? getComputedStyle(button.querySelector('ic-icon')) : null;
    return {
      width:style.width,
      height:style.height,
      baseWidth:baseStyle?.width || '',
      baseHeight:baseStyle?.height || '',
      iconWidth:iconStyle?.width || '',
      iconHeight:iconStyle?.height || '',
      color:style.color,
      tone:button.getAttribute('tone'),
    };
  }));
  assert.deepEqual(categoryActionMetrics.map(({width, height, baseWidth, baseHeight, iconWidth, iconHeight, tone}) => ({width, height, baseWidth, baseHeight, iconWidth, iconHeight, tone})), [
    {width:'24px', height:'24px', baseWidth:'24px', baseHeight:'24px', iconWidth:'16px', iconHeight:'16px', tone:'neutral'},
    {width:'24px', height:'24px', baseWidth:'24px', baseHeight:'24px', iconWidth:'16px', iconHeight:'16px', tone:'neutral'},
  ]);
  assert.equal(categoryActionMetrics[0].color, categoryActionMetrics[1].color);
  assert.equal(categoryActionMetrics[0].color, await panel.evaluate(element => getComputedStyle(element).color));
  assert.deepEqual(await panel.locator('[part="search"]').evaluate(field => ({
    componentName:field.dataset.componentName,
    hasLabel:field.hasAttribute('label'),
    hasHint:field.hasAttribute('hint'),
    inputAppearance:field.querySelector('ic-input')?.getAttribute('appearance'),
    inputSize:field.querySelector('ic-input')?.getAttribute('size'),
    inputAccessibleName:field.querySelector('ic-input')?.getAttribute('aria-label'),
  })), {
    componentName:'ic-form-field-search-s',
    hasLabel:false,
    hasHint:false,
    inputAppearance:'outlined',
    inputSize:'s',
    inputAccessibleName:'搜索提示词',
  });
  const searchVisuals = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      document.documentElement.dataset.uiTheme = value;
      document.documentElement.classList.toggle('theme-dark', value === 'dark');
    }, theme);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    searchVisuals[theme] = await panel.locator('[part="search-input"]').evaluate(input => {
      const base = input.shadowRoot?.querySelector('[part~="base"]');
      const style = base ? getComputedStyle(base) : null;
      return {borderWidth:style?.borderTopWidth || '', background:style?.backgroundColor || ''};
    });
  }
  assert.equal(searchVisuals.light.borderWidth, '1px');
  assert.equal(searchVisuals.dark.borderWidth, '1px');
  assert.ok(searchVisuals.light.background);
  assert.ok(searchVisuals.dark.background);
  await page.evaluate(() => {
    document.documentElement.dataset.uiTheme = 'light';
    document.documentElement.classList.remove('theme-dark');
  });
  await panel.locator('[data-library-tabs] > [data-library-id="canvas"]').click();
  await page.waitForFunction(() => document.getElementById('promptTemplatePanel')?.getAttribute('active-library') === 'canvas');
  const canvasAll = panel.locator('[data-library-tabs] > [data-library-id="canvas"]');
  assert.equal(await canvasAll.getAttribute('aria-selected'), 'true');
  assert.deepEqual(await canvasAll.evaluate(item => {
    const style = getComputedStyle(item);
    return {background:style.backgroundColor, color:style.color, fontWeight:style.fontWeight};
  }), commonSelectedVisual);
  assert.equal(await panel.locator('[data-category-tabs]').count(), 1);
  assert.equal(await panel.locator('[data-template-id="canvas-one"]').count(), 1);
  const allTemplates = await panel.evaluate(element => element.templates);
  await panel.evaluate(element => {
    element.templates = element.templates.filter(item => item.libraryId !== 'canvas');
  });
  assert.equal(await panel.locator('ic-empty-state,[part="empty"]').count(), 0);
  assert.equal(await panel.locator('[part="new-card"]').count(), 1);
  await panel.evaluate((element, templates) => { element.templates = templates; }, allTemplates);
  await panel.locator('[data-category-tabs] > [data-value="all"]').click();
  await page.waitForFunction(() => document.getElementById('promptTemplatePanel')?.getAttribute('active-library') === 'common');
  assert.equal(await panel.locator('[data-library-count="common"]').innerText(), '1');
  assert.equal(await panel.locator('[data-library-count="canvas"]').innerText(), '1');
  assert.equal(await panel.locator('[data-category-tabs]').count(), 1);
  assert.equal(await panel.locator('[data-template-id="system::common-one"]').count(), 1);
  await panel.locator('[data-library-tabs] > [data-library-id="canvas"]').click();
  await page.waitForFunction(() => document.getElementById('promptTemplatePanel')?.getAttribute('active-library') === 'canvas');
  assert.equal(await panel.locator('[data-library-tabs] > [data-library-id="canvas"]').getAttribute('aria-selected'), 'true');
  assert.equal(await panel.locator('[data-template-id="canvas-one"]').count(), 1);
  await panel.locator('[part="close"]').click();
  await page.waitForFunction(() => !document.getElementById('promptTemplateDialog')?.open);
  assert.equal(await dialog.evaluate(element => element.parentElement === document.body), true);
}

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  try {
    const context = await browser.newContext({viewport:{width:1360, height:860}});
    const browserErrors = [];
    await context.addInitScript(() => {
      window.__promptServerRevision = 4;
      window.__promptWsMutations = [];
      class MockWebSocket {
        static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          this.revision = window.__promptServerRevision;
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.({});
            if(String(url).includes('/ws/canvases/')){
              this.onmessage?.({data:JSON.stringify({
                type:'canvas_snapshot',
                canvas_id:'smart-prompt-scope',
                revision:window.__promptServerRevision,
                canvas:{
                  id:'smart-prompt-scope', kind:'smart', title:'smart prompt scope',
                  project:'default', revision:4, updated_at:100,
                  nodes:[
                    {id:'smart-prompt',type:'smart-prompt',title:'角色规则',text:'初始提示词',textHtml:'初始提示词',x:180,y:160,w:340,h:220,images:[]},
                    {id:'smart-composer-target',type:'smart-image',title:'Composer 目标',x:580,y:160,w:260,h:220,images:[]},
                  ],
                  connections:[], settings:{}, logs:[],
                },
              })});
            }
          }, 0);
        }
        addEventListener(type, listener) { this[`on${type}`] = listener; }
        removeEventListener() {}
        send(raw) {
          const message = JSON.parse(raw);
          if(message.type !== 'canvas_mutation') return;
          window.__promptWsMutations.push(message);
          this.revision = Math.max(this.revision,window.__promptServerRevision) + 1;
          window.__promptServerRevision = this.revision;
          setTimeout(() => this.onmessage?.({data:JSON.stringify({
            type:'canvas_mutation',
            canvas_id:message.canvas_id,
            operation_id:message.operation.operation_id,
            revision:this.revision,
            changes:message.operation.changes,
            duplicate:false,
            reverts_operation_id:'',
            undoable:true,
          })}), 0);
        }
        close() { this.readyState = 3; this.onclose?.({code:1000}); }
      }
      window.WebSocket = MockWebSocket;
      document.execCommand = command => {
        if (command !== 'copy') return false;
        const clipboardData = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', {bubbles:true, cancelable:true, clipboardData}));
        window.__copiedText = clipboardData.getData('text/plain');
        return true;
      };
    });
    await installRoutes(context);

    const classic = await context.newPage();
    classic.on('pageerror', error => browserErrors.push(`classic pageerror: ${error.message}`));
    classic.on('console', message => {
      if(message.type() === 'error') browserErrors.push(`classic console: ${message.text()}`);
    });
    await classic.goto('http://prompt-host.local/static/canvas.html?id=classic-prompt-scope', {waitUntil:'domcontentloaded'});
    await classic.waitForSelector('[data-prompt-template-open][data-prompt-template-node-id="classic-prompt"]');
    await classic.locator('[data-prompt-template-open][data-prompt-template-node-id="classic-prompt"]').click();
    await assertScopeContract(classic);
    await classic.locator('[data-prompt-template-open][data-prompt-template-node-id="classic-prompt"]').click();
    await classic.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await classic.locator('#promptTemplatePanel').locator('[data-library-tabs] > [data-library-id="canvas"]').click();
    await classic.locator('#promptTemplatePanel').evaluate(panel => {
      window.__classicPromptCardsBeforeSelection = [...panel.shadowRoot.querySelectorAll('[part="template-card"]')];
    });
    await classic.locator('#promptTemplatePanel').locator('[data-template-id="canvas-one"] [part="template-select"]').click();
    await classic.waitForFunction(() => !document.getElementById('promptTemplateDialog')?.open);
    await classic.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await classic.locator('#promptTemplatePanel').evaluate(panel => {
      const cards = [...panel.shadowRoot.querySelectorAll('[part="template-card"]')];
      return cards.every((card, index) => card === window.__classicPromptCardsBeforeSelection[index]);
    }), true);
    assert.equal(await classic.locator('.node[data-id="classic-prompt"] textarea').inputValue(), '角色始终佩戴红色围巾');
    await classic.locator('.node[data-id="classic-prompt"] textarea').fill('Classic 刚编辑后立即保存');
    await classic.evaluate(() => saveCurrentCanvasPromptAsTemplate('classic-prompt'));
    await classic.waitForFunction(() => document.querySelector('ic-toast'));
    const classicPromptRequest = promptCreateRequests.find(item => item.canvas === 'classic');
    assert.ok(classicPromptRequest);
    assert.equal(classicPromptRequest.body.base_revision, 4);
    assert.ok(classicSaveRequests.length >= 1);
    await classic.locator('.node[data-id="classic-prompt"] textarea').fill('提示词成功后的下一次普通编辑');
    await classic.waitForTimeout(650);
    assert.ok(classicSaveRequests.length >= 2);
    assert.ok(Number(classicSaveRequests.at(-1).base_updated_at) >= 300);
    await classic.close();

    const smart = await context.newPage();
    smart.on('pageerror', error => browserErrors.push(`smart pageerror: ${error.message}`));
    smart.on('console', message => {
      if(message.type() === 'error') browserErrors.push(`smart console: ${message.text()}`);
    });
    await smart.goto('http://prompt-host.local/static/smart-canvas.html?id=smart-prompt-scope', {waitUntil:'domcontentloaded'});
    await smart.waitForFunction(() => document.querySelector('.image-node[data-id="smart-prompt"]'));
    await smart.locator('#promptTemplateDockToggle').click();
    await assertScopeContract(smart);
    await smart.locator('#promptTemplateDockToggle').click();
    assert.equal(await smart.locator('#promptTemplatePanel').getAttribute('data-target'), 'library');
    await smart.locator('#promptTemplatePanel').locator('[data-library-tabs] > [data-library-id="canvas"]').click();
    await smart.locator('#promptTemplatePanel').locator('[data-template-id="canvas-one"] [part="template-select"]').click();
    await smart.waitForFunction(() => window.__copiedText === '角色始终佩戴红色围巾');
    const promptCopyToast = smart.locator('ic-toast[data-ic-overlay]').filter({hasText:'提示词已复制'}).last();
    await promptCopyToast.waitFor();
    assert.equal(await promptCopyToast.getAttribute('tone'), 'success');
    assert.equal(await smart.locator('#promptTemplateDialog').evaluate(dialog => dialog.open), true);
    await smart.evaluate(() => {
      document.execCommand = () => false;
      try { Object.defineProperty(navigator, 'clipboard', {configurable:true, value:undefined}); } catch(_) {}
    });
    await smart.locator('#promptTemplatePanel').locator('[data-template-id="canvas-one"] [part="template-select"]').click();
    const promptCopyFailureToast = smart.locator('ic-toast[data-ic-overlay]').filter({hasText:'复制失败，请重试'}).last();
    await promptCopyFailureToast.waitFor();
    assert.equal(await promptCopyFailureToast.getAttribute('tone'), 'danger');
    await smart.locator('#promptTemplatePanel').locator('[data-category-tabs] > [data-value="all"]').click();
    await smart.waitForTimeout(100);
    await smart.locator('#promptTemplatePanel').evaluate(panel => {
      window.__smartPromptCardsBeforeCopy = [...panel.shadowRoot.querySelectorAll('[part="template-card"]')];
    });
    await smart.locator('#promptTemplatePanel').locator('[data-template-id="system::common-one"] [part="template-select"]').click();
    await smart.waitForTimeout(100);
    assert.equal(copyToCanvasRequests, 1);
    assert.equal(await smart.locator('#promptTemplatePanel').evaluate(panel => {
      const cards = [...panel.shadowRoot.querySelectorAll('[part="template-card"]')];
      return cards.every((card, index) => card === window.__smartPromptCardsBeforeCopy[index]);
    }), true);
    await smart.locator('#promptTemplatePanel').locator('[part="close"]').click();
    await smart.waitForFunction(() => !document.getElementById('promptTemplateDialog')?.open);

    await smart.locator('.image-node[data-id="smart-composer-target"]').evaluate(node => {
      const script = document.createElement('script');
      script.textContent = `selectedId = ${JSON.stringify(node.dataset.id)}; selectedIds = []; selectedImage = {nodeId:'', index:-1}; window.SmartCanvasModules.viewportSelection.selection.refresh(); updateComposer();`;
      document.body.appendChild(script);
      script.remove();
    });
    await smart.waitForFunction(() => document.getElementById('composer')?.classList.contains('open'));
    await smart.locator('#composerTemplateBtn').evaluate(button => button.click());
    assert.equal(await smart.locator('#promptTemplatePanel').getAttribute('data-target'), 'composer');
    await smart.locator('#promptTemplatePanel').locator('[data-library-tabs] > [data-library-id="canvas"]').click();
    await smart.locator('#promptTemplatePanel').locator('[data-template-id="canvas-one"] [part="template-select"]').click();
    await smart.waitForFunction(() => !document.getElementById('promptTemplateDialog')?.open);
    assert.equal(await smart.locator('#promptInput').textContent(), '角色始终佩戴红色围巾 ');
    assert.equal(await smart.locator('#promptInput .prompt-template-token').count(), 0);

    await smart.evaluate(() => { void openPromptTemplatePanel('smart-prompt', '', {target:'node'}); });
    await smart.waitForFunction(() => document.getElementById('promptTemplateDialog')?.open);
    assert.equal(await smart.locator('#promptTemplatePanel').getAttribute('data-target'), 'node');
    await smart.locator('#promptTemplatePanel').locator('[data-library-tabs] > [data-library-id="canvas"]').click();
    await smart.locator('#promptTemplatePanel').locator('[data-template-id="canvas-one"] [part="template-select"]').click();
    await smart.waitForFunction(() => !document.getElementById('promptTemplateDialog')?.open);
    assert.match(await smart.locator('.image-node[data-id="smart-prompt"] .prompt-node-text').textContent(), /角色始终佩戴红色围巾/);
    assert.equal(await smart.locator('.image-node[data-id="smart-prompt"] .prompt-template-token').count(), 0);
    await smart.evaluate(async () => {
      const node = nodes.find(item => item.id === 'smart-prompt');
      await createPromptPresetFromNode(node);
    });
    const smartPromptRequest = promptCreateRequests.find(item => item.canvas === 'smart');
    assert.ok(smartPromptRequest);
    assert.ok(smartPromptRequest.body.base_revision >= 5);
    await smart.evaluate(async () => {
      const node = nodes.find(item => item.id === 'smart-prompt');
      node.text = `${node.text} 下一次普通编辑`;
      canvasPersistence.schedule({delay:0});
      await canvasPersistence.save();
      await canvasPersistence.synced({timeout:3000});
    });
    const smartState = await smart.evaluate(() => ({
      persistence:canvasPersistence.status(),
      mutations:window.__promptWsMutations,
    }));
    assert.equal(smartState.persistence.revision, smartPromptRequest.body.base_revision + 2);
    assert.equal(smartState.mutations.at(-1).operation.base_revision, smartPromptRequest.body.base_revision + 1);
    await smart.close();

    assert.deepEqual(browserErrors, []);
    process.stdout.write('Classic and Smart prompt scope host smoke passed.\n');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
