const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8797';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#699"/></svg>');
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    try{
        const context=await browser.newContext({viewport:{width:1440,height:1000}});
        await context.request.post(base+'/api/auth/login',{data:{username:'layout-review',password:'local-layout-test'}});
        const response=await context.request.post(base+'/api/canvases',{data:{title:'Unified layout acceptance',kind:'smart'}});
        const id=(await response.json()).canvas.id;
        const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/static/smart-canvas.html?id='+id);
        await page.waitForFunction(()=>typeof canvas!=='undefined' && canvas?.id && window.SmartCanvasModules.canvasPersistence.online());
        const reset=async()=>{
            await page.evaluate(async image=>{
                nodes.splice(0,nodes.length,
                    {id:'p',type:'smart-image',x:150,y:200,w:200,h:100,images:[{url:image,name:'Test image',kind:'image',natural_w:200,natural_h:100}]});
                canvas.nodes=nodes;canvas.connections=[];selectedId='p';selectedIds=[];
                viewport.x=0;viewport.y=0;viewport.scale=1;
                window.SmartCanvasModules.viewportSelection.viewport.apply();render();
                await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            },image);
        };

        for(const fromPort of ['out','in']) for(const kind of ['image','video','text']){
            await reset();
            await page.evaluate(kind=>{
                viewport.x=90;viewport.y=40;viewport.scale=kind==='video'?0.75:1.25;
                window.SmartCanvasModules.viewportSelection.viewport.apply();render();
            },kind);
            const port=page.locator(`.image-node[data-id="p"] [data-port="${fromPort}"]`);
            const box=await port.boundingBox();assert.ok(box,'port is rendered');
            await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
            await page.mouse.down();await page.mouse.move(850,550,{steps:12});await page.mouse.up();
            const expected=await page.evaluate(()=>window.SmartCanvasModules.viewportSelection.viewport.screenToWorld({clientX:850,clientY:550}));
            const menu=fromPort==='out'?'referenceGenerateMenu':'upstreamInputMenu';
            await page.locator(`#${menu} ic-menu-item[value="${kind}"]`).click();
            const actual=await page.evaluate(fromPort=>{
                const n=nodes.find(n=>n.id!=='p'),r=nodeRect(n);
                return {x:fromPort==='out'?r.x:r.x+r.width,y:r.y+r.height/2};
            },fromPort);
            assert.ok(Math.abs(actual.x-expected.x)<0.01 && Math.abs(actual.y-expected.y)<0.01,
                JSON.stringify({fromPort,kind,expected,actual}));
            await page.evaluate(async()=>{await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});});
        }
        await reset();
        const port=page.locator('.image-node[data-id="p"] [data-port="out"]');
        await page.locator('.image-node[data-id="p"]').hover();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await port.hover();
        await port.click();
        await page.locator('#referenceGenerateMenu ic-menu-item[value="image"]').click();
        const clicked=await page.evaluate(()=>{
            const n=nodes.find(n=>n.id!=='p');return {x:n.x,mode:canvasMutation.placementIntent({nodeId:n.id}).mode};
        });
        assert.deepEqual(clicked,{x:414,mode:'auto'});
        console.log(JSON.stringify({ok:true,checks:'real drag and menu click, both ports, image/video/text, pan/zoom, persistence, click remains automatic'}));
        assert.deepEqual(errors,[]);
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
