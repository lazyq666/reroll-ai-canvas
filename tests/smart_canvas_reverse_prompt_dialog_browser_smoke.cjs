const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const context = await browser.newContext({viewport:{width:1440, height:900}});
    if (process.env.SMART_CANVAS_TEST_USERNAME && process.env.SMART_CANVAS_TEST_PASSWORD) {
        const login = await context.request.post(`${baseUrl}/api/auth/login`, {
            data:{
                username:process.env.SMART_CANVAS_TEST_USERNAME,
                password:process.env.SMART_CANVAS_TEST_PASSWORD,
            },
        });
        assert.equal(login.ok(), true, `Smart Canvas smoke login failed: ${login.status()}`);
    }
    const page = await context.newPage();

    await page.goto(`${baseUrl}/static/smart-canvas.html?id=reverse-prompt-dialog-regression`, {
        waitUntil:'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(
        window.SmartCanvasModules?.viewportSelection?.selection
        && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
    ));
    await page.waitForLoadState('networkidle');

    await page.evaluate(({imageUrl}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const sourceId = 'reverse-prompt-source';
            if(!canvas) canvas = {id:canvasId, title:'Reverse prompt test', nodes:[], connections:[], revision:0};
            nodes.splice(0, nodes.length, {
                id:sourceId,
                type:'smart-image',
                x:240,
                y:220,
                w:320,
                h:240,
                images:[{
                    url:${JSON.stringify(imageUrl)},
                    name:'reverse-source.png',
                    kind:'image',
                    natural_w:1,
                    natural_h:1
                }]
            });
            canvas.nodes = nodes;
            canvas.connections = [];
            selectedId = sourceId;
            selectedIds = [];
            selectedImage = {nodeId:sourceId, index:0};
            viewport.x = 0;
            viewport.y = 0;
            viewport.scale = 1;
            promptLibraries = [{
                id:'system',
                name:'系统提示词库',
                categories:[{id:'reverse_prompt', name:'反推提示词'}],
                items:[
                    {
                        id:'reverse-detailed',
                        name:'完整画面描述',
                        category:'reverse_prompt',
                        positive:'输出完整中文生图提示词。'
                    },
                    {
                        id:'reverse-compact',
                        name:'精简提示词',
                        category:'reverse_prompt',
                        positive:'只输出精简的中文生图提示词。'
                    }
                ]
            }];
            activePromptLibraryId = 'system';
            availableModels = {
                image:[],
                video:[],
                text:[
                    {
                        id:'codex-gpt-5.5',
                        provider_id:'codex',
                        provider_name:'Codex CLI',
                        model:'gpt-5.5',
                        name:'GPT-5.5'
                    },
                    {
                        id:'apimart-gemini-3.6-flash-high',
                        provider_id:'apimart',
                        provider_name:'APIMart',
                        model:'gemini-3.6-flash-high',
                        name:'Gemini 3.6 Flash High'
                    }
                ]
            };
            canvasPersistence.schedule = () => {};
            runPromptLLMNode = async (nodeId, options={}) => {
                window.__reversePromptRunNodeId = nodeId;
                if(window.__reversePromptShouldFail) throw new Error('submission rejected');
                if(window.__reversePromptHoldAcceptance){
                    await new Promise(resolve => {
                        window.__releaseReversePromptAcceptance = async () => {
                            await options.onAccepted?.({nodeId});
                            resolve();
                        };
                    });
                }else{
                    await options.onAccepted?.({nodeId});
                }
                return nodes.find(node => node.id === nodeId) || null;
            };
            window.__reversePromptSnapshot = () => ({
                nodes:nodes.map(node => ({
                    id:node.id,
                    type:node.type,
                    llmInstruction:node.llmInstruction || '',
                    llmProvider:node.llmProvider || '',
                    llmModel:node.llmModel || '',
                    llmTemplateId:node.llmTemplateId || '',
                    llmTemplateLibraryId:node.llmTemplateLibraryId || '',
                    llmInputMedia:(node.llmInputMedia || []).map(item => item.url)
                })),
                connections:(canvas?.connections || []).map(connection => ({
                    from:connection.from,
                    to:connection.to,
                    kind:connection.kind || 'flow'
                })),
                runNodeId:window.__reversePromptRunNodeId || ''
            });
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {imageUrl:tinyPng});

    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready'
        && document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="reverse-prompt"]')
    ));
    await page.locator('#smartNodeFloatingPortal [data-smart-node-action="reverse-prompt"]').click();
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === true);

    const dialogState = await page.locator('ic-ai-processor-dialog').evaluate(dialog => ({
        open:dialog.open,
        size:dialog.size,
        dismissPolicy:dialog.dismissPolicy,
        contract:dialog.dataset.icContractStatus,
        label:dialog.label,
        sourceImage:dialog.sourceImage,
        selectedGroup:dialog.selectedGroup,
        selectedTemplate:dialog.selectedTemplate,
        groups:dialog.groups.map(group => ({id:group.id, name:group.name, templates:group.templates.map(item => ({id:item.id, name:item.name, subtitle:item.subtitle}))})),
        models:dialog.models.map(item => ({id:item.id, name:item.name})),
        textareaCount:dialog.querySelectorAll('textarea, ic-textarea').length,
    }));
    assert.deepEqual(dialogState, {
        open:true,
        size:'medium',
        dismissPolicy:'explicit',
        contract:'ready',
        label:'反推提示词',
        sourceImage:tinyPng,
        selectedGroup:'reverse_prompt',
        selectedTemplate:'reverse-detailed',
        groups:[{id:'reverse_prompt', name:'反推提示词', templates:[
            {id:'reverse-detailed', name:'完整画面描述', subtitle:'反推提示词'},
            {id:'reverse-compact', name:'精简提示词', subtitle:'反推提示词'},
        ]}],
        models:[
            {id:'codex-gpt-5.5', name:'GPT-5.5'},
            {id:'apimart-gemini-3.6-flash-high', name:'Gemini 3.6 Flash High'},
        ],
        textareaCount:0,
    });

    await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
        dialog.dispatchEvent(new CustomEvent('ic-after-hide', {
            bubbles:true,
            composed:true,
        }));
    });
    await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="confirm"]').click();
    await page.waitForFunction(() => {
        const dialog = document.querySelector('ic-ai-processor-dialog');
        const toast = document.querySelector('ic-toast[data-ic-overlay]');
        return dialog?.errorMessage.includes('操作状态已失效')
            && toast?.textContent.includes('操作状态已失效');
    });
    assert.equal(
        await page.locator('ic-toast[data-ic-overlay]').getAttribute('tone'),
        'danger'
    );
    await page.locator('ic-toast[data-ic-overlay]').evaluate(toast => toast.dismiss());
    await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === false);

    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = 'syncSmartNodeFloatingPortal();';
        document.body.appendChild(script);
        script.remove();
    });
    await page.locator('#smartNodeFloatingPortal [data-smart-node-action="reverse-prompt"]').click();
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === true);

    await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
        dialog.selectTemplate('reverse-compact');
        dialog.selectedModel = 'apimart-gemini-3.6-flash-high';
        dialog.syncActions();
    });
    await page.evaluate(() => { window.__reversePromptShouldFail = true; });
    await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="confirm"]').click();
    await page.waitForFunction(() => {
        const dialog = document.querySelector('ic-ai-processor-dialog');
        const toast = document.querySelector('ic-toast[data-ic-overlay]');
        return dialog?.open === true
            && dialog.pending === false
            && dialog.errorMessage.includes('submission rejected')
            && toast?.textContent.includes('submission rejected');
    });
    assert.equal(await page.locator('ic-toast[data-ic-overlay]').getAttribute('tone'), 'danger');
    assert.deepEqual(await page.locator('ic-ai-processor-dialog').evaluate(dialog => ({
        selectedTemplate:dialog.selectedTemplate,
        selectedModel:dialog.selectedModel,
        visibleModel:dialog.querySelector('ic-select[name="ai-processor-model"]')?.value,
    })), {
        selectedTemplate:'reverse-compact',
        selectedModel:'apimart-gemini-3.6-flash-high',
        visibleModel:'apimart-gemini-3.6-flash-high',
    });
    assert.equal((await page.evaluate(() => window.__reversePromptSnapshot())).nodes.length, 1);
    await page.locator('ic-toast[data-ic-overlay]').evaluate(toast => toast.dismiss());
    await page.evaluate(() => { window.__reversePromptShouldFail = false; });
    await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === false);
    assert.equal((await page.evaluate(() => window.__reversePromptSnapshot())).nodes.length, 1);

    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = 'syncSmartNodeFloatingPortal();';
        document.body.appendChild(script);
        script.remove();
    });
    await page.locator('#smartNodeFloatingPortal [data-smart-node-action="reverse-prompt"]').click();
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === true);
    await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
        dialog.selectTemplate('reverse-compact');
        dialog.selectedModel = 'codex-gpt-5.5';
        dialog.syncActions();
        const modelControl = dialog.querySelector('ic-select[name="ai-processor-model"]');
        modelControl.dispatchEvent(new CustomEvent('wa-after-hide', {
            bubbles:true,
            composed:true,
        }));
    });
    await page.evaluate(() => { window.__reversePromptHoldAcceptance = true; });
    await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="confirm"]').click();
    await page.waitForFunction(() => (
        window.__reversePromptSnapshot().nodes.length === 2
        && typeof window.__releaseReversePromptAcceptance === 'function'
    ));
    const stateBeforeProviderAcceptance = await page.evaluate(() => ({
        dialogOpen:document.querySelector('ic-ai-processor-dialog')?.open,
        nodeCount:window.__reversePromptSnapshot().nodes.length,
    }));
    await page.evaluate(() => window.__releaseReversePromptAcceptance());
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === false);
    assert.deepEqual(stateBeforeProviderAcceptance, {dialogOpen:false, nodeCount:2});

    const result = await page.evaluate(() => window.__reversePromptSnapshot());
    const generated = result.nodes.find(node => node.id === result.runNodeId);
    assert.deepEqual(generated, {
        id:result.runNodeId,
        type:'smart-prompt',
        llmInstruction:'只输出精简的中文生图提示词。',
        llmProvider:'codex',
        llmModel:'gpt-5.5',
        llmTemplateId:'reverse-compact',
        llmTemplateLibraryId:'system',
        llmInputMedia:[tinyPng],
    });
    assert.equal(result.connections.some(connection => (
        connection.from === 'reverse-prompt-source'
        && connection.to === result.runNodeId
        && connection.kind === 'input'
    )), true);

    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            selectedId = 'reverse-prompt-source';
            selectedIds = [];
            selectedImage = {nodeId:'reverse-prompt-source', index:0};
            delete window.__releaseReversePromptAcceptance;
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    });
    await page.locator('#smartNodeFloatingPortal [data-smart-node-action="reverse-prompt"]').click();
    await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === true);
    await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
        dialog.selectTemplate('reverse-detailed');
        dialog.selectedModel = 'apimart-gemini-3.6-flash-high';
        dialog.syncActions();
    });
    await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="confirm"]').click();
    await page.waitForFunction(() => (
        window.__reversePromptSnapshot().nodes.length === 3
        && typeof window.__releaseReversePromptAcceptance === 'function'
    ));
    const geminiStateBeforeProviderAcceptance = await page.evaluate(() => ({
        dialogOpen:document.querySelector('ic-ai-processor-dialog')?.open,
        nodeCount:window.__reversePromptSnapshot().nodes.length,
    }));
    await page.evaluate(() => window.__releaseReversePromptAcceptance());
    assert.deepEqual(geminiStateBeforeProviderAcceptance, {dialogOpen:false, nodeCount:3});

    const geminiResult = await page.evaluate(() => window.__reversePromptSnapshot());
    const geminiGenerated = geminiResult.nodes.find(node => node.id === geminiResult.runNodeId);
    assert.deepEqual(geminiGenerated, {
        id:geminiResult.runNodeId,
        type:'smart-prompt',
        llmInstruction:'输出完整中文生图提示词。',
        llmProvider:'apimart',
        llmModel:'gemini-3.6-flash-high',
        llmTemplateId:'reverse-detailed',
        llmTemplateLibraryId:'system',
        llmInputMedia:[tinyPng],
    });

    await browser.close();
    console.log('Smart Canvas reverse prompt dialog browser smoke passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
