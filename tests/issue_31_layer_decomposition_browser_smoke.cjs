const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CANVAS_ID = 'issue-31-layer-decomposition-browser';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+byzvAAAAAElFTkSuQmCC';

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      const type = {
        '.css':'text/css', '.html':'text/html', '.js':'text/javascript',
        '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
        '.woff2':'font/woff2',
      }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function capabilityPayload(url) {
  const query = new URL(url).searchParams;
  const providerId = query.get('provider_id') || 'apimart';
  const modelId = query.get('model') || 'seedream-5-0-pro';
  const secondary = providerId === 'apimart-secondary';
  return {
    provider_id:providerId, model_id:modelId,
    operation:'image.layer_decomposition', capability_schema_version:1,
    catalog_revision:'issue-31-browser-revision', support_state:'supported',
    inputs:{
      text:{minimum:0,maximum:1}, image:{minimum:1,maximum:1},
      video:{minimum:0,maximum:0}, audio:{minimum:0,maximum:0},
      file:{minimum:0,maximum:0},
    },
    input_rules:{role_groups:[{
      id:'layer-source', input:'image', roles:['source'], minimum:1, maximum:1,
      exclusive_inputs:['video','audio','file'],
    }]},
    parameters:{
      resolution_tier:{type:'enum',values:secondary?['auto','1K']:['auto','1K','1.5K','2K'],default:secondary?'1K':'2K'},
      count:{type:'integer',minimum:1,maximum:1,default:1},
    },
    output:{kind:'image_layer_decomposition',count:{minimum:1,maximum:1,default:1}},
  };
}

