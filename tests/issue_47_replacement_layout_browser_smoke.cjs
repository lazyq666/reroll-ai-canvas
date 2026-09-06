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
  const measure = async (surface, input) => page.evaluate(({surface,input})=>{
   const card=document.querySelector(surface+' .composer-card').getBoundingClientRect();
   const field=document.querySelector(input).getBoundingClientRect();
   return {cardHeight:card.height,cardWidth:card.width,height:field.height,top:field.top-card.top,left:field.left-card.left};
  },{surface,input});
  await select('media-a');
  const media=await measure('#composer','#promptInput');
  await select('text-a');
  const text=await measure('#promptGenerationComposer','#textPromptInput');
  if(process.argv.includes('--layout')){
   for(const key of Object.keys(media)) assert(Math.abs(text[key]-media[key])<0.5, `Shared Composer ${key}: text=${text[key]}, media=${media[key]}`);
  }else{
   const original=await page.evaluate(()=>({id:'text-a',count:nodes.length,x:nodes.find(n=>n.id==='text-a').x,y:nodes.find(n=>n.id==='text-a').y}));
   let request;
   await page.route('**/api/canvas-llm-tasks',async route=>{
    request=JSON.parse(route.request().postData());
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({task_id:'replacement-task',actor_id:'manual-test'})});
   });
   await page.evaluate(()=>{window.SmartCanvasModules.generationRecovery={...window.SmartCanvasModules.generationRecovery,settle:async({node})=>{node.text='Generated text';delete node.textGenerationPending;}};});
   await page.locator('#promptGenerationComposer .text-composer-run').click();
   await page.waitForFunction(()=>nodes.some(n=>n.text==='Generated text'));
   const result=await page.evaluate(()=>({id:nodes.find(n=>n.text==='Generated text').id,count:nodes.length,llmEnabled:nodes.find(n=>n.text==='Generated text').llmEnabled}));
   assert.equal(request.node_id,original.id,'First text run must target the generation node itself');
   assert.equal(result.id,original.id);
   assert.equal(result.count,original.count,'No extra source/result pair');
   assert.equal(Boolean(result.llmEnabled),false,'Completed node must be ordinary editable text');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,media,text}));
 }finally{await browser.close();await stopManualServer(server?.child);}
})().catch(e=>{console.error(e);process.exitCode=1;});
