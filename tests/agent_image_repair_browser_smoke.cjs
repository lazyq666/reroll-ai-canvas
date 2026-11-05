const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {chromium} = require('playwright');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');

(async()=>{
    const child=spawn(path.join(root,'.venv/bin/python'),['tests/agent_image_repair_browser_fixture.py'],{cwd:root,stdio:['ignore','pipe','pipe']});
    let logs='',browser;
    child.stderr.on('data',data=>logs+=data);
    try {
        const auth=await new Promise((resolve,reject)=>{
            let output='';
            const timer=setTimeout(()=>reject(new Error(logs)),15000);
            child.stdout.on('data',data=>{output+=data;const line=output.split('\n').find(line=>line.startsWith('{"port"'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});
            child.once('exit',()=>{clearTimeout(timer);reject(new Error(logs));});
        });
        const base=`http://127.0.0.1:${auth.port}`,endpoint=base+'/api/agent/v1/canvases/canvas-test';
        const api=async(method,suffix,body,key)=>{
            const response=await fetch(endpoint+suffix,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
            const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
        };
        const read=()=>api('GET','/image-repairs/source-0');
        const changes={prompt:'去掉眼睛高光，保持颜色、位置和画风。',strokes:[{tool:'brush',size:28,points:[{x:280,y:240},{x:720,y:240},{x:720,y:420},{x:280,y:420},{x:280,y:240}]}]};
        const initial=await read();
        const saveArgs={image_index:0,changes,expected_revision:initial.revision,dry_run:true};
        const trial=await api('PATCH','/image-repairs/source-0',saveArgs,'prepare');assert.equal(trial.persisted,false);
        await api('PATCH','/image-repairs/source-0',{...saveArgs,dry_run:false},'prepare');
        browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
        const context=await browser.newContext({viewport:{width:1440,height:960}});
        await context.addCookies([{name:'ic_session',value:auth.cookie,url:base}]);
        await context.route('**/api/**',async route=>{
            const url=new URL(route.request().url());
            if(url.pathname.startsWith('/api/agent/')||url.pathname.startsWith('/api/account/')||url.pathname.startsWith('/api/canvas-image-tasks')||['/api/canvases/canvas-test','/api/config','/api/model-capabilities','/api/ai/upload'].includes(url.pathname))return route.continue();
            if(url.pathname==='/api/local-generation-submissions')return route.fulfill({json:{enabled:false}});
            if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:auth.user}});
            if(url.pathname==='/api/prompt-optimization-settings')return route.fulfill({json:{repair:{}}});
            return route.fulfill({json:apiPayload(url.href)});
        });
        const page=await context.newPage(),errors=[];
        page.setDefaultTimeout(20000);
        page.on('pageerror',error=>errors.push(error.message));
        page.on('console',message=>{if(message.type()==='error')console.error('browser:',message.text());});
        const open=async()=>{
            await page.evaluate(()=>window.SmartCanvasModules.imageStudio.open({nodeId:'source-0',mode:'local-repair'}));
            await page.waitForFunction(()=>document.getElementById('imageRepairGenerate').disabled===false);
        };
        await page.goto(base+'/static/smart-canvas.html?id=canvas-test');
        await page.waitForFunction(()=>window.SmartCanvasModules.canvasPersistence.online()&&nodes.find(n=>n.id==='source-0')?.localRepairDrafts);
        await open();
        assert.equal(await page.locator('#imageRepairPrompt').evaluate(el=>el.value),changes.prompt);
        const view=await page.evaluate(()=>{
            const c=document.getElementById('imageRepairCanvas'),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
            let red=0,green=0;
            for(let i=0;i<pixels.length;i+=4){if(pixels[i]>190&&pixels[i+1]<150&&pixels[i+2]<130)red++;if(pixels[i]<100&&pixels[i+1]>155&&pixels[i+2]>105)green++;}
            return {red,green,ratio:document.getElementById('imageRepairCropSize').textContent};
        });
        assert.ok(view.red>100&&view.green>50,JSON.stringify(view));
        await page.waitForTimeout(600); // Let the existing Image Studio entrance motion settle.
        await page.screenshot({path:'/tmp/reroll-agent-repair-zh-light.png'});
        await page.evaluate(()=>{window.StudioI18n.set('en');document.documentElement.dataset.uiTheme='dark';});
        assert.equal(await page.locator('#imageRepairPrompt').evaluate(el=>el.value),changes.prompt);
        assert.equal(await page.locator('#imageRepairCount option').first().textContent(),'1');
        await page.waitForTimeout(600);
        await page.screenshot({path:'/tmp/reroll-agent-repair-en-dark.png'});
        // Manual changes remain the same persisted draft, read back via Agent HTTP.
        const manualPrompt='Remove only the highlights. Preserve the eye colors.';
        await page.locator('#imageRepairPrompt').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},manualPrompt);
        await page.evaluate(async()=>{window.SmartCanvasModules.imageStudio.close();await canvasPersistence.synced();});
        assert.equal((await read()).draft.prompt,manualPrompt);
        await page.reload();
        await page.waitForFunction(()=>window.SmartCanvasModules.canvasPersistence.online());
        await open();
        assert.equal(await page.locator('#imageRepairPrompt').evaluate(el=>el.value),manualPrompt);
        // An Agent update while the panel is open cannot be overwritten by a
        // stale local input or by closing that panel.
        const before=await read();
        await api('PATCH','/image-repairs/source-0',{image_index:0,changes:{prompt:'Latest Agent edit'},expected_revision:before.revision,dry_run:false},'remote-edit');
        await page.waitForFunction(()=>Object.values(nodes.find(n=>n.id==='source-0').localRepairDrafts)[0].prompt==='Latest Agent edit');
        await page.locator('#imageRepairPrompt').evaluate(el=>{el.value='Stale local edit';el.dispatchEvent(new Event('change',{bubbles:true}));});
        for(const language of ['zh','en']){
            const status=await page.evaluate(language=>{window.StudioI18n.set(language);return document.getElementById('imageRepairStatus').textContent;},language);
            assert.match(status,language==='zh'?/别处修改/:/edited elsewhere/);
        }
        await page.evaluate(async()=>{window.SmartCanvasModules.imageStudio.close();await canvasPersistence.synced();});
        assert.equal((await read()).draft.prompt,'Latest Agent edit');
        await open();
        assert.equal(await page.locator('#imageRepairPrompt').evaluate(el=>el.value),'Latest Agent edit');
        await page.evaluate(async()=>{window.SmartCanvasModules.imageStudio.close();await canvasPersistence.synced();});
        const ready=await read();
        const runArgs={node_ids:['source-0'],image_repair:{image_index:0,expected_revision:ready.revision}};
        const request=await api('POST','/run-requests',runArgs,'run-repair');
        const requestId=request.requests[0].id;
        await page.waitForFunction(id=>nodes.some(n=>n.agentRepairRequestId===id&&n.images?.length),requestId);
        await page.evaluate(()=>canvasPersistence.synced());
        const final=await read();
        assert.equal(final.run_requests.find(r=>r.id===requestId).state,'submitted');
        const ids=final.run_requests.find(r=>r.id===requestId).output_node_ids;
        assert.equal(ids.length,1);
        const state=await context.request.get(base+'/fixture/state').then(response=>response.json());
        assert.equal(state.submissions.length,1);
        assert.ok(state.submissions[0].prompt.startsWith('Latest Agent edit'));
        assert.equal(state.submissions[0].local_repair.preserve_geometry,true);
        const output=state.canvas.nodes.find(n=>n.id===ids[0]);
        assert.equal(output.images[0].natural_w,1000);assert.equal(output.images[0].natural_h,800);
        assert.ok(state.canvas.connections.some(c=>c.from==='source-0'&&c.to===ids[0]));
        const retry=await api('POST','/run-requests',runArgs,'run-repair');assert.equal(retry.requests[0].id,requestId);
        await page.reload();await page.waitForFunction(()=>window.SmartCanvasModules.canvasPersistence.online());
        assert.equal((await context.request.get(base+'/fixture/state').then(r=>r.json())).submissions.length,1);
        assert.deepEqual(errors,[]);
        console.log('PASS: Agent draft → real Local repair panel → manual edit/reload + stale-write protection → leased run → real crop/composite + connected output; retry once; Chinese/English; no external Provider calls.');
    } catch(error){
        console.error(logs);throw error;
    } finally {
        await browser?.close();child.kill('SIGINT');
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
