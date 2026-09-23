const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
    '.css':'text/css; charset=utf-8',
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.svg':'image/svg+xml',
};
const tinyImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" fill="%234c8bf5"/%3E%3C/svg%3E';

function startServer(){
    return new Promise((resolve, reject) => {
        const server = http.createServer((request, response) => {
            const requestPath = decodeURIComponent(
                new URL(request.url, 'http://127.0.0.1').pathname,
            );
            const filePath = path.resolve(ROOT, `.${requestPath}`);
            if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)){
                response.writeHead(403).end('Forbidden');
                return;
            }
            fs.readFile(filePath, (error, body) => {
                if(error){
                    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
                    return;
                }
                response.writeHead(200, {
                    'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream',
                }).end(body);
            });
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

(async () => {
    const server = await startServer();
    const browser = await chromium.launch({headless:true,executablePath:CHROME});
    const page = await browser.newPage({viewport:{width:1180,height:760}});
    const errors=[]; page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    const requests=[]; let reply='A luminous sunset', fail=false, hold=null, settingsFail=false, networkFail=false;
    await page.route('**/api/prompt-optimization-settings',route=>route.fulfill({status:settingsFail?503:200,contentType:'application/json',body:JSON.stringify({version:2,image:{provider:'test-provider',model:'test-model',instructions:{smart:'Keep the mood quiet.'}},video:{provider:'video-provider',model:'video-model',instructions:{smart:'Keep motion continuous.'}}})}));
    await page.route('**/api/model-capabilities?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({catalog_revision:'optimization-catalog',support_state:'unknown',inputs:{},parameters:{history:{type:'array',maximum:20}}})}));
    await page.route('**/api/canvas-llm',async route=>{
        requests.push(route.request().postDataJSON());
        assert.equal(requests.at(-1).catalog_revision,'optimization-catalog');
        if(networkFail) return route.abort('connectionfailed');
        if(hold) await hold;
        await route.fulfill({status:fail?429:200,contentType:'application/json',body:JSON.stringify(fail?{detail:'Rate limit exceeded'}:{text:reply})});
    });
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=optimize-test&componentReview=nodes`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>Boolean(window.SmartCanvasModules?.promptOptimize && customElements.get('ic-canvas-node')));
        await page.waitForFunction(()=>document.body.dataset.componentReviewStatus==='ready');
        await page.evaluate(({tinyImage})=>{
            document.body.classList.remove('smart-canvas-node-review');
            const node={id:'optimize-image',type:'smart-image',referenceGenerationKind:'image',title:'Image',images:[{url:tinyImage,kind:'image'}],x:250,y:180,w:240,h:200,promptDraftHtml:'sunset',promptDraftText:'sunset'};
            canvas={id:'optimize-test',nodes:[node],connections:[],viewport:{x:0,y:0,scale:1},settings:{},logs:[]};
            viewport={x:0,y:0,scale:1};nodes=canvas.nodes;selectedId=node.id;selectedIds=[];selectedImage={nodeId:'',index:-1};
            canvasPersistenceStartTransientSession({document:canvas});
            // Supply an available configured text model; the HTTP boundary stays real and intercepted.
            resolveChatProviderId=()=> 'test-provider';resolveChatModel=()=> 'test-model';
            smartCatalogEntry=()=> ({model_id:'test-model'});
            render();updateComposer();
        },{tinyImage});
        await page.evaluate(()=>{
            const node={id:'text-generation-check',type:'smart-prompt',llmEnabled:true,text:'Write a prompt',x:100,y:100};
            nodes.push(node);selectedId=node.id;updateComposer();
        });
        assert.equal(await page.locator('#promptGenerationComposer [data-i18n-label="smart.optimize.presets"]').count(),0,'Text generation must not inherit prompt optimization controls');
        await page.evaluate(()=>{selectedId='optimize-image';updateComposer();});
        const editor=page.locator('#promptInput');
        const optimize=page.locator('#promptOptimizeBtn').getByRole('button');
        const currentAlert=page.locator('#generationFailureAlertQueue ic-alert[data-ic-stack-index="0"]:not([data-ic-stack-state="exiting"])');
        const checkFailure=async (messageKey)=>{
            await page.waitForFunction(()=>!document.querySelector('#promptOptimizeBtn').loading);
            await currentAlert.waitFor({state:'visible'});
            assert.equal(await currentAlert.getAttribute('heading'),await page.evaluate(()=>tr('smart.optimize.failedTitle')));
            assert.ok((await currentAlert.textContent()).includes(await page.evaluate(key=>tr(key),messageKey)));
            assert.equal(await currentAlert.getAttribute('action-label'),null,'Do not show a details action without a generation log');
            assert.equal(await currentAlert.getAttribute('data-ic-contract-status'),'ready','Failure alert must satisfy the public component contract');
            assert.equal(await optimize.isEnabled(),true,'Failure permits a manual retry');
        };
        const switchPrompt=async value=>{
            await page.locator('#promptOptimizeMenu [slot="trigger"]').getByRole('button').click();
            await page.locator(`#promptOptimizeMenu ic-menu-item[value="${value}"]`).click();
        };
        await page.waitForSelector('#composer.open');
        assert.equal(await page.locator('#promptOptimizeMenu [slot="trigger"]').isVisible(),false,'No switching control before an optimization result');
        await optimize.click();
        await page.waitForFunction(()=>document.querySelector('#promptInput').textContent==='A luminous sunset');
        assert.equal(requests.length,1);
        assert.ok(requests[0].message.includes('Keep the mood quiet.'));
        assert.equal(requests[0].provider,'test-provider');
        assert.equal(await page.locator('#promptOptimizeMenu [slot="trigger"]').isVisible(),true);
        assert.ok(requests[0].message.includes('sunset'));
        assert.equal(await page.locator('#promptOptimizeStatus').count(),0,'no extra status row');
        assert.equal(await page.locator('#promptOptimizeMenu ic-menu-item').count(),2);
        await switchPrompt('original');
        assert.equal(await editor.textContent(),'sunset');
        await switchPrompt('optimized');
        assert.equal(await editor.textContent(),'A luminous sunset');
        assert.equal(requests.length,1,'switching versions never calls the model');
        await editor.focus();await page.keyboard.press('Control+z');
        assert.equal(await editor.textContent(),'sunset');
        await switchPrompt('optimized');
        assert.equal(await optimize.isEnabled(),false);
        await editor.fill('My new prompt');reply='Changed';await optimize.click();
        await page.waitForFunction(()=>document.querySelector('#promptInput').textContent==='Changed');
        assert.ok(requests[1].message.includes('My new prompt'));
        await switchPrompt('original');assert.equal(await editor.textContent(),'My new prompt');
        await editor.fill('My new prompt');
        await page.evaluate(()=>{smartCatalogEntry=()=>null;});
        const unavailableCount=requests.length;
        await optimize.click();await page.waitForFunction(()=>!document.querySelector('#promptOptimizeBtn').loading);
        assert.equal(requests.length,unavailableCount);
        await checkFailure('smart.optimize.noModel');
        await page.evaluate(()=>{smartCatalogEntry=()=>({model_id:'test-model'});});
        await page.evaluate(()=>toast('Existing generation failure',{persistent:true,tone:'danger'}));
        const alertCount=await page.locator('#generationFailureAlertQueue ic-alert').count();
        fail=true;await optimize.click();await page.waitForFunction(()=>!document.querySelector('#promptOptimizeBtn').loading);
        assert.equal(await page.locator('#generationFailureAlertQueue ic-alert').count(),alertCount+1,'Optimization failure must show an alert even when a generation failure is already visible');
        await checkFailure('smart.error.rate_limited.title');
        assert.ok((await currentAlert.textContent()).includes('429'));
        for(const language of ['en','zh']){
            await page.evaluate(language=>StudioI18n.set(language),language);
            await checkFailure('smart.error.rate_limited.title');
        }
        for(const theme of ['light','dark']){
            await page.evaluate(theme=>applyTheme(theme),theme);
            await page.screenshot({path:`/tmp/prompt-optimize-failure-${theme}.png`,animations:'disabled'});
        }
        await currentAlert.getByRole('button').click();
        await page.waitForFunction(count=>document.querySelectorAll('#generationFailureAlertQueue ic-alert').length===count,alertCount);
        assert.equal(await editor.textContent(),'My new prompt');fail=false;
        settingsFail=true;await optimize.click();await checkFailure('smart.optimize.settings');settingsFail=false;
        networkFail=true;await optimize.click();await checkFailure('smart.optimize.network');networkFail=false;
        await page.evaluate(()=>{
            window.originalOptimizationTimeout=AbortSignal.timeout;
            AbortSignal.timeout=ms=>ms===120000 ? AbortSignal.abort(new DOMException('Timed out','TimeoutError')) : window.originalOptimizationTimeout(ms);
        });
        await optimize.click();await checkFailure('smart.optimize.timeout');
        await page.evaluate(()=>{AbortSignal.timeout=window.originalOptimizationTimeout;delete window.originalOptimizationTimeout;});
        reply='';await optimize.click();await checkFailure('smart.optimize.empty');
        assert.equal(await editor.textContent(),'My new prompt');reply='Changed';
        let release;hold=new Promise(resolve=>{release=resolve;});
        await optimize.click();await page.waitForFunction(()=>document.querySelector('#promptOptimizeBtn').loading);
        await editor.fill('Edited while loading');release();hold=null;
        await page.waitForFunction(()=>!document.querySelector('#promptOptimizeBtn').loading);
        assert.equal(await editor.textContent(),'Edited while loading');
        // Switching away and back invalidates a response even if the text is identical.
        hold=new Promise(resolve=>{release=resolve;});
        await optimize.click();await page.waitForFunction(()=>document.querySelector('#promptOptimizeBtn').loading);
        await page.evaluate(()=>{
            const first=nodes[0];const second={...first,id:'other-image'};nodes.push(second);
            selectedId=second.id;updateComposer();selectedId=first.id;updateComposer();
        });
        release();hold=null;await page.waitForFunction(()=>!document.querySelector('#promptOptimizeBtn').loading);
        assert.equal(await editor.textContent(),'Edited while loading');
        await editor.fill('');await page.waitForFunction(()=>document.querySelector('#promptOptimizeBtn').disabled);
        await page.evaluate(()=>{settings.apiKind='video';composerPromptOptimizer.refresh();});
        assert.equal(await page.locator('#promptOptimizeMenu ic-menu-item[value="camera"]').count(),0);
        await page.evaluate(()=>{settings.apiKind='image';composerPromptOptimizer.refresh();});
        assert.equal(await page.locator('#promptOptimizeMenu ic-menu-item[value="camera"]').count(),0);
        // HTML returned by the provider must stay text; referenced media tokens survive.
        await page.evaluate(()=>{promptInput.innerHTML='Use <span class="mention-image-token" contenteditable="false" data-url="/assets/ref.png" data-name="ref" data-kind="image">@ref</span>';promptInput.dispatchEvent(new Event('input',{bubbles:true}));});
        reply='Use [[REF_0]] <img src=x onerror=alert(1)>';await optimize.click();
        await page.waitForFunction(()=>document.querySelector('#promptInput').textContent.includes('<img'));
        assert.equal(await editor.locator('img').count(),0);
        assert.equal(await editor.locator('.mention-image-token').getAttribute('data-url'),'/assets/ref.png');
        await switchPrompt('original');
        assert.equal(await editor.locator('.mention-image-token').count(),1);
        reply='Missing reference';const original=await editor.innerHTML();await editor.dispatchEvent('input');await optimize.click();
        await page.waitForFunction(()=>!document.querySelector('#promptOptimizeBtn').loading);
        assert.equal(await editor.innerHTML(),original);
        await checkFailure('smart.optimize.references');
        await editor.fill('A small cabin beside a quiet lake');
        reply='A small wooden cabin beside a quiet lake, warm window light reflected in still water.';
        await optimize.click();await page.waitForFunction(()=>document.querySelector('#promptInput').textContent.includes('warm window'));
        for(const language of ['en','zh']){
            await page.evaluate(language=>StudioI18n.set(language),language);
            await page.waitForFunction(language=>document.querySelector('#promptOptimizeBtn').getAttribute('label').includes(language==='en'?'Optimize prompt':'优化提示词'),language);
            assert.equal(await page.locator('#promptOptimizeMenu ic-menu-item[value="optimized"]').getAttribute('label'),language==='en'?'Optimized prompt 1':'优化提示词 1');
        }
        await page.evaluate(()=>{viewport={x:220,y:-80,scale:1};window.SmartCanvasModules.viewportSelection.viewport.apply();updateComposer();});
        await page.locator('#promptOptimizeMenu [slot="trigger"]').getByRole('button').click();
        for(const theme of ['light','dark']){
            await page.evaluate(theme=>applyTheme(theme),theme);
            await page.mouse.move(20,20);
            await page.waitForTimeout(250);
            const alignment = await page.evaluate(() => {
                const center = el => {const b=el.getBoundingClientRect();return b.y+b.height/2;};
                const optimize=document.querySelector('#promptOptimizeBtn');
                const trigger=document.querySelector('#promptOptimizeMenu [slot="trigger"]');
                const icon=trigger.querySelector('ic-icon');
                return {centers:[center(optimize),center(trigger),center(document.querySelector('#runBtn')),center(document.querySelector('.param-row'))],size:icon.getBoundingClientRect().width,color:getComputedStyle(trigger.shadowRoot.querySelector('button')).color,expectedColor:getComputedStyle(document.querySelector('ic-generation-settings-picker').shadowRoot.querySelector('[part=trigger]')).color};
            });
            assert.equal(alignment.color,alignment.expectedColor,'Version arrow matches the parameter foreground');
            assert.ok(Math.max(...alignment.centers)-Math.min(...alignment.centers)<1,'Composer controls share a vertical center');
            assert.equal(alignment.size,16,'Version arrow uses the same small icon size as parameters');
            await page.screenshot({path:`/tmp/laz37-${theme}.png`,animations:'disabled'});
        }
        await page.locator('#promptOptimizeMenu [slot="trigger"]').getByRole('button').click();
        await page.evaluate(()=>StudioI18n.set('en'));
        await page.setViewportSize({width:900,height:760});
        await page.evaluate(()=>updateComposer());
        const bounds=await page.locator('#composer').boundingBox();
        assert.ok(bounds.x>=0 && bounds.x+bounds.width<=900,'Composer fits a narrow desktop window');
        const trigger=page.locator('#promptOptimizeMenu [slot="trigger"]').getByRole('button');
        await trigger.focus();await page.keyboard.press('Enter');
        await page.waitForFunction(()=>document.querySelector('#promptOptimizeMenu').hasAttribute('open'));
        await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
        await page.waitForFunction(()=>!document.querySelector('#promptOptimizeMenu').hasAttribute('open'));
        assert.equal(await page.locator('#promptOptimizeMenu ic-menu-item[value="original"]').getAttribute('checked'),'');
        await page.evaluate(()=>{
            smartCatalogEntry=()=>({model_id:'test-model'});
            const node={id:'plain-prompt-check',type:'smart-prompt',text:'A rough idea',textHtml:'A rough idea',x:100,y:100,w:340,h:280};
            nodes.push(node);selectedId=node.id;render();updateComposer();
        });
        const promptNode=page.locator('.image-node[data-id="plain-prompt-check"]');
        assert.equal(await promptNode.locator('[data-optimize-button], [data-optimize-media]').count(),0,'plain prompt nodes have no optimization module');
        await page.evaluate(()=>{selectedId='optimize-image';updateComposer();});
        assert.equal(await page.locator('#promptOptimizeMenu [slot="trigger"]').isVisible(),true,'switching away and back retains the version switch');
        const savedRecord=await page.evaluate(()=>nodes.find(node=>node.id==='optimize-image').promptOptimization.image);
        assert.ok(savedRecord.sourceHtml.includes('quiet lake'));
        await switchPrompt('original');
        assert.equal(await editor.textContent(),'A small cabin beside a quiet lake');
        await switchPrompt('optimized');
        assert.ok((await editor.textContent()).includes('warm window'));
        // Recreate the controller from the serialized node record (page reload boundary).
        await page.evaluate(()=>{
            const node=nodes.find(node=>node.id==='optimize-image');
            const holder=document.createElement('div');
            holder.append(document.getElementById('composerCardTemplate').content.cloneNode(true));
            holder.id='restored-optimizer';document.body.append(holder);
            const input=holder.querySelector('#promptInput');
            input.innerHTML=node.promptDraftHtml;
            window.restoredOptimizer=SmartCanvasModules.promptOptimize.mount({
                editor:input,surface:holder,button:holder.querySelector('#promptOptimizeBtn'),menu:holder.querySelector('#promptOptimizeMenu'),
                translate:tr,key:()=>node.id,media:()=> 'image',model:()=>'',editable:()=>true,text:()=>input.textContent,plainText:el=>el.textContent,
                readRecord:()=>JSON.parse(JSON.stringify(node.promptOptimization.image)),request:()=>{throw new Error('must not call provider for existing result');},error:()=>{}
            });
        });
        assert.equal(await page.locator('#restored-optimizer #promptOptimizeMenu [slot="trigger"]').isVisible(),true);
        assert.equal(await page.locator('#restored-optimizer #promptOptimizeBtn').getByRole('button').isEnabled(),false);
        console.log(JSON.stringify({requests:requests.length,errors}));
        assert.deepEqual(errors,[]);
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
