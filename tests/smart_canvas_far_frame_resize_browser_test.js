/* LAZ-72: real-page regression via smart_canvas_lod_media_server.py?test=far-frame-resize. */
(async () => {
    const report = document.createElement('pre');
    report.id = 'frame-test-results';
    report.style = 'position:fixed;right:12px;top:12px;z-index:99999;background:white;color:black;padding:12px;max-width:560px;max-height:40vh;overflow:auto;font:12px monospace';
    document.body.append(report);
    const state = document.createElement('pre');
    state.id = 'frame-test-state';
    state.style = 'position:fixed;right:12px;bottom:80px;z-index:99999;background:white;color:black;font:12px monospace';
    document.body.append(state);
    const results = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const check = (value, message) => { if(!value) throw new Error(message); };
    const near = (value, expected) => Math.abs(value - expected) < 1;
    const frame = () => nodes.find(node => node.id === 'frame-lod');
    const child = () => nodes.find(node => node.id === 'frame-child');
    const geometry = node => ({x:node.x, y:node.y, w:node.w, h:node.h});
    const showState = () => { state.textContent = JSON.stringify({scale:viewport.scale, frame:geometry(frame()), child:geometry(child())}); };
    const element = () => world.querySelector('[data-id="frame-lod"]');
    const handle = () => element()?.querySelector('.node-resize-handle');
    const zoom = async scale => {
        viewport.x = 160; viewport.y = 100; viewport.scale = scale;
        window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        render(); await sleep(250);
    };
    const reset = async (scale=.2) => {
        nodes.splice(0, nodes.length,
            {id:'frame-lod',type:'smart-frame',title:'Frame',x:200,y:200,w:1400,h:900,items:['frame-child']},
            {id:'frame-child',type:'smart-image',x:350,y:350,w:260,h:180,images:[{url:'/static/images/test/fixture.svg',kind:'image',natural_w:1076,natural_h:1448}]},
            {id:'other-image',type:'smart-image',x:2000,y:350,w:300,h:220,images:[{url:'/static/images/test/fixture.svg',kind:'image'}]});
        selectedId = 'frame-lod'; selectedIds = []; selectedImage = {nodeId:'',index:-1};
        await zoom(scale); showState();
    };
    const drag = (dx,dy,finish=true) => {
        const rect = handle().getBoundingClientRect();
        const x = rect.x + rect.width/2, y = rect.y + rect.height/2;
        handle().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:x,clientY:y}));
        window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:x+dx,clientY:y+dy}));
        if(finish) window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:x+dx,clientY:y+dy}));
    };
    const test = async (name, run) => {
        try { await run(); results.push({name,status:'pass'}); }
        catch(error) { results.push({name,status:'fail',error:String(error.stack || error)}); }
        report.textContent = JSON.stringify(results,null,2);
    };
    try {
        for(let i=0;i<200 && window.SmartCanvasModules?.canvasPersistence?.status().state !== 'ready';i++) await sleep(25);
        check(window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready','Canvas must initialize');
        await test('far Frame retains a 44px hit area and 18px shape at 10% and 20%', async () => {
            for(const scale of [.1,.2]) {
                await reset(scale);
                check(element().classList.contains('canvas-lod-node-far'),'Fixture must enter far mode');
                check(handle(),'Far Frame must expose its resize handle');
                const r = handle().getBoundingClientRect(), f = element().getBoundingClientRect();
                check(near(r.width,44) && near(r.height,44),'Far hit target must remain 44 screen pixels');
                check(near(handle().querySelector('svg').getBoundingClientRect().width,18),'Shape must remain 18 screen pixels');
                check(near(r.x+r.width/2,f.right) && near(r.y+r.height/2,f.bottom),'Handle must anchor to bottom-right');
                check(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.node-resize-handle') === handle(),'Handle must receive pointer input');
                check(!world.querySelector('[data-id="other-image"] .node-resize-handle'),'Other far nodes must keep their existing controls');
            }
        });
        await test('drag distance follows zoom without moving or scaling children', async () => {
            for(const scale of [.1,.2]) {
                await reset(scale); const original = JSON.stringify(geometry(child()));
                drag(40,20); await sleep(100);
                check(frame().w === 1400+40/scale && frame().h === 900+20/scale,'Frame size must use canvas coordinates');
                check(JSON.stringify(geometry(child())) === original,'Child geometry must remain unchanged');
            }
        });
        await test('minimum size and Escape cancellation remain enforced', async () => {
            await reset(); drag(-1000,-1000); await sleep(100);
            check(frame().w === 240 && frame().h === 160,'Minimum Frame size must be 240 by 160');
            await reset(); drag(40,20,false);
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            await sleep(100);
            check(frame().w === 1400 && frame().h === 900,'Escape must restore initial geometry');
            check(!canvasInteraction.active(),'Escape must release resize interaction');
        });
        await test('multiple selection hides individual handles; detail mode keeps existing sizing', async () => {
            await reset(); selectedIds = ['frame-lod','other-image']; render(); await sleep(200);
            check(getComputedStyle(handle()).pointerEvents === 'none' && Number(getComputedStyle(handle()).opacity) === 0,'Multi-selection must suppress individual handles');
            await reset(.4);
            check(!element().classList.contains('canvas-lod-node-far'),'40% must use detail mode');
            check(near(handle().getBoundingClientRect().width,44*.4),'Detail handle sizing must be unchanged');
            drag(40,20); await sleep(100);
            check(frame().w === 1500 && frame().h === 950,'Detail resize must still work');
        });
        await test('themes and languages preserve far Frame controls', async () => {
            const theme = window.StudioTheme.get(), lang = window.StudioI18n.lang();
            try {
                for(const [nextTheme,nextLang] of [['light','en'],['dark','zh']]) {
                    window.StudioTheme.apply(nextTheme); window.StudioI18n.set(nextLang);
                    await reset();
                    check(handle() && near(handle().getBoundingClientRect().width,44),'Far handle must survive theme/language switches');
                    drag(40,20); await sleep(100);
                    check(frame().w === 1600,'Localized/themed Frame must remain resizable');
                }
            } finally { window.StudioTheme.apply(theme); window.StudioI18n.set(lang); }
        });
        await reset();
        window.addEventListener('mouseup', () => setTimeout(showState,100));
    } catch(error) { results.push({name:'setup',status:'fail',error:String(error.stack || error)}); }
    report.textContent = JSON.stringify(results,null,2);
    await fetch('/__lod-test-results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({suite:'far-frame-resize',results})});
})();
