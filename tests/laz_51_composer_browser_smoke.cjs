const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startManualServer() {
  const port = await reservePort();
  const child = spawn('python3', ['tests/smart_canvas_manual_server.py'], {
    cwd: root,
    env: { ...process.env, SMART_CANVAS_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Manual server startup timed out: ${output.join('')}`)), 10000);
    const check = chunk => {
      if (!chunk.toString().includes('Smart Canvas manual server:')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', check);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Manual server exited with ${code}: ${output.join('')}`));
    });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

async function stopManualServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGTERM');
}



async function authoringScenario(context, baseUrl) {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));

  await page.route('**/api/local-generation-submissions',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:false})}));
  await page.route('**/api/canvases/issue-47-text-composer',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({canvas:{id:'issue-47-text-composer',canvas_type:'smart',nodes:[],connections:[],settings:{},revision:0}})}));
  await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`);
  await page.waitForFunction(() => canvas?.id === 'issue-47-text-composer' && window.SmartCanvasModules.canvasPersistence.online());
  const failures = [];
  for (const [nodeId, editorId] of [['media-a', 'promptInput'], ['text-a', 'textPromptInput']]) {
    await page.evaluate(id => {
      selectedId=id; selectedIds=[]; updateComposer();
      canvasMutation.create({kind:'prepared',data:{node:{id:`ref-${id}`,type:'smart-image',title:'Reference',x:1600,y:80,w:220,h:160,images:[{url:'/static/images/test/fixture.svg',name:'Reference',kind:'image'}]}},options:{select:false,reveal:false,placement:{anchor:{kind:'point',x:1600,y:80},relation:'free',arrangement:'single'}}});
    }, nodeId);
    const editor = page.locator(`#${editorId}`);
    await page.evaluate(id=>{window.StudioI18n.set(id==='media-a'?'zh':'en');applyTheme(id==='media-a'?'light':'dark');},nodeId);
    await editor.fill(''); await editor.pressSequentially('@');
    await page.waitForFunction(() => document.querySelector('#mentionPicker')?.hasAttribute('open'));
    await editor.press('Enter');
    await editor.locator('.mention-image-token').waitFor();
    await editor.evaluate(el => {
      window.__compositionEvents=[];
      for (const type of ['compositionstart','compositionupdate','compositionend'])
        el.addEventListener(type, event => window.__compositionEvents.push({type,data:event.data}));
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {text:'zhong',selectionStart:5,selectionEnd:5});
    await cdp.send('Input.imeSetComposition', {text:'中文',selectionStart:2,selectionEnd:2});
    const during = await page.evaluate(() => window.__compositionEvents);
    if(during.some(event => event.type === 'compositionend')) failures.push(`${editorId}: composition ended before candidate commit: ${JSON.stringify(during)}`);
    await cdp.send('Input.insertText', {text:'中文'});
    const typed=await editor.evaluate(el=>window.SmartCanvasModules.promptAuthoring.characterText(el));
    if(typed.trim()!=='中文') failures.push(`${editorId}: broken Chinese composition: ${typed}`);
    await cdp.detach();
    const beforePaste=await editor.innerHTML();
    // The browser's actual clipboard default action, not a synthetic paste event.
    await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({
      'text/plain':new Blob(['粘贴文本\n第二行'],{type:'text/plain'}),
      'text/html':new Blob(['<span style="color:rgb(255,0,0);background-color:rgb(0,255,0)">粘贴文本</span><div><b>第二行</b></div>'],{type:'text/html'})
    })]));
    await editor.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await page.waitForFunction(id => document.getElementById(id).textContent.includes('粘贴文本'),editorId);
    if(await editor.locator('[style],b,font').count()) failures.push(`${editorId}: pasted rich formatting: ${await editor.innerHTML()}`);
    assert.equal(await editor.locator('.mention-image-token').count(),1,'Pasting must preserve existing mention tokens');
    assert.equal(await editor.evaluate(el=>window.SmartCanvasModules.promptAuthoring.characterText(el).trim()),'中文粘贴文本\n第二行');
    await editor.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    assert.equal(await editor.innerHTML(),beforePaste,'Plain-text paste remains one native undo step');
    await editor.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
    await page.screenshot({path:`/tmp/laz-51-${nodeId}.png`});
  }
  assert.deepEqual(pageErrors,[]);
  await page.close();
  assert.deepEqual(failures,[]);
}


