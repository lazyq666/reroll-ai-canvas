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
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          task_id:'issue-31-run', status:'queued', actor_id:'issue-31-admin',
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
      const group = nodes.find(node => node.layerDecompositionManifest);
      const members = window.SmartCanvasModules.smartContainer.groupMembers(group);
      const base = members.find(member => member.layerDecomposition?.role === 'base');
      const layers = members.filter(member => member.layerDecomposition?.role === 'layer');
      return {
        groupId:group.id,
        memberCount:members.length,
        layerCount:layers.length,
        baseGeometry:[base.x,base.y,base.w,base.h],
        layerGeometry:layers.map(layer => [layer.x,layer.y,layer.w,layer.h]),
        order:layers.map(layer => layer.layerDecomposition.z_index),
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
      provider_id:'apimart', model:'seedream-5-0-pro', resolution_tier:'2K',
      prompt:'', source_media_id:'source-media',
    });
    assert.equal(state.memberCount, 3);
    assert.equal(state.layerCount, 2);
    assert.deepEqual(state.order, [1, 2]);
    assert.deepEqual(state.layerGeometry, [
      [state.baseGeometry[0] + 35, state.baseGeometry[1] + 35, 140, 105],
      [state.baseGeometry[0] + 210, state.baseGeometry[1] + 17.5, 105, 35],
    ]);
    assert.equal(state.pendingCount, 0);

    await page.evaluate(groupId => {
      const group = nodes.find(node => node.id === groupId);
      const layer = window.SmartCanvasModules.smartContainer.groupMembers(group)
        .find(member => member.layerDecomposition?.role === 'layer');
      selectedId = group.id;
      selectedImage = {nodeId:layer.id,index:0};
      syncSmartNodeFloatingPortal();
    }, state.groupId);
    await page.waitForFunction(() => Boolean(
      document.querySelector('#smartNodeFloatingPortal [data-smart-group-action="layer-visibility"]')
      && document.querySelector('#smartNodeFloatingPortal [data-smart-group-action="layer-backward"]')
      && document.querySelector('#smartNodeFloatingPortal [data-smart-group-action="layer-forward"]')
      && document.querySelector('#smartNodeFloatingPortal [data-smart-group-action="layer-download"]')
    ));
    await page.locator('#smartNodeFloatingPortal [data-smart-group-action="layer-visibility"]').click();
    const hidden = await page.evaluate(groupId => {
      const group = nodes.find(node => node.id === groupId);
      return window.SmartCanvasModules.smartContainer.groupMembers(group)
        .find(member => member.layerDecomposition?.role === 'layer')
        .layerDecomposition.hidden;
    }, state.groupId);
    assert.equal(hidden, true);
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
