const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:900}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=splitter-node-controls-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-input')
            && customElements.get('ic-badge')
            && document.getElementById('world')
        ));

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const source = {
                    id:'splitter-source', type:'smart-prompt', title:'提示词',
                    x:100, y:260, w:316, h:194, text:'one;two;three'
                };
                const splitter = {
                    id:'splitter-target', type:'smart-splitter', title:'分隔符',
                    x:520, y:240, w:316, h:240, separator:';',
                    inputNodeIds:[source.id]
                };
                nodes.splice(0, nodes.length, source, splitter);
                canvas = {
                    id:'splitter-node-controls-regression', nodes,
                    connections:[{id:'splitter-connection', from:source.id, to:splitter.id, kind:'input'}],
                    logs:[]
                };
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

        const node = page.locator('.image-node[data-id="splitter-target"]');
        const separator = node.locator('ic-input.splitter-node-separator');
        const count = node.locator('ic-badge.splitter-node-count');
        await page.waitForFunction(() => {
            const input = document.querySelector('.image-node[data-id="splitter-target"] ic-input.splitter-node-separator');
            const badge = document.querySelector('.image-node[data-id="splitter-target"] ic-badge.splitter-node-count');
            return input?.dataset.icContractStatus === 'valid'
                && badge?.dataset.icContractStatus === 'ready';
        });

        const initialState = await node.evaluate(root => {
            const input = root.querySelector('ic-input.splitter-node-separator');
            const badge = root.querySelector('ic-badge.splitter-node-count');
            return {
                inputTag:input.localName,
                inputName:input.name,
                inputType:input.type,
                inputSize:input.size,
                inputAriaLabel:input.getAttribute('aria-label'),
                inputMaxLength:input.maxlength,
                inputValue:input.value,
                inputContract:input.dataset.icContractStatus,
                nativeLightDomInputs:root.querySelectorAll('input.splitter-node-separator').length,
                badgeTag:badge.localName,
                badgeKind:badge.getAttribute('kind'),
                badgeTone:badge.getAttribute('tone'),
                badgeText:badge.textContent.trim(),
                badgeContract:badge.dataset.icContractStatus,
                preview:[...root.querySelectorAll('.prompt-node-segment p')].map(item => item.textContent),
            };
        });
        assert.deepEqual(initialState, {
            inputTag:'ic-input',
            inputName:'splitter-separator-splitter-target',
            inputType:'text',
            inputSize:'small',
            inputAriaLabel:'分隔符',
            inputMaxLength:8,
            inputValue:';',
            inputContract:'valid',
            nativeLightDomInputs:0,
            badgeTag:'ic-badge',
            badgeKind:'count',
            badgeTone:'neutral',
            badgeText:'3 段',
            badgeContract:'ready',
            preview:['one', 'two', 'three'],
        });

        await separator.locator('input').fill('|');
        await page.waitForFunction(() => {
            const splitter = nodes.find(item => item.id === 'splitter-target');
            return splitter?.separator === '|'
                && document.querySelector('.image-node[data-id="splitter-target"] .splitter-node-count')?.textContent.trim() === '1 段';
        });
        const changedState = await page.evaluate(() => ({
            separator:nodes.find(item => item.id === 'splitter-target')?.separator,
            badgeText:document.querySelector('.image-node[data-id="splitter-target"] .splitter-node-count')?.textContent.trim(),
            preview:[...document.querySelectorAll('.image-node[data-id="splitter-target"] .prompt-node-segment p')].map(item => item.textContent),
        }));
        assert.deepEqual(changedState, {
            separator:'|', badgeText:'1 段', preview:['one;two;three'],
        });

        await separator.locator('input').fill(';');
        await page.waitForFunction(() => document.querySelector('.image-node[data-id="splitter-target"] .splitter-node-count')?.textContent.trim() === '3 段');

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
                const input = root.querySelector('ic-input.splitter-node-separator');
                const inputBase = input.shadowRoot.querySelector('[part="base"]');
                const inputControl = input.shadowRoot.querySelector('input');
                const badge = root.querySelector('ic-badge.splitter-node-count');
                const badgeBase = badge.shadowRoot.querySelector('[part="base"]');
                return {
                    inputHeight:getComputedStyle(inputBase).height,
                    inputBackground:getComputedStyle(inputBase).backgroundColor,
                    inputColor:getComputedStyle(inputControl).color,
                    badgeBackground:getComputedStyle(badgeBase).backgroundColor,
                    badgeColor:getComputedStyle(badgeBase).color,
                };
            }, theme);
        }
        for (const theme of ['light', 'dark']) {
            assert.equal(themeStyles[theme].inputHeight, '32px');
            assert.notEqual(themeStyles[theme].inputBackground, 'rgba(0, 0, 0, 0)');
            assert.notEqual(themeStyles[theme].badgeBackground, 'rgba(0, 0, 0, 0)');
            assert.notEqual(themeStyles[theme].inputColor, 'rgba(0, 0, 0, 0)');
            assert.notEqual(themeStyles[theme].badgeColor, 'rgba(0, 0, 0, 0)');
        }
        assert.notEqual(themeStyles.light.inputBackground, themeStyles.dark.inputBackground);
        assert.notEqual(themeStyles.light.badgeBackground, themeStyles.dark.badgeBackground);

        await node.screenshot({path:'/tmp/t36-splitter-node-controls-dark.png'});
        process.stdout.write(`${JSON.stringify({initialState, changedState, themeStyles})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
