const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
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



(async()=>{
 const server = process.env.SMART_CANVAS_BASE_URL ? null : await startManualServer();
 const base = process.env.SMART_CANVAS_BASE_URL || server.url;
 const browser = await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.goto(base+'/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer');
  await page.waitForFunction(()=>canvas?.id==='issue-47-text-composer' && window.SmartCanvasModules.canvasPersistence.online());
  const select = id => page.locator(`#world .image-node[data-id="${id}"] .node-body`).click();
  await select('text-a');
  const root = page.locator('#promptGenerationComposer');
  const editor = page.locator('#textPromptInput');
  await root.waitFor({state:'visible'});
  assert.equal(await page.locator('#composer').evaluate(el=>el.classList.contains('open')),false);
  assert.equal(await editor.innerText(),'写一段海报提示词');
  assert.equal(await page.locator('#world .prompt-llm-instruction').count(),0);
  assert.equal(await root.locator('ic-select').count(),1);
  assert.equal(await root.locator('ic-icon-button').count(),2);
  assert.equal(await root.locator('.text-composer-run').getAttribute('data-ic-contract-status'),'ready');
  await editor.fill('第一版指令 👨‍👩‍👧‍👦');
  await select('text-b');await editor.fill('B 的新内容');await select('text-a');
  assert.equal(await editor.innerText(),'第一版指令 👨‍👩‍👧‍👦');
  await editor.fill('');
  await select('text-b');await select('text-a');
  assert.equal(await editor.innerText(),'');
  assert.equal(await root.locator('.text-composer-run').evaluate(el=>el.disabled),true);
  await editor.fill('我的指令');
  await page.evaluate(()=>{const n=nodes.find(n=>n.id==='text-a');n.llmInstruction='Remote instruction';n.llmInstructionHtml='Remote instruction';render();});
  assert.equal(await editor.innerText(),'我的指令');
  assert.equal(await root.locator('.text-composer-run').evaluate(el=>el.disabled),true);
  await root.getByRole('button',{name:'保留我的修改',exact:true}).click();
  assert.equal(await page.evaluate(()=>nodes.find(n=>n.id==='text-a').llmInstruction),'我的指令');
  await editor.fill('新的提示词');
  await editor.press('ArrowLeft');await editor.press('ArrowLeft');
  const caretBefore=await editor.evaluate(()=>window.getSelection().anchorOffset);
  await root.locator('[data-text-expand]').click();
  await page.waitForFunction(()=>document.getElementById('textComposerDialog')?.dataset.motionState==='open');
  assert.equal(await editor.evaluate(()=>window.getSelection().anchorOffset),caretBefore);
  await editor.fill('展开后修改');
  await editor.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('textComposerDialog')?.open);
  assert.equal(await editor.innerText(),'展开后修改');
  await editor.fill('编写时保持光标');
  await page.evaluate(()=>render());
  assert.equal(await editor.evaluate(el=>document.activeElement===el),true);
  assert.equal(await editor.innerText(),'编写时保持光标');
  await page.evaluate(()=>{
   const ref=canvasMutation.create({kind:'prepared',data:{node:{id:'ref-image',type:'smart-image',title:'Reference',x:1600,y:80,w:220,h:160,images:[{url:'/static/images/test/fixture.svg',name:'Reference',kind:'image'}]}},options:{select:false,reveal:false,placement:{anchor:{kind:'point',x:1600,y:80},relation:'free',arrangement:'single'}}});
   promptLibraries=[{id:'issue47-library',name:'Library',categories:[{id:'general',name:'General'}],items:[{id:'issue47-template',name:'Poster template',positive:'Template content',category:'general'}]}];
   activePromptLibraryId='issue47-library';
  });
  await editor.fill('');await editor.pressSequentially('@');
  await page.waitForFunction(()=>document.querySelector('#mentionPicker')?.hasAttribute('open'));
  await editor.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#textPromptInput .mention-image-token'));
  assert.equal(await root.locator('ic-reference-thumbnail').count(),1);
  await page.keyboard.insertText('长指令'.repeat(300));
  const referenceLayout=await root.evaluate(el=>{
   const thumb=el.querySelector('ic-reference-thumbnail').getBoundingClientRect();
   const row=el.querySelector('.prompt-node-input-thumbs').getBoundingClientRect();
   const input=el.querySelector('#textPromptInput');
   return {thumb:thumb.height,row:row.height,scrolls:input.scrollHeight>input.clientHeight};
  });
  assert(referenceLayout.thumb>0 && referenceLayout.row>=referenceLayout.thumb && referenceLayout.scrolls);
  await select('text-b');await select('text-a');
  assert.equal(await editor.locator('.mention-image-token').count(),1);
  assert.equal(await editor.locator('.mention-token-label').innerText(),'图片1');
  await root.locator('ic-reference-thumbnail').hover();
  await root.locator('ic-reference-thumbnail').getByRole('button',{name:'删除参考图'}).click();
  assert.equal(await editor.locator('.mention-image-token').count(),0);
  await editor.fill('');await editor.pressSequentially('/');
  await page.waitForFunction(()=>document.querySelector('#mentionPicker')?.hasAttribute('open'));
  await editor.press('Enter');
  assert.equal((await editor.innerText()).trim(),'Template content');
  await editor.fill('编写时保持光标');
  await page.evaluate(()=>window.StudioI18n.set('en'));
  assert.equal(await root.locator('.text-composer-run').getAttribute('label'),'Generate prompt');
  assert.equal(await editor.innerText(),'编写时保持光标');
  await page.evaluate(()=>applyTheme('dark'));
  await page.screenshot({path:'/tmp/issue-47-text-dark.png'});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>positionCanvasFloatingOverlays());
  const rect=await root.boundingBox();assert(rect.x>=0 && rect.x+rect.width<=391);
  await page.screenshot({path:'/tmp/issue-47-text-narrow.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>positionCanvasFloatingOverlays());
  // Real UI submission + HTTP observation; only the remote task lifetime is controlled.
  const requests=[];let releaseFirst;const accepted=new Promise(r=>releaseFirst=r);
  await page.route('**/api/canvas-llm-tasks',async route=>{
   requests.push(JSON.parse(route.request().postData()));
   if(requests.length===1) await accepted;
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({task_id:'text-task-'+requests.length,actor_id:'manual-test'})});
  });
  await page.evaluate(()=>{
   window.__textSettlers=[];
   window.SmartCanvasModules.generationRecovery={...window.SmartCanvasModules.generationRecovery,
    settle:({node})=>new Promise(resolve=>window.__textSettlers.push({node,resolve}))};
  });
  await editor.fill('Run A');await root.locator('.text-composer-run').click();
  await page.waitForFunction(()=>document.querySelector('.text-composer-run').disabled);
  await editor.press('Control+Enter');
  for(let i=0;i<100 && !requests.length;i++) await page.waitForTimeout(50);
  await page.waitForTimeout(100);assert.equal(requests.length,1);
  await editor.fill('Run B');releaseFirst();
  await page.waitForFunction(()=>window.__textSettlers.length===1 && !document.querySelector('.text-composer-run').disabled);
  assert.equal(requests[0].message,'Run A');
  await root.locator('ic-select').evaluate(el=>{void el.show();});
  await root.locator('wa-option').nth(1).click();
  await root.locator('.text-composer-run').click();
  await page.waitForFunction(()=>window.__textSettlers.length===2);
  assert.equal(requests[1].message,'Run B');
  assert.equal(requests[0].model,'mock-text-1');assert.equal(requests[1].model,'mock-text-2');
  assert.notEqual(requests[0].node_id,requests[1].node_id);
  assert.notEqual(requests[0].generation_operation_id,requests[1].generation_operation_id);
  await editor.fill('下一版未提交');
  await page.evaluate(()=>{let s=window.__textSettlers[1];s.node.text='Output B';delete s.node.textGenerationPending;s.resolve();});
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>nodes.find(n=>n.id==='text-a').running),true);
  assert.equal(await editor.innerText(),'下一版未提交');
  assert.equal(await editor.evaluate(el=>document.activeElement===el),true);
  await page.evaluate(()=>{let s=window.__textSettlers[0];s.node.text='Output A';delete s.node.textGenerationPending;s.resolve();});
  await page.waitForFunction(()=>!nodes.find(n=>n.id==='text-a').running);
  // An accepted empty result keeps its own failed target and original retry snapshot.
  await editor.fill('Retry snapshot');await root.locator('.text-composer-run').click();
  await page.waitForFunction(()=>window.__textSettlers.length===3);
  await page.evaluate(()=>{const s=window.__textSettlers[2];delete s.node.textGenerationPending;s.resolve();});
  await page.waitForFunction(()=>window.__textSettlers[2].node.generationFailed);
  await editor.fill('Do not overwrite this new draft');
  const failedId=await page.evaluate(()=>window.__textSettlers[2].node.id);
  await page.evaluate(id=>{
   const n=nodes.find(n=>n.id===id);selectedId=id;render();
   window.SmartCanvasModules.viewportSelection.viewport.reveal({x:n.x,y:n.y,width:n.w,height:n.h},{smooth:false});
  },failedId);
  await page.locator(`.image-node[data-id="${failedId}"] [data-retry-text-generation]`).click();
  await page.waitForFunction(()=>window.__textSettlers.length===4);
  assert.equal(requests[3].message,'Retry snapshot');
  assert.equal(requests[3].model,'mock-text-2');
  assert.notEqual(requests[2].node_id,requests[3].node_id);
  await page.evaluate(()=>{const s=window.__textSettlers[3];s.node.text='Retried output';delete s.node.textGenerationPending;s.resolve();});
  await page.waitForFunction(()=>!nodes.find(n=>n.id==='text-a').running);
  assert.equal(await page.evaluate(()=>nodes.find(n=>n.id==='text-a').llmInstruction),'Do not overwrite this new draft');
  assert.equal(await page.evaluate(()=>nodes.filter(n=>n.text==='Output A'||n.text==='Output B').length),2);
  await page.evaluate(()=>{viewport.x=0;viewport.y=0;window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});});
  await select('text-b');assert.equal(await editor.innerText(),'B 的新内容');
  await select('media-a');
  assert.equal(await root.isVisible(),false);
  assert.equal(await page.locator('#composer').evaluate(el=>el.classList.contains('open')),true);
  assert.equal(await page.locator('#promptInput').innerText(),'Media draft');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,requests:requests.map(r=>({message:r.message,node:r.node_id})),screenshots:['/tmp/issue-47-text-dark.png','/tmp/issue-47-text-narrow.png']}));
 }finally{await browser.close();await stopManualServer(server?.child);}
})().catch(e=>{console.error(e);process.exitCode=1;});
