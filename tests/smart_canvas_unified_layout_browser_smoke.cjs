const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8796';
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
            const actual=await page.evaluate(async ({fromPort,kind})=>{
                canvasMutation.history({action:'capture'});
                // Exercise the production drop handler and menu commit, with an occupied world point.
                handlePortDrop({fromId:'p',fromPort,moved:true,currentWorld:{x:250,y:250},sourceTrigger:null},
                    {clientX:250,clientY:250,target:document.getElementById('shell')});
                createReferencedNodeFromMenu(kind);
                await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
                const n=nodes.find(n=>n.id!=='p'),r=nodeRect(n);
                return {anchorX:fromPort==='out'?r.x:r.x+r.width,anchorY:r.y+r.height/2,source:[nodes[0].x,nodes[0].y],id:n.id};
            },{fromPort,kind});
            assert.deepEqual([actual.anchorX,actual.anchorY],[250,250],JSON.stringify({fromPort,kind,actual}));
            assert.deepEqual(actual.source,[150,200]);
            const saved=(await (await context.request.get(base+'/api/canvases/'+id)).json()).canvas;
            assert.ok(saved.nodes.some(n=>n.id===actual.id));
        }
        await reset();
        // The keyboard duplicate action shares generation placement and avoids occupied space.
        await page.evaluate(async image=>{
            nodes.push({id:'occupied-copy-slot',type:'smart-image',x:414,y:200,w:200,h:100,
                images:[{url:image,name:'Test image',kind:'image',natural_w:200,natural_h:100}]});
            render();await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
        },image);
        await page.keyboard.press('Meta+d');
        await page.waitForFunction(()=>nodes.length===3);
        const duplicate=await page.evaluate(async()=>{
            await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            const n=nodes.find(n=>!['p','occupied-copy-slot'].includes(n.id));
            return {id:n.id,x:n.x,y:n.y};
        });
        assert.equal(duplicate.x,414);
        assert.ok(Math.abs(duplicate.y-200)>=164);
        const persistedCopy=(await (await context.request.get(base+'/api/canvases/'+id)).json()).canvas.nodes.find(n=>n.id===duplicate.id);
        assert.deepEqual([persistedCopy.x,persistedCopy.y],[duplicate.x,duplicate.y]);
        await reset();
        await page.evaluate(async image=>{
            nodes.push({id:'b',type:'smart-image',x:900,y:500,w:200,h:100,images:[{url:image,name:'Test image',kind:'image',natural_w:200,natural_h:100}]},
                {id:'outside',type:'smart-image',x:414,y:200,w:200,h:100,images:[{url:image,name:'Test image',kind:'image',natural_w:200,natural_h:100}]});
            selectedId='';selectedIds=['p','b'];render();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
        },image);
        // Real toolbar Pointer and Keyboard activation use the same compact arrangement.
        await page.locator('#smartNodeFloatingPortal [data-smart-multi-layout="horizontal"]').click();
        assert.deepEqual(await page.evaluate(()=>nodes.filter(n=>['p','b'].includes(n.id)).map(n=>[n.x,n.y])),[[150,200],[414,200]]);
        const vertical=page.locator('#smartNodeFloatingPortal [data-smart-multi-layout="vertical"]');
        await vertical.focus();await vertical.press('Enter');
        assert.deepEqual(await page.evaluate(()=>nodes.filter(n=>['p','b'].includes(n.id)).map(n=>[n.x,n.y])),[[150,200],[150,364]]);
        await page.evaluate(async()=>{await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});});
        const imported=await page.evaluate(async()=>{
            const result=insertSmartNodePackageIntoCanvas({nodes:[
                {...nodes[0],id:'import-a',x:1000,y:1000},
                {...nodes[0],id:'import-b',x:1020,y:1010}
            ],connections:[{from:'import-a',to:'import-b',kind:'input'}]});
            await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            return {delta:[result.nodes[1].x-result.nodes[0].x,result.nodes[1].y-result.nodes[0].y],
                linked:canvas.connections.some(c=>c.from===result.nodes[0].id && c.to===result.nodes[1].id)};
        });
        assert.deepEqual(imported,{delta:[20,10],linked:true});
        // Frame expansion and source placement are one confirmed transaction.
        await reset();
        const expanded=await page.evaluate(async()=>{
            nodes.push({id:'frame',type:'smart-frame',x:100,y:140,w:300,h:200,items:['p']});
            await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            const n=canvasMutation.create({kind:'prepared',data:{node:{id:'result',type:'smart-image',x:0,y:0,w:200,h:100,images:[{...nodes[0].images[0]}]}},
                options:{placement:{anchor:{kind:'source',sourceNodeId:'p'},relation:'downstream',arrangement:'single'}}});
            await canvasPersistence.save();await canvasPersistence.synced({timeout:5000});
            return {node:[n.x,n.y],frame:nodes.find(n=>n.id==='frame')};
        });
        assert.deepEqual(expanded.node,[414,200]);assert.ok(expanded.frame.w>=538);assert.ok(expanded.frame.items.includes('result'));
        assert.equal(await page.evaluate(()=>canvasMutation.history({action:'undo'})),true);
        await page.waitForFunction(()=>!nodes.some(n=>n.id==='result'));
        assert.equal(await page.evaluate(()=>nodes.find(n=>n.id==='frame').w),300);
        assert.equal(await page.evaluate(()=>canvasMutation.history({action:'redo'})),true);
        await page.waitForFunction(()=>nodes.some(n=>n.id==='result'));
        assert.deepEqual(await page.evaluate(()=>{const n=nodes.find(n=>n.id==='result');return [n.x,n.y];}),expanded.node);
        const second=await context.newPage();await second.goto(base+'/static/smart-canvas.html?id='+id);
        await second.waitForFunction(()=>typeof nodes!=='undefined' && nodes.some(n=>n.id==='result'));
        assert.deepEqual(await second.evaluate(()=>{const n=nodes.find(n=>n.id==='result');return [n.x,n.y];}),expanded.node);
        await page.reload();await page.waitForFunction(()=>typeof nodes!=='undefined' && nodes.some(n=>n.id==='result'));
        assert.deepEqual(await page.evaluate(()=>{const n=nodes.find(n=>n.id==='result');return [n.x,n.y];}),expanded.node);
        for(const lang of ['en','zh']) for(const theme of ['dark','light']){
            await page.evaluate(({lang,theme})=>{window.StudioI18n.set(lang);applyTheme(theme);},{lang,theme});
            const text=await page.evaluate(()=>tr('smart.layoutContractMismatch'));
            assert.ok(text!== 'smart.layoutContractMismatch');
        }
        await page.setViewportSize({width:780,height:850});
        assert.deepEqual(await page.evaluate(()=>{const n=nodes.find(n=>n.id==='result');return [n.x,n.y];}),expanded.node);
        await page.waitForFunction(()=>document.documentElement.dataset.canvasOpeningPhase==='ready');
        await page.waitForSelector('.canvas-opening-layer',{state:'detached'});
        await page.screenshot({path:'/tmp/unified-layout-browser.png',fullPage:false});
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,checks:'6 Quick Add attachments; automatic keyboard duplicate; pointer/keyboard arrangement; Frame transaction; reload; two clients; languages/themes/narrow',canvasId:id}));
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
