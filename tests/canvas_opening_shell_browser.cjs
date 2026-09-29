// Real App Shell -> Canvas list -> Smart Canvas regression.
// --serve exposes the same fixture for the Chrome browser plugin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const canvas = { id:'opening-shell-test', title:'Opening shell test', project:'default', revision:1, nodes:[], connections:[], settings:{}, logs:[] };

function recordOpening() {
  const output = document.createElement('output');
  output.id = 'openingShellResult'; output.hidden = true;
  document.body.append(output);
  let samples = [], previousDocument = null, completed = false;
  function tick() {
    const frame = document.querySelector('#frame-canvas');
    const doc = frame?.contentDocument;
    const mark = doc?.querySelector('.canvas-opening-brand');
    if (doc !== previousDocument) {
      samples = []; completed = false; previousDocument = doc;
      output.textContent = ''; delete output.dataset.result;
    }
    if (mark && !completed) {
      const r = mark.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      const label = doc.querySelector('#canvasOpeningStatus');
      const labelStyle = doc.defaultView.getComputedStyle(label);
      const phase = doc.documentElement.dataset.canvasOpeningPhase;
      if (r.width && getComputedStyle(mark).visibility !== 'hidden') {
        samples.push({ phase, x:f.x+r.x, y:f.y+r.y, width:r.width, height:r.height,
          gap:label.getBoundingClientRect().top-r.bottom, fontSize:labelStyle.fontSize,
          lineHeight:labelStyle.lineHeight, frameX:f.x, frameWidth:f.width });
      }
      if (phase === 'ready' || phase === 'error') {
        const keys = ['x','y','width','height','frameX','frameWidth'];
        const ranges = Object.fromEntries(keys.map(key => [key, samples.length ? Math.max(...samples.map(s=>s[key])) - Math.min(...samples.map(s=>s[key])) : Infinity]));
        const boot = samples.find(s=>s.phase==='booting');
        const waiting = samples.find(s=>s.phase==='awaiting-outline');
        const pass = phase === 'ready' && !!boot && !!waiting && Math.abs(boot.frameX) < 1 && Object.values(ranges).every(v=>v<1);
        output.textContent = JSON.stringify({ pass, phase, count:samples.length, boot, waiting, ranges });
        output.dataset.result = pass ? 'pass' : 'fail';
        completed = true;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const json = value => { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
  if (pathname === '/api/auth/me') {
    const fastSession = new URL(req.headers.referer || '/', 'http://localhost').searchParams.has('fast-session');
    return setTimeout(() => json({user:{id:'test',username:'reviewer',role:'admin'}}),fastSession ? 0 : 1200);
  }
  if (pathname === '/api/projects') return json({projects:[{id:'default',name:'Default',order:0,canvas_count:1}]});
  if (pathname === '/api/canvases') return json({canvases:[{...canvas,node_count:0}],total:1,has_more:false});
  if (pathname === `/api/canvases/${canvas.id}/open`) {
    res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
    res.write(JSON.stringify({type:'canvas_outline',canvas_id:canvas.id,revision:1,nodes:[]})+'\n');
    return setTimeout(()=>res.end(JSON.stringify({type:'canvas_document',canvas})+'\n'),800);
  }
  if (pathname === '/api/config') return json({api_providers:[],available_models:{},comfy_instances:[]});
  if (pathname === '/api/prompt-libraries') return json({library:{common:{id:'common',categories:[],items:[]}}});
  if (pathname.endsWith('/view-state')) return json({view_state:null});
  if (pathname.endsWith('/prompt-templates')) return json({templates:[]});
  if (pathname.startsWith('/api/')) return json({});
  const file = path.resolve(root, '.'+(pathname === '/' ? '/static/index.html' : pathname));
  if (!file.startsWith(root+path.sep)) return res.writeHead(403).end();
  const send = () => fs.readFile(file,(err,data)=>{
    if(err) return res.writeHead(404).end();
    if(file.endsWith('/static/index.html')) {
      // Use production markup and script ordering; only add a read-only DOM recorder.
      data=Buffer.from(data.toString().replace('</body>',`<script>(${recordOpening.toString()})();</script></body>`));
    }
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
  // Keep Boot visible long enough to catch the first iframe paint before load.
  if(pathname === '/static/js/infinite-canvas-ui/core.js') setTimeout(send,650);
  else send();
});

(async()=>{
  await new Promise(resolve=>server.listen(process.env.OPENING_SHELL_PORT || 0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  if(process.argv.includes('--serve')) { console.log(`Opening shell fixture: ${base}`); return; }
  let browser;
  try {
    const {chromium}=require('playwright');
    browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const startupWarnings=[];
    page.on('console', message=>{
      if(message.text().includes('[account-session]')) startupWarnings.push(message.text());
    });
    await page.goto(base);
    await page.locator('#account-session-loading').waitFor({state:'visible'});
    const accountLoading=await page.locator('#account-session-loading').evaluate(el=>{
      const r=el.querySelector('.ic-page-loading-brand').getBoundingClientRect();
      const label=el.querySelector('.ic-page-loading-status');
      const style=getComputedStyle(label);
      return {x:r.x,y:r.y,width:r.width,height:r.height,gap:label.getBoundingClientRect().top-r.bottom,
        fontSize:style.fontSize,lineHeight:style.lineHeight};
    });
    const frame=page.frameLocator('#frame-canvas');
    await frame.getByRole('link',{name:canvas.title,exact:true}).waitFor();
    await page.locator('#studioEntryMotion').waitFor({state:'hidden'});
    for(const expanded of [false,true]) {
      const toggle=page.locator('#sidebarLogoToggle');
      if((await toggle.getAttribute('aria-pressed')==='true')!==expanded) await toggle.click();
      await frame.getByRole('link',{name:canvas.title,exact:true}).dblclick();
      await page.waitForFunction(()=>document.querySelector('#openingShellResult')?.dataset.result);
      const result=JSON.parse(await page.locator('#openingShellResult').textContent());
      assert.equal(result.pass,true,JSON.stringify({expanded,...result}));
      for(const key of ['x','y','width','height','gap']) {
        assert.ok(Math.abs(accountLoading[key]-result.waiting[key])<1, `Shared loading ${key}: ${JSON.stringify({accountLoading,canvasLoading:result.waiting})}`);
      }
      for(const key of ['fontSize','lineHeight']) assert.equal(accountLoading[key],result.waiting[key]);
      console.log(JSON.stringify({expanded,...result}));
      await frame.locator('.smart-back').click();
      await frame.getByRole('link',{name:canvas.title,exact:true}).waitFor();
      assert.equal(await toggle.getAttribute('aria-pressed'), String(expanded), 'Returning to the list preserves the sidebar preference');
    }
    // Updating assets can make /auth/me finish before the component module arrives.
    for (const restoreCanvas of [false,true]) {
      await page.evaluate(restore => {
        localStorage.setItem('studio_sidebar_pinned', '1');
        if (restore) sessionStorage.setItem('studio_canvas_route', '/static/smart-canvas.html?id=opening-shell-test');
        else sessionStorage.removeItem('studio_canvas_route');
      }, restoreCanvas);
      await page.goto(`${base}/?fast-session=1`);
      await page.waitForFunction(() => ['ready','error'].includes(document.documentElement.dataset.accountSession));
      assert.equal(await page.locator('html').getAttribute('data-account-session'), 'ready',
        `Fast session with delayed UI components must initialize without manual retry (restoreCanvas=${restoreCanvas}): ${startupWarnings.join('\n')}`);
    }
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
