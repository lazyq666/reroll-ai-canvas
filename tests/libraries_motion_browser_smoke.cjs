const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const executablePath = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const report = {};

async function openCanvas(page) {
  await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-148-complex&manual=1&fixture=issue-148-complex`);
  await page.waitForFunction(() => canvas?.id === 'issue-148-complex' && window.SmartCanvasModules?.canvasPersistence?.online?.());
  await page.evaluate(() => {
    const source = nodes.find(n => n.id === 'generator-source');
    source.x=300; source.y=180; source.referenceGenerationKind='image';
    source.runSettings={...source.runSettings,count:1};
    viewport.x=0; viewport.y=0; viewport.scale=1;
    selectedId=source.id; selectedIds=[]; selectedImage={nodeId:'',index:-1};
    nodes.splice(0,nodes.length,source);
    canvas.connections=[];
    render(); updateComposer();
    setPromptText('Motion regression fixture'); savePromptDraftForCurrent();
  });
  await page.waitForFunction(() => !runBtn.disabled);
}
const orbPixels = page => page.evaluate(() => [...document.querySelectorAll('ic-generation-pending')].slice(0,3).map(el => el.shadowRoot.querySelector('.generation-pending-orb').toDataURL()));

(async () => {
  const browser = await chromium.launch({headless:true,executablePath});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await openCanvas(page);
    const button = page.locator('#runBtn');
    await page.waitForFunction(() => {
      const c=runBtn.shadowRoot.querySelector('canvas');
      return runBtn.dataset.metalState === 'running' && c && c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);
    });
    const metalPixels = () => button.evaluate(el=>el.shadowRoot.querySelector('canvas').toDataURL());
    const metalBefore = await metalPixels();
    await page.waitForTimeout(220);
    assert.notEqual(await metalPixels(),metalBefore,'Metal paints changing pixels');
    assert.equal(await button.evaluate(el=>getComputedStyle(el.shadowRoot.querySelector('canvas')).borderRadius),'50%');
    await page.evaluate(()=>document.documentElement.dataset.uiMotion='reduced');
    await page.waitForFunction(()=>runBtn.dataset.metalState==='static');
    const staticMetal = await metalPixels();
    await page.waitForTimeout(200);
    assert.equal(await metalPixels(),staticMetal,'Project reduced motion stops Metal');
    assert.equal(await button.evaluate(el=>el.shadowRoot.querySelector('.ic-metal-effect').hidden),true);
    await page.evaluate(()=>delete document.documentElement.dataset.uiMotion);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>runBtn.dataset.metalState==='static');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(()=>runBtn.dataset.metalState==='running');
    report.metal='animated pixels; circular clipping; project/system reduced motion';

    // Actual Quick Add activation, then edge positioning and interruption.
    const source=page.locator('.image-node[data-id="generator-source"]');
    const box=await source.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    const quick=source.locator('[data-node-quick-add][data-port="out"]');
    await quick.click();
    await page.waitForFunction(()=>referenceGenerateMenu.surface.hasAttribute('data-gooey'));
    const gooey=await page.evaluate(()=>({
      layers:referenceGenerateMenu.shadowRoot.querySelectorAll('.gooey-silhouette').length,
      filter:getComputedStyle(referenceGenerateMenu.querySelector('ic-menu-item')).filter,
      pointer:getComputedStyle(referenceGenerateMenu.shadowRoot.querySelector('.gooey-silhouette')).pointerEvents,
    }));
    assert.deepEqual(gooey,{layers:1,filter:'none',pointer:'none'});
    await page.waitForFunction(()=>!referenceGenerateMenu.surface.hasAttribute('data-gooey'));
    assert.equal(await page.locator('#referenceGenerateMenu ic-menu-item[appearance="icon"]').count(),3);
    const radial=await page.evaluate(()=>{
      const m=referenceGenerateMenu, center=el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}};
      return {direction:m.dataset.fanDirection,origin:center(m.surface.querySelector('[part="close"]')),trigger:center(m._invoker),
        items:Object.fromEntries([...m.querySelectorAll('ic-menu-item')].map(el=>[el.getAttribute('value'),center(el)])),icon:m._invoker.getAttribute('icon')};
    });
    assert.equal(radial.direction,'up');
    assert.equal(radial.icon,'close','opening replaces the source plus with X');
    assert(Math.abs(radial.origin.x-radial.trigger.x)<=1 && Math.abs(radial.origin.y-radial.trigger.y)<=1,'close occupies the original plus center');
    assert.deepEqual(radial.items,{text:{x:radial.origin.x-54,y:radial.origin.y-34},image:{x:radial.origin.x,y:radial.origin.y-64},video:{x:radial.origin.x+54,y:radial.origin.y-34}},'fan matches the reference offsets');
    await page.locator('#referenceGenerateMenu [part="close"]').click();
    await page.waitForFunction(()=>referenceGenerateMenu.dataset.motionState==='closed');
    assert.equal(await quick.getAttribute('icon'),'add','closing restores the original plus');
    assert.equal(await page.evaluate(()=>referenceGenerateMenuState),null,'X clears the pending business choice');
    await quick.click();
    await page.waitForFunction(()=>referenceGenerateMenu.hasAttribute('open')&&!referenceGenerateMenu.surface.hasAttribute('data-gooey'));

    const imageChoice=page.locator('#referenceGenerateMenu ic-menu-item[value="image"] button');
    await imageChoice.hover();
    await page.locator('#referenceGenerateMenu ic-menu-item[value="image"] ic-tooltip[open]').waitFor();
    assert.equal(await page.locator('#referenceGenerateMenu ic-menu-item[value="image"] ic-tooltip').getAttribute('content'),'添加图片节点');
    await page.evaluate(()=>StudioI18n.set('en'));
    assert.equal(await page.locator('#referenceGenerateMenu [part="close"]').getAttribute('aria-label'),'Close quick add');
    await imageChoice.hover();
    assert.equal(await page.locator('#referenceGenerateMenu ic-menu-item[value="image"] ic-tooltip').getAttribute('content'),'Add an image node');
    await page.evaluate(()=>StudioI18n.set('zh'));
    await page.locator('#referenceGenerateMenu ic-menu-item[value="text"] button').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('value')),'image');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('value')),'text');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>referenceGenerateMenu.dataset.motionState==='closed');
    assert.equal(await page.locator('.gooey-silhouette').count(),0);
    for (const scale of [0.5,1,1.75]) {
      await page.evaluate(scale=>{
        viewport.scale=scale; window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        const q=document.querySelector('[data-node-quick-add][data-port="out"]');
        referenceGenerateMenu.showAt(innerWidth-8,innerHeight-8,q);
      },scale);
      await page.waitForFunction(()=>referenceGenerateMenu.dataset.motionState==='open');
      const rect=await page.evaluate(()=>referenceGenerateMenu.surface.getBoundingClientRect().toJSON());
      assert.ok(rect.left>=0 && rect.top>=0 && rect.right<=1280 && rect.bottom<=900,'Menu remains in viewport at all Canvas zooms');
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>referenceGenerateMenu.dataset.motionState==='closed');
    }
    await page.evaluate(()=>{
      const q=document.querySelector('[data-node-quick-add][data-port="out"]');
      referenceGenerateMenu.showAt(500,300,q);
      referenceGenerateMenu.hide();
      referenceGenerateMenu.showAt(500,300,q);
    });
    await page.waitForFunction(()=>referenceGenerateMenu.dataset.motionState==='open');
    assert.equal(await page.evaluate(()=>referenceGenerateMenu.hasAttribute('open')),true);
    assert.equal(await page.locator('.gooey-silhouette').count(),1,'Keep one idle silhouette without a paint handoff');
    await page.mouse.click(1100,100);
    await page.waitForFunction(()=>referenceGenerateMenu.dataset.motionState==='closed');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>referenceGenerateMenu.showAt(500,300,document.querySelector('[data-node-quick-add]')));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.gooey-silhouette').count(),0);
    await page.keyboard.press('Escape');
    await page.emulateMedia({reducedMotion:'no-preference'});
    report.gooey='Quick Add; crisp content; Escape/outside; rapid reopen; 0.5/1/1.75 zoom; viewport edges; reduced motion';

    // Real generation uses a fake provider receipt; no paid request is sent.
    await page.evaluate(()=>{
      viewport.scale=1; window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
      selectedId='generator-source'; updateComposer();
    });
    await page.route('**/api/canvas-image-tasks',route=>route.request().method()==='POST'
      ?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({task_id:'motion-task',status:'queued',actor_id:'manual-test'})})
      :route.continue());
    await page.route('**/api/canvas-image-tasks/motion-task',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'motion-task',status:'running'})}));
    await button.click();
    await page.waitForSelector('ic-generation-pending');
    await page.evaluate(()=>{const rect=document.querySelector('ic-generation-pending').getBoundingClientRect();viewport.x+=180-rect.left;viewport.y+=160-rect.top;window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});});
    await page.waitForFunction(()=>document.querySelector('ic-generation-pending')?.shadowRoot.querySelector('.generation-pending-orb')?.dataset.motionState==='running');
    const orbBefore=await orbPixels(page);
    await page.waitForTimeout(220);
    assert.notDeepEqual(await orbPixels(page),orbBefore,'Orbs animate on an actual pending Node');
    await page.evaluate(()=>{
      const el=document.querySelector('ic-generation-pending');
      window.motionOrb=el.shadowRoot.querySelector('.generation-pending-orb');
      el.setAttribute('elapsed','12s');
    });
    assert.equal(await page.evaluate(()=>window.motionOrb===document.querySelector('ic-generation-pending').shadowRoot.querySelector('.generation-pending-orb')),true);
    await page.evaluate(()=>{StudioI18n.set('en');applyTheme('dark');});
    await page.waitForTimeout(100);
    assert.match(await page.locator('ic-generation-pending').first().getAttribute('label'),/generat|queue|waiting/i);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(100);
    const still=await orbPixels(page);
    await page.waitForTimeout(200);
    assert.deepEqual(await orbPixels(page),still,'Reduced Orbs remain static');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{viewport.x=-10000;window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});});
    await page.waitForFunction(()=>document.querySelector('ic-generation-pending')?.shadowRoot.querySelector('.generation-pending-orb')?.dataset.motionState==='paused');
    const offscreen=await orbPixels(page);
    await page.waitForTimeout(200);
    assert.deepEqual(await orbPixels(page),offscreen,'Offscreen Orbs stop painting');
    report.orbs='actual pending Node; pixel motion; stable identity on elapsed updates; English/Dark; reduced/offscreen freeze';

    // Measure many visible indicators, including the unchanged Halftone work.
    await page.evaluate(()=>{
      const stage=document.createElement('div');stage.id='motion-stress';
      stage.style.cssText='position:fixed;inset:60px 100px;z-index:9999;display:grid;grid-template-columns:repeat(6,1fr);gap:28px 12px;background:var(--ui-color-surface)';
      for(let i=0;i<24;i++){
        const el=document.createElement('ic-generation-pending');
        for(const [key,value] of Object.entries({kind:'image',state:i%2?'generating':'queued',count:'1',label:'Generating'}))el.setAttribute(key,value);
        stage.append(el);
      }
      document.body.append(stage);
    });
    await page.waitForTimeout(300);
    const performanceReport=await page.evaluate(async()=>{
      const pending=[...document.querySelectorAll('#motion-stress ic-generation-pending')];
      let frames=0,totalMs=0,maxMs=0;
      // Time the actual shared scheduler's callbacks; no separate benchmark loop.
      const originals=pending.map(el=>el.drawHalftone);
      pending.forEach((el,index)=>{
        el.drawHalftone=function(time){const start=performance.now();originals[index].call(this,time);const duration=performance.now()-start;totalMs+=duration;maxMs=Math.max(maxMs,duration);frames++;};
      });
      await new Promise(resolve=>setTimeout(resolve,1000));
      pending.forEach((el,index)=>el.drawHalftone=originals[index]);
      return {instances:pending.length,framesPerInstance:frames/pending.length,totalDrawMs:Math.round(totalMs),maxInstanceDrawMs:Math.round(maxMs*100)/100};
    });
    assert.ok(performanceReport.framesPerInstance>0 && performanceReport.framesPerInstance<=26,'Shared pending scheduler remains capped near 24fps');
    report.performance=performanceReport;
    await page.evaluate(()=>{
      document.documentElement.dataset.uiMotion='reduced';
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#motion-stress ic-generation-pending')].every(el=>el.shadowRoot.querySelector('.generation-pending-orb').dataset.motionState==='static')),true);
    await page.evaluate(()=>{
      delete document.documentElement.dataset.uiMotion;
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#motion-stress ic-generation-pending')].every(el=>el.shadowRoot.querySelector('.generation-pending-orb').dataset.motionState==='paused')),true);
    await page.evaluate(()=>{
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      window.detachedMotionNodes=[...document.querySelectorAll('#motion-stress ic-generation-pending')];
      document.querySelector('#motion-stress').remove();
    });
    await page.waitForTimeout(100);
    const detached=await page.evaluate(()=>window.detachedMotionNodes.map(el=>el.shadowRoot.querySelector('.generation-pending-orb').toDataURL()));
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(()=>window.detachedMotionNodes.map(el=>el.shadowRoot.querySelector('.generation-pending-orb').toDataURL())),detached,'Detached nodes stop painting');
    await button.evaluate(el=>{window.detachedMetalButton=el;el.remove();});
    assert.equal(await page.evaluate(()=>!!window.detachedMetalButton.shadowRoot.querySelector('.ic-metal-effect')),false,'Disconnect removes the Metal layer and renderer instance');
    await page.evaluate(()=>document.querySelector('#composer').append(window.detachedMetalButton));
    await page.waitForFunction(()=>!!runBtn.shadowRoot.querySelector('.ic-metal-effect'));
    await button.evaluate(el=>el.remove());
    report.lifecycle='24 indicators: project reduced motion; simulated hidden tab; disconnect stops painting; Metal disconnect cleanup';

    // A denied WebGL2 context leaves a working, keyboard-accessible button.
    const fallback=await browser.newPage();
    await fallback.addInitScript(()=>{
      for (const proto of [HTMLCanvasElement.prototype,typeof OffscreenCanvas==='undefined'?null:OffscreenCanvas.prototype].filter(Boolean)) {
        const original=proto.getContext;
        proto.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};
      }
    });
    await openCanvas(fallback);
    await fallback.waitForFunction(()=>runBtn.dataset.metalState==='fallback');
    assert.equal(await fallback.locator('#runBtn').isEnabled(),true);
    await fallback.locator('#runBtn').focus();
    assert.equal(await fallback.evaluate(()=>document.activeElement===runBtn || runBtn.matches(':focus-within')),true);
    report.fallback='WebGL2 denied: native button remains enabled and focusable';
    await fallback.close();
    await page.evaluate(()=>{viewport.x=0;viewport.scale=1;window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});});
    await page.screenshot({path:'/tmp/reroll-motion-canvas-dark.png'});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
