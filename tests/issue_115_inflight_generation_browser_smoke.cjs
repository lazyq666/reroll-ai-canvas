const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const executablePath = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        page.setDefaultTimeout(10000);
        await page.route('**/api/local-generation-submissions', route => route.fulfill({json:{enabled:false}}));
        await page.route('**/api/canvases/issue-47-text-composer', route => route.fulfill({json:{canvas:{
            id:'issue-47-text-composer',canvas_type:'smart',nodes:[],connections:[],settings:{},revision:0
        }}}));
        let submissions = 0;
        await page.route('**/api/canvas-*-tasks', route => {
            submissions++;
            return route.fulfill({status:500,json:{error:'Unexpected generation submission'}});
        });
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`);
        await page.waitForFunction(() => canvas?.id === 'issue-47-text-composer'
            && window.SmartCanvasModules.canvasPersistence.online());
        for (const kind of ['image','video']) for (const state of ['running','queued']) {
            await page.evaluate(({kind,state}) => {
                const refs = ['one','two'].map(inputInstanceId => ({url:'/static/images/test/fixture.svg',kind:'image',inputInstanceId}));
                const source = {
                    id:'inflight-source',type:'smart-image',x:200,y:180,w:320,h:240,
                    generationOutputNode:true,referenceGenerationKind:kind,outputKind:kind,
                    images:[],pending:1,[state]:true,
                    generationOperationId:'original-operation',
                    promptDraftText:'Later unsent edit',promptDraftHtml:'Later unsent edit',
                    runPrompt:'Frozen prompt',runSettings:{engine:'api',apiKind:kind,count:3,generationBatchLayout:'horizontal'},
                    generationInputSnapshot:{prompt:'Frozen prompt',refs,settings:{engine:'api',apiKind:kind,count:1}},
                };
                nodes.splice(0,nodes.length,source,
                    {id:'parent',type:'smart-prompt',text:'',x:0,y:100,w:150,h:100},
                    {id:'child',type:'smart-prompt',text:'',x:1100,y:100,w:150,h:100});
                canvas={...canvas,nodes,connections:[
                    {from:'parent',to:source.id,kind:'input'}, {from:source.id,to:'child',kind:'input'}
                ],logs:[]};
                selectedId=source.id; selectedIds=[]; selectedImage={nodeId:'',index:-1};
                viewport.x=0;viewport.y=0;viewport.scale=1;
                window.SmartCanvasModules.viewportSelection.viewport.apply();
                configureSmartCanvasVirtualization();canvasLevelOfDetail.update(1);smartCanvasDetailRecoveryReady=null;
                applyTheme(state==='running'?'light':'dark');render();updateComposer();
            }, {kind,state});
            for (const language of ['en','zh']) {
                await page.evaluate(language=>window.StudioI18n.set(language),language);
                const expected = language==='en'?'Continue editing':'继续编辑';
                await page.waitForFunction(expected=>document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="continue-editing"]')?.textContent.trim()===expected,expected);
                const menu = await page.evaluate(()=>smartContextMenuSections({nodeId:'inflight-source',mediaIndex:-1}).flat());
                assert.equal(menu.filter(item=>item.action==='continue-editing').length,1);
                assert.equal(menu.find(item=>item.action==='continue-editing').label,expected);
                assert.ok(!menu.some(item=>item.action==='duplicate'));
                assert.deepEqual(await page.locator('#smartNodeFloatingPortal [data-smart-node-action]').evaluateAll(es=>es.map(e=>e.dataset.smartNodeAction)),['continue-editing','regenerate']);
            }
            const before = await page.evaluate(()=>JSON.stringify(nodes.find(n=>n.id==='inflight-source')));
            // Cover the real floating toolbar and the context menu command.
            if (state==='running') await page.locator('#smartNodeFloatingPortal [data-smart-node-action="continue-editing"]').click();
            else {
                await page.locator('.image-node[data-id="inflight-source"]').click({button:'right',position:{x:30,y:30}});
                await page.locator('#smartNodeContextMenu').getByText('继续编辑',{exact:true}).click();
            }
            await page.waitForFunction(()=>nodes.length===4 && selectedId!=='inflight-source');
            await page.waitForFunction(()=>document.activeElement===promptInput).catch(async error=>{
                throw new Error(JSON.stringify({kind,state,focus:await page.evaluate(()=>({
                    active:document.activeElement?.id,tag:document.activeElement?.localName,
                    composer:composer.className,visible:promptInput.checkVisibility()
                }))}), {cause:error});
            });
            const result=await page.evaluate(()=>{
                const draft=nodes.find(n=>n.id===selectedId);
                return {draft,source:JSON.stringify(nodes.find(n=>n.id==='inflight-source')),
                    incoming:canvas.connections.filter(c=>c.to===draft.id),
                    outgoing:canvas.connections.filter(c=>c.from===draft.id),
                    focused:document.activeElement===promptInput};
            });
            // Selecting another node materializes the existing default layout setting.
            const original = JSON.parse(before), retained = JSON.parse(result.source);
            original.runSettings.generationBatchLayout ||= 'horizontal';
            retained.runSettings.generationBatchLayout ||= 'horizontal';
            assert.deepEqual(retained,original,'Original task and edits must remain unchanged');
            assert.equal(result.draft.promptDraftText,'Frozen prompt');
            assert.equal(result.draft.runSettings.count,1);
            assert.equal(result.draft.referenceGenerationKind,kind);
            assert.deepEqual(result.draft.images,[]);
            for(const field of ['pending','running','queued','generationOperationId','generationInputSnapshot']) assert.ok(!result.draft[field],field);
            assert.equal(result.draft.manualInputRefs.length,2);
            assert.deepEqual(result.incoming.map(c=>c.from),['parent']);
            assert.deepEqual(result.outgoing,[]);
            assert.equal(result.focused,true);
            assert.equal(submissions,0,'Continue editing must not submit a generation');
        }
        console.log('PASS: pending/queued image/video continue editing, frozen recipe, parent connections, focus, original task unchanged, no generation, zh/en, light/dark');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