async function videoScenario(context, baseUrl) {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  const requests=[];
  await page.route('**/api/local-generation-submissions',route=>route.fulfill({contentType:'application/json',body:'{"enabled":false}'}));
  await page.route('**/api/config',async route=>{
    const response=await route.fetch(), config=await response.json();
    config.available_models.video=['mock-video-1','mock-video-2'].map(model=>({id:model,provider_id:'manual-mock',provider_name:'Manual',model,name:model}));
    config.api_providers[0].video_models=['mock-video-1','mock-video-2'];
    await route.fulfill({json:config});
  });
  await page.route('**/api/model-capabilities?**',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('operation')!=='video.generate') return route.continue();
    await route.fulfill({json:{provider_id:'manual-mock',model_id:url.searchParams.get('model'),operation:'video.generate',capability_schema_version:1,catalog_revision:'laz51',support_state:'supported',
      inputs:{text:{minimum:0,maximum:1},image:{minimum:0,maximum:8},video:{minimum:0,maximum:0},audio:{minimum:0,maximum:0}},
      output:{kind:'video',count:{minimum:1,maximum:1}},parameters:{duration_seconds:{type:'integer',minimum:1,maximum:10},aspect_ratio:{type:'enum',values:['16:9']},resolution:{type:'enum',values:['720p']}},
      media_contract:{known:true,commands:{multimodal2video:{image:{minimum:0,maximum:8},duration_seconds:{minimum:1,maximum:10},aspect_ratios:['16:9'],video_resolutions:['720p']}}}}});
  });
  await page.route('**/api/canvas-video-tasks',async route=>{
    requests.push(route.request().postDataJSON());
    await route.fulfill({json:{task_id:`laz51-${requests.length}`,status:'queued',actor_id:'manual-test'}});
  });
  await page.route('**/api/canvas-video-tasks/*',route=>route.fulfill({json:{id:'laz51',status:'running'}}));
  await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`);
  await page.waitForFunction(()=>canvas?.id==='issue-47-text-composer' && window.SmartCanvasModules.canvasPersistence.online());
  await page.evaluate(()=>{
    const source=nodes.find(n=>n.id==='media-a');
    source.x=450;source.y=120;source.referenceGenerationKind='video';
    source.runSettings={...source.runSettings,engine:'api',apiKind:'video',videoProvider:'manual-mock',videoModel:'mock-video-1',videoDuration:5,videoAspect:'16:9',videoResolution:'720p',videoUseFrameRoles:false,count:1};
    nodes.push({id:'connected-ref',type:'smart-image',x:100,y:100,w:180,h:140,images:[{url:'/static/images/test/fixture.svg?v=asset-4b70428f6ea7&ref=1',kind:'image',name:'Reference 1'}]});
    canvas.connections.push({from:'connected-ref',to:source.id,kind:'input'});
    source.manualInputRefs=[2,3].map(n=>({url:'/static/images/test/fixture.svg?v=asset-4b70428f6ea7&manual',name:`Reference ${n}`,kind:'image',inputInstanceId:`ref-${n}`}));
    source.inputRefOrder=['instance|ref-3','instance|ref-2'];
    selectedId=source.id;selectedIds=[];selectedImage={nodeId:'',index:-1};render();updateComposer();
  });
  const editor=page.locator('#promptInput');
  await editor.fill('Video draft');
  await page.locator('#runBtn').click();
  await page.waitForFunction(()=>!runBtn.loading && nodes.some(n=>n.pendingTasks?.length));
  await page.evaluate(()=>{selectedId='media-a';selectedIds=[];updateComposer();});
  await editor.fill('Second video draft');
  const model=page.locator('#dynamicParams ic-select[name="video-model"]');
  await model.evaluate(el=>{void el.show();});
  await model.locator('wa-option').filter({hasText:'mock-video-2'}).click();
  await page.locator('#runBtn').click();
  await page.waitForFunction(()=>!runBtn.loading && nodes.filter(n=>n.pendingTasks?.length).length===2);
  assert.equal(requests.length,2);
  assert.equal(requests[1].model,'mock-video-2');
  assert.equal(requests[1].images.length,3,'Backend submission retains all inputs');
  const targetId=requests[1].node_id;
  await page.evaluate(id=>{selectedId=id;selectedIds=[];updateComposer();},targetId);
  const thumbnails=page.locator('#inputThumbsRow ic-reference-thumbnail');
  assert.equal(await thumbnails.count(),3,'New running video node must display every submitted reference');
  const submittedIds=requests[1].images.map(ref=>ref.instance_id);
  assert.deepEqual(await thumbnails.evaluateAll(items=>items.map(el=>el.dataset.inputInstanceId || el.dataset.outputId || `${el.dataset.nodeId}|${el.dataset.imageIndex}`)),submittedIds,'Keep reference instance identity and order, including identical URLs');
  await page.evaluate(()=>window.StudioI18n.set('en'));
  assert.deepEqual(await thumbnails.evaluateAll(items=>items.map(el=>el.getAttribute('label'))),['Image 1','Image 2','Image 3']);
  await page.evaluate(()=>applyTheme('dark'));
  await page.evaluate(id=>{
    const node=nodes.find(n=>n.id===id);
    viewport.scale=0.75;viewport.x=620-node.x*viewport.scale;viewport.y=130-node.y*viewport.scale;
    window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
    positionComposerForNode(node);
  },targetId);
  await page.waitForTimeout(250); // Settle the theme and viewport transition for visual evidence.
  await page.screenshot({path:'/tmp/laz-51-video-references.png'});
  // Restore the saved document through the real opening and WebSocket paths.
  const snapshot=await page.evaluate(()=>JSON.parse(JSON.stringify(canvas)));
  await page.route('**/api/canvases/issue-47-text-composer',route=>route.fulfill({json:{canvas:snapshot}}));
  await page.route('**/static/smart-canvas.html?**',async route=>{
    const response=await route.fetch();
    const html=await response.text();
    await route.fulfill({response,body:html.replace('  class ManualWebSocket {',`  Object.assign(manualCanvas, ${JSON.stringify(snapshot).replace(/</g,'\\u003c')});\n  class ManualWebSocket {`)});
  });
  await page.reload();
  await page.waitForFunction(()=>window.SmartCanvasModules.canvasPersistence.online());
  await page.evaluate(id=>{selectedId=id;selectedIds=[];updateComposer();},targetId);
  assert.deepEqual(await thumbnails.evaluateAll(items=>items.map(el=>el.dataset.inputInstanceId || el.dataset.outputId || `${el.dataset.nodeId}|${el.dataset.imageIndex}`)),submittedIds,'Reload preserves every reference');
  await thumbnails.first().hover();
  await thumbnails.first().getByRole('button').click();
  assert.equal(await thumbnails.count(),2,'Removing one same-URL instance must leave the other');
  await page.evaluate(()=>{selectedId='media-a';selectedIds=[];updateComposer();});
  assert.equal(await thumbnails.count(),3,'Editing the new node must not change the original run');
  assert.deepEqual(pageErrors,[]);
  await page.close();
}

(async () => {
  const server = await startManualServer();
  let browser;
  try {
    browser = await chromium.launch({headless:true,executablePath:browserExecutable});
    const context = await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
    const failures=[];
    if(process.env.LAZ51_SCENARIO!=='video') await authoringScenario(context,server.url).catch(e=>failures.push(e));
    if(process.env.LAZ51_SCENARIO!=='authoring') await videoScenario(context,server.url).catch(e=>failures.push(e));
    if(failures.length) throw new AggregateError(failures,'LAZ-51 regression failures');
    console.log('PASS: LAZ-51 Composer IME, plain-text paste/undo, parallel video references, identity/order, reload, Light/Dark and language switching');
  } finally { await browser?.close(); await stopManualServer(server.child); }
})().catch(error => { console.error(error); process.exitCode=1; });
