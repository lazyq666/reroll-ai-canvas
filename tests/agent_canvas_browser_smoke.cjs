const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium}=require('playwright');
const {apiPayload}=require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const child=spawn(path.join(root,'.venv/bin/python'),['tests/agent_canvas_fixture.py'],{cwd:root,stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',d=>logs+=d);
 const config=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(logs)),15000);child.stdout.on('data',d=>{out+=d;const line=out.split('\n').find(x=>x.startsWith('{"port"'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});child.on('exit',()=>reject(Error(logs)));});
 const base=`http://127.0.0.1:${config.port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const providerRequests=[];
  const context=await browser.newContext();await context.addCookies([{name:'ic_session',value:config.cookie,url:base}]);
  await context.route('**/api/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/api/agent/')||url.pathname.startsWith('/api/account/')||url.pathname==='/api/canvases/canvas-test')return route.continue();
   if(url.pathname==='/api/config'){const config=apiPayload(url.href);config.available_models.video=[{id:'fixture|video',provider_id:'fixture',provider_name:'Fixture',model:'video',name:'Video'}];return route.fulfill({json:config});}
   if(url.pathname==='/api/model-capabilities')return route.fulfill({json:{provider_id:'fixture',model_id:'video',operation:'video.generate',catalog_revision:'fixture-v1',capability_schema_version:1,support_state:'supported',inputs:{text:{minimum:1,maximum:1},image:{maximum:3}},parameters:{duration_seconds:{type:'integer',minimum:1,maximum:10},aspect_ratio:{type:'enum',values:['16:9']}},media_contract:{known:true,commands:{multimodal2video:{duration_seconds:{minimum:1,maximum:10},aspect_ratios:['16:9'],inputs:{image_count:{maximum:3},total_count:{minimum:1,maximum:3}}}}}}});
   if(url.pathname==='/api/canvas-video-tasks' && route.request().method()==='POST'){providerRequests.push(route.request().postDataJSON());return route.fulfill({json:{task_id:'fake-video-'+providerRequests.length,status:'queued',actor_id:config.user.id}});}
   if(url.pathname.startsWith('/api/canvas-video-tasks/'))return route.fulfill({json:{status:'succeeded',result:{images:[{url:'/assets/input/fake-output.png',kind:'image',name:'Fake output'}]}}});
   if(url.pathname==='/api/local-generation-submissions')return route.fulfill({json:{enabled:false}});
   if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:config.user}});
   return route.fulfill({json:apiPayload(url.href)});
  });
  const page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/static/smart-canvas.html?id=canvas-test');
  await page.waitForFunction(()=>window.SmartCanvasModules?.canvasPersistence?.online(),{timeout:15000});
  const request=async(method,pathname,body,key='browser-key')=>{const response=await fetch(base+'/api/agent/v1/'+pathname,{method,headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const sample=require('./fixtures/agent-authoring.json');
  const recipe=sample.recipe;
  const rectangles=sample.visual_order.rectangles.map(n=>({...n,type:'smart-image',images:[{url:'fixture'}]}));
  assert.deepEqual(require('../static/js/smart-canvas/multi-input.js').capture({nodes:rectangles,ids:rectangles.map(n=>n.id),measure:n=>n,mediaFor:n=>n.images,textFor:()=>'',running:()=>false}).ids,sample.visual_order.ids);
  const result=await request('POST','canvases/canvas-test/submissions',{tasks:[recipe,recipe,recipe],title:'Browser'});
  const id=result.task_ids[0];
  await page.waitForFunction(id=>nodes.some(n=>n.id===id),id);
  await page.evaluate(id=>{selectedId=id;selectedIds=[];updateComposer();},id);
  await page.waitForFunction(()=>document.querySelectorAll('#promptInput .mention-image-token').length===2);
  assert.deepEqual(await page.evaluate(({id,keys})=>{const n=nodes.find(n=>n.id===id);return Object.fromEntries(keys.map(k=>[k,n[k]]));},{id,keys:Object.keys(sample.node)}),sample.node);
  const resolved=await page.evaluate(id=>{const node=nodes.find(n=>n.id===id);return window.SmartCanvasModules.promptAuthoring.resolveFromNodeDraft({node,settings:node.runSettings});},id);
  assert.equal(resolved.refs.length,2);assert.equal(resolved.refs[0].nodeId,'source-0');assert.match(resolved.prompt,/1/);assert.match(resolved.prompt,/2/);
  await page.evaluate(async()=>{canvasMutation.history({action:'capture'});nodes.find(n=>n.id==='source-0').images=[{url:'/assets/input/replaced.png',name:'Replacement',kind:'image'}];canvasMutation.history({action:'commit'});render();canvasPersistence.schedule();await canvasPersistence.synced();});
  const replacement=await page.evaluate(id=>{const n=nodes.find(n=>n.id===id);return window.SmartCanvasModules.promptAuthoring.resolveFromNodeDraft({node:n,settings:n.runSettings});},id);
  assert.equal(replacement.refs.length,2);assert.equal(replacement.refs[0].url,'/assets/input/replaced.png');
  await page.reload();await page.waitForFunction(()=>window.SmartCanvasModules?.canvasPersistence?.online());
  const persisted=await page.evaluate(id=>nodes.find(n=>n.id===id).promptDraftHtml,id);assert.match(persisted,/mention-image-token/);
  await page.evaluate(()=>window.StudioI18n.set('en'));
  await page.screenshot({path:'/tmp/agent-canvas-en.png'});
  // Real generation preflight and HTTP payload, with a fake cost-free Provider.
  const comparison=await request('POST','canvases/canvas-test/submissions',{tasks:[recipe,recipe],title:'Pipeline'},'pipeline-author');
  await page.waitForFunction(id=>nodes.some(n=>n.id===id),comparison.task_ids[1]);
  await page.evaluate(async id=>{selectedId=id;selectedIds=[];updateComposer();await window.SmartCanvasModules.generationRun.run({nodeId:id});},comparison.task_ids[0]);
  assert.equal(providerRequests.length,1,'manual run must reach the Provider task API');
  await page.evaluate(id=>{selectedId=id;selectedIds=[];updateComposer();promptInput.textContent='Unrelated live draft';promptInput.dispatchEvent(new Event('input',{bubbles:true}));},result.task_ids[0]);
  await request('POST','canvases/canvas-test/run-requests',{node_ids:[comparison.task_ids[1]]},'pipeline-run');
  await page.waitForFunction(id=>nodes.find(n=>n.id===id)?.generationInputSnapshot,comparison.task_ids[1]);
  for(let i=0;i<50 && providerRequests.length<2;i++)await page.waitForTimeout(100);
  assert.equal(providerRequests.length,2,'Agent must use the real generation entry');
  for(const key of ['prompt','images','videos','audios','provider_id','model','duration','aspect_ratio','resolution','multimodal','enhance_prompt','generate_audio','catalog_revision'])assert.deepEqual(providerRequests[0][key],providerRequests[1][key],key);
  assert.ok(JSON.stringify(providerRequests[1]).includes('/assets/input/replaced.png'));
  await page.waitForFunction(id=>nodes.find(n=>n.id===id)?.images?.length,comparison.task_ids[1]);
  assert.equal(await page.evaluate(id=>nodes.find(n=>n.id===id).promptDraftText,comparison.task_ids[1]),recipe.prompt);
  assert.equal(await page.evaluate(()=>promptInput.textContent),'Unrelated live draft');
  // Actual editor claim path, with only the cost-bearing run entry replaced.
  const page2=await context.newPage();await page2.goto(base+'/static/smart-canvas.html?id=canvas-test');await page2.waitForFunction(()=>window.SmartCanvasModules?.canvasPersistence?.online());
  for(const p of [page,page2])await p.evaluate(()=>{
    window.agentExecuted=[];
    window.SmartCanvasModules.generationRun={run:async options=>{window.agentExecuted.push(options.nodeId);await options.onAccepted();await new Promise(r=>setTimeout(r,100));return true;}};
    window.SmartCanvasModules.agentEditor.reportContext();
  });
  await request('POST','canvases/canvas-test/run-requests',{node_ids:result.task_ids},'browser-run');
  await page.waitForTimeout(17000);
  const executed=[...await page.evaluate(()=>window.agentExecuted),...await page2.evaluate(()=>window.agentExecuted)];
  assert.equal(executed.length,3);assert.equal(new Set(executed).size,3);
  // Current connection UI: installer download, autosaved preferences and browser approval.
  await page2.close();
  await page.goto(base+'/static/index.html');await page.waitForFunction(()=>typeof window.openAgentAccess==='function');await page.evaluate(()=>openAgentAccess());
  await page.locator('#agent-concurrency').waitFor();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('[data-action="download-installer"]').click();
  const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/^Reroll-MCP-codex-macos\.zip$/);
  assert.equal(await download.failure(),null);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/account/agent-access') && r.request().method()==='PATCH');
  await page.locator('#agent-concurrency').evaluate(e=>{e.value='3';e.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal((await saved).status(),200);
  for(const lang of ['en','zh'])for(const theme of ['light','dark']){
   await page.evaluate(({lang,theme})=>{window.StudioI18n.set(lang);window.StudioTheme.set(theme);},{lang,theme});
   assert.equal(await page.locator('#agent-concurrency').evaluate(e=>e.value),'3');
   const concurrencyLabel=lang==='zh'?'画布并发':'Canvas tasks at once';
   assert.equal(await page.locator('#agent-concurrency-label').innerText(),concurrencyLabel);
   assert.equal(await page.locator('#agent-concurrency').getAttribute('label'),concurrencyLabel);
   assert.equal(await page.locator('#agent-install-client').getAttribute('label'),await page.evaluate(()=>StudioI18n.t('agent.install.client')));
   await page.screenshot({path:`/tmp/agent-access-${lang}-${theme}.png`});
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#agent-access-dialog').open);
  await page.evaluate(()=>openAgentAccess());
  assert.equal(await page.locator('#agent-concurrency').evaluate(e=>e.value),'3');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#agent-access-dialog').open);
  const crypto=require('node:crypto');
  const pairingToken='reroll_agent_'+crypto.randomBytes(32).toString('hex');
  const pairingResponse=await fetch(base+'/api/agent/pairing/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Browser pairing',token_hash:crypto.createHash('sha256').update(pairingToken).digest('hex')})});
  assert.equal(pairingResponse.status,200);
  const pairing=await pairingResponse.json();
  await page.locator('#agent-pairing-dialog [data-decision="yes"]').waitFor();
  assert.ok((await page.locator('#agent-pairing-dialog').innerText()).includes(pairing.code));
  await page.locator('#agent-pairing-dialog [data-decision="yes"]').click();
  await page.locator('#agent-pairing-dialog').waitFor({state:'detached'});
  const paired=await fetch(base+'/api/agent/pairing/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:pairingToken})});
  assert.equal((await paired.json()).state,'approved');
  assert.deepEqual(errors,[]);
  console.log('Agent browser: PASS (live mentions, replacement, refresh, real Provider payload parity, isolated drafts, dual-editor claims, installer download, autosaved preferences, bilingual UI, browser pairing)');
 } finally {await browser.close();child.kill('SIGINT');if(logs.includes('ERROR'))console.error(logs);}
})().catch(e=>{console.error(e);process.exitCode=1;});
