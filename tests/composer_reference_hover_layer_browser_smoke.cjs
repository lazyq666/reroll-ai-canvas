const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8801';
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    page.setDefaultTimeout(10000);
    await page.route('**/api/local-generation-submissions', r=>r.fulfill({json:{enabled:false}}));
    await page.route('**/api/canvases/issue-47-text-composer', r=>r.fulfill({json:{canvas:{id:'issue-47-text-composer',canvas_type:'smart',nodes:[],connections:[],settings:{},revision:0}}}));
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`);
    await page.waitForFunction(()=>canvas?.id==='issue-47-text-composer' && window.SmartCanvasModules.canvasPersistence.online());
    await page.evaluate(()=>{
      nodes.splice(0,nodes.length,{id:'hover-draft',type:'smart-image',referenceGenerationKind:'image',x:400,y:200,w:280,h:180,images:[],manualInputRefs:[{url:'/static/images/test/fixture.svg',kind:'image',inputInstanceId:'ref-image'}],runSettings:{engine:'api',apiKind:'image',count:1}});
      canvas={...canvas,nodes,connections:[]};selectedId='hover-draft';selectedIds=[];
      viewport.x=0;viewport.y=0;viewport.scale=1;
      window.SmartCanvasModules.viewportSelection.viewport.apply();
      configureSmartCanvasVirtualization();canvasLevelOfDetail.update(1);smartCanvasDetailRecoveryReady=null;render();updateComposer();
    });
    async function assertPreviewInFront(label) {
      await page.waitForFunction(()=>{const card=document.querySelector('ic-thumb-hovercard[data-motion-state="open"]');return card && Number(getComputedStyle(card).opacity)===1;});
      const result = await page.evaluate(()=>{
        const card=document.querySelector('ic-thumb-hovercard[data-motion-state="open"]');
        const rect=card.getBoundingClientRect();
        // Hovercards ignore pointer hits; change only hit testing, never paint order.
        card.style.pointerEvents='auto';
        const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        card.style.removeProperty('pointer-events');
        return {front:hit===card,hit:hit?.id || hit?.localName,rect:rect.toJSON(),topLayer:card.matches(':popover-open'),pointer:getComputedStyle(card).pointerEvents};
      });
      assert.equal(result.front,true,`${label}: ${JSON.stringify(result)}`);
      assert.equal(result.pointer,'none');
      assert.ok(result.rect.left>=0 && result.rect.top>=0 && result.rect.right<=1440 && result.rect.bottom<=900,label);
    }
    async function leavePreview() {
      await page.mouse.move(1400,850);
      await page.waitForFunction(()=>!document.querySelector('ic-thumb-hovercard:not([hidden])'));
      assert.equal(await page.locator('ic-thumb-hovercard:popover-open').count(),0);
    }
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>applyTheme(theme),theme);
      for (const expanded of [false,true]) {
        if (expanded) {
          await page.locator('#composerFocusToggle').click();
          await page.waitForFunction(()=>composer.classList.contains('focused') && !composer.classList.contains('focus-transition-active'));
        }
        await page.locator('#inputThumbsRow ic-reference-thumbnail[kind="image"]').hover();
        await assertPreviewInFront(`${theme}, expanded=${expanded}`);
        if (expanded && theme==='light') await page.screenshot({path:'/tmp/composer-hover-layer-fixed.png'});
        await leavePreview();
        if (expanded) {
          // The body-mounted source viewer and inline mention preview are separate paths.
          await page.locator('#inputThumbsRow ic-reference-thumbnail[kind="image"]').click();
          await page.locator('#referenceViewerClose').click();
          assert.equal(await page.locator('#composer').evaluate(el=>el.classList.contains('focused')),true);
          await page.keyboard.press('Escape');
          await page.waitForFunction(()=>!composer.classList.contains('focused') && !composer.classList.contains('focus-transition-active'));
        }
      }
    }
    // Prompt focus uses the same thumbnail component under its own modal surface.
    await page.evaluate(()=>{
      const node={id:'hover-prompt',type:'smart-prompt',text:'Reference prompt',x:700,y:200,w:280,h:180,manualInputRefs:[{url:'/static/images/test/fixture.svg',kind:'image',inputInstanceId:'prompt-ref'}]};
      nodes.push(node);render();setPromptNodeFocused(node.id,true);
    });
    await page.locator('#promptNodeFocusSurface ic-reference-thumbnail').first().hover();
    await assertPreviewInFront('Prompt fullscreen');
    await leavePreview();
    await page.keyboard.press('Escape');
    // Native modal top layer is a separate stacking boundary: raising z-index alone cannot fix it.
    await page.evaluate(()=>{
      const dialog=document.createElement('ic-dialog');dialog.id='hover-test-dialog';dialog.setAttribute('label','Reference preview test');
      const thumb=document.querySelector('#inputThumbsRow ic-reference-thumbnail').cloneNode(true);
      dialog.append(thumb);document.body.append(dialog);dialog.setAttribute('open','');
    });
    const dialogThumb=page.locator('#hover-test-dialog ic-reference-thumbnail');
    for (const kind of ['image','video','audio','text']) {
      await dialogThumb.evaluate((el,kind)=>{
        el.setAttribute('kind',kind);el.setAttribute('preview-text','Text reference preview');
        const src=kind==='video'?'/static/images/test/fixture.mp4':'/static/images/test/fixture.svg';
        el.setAttribute('src',src);el.setAttribute('preview-src',src);el.setAttribute('original-src',src);el.dataset.url=src;
      },kind);
      await dialogThumb.hover();
      await assertPreviewInFront(`Dialog ${kind}`);
      // A fast exit/re-entry must cancel the old hide task.
      await dialogThumb.evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerleave'));el.dispatchEvent(new PointerEvent('pointerenter'));});
      await assertPreviewInFront(`Reopened ${kind}`);
      await page.locator('#hover-test-dialog').evaluate(el=>el.dispatchEvent(new CustomEvent('ic-overlay-scope-activate',{bubbles:true,detail:{scope:document.createElement("section")}})));
      await page.waitForFunction(()=>!document.querySelector('ic-thumb-hovercard:popover-open'));
      await page.mouse.move(1400,850);
    }
    await dialogThumb.hover();
    await assertPreviewInFront('Before disconnect');
    await page.locator('#hover-test-dialog').evaluate(el=>el.remove());
    assert.equal(await page.locator('ic-thumb-hovercard:popover-open').count(),0);
    console.log('PASS: Composer normal/fullscreen light/dark, Prompt fullscreen, native dialog image/video/audio/text, viewer controls, reopen/scope/disconnect cleanup');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
