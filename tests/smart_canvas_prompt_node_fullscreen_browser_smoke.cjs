const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({
            viewport:{width:1180, height:800},
            reducedMotion:'reduce',
        });
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
            );
            assert.notEqual(editableSource, source);
            await route.fulfill({response, body:editableSource});
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-88-fullscreen`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-icon-button')
            && window.SmartCanvasModules?.promptAuthoring
            && typeof render === 'function'
        ));
        await page.waitForFunction(() => typeof canvas !== 'undefined');
        await page.waitForTimeout(250);

        await page.evaluate(() => {
            const editor = document.querySelector('#promptInput');
            const token = document.createElement('span');
            token.className = 'mention-image-token';
            token.dataset.kind = 'image';
            token.dataset.name = '图片1';
            token.textContent = '图片1';
            editor.replaceChildren(
                document.createTextNode('e\u0301 👨‍👩‍👧‍👦 A'),
                token,
            );
            editor.dispatchEvent(new InputEvent('input', {
                bubbles:true, data:'A', inputType:'insertText',
            }));
        });
        await page.waitForFunction(() => (
            document.querySelector('#promptCharacterCount')?.dataset.characterCount === '5'
        ));
        assert.equal(
            await page.locator('#promptCharacterCount').innerText(),
            '5 字符',
        );

        await page.evaluate(() => {
            document.querySelector('#composer')?.classList.add('open');
            setPromptAuthoringFocused(true);
        });
        await page.waitForFunction(() => document.querySelector('#composer')?.classList.contains('focused'));
        const composerFullscreenGeometry = await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const row = document.querySelector('#composer .prompt-row');
            const editor = document.querySelector('#promptInput');
            const counter = document.querySelector('#promptCharacterCount');
            const rowRect = row.getBoundingClientRect();
            const editorRect = editor.getBoundingClientRect();
            const counterRect = counter.getBoundingClientRect();
            const editorTextRight = editorRect.right - parseFloat(getComputedStyle(editor).paddingRight);
            const counterTextRight = counterRect.right - parseFloat(getComputedStyle(counter).paddingRight);
            return {
                rowTop:Math.round(rowRect.top),
                rowBottom:Math.round(rowRect.bottom),
                rowHeight:Math.round(rowRect.height),
                editorTop:Math.round(editorRect.top),
                editorBottom:Math.round(editorRect.bottom),
                editorHeight:Math.round(editorRect.height),
                counterTop:Math.round(counterRect.top),
                counterBottom:Math.round(counterRect.bottom),
                counterHeight:Math.round(counterRect.height),
                rightAlignmentDelta:Math.abs(editorTextRight - counterTextRight),
            };
        });
        assert.deepEqual(
            {
                editorTop:composerFullscreenGeometry.editorTop,
                editorBottom:composerFullscreenGeometry.editorBottom,
                counterTop:composerFullscreenGeometry.counterTop,
                counterBottom:composerFullscreenGeometry.counterBottom,
            },
            {
                editorTop:composerFullscreenGeometry.rowTop,
                editorBottom:composerFullscreenGeometry.counterTop,
                counterTop:composerFullscreenGeometry.editorBottom,
                counterBottom:composerFullscreenGeometry.rowBottom,
            },
            `Fullscreen Composer count did not reserve the bottom row: ${JSON.stringify(composerFullscreenGeometry)}`,
        );
        assert.ok(composerFullscreenGeometry.editorHeight > 0, JSON.stringify(composerFullscreenGeometry));
        assert.equal(composerFullscreenGeometry.counterHeight, 20, JSON.stringify(composerFullscreenGeometry));
        assert.ok(composerFullscreenGeometry.rightAlignmentDelta <= .5, JSON.stringify(composerFullscreenGeometry));
        await page.evaluate(() => setPromptAuthoringFocused(false));
        await page.waitForFunction(() => !document.querySelector('#composer')?.classList.contains('focused'));

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                availableModels.text = [{
                    id:'openai|gpt-4o-mini',
                    provider_id:'openai',
                    provider_name:'OpenAI',
                    model:'gpt-4o-mini',
                    name:'GPT-4o mini'
                }];
                nodes.splice(0, nodes.length,
                    {
                        id:'issue-88-prompt', type:'smart-prompt', title:'提示词',
                        x:120, y:180, w:360, h:260, text:'原始提示词', textHtml:'原始提示词'
                    },
                    {
                        id:'issue-88-generation', type:'smart-prompt', title:'提示词生成',
                        x:600, y:180, w:360, h:260, llmEnabled:true,
                        llmInstruction:'原始生成指令', llmProvider:'openai', llmModel:'gpt-4o-mini'
                    }
                );
                canvas = {id:'issue-88-fullscreen', nodes, connections:[], logs:[]};
                selectedId = '';
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                composer.style.display = 'none';
                render();
            })();`;
            document.body.appendChild(script);
            script.remove();
        });
        await page.waitForFunction(() => (
            document.querySelector('.image-node[data-id="issue-88-prompt"] [data-prompt-character-count]')
                ?.dataset.characterCount === '5'
            && document.querySelector('.image-node[data-id="issue-88-generation"] [data-prompt-character-count]')
                ?.dataset.characterCount === '6'
        ));

        const nodeCounterAlignment = await page.evaluate(() => {
            const measure = (nodeId, editorSelector) => {
                const node = document.querySelector(`.image-node[data-id="${nodeId}"]`);
                const editor = node.querySelector(editorSelector);
                const counter = node.querySelector('[data-prompt-character-count]');
                const editorRect = editor.getBoundingClientRect();
                const counterRect = counter.getBoundingClientRect();
                return {
                    editorTextRight:editorRect.right - parseFloat(getComputedStyle(editor).paddingRight),
                    counterTextRight:counterRect.right - parseFloat(getComputedStyle(counter).paddingRight),
                };
            };
            return {
                prompt:measure('issue-88-prompt', '.prompt-node-text'),
                generation:measure('issue-88-generation', '.prompt-llm-instruction'),
            };
        });
        Object.entries(nodeCounterAlignment).forEach(([kind, alignment]) => {
            assert.ok(
                Math.abs(alignment.editorTextRight - alignment.counterTextRight) <= .5,
                `${kind} counter is not aligned to the editor text edge: ${JSON.stringify(alignment)}`,
            );
        });

        assert.equal(await page.locator('#world .prompt-node-focus-toggle').count(), 0);
        const selectPromptNode = async nodeId => {
            const node = page.locator(`.image-node[data-id="${nodeId}"]`);
            await node.scrollIntoViewIfNeeded();
            await node.click({position:{x:8,y:8}});
            const action = page.locator(
                `#smartNodeFloatingPortal [data-smart-node-action="focus-editor"][data-node-id="${nodeId}"]`
            );
            await action.waitFor({state:'visible'});
            return action;
        };
        const promptExpandAction = await selectPromptNode('issue-88-prompt');
        assert.equal(await promptExpandAction.getAttribute('size'), 'xs');
        assert.equal(await promptExpandAction.getAttribute('hierarchy'), 'quiet');
        assert.equal(await promptExpandAction.locator('ic-icon').getAttribute('name'), 'focus-editor');
        assert.equal(await promptExpandAction.evaluate(control => Boolean(control.closest('#smartNodeFloatingPortal'))), true);

        await promptExpandAction.click();
        await page.waitForFunction(() => {
            const surface = document.getElementById('promptNodeFocusSurface');
            const editor = surface?.querySelector('.prompt-node-text');
            return surface?.hasAttribute('open') && editor?.isContentEditable
                && document.activeElement === editor;
        });
        const promptModalState = await page.locator('#promptNodeFocusSurface').evaluate(surface => {
            const dialog = surface.shadowRoot.querySelector('[part="surface"]');
            const backdrop = surface.shadowRoot.querySelector('[part="backdrop"]');
            const rect = dialog.getBoundingClientRect();
            return {
                tag:surface.localName,
                open:surface.hasAttribute('open'),
                contract:surface.dataset.icContractStatus,
                backdropVisible:getComputedStyle(backdrop).display !== 'none',
                sharedBackdrop:document.getElementById('composerFocusBackdrop').classList.contains('open'),
                modal:dialog?.getAttribute('aria-modal'),
                width:Math.round(rect.width),
                height:Math.round(rect.height),
                collapseButtons:surface.querySelectorAll('.prompt-node-focus-toggle').length,
            };
        });
        assert.deepEqual(promptModalState, {
            tag:'ic-prompt-node-focus-surface', open:true, contract:'ready', backdropVisible:true,
            sharedBackdrop:false, modal:'true', width:850, height:660, collapseButtons:0,
        });
        assert.equal(await page.locator('#promptNodeFocusSurface .node-head').count(), 0);
        await page.locator('#promptNodeFocusSurface .prompt-node-text').evaluate(editor => {
            editor.textContent = '全屏编辑后的提示词';
            editor.dispatchEvent(new InputEvent('input', {
                bubbles:true, data:'词', inputType:'insertText',
            }));
        });
        await page.waitForFunction(() => (
            document.querySelector('#promptNodeFocusSurface [data-prompt-character-count]')
                ?.dataset.characterCount === '9'
        ));
        await page.locator('#promptNodeFocusSurface').evaluate(surface => {
            surface.shadowRoot.querySelector('[part="backdrop"]').click();
        });
        await page.waitForFunction(() => !document.getElementById('promptNodeFocusSurface')?.hasAttribute('open'));
        assert.deepEqual(await page.evaluate(() => ({
            stored:nodes.find(node => node.id === 'issue-88-prompt')?.text,
            visible:document.querySelector('.image-node[data-id="issue-88-prompt"] .prompt-node-text')?.textContent,
            backdrop:document.getElementById('composerFocusBackdrop').classList.contains('open'),
        })), {
            stored:'全屏编辑后的提示词', visible:'全屏编辑后的提示词', backdrop:false,
        });

        const generationExpandAction = await selectPromptNode('issue-88-generation');
        assert.equal(await generationExpandAction.locator('ic-icon').getAttribute('name'), 'focus-editor');
        await generationExpandAction.getByRole('button').press('Enter');
        const instruction = page.locator('#promptNodeFocusSurface .prompt-llm-instruction');
        await page.waitForFunction(() => {
            const editor = document.querySelector('#promptNodeFocusSurface .prompt-llm-instruction');
            return editor?.isContentEditable && document.activeElement === editor;
        });
        await instruction.fill('全屏编辑后的生成指令');
        await page.waitForFunction(() => (
            document.querySelector('#promptNodeFocusSurface [data-prompt-character-count]')
                ?.dataset.characterCount === '10'
        ));
        await instruction.press('Escape');
        await page.waitForFunction(() => !document.getElementById('promptNodeFocusSurface')?.hasAttribute('open'));
        assert.deepEqual(await page.evaluate(() => ({
            stored:nodes.find(node => node.id === 'issue-88-generation')?.llmInstruction,
            visible:document.querySelector('.image-node[data-id="issue-88-generation"] .prompt-llm-instruction')?.textContent,
            backdrop:document.getElementById('composerFocusBackdrop').classList.contains('open'),
        })), {
            stored:'全屏编辑后的生成指令',
            visible:'全屏编辑后的生成指令',
            backdrop:false,
        });

        process.stdout.write('Issue #88 prompt node fullscreen browser smoke passed.\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
