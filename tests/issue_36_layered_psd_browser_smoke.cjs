const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROJECT_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const PYTHON = process.env.SMART_CANVAS_PYTHON
  || (fs.existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : 'python3');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+byzvAAAAAElFTkSuQmCC';

function completePsd() {
  const bytes = Buffer.alloc(44);
  bytes.write('8BPS', 0, 'ascii');
  bytes.writeUInt16BE(1, 4);
  bytes.writeUInt16BE(4, 12);
  bytes.writeUInt32BE(1, 14);
  bytes.writeUInt32BE(1, 18);
  bytes.writeUInt16BE(8, 22);
  bytes.writeUInt16BE(3, 24);
  bytes.writeUInt32BE(0, 26);
  bytes.writeUInt32BE(0, 30);
  bytes.writeUInt32BE(0, 34);
  bytes.writeUInt16BE(0, 38);
  bytes.set([10, 20, 30, 255], 40);
  return bytes;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const {port} = listener.address();
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
    const page = await browser.newPage({viewport:{width:1440, height:900}, acceptDownloads:true});
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    const exportRequests = [];
    const persistenceAtRequest = [];
    let exportMode = 'success';
    let downloadCount = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('download', () => { downloadCount += 1; });
    await page.route('**/api/canvases/*/layer-decompositions/*/psd', async route => {
      exportRequests.push({url:route.request().url(), method:route.request().method()});
      persistenceAtRequest.push(await page.evaluate(() => ({
        messages:[...(window.__issue36Mutations || [])],
        pending:window.SmartCanvasModules.canvasPersistence.status().pending,
        items:nodes.find(node => node.id === 'issue-36-layers')?.layerDecompositionItems,
      })));
      if (exportMode === 'failure') {
        await route.fulfill({
          status:409,
          contentType:'application/json',
          body:JSON.stringify({detail:{code:'media_unavailable', private_path:'/must/not/show'}}),
        });
        return;
      }
      await route.fulfill({
        status:200,
        headers:{
          'Content-Type':'image/vnd.adobe.photoshop',
          'Content-Disposition':"attachment; filename=layered-export.psd; filename*=UTF-8''%E8%A7%92%E8%89%B2%E5%88%86%E5%B1%82.psd",
        },
        body:completePsd(),
      });
    });

    await page.goto(
      `http://127.0.0.1:${port}/static/smart-canvas.html?id=issue-36-layered-psd&manual=1`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.imageStudio
      && window.SmartCanvasModules?.layeredPsd
      && window.SmartCanvasModules?.canvasPersistence
      && typeof render === 'function'
      && typeof canvas !== 'undefined'
      && canvas
    ));
    await page.evaluate(imageUrl => {
      window.__issue36Mutations = [];
      const originalSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function(raw) {
        const message = JSON.parse(raw);
        if (message.type === 'canvas_mutation') window.__issue36Mutations.push(message);
        return originalSend.call(this, raw);
      };
      const layerNode = {
        id:'issue-36-layers',
        type:'smart-layer-decomposition',
        title:'角色分层',
        x:280,
        y:180,
        w:560,
        h:360,
        layerDecompositionManifest:{
          manifest_version:1,
          canvas_width:1000,
          canvas_height:500,
          base_output_media_id:'/assets/output/base.png',
          layers:[],
        },
        layerDecompositionItems:[
          {id:'base', role:'base', z_index:0, absolute_bbox:[0, 0, 1000, 500], hidden:false, media:{url:imageUrl, name:'合成底图'}},
          {id:'foreground', role:'layer', z_index:1, absolute_bbox:[100, 100, 500, 400], hidden:false, media:{url:imageUrl, name:'Foreground'}},
          {id:'title', role:'layer', z_index:2, absolute_bbox:[600, 50, 900, 150], hidden:false, media:{url:imageUrl, name:'Title'}},
        ],
      };
      nodes.splice(0, nodes.length, layerNode);
      canvas.nodes = nodes;
      canvas.connections = [];
      selectedId = layerNode.id;
      selectedIds = [];
      selectedImage = {nodeId:'', index:-1};
      render();
      window.SmartCanvasModules.imageStudio.open({
        nodeId:layerNode.id,
        mode:'layer-decomposition',
      });
    }, TINY_PNG);

    await page.waitForFunction(() => Boolean(
      document.querySelector('#imageEditModal')?.open
      && !document.getElementById('layerDecompositionEditor')?.hidden
      && document.querySelector('.layer-decomposition-editor-panel-footer #layerDecompositionPsdDownload')
      && document.querySelectorAll('#layerDecompositionEditorList .layer-decomposition-editor-layer').length === 3
    ));
    const downloadButton = page.locator('#layerDecompositionPsdDownload');
    assert.equal((await downloadButton.textContent()).trim(), '下载 PSD');
    assert.equal(await downloadButton.isDisabled(), false);

    const titleRow = page.locator('#layerDecompositionEditorList .layer-decomposition-editor-layer', {hasText:'Title'});
    await titleRow.hover();
    await titleRow.locator('[data-layer-visibility]').click();
    const foregroundRow = page.locator('#layerDecompositionEditorList .layer-decomposition-editor-layer', {hasText:'Foreground'});
    await foregroundRow.hover();
    await foregroundRow.locator('[data-layer-delete]').click();
    await page.waitForFunction(() => {
      const node = nodes.find(item => item.id === 'issue-36-layers');
      return node?.layerDecompositionItems?.length === 2
        && node.layerDecompositionItems.find(item => item.id === 'title')?.hidden === true;
    });

    const responsePromise = page.waitForResponse(response => response.url().endsWith('/layer-decompositions/issue-36-layers/psd'));
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const [response, downloaded] = await Promise.all([responsePromise, downloadPromise]);
    assert.equal(response.status(), 200);
    assert.equal(downloaded.suggestedFilename(), '角色分层.psd');
    assert.deepEqual(exportRequests[0], {
      url:`http://127.0.0.1:${port}/api/canvases/issue-36-layered-psd/layer-decompositions/issue-36-layers/psd`,
      method:'POST',
    });
    assert.equal(persistenceAtRequest[0].pending, false);
    assert.ok(persistenceAtRequest[0].messages.length > 0, 'current layer edits were not checkpointed');
    assert.deepEqual(
      persistenceAtRequest[0].items.map(item => [item.id, item.hidden]),
      [['base', false], ['title', true]],
    );

    assert.equal(await page.locator('ic-toast[data-ic-overlay]').count(), 0, 'browser download is sufficient success feedback');
    exportMode = 'failure';
    const beforeFailureDownloads = downloadCount;
    const failedResponse = page.waitForResponse(response => (
      response.url().endsWith('/layer-decompositions/issue-36-layers/psd')
      && response.status() === 409
    ));
    await downloadButton.click();
    await failedResponse;
    await page.waitForFunction(() => /无法生成 PSD/.test(document.querySelector('ic-toast[data-ic-overlay]')?.textContent || ''));
    const chineseFailure = await page.locator('ic-toast[data-ic-overlay]').textContent();
    assert.match(chineseFailure, /无法生成 PSD/);
    assert.doesNotMatch(chineseFailure, /private_path|must\/not\/show|media_unavailable/);
    assert.equal(downloadCount, beforeFailureDownloads);
    assert.equal(await downloadButton.isDisabled(), false);

    await page.evaluate(() => {
      document.querySelector('ic-toast[data-ic-overlay]')?.dismiss();
      StudioI18n.set('en');
    });
    await page.waitForFunction(() => document.getElementById('layerDecompositionPsdDownload')?.textContent.trim() === 'Download PSD');
    const englishFailureResponse = page.waitForResponse(response => (
      response.url().endsWith('/layer-decompositions/issue-36-layers/psd')
      && response.status() === 409
    ));
    await downloadButton.click();
    await englishFailureResponse;
    await page.waitForFunction(() => /Couldn't generate PSD/.test(document.querySelector('ic-toast[data-ic-overlay]')?.textContent || ''));
    assert.equal(downloadCount, beforeFailureDownloads);
    assert.deepEqual(pageErrors, []);

    process.stdout.write(JSON.stringify({ok:true, requests:exportRequests.length}, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
