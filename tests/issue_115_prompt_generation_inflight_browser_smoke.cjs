const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:900}});
        await context.route('**/static/js/infinite-canvas-ui/prompt-template-library.js*', async route => {
            const response = await route.fetch();
            if(response.ok()){
                await route.fulfill({response});
                return;
            }
            await route.fulfill({
                status:200,
                contentType:'application/javascript',
                body:'export class IcPromptTemplateLibrary extends HTMLElement {}',
            });
        });
        await context.route('**/static/js/smart-canvas/canvas-persistence.js*', async route => {
            const response = await route.fetch();
            const source = await response.text();
            const editableSource = source.replace(
                /function canvasPersistenceEditable\(\)\{[\s\S]*?\n\}/,
                'function canvasPersistenceEditable(){ return true; }'
            ).replace(
                /schedule\(\{delay=450\}=\{\}\)\{\s*return canvasPersistenceSchedule\(delay\);\s*\}/,
                'schedule(){ return undefined; }'
            ).replace(
                /save\(\)\{\s*return canvasPersistenceSave\(\);\s*\}/,
                'save(){ return Promise.resolve(true); }'
            ).replace(
                /synced\(\{timeout=5000\}=\{\}\)\{\s*return canvasPersistenceSynced\(timeout\);\s*\}/,
                'synced(){ return Promise.resolve(true); }'
            );
            assert.notEqual(editableSource, source);
            await route.fulfill({response, body:editableSource});
        });

        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-115-prompt-generation-inflight`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-icon-button')
            && window.SmartCanvasModules?.generationRecovery
            && document.getElementById('world')
        ));
        await page.waitForFunction(() => typeof canvas !== 'undefined'
            && canvas?.id === 'issue-115-prompt-generation-inflight');

        await page.evaluate(() => {
            apiProviders = [
                {id:'openai', name:'OpenAI', enabled:true, chat_models:['gpt-4o-mini']},
                {id:'anthropic', name:'Anthropic', enabled:true, chat_models:['claude-sonnet-4']},
            ];
            availableModels.text = [
                {
                    id:'openai|gpt-4o-mini',
                    provider_id:'openai',
                    provider_name:'OpenAI',
                    model:'gpt-4o-mini',
                    name:'GPT-4o mini',
                },
                {
                    id:'anthropic|claude-sonnet-4',
                    provider_id:'anthropic',
                    provider_name:'Anthropic',
                    model:'claude-sonnet-4',
                    name:'Claude Sonnet 4',
                },
            ];
            const source = {
                id:'prompt-source',
                type:'smart-prompt',
                title:'提示词生成',
                x:200,
                y:240,
                w:360,
                h:260,
                llmEnabled:true,
                llmInstruction:'第一版提示词',
                llmProvider:'openai',
                llmModel:'gpt-4o-mini',
                llmInputMedia:[],
            };
            nodes.splice(0, nodes.length, source);
            canvas = {id:'issue-115-prompt-generation-inflight', nodes, connections:[], logs:[]};
            selectedId = source.id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            viewport.x = 0;
            viewport.y = 0;
            viewport.scale = 1;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
            composer.style.display = 'none';
            window.__promptRunRequests = [];
            window.__promptRunSettlers = [];
            window.__promptRunResolved = [false, false];
            window.fetch = async (url, options={}) => {
                if(String(url) !== '/api/canvas-llm-tasks') throw new Error(`Unexpected fetch: ${url}`);
                const request = JSON.parse(options.body || '{}');
                window.__promptRunRequests.push(request);
                return new Response(JSON.stringify({task_id:`prompt-task-${window.__promptRunRequests.length}`}), {
                    status:200,
                    headers:{'Content-Type':'application/json'},
                });
            };
            window.SmartCanvasModules.generationRecovery = {
                ...window.SmartCanvasModules.generationRecovery,
                settle:({node, submission}) => new Promise(resolve => {
                    window.__promptRunSettlers.push({node, submission, resolve});
                }),
            };
            render();
        });

        await page.waitForFunction(() => document.querySelector(
            '.image-node[data-id="prompt-source"] .prompt-node-run'
        )?.dataset.icContractStatus === 'ready');
        const initialButtonState = await page.locator(
            '.image-node[data-id="prompt-source"] .prompt-node-run'
        ).evaluate(control => ({disabled:control.disabled, shadowDisabled:control.shadowRoot.querySelector('button')?.disabled}));
        assert.deepEqual(initialButtonState, {disabled:false, shadowDisabled:false});

        await page.evaluate(() => {
            const source = nodes.find(item => item.id === 'prompt-source');
            const first = runPromptLLMNode(source.id).then(result => {
                window.__promptRunResolved[0] = true;
                return result;
            });
            source.llmInstruction = '第二版提示词';
            source.llmProvider = 'anthropic';
            source.llmModel = 'claude-sonnet-4';
            const second = runPromptLLMNode(source.id).then(result => {
                window.__promptRunResolved[1] = true;
                return result;
            });
            window.__promptRunPromises = [first, second];
        });
        await page.waitForFunction(() => (
            window.__promptRunRequests?.length === 2
            && window.__promptRunSettlers?.length === 2
        ));

        const concurrentState = await page.evaluate(() => {
            const source = nodes.find(item => item.id === 'prompt-source');
            const outputIds = (canvas.connections || [])
                .filter(connection => connection.from === source.id)
                .map(connection => connection.to);
            return {
                requests:window.__promptRunRequests.map(request => ({
                    message:request.message,
                    provider:request.provider,
                    model:request.model,
                    nodeId:request.node_id,
                    operationId:request.generation_operation_id,
                })),
                outputIds,
                distinctOutputs:new Set(outputIds).size,
                running:source.running,
                runButtonDisabled:document.querySelector(
                    '.image-node[data-id="prompt-source"] .prompt-node-run'
                )?.disabled,
            };
        });
        assert.deepEqual(
            concurrentState.requests.map(({message, provider, model}) => ({message, provider, model})),
            [
                {message:'第一版提示词', provider:'openai', model:'gpt-4o-mini'},
                {message:'第二版提示词', provider:'anthropic', model:'claude-sonnet-4'},
            ]
        );
        assert.equal(concurrentState.outputIds.length, 2);
        assert.equal(concurrentState.distinctOutputs, 2);
        assert.deepEqual(
            concurrentState.requests.map(request => request.nodeId),
            concurrentState.outputIds
        );
        assert.notEqual(
            concurrentState.requests[0].operationId,
            concurrentState.requests[1].operationId
        );
        assert.equal(concurrentState.running, true);
        assert.equal(concurrentState.runButtonDisabled, false);

        await page.evaluate(() => {
            const pending = window.__promptRunSettlers[0];
            pending.node.text = '第一项输出';
            delete pending.node.textGenerationPending;
            pending.resolve();
        });
        await page.waitForFunction(() => window.__promptRunResolved?.[0] === true);
        const afterFirst = await page.evaluate(() => ({
            running:nodes.find(item => item.id === 'prompt-source')?.running,
            secondPending:window.__promptRunResolved?.[1] === false,
            runButtonDisabled:document.querySelector(
                '.image-node[data-id="prompt-source"] .prompt-node-run'
            )?.disabled,
        }));
        assert.deepEqual(afterFirst, {running:true, secondPending:true, runButtonDisabled:false});

        await page.evaluate(async () => {
            const pending = window.__promptRunSettlers[1];
            pending.node.text = '第二项输出';
            delete pending.node.textGenerationPending;
            pending.resolve();
            await Promise.all(window.__promptRunPromises);
        });
        const afterAll = await page.evaluate(() => ({
            running:nodes.find(item => item.id === 'prompt-source')?.running,
            resolved:[...window.__promptRunResolved],
        }));
        assert.deepEqual(afterAll, {running:false, resolved:[true, true]});

        process.stdout.write(`${JSON.stringify({initialButtonState, concurrentState, afterFirst, afterAll})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
