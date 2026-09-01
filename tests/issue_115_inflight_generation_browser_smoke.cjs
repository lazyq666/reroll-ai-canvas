const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({
        headless:true,
        executablePath:browserExecutable,
    });
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-115-inflight`, {
        waitUntil:'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(
        window.SmartCanvasModules?.viewportSelection?.selection
        && document.getElementById('runBtn')?.dataset.icContractStatus === 'ready'
    ));

    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const id = 'issue-115-pending';
            nodes.splice(0, nodes.length, {
                id,
                type:'smart-image',
                x:240,
                y:220,
                w:320,
                h:240,
                images:[],
                pending:1,
                running:true,
                runPrompt:'frozen prompt',
                runModelPrompt:'frozen prompt',
                runSettings:{engine:'api',apiKind:'image',count:1},
                generationInputSnapshot:{
                    prompt:'frozen prompt',
                    refs:[],
                    settings:{engine:'api',apiKind:'image',count:1}
                }
            });
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            syncRunButtonState(nodes[0]);
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    });
    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready'
        && document.querySelectorAll('#smartNodeFloatingPortal ic-button').length === 2
    ));

    const state = await page.evaluate(() => ({
        runDisabled:document.getElementById('runBtn').disabled,
        actions:[...document.querySelectorAll(
            '#smartNodeFloatingPortal [data-smart-node-action]'
        )].map(button => ({
            action:button.dataset.smartNodeAction,
            label:button.textContent.trim(),
            icon:button.querySelector('ic-icon')?.getAttribute('name'),
            disabled:button.disabled,
        })),
    }));
    assert.deepEqual(state, {
        runDisabled:false,
        actions:[
            {
                action:'duplicate',
                label:'创建副本',
                icon:'create-copy',
                disabled:false,
            },
            {
                action:'regenerate',
                label:'再次生成',
                icon:'refresh',
                disabled:false,
            },
        ],
    });

    await page.locator(
        '#smartNodeFloatingPortal [data-smart-node-action="duplicate"]'
    ).click();
    await page.waitForFunction(() => nodes.length === 2);
    const duplicateState = await page.evaluate(() => ({
        nodeCount:nodes.length,
        originalBusy:Boolean(nodes.find(node => node.id === 'issue-115-pending')?.running),
        copyBusy:Boolean(nodes.find(node => node.id !== 'issue-115-pending')?.running),
    }));
    assert.deepEqual(duplicateState, {
        nodeCount:2,
        originalBusy:true,
        copyBusy:false,
    });

    await browser.close();
    console.log('Issue #115 in-flight generation browser smoke passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
