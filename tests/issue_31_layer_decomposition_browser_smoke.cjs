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

function capabilityPayload() {
  return {
    provider_id:'apimart', model_id:'seedream-5-0-pro',
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
      resolution_tier:{type:'enum',values:['auto','1K','1.5K','2K'],default:'2K'},
      count:{type:'integer',minimum:1,maximum:1,default:1},
    },
    output:{kind:'image_layer_decomposition',count:{minimum:1,maximum:1,default:1}},
  };
}

function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') return { api_providers:[], available_models:{}, comfy_instances:[] };
  if (pathname === '/api/workflows') return { workflows:[] };
  if (pathname === '/api/prompt-libraries') return { library:{libraries:[]} };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates:[] };
  if (pathname === '/api/auth/me') return { user:{id:'issue-31-admin',username:'admin',role:'admin'} };
  if (pathname === '/api/workspace-assets') return { items:[], next_cursor:'' };
  if (pathname === '/api/model-capabilities') return capabilityPayload();
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
        const taskId = submissions.length === 1
          ? 'issue-31-run'
          : 'issue-31-failed-run';
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          task_id:taskId, status:'queued', actor_id:'issue-31-admin',
        })});
        return;
      }
      if (pathname === '/api/canvas-layer-decomposition-tasks/issue-31-run') {
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          id:'issue-31-run', status:'succeeded', result:{
            manifest:{
              manifest_version:1, source_media_id:'source-media', provider_id:'apimart',
              model:'seedream-5-0-pro', resolution_tier:'2K', generation_run_id:'issue-31-run',
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
      if (pathname === '/api/canvas-layer-decomposition-tasks/issue-31-failed-run') {
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          id:'issue-31-failed-run', status:'failed', status_code:422,
          error:'上传异常 400: 未配置 APIMART 的 API Key，请在 API 平台管理中填写。',
          recoverable:false,
          diagnostics:{
            generation_run_id:'issue-31-failed-run', provider_id:'apimart',
            upstream_task_ids:[], http_status:422,
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
    await page.evaluate(() => {
      document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="layer-decomposition"]').click();
    });
    await page.waitForFunction(() => (
      document.getElementById('layerDecompositionDialog')?.open
      && /1\.53/.test(document.querySelector('[data-layer-price]')?.textContent || '')
    ));

    const dialog = page.locator('#layerDecompositionDialog');
    assert.equal(await dialog.locator('[data-layer-resolution] option[value="4K"]').count(), 0);
    assert.equal(await dialog.locator('[data-aspect-ratio], [data-exact-width]').count(), 0);
    assert.match(await dialog.locator('[data-layer-price]').textContent(), /1\.53/);
    await dialog.locator('[data-layer-resolution]').selectOption('1K');
    assert.match(await dialog.locator('[data-layer-price]').textContent(), /0\.765/);
    await dialog.locator('[data-layer-resolution]').selectOption('2K');
    await dialog.locator('[data-layer-submit]').click();

    try {
      await page.waitForFunction(() => nodes.some(node => node.layerDecompositionManifest));
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
      const result = nodes.find(node => node.layerDecompositionManifest);
      const items = result.layerDecompositionItems || [];
      const layers = items.filter(item => item.role === 'layer');
      return {
        resultId:result.id,
        type:result.type,
        isGroup:window.SmartCanvasModules.smartContainer.isGroup(result),
        nodeCount:nodes.length,
        itemCount:items.length,
        layerCount:layers.length,
        resultGeometry:[result.x,result.y,result.w,result.h],
        layerBounds:layers.map(layer => layer.absolute_bbox),
        order:layers.map(layer => layer.z_index),
        pendingCount:nodes.filter(node => node.layerDecompositionJob).length,
        jobs:nodes.filter(node => node.layerDecompositionJob).map(node => ({id:node.id,type:node.type,job:node.layerDecompositionJob})),
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
      provider_id:'apimart', model:'seedream-5-0-pro', resolution_tier:'2K',
      prompt:'', source_media_id:'source-media',
    });
    assert.equal(state.type, 'smart-layer-decomposition');
    assert.equal(state.isGroup, false);
    assert.equal(state.nodeCount, 2);
    assert.equal(state.itemCount, 3);
    assert.equal(state.layerCount, 2);
    assert.deepEqual(state.order, [1, 2]);
    assert.deepEqual(state.layerBounds, [
      [100,100,500,400],
      [600,50,900,150],
    ]);
    assert.deepEqual(state.resultGeometry, [840,180,350,175]);
    assert.equal(state.pendingCount, 0, JSON.stringify(state.jobs));

    const previewBehavior = await page.evaluate(resultId => {
      const result = document.querySelector(`.image-node[data-id="${CSS.escape(resultId)}"]`);
      const stage = result?.querySelector('.layer-decomposition-stage');
      const items = [...(stage?.querySelectorAll('.layer-decomposition-item') || [])];
      const stageRect = stage?.getBoundingClientRect();
      const baseRect = items[0]?.getBoundingClientRect();
      return {
        itemCount:items.length,
        stageHasArea:Boolean(stageRect?.width > 0 && stageRect?.height > 0),
        baseLayerHasArea:Boolean(baseRect?.width > 0 && baseRect?.height > 0),
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
      stageHasArea:true,
      baseLayerHasArea:true,
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
    const stageBox = await page.locator(
      `.image-node[data-id="${state.resultId}"] .layer-decomposition-stage`
    ).boundingBox();
    assert.ok(stageBox);
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

    const selectedPresentation = await page.evaluate(resultId => {
      const result = nodes.find(node => node.id === resultId);
      selectedId = result.id;
      selectedImage = {nodeId:'',index:-1};
      syncSmartNodeFloatingPortal();
      const contextMarkup = smartContextMenuSections({nodeId:result.id,mediaNodeId:result.id,mediaIndex:-1})
        .flat().join('');
      return {
        composerOpen:document.getElementById('composer')?.classList.contains('open') || false,
        groupToolbarActions:document.querySelectorAll('#smartNodeFloatingPortal [data-smart-group-action]').length,
        quickAddActions:document.querySelectorAll(`.image-node[data-id="${CSS.escape(result.id)}"] [data-node-quick-add]`).length,
        forbiddenContextActions:['run-group','add-to-group','arrange-group','ungroup','download-group','grid-group']
          .filter(action => contextMarkup.includes(`value="${action}"`)),
      };
    }, state.resultId);
    assert.deepEqual(selectedPresentation, {
      composerOpen:false,
      groupToolbarActions:0,
      quickAddActions:0,
      forbiddenContextActions:[],
    });

    await page.mouse.dblclick(
      stageBox.x + stageBox.width / 2,
      stageBox.y + stageBox.height / 2
    );
    await page.waitForFunction(() => document.getElementById('imageEditModal')?.classList.contains('layer-decomposition-edit-mode'));
    const editorPresentation = await page.evaluate(() => {
      const modal = document.getElementById('imageEditModal');
      const toolbar = document.getElementById('imageEditModeToolbar');
      const editor = document.getElementById('layerDecompositionEditor');
      const rows = [...document.querySelectorAll('#layerDecompositionEditorList .layer-decomposition-editor-layer')];
      return {
        open:modal.classList.contains('open'),
        modeToolbarDisplay:getComputedStyle(toolbar).display,
        editorHidden:editor.hidden,
        layerCount:Number(document.getElementById('layerDecompositionEditorCount')?.textContent || 0),
        rowNames:rows.map(row => row.querySelector('.layer-decomposition-editor-layer-name')?.textContent.trim()),
        rowActionCounts:rows.map(row => row.querySelectorAll('ic-icon-button').length),
        compositeItems:document.querySelectorAll('#layerDecompositionEditorComposite .layer-decomposition-item').length,
        psdLabel:document.getElementById('layerDecompositionPsdDownload')?.textContent.trim(),
        psdDisabled:document.getElementById('layerDecompositionPsdDownload')?.disabled,
      };
    });
    assert.deepEqual(editorPresentation, {
      open:true,
      modeToolbarDisplay:'none',
      editorHidden:false,
      layerCount:3,
      rowNames:['Title','Foreground','合成底图'],
      rowActionCounts:[2,2,2],
      compositeItems:3,
      psdLabel:'下载 PSD',
      psdDisabled:true,
    });

    const firstLayerRow = page.locator('#layerDecompositionEditorList .layer-decomposition-editor-layer').first();
    await firstLayerRow.hover();
    assert.equal(await firstLayerRow.locator('.layer-decomposition-editor-layer-actions').evaluate(element => getComputedStyle(element).opacity), '1');
    await firstLayerRow.locator('[data-layer-visibility]').click();
    const hiddenState = await page.evaluate(resultId => {
      const result = nodes.find(node => node.id === resultId);
      return {
        titleHidden:result.layerDecompositionItems.find(item => item.media?.name === 'Title')?.hidden,
        hiddenCompositeItems:document.querySelectorAll('#layerDecompositionEditorComposite .layer-decomposition-item.is-hidden').length,
      };
    }, state.resultId);
    assert.deepEqual(hiddenState, {titleHidden:true,hiddenCompositeItems:1});
    const foregroundRow = page.locator('#layerDecompositionEditorList .layer-decomposition-editor-layer', {hasText:'Foreground'});
    await foregroundRow.hover();
    await foregroundRow.locator('[data-layer-delete]').click();
    const deleteState = await page.evaluate(resultId => {
      const result = nodes.find(node => node.id === resultId);
      return {
        itemCount:result.layerDecompositionItems.length,
        foregroundExists:result.layerDecompositionItems.some(item => item.media?.name === 'Foreground'),
        listCount:document.querySelectorAll('#layerDecompositionEditorList .layer-decomposition-editor-layer').length,
        compositeCount:document.querySelectorAll('#layerDecompositionEditorComposite .layer-decomposition-item').length,
      };
    }, state.resultId);
    assert.deepEqual(deleteState, {itemCount:2,foregroundExists:false,listCount:2,compositeCount:2});
    const englishEditor = await page.evaluate(() => {
      window.StudioI18n.set('en');
      const baseRow = [...document.querySelectorAll('#layerDecompositionEditorList .layer-decomposition-editor-layer')]
        .find(row => row.querySelector('.layer-decomposition-editor-layer-name')?.textContent.trim() === 'Composite base');
      const hiddenRow = document.querySelector('#layerDecompositionEditorList .layer-decomposition-editor-layer.is-hidden');
      const result = {
        heading:document.querySelector('.layer-decomposition-editor-panel-header strong')?.textContent.trim(),
        baseName:baseRow?.querySelector('.layer-decomposition-editor-layer-name')?.textContent.trim(),
        hiddenAction:hiddenRow?.querySelector('[data-layer-visibility]')?.label,
        psd:document.getElementById('layerDecompositionPsdDownload')?.textContent.trim(),
      };
      window.StudioI18n.set('zh');
      return result;
    });
    assert.deepEqual(englishEditor, {
      heading:'Layers',
      baseName:'Composite base',
      hiddenAction:'Show layer',
      psd:'Download PSD',
    });
    const sourceAfterLayerEditor = await page.evaluate(() => {
      const sourceThumb = document.querySelector('.image-node[data-id="issue-31-source"] .thumb-item, .image-node[data-id="issue-31-source"] .image-wrap');
      sourceThumb?.dispatchEvent(new MouseEvent('dblclick', {
        bubbles:true,
        cancelable:true,
        composed:true,
        detail:2,
      }));
      const modal = document.getElementById('imageEditModal');
      return {
        selectedImage:{...selectedImage},
        layerMode:modal.classList.contains('layer-decomposition-edit-mode'),
        layerEditorHidden:document.getElementById('layerDecompositionEditor')?.hidden,
        normalStageVisible:getComputedStyle(document.querySelector('.image-edit-stage-inner')).display !== 'none',
      };
    });
    assert.deepEqual(sourceAfterLayerEditor, {
      selectedImage:{nodeId:'issue-31-source',index:0},
      layerMode:false,
      layerEditorHidden:true,
      normalStageVisible:true,
    });
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());

    await page.evaluate(sourceUrl => {
      nodes.push({
        id:'issue-31-failure-source', type:'smart-image', x:1480, y:180, w:400, h:200,
        title:'Failure source', images:[{
          url:sourceUrl, media_id:'failure-source-media', name:'failure-source.png', kind:'image',
          natural_w:1000, natural_h:500,
        }],
      });
      selectedId = 'issue-31-failure-source';
      selectedIds = [];
      selectedImage = {nodeId:'issue-31-failure-source',index:0};
      render();
    }, image);
    await page.evaluate(async () => {
      const source = nodes.find(node => node.id === 'issue-31-failure-source');
      await smartLayerDecomposition.run({
        node:source,
        imageIndex:0,
        resolutionTier:'2K',
        prompt:'',
      });
    });
    await page.waitForFunction(() => nodes.some(node => (
      node.layerDecompositionJob?.taskId === 'issue-31-failed-run'
      && node.layerDecompositionJob.status === 'failed'
    )));
    await page.waitForFunction(() => Boolean(
      document.querySelector('#generationFailureAlertQueue ic-alert')
    ));
    const failurePresentation = await page.evaluate(() => {
      const node = nodes.find(item => item.layerDecompositionJob?.taskId === 'issue-31-failed-run');
      const element = document.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"]`);
      const alert = document.querySelector('#generationFailureAlertQueue ic-alert');
      return {
        submissions:window.__issue31PersistedNodeIds.includes(node.id),
        nodeFailedState:String(element?.getAttribute('state') || '').split(/\s+/).includes('failed'),
        generationFailedComponent:Boolean(element?.querySelector('[data-node-generation-failure="1"]')),
        embeddedAlert:Boolean(element?.querySelector('ic-alert')),
        alertHeading:alert?.getAttribute('heading') || '',
        alertAction:alert?.getAttribute('action-label') || '',
      };
    });
    assert.equal(submissions.length, 2);
    assert.deepEqual(failurePresentation, {
      submissions:true,
      nodeFailedState:true,
      generationFailedComponent:true,
      embeddedAlert:false,
      alertHeading:'智能分层失败',
      alertAction:'查看详情',
    });
    const migrationState = await page.evaluate(sourceUrl => {
      nodes.push(
        {
          id:'legacy-layer-base',type:'smart-image',x:3000,y:400,w:320,h:160,
          images:[{url:sourceUrl,name:'legacy-base.png',kind:'image',natural_w:1000,natural_h:500}],
          layerDecomposition:{role:'base',z_index:-1,hidden:false},
        },
        {
          id:'legacy-layer-one',type:'smart-image',x:3032,y:432,w:128,h:96,
          images:[{url:sourceUrl,name:'Legacy foreground',kind:'image',natural_w:400,natural_h:300}],
          layerDecomposition:{role:'layer',source_index:0,z_index:1,absolute_bbox:[100,100,500,400],normalized_bbox:[.1,.2,.5,.8],hidden:true},
        },
        {
          id:'legacy-layer-group',type:'smart-group',x:2984,y:356,w:352,h:232,
          title:'智能分层组',images:[],items:['legacy-layer-base','legacy-layer-one'],
          memberOrder:[{kind:'node',id:'legacy-layer-base'},{kind:'node',id:'legacy-layer-one'}],
          layerDecompositionManifest:{canvas_width:1000,canvas_height:500},
        },
      );
      canvas.connections.push({from:'issue-31-source',to:'legacy-layer-base',kind:'input'});
      const migrated = migrateLegacyLayerDecompositionGroups();
      const result = nodes.find(node => node.id === 'legacy-layer-group');
      return {
        migrated,
        type:result?.type,
        isGroup:window.SmartCanvasModules.smartContainer.isGroup(result),
        itemCount:result?.layerDecompositionItems?.length,
        hidden:result?.layerDecompositionItems?.find(item => item.role === 'layer')?.hidden,
        geometry:[result?.x,result?.y,result?.w,result?.h],
        legacyMembersRemain:nodes.some(node => ['legacy-layer-base','legacy-layer-one'].includes(node.id)),
        remappedConnection:canvas.connections.some(connection => connection.from === 'issue-31-source' && connection.to === 'legacy-layer-group'),
      };
    }, image);
    assert.deepEqual(migrationState, {
      migrated:true,
      type:'smart-layer-decomposition',
      isGroup:false,
      itemCount:2,
      hidden:true,
      geometry:[3000,400,320,160],
      legacyMembersRemain:false,
      remappedConnection:true,
    });
    const englishAlert = await page.evaluate(() => {
      window.StudioI18n.set('en');
      const alert = document.querySelector('#generationFailureAlertQueue ic-alert');
      return {
        heading:alert?.getAttribute('heading') || '',
        action:alert?.getAttribute('action-label') || '',
      };
    });
    assert.deepEqual(englishAlert, {
      heading:'Smart layer decomposition failed',
      action:'View details',
    });
    await page.evaluate(() => {
      window.StudioI18n.set('zh');
    });
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
