const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CANVAS_ID = 'generation-log-modal-browser-smoke';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function json(response, value, status=200){
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
  response.end(JSON.stringify(value));
}

function fixture(){
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 24, 51);
  return {
    canvas:{
      id:CANVAS_ID,
      title:'Generation Log Modal Browser Smoke',
      nodes:[
        {id:'node-custom-7bf2', type:'smart-image', title:'香氛主视觉', images:[]},
        {id:'node-generic-8f31', type:'smart-image', title:'Image', images:[]},
        {id:'node-old-31c8', type:'smart-image', title:'Image', images:[]},
      ],
      connections:[], viewport:{x:0,y:0,scale:1}, settings:{}, logs:[],
    },
    logs:[
      {
        id:'failed-log',runId:'generation-run-7bf2-91a4',nodeId:'node-custom-7bf2',nodeType:'smart-image',
        status:'failed',createdAt:now.getTime(),durationMs:18700,platform:'APIMART',model:'GPT Image 2',
        prompt:'透明玻璃香水瓶置于暖色岩石台面。日落侧逆光，材质细节清晰。',
        request:{size:'2048x2048',provider_id:'apimart',model:'gpt-image-2'},
        refs:[
          {url:'/assets/input/imported/reference-video.mp4',name:'reference-video.mp4',kind:'video'},
          {url:'/static/prototypes/reverse-prompt-fixture.svg',name:'cabin-reference.svg'},
          {url:'/static/images/test/fixture.svg',name:'geometric-reference.svg'},
        ],
        outputs:[],
        tasks:[{status:'failed',upstreamTaskId:'task_apimart_841739',runMs:18700,httpStatus:400,errorCode:'invalid_resolution',technicalError:'HTTP 400 · Unsupported size: 2048x2048. api_key=secret-browser-value'}],
        error:'HTTP 400 · Unsupported size: 2048x2048.',
      },
      {
        id:'success-log',runId:'generation-run-8f31-71d2',nodeId:'node-generic-8f31',nodeType:'smart-image',
        status:'success',createdAt:yesterday.getTime(),durationMs:36200,platform:'Gemini',model:'Nano Banana Pro',
        prompt:'暮色山谷中的现代玻璃屋。室内暖光，远处山体保留空气透视。',
        request:{size:'1536x1024',provider_id:'gemini'},
        refs:[{url:'/static/prototypes/reverse-prompt-fixture.svg',name:'cabin-reference.svg'}],
        outputs:[{url:'/static/prototypes/reverse-prompt-fixture.svg',kind:'image',width:1536,height:1024}],
        tasks:[{status:'succeeded',upstreamTaskId:'gemini-8f31',runMs:36200}],
      },
      {
        id:'old-success-log',runId:'generation-run-31c8-884a',nodeId:'node-old-31c8',nodeType:'smart-image',
        status:'success',createdAt:lastMonth.getTime(),durationMs:31600,platform:'APIMART',model:'GPT Image 1.5',
        prompt:'保留鞋款的完整结构与材质。生成均匀柔和的纯白背景商品图。',
        request:{size:'1024x1024'},refs:[],outputs:[],tasks:[{status:'succeeded',runMs:31600}],
      },
    ],
    previewRequests:[],
  };
}

