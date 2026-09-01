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
            if (response.ok()) {
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
            );
            assert.notEqual(editableSource, source);
            await route.fulfill({response, body:editableSource});
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=prompt-node-composer-run-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-icon-button')
            && window.SmartCanvasModules?.generationRun
            && document.getElementById('world')
        ));
        await page.waitForFunction(() => typeof canvas !== 'undefined'
            && canvas?.id === 'prompt-node-composer-run-regression');

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
                const makeNode = (id, x, running) => ({
                    id,
                    type:'smart-prompt',
                    title:'提示词生成',
                    x,
                    y:300,
                    w:360,
                    h:260,
                    llmEnabled:true,
                    llmInstruction:'根据引用内容生成一段结构化提示词',
                    llmProvider:'openai',
                    llmModel:'gpt-4o-mini',
                    llmInputMedia:running ? [] : [
                        {url:pixel + '#reference-one', name:'Reference One', kind:'image'},
                        {url:pixel + '#reference-two', name:'Reference Two', kind:'image'}
                    ],
                    running
                });
                availableModels.text = [
                    {
                        id:'openai|gpt-4o-mini',
                        provider_id:'openai',
                        provider_name:'OpenAI',
                        model:'gpt-4o-mini',
                        name:'GPT-4o mini'
                    },
                    {
                        id:'anthropic|claude-sonnet-4',
                        provider_id:'anthropic',
                        provider_name:'Anthropic',
                        model:'claude-sonnet-4',
                        name:'Claude Sonnet 4'
                    }
                ];
                nodes.splice(0, nodes.length,
                    makeNode('prompt-run-ready', 100, false),
                    makeNode('prompt-run-disabled', 560, true),
                    {
                        ...makeNode('prompt-generating', 1020, true),
                        textGenerationOutput:true,
                        textGenerationPending:true,
                    }
                );
                canvas = {id:'prompt-node-composer-run-regression', nodes, connections:[], logs:[]};
                selectedId = '';
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                composer.style.display = 'none';
                window.__promptNodeRunCalls = [];
                runPromptLLMNode = async nodeId => { window.__promptNodeRunCalls.push(nodeId); };
                render();
            })();`;
            document.body.appendChild(script);
            script.remove();
        });

        const buttons = page.locator('.image-node ic-icon-button.prompt-node-run');
        await page.waitForFunction(() => {
            const controls = [...document.querySelectorAll('.image-node ic-icon-button.prompt-node-run')];
            return controls.length === 2 && controls.every(control => control.dataset.icContractStatus === 'ready');
        });
        const productStates = await buttons.evaluateAll(controls => controls.map(control => ({
            size:control.getAttribute('size'),
            hierarchy:control.getAttribute('hierarchy'),
            background:control.getAttribute('background'),
            icon:control.getAttribute('icon'),
            label:control.getAttribute('label'),
            disabled:control.disabled,
            loading:control.loading,
            classes:[...control.classList],
            actionCombination:control.dataset.actionCombination,
            contract:control.dataset.icContractStatus,
            shadowDisabled:control.shadowRoot.querySelector('button')?.disabled,
        })));
        assert.deepEqual(productStates, [
            {
                size:'large', hierarchy:'primary', background:'auto', icon:'submit', label:'运行',
                disabled:false, loading:false,
                classes:['prompt-node-run', 'prompt-node-control', 'run-btn'],
                actionCombination:'primary-icon-action', contract:'ready', shadowDisabled:false,
            },
            {
                size:'large', hierarchy:'primary', background:'auto', icon:'submit', label:'运行',
                disabled:false, loading:false,
                classes:['prompt-node-run', 'prompt-node-control', 'run-btn'],
                actionCombination:'primary-icon-action', contract:'ready', shadowDisabled:false,
            },
        ]);

        const composerContract = await page.locator('#runBtn').evaluate(control => ({
            size:control.getAttribute('size'),
            hierarchy:control.getAttribute('hierarchy'),
            background:control.getAttribute('background'),
            icon:control.getAttribute('icon'),
            label:control.getAttribute('label'),
            actionCombination:control.dataset.actionCombination,
            classes:[...control.classList],
        }));
        assert.deepEqual(composerContract, {
            size:'large', hierarchy:'primary', background:'auto', icon:'submit', label:'运行',
            actionCombination:'primary-icon-action', classes:['run-btn'],
        });

        const modelSelectors = page.locator('.image-node ic-select.prompt-llm-model');
        await page.waitForFunction(() => {
            const controls = [...document.querySelectorAll('.image-node ic-select.prompt-llm-model')];
            return controls.length === 2 && controls.every(control => control.dataset.icContractStatus === 'ready');
        });
        const modelSelectorState = await modelSelectors.first().evaluate(control => ({
            tag:control.localName,
            hierarchy:control.getAttribute('hierarchy'),
            placement:control.getAttribute('placement'),
            variant:control.dataset.componentVariant,
            legalCombination:control.dataset.legalCombination,
            optionLabels:[...control.querySelectorAll(':scope > option')].map(option => option.textContent.trim()),
            optionValues:[...control.querySelectorAll(':scope > option')].map(option => option.value),
            providerTagCount:control.closest('.prompt-composer-footer').querySelectorAll('.model-platform-tag').length,
            visibleText:control.textContent.replace(/\s+/g, ' ').trim(),
            contract:control.dataset.icContractStatus,
        }));
        const {visibleText, ...modelSelectorContract} = modelSelectorState;
        assert.deepEqual(modelSelectorContract, {
            tag:'ic-select',
            hierarchy:'quiet',
            placement:'top',
            variant:'model-picker',
            legalCombination:'model-picker-vertical-manual-label',
            optionLabels:['GPT-4o mini', 'Claude Sonnet 4'],
            optionValues:['openai|gpt-4o-mini', 'anthropic|claude-sonnet-4'],
            providerTagCount:0,
            contract:'ready',
        });
        assert.equal(visibleText.includes('GPT-4o mini'), true);
        assert.equal(visibleText.includes('Claude Sonnet 4'), true);
        assert.equal(visibleText.includes('OpenAI'), false);
        assert.equal(visibleText.includes('Anthropic'), false);
        assert.equal(visibleText.includes('openai|gpt-4o-mini'), false);
        assert.equal(visibleText.includes('anthropic|claude-sonnet-4'), false);

        await modelSelectors.first().evaluate(select => { void select.show(); });
        await modelSelectors.first().locator('wa-option').nth(1).click();
        await page.waitForFunction(() => {
            const node = nodes.find(item => item.id === 'prompt-run-ready');
            return node?.llmProvider === 'anthropic' && node?.llmModel === 'claude-sonnet-4';
        });
        const selectedModelState = await page.locator('.image-node[data-id="prompt-run-ready"] ic-select.prompt-llm-model').evaluate(control => ({
            value:control.value,
            open:control.open,
            selectedLabel:[...control.querySelectorAll(':scope > option')].find(option => option.selected)?.textContent.trim(),
        }));
        assert.deepEqual(selectedModelState, {
            value:'anthropic|claude-sonnet-4', open:false, selectedLabel:'Claude Sonnet 4',
        });

        const instruction = page.locator('.image-node[data-id="prompt-run-ready"] .prompt-llm-instruction');
        const initialInstructionState = await instruction.evaluate(element => ({
            editable:element.isContentEditable,
            editing:element.classList.contains('is-editing'),
            active:document.activeElement === element,
        }));
        assert.deepEqual(initialInstructionState, {editable:false, editing:false, active:false});

        await instruction.click();
        const singleClickInstructionState = await instruction.evaluate(element => ({
            editable:element.isContentEditable,
            editing:element.classList.contains('is-editing'),
            active:document.activeElement === element,
            selectedId,
        }));
        assert.deepEqual(singleClickInstructionState, {
            editable:false, editing:false, active:false, selectedId:'prompt-run-ready',
        });

        await instruction.dblclick();
        await page.waitForFunction(() => {
            const element = document.querySelector('.image-node[data-id="prompt-run-ready"] .prompt-llm-instruction');
            return element?.isContentEditable && document.activeElement === element
                && window.getSelection()?.isCollapsed;
        });
        const doubleClickInstructionState = await instruction.evaluate(element => ({
            editable:element.isContentEditable,
            editing:element.classList.contains('is-editing'),
            active:document.activeElement === element,
            collapsedSelection:window.getSelection()?.isCollapsed,
        }));
        assert.deepEqual(doubleClickInstructionState, {
            editable:true, editing:true, active:true, collapsedSelection:true,
        });

        await instruction.fill('这次编辑应被撤销');
        await instruction.press('Escape');
        const escapedInstructionState = await instruction.evaluate(element => ({
            editable:element.isContentEditable,
            editing:element.classList.contains('is-editing'),
            value:element.textContent,
            stored:nodes.find(item => item.id === 'prompt-run-ready')?.llmInstruction,
        }));
        assert.deepEqual(escapedInstructionState, {
            editable:false,
            editing:false,
            value:'根据引用内容生成一段结构化提示词',
            stored:'根据引用内容生成一段结构化提示词',
        });

        await instruction.dblclick();
        await instruction.fill('双击后提交的新提示词');
        await instruction.press('Control+Enter');
        const committedInstructionState = await instruction.evaluate(element => ({
            editable:element.isContentEditable,
            editing:element.classList.contains('is-editing'),
            value:element.textContent,
            stored:nodes.find(item => item.id === 'prompt-run-ready')?.llmInstruction,
        }));
        assert.deepEqual(committedInstructionState, {
            editable:false,
            editing:false,
            value:'双击后提交的新提示词',
            stored:'双击后提交的新提示词',
        });

        const promptThumbs = page.locator('.image-node[data-id="prompt-run-ready"] .prompt-node-input-thumbs .input-thumb');
        await page.waitForFunction(() => document.querySelectorAll('.image-node[data-id="prompt-run-ready"] .prompt-node-input-thumbs .input-thumb').length === 2);
        const thumbnailState = await promptThumbs.evaluateAll(thumbs => thumbs.map(thumb => {
            const style = getComputedStyle(thumb);
            return {
                width:style.width,
                height:style.height,
                draggable:thumb.draggable,
                label:thumb.querySelector('.input-thumb-label')?.textContent.trim(),
                removeButton:thumb.querySelectorAll('.input-thumb-remove[data-input-remove-reference]').length,
                kind:thumb.dataset.kind,
            };
        }));
        assert.deepEqual(thumbnailState, [
            {width:'45px', height:'45px', draggable:true, label:'图片1', removeButton:1, kind:'image'},
            {width:'45px', height:'45px', draggable:true, label:'图片2', removeButton:1, kind:'image'},
        ]);
        const promptPaddingState = await page.locator('.image-node[data-id="prompt-run-ready"]').evaluate(node => ({
            outer:getComputedStyle(node).padding,
            card:getComputedStyle(node.querySelector('.prompt-node-card')).padding,
        }));
        assert.deepEqual(promptPaddingState, {outer:'0px', card:'12px'});
        const generatingFillState = await page.locator('.image-node[data-id="prompt-generating"]').evaluate(node => {
            const card = node.querySelector('.prompt-text-generation-card');
            const pending = card.querySelector('ic-generation-pending');
            const cardRect = card.getBoundingClientRect();
            const pendingRect = pending.getBoundingClientRect();
            return {
                padding:getComputedStyle(card).padding,
                gap:getComputedStyle(card).gap,
                widthDelta:Math.abs(cardRect.width - pendingRect.width),
                heightDelta:Math.abs(cardRect.height - pendingRect.height),
            };
        });
        assert.deepEqual(generatingFillState, {
            padding:'0px', gap:'0px', widthDelta:0, heightDelta:0,
        });

        const thumbsRow = page.locator('.image-node[data-id="prompt-run-ready"] .prompt-node-input-thumbs');
        const thumbsRowBox = await thumbsRow.boundingBox();
        assert.ok(thumbsRowBox);
        const dragStartX = thumbsRowBox.x + thumbsRowBox.width - 10;
        const dragStartY = thumbsRowBox.y + thumbsRowBox.height / 2;
        await page.mouse.move(
            dragStartX,
            dragStartY
        );
        await page.mouse.down();
        await page.mouse.move(
            thumbsRowBox.x + thumbsRowBox.width + 30,
            thumbsRowBox.y + thumbsRowBox.height / 2 + 25
        );
        await page.mouse.up();
        const draggedNodePosition = await page.evaluate(() => {
            const node = nodes.find(item => item.id === 'prompt-run-ready');
            return {x:node?.x, y:node?.y};
        });
        assert.deepEqual(draggedNodePosition, {x:140, y:325});

        await promptThumbs.first().click();
        await page.waitForFunction(() => document.getElementById('referenceViewerBackdrop')?.hidden === false);
        const previewState = await page.locator('#referenceViewerContent').evaluate(content => ({
            imageCount:content.querySelectorAll('.reference-image-stage img').length,
            zoomControls:content.querySelectorAll('[data-reference-zoom-out],[data-reference-zoom-reset],[data-reference-zoom-in]').length,
        }));
        assert.deepEqual(previewState, {imageCount:1, zoomControls:3});
        await page.evaluate(() => closeReferenceViewer());

        await promptThumbs.first().locator('.input-thumb-remove').click({force:true});
        await page.waitForFunction(() => document.querySelectorAll('.image-node[data-id="prompt-run-ready"] .prompt-node-input-thumbs .input-thumb').length === 1);
        const removalState = await page.evaluate(() => {
            const node = nodes.find(item => item.id === 'prompt-run-ready');
            return {
                blockedCount:Array.isArray(node?.blockedInputRefs) ? node.blockedInputRefs.length : 0,
                visibleCount:promptNodeInputImages(node).length,
            };
        });
        assert.deepEqual(removalState, {blockedCount:1, visibleCount:1});

        await buttons.first().hover();
        await page.waitForFunction(() => document.querySelector('body > ic-tooltip[open]')?.getAttribute('content') === '运行');
        await page.mouse.move(10, 10);
        await page.waitForFunction(() => !document.querySelector('body > ic-tooltip[open]'));
        await buttons.nth(1).hover();
        await page.waitForFunction(() => document.querySelector('body > ic-tooltip[open]')?.getAttribute('content') === '运行');
        await page.mouse.move(10, 10);
        await page.waitForFunction(() => !document.querySelector('body > ic-tooltip[open]'));

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await buttons.first().evaluate(async (control, activeTheme) => {
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                await new Promise(resolve => setTimeout(resolve, 100));
                const base = control.shadowRoot.querySelector('[part="base"]');
                const icon = control.querySelector('ic-icon');
                const svg = icon.shadowRoot.querySelector('svg');
                return {
                    height:getComputedStyle(base).height,
                    color:getComputedStyle(base).color,
                    iconColor:getComputedStyle(icon).color,
                    background:getComputedStyle(base).backgroundColor,
                    strokeWidth:getComputedStyle(svg).strokeWidth,
                };
            }, theme);
        }
        for (const theme of ['light', 'dark']) {
            assert.equal(themeStyles[theme].height, '32px');
            assert.equal(themeStyles[theme].color, themeStyles[theme].iconColor);
            assert.equal(themeStyles[theme].strokeWidth, '1.5px');
            assert.notEqual(themeStyles[theme].background, 'rgba(0, 0, 0, 0)');
        }

        await buttons.first().locator('button').click();
        await page.waitForFunction(() => window.__promptNodeRunCalls.length === 1);
        await buttons.nth(1).locator('button').click();
        await page.waitForFunction(() => window.__promptNodeRunCalls.length === 2);
        assert.deepEqual(await page.evaluate(() => window.__promptNodeRunCalls), [
            'prompt-run-ready',
            'prompt-run-disabled',
        ]);

        const composerPage = await context.newPage();
        await composerPage.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/composer.html`, {
            waitUntil:'domcontentloaded',
        });
        await composerPage.waitForFunction(() => document.querySelector('#runBtn')?.dataset.icContractStatus === 'ready');
        await composerPage.waitForFunction(() => document.querySelector('ic-select[data-component-variant="model-picker"]')?.dataset.icContractStatus === 'ready');
        const libraryRunButton = await composerPage.locator('#runBtn').evaluate(control => ({
            size:control.getAttribute('size'),
            hierarchy:control.getAttribute('hierarchy'),
            background:control.getAttribute('background'),
            icon:control.getAttribute('icon'),
            label:control.getAttribute('label'),
            contract:control.dataset.icContractStatus,
        }));
        assert.deepEqual(libraryRunButton, {
            size:'large', hierarchy:'primary', background:'auto', icon:'submit', label:'运行', contract:'ready',
        });
        const libraryModelSelector = await composerPage.locator('ic-select[data-component-variant="model-picker"]').first().evaluate(control => ({
            tag:control.localName,
            hierarchy:control.getAttribute('hierarchy'),
            placement:control.getAttribute('placement'),
            variant:control.dataset.componentVariant,
            legalCombination:control.dataset.legalCombination,
            contract:control.dataset.icContractStatus,
        }));
        assert.deepEqual(libraryModelSelector, {
            tag:'ic-select', hierarchy:'quiet', placement:'top', variant:'model-picker',
            legalCombination:'model-picker-vertical-manual-label', contract:'ready',
        });

        process.stdout.write(`${JSON.stringify({productStates, composerContract, modelSelectorState, selectedModelState, initialInstructionState, singleClickInstructionState, doubleClickInstructionState, escapedInstructionState, committedInstructionState, thumbnailState, previewState, removalState, themeStyles, libraryRunButton, libraryModelSelector})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
