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
            if(response.ok()) return route.fulfill({response});
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
                'function canvasPersistenceEditable(){ return true; }',
            );
            assert.notEqual(editableSource, source);
            await route.fulfill({response, body:editableSource});
        });

        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=model-listbox-wheel-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-select')
            && window.SmartCanvasModules?.viewportSelection
            && document.getElementById('world')
        ));
        await page.waitForFunction(() => typeof canvas !== 'undefined'
            && canvas?.id === 'model-listbox-wheel-regression');

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                availableModels.text = Array.from({length:26}, (_, index) => ({
                    id:'fixture|text-model-' + String(index + 1),
                    provider_id:'fixture',
                    provider_name:'Fixture',
                    model:'text-model-' + String(index + 1),
                    name:'Text Model ' + String(index + 1)
                }));
                nodes.splice(0, nodes.length, {
                    id:'prompt-generation-wheel',
                    type:'smart-prompt',
                    title:'提示词生成',
                    x:100,
                    y:420,
                    w:360,
                    h:260,
                    llmEnabled:true,
                    llmInstruction:'根据引用内容生成一段结构化提示词',
                    llmProvider:'fixture',
                    llmModel:'text-model-1',
                    llmInputMedia:[]
                });
                canvas = {id:'model-listbox-wheel-regression', nodes, connections:[], logs:[]};
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

        const modelSelect = page.locator(
            '.image-node[data-id="prompt-generation-wheel"] ic-select.prompt-llm-model',
        );
        await page.waitForFunction(() => {
            const select = document.querySelector(
                '.image-node[data-id="prompt-generation-wheel"] ic-select.prompt-llm-model',
            );
            return select?.dataset.icContractStatus === 'ready'
                && select.querySelectorAll(':scope > option').length === 26;
        });
        await modelSelect.evaluate(select => { void select.show(); });
        await page.waitForFunction(() => {
            const select = document.querySelector(
                '.image-node[data-id="prompt-generation-wheel"] ic-select.prompt-llm-model',
            );
            const listbox = select?.shadowRoot?.querySelector('[part~="listbox"]');
            return Boolean(select?.open && listbox && listbox.scrollHeight > listbox.clientHeight + 1);
        });

        const listbox = modelSelect.locator('[part~="listbox"]');
        const listboxBox = await listbox.boundingBox();
        assert.ok(listboxBox, 'Prompt Generation Node model listbox should be measurable');
        const readState = () => page.evaluate(() => {
            const select = document.querySelector(
                '.image-node[data-id="prompt-generation-wheel"] ic-select.prompt-llm-model',
            );
            const surface = select.shadowRoot.querySelector('[part~="listbox"]');
            return {
                viewport:{x:viewport.x, y:viewport.y, scale:viewport.scale},
                scrollTop:surface.scrollTop,
                maxScrollTop:surface.scrollHeight - surface.clientHeight,
            };
        });

        await page.mouse.move(
            listboxBox.x + listboxBox.width / 2,
            listboxBox.y + listboxBox.height / 2,
        );
        const before = await readState();
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(50);
        const after = await readState();
        assert.deepEqual(
            after.viewport,
            before.viewport,
            `Model listbox wheel leaked into Canvas viewport: ${JSON.stringify({before, after})}`,
        );
        assert.ok(
            after.scrollTop > before.scrollTop,
            `Model listbox did not consume its own wheel scroll: ${JSON.stringify({before, after})}`,
        );

        for(let index = 0; index < 4; index += 1) {
            await page.mouse.wheel(0, 5000);
            await page.waitForTimeout(30);
        }
        const boundaryBefore = await readState();
        assert.equal(boundaryBefore.scrollTop, boundaryBefore.maxScrollTop);
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(50);
        const boundaryAfter = await readState();
        assert.deepEqual(
            boundaryAfter.viewport,
            boundaryBefore.viewport,
            `Model listbox boundary wheel leaked into Canvas viewport: ${JSON.stringify({boundaryBefore, boundaryAfter})}`,
        );
        assert.equal(
            boundaryAfter.scrollTop,
            boundaryBefore.scrollTop,
            `Model listbox should remain at its boundary: ${JSON.stringify({boundaryBefore, boundaryAfter})}`,
        );

        await modelSelect.evaluate(select => { void select.hide(); });
        await modelSelect.evaluate(async select => {
            [...select.querySelectorAll(':scope > option')].slice(2).forEach(option => option.remove());
            select.syncOptions();
            await select.updateComplete;
        });
        await page.waitForFunction(() => document.querySelector(
            '.image-node[data-id="prompt-generation-wheel"] ic-select.prompt-llm-model',
        )?.querySelectorAll(':scope > option').length === 2);
        await modelSelect.evaluate(select => { void select.show(); });
        await page.waitForFunction(() => {
            const select = document.querySelector(
                '.image-node[data-id="prompt-generation-wheel"] ic-select.prompt-llm-model',
            );
            const surface = select?.shadowRoot?.querySelector('[part~="listbox"]');
            return Boolean(select?.open && surface && surface.scrollHeight <= surface.clientHeight + 1);
        });
        const shortBefore = await readState();
        await modelSelect.locator('[part~="listbox"]').evaluate(surface => {
            surface.dispatchEvent(new WheelEvent('wheel', {
                bubbles:true,
                composed:true,
                cancelable:true,
                deltaY:240,
            }));
        });
        const shortAfter = await readState();
        assert.deepEqual(
            shortAfter.viewport,
            shortBefore.viewport,
            `Short model listbox wheel leaked into Canvas viewport: ${JSON.stringify({shortBefore, shortAfter})}`,
        );
        assert.equal(shortAfter.scrollTop, 0);

        process.stdout.write(`${JSON.stringify({
            before,
            after,
            boundaryBefore,
            boundaryAfter,
            shortBefore,
            shortAfter,
        })}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
