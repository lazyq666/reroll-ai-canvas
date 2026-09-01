const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const headless = process.env.SMART_CANVAS_HEADLESS !== '0';

(async () => {
    const browser = await chromium.launch({headless, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:1000}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=loop-node-controls-regression&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-button')
            && customElements.get('ic-icon-button')
            && customElements.get('ic-number-input')
            && customElements.get('ic-popover')
            && customElements.get('ic-prompt-composer')
            && customElements.get('ic-segmented-control')
            && document.getElementById('world')
            && window.SmartCanvasModules?.canvasPersistence?.status?.().state === 'ready'
        ));

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const loop = {
                    id:'loop-target', type:'smart-loop', title:'Loop',
                    x:420, y:160, mode:'serial', count:3, loopStart:2,
                    imageBatchSize:4, imageInput:true, showPrompt:true,
                    variablePrompts:['Frame']
                };
                const source = {
                    id:'loop-source', type:'smart-image', title:'Reference images',
                    x:40, y:160, w:240, h:180,
                    images:[
                        {url:'/static/images/logo.png',name:'reference-a.png',kind:'image'},
                        {url:'/static/images/test/fixture.svg',name:'reference-b.svg',kind:'image'}
                    ]
                };
                fitSmartLoopNode(loop);
                nodes.splice(0, nodes.length, source, loop);
                canvas = {id:'loop-node-controls-regression', nodes, connections:[{from:'loop-source',to:'loop-target',kind:'input'}], logs:[]};
                selectedId = '';
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                composer.style.display = 'none';
                render();
            })();`;
            document.body.appendChild(script);
            script.remove();
        });

        const node = page.locator('.image-node[data-id="loop-target"]');
        await page.waitForFunction(() => {
            const root = document.querySelector('.image-node[data-id="loop-target"]');
            if (!root) return false;
            return [...root.querySelectorAll('ic-button,ic-icon-button,ic-number-input,ic-popover,ic-prompt-composer,ic-segmented-control')]
                .every(control => ['ready', 'valid'].includes(control.dataset.icContractStatus));
        });

        const initialState = await node.evaluate(root => ({
            semantics:{
                title:root.querySelector('.loop-smart-title')?.textContent.trim(),
                subtitle:root.querySelector('.loop-smart-subtitle')?.textContent.trim(),
                sections:[...root.querySelectorAll('.loop-smart-section-label')].map(item => item.textContent.trim()),
                variableLabels:[...root.querySelectorAll('.loop-smart-variable-row .loop-smart-toggle')].map(item => item.textContent.trim()),
                optionCounts:[...root.querySelectorAll('.loop-smart-option-count')].map(item => item.textContent.trim()),
                pairing:root.querySelector('.loop-smart-combination-note')?.textContent.trim(),
                executionMode:root.querySelector('.loop-smart-setting-label')?.textContent.trim(),
                numberLabels:[...root.querySelectorAll('.loop-smart-setting-grid .loop-number-trigger span')].map(item => item.textContent.trim()),
                summary:root.querySelector('.loop-smart-run-summary')?.textContent.trim(),
                prohibited:[...root.querySelectorAll('[data-preview],.batch-task-preview,.batch-output-estimate')].length,
                allCombinations:root.textContent.includes('全部组合'),
            },
            segmented:{
                tag:root.querySelector('.loop-smart-seg')?.localName,
                value:root.querySelector('.loop-smart-seg')?.getAttribute('value'),
                contract:root.querySelector('.loop-smart-seg')?.dataset.icContractStatus,
                selected:[...root.querySelectorAll('.loop-smart-seg > button')].find(button => button.getAttribute('aria-checked') === 'true')?.dataset.value,
            },
            toggles:[...root.querySelectorAll('ic-button.loop-smart-toggle')].map(button => ({
                key:button.dataset.loopToggle,
                toggle:button.toggle,
                pressed:button.pressed,
                contract:button.dataset.icContractStatus,
            })),
            numberControls:[...root.querySelectorAll('ic-number-input.loop-number-input')].map(input => ({
                key:input.dataset.loopNumberInput,
                name:input.name,
                value:input.value,
                contract:input.dataset.icContractStatus,
            })),
            promptComposer:{
                tag:root.querySelector('.loop-smart-text')?.localName,
                role:root.querySelector('.loop-smart-text')?.getAttribute('role'),
                contract:root.querySelector('.loop-smart-text')?.dataset.icContractStatus,
            },
            promptActions:[...root.querySelectorAll('.loop-smart-icon-btn,.loop-smart-add-prompt')].map(button => ({
                tag:button.localName, icon:button.icon, contract:button.dataset.icContractStatus,
            })),
            run:{
                tag:root.querySelector('.loop-smart-run')?.localName,
                hierarchy:root.querySelector('.loop-smart-run')?.hierarchy,
                contract:root.querySelector('.loop-smart-run')?.dataset.icContractStatus,
                text:root.querySelector('.loop-smart-run')?.textContent.trim(),
            },
            nativeControls:[...root.querySelectorAll('button,input,textarea,select')].map(control => ({
                tag:control.localName,
                segmented:Boolean(control.closest('ic-segmented-control')),
            })),
        }));
        assert.deepEqual(initialState.semantics, {
            title:'批量运行',
            subtitle:'按顺序替换输入并运行下游流程',
            sections:['变量','执行'],
            variableLabels:['参考图变量','提示词变量'],
            optionCounts:['2 个选项','1 个选项'],
            pairing:'按顺序配对，较短列表从头重复',
            executionMode:'执行方式',
            numberLabels:['每任务图片数','任务序号','任务数量'],
            summary:'将运行 3 个任务',
            prohibited:0,
            allCombinations:false,
        });
        assert.deepEqual(initialState.segmented, {
            tag:'ic-segmented-control', value:'serial', contract:'ready', selected:'serial',
        });
        assert.deepEqual(initialState.toggles, [
            {key:'image', toggle:true, pressed:true, contract:'ready'},
            {key:'prompt', toggle:true, pressed:true, contract:'ready'},
        ]);
        assert.deepEqual(initialState.numberControls, [
            {key:'imageBatchSize', name:'loop-imageBatchSize-loop-target', value:'4', contract:'ready'},
            {key:'loopStart', name:'loop-loopStart-loop-target', value:'2', contract:'ready'},
            {key:'count', name:'loop-count-loop-target', value:'3', contract:'ready'},
        ]);
        assert.deepEqual(initialState.promptComposer, {
            tag:'ic-prompt-composer', role:'textbox', contract:'ready',
        });
        assert.deepEqual(initialState.promptActions, [
            {tag:'ic-icon-button', icon:'delete', contract:'ready'},
            {tag:'ic-icon-button', icon:'add', contract:'ready'},
        ]);
        assert.deepEqual(initialState.run, {
            tag:'ic-button', hierarchy:'primary', contract:'ready', text:'运行 3 个任务',
        });
        assert.equal(initialState.nativeControls.length, 2);
        assert.equal(initialState.nativeControls.every(control => control.tag === 'button' && control.segmented), true);
        assert.deepEqual(
            await page.evaluate(() => smartLoopInputImages(
                nodes.find(item => item.id === 'loop-target'),
                {index:4}
            ).map(item => item.name)),
            ['reference-b.png','reference-a.png','reference-b.png','reference-a.png']
        );

        await node.locator('[data-loop-toggle="image"]').click();
        await node.locator('[data-loop-toggle="prompt"]').click();
        await page.waitForFunction(() => {
            const loop = nodes.find(item => item.id === 'loop-target');
            return loop?.imageInput === false && loop?.showPrompt === false;
        });
        const collapsedLayout = await node.evaluate(root => {
            const body = root.querySelector(':scope > .node-body');
            const card = root.querySelector('.loop-smart-card');
            return {
                hostHeight:root.getBoundingClientRect().height,
                bodyClientHeight:body.clientHeight,
                bodyScrollHeight:body.scrollHeight,
                cardClientHeight:card.clientHeight,
                cardScrollHeight:card.scrollHeight,
            };
        });
        assert.ok(collapsedLayout.bodyScrollHeight <= collapsedLayout.bodyClientHeight + 1, JSON.stringify(collapsedLayout));
        assert.ok(collapsedLayout.cardScrollHeight <= collapsedLayout.cardClientHeight + 1, JSON.stringify(collapsedLayout));
        await node.locator('[data-loop-toggle="image"]').click();
        await node.locator('[data-loop-toggle="prompt"]').click();
        await page.waitForFunction(() => {
            const loop = nodes.find(item => item.id === 'loop-target');
            return loop?.imageInput === true && loop?.showPrompt === true;
        });

        await node.locator('.loop-smart-seg > button[data-value="parallel"]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.mode === 'parallel');
        assert.equal(await node.locator('.loop-smart-seg').getAttribute('value'), 'parallel');

        await node.locator('[data-loop-toggle="image"]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.imageInput === false);
        assert.equal(await node.locator('.loop-smart-panel:not(.prompt-panel)').count(), 0);
        await node.locator('[data-loop-toggle="image"]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.imageInput === true);

        const imageBatchControl = node.locator('.loop-number-control:has([data-loop-number-input="imageBatchSize"])');
        const loopStartControl = node.locator('.loop-number-control:has([data-loop-number-input="loopStart"])');
        await imageBatchControl.locator('.loop-number-trigger').click();
        await imageBatchControl.locator('ic-number-input input').fill('2');
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.imageBatchSize === 2);
        await loopStartControl.locator('.loop-number-trigger').click();
        await loopStartControl.locator('ic-popover[open]').waitFor({state:'attached', timeout:2000});

        const countControl = node.locator('.loop-number-control:has([data-loop-number-input="count"])');
        await countControl.locator('.loop-number-trigger').hover();
        await page.waitForFunction(() => document.querySelector('.image-node[data-id="loop-target"] [data-loop-number-input="count"]')?.closest('ic-popover')?.hasAttribute('open'));
        await countControl.locator('ic-popover').locator('[part="surface"]').hover();
        assert.equal(await countControl.locator('ic-popover').getAttribute('open'), '');
        const openPopoverState = await countControl.locator('ic-popover').evaluate(popover => ({
            open:popover.hasAttribute('open'),
            contract:popover.dataset.icContractStatus,
            surfaceBackground:getComputedStyle(popover.shadowRoot.querySelector('[part="surface"]')).backgroundColor,
        }));
        assert.equal(openPopoverState.open, true);
        assert.equal(openPopoverState.contract, 'ready');
        assert.notEqual(openPopoverState.surfaceBackground, 'rgba(0, 0, 0, 0)');
        await countControl.locator('[data-loop-value="5"]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.count === 5);

        const updatedCountControl = node.locator('.loop-number-control:has([data-loop-number-input="count"])');
        await updatedCountControl.locator('.loop-number-trigger').click();
        await updatedCountControl.locator('ic-number-input input').fill('7');
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.count === 7);
        assert.equal(await updatedCountControl.locator('.loop-number-trigger strong').textContent(), '7');
        assert.equal(await node.locator('.loop-smart-run-summary').textContent(), '将运行 7 个任务');
        assert.equal((await node.locator('.loop-smart-run').textContent()).trim(), '运行 7 个任务');
        await page.locator('#shell').click({position:{x:20,y:20}});

        const editor = node.locator('.loop-smart-text').first();
        await editor.click();
        await editor.press('End');
        await node.locator('[data-loop-token="《计数》"]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.variablePrompt.includes('《计数》'));
        assert.equal(await node.locator('.loop-smart-token-chip').count(), 1);
        await node.locator('.loop-smart-token-chip [data-loop-token-remove]').click();
        await page.waitForFunction(() => !nodes.find(item => item.id === 'loop-target')?.variablePrompt.includes('《计数》'));

        await node.locator('[data-loop-prompt-add]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.variablePrompts.length === 2);
        assert.equal(await node.locator('.loop-smart-text').count(), 2);
        await node.locator('.loop-smart-text').nth(1).fill('Scene');
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.variablePrompts[1] === 'Scene');
        assert.equal(await node.locator('[data-loop-option-count="prompt"]').textContent(), '2 个选项');
        await node.locator('[data-loop-prompt-delete="1"]').click();
        await page.waitForFunction(() => nodes.find(item => item.id === 'loop-target')?.variablePrompts.length === 1);
        assert.equal(await node.locator('.loop-smart-text').count(), 1);
        assert.equal(await node.locator('[data-loop-option-count="prompt"]').textContent(), '1 个选项');

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await node.evaluate(async (root, activeTheme) => {
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                await new Promise(resolve => setTimeout(resolve, 100));
                const toggle = root.querySelector('.loop-smart-toggle');
                const toggleBase = toggle.shadowRoot.querySelector('[part="base"]');
                const run = root.querySelector('.loop-smart-run');
                const runBase = run.shadowRoot.querySelector('[part="base"]');
                const segment = root.querySelector('.loop-smart-seg > button[aria-checked="true"]');
                return {
                    toggleHeight:getComputedStyle(toggleBase).height,
                    toggleBackground:getComputedStyle(toggleBase).backgroundColor,
                    toggleColor:getComputedStyle(toggleBase).color,
                    runHeight:getComputedStyle(runBase).height,
                    runBackground:getComputedStyle(runBase).backgroundColor,
                    runColor:getComputedStyle(runBase).color,
                    segmentBackground:getComputedStyle(segment).backgroundColor,
                    segmentColor:getComputedStyle(segment).color,
                };
            }, theme);
            await page.mouse.move(5, 5);
            await page.waitForTimeout(120);
            await node.screenshot({path:`/tmp/t36-batch-run-node-${theme}.png`});
        }
        for (const theme of ['light', 'dark']) {
            assert.equal(themeStyles[theme].toggleHeight, '32px');
            assert.equal(themeStyles[theme].runHeight, '40px');
            for (const key of ['toggleBackground','toggleColor','runBackground','runColor','segmentBackground','segmentColor']) {
                assert.notEqual(themeStyles[theme][key], 'rgba(0, 0, 0, 0)');
            }
        }
        assert.notEqual(themeStyles.light.toggleBackground, themeStyles.dark.toggleBackground);
        assert.notEqual(themeStyles.light.segmentBackground, themeStyles.dark.segmentBackground);

        await page.mouse.move(5, 5);
        await page.waitForTimeout(150);
        const finalState = await page.evaluate(() => {
            const loop = nodes.find(item => item.id === 'loop-target');
            return {
                mode:loop.mode,
                imageInput:loop.imageInput,
                count:loop.count,
                variablePrompts:loop.variablePrompts,
            };
        });
        assert.deepEqual(finalState, {
            mode:'parallel', imageInput:true, count:7, variablePrompts:['Frame'],
        });

        process.stdout.write(`${JSON.stringify({initialState, openPopoverState, themeStyles, finalState})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
