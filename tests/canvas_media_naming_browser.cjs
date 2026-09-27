// Production page with isolated APIs: no user canvas or paid Provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
    const url = new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(apiPayload(url.href)));return;
    }
    const file = path.resolve(root,`.${url.pathname}`);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,body)=>{
        if(error){res.writeHead(404).end();return;}
        res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream'});
        res.end(body);
    });
});
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    try {
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?componentReview=nodes`);
        await page.waitForFunction(()=>document.documentElement.dataset.nodesStatus==='ready');
        let uploadIndex=0;
        await page.route('**/api/ai/upload',async route=>{
            const filenames=[...route.request().postDataBuffer().toString().matchAll(/filename="([^"]+)"/g)].map(match=>match[1]);
            const files=filenames.map(name=>({url:`/fixture/upload-${++uploadIndex}.png`,name,kind:'image'}));
            await route.fulfill({json:{files}});
        });
        await page.route('**/fixture/*.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+byzvAAAAAElFTkSuQmCC','base64')}));
        const names=await page.evaluate(()=>{
            nodes.splice(0);canvas.connections=[];
            const output=window.SmartCanvasModules.generationOutput;
            function generate(id,properties={}){
                const node={id,type:'smart-image',x:nodes.length*400,y:100,images:[],generationOperationId:`op-${id}`,generationInputSnapshot:{settings:{engine:'api'},refs:[]},...properties};
                nodes.push(node);
                output.apply({node,outputs:[{url:`/fixture/${id}.png`,kind:'image'}],strategy:'replace'});
                return node;
            }
            generate('one');generate('two');
            generate('repair',{localRepairRequest:{version:2}});
            generate('angle',{aiProcessorKind:'angle-control'});
            generate('depth',{outputKind:'depth-map'});
            generate('matting',{mattingSourceNodeId:'one'});
            generate('edit',{generationInputSnapshot:{settings:{engine:'api'},refs:[{url:'/fixture/one.png',kind:'image'}]}});
            const first=nodes[0];first.images[0].name='角色正面.png';
            output.apply({node:first,outputs:[{url:'/fixture/one.png'}],strategy:'append'});
            selectedId=first.id;selectedIds=[];selectedImage={nodeId:first.id,index:0};
            canvasVirtualization.reset();configureSmartCanvasVirtualization();render();
            return nodes.map(node=>node.images[0].name);
        });
        assert.deepEqual(names,['角色正面.png','t2i-02.png','repair-01.png','angle-01.png','depth-01.png','cutout-01.png','i2i-01.png']);
        assert.equal(await page.evaluate(()=>downloadNameForMediaItem(nodes[1].images[0])),'t2i-02.png');
        await page.evaluate(()=>{window.StudioI18n.set('en');render();});
        assert.deepEqual(await page.evaluate(()=>nodes.map(node=>node.images[0].name)),names);
        const badge=page.locator('[data-id="one"] .image-name-badge-name').first();
        await badge.waitFor();assert.equal(await badge.textContent(),'角色正面.png');
        // Actual crop commits a new derived medium and preserves a manual source name.
        await page.evaluate(()=>window.SmartCanvasModules.imageStudio.open({nodeId:'one',imageIndex:0,mode:'crop',groupAware:false}));
        await page.waitForFunction(()=>window.SmartCanvasModules.imageStudio.current()?.sourceReady);
        await page.evaluate(()=>applyImageCrop());
        assert.equal(await page.evaluate(()=>nodes.find(node=>node.id==='one').images[0].name),'角色正面-crop-01.png');
        assert.equal(await page.evaluate(()=>downloadNameForMediaItem(nodes.find(node=>node.id==='one').images[0])),'角色正面-crop-01.png');
        await page.evaluate(()=>{window.StudioI18n.set('zh');render();});
        assert.equal(await page.evaluate(()=>nodes.find(node=>node.id==='one').images[0].name),'角色正面-crop-01.png');
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,names,crop:'角色正面-crop-01.png',languageSwitch:true,downloads:true}));
    } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