function startServer(data){
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if(request.method === 'GET' && requestPath === '/api/auth/me') return json(response, {user:{id:'browser-test-user',role:'designer'}});
    if(request.method === 'GET' && requestPath === '/api/app-info') return json(response, {version:'browser-smoke'});
    if(request.method === 'GET' && requestPath === '/api/prompt-libraries') return json(response, {library:{common:{id:'common',name:'通用',scope:'common',categories:[],items:[]}}});
    if(request.method === 'GET' && requestPath === `/api/canvases/${CANVAS_ID}/prompt-templates`) return json(response, {templates:[]});
    if(request.method === 'GET' && requestPath === '/api/config') return json(response, {api_providers:[],available_models:{image:[],video:[],text:[]},comfy_instances:[]});
    if(request.method === 'GET' && requestPath === '/api/workflows') return json(response, {workflows:[]});
    if(request.method === 'GET' && requestPath === `/api/canvases/${CANVAS_ID}`) return json(response, {canvas:data.canvas});
    if(request.method === 'GET' && requestPath === `/api/canvases/${CANVAS_ID}/logs`) return json(response, {logs:data.logs,next_cursor:''});
    if(request.method === 'GET' && requestPath === '/api/media-preview'){
      data.previewRequests.push(new URL(request.url, 'http://127.0.0.1').searchParams.get('url') || '');
      return fs.readFile(path.join(ROOT, 'static/images/test/fixture.svg'), (error, body) => {
        if(error) return response.writeHead(500).end(error.message);
        response.writeHead(200, {'Content-Type':'image/png'}).end(body);
      });
    }
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if(error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = {
        '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
        '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.json':'application/json',
      }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, {'Content-Type':type}).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function debuggerUrl(browser){
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'Chrome debugger timeout')), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
  });
}

async function connect(url){
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once:true});
    socket.addEventListener('error', reject, {once:true});
  });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if(operation){
      pending.delete(payload.id);
      payload.error ? operation.reject(new Error(JSON.stringify(payload.error))) : operation.resolve(payload.result);
    } else if(payload.method) events.push(payload);
  });
  return {
    events,
    send(method, params={}, sessionId){
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve,reject});
        socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression){
  const result = await cdp.send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true}, sessionId);
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout=30000){
  const deadline = Date.now() + timeout;
  while(Date.now() < deadline){
    if(await evaluate(cdp, sessionId, expression)) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(cdp, sessionId, targetPath){
  if(!targetPath) return;
  const result = await cdp.send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false}, sessionId);
  fs.writeFileSync(targetPath, Buffer.from(result.data, 'base64'));
}

