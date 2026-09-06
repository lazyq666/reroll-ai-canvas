const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.woff2':'font/woff2',
};

function json(response, value) {
  response.writeHead(200, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
  });
  response.end(JSON.stringify(value));
}

function apiPayload(pathname) {
  if(pathname === '/api/auth/me') {
    return {user:{id:'issue-45',username:'reviewer',role:'admin'}};
  }
  if(pathname === '/api/config') {
    return {api_providers:[],available_models:{},comfy_instances:[]};
  }
  if(pathname === '/api/projects') return {projects:[]};
  if(pathname === '/api/workflows') return {workflows:[]};
  if(pathname === '/api/prompt-libraries') return {library:{libraries:[]}};
  if(pathname === '/api/smart-canvas/prompt-templates') return {templates:[]};
  if(pathname.endsWith('/view-state')) return {view_state:null};
  if(pathname === '/api/canvases/issue-45-connection-states') {
    return {
      canvas:{
        id:'issue-45-connection-states',
        title:'Connection visual states',
        project:'default',
        revision:1,
        nodes:[],
        connections:[],
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      },
    };
  }
  return {};
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if(url.pathname.startsWith('/api/')) {
        json(response, apiPayload(url.pathname));
        return;
      }
      const filePath = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
      if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(filePath, (error, body) => {
        if(error) {
          response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
          return;
        }
        response.writeHead(200, {
          'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream',
          'Cache-Control':'no-store',
        }).end(body);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function settleFrames(page, count = 2) {
  await page.evaluate(frameCount => new Promise(resolve => {
    let remaining = frameCount;
    const next = () => {
      remaining -= 1;
      if(remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({headless:true,executablePath:CHROME});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=issue-45-connection-states`);
    await page.waitForFunction(() => typeof render === 'function' && canvas?.id === 'issue-45-connection-states');
    await page.evaluate(() => {
      nodes = ['parent','middle','child','other'].map((id,i) => ({id,type:'smart-image',x:850-i*250,y:180,w:200,h:150,images:[],items:[]}));
      canvas.nodes = nodes;
      canvas.connections = [{from:'parent',to:'middle',kind:'flow'},{from:'middle',to:'child',kind:'input'},{from:'child',to:'other',kind:'flow'}];
      selectedId = 'middle'; selectedIds = []; selectedConnectionKey = '';
      render();
    });
    await settleFrames(page);
    const report = await page.evaluate(async () => {
      const check = (ok,message) => { if(!ok) throw new Error(message); };
      const selection = window.SmartCanvasModules.viewportSelection.selection;
      const edge = key => document.querySelector(`[data-connection-key="${key}"]`);
      const incoming = edge('parent|middle|flow');
      const outgoing = edge('middle|child|input');
      const unrelated = edge('child|other|flow');
      const style = group => { const s=getComputedStyle(group.querySelector('.conn-line')); return [s.stroke,s.strokeWidth,s.opacity]; };
      check(incoming.classList.contains('connection-related') && outgoing.classList.contains('connection-related'),'Direct incoming/outgoing highlight');
      check(!unrelated.classList.contains('connection-related'),'No transitive highlight');
      check(!document.querySelector('.conn-cut'),'Related edges must not expose delete');
      for(const theme of ['light','dark']) {
        window.StudioTheme.apply(theme);
        incoming.classList.remove('connection-related');incoming.classList.add('is-pointer-hover');
        const hover = style(incoming);
        incoming.classList.remove('is-pointer-hover');incoming.classList.add('connection-related');
        check(JSON.stringify(style(incoming))===JSON.stringify(hover),`${theme}: related and hover styles match`);
      }
      nodes.find(n=>n.id==='middle').pending = true;
      refreshConnectionLayer();
      const ribbon = incoming.querySelector('.conn-ribbon-core');
      check(ribbon && incoming.querySelectorAll('.conn-ribbon').length===2,'Pending ribbon');
      check(!incoming.classList.contains('connection-related'),'Running edge uses generation state');
      const base = incoming.querySelector('.conn-line');
      check(getComputedStyle(base).strokeDasharray==='none','Continuous base stroke');
      check(ribbon.getAttribute('d')===base.getAttribute('d'),'Ribbon follows directed connection geometry');
      const first = base.getPointAtLength(0), last = base.getPointAtLength(base.getTotalLength());
      check(first.x>last.x,'Fixture verifies parent on right, child on left');
      const animation = ribbon.getAnimations()[0];
      animation.pause();animation.currentTime=0;
      const startOffset=parseFloat(getComputedStyle(ribbon).strokeDashoffset);
      animation.currentTime=1400;
      check(parseFloat(getComputedStyle(ribbon).strokeDashoffset)<startOffset,'Forward dash movement along from-to path');
      const originalD=base.getAttribute('d');
      selectedId='parent';selection.refresh();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      check(base.getAttribute('d')===originalD,'Selection cannot reverse path');
      check(incoming.querySelector('.conn-ribbon-core')===ribbon,'Selection retains animation element');
      nodes[0].x += 40;refreshConnectionLayer({nodeIds:['parent']});
      check(ribbon.getAttribute('d')===base.getAttribute('d') && base.getAttribute('d')!==originalD,'Ribbon follows incremental movement');
      document.documentElement.setAttribute('data-ui-motion','reduced');
      check(getComputedStyle(ribbon).display==='none','Application reduced motion');
      document.documentElement.removeAttribute('data-ui-motion');
      base.classList.add('conn-erasing-mark');check(getComputedStyle(ribbon).display==='none','Erase feedback suppresses ribbon');base.classList.remove('conn-erasing-mark');
      nodes.find(n=>n.id==='middle').pending=false;
      refreshConnectionLayer();
      check(!incoming.querySelector('.conn-ribbon') && incoming.classList.contains('connection-related'),'Completion restores related hover');
      smartCascadeRuns.set('visual-test',{runPath:{states:{'parent->middle':'wait'}}});
      refreshConnectionLayer();
      check(!incoming.querySelector('.conn-ribbon') && !incoming.classList.contains('connection-related'),'Wait is static and retains its own state');
      smartCascadeRuns.get('visual-test').runPath.states['parent->middle']='active';refreshConnectionLayer();
      check(!!incoming.querySelector('.conn-ribbon'),'Cascade active ribbon');
      smartCascadeRuns.get('visual-test').runPath.states['parent->middle']='done';refreshConnectionLayer();
      check(!incoming.querySelector('.conn-ribbon') && incoming.classList.contains('connection-related'),'Cascade done static highlight');
      smartCascadeRuns.clear();
      selection.clear();selection.refresh();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      check(!document.querySelector('.connection-related'),'Clearing selection removes highlight');
      selectedId='';selectedIds=['parent','other'];selection.refresh();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      check(incoming.classList.contains('connection-related') && unrelated.classList.contains('connection-related') && !outgoing.classList.contains('connection-related'),'Multi-selection direct union');
      selectedIds=[];selectedId='';selectedConnectionKey='parent|middle|flow';refreshConnectionLayer();
      check(!!incoming.querySelector('.conn-cut'),'Explicit connection selection retains delete');
      selectedConnectionKey='';nodes[1].pending=true;refreshConnectionLayer();
      return {direction:'parent -> child',hoverParity:true,pending:true,cascade:true,selection:true,incrementalGeometry:true};
    });
    await settleFrames(page);
    await page.evaluate(() => {
      const ribbon = document.querySelector('.conn-ribbon-core');
      const animation = ribbon.getAnimations()[0];
      animation.currentTime = 1200;
      window.connectionAnimationProbe = {ribbon,animation,viewport:{...viewport}};
    });
    await page.mouse.move(1200,600);
    await page.mouse.wheel(0,40);
    await settleFrames(page,4);
    const continuity = await page.evaluate(() => {
      const {ribbon,animation,viewport:before} = window.connectionAnimationProbe;
      const current = document.querySelector('.conn-ribbon-core');
      return {
        viewportChanged:before.x!==viewport.x || before.y!==viewport.y || before.scale!==viewport.scale,
        sameElement:current===ribbon,
        sameAnimation:current?.getAnimations()[0]===animation,
        currentTime:current?.getAnimations()[0]?.currentTime
      };
    });
    assert.equal(continuity.viewportChanged,true,'Wheel must exercise camera movement');
    assert.equal(continuity.sameElement,true,'Wheel preserves visible ribbon');
    assert.equal(continuity.sameAnimation,true,'Wheel preserves animation identity');
    assert.ok(continuity.currentTime>=1200,`Wheel must not reset flow: ${JSON.stringify(continuity)}`);
    for(const zoom of [false,true]){
      if(zoom) await page.keyboard.down('Control');
      try {
        for(let i=0;i<3;i++){
          await page.mouse.wheel(0,i%2 ? -20 : 20);
          await settleFrames(page,3);
          assert.ok(await page.evaluate(() => {
            const {ribbon,animation} = window.connectionAnimationProbe;
            return ribbon.isConnected && ribbon.getAnimations()[0]===animation
              && animation.currentTime>=1200;
          }),`${zoom ? 'Zoom' : 'Pan'} preserves running animation`);
        }
      } finally { if(zoom) await page.keyboard.up('Control'); }
    }
    report.wheelAnimationContinuity = true;
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.conn-ribbon-core').first().evaluate(el=>getComputedStyle(el).display),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    if(process.env.SMART_CONNECTION_SCREENSHOTS){
      await page.evaluate(()=>{
        [[120,170],[490,340],[860,170],[860,520]].forEach(([x,y],i)=>{nodes[i].x=x;nodes[i].y=y;});
        selectedId='middle';selectedIds=[];render();
      });
      await settleFrames(page);
      for(const theme of ['light','dark']){
        await page.evaluate(value=>{window.StudioTheme.apply(value);},theme);
        await page.screenshot({path:`/tmp/smart-connection-states-${theme}.png`});
      }
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,report},null,2));
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
