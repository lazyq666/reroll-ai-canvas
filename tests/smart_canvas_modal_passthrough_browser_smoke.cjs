const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROJECT_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const PYTHON = process.env.SMART_CANVAS_PYTHON
  || (fs.existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : 'python3');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('manual server did not start')), 10000);
    child.once('exit', code => reject(new Error(`manual server exited with ${code}`)));
    child.stdout.on('data', chunk => {
      if (!String(chunk).includes('Smart Canvas manual server:')) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

async function pointFor(page, selector, shadowSelector = '') {
  return page.locator(selector).evaluate((host, shadow) => {
    const target = shadow ? host.shadowRoot?.querySelector(shadow) : host;
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      throw new Error(`No visible target for ${host.id || host.localName} ${shadow}`);
    }
    return {
      x:rect.left + Math.min(rect.width * 0.5, Math.max(12, rect.width - 12)),
      y:rect.top + Math.min(rect.height * 0.5, Math.max(12, rect.height - 12)),
    };
  }, shadowSelector);
}

async function canvasState(page) {
  return page.evaluate(() => ({
    nodeCount:nodes.length,
    frameCount:nodes.filter(node => node.type === 'smart-frame' || node.type === 'frame').length,
    selectedId,
    selectedIds:[...selectedIds],
    composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
    createMenuOpen:document.querySelector('#createMenu')?.hasAttribute('open') || false,
    nodeMenuOpen:document.querySelector('#smartNodeContextMenu')?.hasAttribute('open') || false,
    viewport:{x:viewport.x, y:viewport.y, scale:viewport.scale},
  }));
}

async function resetCanvasInteraction(page, tool = 'pointer') {
  await page.evaluate(nextTool => {
    selectedId = '';
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    closeCreateMenu();
    closeSmartNodeContextMenu();
    setSmartBaseTool(nextTool);
    composer.classList.remove('open', 'focused');
    composer.style.display = 'none';
    render();
  }, tool);
}

async function assertPointerIsolation(page, target, label, options = {}) {
  const before = await canvasState(page);
  const point = await pointFor(page, target.selector, target.shadowSelector);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(40);
  const afterClick = await canvasState(page);
  assert.equal(afterClick.nodeCount, before.nodeCount, `${label}: primary click changed Node count`);
  assert.equal(afterClick.frameCount, before.frameCount, `${label}: primary click created a Frame`);
  assert.equal(afterClick.selectedId, before.selectedId, `${label}: primary click changed Canvas Selection`);
  assert.deepEqual(afterClick.selectedIds, before.selectedIds, `${label}: primary click changed multi-selection`);
  assert.equal(afterClick.composerOpen, before.composerOpen, `${label}: primary click opened Prompt Authoring`);

  if (options.staysOpen) {
    assert.equal(await page.locator(target.selector).evaluate(host => (
      host.open === true || host.hasAttribute('open') || host.hidden === false
    )), true, `${label}: primary click unexpectedly dismissed the surface`);
  }

  await page.mouse.click(point.x, point.y, {button:'right'});
  await page.waitForTimeout(40);
  const afterContextMenu = await canvasState(page);
  assert.equal(afterContextMenu.createMenuOpen, false, `${label}: right click opened the Canvas create menu`);
  assert.equal(afterContextMenu.nodeMenuOpen, false, `${label}: right click opened the Node context menu`);

  await page.mouse.move(point.x, point.y);
  const beforeWheel = await canvasState(page);
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(40);
  const afterWheel = await canvasState(page);
  assert.deepEqual(afterWheel.viewport, beforeWheel.viewport, `${label}: wheel changed the Canvas viewport`);
}

(async () => {
  const port = await freePort();
  const server = spawn(PYTHON, ['tests/smart_canvas_manual_server.py'], {
    cwd:ROOT,
    env:{...process.env, SMART_CANVAS_PORT:String(port)},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  try {
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    page.setDefaultTimeout(15000);
    await page.goto(
      `http://127.0.0.1:${port}/static/smart-canvas.html?id=modal-passthrough-regression&manual=1`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      customElements.get('ic-dialog')
      && customElements.get('ic-prompt-node-focus-surface')
      && window.SmartCanvasModules?.canvasInteraction
      && window.SmartCanvasModules?.imageStudio
      && typeof render === 'function'
      && typeof openReferenceViewer === 'function'
    ));
    await page.waitForFunction(() => typeof canvas !== 'undefined' && Boolean(canvas));

    await page.evaluate(({tinyPng}) => {
      const script = document.createElement('script');
      script.textContent = `(() => {
        const testNodes = [
          {
            id:'modal-underlay', type:'smart-image', title:'Modal underlay',
            x:120, y:80, w:1200, h:760,
            images:[{
              url:${JSON.stringify(tinyPng)}, name:'modal-underlay.png', kind:'image',
              natural_w:1, natural_h:1
            }]
          },
          {
            id:'modal-prompt', type:'smart-prompt', title:'Prompt',
            x:80, y:80, w:360, h:260, text:'Modal regression prompt',
            textHtml:'Modal regression prompt'
          }
        ];
        if(!canvas) canvas = {id:canvasId, title:'Modal passthrough regression', nodes, connections:[], revision:0};
        nodes.splice(0, nodes.length, ...testNodes);
        canvas.nodes = nodes;
        canvas.connections = [];
        canvasPersistence.schedule = () => {};
        viewport.x = 0;
        viewport.y = 0;
        viewport.scale = 1;
        window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        composer.style.display = 'none';
        composer.classList.remove('open', 'focused');
        render();
      })();`;
      document.body.appendChild(script);
      script.remove();
    }, {tinyPng:TINY_PNG});

    await resetCanvasInteraction(page, 'pointer');
    await page.evaluate(() => openReferenceViewer({
      kind:'text',
      name:'引用预览',
      text:'Reference preview regression content',
    }));
    await page.waitForFunction(() => !document.querySelector('#referenceViewerBackdrop')?.hidden);
    const referencePoint = await pointFor(page, '#referenceViewerBackdrop .reference-viewer');
    const referenceUnderlay = await page.evaluate(point => {
      const worldPoint = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld({
        clientX:point.x,
        clientY:point.y,
      });
      const underlay = nodes.find(node => node.id === 'modal-underlay');
      Object.assign(underlay, {
        x:worldPoint.x - 240,
        y:worldPoint.y - 180,
        w:480,
        h:360,
      });
      render();
      const rect = document.querySelector('.image-node[data-id="modal-underlay"]')?.getBoundingClientRect();
      return rect ? {
        left:rect.left,
        right:rect.right,
        top:rect.top,
        bottom:rect.bottom,
      } : null;
    }, referencePoint);
    assert.ok(referenceUnderlay, 'Reference viewer test underlay Node did not render');
    assert.ok(
      referencePoint.x > referenceUnderlay.left
        && referencePoint.x < referenceUnderlay.right
        && referencePoint.y > referenceUnderlay.top
        && referencePoint.y < referenceUnderlay.bottom,
      `Reference viewer test point is not over the underlay Node: ${JSON.stringify({referencePoint, referenceUnderlay})}`,
    );
    const referenceInitialFocus = await page.evaluate(() => document.activeElement?.id);
    await assertPointerIsolation(
      page,
      {selector:'#referenceViewerBackdrop .reference-viewer'},
      'Reference viewer in pointer mode',
      {staysOpen:true},
    );
    assert.equal(
      referenceInitialFocus,
      'referenceViewerTitle',
      'Reference viewer initial focus must not land on its close Tooltip control',
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#referenceViewerBackdrop')?.hidden);

    for (const tool of ['frame', 'brush', 'text']) {
      await resetCanvasInteraction(page, tool);
      await page.evaluate(() => openSmartContextResult({
        title:'上下文结果',
        text:'Context result regression content',
        allowCreate:true,
        allowApply:false,
      }));
      await page.waitForFunction(() => !document.querySelector('#smartContextResultBackdrop')?.hidden);
      await assertPointerIsolation(
        page,
        {selector:'#smartContextResultBackdrop .smart-context-result-panel'},
        `Context result in ${tool} mode`,
        {staysOpen:true},
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#smartContextResultBackdrop')?.hidden);
    }

    await resetCanvasInteraction(page, 'frame');
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.open({
      nodeId:'modal-underlay',
      imageIndex:0,
      mode:'preview',
      groupAware:false,
    }));
    await page.waitForFunction(() => (
      document.querySelector('#imageEditModal')?.open === true
      && document.querySelector('#imageEditModal')?.classList.contains('open')
    ));
    await assertPointerIsolation(
      page,
      {selector:'#imageEditModal', shadowSelector:'[part="dialog"]'},
      'Image editor in Frame mode',
      {staysOpen:true},
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.open !== true);

    await resetCanvasInteraction(page, 'frame');
    await page.evaluate(() => setPromptNodeFocused('modal-prompt', true));
    await page.waitForFunction(() => document.querySelector('#promptNodeFocusSurface')?.hasAttribute('open'));
    await assertPointerIsolation(
      page,
      {selector:'#promptNodeFocusSurface', shadowSelector:'[part="surface"]'},
      'Prompt focus surface in Frame mode',
      {staysOpen:true},
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#promptNodeFocusSurface')?.hasAttribute('open'));

    await resetCanvasInteraction(page, 'frame');
    await page.locator('#workspaceAssetDialog').evaluate(dialog => dialog.show());
    await page.waitForFunction(() => document.querySelector('#workspaceAssetDialog')?.open === true);
    await assertPointerIsolation(
      page,
      {selector:'#workspaceAssetDialog', shadowSelector:'[part="dialog"]'},
      'Workspace asset dialog in Frame mode',
      {staysOpen:true},
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#workspaceAssetDialog')?.open !== true);

    process.stdout.write(JSON.stringify({ok:true, checks:7}, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
