const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8805';

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const failures = [];
  try {
    for (const theme of ['light','dark']) for (const entry of ['click','drop']) {
      const page = await browser.newPage({viewport:{width:1280,height:900}});
      await page.addInitScript(() => {
        const raf = requestAnimationFrame;
        window.requestAnimationFrame = callback => {
          if (callback.name !== 'draw') return raf(callback);
          if (window.liquidFrame?.callback !== callback) window.liquidFrame = {callback,start:performance.now()};
          return 0;
        };
        window.stepLiquid = ms => liquidFrame.callback(liquidFrame.start + ms);
      });
      await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-148-complex&manual=1&fixture=issue-148-complex`);
      await page.waitForFunction(() => canvas?.id === 'issue-148-complex' && window.SmartCanvasModules?.canvasPersistence?.online?.());
      await page.evaluate(theme => {
        document.documentElement.dataset.uiTheme = theme;
        const source = nodes.find(n => n.id === 'generator-source');
        source.x=300; source.y=180;
        nodes.splice(0,nodes.length,source); canvas.connections=[];
        viewport.x=0; viewport.y=0; viewport.scale=1;
        selectedId=source.id; selectedIds=[]; selectedImage={nodeId:'',index:-1}; render();
      }, theme);
      const source = page.locator('.image-node[data-id="generator-source"]');
      const quick = source.locator('[data-node-quick-add][data-port="out"]');
      await source.hover(); await quick.hover();
      if (entry === 'click') await quick.click();
      else {
        await page.mouse.down(); await page.mouse.move(850,450,{steps:8}); await page.mouse.up();
      }
      await page.waitForFunction(() => referenceGenerateMenu.surface.dataset.gooey === 'enter');
      await page.evaluate(() => stepLiquid(800));
      const center = await page.locator('#referenceGenerateMenu [part="close"]').boundingBox();
      await page.locator('#referenceGenerateMenu [part="close"]').click();
      const frames=[];
      for (const ms of [0,100,200,300,400,500,700]) {
        frames.push(await page.evaluate(ms => {
          stepLiquid(ms);
          const menu=referenceGenerateMenu, close=menu.surface.querySelector('[part="close"]');
          const svg=menu.surface.querySelector('.gooey-silhouette');
          const alpha = el => {
            let value=1;
            while(el && el!==menu.surface) {value*=Number(getComputedStyle(el).opacity); el=el.parentElement;}
            return value;
          };
          const trigger=menu._invoker.shadowRoot.querySelector('[part~="base"]');
          return {ms,closeWidth:close.getBoundingClientRect().width,targetWidth:trigger.getBoundingClientRect().width,
            closeOpacity:alpha(close),liquidOpacity:svg?alpha(svg):0,svg:!!svg,sourceOpacity:Number(getComputedStyle(menu._invoker).opacity),
            rotation:new DOMMatrix(getComputedStyle(close.querySelector('ic-icon')).transform).b,
            sourceIcon:menu._invoker.getAttribute('icon'),inert:menu.surface.inert};
        },ms));
        if (process.env.QUICK_ADD_SCREENSHOTS && [0,200,300,400,700].includes(ms)) {
          await page.screenshot({path:`${process.env.QUICK_ADD_SCREENSHOTS}-${theme}-${entry}-${ms}.png`,clip:{x:center.x-88,y:center.y-100,width:220,height:175}});
        }
      }
      console.log(JSON.stringify({theme,entry,frames:frames.map(({ms,closeWidth,closeOpacity,liquidOpacity,sourceOpacity})=>({ms,closeWidth,closeOpacity,liquidOpacity,sourceOpacity}))}));
      const check=(condition,message)=>{if(!condition) failures.push(`${theme}/${entry}: ${message}`);};
      if (entry === 'click') {
        check(frames.some(f=>f.svg && f.closeWidth<40 && f.closeWidth>f.targetWidth+1), 'close must continuously shrink toward the original Quick Add size');
        check(frames.some(f=>f.svg && f.closeOpacity>0 && f.closeOpacity<.95), 'close and source styles must blend before the overlay disappears');
        check(frames.filter(f=>f.svg).every(f=>Math.abs(f.closeOpacity+f.sourceOpacity-1)<.01), 'source and close must share a continuous crossfade');
      } else {
        check(frames.some(f=>f.svg && f.liquidOpacity>0 && f.liquidOpacity<.95 && f.closeOpacity<.95), 'drop circle and X must fade together before cleanup');
        check(frames.filter(f=>f.svg).every(f=>Math.abs(f.rotation)<.001), 'drop close must never turn into a plus');
        check(!frames.find(f=>f.ms===400).svg, 'drop close must leave with the collapsing choices, without a delayed orphan button');
      }
      await page.waitForFunction(() => referenceGenerateMenu.dataset.motionState === 'closed');
      assert.equal(await quick.evaluate(el=>el.style.opacity),'','cleanup restores the original trigger opacity');
      assert.deepEqual(await page.evaluate(()=>({nodes:nodes.length,connections:canvas.connections.length,pending:!!referenceGenerateMenuState,lines:document.querySelectorAll('path.port-drag-temp').length})),{nodes:1,connections:0,pending:false,lines:0});
      if (entry === 'click') {
        await quick.hover(); await quick.click();
        await page.waitForFunction(() => referenceGenerateMenu.surface.dataset.gooey === 'enter');
        await page.evaluate(() => stepLiquid(800));
        await page.locator('#referenceGenerateMenu [part="close"]').click();
        await page.evaluate(() => {stepLiquid(300); window.oldExit=liquidFrame;});
        await quick.click();
        await page.waitForFunction(() => referenceGenerateMenu.surface.dataset.gooey === 'enter');
        await page.evaluate(() => oldExit.callback(oldExit.start+1000));
        assert(await page.evaluate(()=>referenceGenerateMenu.hasAttribute('open') && !!referenceGenerateMenu.surface.querySelector('.gooey-silhouette')),'an interrupted exit cannot remove the reopened menu');
        assert.equal(await quick.evaluate(el=>el.style.opacity),'','reopening restores the trigger opacity');
        await page.evaluate(() => stepLiquid(800));
        await page.keyboard.press('Escape');
        await page.evaluate(() => stepLiquid(300));
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.waitForFunction(() => referenceGenerateMenu.dataset.motionState === 'closed');
        assert.equal(await quick.evaluate(el=>el.style.opacity),'','changing motion preference during handoff restores the trigger');
        await quick.hover(); await quick.click();
        await page.waitForFunction(() => referenceGenerateMenu.dataset.motionState === 'open');
        assert.equal(await page.locator('#referenceGenerateMenu .gooey-silhouette').count(),0);
        await page.locator('#referenceGenerateMenu [part="close"]').click();
        await page.waitForFunction(() => referenceGenerateMenu.dataset.motionState === 'closed');
        await page.emulateMedia({reducedMotion:'no-preference'});
        await quick.hover(); await quick.click();
        await page.waitForFunction(() => referenceGenerateMenu.surface.dataset.gooey === 'enter');
        await page.evaluate(() => stepLiquid(800));
        await page.locator('#referenceGenerateMenu [part="close"]').click();
        await page.evaluate(() => {stepLiquid(300); referenceGenerateMenu.remove();});
        assert.equal(await quick.evaluate(el=>el.style.opacity),'','disconnecting during handoff restores the trigger');
      }
      await page.close();
    }
    assert.deepEqual(failures,[]);
    console.log('Quick Add close: continuous click handoff and fading drop cleanup passed in Light/Dark.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
