const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {server} = require('./image_repair_browser_fixture.cjs');

(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const browser=await chromium.launch({headless:true,executablePath:process.env.IC_BROWSER_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];
    let holdAssets=false,releaseAssets;
    page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(15000);
    try {
        if(!process.argv.includes('--legacy')){
            await page.route('**/api/workspace-assets?**',async route=>{
                if(holdAssets)await new Promise(resolve=>{releaseAssets=resolve;});
                await route.fulfill({json:{items:[{id:'asset-entry',media_id:'reference-artwork',url:'/assets/reference-alias.png',name:'Reference alias'}],next_cursor:''}});
            });
            await page.route('**/api/config',async route=>{
                const data=await (await route.fetch()).json();
                await route.fulfill({json:JSON.parse(JSON.stringify(data).replaceAll('gpt-image-2.5-suburst','gpt-image-2.5-sunburst'))});
            });
            await page.route('**/api/model-capabilities?**',async route=>{
                const url=new URL(route.request().url());
                const flagship=url.searchParams.get('model')==='gpt-image-2.5-sunburst';
                url.searchParams.set('model',flagship?'gpt-image-2.5-suburst':'gpt-image-2');
                const data=await (await fetch(url)).json();
                if(flagship)data.model_id='gpt-image-2.5-sunburst';
                data.inputs.image.maximum=flagship?4:1;
                await route.fulfill({json:data});
            });
            await page.route('**/api/ai/upload',async route=>{
                if(route.request().postDataBuffer()?.includes(Buffer.from('failed-reference.png'))){
                    return route.fulfill({status:500,json:{detail:'Upload failed'}});
                }
                if(route.request().postDataBuffer()?.includes(Buffer.from('pasted-reference.png'))){
                    return route.fulfill({json:{files:[{url:'/assets/pasted-reference.png',name:'Pasted reference',kind:'image'}],success_count:1}});
                }
                return route.continue();
            });
        }
        await page.goto(`${base}/static/smart-canvas.html?id=image-repair-browser&manual=1`);
        await page.waitForSelector('#fixture-open');
        if(process.argv.includes('--legacy')){
            await page.click('#fixture-tests');
            await page.waitForFunction(()=>/PASS|FAIL/.test(document.getElementById('fixture-result').textContent),null,{timeout:120000});
            assert.match(await page.locator('#fixture-result').textContent(),/^PASS/);
        } else {
            await page.evaluate(()=>{
                window.SmartCanvasModules.canvasMutation.create({kind:'image',data:{x:800,y:120,images:[{url:'/assets/reference.png',media_id:'reference-artwork',name:'Reference artwork',kind:'image'}]},options:{select:false,positionMode:'exact'}});
                promptInput.value='Main composer draft';
            });
            await page.click('#fixture-open');
            await page.waitForFunction(()=>document.getElementById('imageRepairModel').value==='flagship'&&!document.getElementById('imageRepairPrompt').readOnly);
            assert.equal(await page.locator('#imageRepairPrompt').evaluate(el=>el.localName),'ic-prompt-composer');
            assert.ok((await page.locator('.image-repair-panel').boundingBox()).width>400);
            await page.click('#imageRepairRectangle');
            const preview=await page.locator('#imageRepairCanvas').boundingBox();
            await page.mouse.move(preview.x+preview.width*.4,preview.y+preview.height*.4);
            await page.mouse.down();
            await page.mouse.move(preview.x+preview.width*.6,preview.y+preview.height*.6);
            await page.mouse.up();
            await page.locator('#imageRepairPrompt').fill('Match the texture in ');
            await page.locator('#imageRepairPrompt').press('End');
            await page.keyboard.type('@');
            await page.waitForFunction(()=>document.getElementById('mentionPicker').hasAttribute('open'));
            await page.keyboard.type('Reference artwork');
            await page.keyboard.press('Enter');
            await page.waitForFunction(()=>document.querySelectorAll('#imageRepairPrompt .mention-image-token').length===1);
            assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(),2);
            assert.match(await page.locator('#imageRepairPrompt').textContent(),/图2|Image 2/);
            assert.match(await page.locator('#imageRepairReferences [data-repair-reference="0"]').getAttribute('src'),/^data:image\/png/);
            await page.evaluate(()=>{settings.apiKind='video';settings.videoUseFrameRoles=true;});
            await page.keyboard.type(' @');
            await page.locator('#mentionPicker').evaluate(el=>el.dispatchEvent(new CustomEvent('ic-tab-change',{detail:{value:'assets'}})));
            await page.waitForFunction(()=>document.getElementById('mentionPicker').items.some(item=>item.media?.src?.includes('reference-alias')));
            assert.equal(await page.locator('#mentionPicker').evaluate(el=>el.items[0].label),await page.evaluate(()=>trf('canvas.imageNumber',{number:2})));
            await page.keyboard.press('Enter');
            await page.evaluate(()=>{settings.apiKind='image';settings.videoUseFrameRoles=false;});
            assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(),2);
            assert.equal(await page.locator('#imageRepairPrompt .mention-image-token').count(),2);
            await page.locator('#imageRepairPrompt').evaluate(el=>{
                const data=new DataTransfer();
                data.items.add(new File([new Uint8Array([137,80,78,71])],'pasted-reference.png',{type:'image/png'}));
                el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
            });
            await page.waitForFunction(()=>document.querySelectorAll('#imageRepairReferences ic-reference-thumbnail').length===3);
            const sourceBefore=await page.evaluate(()=>JSON.stringify(nodes.find(node=>node.id==='layer-source').images));
            assert.equal(await page.evaluate(()=>promptInput.value),'Main composer draft');
            assert.equal(await page.evaluate(()=>nodes.find(node=>node.id==='layer-source').manualInputRefs),undefined);
            await page.evaluate(()=>window.SmartCanvasModules.imageStudio.close());
            await page.click('#fixture-open');
            await page.waitForFunction(()=>document.querySelectorAll('#imageRepairReferences ic-reference-thumbnail').length===3&&!document.getElementById('imageRepairPrompt').readOnly);
            assert.equal(await page.locator('#imageRepairPrompt .mention-image-token').count(),2);
            await page.evaluate(()=>{
                const model=document.getElementById('imageRepairModel');
                model.value='gpt2';model.dispatchEvent(new Event('change',{bubbles:true}));
            });
            await page.waitForFunction(()=>document.getElementById('imageRepairGenerate').disabled);
            assert.match(await page.locator('#imageRepairStatus').textContent(),/裁剪图|crop/);
            assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(),3);
            await page.evaluate(()=>{
                const model=document.getElementById('imageRepairModel');
                model.value='flagship';model.dispatchEvent(new Event('change',{bubbles:true}));
                window.StudioI18n.set('en');
                applyTheme('light');
            });
            await page.waitForFunction(()=>!document.getElementById('imageRepairGenerate').disabled);
            assert.equal(await page.locator('#imageRepairPrompt').getAttribute('aria-label'),'Repair instructions');
            await page.screenshot({path:'/tmp/laz-134-repair-light-en.png'});
            for(const width of [768,390]){
                await page.setViewportSize({width,height:960});
                await page.locator('#imageRepairPrompt').scrollIntoViewIfNeeded();
                assert.equal(await page.locator('#imageRepairComposer').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
                await page.screenshot({path:`/tmp/laz-134-repair-${width}.png`});
            }
            await page.setViewportSize({width:1440,height:960});
            await page.evaluate(()=>{window.StudioI18n.set('zh');applyTheme('dark');});
            await page.waitForTimeout(200);
            await page.screenshot({path:'/tmp/laz-134-repair-dark-zh.png'});
            await page.click('#imageRepairGenerate');
            await page.waitForFunction(()=>document.getElementById('imageRepairEditor').hidden);
            await page.waitForFunction(()=>nodes.some(node=>node.images?.some(image=>image.local_repair)));
            const state=await (await fetch(`${base}/fixture/state`)).json();
            const request=state.submissions.at(-1);
            assert.equal(request.model,'gpt-image-2.5-sunburst');
            assert.deepEqual(request.reference_images.map(ref=>ref.url),['/assets/upload.png','/assets/reference.png','/assets/pasted-reference.png']);
            assert.match(request.prompt,/图2/);
            assert.match(request.prompt,/图片 1/);
            assert.equal(request.local_repair.preserve_geometry,true);
            assert.equal(await page.evaluate(()=>JSON.stringify(nodes.find(node=>node.id==='layer-source').images)),sourceBefore);
            await page.click('#fixture-open');
            await page.waitForFunction(()=>document.querySelectorAll('#imageRepairReferences ic-reference-thumbnail').length===3&&!document.getElementById('imageRepairPrompt').readOnly);
            await page.evaluate(async()=>{
                const source=nodes.find(node=>node.id==='layer-source');
                const draft=JSON.parse(JSON.stringify(source.localRepairDrafts['layer-source-media']));
                window.StudioI18n.set('en');
                await window.SmartCanvasModules.imageRepair.runDraft({
                    nodeId:source.id,requestId:'language-independent-repair',
                    repair:{image_index:0,source_url:source.images[0].url,draft_key:'layer-source-media',width:1000,height:800,draft}
                });
            });
            assert.equal((await (await fetch(`${base}/fixture/state`)).json()).submissions.length,2);
            await page.locator('#imageRepairReferences [removable]').first().evaluate(el=>el.dispatchEvent(new CustomEvent('ic-remove',{bubbles:true})));
            assert.equal(await page.locator('#imageRepairPrompt .mention-image-token').count(),0);
            assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(),2);
            const paste=async name=>page.locator('#imageRepairPrompt').evaluate((el,name)=>{
                const data=new DataTransfer();
                data.items.add(new File([new Uint8Array([137,80,78,71])],name,{type:'image/png'}));
                el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
            },name);
            await paste('failed-reference.png');
            await page.waitForFunction(()=>document.getElementById('imageRepairStatus').textContent===tr('smart.repair.referenceUploadFailed'));
            assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(),2);
            assert.equal(await page.locator('#imageRepairGenerate').evaluate(el=>el.disabled),false);
            await fetch(`${base}/fixture/hold-upload`,{method:'POST'});
            await paste('delayed-reference.png');
            await page.waitForFunction(async()=>(await (await fetch('/fixture/state')).json()).uploadWaiting);
            assert.equal(await page.locator('#imageRepairGenerate').evaluate(el=>el.disabled),true);
            assert.equal(await page.evaluate(async()=>{
                try {
                    await window.SmartCanvasModules.imageRepair.runDraft({nodeId:'layer-source',requestId:'upload-in-progress',repair:{image_index:0}});
                    return false;
                } catch(error){return error.message===tr('smart.repair.draftChanged');}
            }),true);
            await page.evaluate(()=>window.SmartCanvasModules.imageStudio.close());
            await page.click('#fixture-open');
            await page.waitForFunction(()=>!document.getElementById('imageRepairPrompt').readOnly);
            const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/ai/upload'));
            await fetch(`${base}/fixture/release-upload`,{method:'POST'});
            await uploaded;
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(),2);
            await fetch(`${base}/fixture/hold-upload`,{method:'POST'});
            await paste('model-switch-reference.png');
            await page.waitForFunction(async()=>(await (await fetch('/fixture/state')).json()).uploadWaiting);
            await page.locator('#imageRepairModel').evaluate(el=>{el.value='gpt2';el.dispatchEvent(new Event('change',{bubbles:true}));});
            const switchedUpload=page.waitForResponse(response=>response.url().endsWith('/api/ai/upload'));
            await fetch(`${base}/fixture/release-upload`,{method:'POST'});
            await switchedUpload;
            await page.waitForFunction(()=>document.querySelectorAll('#imageRepairReferences ic-reference-thumbnail').length===3);
            assert.equal(await page.locator('#imageRepairGenerate').evaluate(el=>el.disabled),true);
            assert.equal(await page.locator('#imageRepairStatus').textContent(),await page.evaluate(()=>tr('smart.repair.referenceLimit')));
            holdAssets=true;
            await page.locator('#imageRepairPrompt').click();
            await page.locator('#imageRepairPrompt').press('End');
            await page.keyboard.type(' @');
            const pendingAsset=page.waitForRequest(request=>request.url().includes('/api/workspace-assets?'));
            await page.locator('#mentionPicker').evaluate(el=>el.dispatchEvent(new CustomEvent('ic-tab-change',{detail:{value:'assets'}})));
            await pendingAsset;
            await page.evaluate(()=>window.SmartCanvasModules.imageStudio.close());
            const assetResponse=page.waitForResponse(response=>response.url().includes('/api/workspace-assets?'));
            releaseAssets();
            await assetResponse;
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.equal(await page.locator('#mentionPicker').evaluate(el=>el.hasAttribute('open')),false);
            assert.equal(await page.evaluate(()=>promptInput.value),'Main composer draft');
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS LAZ-134 ${process.argv.includes('--legacy')?'existing local repair':'Composer paste, mentions, draft, limits, submission and responsive UI'}`);
    } catch(error) {
        console.error(await page.evaluate(()=>({
            status:document.getElementById('imageRepairStatus')?.textContent,
            model:document.getElementById('imageRepairModel')?.value,
            editor:document.getElementById('imageRepairPrompt')?.outerHTML
        })),errors);
        await page.screenshot({path:'/tmp/laz-134-repair-failure.png'});
        throw error;
    } finally {
        await browser.close();
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