(async () => {
  if(!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const data = fixture();
  const server = await startServer(data);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-generation-log-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new','--disable-gpu','--no-first-run','--remote-allow-origins=*',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank',
  ], {stdio:['ignore','ignore','pipe']});
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', {url:'about:blank'});
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId:target.targetId,flatten:true});
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false}, sessionId);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await cdp.send('Browser.grantPermissions', {origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
    await cdp.send('Page.navigate', {url:`${origin}/static/smart-canvas.html?id=${CANVAS_ID}`}, sessionId);
    await waitFor(cdp, sessionId, "typeof openSmartCanvasLog === 'function' && customElements.get('ic-button') && window.SmartCanvasModules?.generationLogModal", 'Smart Canvas generation log runtime');
    await evaluate(cdp, sessionId, `(async () => {
      canvas=${JSON.stringify(data.canvas)};
      nodes=canvas.nodes;
      smartCanvasLogsHydrated=false;
      await openSmartCanvasLog();
      return true;
    })()`);
    await waitFor(cdp, sessionId, "document.querySelectorAll('.generation-log-index-item').length === 3", 'three generation log records');

    const initial = await evaluate(cdp, sessionId, `(() => {
      const root=document.querySelector('#smartLogModal');
      const items=[...document.querySelectorAll('.generation-log-index-item')];
      const failed=items.find(item=>item.dataset.logId==='failed-log');
      const success=items.find(item=>item.dataset.logId==='success-log');
      const detail=document.querySelector('[data-generation-log-selected-detail]');
      const failureSummary=detail.querySelector('.generation-log-failure-summary');
      const copy=document.querySelector('.generation-log-copy');
      return {
        modalOpen:root.hasAttribute('open'),
        modalElement:root.localName,
        modalInsideCanvasShell:Boolean(root.closest('#shell')),
        title:root.getAttribute('label'),
        headerPadding:getComputedStyle(root.shadowRoot.querySelector('[part~="header"]')).padding,
        themeControls:root.querySelectorAll('[data-theme],[icon="light"],[icon="dark"]').length,
        focusedTarget:document.activeElement?.className || document.activeElement?.localName || '',
        groups:[...document.querySelectorAll('.generation-log-index-group > h2')].map(item=>item.textContent.trim()),
        itemCount:items.length,
        failedHeight:Math.round(failed.getBoundingClientRect().height),
        successHeight:Math.round(success.getBoundingClientRect().height),
        failedIndexTitle:failed.querySelector('.generation-log-index-heading strong')?.textContent.trim(),
        successIndexTitle:success.querySelector('.generation-log-index-heading strong')?.textContent.trim(),
        failedReasonIconCount:failed.querySelectorAll('.generation-log-index-reason .generation-log-status-icon.failed').length,
        failedReasonIconSize:(() => {
          const icon=failed.querySelector('.generation-log-index-reason .generation-log-status-icon.failed');
          const glyph=icon?.querySelector('ic-icon');
          return icon && glyph ? {
            container:[getComputedStyle(icon).width,getComputedStyle(icon).height],
            glyph:[getComputedStyle(glyph).width,getComputedStyle(glyph).height],
            background:getComputedStyle(icon).backgroundColor,
          } : null;
        })(),
        failedVisualIconCount:failed.querySelectorAll('.generation-log-index-visual .generation-log-status-icon.failed').length,
        successIndexIconCount:success.querySelectorAll('.generation-log-status-icon').length,
        successThumbnailCount:success.querySelectorAll('.generation-log-index-visual > img').length,
        indexPadding:getComputedStyle(document.querySelector('.generation-log-index-scroll')).padding,
        indexBackground:getComputedStyle(document.querySelector('.generation-log-index-scroll')).backgroundColor,
        canvasBackground:getComputedStyle(document.body).backgroundColor,
        indexScrollbarWidth:getComputedStyle(document.querySelector('.generation-log-index-scroll')).scrollbarWidth,
        indexItemGap:getComputedStyle(failed).columnGap,
        indexTitleWeight:getComputedStyle(failed.querySelector('.generation-log-index-heading strong')).fontWeight,
        selectedRun:detail?.dataset.generationRunId,
        taskTitle:detail?.querySelector('h2')?.textContent.trim(),
        facts:[...detail.querySelectorAll('.generation-log-detail-facts span')].map(span=>span.textContent.trim()),
        referenceCount:detail.querySelectorAll('[data-generation-log-preview]').length,
        videoReference:(() => {
          const image=detail.querySelector('img[data-preview-kind="video"]');
          return image ? {
            src:image.getAttribute('src'),
            original:image.dataset.originalSrc,
            loaded:image.complete && image.naturalWidth > 0,
          } : null;
        })(),
        detailPadding:getComputedStyle(detail).padding,
        detailHeaderFailedIconCount:detail.querySelectorAll('.generation-log-detail-heading .generation-log-status-icon.failed.is-detail').length,
        failureSummaryIconCount:failureSummary?.querySelectorAll('.generation-log-status-icon.failed.is-detail').length,
        failureSummaryIconSize:(() => {
          const icon=failureSummary?.querySelector('.generation-log-status-icon.failed.is-detail');
          const glyph=icon?.querySelector('ic-icon');
          return icon && glyph ? {
            container:[getComputedStyle(icon).width,getComputedStyle(icon).height],
            glyph:[getComputedStyle(glyph).width,getComputedStyle(glyph).height],
            background:getComputedStyle(icon).backgroundColor,
          } : null;
        })(),
        failureSummaryBackground:getComputedStyle(failureSummary).backgroundColor,
        failureSummaryRadius:getComputedStyle(failureSummary).borderRadius,
        failureSummaryBorderLeft:getComputedStyle(failureSummary).borderLeftWidth,
        technicalOpen:detail.querySelector('.generation-log-technical')?.open,
        indexCopyCount:document.querySelector('.generation-log-index').querySelectorAll('[data-generation-log-copy]').length,
        detailCopyCount:document.querySelector('.generation-log-detail').querySelectorAll('[data-generation-log-copy]').length,
        copyElement:copy?.localName,
        copyHierarchy:copy?.getAttribute('hierarchy'),
        copyLabel:copy?.textContent.trim(),
        copyIcon:copy?.querySelector('ic-icon')?.getAttribute('name'),
        actionsPadding:getComputedStyle(document.querySelector('.generation-log-actions')).padding,
        lightSurface:getComputedStyle(document.querySelector('.generation-log-dialog')).backgroundColor,
      };
    })()`);
    assert.equal(initial.modalOpen, true);
    assert.equal(initial.modalElement, 'ic-dialog');
    assert.equal(initial.modalInsideCanvasShell, false);
    assert.equal(initial.title, '生成日志');
    assert.equal(initial.headerPadding, '16px');
    assert.equal(initial.themeControls, 0);
    assert.match(initial.focusedTarget, /generation-log-index-item/);
    assert.equal(initial.itemCount, 3);
    assert.ok(initial.groups.some(label => label.startsWith('今天')));
    assert.ok(initial.groups.some(label => label.startsWith('昨天')));
    assert.ok(initial.groups.some(label => label.startsWith('上个月')));
    assert.ok(initial.failedHeight > initial.successHeight);
    assert.equal(initial.failedIndexTitle, '任务失败 · 透明玻璃香水瓶置于暖色岩石台面。');
    assert.equal(initial.successIndexTitle, '任务成功 · 暮色山谷中的现代玻璃屋。');
    assert.equal(initial.failedReasonIconCount, 1);
    assert.deepEqual(initial.failedReasonIconSize.container, initial.failedReasonIconSize.glyph);
    assert.equal(initial.failedReasonIconSize.background, 'rgba(0, 0, 0, 0)');
    assert.equal(initial.failedVisualIconCount, 0);
    assert.equal(initial.successIndexIconCount, 0);
    assert.equal(initial.successThumbnailCount, 1);
    assert.equal(initial.indexPadding, '12px');
    assert.equal(initial.indexBackground, initial.canvasBackground);
    assert.equal(initial.indexScrollbarWidth, 'thin');
    assert.equal(initial.indexItemGap, '12px');
    assert.equal(initial.indexTitleWeight, '400');
    assert.equal(initial.selectedRun, 'generation-run-7bf2-91a4');
    assert.equal(initial.taskTitle, '图片生成 · 香氛主视觉');
    assert.ok(initial.facts.includes('2048 × 2048'));
    assert.ok(initial.facts.includes('GPT Image 2'));
    assert.ok(initial.facts.includes('APIMART'));
    assert.equal(initial.referenceCount, 3);
    assert.ok(initial.videoReference?.src.includes('/api/media-preview'));
    assert.equal(initial.videoReference?.original, '/assets/input/imported/reference-video.mp4');
    assert.equal(initial.videoReference?.loaded, true);
    assert.ok(data.previewRequests.includes('/assets/input/imported/reference-video.mp4'));
    assert.equal(initial.detailPadding, '20px');
    assert.equal(initial.detailHeaderFailedIconCount, 0);
    assert.equal(initial.failureSummaryIconCount, 1);
    assert.deepEqual(initial.failureSummaryIconSize.container, initial.failureSummaryIconSize.glyph);
    assert.equal(initial.failureSummaryIconSize.background, 'rgba(0, 0, 0, 0)');
    assert.notEqual(initial.failureSummaryBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(initial.failureSummaryRadius, '8px');
    assert.equal(initial.failureSummaryBorderLeft, '0px');
    assert.equal(initial.technicalOpen, false);
    assert.equal(initial.indexCopyCount, 0);
    assert.equal(initial.detailCopyCount, 1);
    assert.equal(initial.copyElement, 'ic-button');
    assert.equal(initial.copyHierarchy, 'primary');
    assert.equal(initial.copyLabel, '复制诊断信息');
    assert.equal(initial.copyIcon, 'duplicate');
    assert.equal(initial.actionsPadding, '16px');

    const pointerOwnershipTarget = await evaluate(cdp, sessionId, `(() => {
      const detail=document.querySelector('.generation-log-detail-view');
      const rect=detail.getBoundingClientRect();
      const x=Math.round(rect.left + Math.min(120, rect.width / 2));
      const y=Math.round(rect.top + Math.min(120, rect.height / 2));
      const world=window.SmartCanvasModules.viewportSelection.viewport.screenToWorld({clientX:x,clientY:y});
      Object.assign(nodes[0], {
        x:world.x - 60,
        y:world.y - 60,
        width:120,
        height:120,
        referenceGenerationKind:'image',
        runSettings:{engine:'api',apiKind:'image'},
      });
      selectedId='';
      selectedIds=[];
      selectedImage={nodeId:'',index:-1};
      render();
      return {x,y,hit:document.elementFromPoint(x,y)?.closest('#smartLogModal')?.id || ''};
    })()`);
    assert.equal(pointerOwnershipTarget.hit, 'smartLogModal');
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:pointerOwnershipTarget.x,y:pointerOwnershipTarget.y}, sessionId);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:pointerOwnershipTarget.x,y:pointerOwnershipTarget.y,button:'left',clickCount:1}, sessionId);
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:pointerOwnershipTarget.x,y:pointerOwnershipTarget.y,button:'left',clickCount:1}, sessionId);
    await delay(80);
    const pointerOwnership = await evaluate(cdp, sessionId, `(() => ({
      selectedId,
      selectedIds:selectedIds.slice(),
      composerOpen:composer.classList.contains('open'),
      modalOpen:document.querySelector('#smartLogModal').hasAttribute('open'),
    }))()`);
    assert.equal(pointerOwnership.selectedId, '', 'pointer input inside the Generation Log Modal must not select a Node behind it');
    assert.deepEqual(pointerOwnership.selectedIds, [], 'pointer input inside the Generation Log Modal must not start Canvas Selection');
    assert.equal(pointerOwnership.composerOpen, false, 'pointer input inside the Generation Log Modal must not open the Node Composer');
    assert.equal(pointerOwnership.modalOpen, true);

    const contextMenuResults = await evaluate(cdp, sessionId, `(() => {
      const root=document.querySelector('#smartLogModal');
      const targets=[
        ['header',root.shadowRoot.querySelector('[part~="header"]')],
        ['index',root.querySelector('.generation-log-index-item')],
        ['detail',root.querySelector('.generation-log-detail-view')],
        ['actions',root.querySelector('.generation-log-actions')],
        ['backdrop',root],
      ];
      return targets.map(([name,target]) => {
        closeCreateMenu?.();
        closeSmartNodeContextMenu?.();
        const rect=target.getBoundingClientRect();
        const event=new MouseEvent('contextmenu', {
          bubbles:true,cancelable:true,composed:true,button:2,
          clientX:rect.left + Math.min(12, Math.max(1, rect.width / 2)),
          clientY:rect.top + Math.min(12, Math.max(1, rect.height / 2)),
        });
        target.dispatchEvent(event);
        return {
          name,
          createMenuOpen:document.querySelector('#createMenu')?.hasAttribute('open') || false,
          nodeMenuOpen:document.querySelector('#smartNodeContextMenu')?.hasAttribute('open') || false,
        };
      });
    })()`);
    for(const result of contextMenuResults){
      assert.equal(result.createMenuOpen, false, `${result.name} must not open the canvas create context menu`);
      assert.equal(result.nodeMenuOpen, false, `${result.name} must not open the canvas node context menu`);
    }

    const wheelTarget = await evaluate(cdp, sessionId, `(() => {
      const detail=document.querySelector('.generation-log-detail-view');
      const spacer=document.createElement('div');
      spacer.dataset.generationLogWheelSpacer='';
      spacer.style.height='900px';
      detail.append(spacer);
      const rect=detail.getBoundingClientRect();
      return {
        x:Math.round(rect.left + rect.width / 2),
        y:Math.round(rect.top + Math.min(160, rect.height / 2)),
        scrollTop:detail.scrollTop,
        viewport:{x:viewport.x,y:viewport.y,scale:viewport.scale},
      };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:wheelTarget.x,y:wheelTarget.y}, sessionId);
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:wheelTarget.x,y:wheelTarget.y,deltaX:0,deltaY:240}, sessionId);
    await delay(120);
    const modalWheelResult = await evaluate(cdp, sessionId, `(() => {
      const detail=document.querySelector('.generation-log-detail-view');
      const result={viewport:{x:viewport.x,y:viewport.y,scale:viewport.scale},scrollTop:detail.scrollTop};
      detail.querySelector('[data-generation-log-wheel-spacer]')?.remove();
      detail.scrollTop=0;
      return result;
    })()`);
    assert.deepEqual(modalWheelResult.viewport, wheelTarget.viewport, 'wheel inside the open modal must not pan or zoom the canvas');
    assert.ok(modalWheelResult.scrollTop > wheelTarget.scrollTop, 'wheel inside the modal should continue to scroll modal content');

    await evaluate(cdp, sessionId, `document.querySelector('.generation-log-index-item[data-log-id="success-log"]')?.click();true`);
    await waitFor(cdp, sessionId, `document.querySelector('[data-generation-log-selected-detail]')?.dataset.generationRunId === 'generation-run-8f31-71d2'`, 'selected success log detail');
    const switched = await evaluate(cdp, sessionId, `(() => {
      const detail=document.querySelector('[data-generation-log-selected-detail]');
      return {
        run:detail.dataset.generationRunId,
        title:detail.querySelector('h2').textContent.trim(),
        prompt:detail.querySelector('.generation-log-prompt').textContent.trim(),
        copyId:document.querySelector('[data-generation-log-copy]').dataset.generationLogCopy,
        statusIconCount:detail.querySelectorAll('.generation-log-status-icon').length,
      };
    })()`);
    assert.equal(switched.run, 'generation-run-8f31-71d2');
    assert.equal(switched.title, '图片生成 · 暮色山谷中的现代玻璃屋。');
    assert.equal(switched.prompt, '暮色山谷中的现代玻璃屋。室内暖光，远处山体保留空气透视。');
    assert.equal(switched.copyId, 'success-log');
    assert.equal(switched.statusIconCount, 0);

    const interactions = await evaluate(cdp, sessionId, `(async () => {
      document.querySelector('[data-log-id="failed-log"]').click();
      const technical=document.querySelector('.generation-log-technical');
      technical.querySelector('summary').click();
      document.querySelector('[data-generation-log-preview="0"]').click();
      const lightboxOpened=!document.querySelector('[data-generation-log-lightbox]').hidden;
      document.querySelector('[data-generation-log-lightbox-close]').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
      document.querySelector('[data-generation-log-copy]').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
      await new Promise(resolve=>setTimeout(resolve,250));
      const copied=await navigator.clipboard.readText();
      return {
        technicalOpen:technical.open,
        technicalText:technical.querySelector('pre')?.textContent||'',
        lightboxOpened,
        lightboxClosed:document.querySelector('[data-generation-log-lightbox]').hidden,
        copyFeedback:document.body.textContent.includes('已复制安全诊断信息'),
        copied,
      };
    })()`);
    assert.equal(interactions.technicalOpen, true);
    assert.match(interactions.technicalText, /Unsupported size/);
    assert.equal(interactions.lightboxOpened, true);
    assert.equal(interactions.lightboxClosed, true);
    assert.equal(interactions.copyFeedback, true);
    for(const value of ['生成时间','状态','耗时','任务','节点','APIMART','GPT Image 2','2048 × 2048','generation-run-7bf2-91a4','task_apimart_841739','invalid_resolution','引用图数量: 3']) assert.ok(interactions.copied.includes(value), value);
    assert.ok(!interactions.copied.includes('secret-browser-value'));
    assert.ok(!interactions.copied.includes('base64'));

    const dark = await evaluate(cdp, sessionId, `(() => {
      StudioTheme.apply('dark');
      const dialog=getComputedStyle(document.querySelector('.generation-log-dialog'));
      return {surface:dialog.backgroundColor,color:dialog.color,themeButtons:document.querySelectorAll('.generation-log-dialog [data-theme]').length};
    })()`);
    assert.notEqual(dark.surface, initial.lightSurface);
    assert.equal(dark.themeButtons, 0);

    const screenshotBase = process.env.IC_GENERATION_LOG_SCREENSHOT || '';
    if(screenshotBase){
      await screenshot(cdp, sessionId, screenshotBase.replace(/\.png$/i, '-dark.png'));
      await evaluate(cdp, sessionId, "StudioTheme.apply('light');true");
      await screenshot(cdp, sessionId, screenshotBase.replace(/\.png$/i, '-light.png'));
    }

    const closed = await evaluate(cdp, sessionId, `(async () => {
      const modal=document.querySelector('#smartLogModal');
      await modal.hide('programmatic');
      return !modal.hasAttribute('open');
    })()`);
    assert.equal(closed, true);

    const runtimeExceptions = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown');
    assert.equal(runtimeExceptions.length, 0, JSON.stringify(runtimeExceptions));

    cdp.events.length = 0;
    await cdp.send('Page.navigate', {url:`${origin}/static/ui-component-library.html#dialog`}, sessionId);
    await waitFor(cdp, sessionId, `(() => {
      const frame=document.querySelector('[data-dialog-matrix]');
      return !frame?.hidden && frame.contentDocument?.documentElement?.dataset.dialogCaseStatus==='ready';
    })()`, 'Dialog component library preview');
    const libraryPreview = await evaluate(cdp, sessionId, `(async () => {
      const frame=document.querySelector('[data-dialog-matrix]');
      const preview=frame.contentDocument;
      const launcher=preview.querySelector('[data-open-generation-log]');
      launcher.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
      const root=preview.querySelector('#generation-log-preview');
      await new Promise(resolve=>setTimeout(resolve,80));
      return {
        activeReview:document.body.dataset.activeReview,
        frameVisible:!frame.hidden,
        launcherLabel:launcher.textContent.trim(),
        modalOpen:root.hasAttribute('open'),
        modalElement:root.localName,
        title:root.getAttribute('label'),
        itemCount:root.querySelectorAll('.generation-log-index-item').length,
        selectedTitle:root.querySelector('[data-generation-log-selected-detail] h2')?.textContent.trim(),
        copyHierarchy:root.querySelector('[data-generation-log-copy]')?.getAttribute('hierarchy'),
      };
    })()`);
    assert.equal(libraryPreview.activeReview, 'dialog');
    assert.equal(libraryPreview.frameVisible, true);
    assert.equal(libraryPreview.launcherLabel, 'Open');
    assert.equal(libraryPreview.modalOpen, true);
    assert.equal(libraryPreview.modalElement, 'ic-dialog');
    assert.equal(libraryPreview.title, '生成日志');
    assert.equal(libraryPreview.itemCount, 3);
    assert.equal(libraryPreview.selectedTitle, '图片生成 · 香氛主视觉');
    assert.equal(libraryPreview.copyHierarchy, 'primary');
    if(screenshotBase) await screenshot(cdp, sessionId, screenshotBase.replace(/\.png$/i, '-component-library.png'));

    const libraryExceptions = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown');
    assert.equal(libraryExceptions.length, 0, JSON.stringify(libraryExceptions));
    process.stdout.write('Generation Log Modal browser smoke passed.\n');
  } finally {
    browser.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