function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') return {
    api_providers:[],
    available_models:{image:[
      {id:'apimart|seedream-5-0-pro',provider_id:'apimart',provider_name:'APIMART Primary',model:'seedream-5-0-pro',name:'Seedream 5.0 Pro'},
      {id:'apimart-secondary|seedream-layer-pro',provider_id:'apimart-secondary',provider_name:'APIMART Secondary',model:'seedream-layer-pro',name:'Seedream Layer Pro'},
    ]},
    comfy_instances:[],
  };
  if (pathname === '/api/workflows') return { workflows:[] };
  if (pathname === '/api/prompt-libraries') return { library:{libraries:[]} };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates:[] };
  if (pathname === '/api/auth/me') return { user:{id:'issue-31-admin',username:'admin',role:'admin'} };
  if (pathname === '/api/workspace-assets') return { items:[], next_cursor:'' };
  if (pathname === '/api/model-capabilities') return capabilityPayload(url);
  if (pathname.endsWith('/view-state')) return { view_state:null };
  if (pathname === `/api/canvases/${CANVAS_ID}`) {
    return { canvas:{
      id:CANVAS_ID, title:'Issue #31 browser smoke', project:'default', revision:1,
      nodes:[], connections:[], settings:{}, logs:[],
    } };
  }
  return {};
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless:true, executablePath:browserExecutable });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:900} });
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    const submissions = [];
    let failUpload = false;
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.__issue31PersistedNodeIds = [];
      class PreviewWebSocket {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor() {
          this.revision = 1;
          this.readyState = PreviewWebSocket.CONNECTING;
          setTimeout(() => {
            this.readyState = PreviewWebSocket.OPEN;
            this.onopen?.({});
            this.onmessage?.({data:JSON.stringify({
              type:'canvas_snapshot',
              canvas_id:'issue-31-layer-decomposition-browser',
              revision:this.revision,
              canvas:{
                id:'issue-31-layer-decomposition-browser',
                title:'Issue #31 browser smoke', project:'default', revision:this.revision,
                nodes:[], connections:[], settings:{}, logs:[],
              },
            })});
          }, 0);
        }
        send(raw) {
          const message = JSON.parse(raw);
          if (message.type === 'ping') {
            setTimeout(() => this.onmessage?.({data:JSON.stringify({
              type:'pong', revision:this.revision,
            })}), 0);
            return;
          }
          if (message.type !== 'canvas_mutation') return;
          const operation = message.operation || {};
          (operation.changes?.node_creates || []).forEach(node => {
            window.__issue31PersistedNodeIds.push(String((node?.node || node)?.id || ''));
          });
          this.revision += 1;
          setTimeout(() => this.onmessage?.({data:JSON.stringify({
            type:'canvas_mutation', canvas_id:message.canvas_id,
            operation_id:operation.operation_id || '', revision:this.revision,
            changes:operation.changes || {}, duplicate:false,
            reverts_operation_id:'', undoable:true,
          })}), 0);
        }
        close(code=1000) { this.readyState = PreviewWebSocket.CLOSED; this.onclose?.({code}); }
      }
      window.WebSocket = PreviewWebSocket;
    });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/canvas-layer-decomposition-tasks' && request.method() === 'POST') {
        submissions.push(request.postDataJSON());
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          task_id:'issue-31-run', status:'queued', actor_id:'issue-31-admin',
        })});
        return;
      }
      if (pathname === '/api/canvas-layer-decomposition-tasks/issue-31-run' && failUpload) {
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          id:'issue-31-run',status:'failed',status_code:413,
          error:JSON.stringify({code:'reference_upload_rejected',stage:'reference_upload',source_bytes:2494369})
        })});
        return;
      }
      if (pathname === '/api/canvas-layer-decomposition-tasks/issue-31-run') {
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          id:'issue-31-run', status:'succeeded', result:{
            manifest:{
              manifest_version:1, source_media_id:'source-media', provider_id:'apimart-secondary',
              model:'seedream-layer-pro', resolution_tier:'1K', generation_run_id:'issue-31-run',
              upstream_task_id:'upstream-31', created_at:'2026-09-04T00:00:00Z',
              base_output_media_id:'/api/outputs/base.png', canvas_width:1000, canvas_height:500,
              layers:[],
            },
            base:{url:image,output_media_id:'/api/outputs/base.png'},
            layers:[
              {url:image,output_media_id:'/api/outputs/layer-1.png',name:'Foreground',pixel_width:400,pixel_height:300,z_index:1,absolute_bbox:[100,100,500,400],normalized_bbox:[0.1,0.2,0.5,0.8]},
              {url:image,output_media_id:'/api/outputs/layer-2.png',name:'Title',pixel_width:300,pixel_height:100,z_index:2,absolute_bbox:[600,50,900,150],normalized_bbox:[0.6,0.1,0.9,0.3]},
            ],
          },
        })});
        return;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(apiPayload(request.url()))});
    });

    await page.goto(
      `http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=${CANVAS_ID}&manual=1`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.layerDecomposition
      && window.SmartCanvasModules?.modelCapabilities
      && canvas?.id === 'issue-31-layer-decomposition-browser'
      && Array.isArray(nodes)
    ));
    await page.evaluate(sourceUrl => {
      if (!canvas) {
        canvas = {
          id:'issue-31-layer-decomposition-browser', title:'Issue #31 browser smoke',
          project:'default', revision:1, nodes:[], connections:[], settings:{}, logs:[],
        };
      }
      nodes.splice(0, nodes.length, {
        id:'issue-31-source', type:'smart-image', x:240, y:180, w:400, h:200,
        title:'Source', images:[{
          url:sourceUrl, media_id:'source-media', name:'source.png', kind:'image',
          natural_w:1000, natural_h:500,
        }],
      });
      canvas.nodes = nodes;
      canvas.connections = [];
      selectedId = 'issue-31-source';
      selectedIds = [];
      selectedImage = {nodeId:'issue-31-source',index:0};
      render();
      syncSmartNodeFloatingPortal();
    }, image);
    await page.waitForFunction(() => Boolean(
      document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="layer-decomposition"]')
    ));
    await page.waitForFunction(() => (
      document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="layer-decomposition"] ic-icon')?.dataset.iconStatus === 'ready'
    ));
    assert.equal(
      await page.locator('#smartNodeFloatingPortal [data-smart-node-action="layer-decomposition"] ic-icon').getAttribute('name'),
      'layers',
    );
    await page.evaluate(() => {
      document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="layer-decomposition"]').click();
    });
    await page.waitForFunction(() => (
      document.querySelector('ic-ai-processor-dialog[processor="layer-decomposition"]')?.open
      && /¥0\.3.*¥11/.test(document.querySelector('[data-layer-price]')?.textContent || '')
    ));

    const dialog = page.locator('ic-ai-processor-dialog[processor="layer-decomposition"]');
    assert.equal(await dialog.locator('ic-select[name="ai-processor-model"] option').count(), 2);
    assert.deepEqual(
      await dialog.locator('ic-select[name="ai-processor-model"] option').allTextContents(),
      ['Seedream 5.0 Pro · APIMART Primary', 'Seedream Layer Pro · APIMART Secondary'],
    );
    assert.equal(await dialog.locator('ic-alert[tone="warning"], [data-layer-capability-status]').count(), 0);
    assert.match(await dialog.locator('[data-layer-price]').textContent(), /¥0\.3.*¥11/);
    const initialResolutions = dialog.locator('ic-radio-group[name="layer-resolution"]');
    assert.deepEqual(await initialResolutions.locator('ic-radio').evaluateAll(options => options.map(option => option.value)), ['auto','1K','1.5K','2K']);
    assert.equal(await initialResolutions.getAttribute('value'), '2K');
    assert.equal(await dialog.locator('ic-generation-settings-picker[name="layer-generation-settings"]').count(), 0);
    const layout = await dialog.locator('[data-ai-processor-layout="layer-decomposition"]').boundingBox();
    const sourceStage = await dialog.locator('[data-layer-source-stage]').boundingBox();
    const parameterPanel = await dialog.locator('[data-ai-processor-panel]').boundingBox();
    assert.ok(layout && sourceStage && parameterPanel && sourceStage.x < parameterPanel.x);
    assert.equal(await dialog.locator('[data-layer-source]').evaluate(element => getComputedStyle(element).objectFit), 'contain');
    await dialog.evaluate(element => {
      const select = element.querySelector('ic-select[name="ai-processor-model"]');
      select.value = 'apimart-secondary|seedream-layer-pro';
      select.dispatchEvent(new Event('change', {bubbles:true}));
    });
    await page.waitForFunction(() => {
      const group = document.querySelector('ic-ai-processor-dialog[processor="layer-decomposition"] ic-radio-group[name="layer-resolution"]');
      return group?.getAttribute('value') === '1K'
        && [...group.querySelectorAll('ic-radio')].map(option => option.value).join(',') === 'auto,1K';
    });
    await dialog.locator('ic-textarea[name="layer-prompt"]').evaluate(element => {
      element.value = 'Keep the title separate';
      element.dispatchEvent(new Event('input', {bubbles:true}));
    });
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog[processor="layer-decomposition"]')?.label === 'Smart layer decomposition');
    assert.match(await dialog.locator('[data-layer-price]').textContent(), /Approx\. CNY/);
    assert.equal(await dialog.locator('ic-radio-group[name="layer-resolution"]').getAttribute('value'), '1K');
    assert.equal(await dialog.locator('ic-textarea[name="layer-prompt"]').evaluate(element => element.value), 'Keep the title separate');
    await page.evaluate(() => window.StudioI18n.set('zh'));
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog[processor="layer-decomposition"]')?.label === '智能分层');
    if (process.env.SMART_LAYER_SCREENSHOT) {
      await page.screenshot({path:process.env.SMART_LAYER_SCREENSHOT});
    }
    await dialog.locator('[data-ic-ai-processor-owned="confirm"]').click();

    try {
      await page.waitForFunction(() => nodes.some(node => node.layerDecompositionManifest));
      await page.waitForFunction(() => !document.querySelector('ic-ai-processor-dialog[processor="layer-decomposition"]')?.open);
    } catch (error) {
      console.error(JSON.stringify({
        submissions,
        pageErrors,
        nodes:await page.evaluate(() => nodes.map(node => ({
          id:node.id, type:node.type, job:node.layerDecompositionJob,
          decomposition:node.layerDecomposition, manifest:Boolean(node.layerDecompositionManifest),
        }))),
      }, null, 2));
      throw error;
    }
    const state = await page.evaluate(() => {
      const resultNode = nodes.find(node => node.layerDecompositionManifest);
      const items = resultNode.layerDecompositionItems || [];
      return {
        resultId:resultNode.id,
        type:resultNode.type,
        itemCount:items.length,
        roles:items.map(item => item.role),
        order:items.map(item => item.z_index),
        resultSize:[resultNode.w,resultNode.h],
        pendingCount:nodes.filter(node => node.layerDecompositionJob).length,
        persistedNodeIds:[...window.__issue31PersistedNodeIds],
      };
    });
    assert.equal(submissions.length, 1);
    assert.ok(state.persistedNodeIds.includes(submissions[0].node_id));
    assert.deepEqual({
      provider_id:submissions[0].provider_id,
      model:submissions[0].model,
      resolution_tier:submissions[0].resolution_tier,
      prompt:submissions[0].prompt,
      source_media_id:submissions[0].source_media_id,
    }, {
      provider_id:'apimart-secondary', model:'seedream-layer-pro', resolution_tier:'1K',
      prompt:'Keep the title separate', source_media_id:'source-media',
    });
    assert.equal(state.type, 'smart-layer-decomposition');
    assert.equal(state.itemCount, 3);
    assert.deepEqual(state.roles, ['base','layer','layer']);
    assert.deepEqual(state.order, [-1,1,2]);
    assert.deepEqual(state.resultSize, [350,175]);
    assert.equal(state.pendingCount, 0);

    // A restored node may retain square preview dimensions; the manifest owns the composition ratio.
    await page.evaluate(resultId => {
      const node = nodes.find(item => item.id === resultId);
      window.__layerOriginal = JSON.stringify(node);
      node.layerDecompositionManifest.canvas_width = 1000;
      node.layerDecompositionManifest.canvas_height = 1500;
      node.images[0].natural_w = 1024;
      node.images[0].natural_h = 1024;
      node.images.push(...Array.from({length:14}, (_, i) => ({url:`/layer-${i}.png`, kind:'image'})));
      delete node.w;
      delete node.h;
      node.generationMediaW = 350;
      node.generationMediaH = 350;
      render();
    }, state.resultId);
    const portraitBox = await page.locator(`.image-node[data-id="${state.resultId}"]`).boundingBox();
    assert.ok(Math.abs(portraitBox.width / portraitBox.height - 2 / 3) < 0.01, JSON.stringify(portraitBox));
    await page.evaluate(resultId => {
      const index = nodes.findIndex(item => item.id === resultId);
      nodes[index] = JSON.parse(window.__layerOriginal);
      render();
    }, state.resultId);

    const previewBehavior = await page.evaluate(resultId => {
      const resultNode = document.querySelector(`.image-node[data-id="${CSS.escape(resultId)}"]`);
      const stage = resultNode?.querySelector('.layer-decomposition-stage');
      const items = [...(stage?.querySelectorAll('.layer-decomposition-item') || [])];
      return {
        itemCount:items.length,
        stagePointerEvents:getComputedStyle(stage).pointerEvents,
        passiveItems:items.every(item => (
          getComputedStyle(item).pointerEvents === 'none'
          && !item.classList.contains('thumb-item')
          && !item.hasAttribute('data-ref-node-id')
        )),
        transparentImages:items.every(item => (
          getComputedStyle(item).backgroundColor === 'rgba(0, 0, 0, 0)'
          && getComputedStyle(item.querySelector('img')).backgroundColor === 'rgba(0, 0, 0, 0)'
        )),
      };
    }, state.resultId);
    assert.deepEqual(previewBehavior, {
      itemCount:3,
      stagePointerEvents:'none',
      passiveItems:true,
      transparentImages:true,
    });

    await page.evaluate(() => {
      selectedId = '';
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      render();
    });
    assert.equal(await page.locator(`.image-node[data-id="${state.resultId}"] .image-name-badge.image-name-badge-outside ic-icon[name="layers"]`).count(), 1);
    const stageBox = await page.locator(
      `.image-node[data-id="${state.resultId}"] .layer-decomposition-stage`
    ).boundingBox();
    assert.ok(stageBox);
    assert.ok(Math.abs(stageBox.width / stageBox.height - 2) < 0.05, JSON.stringify(stageBox));
    await page.mouse.click(
      stageBox.x + stageBox.width / 2,
      stageBox.y + stageBox.height / 2
    );
    await page.waitForTimeout(300);
    const selectedAfterPreviewClick = await page.evaluate(() => ({
      selectedId,
      selectedImage:{...selectedImage},
    }));
    assert.deepEqual(selectedAfterPreviewClick, {
      selectedId:state.resultId,
      selectedImage:{nodeId:'',index:-1},
    });

    assert.equal(await page.locator('#smartNodeFloatingPortal [data-smart-group-action]').count(), 0);
    await page.mouse.dblclick(
      stageBox.x + stageBox.width / 2,
      stageBox.y + stageBox.height / 2
    );
    await page.waitForFunction(() => Boolean(
      document.getElementById('imageEditModal')?.classList.contains('layer-decomposition-edit-mode')
      && document.querySelectorAll('#layerDecompositionEditorList [data-layer-visibility]').length === 3
    ));
    const editorLayout = await page.evaluate(() => {
      const editor = document.getElementById('layerDecompositionEditor').getBoundingClientRect();
      const composite = document.getElementById('layerDecompositionEditorComposite').getBoundingClientRect();
      const panel = document.querySelector('.layer-decomposition-editor-panel');
      const actions = document.querySelector('.layer-decomposition-editor-layer-actions');
      return {width:panel.getBoundingClientRect().width, rem:parseFloat(getComputedStyle(document.documentElement).fontSize),
        offset:composite.x + composite.width / 2 - editor.x - editor.width / 2,
        actionsPosition:getComputedStyle(actions).position,
        downloadInPanel:panel.contains(document.getElementById('layerDecompositionPsdDownload'))};
    });
    assert.equal(editorLayout.width, 9 * editorLayout.rem);
    assert.ok(Math.abs(editorLayout.offset) < 2, JSON.stringify(editorLayout));
    assert.equal(editorLayout.actionsPosition, 'absolute');
    assert.equal(editorLayout.downloadInPanel, true);
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForFunction(() => document.querySelector('.image-node.smart-layer-decomposition .image-name-badge-copy')?.textContent === 'Smart layer decomposition'
      || [...document.querySelectorAll('.image-name-badge-copy')].some(el => el.textContent === 'Smart layer decomposition'));
    assert.equal(await page.locator('#layerDecompositionPsdDownload').innerText(), 'Download PSD');
    await page.evaluate(() => window.StudioI18n.set('zh'));
    if (process.env.SMART_LAYER_EDITOR_SCREENSHOT) await page.screenshot({path:process.env.SMART_LAYER_EDITOR_SCREENSHOT});
    await page.setViewportSize({width:600,height:900});
    const compact = await page.locator('.layer-decomposition-editor-panel').boundingBox();
    assert.ok(compact.x >= 0 && compact.x + compact.width <= 600);
    await page.setViewportSize({width:1440,height:900});
    const hiddenItemId = await page.locator('#layerDecompositionEditorList [data-layer-visibility]').first().getAttribute('data-layer-visibility');
    await page.locator('#layerDecompositionEditorList .layer-decomposition-editor-layer').first().hover();
    await page.locator('#layerDecompositionEditorList [data-layer-visibility]').first().click();
    const hidden = await page.evaluate(({resultId,itemId}) => nodes
      .find(node => node.id === resultId)
      ?.layerDecompositionItems.find(item => item.id === itemId)?.hidden, {
        resultId:state.resultId,
        itemId:hiddenItemId,
      });
    assert.equal(hidden, true);
    failUpload = true;
    const uploadFailure = await page.evaluate(async () => {
      window.StudioI18n.set('zh');
      await smartLayerDecomposition.run({node:nodes.find(item => item.id === 'issue-31-source'),
        providerId:'apimart-secondary',modelId:'seedream-layer-pro',resolutionTier:'1K'});
      await smartLayerDecomposition.waitForIdle();
      return {refs:canvas.logs[0].refs.length, category:canvas.logs[0].errorDetail.category};
    });
    assert.deepEqual(uploadFailure, {refs:1,category:'reference_upload_rejected'});
    await page.waitForFunction(() => document.body.innerText.includes('参考图上传被拒绝'));
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForFunction(() => document.body.innerText.includes('Reference upload rejected'));
    await page.waitForFunction(() => !document.body.innerText.includes('参考图上传被拒绝'));
    assert.deepEqual(pageErrors, []);
    console.log('Issue #31 layer decomposition browser smoke passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
