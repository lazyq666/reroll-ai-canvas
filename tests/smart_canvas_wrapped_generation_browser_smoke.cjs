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

        for(const batchLayout of ['horizontal','vertical']){
            const size=await page.evaluate(()=>{
                nodes.splice(0,nodes.length,{id:'p',type:'smart-image',x:0,y:100,w:300,h:300,images:[]},
                    {id:'seed',type:'smart-image',x:364,y:100,w:400,h:300,images:[],referenceGenerationKind:'image',inputNodeIds:['p']});
                canvas.nodes=nodes;canvas.connections=[{from:'p',to:'seed',kind:'input'}];
                selectedId='seed';selectedIds=[];
                const box=pendingBoxSize(1,{sourceNode:nodes[1]});
                return {width:Math.ceil(364+2*box.w+64+30),height:Math.ceil(100+2*box.h+64+100)};
            });
            await page.setViewportSize(size);
            await page.evaluate(async()=>{
                viewport.x=0;viewport.y=0;viewport.scale=1;
                window.SmartCanvasModules.viewportSelection.viewport.apply();render();
                await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            });
            const batch=await page.evaluate(async batchLayout=>{
                const seed=nodes.find(n=>n.id==='seed');
                canvasMutation.history({action:'capture'});
                const outputs=window.SmartCanvasModules.generationOutput.createPendingBatch({sourceNode:seed,expectedCount:4,reuseSource:true,
                    batchLayout,placementViewport:window.SmartCanvasModules.viewportSelection.viewport.bounds()});
                canvasMutation.history({action:'commit'});render();
                await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
                return {nodes:outputs.map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h})),
                    viewport:window.SmartCanvasModules.viewportSelection.viewport.bounds()};
            },batchLayout);
            assert.deepEqual([batch.nodes[0].x,batch.nodes[0].y],[364,100]);
            for(const n of batch.nodes)assert.ok(n.x>=0 && n.y>=0 && n.x+n.w<=size.width && n.y+n.h<=size.height,JSON.stringify({size,n}));
            assert.equal(new Set(batch.nodes.map(n=>n.x)).size,2);
            assert.equal(new Set(batch.nodes.map(n=>n.y)).size,2);
            const stored=(await (await context.request.get(base+'/api/canvases/'+id)).json()).canvas;
            for(const n of batch.nodes){const saved=stored.nodes.find(item=>item.id===n.id);assert.deepEqual([saved.x,saved.y],[n.x,n.y]);}
            assert.equal(await page.evaluate(()=>canvasMutation.history({action:'undo'})),true);
            await page.waitForFunction(()=>nodes.length===2);
            assert.deepEqual(await page.evaluate(()=>{const n=nodes.find(n=>n.id==='seed');return [n.x,n.y];}),[364,100]);
            assert.equal(await page.evaluate(()=>canvasMutation.history({action:'redo'})),true);
            await page.waitForFunction(()=>nodes.length===5);
            for(const n of batch.nodes){
                assert.deepEqual(await page.evaluate(id=>{const n=nodes.find(n=>n.id===id);return [n.x,n.y];},n.id),[n.x,n.y]);
            }
        }
        await page.screenshot({path:'/tmp/wrapped-generation.png'});
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,checks:'actual generation-output module, 4 results, fixed seed, horizontal/vertical wrapping, viewport visibility, server save, atomic undo/redo'}));
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
