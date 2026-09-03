// Real product page, transient review Canvas, actual PNG downloads; no Workspace writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
let failMedia=false,delayMedia=0;
const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    response.setHeader('Cache-Control','no-store');
    if(url.pathname.startsWith('/export-media/')){
        const send=()=>{
            if(failMedia) return response.writeHead(404).end();
            response.setHeader('Content-Type','image/svg+xml');
            response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${url.pathname.includes('green')?'#00cc00':'#ee2200'}"/></svg>`);
        };
        return delayMedia?setTimeout(send,delayMedia):send();
    }
    if(url.pathname.startsWith('/api/')){response.setHeader('Content-Type','application/json');return response.end('{}');}
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(path.join(root,'static')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return response.writeHead(404).end();
    response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    fs.createReadStream(file).pipe(response);
});
async function main(){
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const outputDir=process.env.FRAME_EXPORT_OUTPUT_DIR||'/tmp/reroll-frame-export-qa';
    fs.mkdirSync(outputDir,{recursive:true});
    try {
        const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        page.setDefaultTimeout(15000);
        await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?componentReview=nodes`,{waitUntil:'networkidle'});
        await page.waitForFunction(()=>document.documentElement.dataset.nodesStatus==='ready' && window.SmartCanvasModules.frameImageExport);
        await page.evaluate(()=>{
            applyTheme('light');
            const image=(id,x,y,url='/export-media/red.svg')=>({id,type:'smart-image',x,y,w:200,h:150,images:[{url,kind:'image',natural_w:400,natural_h:300}]});
            nodes.splice(0,nodes.length,
                {id:'export-frame',type:'smart-frame',title:'版式 / Export',x:0,y:60,w:700,h:500,frameColor:'blue',items:['red','text','brush','video','prompt','duplicate','clipped']},
                image('red',50,150),
                {id:'text',type:'smart-text',x:290,y:160,w:240,h:80,text:'Hello 中文\n第二行',textSize:'medium'},
                {id:'brush',type:'smart-brush',x:290,y:300,w:150,h:80,color:'#111111',brushSize:12,points:[[5,10],[70,50],[140,10]]},
                {id:'video',type:'smart-image',x:520,y:150,w:100,h:100,images:[{url:'/video.mp4',kind:'video',natural_w:100,natural_h:100}]},
                {id:'prompt',type:'smart-prompt',x:490,y:340,w:190,h:130,prompt:'MUST NOT EXPORT',text:'MUST NOT EXPORT'},
                image('duplicate',50,390),image('clipped',640,430),image('nonmember',50,150,'/export-media/green.svg')
            );
            canvas.nodes=nodes;canvas.connections=[];
            selectedId='export-frame';selectedIds=[];selectedImage={nodeId:'',index:-1};
            viewport.x=200;viewport.y=50;viewport.scale=1;
            window.SmartCanvasModules.viewportSelection.viewport.apply();
            render();syncSmartNodeFloatingPortal();
        });
        const button='#smartNodeFloatingPortal [data-smart-frame-action="download"]';
        await page.waitForFunction(()=>smartCanvasDetailRecoveryReady===null);
        await page.evaluate(()=>render());
        const open=async()=>{await page.locator(button).click();await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').open);};
        const download=async(name)=>{
            const event=page.waitForEvent('download');
            await page.locator('#smartFrameExportDownload').click();
            const file=await event;await file.saveAs(path.join(outputDir,name));
            await page.waitForFunction(()=>!document.getElementById('smartFrameExportDialog').open);
            await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.motionState==='closed');
            assert.equal(file.suggestedFilename(),'版式 _ Export.png');
            return fs.readFileSync(path.join(outputDir,name));
        };
        const before=await page.evaluate(()=>JSON.stringify({nodes,connections:canvas.connections,selectedId,selectedIds,viewport}));
        await open();
        assert.equal(await page.locator('#smartFrameExportSize').textContent(),'700 × 500 px');
        await page.locator('#smartFrameExportScale [data-value="2"]').click();
        await page.waitForFunction(()=>document.getElementById('smartFrameExportSize').textContent==='1400 × 1000 px');
        await page.locator('#smartFrameExportScale [data-value="1"]').click();
        const png=await download('light.png');
        const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        assert.equal(info.width,700);assert.equal(info.height,500);
        const pixel=(x,y)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
        assert.deepEqual(pixel(120,160),[238,34,0,255],'original image, excluding overlapping non-member');
        assert.deepEqual(pixel(120,400),[238,34,0,255],'repeated source is a second visual instance');
        assert.deepEqual(pixel(690,440),[238,34,0,255],'root clipping keeps the intersecting part');
        assert.deepEqual(pixel(560,150),pixel(400,420),'excluded video has no cover');
        assert.deepEqual(pixel(550,330),pixel(400,420),'excluded prompt has no card');
        const darkPixels=(x,y,w,h)=>{let total=0;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const p=pixel(xx,yy);if(p[0]<100&&p[1]<100&&p[2]<100)total++;}return total;};
        assert.ok(darkPixels(280,85,220,95)>200,'text annotation rendered');
        assert.ok(darkPixels(280,235,170,85)>200,'brush rendered');
        assert.equal(await page.evaluate(()=>JSON.stringify({nodes,connections:canvas.connections,selectedId,selectedIds,viewport})),before,'export is read-only');
        assert.equal(await page.locator('.smart-frame-export-measure').count(),0,'measurement resources released');

        await page.evaluate(()=>{viewport.scale=.2;window.SmartCanvasModules.viewportSelection.viewport.apply();render();syncSmartNodeFloatingPortal();});
        await open();const far=await download('far.png');assert.deepEqual(far,png,'independent of viewport and LOD');
        await open();await page.locator('#smartFrameExportScale [data-value="2"]').click();
        const twice=await download('2x.png');assert.equal((await sharp(twice).metadata()).width,1400);

        await page.evaluate(()=>applyTheme('dark'));await open();
        await page.evaluate(()=>StudioI18n.set('en'));
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').label==='Download frame');
        assert.equal(await page.locator('#smartFrameExportDownload').textContent(),'Download');
        await page.screenshot({path:path.join(outputDir,'dialog-dark.png')});
        const dark=await download('dark.png');assert.notDeepEqual(dark,png);
        await page.evaluate(()=>{StudioI18n.set('zh');applyTheme('light');});

        failMedia=true;await open();await page.locator('#smartFrameExportDownload').click();
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.exportState==='failure');
        assert.match(await page.locator('#smartFrameExportStatus').textContent(),/图片无法加载/);
        await page.evaluate(()=>StudioI18n.set('en'));
        assert.match(await page.locator('#smartFrameExportStatus').textContent(),/Could not load an image/);
        assert.equal(await page.locator('#smartFrameExportDownload').textContent(),'Retry');
        await page.evaluate(()=>StudioI18n.set('zh'));
        failMedia=false;await download('retry.png');

        delayMedia=800;let downloadCount=0;page.on('download',()=>downloadCount++);
        await open();await page.locator('#smartFrameExportDownload').click();
        await page.locator('#smartFrameExportCancel').click();
        await page.waitForTimeout(1000);assert.equal(downloadCount,0,'cancel suppresses late downloads');
        assert.equal(await page.locator('.smart-frame-export-measure').count(),0);
        delayMedia=0;
        await page.setViewportSize({width:800,height:700});
        await page.evaluate(()=>{nodes.find(n=>n.id==='export-frame').w=9000;render();syncSmartNodeFloatingPortal();});
        await open();assert.equal(await page.locator('#smartFrameExportDownload').getAttribute('disabled'),'');
        assert.match(await page.locator('#smartFrameExportStatus').textContent(),/尺寸过大/);
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.motionState==='open');
        const dialogBounds=await page.locator('#smartFrameExportDialog').evaluate(d=>{const r=d.dialog.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
        assert.ok(dialogBounds.left>=0 && dialogBounds.right<=800 && dialogBounds.top>=0 && dialogBounds.bottom<=700,'narrow desktop dialog remains reachable');
        await page.keyboard.press('Escape');
        await page.waitForFunction(()=>!document.getElementById('smartFrameExportDialog').open);
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.motionState==='closed');
        await page.setViewportSize({width:1440,height:1000});
        await page.evaluate(()=>{const frame=nodes.find(n=>n.id==='export-frame');frame.w=700;frame.items=[];render();syncSmartNodeFloatingPortal();});
        await open();assert.match(await page.locator('#smartFrameExportStatus').textContent(),/仅导出背景/);
        const empty=await download('background.png');assert.equal((await sharp(empty).metadata()).width,700);
        // Containers retain original slots and never draw excluded media or descendants twice.
        await page.evaluate(()=>{
            const image={url:'/export-media/red.svg',kind:'image',natural_w:400,natural_h:300};
            nodes.splice(0,nodes.length,
                {id:'export-frame',type:'smart-frame',title:'版式 / Export',x:0,y:60,w:1200,h:800,frameColor:'blue',items:['nested','mixed','group']},
                {id:'nested',type:'smart-frame',x:800,y:200,w:350,h:280,frameColor:'green',items:['child']},
                {id:'child',type:'smart-image',x:850,y:270,w:160,h:120,images:[image]},
                {id:'mixed',type:'smart-image',x:40,y:150,w:460,h:240,images:[image,{url:'/video.mp4',kind:'video',natural_w:400,natural_h:300},image]},
                {id:'group',type:'smart-group',x:40,y:460,w:560,h:300,items:[],images:[image,{...image,url:'/export-media/green.svg'}]}
            );
            canvas.nodes=nodes;selectedId='export-frame';viewport.x=80;viewport.y=50;viewport.scale=.6;
            window.SmartCanvasModules.viewportSelection.viewport.apply();
            render();syncSmartNodeFloatingPortal();
        });
        await page.waitForFunction(()=>smartCanvasDetailRecoveryReady===null);
        await page.evaluate(()=>render());
        const slots=await page.evaluate(()=>{
            const result=[];
            const origin=world.getBoundingClientRect();
            const scale=new DOMMatrix(getComputedStyle(world).transform).a;
            for(const id of ['child','mixed','group']){
                const node=document.querySelector(`.image-node[data-id="${id}"]`);
                node.querySelectorAll('[data-image-index]').forEach(slot=>{
                    const index=Number(slot.dataset.refImageIndex ?? slot.dataset.imageIndex);
                    if(id==='mixed' && index===1) return;
                    const img=slot.querySelector('img');if(!img)return;
                    const r=img.getBoundingClientRect();
                    result.push({id,index,x:Math.round((r.left+r.width/2-origin.left)/scale),y:Math.round((r.top+r.height/2-origin.top)/scale-60)});
                });
            }
            return result;
        });
        await open();const containers=await download('containers.png');
        const containerRaw=await sharp(containers).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        assert.ok(slots.length>=5,'production container fixture has visible image slots');
        for(const slot of slots){
            const offset=(slot.y*containerRaw.info.width+slot.x)*4;
            assert.deepEqual([...containerRaw.data.subarray(offset,offset+4)],slot.id==='group'&&slot.index===1?[0,204,0,255]:[238,34,0,255],`${slot.id}/${slot.index} retains production position`);
        }
        // An original image delayed during export cannot mix later position/theme edits into the snapshot.
        delayMedia=500;await open();
        const snapshotDownload=page.waitForEvent('download');
        await page.locator('#smartFrameExportDownload').click();
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.exportState==='rendering');
        await page.evaluate(()=>{nodes.find(n=>n.id==='child').x+=80;applyTheme('dark');render();});
        const snapshotFile=await snapshotDownload;
        assert.deepEqual(fs.readFileSync(await snapshotFile.path()),containers,'position and theme remain frozen');
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.motionState==='closed');
        delayMedia=0;
        // Deleting the root aborts a pending export; a late response cannot trigger a download.
        delayMedia=700;await open();await page.locator('#smartFrameExportDownload').click();
        const countBeforeDelete=downloadCount;
        await page.evaluate(()=>{nodes.splice(nodes.findIndex(n=>n.id==='export-frame'),1);render();});
        await page.waitForFunction(()=>document.getElementById('smartFrameExportStatus').textContent.includes('分区已被删除'));
        await page.waitForTimeout(900);assert.equal(downloadCount,countBeforeDelete);
        await page.locator('#smartFrameExportCancel').click();delayMedia=0;
        await page.waitForFunction(()=>document.getElementById('smartFrameExportDialog').dataset.motionState==='closed');
        // Capacity boundary is a real PNG allocation/encode, not just a numeric check.
        await page.evaluate(()=>{
            nodes.splice(0,nodes.length,{id:'export-frame',type:'smart-frame',title:'版式 / Export',x:0,y:60,w:8192,h:3906,frameColor:'blue',items:[]});
            canvas.nodes=nodes;selectedId='export-frame';viewport.scale=.08;render();syncSmartNodeFloatingPortal();
        });
        const capacityStart=Date.now();await open();
        assert.equal(await page.locator('#smartFrameExportScale [data-value="2"]').isDisabled(),true);
        const capacity=await download('capacity.png');
        const capacityInfo=await sharp(capacity).metadata();
        assert.equal(capacityInfo.width,8192);assert.equal(capacityInfo.height,3906);
        const capacityMs=Date.now()-capacityStart;
        assert.deepEqual(errors,[],'no page exceptions');
        console.log(JSON.stringify({result:'passed',checks:['PNG content','clipping','text/brush','excluded content','1x/2x','viewport/LOD','read-only','themes/i18n','failure/retry','cancel','limits','empty','nested/group/mixed slots','snapshot consistency','root deletion','capacity PNG'],capacityMs,outputDir}));
    } finally {await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
