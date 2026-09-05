const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const rounds = Number(process.env.PROMPT_DUPLICATE_ROUNDS || 3);
const fs = require('node:fs');
const artifact = process.env.PROMPT_DUPLICATE_REPORT || '/tmp/reroll-prompt-duplicate-report.json';

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

async function installFastRecovery(context) {
  await context.route('**/static/js/smart-canvas/generation-recovery.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace('setTimeout(resolve, 2000)', 'setTimeout(resolve, 0)');
    assert.notEqual(body, source, 'Could not shorten generation recovery polling');
    await route.fulfill({ response, body });
  });
}

// Use the product DOM/editor, persistence queue and generation submission path.
// Only the network fixture, acknowledgement timing and provider outputs are fake.
async function scenario(browser, baseUrl, spec) {
  const context = await browser.newContext({viewport:{width:1800,height:1100}});
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await installFastRecovery(context);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const requests = [];
  const originalText = 'Original vehicle prompt.';
  const replacement = `Blue teapot 新提示词 ${spec.round}: ${spec.name}${spec.multiline ? '\n白色桌面，柔和光照。🫖' : ''}`;
  const events = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('__record42', event => events.push(event));
  await page.route('**/static/smart-canvas.html*', async route => {
    const response = await route.fetch();
    let body = await response.text();
    const marker = '  class ManualWebSocket {';
    assert.ok(body.includes(marker));
    body = body.replace(marker, `
      manualCanvas.nodes = [{id:'original',type:'smart-prompt',text:${JSON.stringify(originalText)},x:100,y:160,w:316,h:180}];
      manualCanvas.connections = [];
      manualCanvas.settings = {};
      window.__ackDelay42 = ${spec.ackDelay};
      ${marker}`);
    body = body.replace('      this.revision += 1;', `
      window.__record42({event:'mutation',changes:operation.changes});
      this.revision += 1;`);
    body = body.replace('      })}), 0);\n    }\n    close', '      })}), window.__ackDelay42);\n    }\n    close');
    await route.fulfill({response,body});
  });
  await page.route('**/api/canvas-image-tasks', async route => {
    if(route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    return route.fulfill({json:{task_id:'issue-42-result',actor_id:'manual-test'}});
  });
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1152"><rect width="2048" height="1152" fill="blue"/></svg>');
  await page.route('**/api/canvas-image-tasks/issue-42-result*', route => route.fulfill({json:{
    task_id:'issue-42-result',status:'succeeded',result:{images:Array.from({length:spec.outputs},(_,i)=>({url:`${image}#${i}`,name:`result-${i}.svg`,kind:'image'}))},
  }}));
  let result;
  try {
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=hit-priority-manual&manual=1`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.SmartCanvasModules?.canvasPersistence?.online?.() && nodes.length===1);
    await page.evaluate(() => {
      viewport.x=0; viewport.y=0; viewport.scale=1;
      window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
    });
    const original = page.locator('.image-node[data-id="original"]');
    await original.click({position:{x:20,y:20}});
    if(spec.duplicate==='menu') {
      await original.click({button:'right',position:{x:20,y:20}});
      await page.locator('#smartNodeContextMenu > ic-menu-item[value="duplicate"]').click();
    } else {
      await page.keyboard.press('Control+d');
    }
    await page.waitForFunction(() => nodes.length===2);
    const duplicateId = await page.evaluate(() => nodes.find(node=>node.id!=='original').id);
    const editor = page.locator(`.image-node[data-id="${duplicateId}"] .prompt-node-text`);
    if(spec.input==='paste') await page.evaluate(text=>navigator.clipboard.writeText(text),replacement);
    await editor.dblclick();
    // Deliberately avoid a persistence/animation wait between editing actions.
    await page.keyboard.press('Meta+a');
    if(spec.waitFrame) await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    if(spec.input==='type') await page.keyboard.type(replacement,{delay:0});
    else if(spec.input==='paste') {
      await page.keyboard.press('Meta+v');
    } else if(spec.input==='composition') {
      await editor.evaluate((element,text)=>{
        element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        document.execCommand('insertText',false,text);
        element.dispatchEvent(new CompositionEvent('compositionend',{data:text,bubbles:true}));
      },replacement);
    } else await page.keyboard.insertText(replacement);
    const during = await editor.innerText();
    if(spec.reenter) {
      const word = await editor.evaluate(element=>{
        const text=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode();
        const range=document.createRange();
        range.setStart(text,0); range.setEnd(text,4);
        const rect=range.getBoundingClientRect();
        return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
      });
      await page.mouse.dblclick(word.x,word.y);
      assert.ok(await page.evaluate(()=>String(window.getSelection()).length>0),'Double-click in active editor must select text');
    }
    if(spec.afterInputFrame) await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    if(spec.exit==='escape') await page.keyboard.press('Escape');
    else if(spec.exit==='commit') await page.keyboard.press('Meta+Enter');
    else if(spec.exit==='click') await page.mouse.click(1700,1000);
    if(['commit','escape'].includes(spec.exit)) {
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      assert.equal(await editor.evaluate(element=>element.isContentEditable),false,'Exited editor reopened on the next frame');
    }
    const after = await page.evaluate(id=>{
      const node=nodes.find(item=>item.id===id);
      return {text:node.text,html:node.textHtml,draft:node.promptDraftText||'',original:nodes.find(item=>item.id==='original').text};
    },duplicateId);
    let generatedId;
    if(spec.connectMenu) {
      await page.locator(`.image-node[data-id="${duplicateId}"] [data-node-quick-add][data-port="out"]`).click();
      await page.locator('#referenceGenerateMenu ic-menu-item[value="image"]').click();
      generatedId=await page.evaluate(()=>selectedId);
    } else {
      // Invoke the output-port action without UI animation waits to stress timing.
      generatedId = await page.evaluate(id=>createReferencedNode({sourceNode:nodes.find(item=>item.id===id),kind:'image',point:{x:900,y:160}}).id,duplicateId);
    }
    await page.waitForFunction(() => !document.querySelector('#runBtn').disabled);
    await page.locator('#runBtn').click();
    await page.waitForFunction(() => nodes.some(node=>(node.images||[]).length));
    await page.waitForFunction(() => !nodes.some(node=>node.pending));
    assert.equal(await page.evaluate(()=>window.SmartCanvasModules.canvasPersistence.synced({timeout:5000})),true,'Final state did not synchronize');
    const state = await page.evaluate(({duplicateId,generatedId})=>({
      duplicate:nodes.find(node=>node.id===duplicateId).text,
      original:nodes.find(node=>node.id==='original').text,
      images:nodes.filter(node=>(node.images||[]).length).map(node=>({id:node.id,scale:node.scale,count:node.images.length,prompt:node.runModelPrompt,draft:node.promptDraftText||''})),
      sync:window.SmartCanvasModules.canvasPersistence.status(),
    }),{duplicateId,generatedId});
    const expected = spec.exit==='escape' ? originalText : replacement;
    result = {...spec,during,after,state,requests,events,errors};
    assert.equal(during,replacement,'Editor lost characters during rapid replacement');
    assert.equal(after.text,expected,'Exit changed the wrong prompt');
    assert.equal(state.duplicate,expected,'Synchronization reverted the prompt');
    assert.equal(state.original,originalText,'Duplicate edit changed original');
    const savedText=events.flatMap(item=>[
      ...(item.changes?.node_creates||[]).map(raw=>raw.node||raw).filter(node=>node.id===duplicateId).map(node=>node.text),
      ...(item.changes?.node_updates||[]).filter(update=>update.id===duplicateId && update.path?.join('.')==='text').map(update=>update.value),
    ]).at(-1);
    assert.equal(savedText,expected,'Acknowledged mutations did not save the edited prompt');
    assert.equal(requests.length,1,'One click must submit one run');
    assert.equal(requests[0].prompt,expected,'Submitted prompt differs from duplicate');
    assert.equal(state.images.length,spec.outputs,'Wrong output node count');
    assert.ok(state.images.every(node=>node.scale===2 && node.count===1),'Split outputs must retain ordinary image scale');
    assert.ok(state.images.every(node=>node.prompt===expected),'Output snapshot differs from submitted prompt');
    assert.deepEqual(errors,[]);
    result.passed=true;
  } catch(error) {
    result = {...spec,...result,passed:false,error:error.stack,requests,events,errors};
    result.page = await page.evaluate(()=>({
      nodes:typeof nodes==='undefined' ? [] : nodes,
      active:document.activeElement?.outerHTML?.slice(0,1000),
    })).catch(()=>null);
    await page.screenshot({path:`/tmp/reroll-42-${spec.name}-${spec.round}.png`}).catch(()=>{});
  } finally { await context.close(); }
  return result;
}

(async()=>{
  const manual=await startManualServer();
  let browser;
  const results=[];
  try {
    browser=await chromium.launch({headless:true,executablePath:browserExecutable});
    const variants=[
      {name:'insert-click',input:'insert',exit:'click'},
      {name:'type-click',input:'type',exit:'click'},
      {name:'paste-click',input:'paste',exit:'click'},
      {name:'insert-commit',input:'insert',exit:'commit'},
      {name:'insert-escape',input:'insert',exit:'escape'},
      {name:'connect-with-focus',input:'insert',exit:'connect'},
      {name:'composition-connect',input:'composition',exit:'connect'},
      {name:'paste-delayed-sync',input:'paste',exit:'click',ackDelay:200},
      {name:'type-delayed-sync',input:'type',exit:'commit',ackDelay:200},
      {name:'surplus-two-images',input:'insert',exit:'click',outputs:2},
      {name:'insert-after-frame',input:'insert',exit:'click',waitFrame:true},
      {name:'paste-after-frame',input:'paste',exit:'click',waitFrame:true},
      {name:'escape-after-input-frame',input:'insert',exit:'escape',afterInputFrame:true},
      {name:'reenter-escape',input:'insert',exit:'escape',reenter:true},
      {name:'multiline-paste-menu',input:'paste',exit:'connect',connectMenu:true,multiline:true},
      {name:'delayed-sync-menu',input:'paste',exit:'connect',connectMenu:true,ackDelay:500},
    ];
    for(let round=1;round<=rounds;round++) for(const variant of variants.filter(item=>!process.env.PROMPT_DUPLICATE_FILTER || item.name.includes(process.env.PROMPT_DUPLICATE_FILTER))){
      const result=await scenario(browser,manual.url,{ackDelay:0,outputs:1,duplicate:round%2 ? 'keyboard':'menu',...variant,round});
      results.push(result);
      fs.writeFileSync(artifact,JSON.stringify({results},null,2));
      console.log(JSON.stringify({round,name:result.name,passed:result.passed,error:result.error?.split('\n')[0]}));
    }
  } finally { await browser?.close(); await stopManualServer(manual.child); }
  const failed=results.filter(result=>!result.passed);
  console.log(JSON.stringify({total:results.length,passed:results.length-failed.length,failed:failed.length,artifact}));
  if(failed.length) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
