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
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    page.setDefaultTimeout(15000);
    await page.route('**/api/workspace-assets?**', route => route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({
        items:[{
          id:'asset-insert-probe',
          media_id:'a'.repeat(64),
          name:'晨雾森林',
          url:'/static/images/logo.png',
          kind:'image',
          publisher:'Designer',
          published_at:'2026-08-27T00:00:00Z',
          can_manage:false,
        }],
        folders:[],
        all_count:1,
        next_cursor:'',
        at_capacity:false,
      }),
    }));
    await page.goto(
      `http://127.0.0.1:${port}/static/smart-canvas.html?id=asset-insert-regression&manual=1`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      customElements.get('ic-dialog')
      && customElements.get('ic-workspace-asset-library')
      && window.SmartCanvasModules?.canvasMutation
      && typeof openWorkspaceAssetLibrary === 'function'
      && typeof createImageNodeAt === 'function'
    ));
    await page.waitForFunction(() => typeof canvas !== 'undefined' && Boolean(canvas));

    const expectedCenter = await page.evaluate(() => {
      nodes.splice(0, nodes.length);
      canvas.nodes = nodes;
      canvas.connections = [];
      selectedId = '';
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      render();
      return window.SmartCanvasModules.viewportSelection.viewport.center();
    });

    await page.evaluate(() => openWorkspaceAssetLibrary());
    await page.waitForFunction(() => (
      document.querySelector('#workspaceAssetDialog')?.open === true
      && document.querySelector('#workspaceAssetPanel')?.shadowRoot.querySelectorAll('.card').length === 1
    ));
    const invalidActivation = await page.evaluate(async () => {
      document.querySelector('#workspaceAssetPanel').dispatchEvent(new CustomEvent('ic-asset-insert', {
        bubbles:true,
        composed:true,
        detail:{item:{id:'missing-url',name:'失效素材'}},
      }));
      await new Promise(resolve => setTimeout(resolve, 40));
      return {
        dialogOpen:document.querySelector('#workspaceAssetDialog').open,
        nodeCount:nodes.length,
      };
    });
    assert.deepEqual(invalidActivation, {dialogOpen:true,nodeCount:0});
    await page.evaluate(() => {
      const card = document.querySelector('#workspaceAssetPanel').shadowRoot.querySelector('.card');
      card.click();
      card.click();
    });
    await page.waitForFunction(() => (
      document.querySelector('#workspaceAssetDialog')?.open !== true
      && nodes.length === 1
      && document.activeElement?.id === 'shell'
    ));
    await page.evaluate(() => canvasPersistence.synced({timeout:5000}));

    const inserted = await page.evaluate(() => {
      const node = nodes[0];
      const image = node?.images?.[0];
      const rect = nodeRect(node);
      return {
        nodeCount:nodes.length,
        type:node?.type,
        selectedId,
        selectedIds:[...selectedIds],
        image,
        nodeCenter:{x:rect.x + rect.width / 2,y:rect.y + rect.height / 2},
        viewerHidden:document.querySelector('#referenceViewerBackdrop').hidden,
        dialogOpen:document.querySelector('#workspaceAssetDialog').open,
        dockExpanded:document.querySelector('#workspaceAssetDockToggle').getAttribute('aria-expanded'),
        activeElement:document.activeElement?.id,
        persistenceStatus:canvasPersistence.status(),
      };
    });
    assert.equal(inserted.nodeCount, 1, 'Rapid duplicate activation must insert one Node');
    assert.equal(inserted.type, 'smart-image');
    assert.equal(inserted.selectedId.length > 0, true);
    assert.deepEqual(inserted.selectedIds, []);
    assert.equal(inserted.image.url, '/static/images/logo.png');
    assert.equal(inserted.image.name, '晨雾森林');
    assert.equal(inserted.image.kind, 'image');
    assert.equal(inserted.image.media_id, 'a'.repeat(64));
    assert.equal(inserted.image.assetLibraryEntryId, 'asset-insert-probe');
    const placementDistance = Math.hypot(
      inserted.nodeCenter.x - expectedCenter.x,
      inserted.nodeCenter.y - expectedCenter.y,
    );
    assert.ok(
      placementDistance <= 100,
      `Inserted Node must be placed near the frozen viewport center: ${JSON.stringify({inserted:inserted.nodeCenter,expected:expectedCenter,placementDistance})}`,
    );
    assert.equal(inserted.viewerHidden, true);
    assert.equal(inserted.dialogOpen, false);
    assert.equal(inserted.dockExpanded, 'false');
    assert.equal(inserted.activeElement, 'shell');
    assert.ok(inserted.persistenceStatus.revision >= 1);
    assert.equal(inserted.persistenceStatus.pending, false);

    process.stdout.write(JSON.stringify({ok:true, inserted}, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
