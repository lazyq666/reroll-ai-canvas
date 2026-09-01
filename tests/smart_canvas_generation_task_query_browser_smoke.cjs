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
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=generation-task-query-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-button')
            && window.SmartCanvasModules?.generationRun?.recover
            && document.getElementById('world')
        ));

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const makeNode = (id, x, querying) => ({
                    id,
                    type:'smart-image',
                    title:'恢复任务',
                    x,
                    y:30,
                    w:300,
                    h:220,
                    images:[],
                    outputKind:'image',
                    jimengPending:{
                        submitId:id + '-submit',
                        kind:'image',
                        querying,
                        queueInfo:{queue_number:2}
                    }
                });
                nodes.splice(0, nodes.length,
                    makeNode('query-ready-node', 120, false),
                    makeNode('query-loading-node', 540, true)
                );
                canvas = {id:'generation-task-query-regression', nodes, connections:[], logs:[]};
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

        const recoveryNodes = page.locator('.image-node ic-generation-recovery');
        await page.waitForFunction(() => {
            const controls = [...document.querySelectorAll('.image-node ic-generation-recovery')];
            return controls.length === 2 && controls.every(control => control.dataset.icContractStatus === 'ready');
        });
        const productStates = await recoveryNodes.evaluateAll(controls => controls.map(control => ({
            kind:control.getAttribute('kind'),
            state:control.getAttribute('state'),
            title:control.getAttribute('title'),
            description:control.getAttribute('description'),
            text:control.shadowRoot.querySelector('.action')?.textContent.trim(),
            loading:control.shadowRoot.querySelector('.action')?.loading,
            disabled:control.shadowRoot.querySelector('.action')?.disabled,
            queryNodeId:control.dataset.jimengQuery,
            icon:control.shadowRoot.querySelector('ic-icon')?.getAttribute('name') || '',
            contract:control.dataset.icContractStatus,
            nativeButtonCount:control.querySelectorAll('button').length,
        })));
        assert.deepEqual(productStates, [
            {
                kind:'image', state:'queued', title:'排队中，前面 2 个任务',
                description:'任务可恢复', text:'查询结果', loading:false, disabled:false,
                queryNodeId:'query-ready-node', icon:'loader', contract:'ready', nativeButtonCount:0,
            },
            {
                kind:'image', state:'querying', title:'排队中，前面 2 个任务',
                description:'任务可恢复', text:'查询中...', loading:true, disabled:true,
                queryNodeId:'query-loading-node', icon:'loader', contract:'ready', nativeButtonCount:0,
            },
        ]);

        await recoveryNodes.first().hover();
        await page.waitForTimeout(200);
        assert.equal(await page.locator('body > ic-tooltip[open]').count(), 0);

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await recoveryNodes.first().evaluate(async (control, activeTheme) => {
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                await new Promise(resolve => setTimeout(resolve, 100));
                const base = control.shadowRoot.querySelector('[part="base"]');
                const title = control.shadowRoot.querySelector('.title');
                const icon = control.shadowRoot.querySelector('ic-icon');
                return {
                    height:getComputedStyle(base).height,
                    color:getComputedStyle(title).color,
                    iconColor:getComputedStyle(icon).color,
                    background:getComputedStyle(base).backgroundColor,
                };
            }, theme);
        }
        for (const theme of ['light', 'dark']) {
            assert.ok(parseFloat(themeStyles[theme].height) >= 120);
            assert.notEqual(themeStyles[theme].color, 'rgba(0, 0, 0, 0)');
            assert.notEqual(themeStyles[theme].iconColor, 'rgba(0, 0, 0, 0)');
            assert.notEqual(themeStyles[theme].background, 'rgba(0, 0, 0, 0)');
        }

        const casePage = await context.newPage();
        await casePage.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/action-case.html?case=generation-task-query&theme=light&viewport=desktop&locale=zh-CN&content=normal&density=medium&motion=standard`, {
            waitUntil:'domcontentloaded',
        });
        await casePage.waitForFunction(() => document.documentElement.dataset.actionCaseStatus === 'ready');
        const librarySection = casePage.locator('[data-component-name="ic-button-node-generation-task-query"]');
        const libraryStates = await librarySection.locator('ic-button').evaluateAll(controls => controls.map(control => ({
            text:control.textContent.trim(),
            loading:control.loading,
            disabled:control.disabled,
            icon:control.querySelector('ic-icon')?.getAttribute('name') || '',
            contract:control.dataset.icContractStatus,
        })));
        assert.deepEqual(libraryStates, [
            {text:'查询结果', loading:false, disabled:false, icon:'refresh', contract:'ready'},
            {text:'查询中...', loading:true, disabled:true, icon:'', contract:'ready'},
        ]);
        await librarySection.locator('ic-button').first().locator('button').click();
        await casePage.waitForFunction(() => {
            const control = document.querySelector('[data-component-name="ic-button-node-generation-task-query"] ic-button');
            return control?.loading && control?.disabled && control.textContent.trim() === '查询中...';
        });
        await casePage.screenshot({path:'/tmp/smart-canvas-generation-task-query-library-light.png', fullPage:true});

        process.stdout.write(`${JSON.stringify({productStates, themeStyles, libraryStates})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
