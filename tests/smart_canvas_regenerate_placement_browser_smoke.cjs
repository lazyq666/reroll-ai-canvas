const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8797';
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    try{
        const context=await browser.newContext({viewport:{width:2100,height:1400}});
        await context.request.post(base+'/api/auth/login',{data:{username:'layout-review',password:'local-layout-test'}});
        const response=await context.request.post(base+'/api/canvases',{data:{title:'Regenerate placement acceptance',kind:'smart'}});
        const id=(await response.json()).canvas.id;
        const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/static/smart-canvas.html?id='+id);
        await page.waitForFunction(()=>typeof canvas!=='undefined' && canvas?.id && window.SmartCanvasModules.canvasPersistence.online());
        for(const [kind,count] of [['image',1],['image',4],['video',1]]){
            await page.evaluate(async({kind,count})=>{
                const settings={...initialSmartSettings,engine:'api',apiKind:kind,count};
                nodes.splice(0,nodes.length,{id:'p',type:'smart-image',x:0,y:100,w:300,h:300,images:[]},
                    {id:'clicked',type:'smart-image',x:600,y:100,w:400,h:300,images:[],
                     referenceGenerationKind:kind,outputKind:kind,inputNodeIds:['p'],
                     generationInputSnapshot:{settings,prompt:'Layout acceptance',refs:[]}});
                canvas.nodes=nodes;canvas.connections=[{from:'p',to:'clicked',kind:'input'}];
                selectedId='';selectedIds=[];
                viewport.x=0;viewport.y=0;viewport.scale=1;
                window.SmartCanvasModules.viewportSelection.viewport.apply();
                // Replace only provider submission; menu, run orchestration, placement and persistence remain real.
                submitAndSettleGenerationProvider=async()=>({deferred:true});
                submitAndSettleGenerationProviderBatch=async()=>({deferred:true});
                render();await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            },{kind,count});
            await page.locator('.image-node[data-id="clicked"]').click({button:'right',position:{x:200,y:100}});
            await page.locator('#smartNodeContextMenu ic-menu-item[value="regenerate"]').click();
            await page.waitForFunction(count=>nodes.length===2+count,count);
            const results=await page.evaluate(async()=>{
                await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
                return {nodes:nodes.map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h})),connections:canvas.connections};
            });
            assert.deepEqual(results.nodes.slice(0,2).map(n=>[n.x,n.y]),[[0,100],[600,100]]);
            const outputs=results.nodes.slice(2);
            assert.equal(outputs[0].x,1064);
            for(const n of outputs){
                assert.ok(n.x>=1064 && n.x+n.w<=2100 && n.y+n.h<=1400,JSON.stringify(n));
                assert.ok(results.connections.some(c=>c.from==='p' && c.to===n.id));
            }
            const saved=(await (await context.request.get(base+'/api/canvases/'+id)).json()).canvas;
            for(const n of outputs){const stored=saved.nodes.find(item=>item.id===n.id);assert.deepEqual([stored.x,stored.y],[n.x,n.y]);}
        }
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,checks:'real Generate again menu, image/video, 4-image wrapping, clicked source, unchanged inputs, server save; provider stubbed'}));
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
