const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        await page.goto(
            `${baseUrl}/static/smart-canvas.html?id=issue-187-quick-add-frame-drop`,
            {waitUntil:'domcontentloaded'}
        );
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasMutation
            && typeof render === 'function'
            && canvas?.id
        ));
        await page.evaluate(imageUrl => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length,
                    {
                        id:'frame',
                        type:'smart-frame',
                        title:'Reference frame',
                        x:80,
                        y:80,
                        w:900,
                        h:700,
                        items:[]
                    },
                    {
                        id:'source',
                        type:'smart-image',
                        x:160,
                        y:180,
                        scale:0.25,
                        images:[{
                            url:${JSON.stringify(imageUrl)},
                            kind:'image',
                            natural_w:768,
                            natural_h:1024
                        }]
                    }
                );
                canvas.nodes = nodes;
                canvas.connections = [];
                selectedId = 'source';
                selectedIds = [];
                selectedImage = {nodeId:'source',index:0};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                render();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, tinyPng);
        const source = page.locator('.image-node[data-id="source"]');
        const quickAdd = source.locator('[data-node-quick-add][data-port="out"]');
        await quickAdd.waitFor();
        const sourceBox = await source.boundingBox();
        assert.ok(sourceBox, 'source node should be measurable inside the Frame');
        await page.mouse.move(
            sourceBox.x + sourceBox.width / 2,
            sourceBox.y + sourceBox.height / 2
        );
        await page.waitForTimeout(34);
        const quickAddBox = await quickAdd.boundingBox();
        assert.ok(quickAddBox, 'QuickAdd trigger should be measurable inside the Frame');

        const dropPoint = {x:760,y:420};
        const dropTarget = await page.evaluate(point => ({
            frameId:document.elementFromPoint(point.x, point.y)
                ?.closest('.smart-frame-node')?.dataset.id || '',
            nodeId:document.elementFromPoint(point.x, point.y)
                ?.closest('.image-node')?.dataset.id || ''
        }), dropPoint);
        assert.deepEqual(dropTarget, {frameId:'frame',nodeId:'frame'});

        await page.mouse.move(
            quickAddBox.x + quickAddBox.width / 2,
            quickAddBox.y + quickAddBox.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(dropPoint.x, dropPoint.y, {steps:8});
        await page.mouse.up();
        await page.waitForTimeout(34);
        assert.equal(
            await page.evaluate(() => Boolean(referenceGenerateMenuState)),
            true,
            'dropping QuickAdd on Frame background should open the reference-generation menu'
        );

        await page.evaluate(() => referenceGenerateMenu.dispatchEvent(
            new CustomEvent('ic-select', {detail:{value:'image'}})
        ));
        await page.waitForFunction(() => nodes.length === 3);
        const result = await page.evaluate(() => {
            const created = nodes.find(node => !['frame','source'].includes(node.id));
            return {
                created:Boolean(created),
                insideFrame:Boolean(created
                    && created.x >= 80
                    && created.y >= 80
                    && created.x <= 980
                    && created.y <= 780),
                connected:Boolean(created && canvas.connections.some(connection => (
                    connection.from === 'source'
                    && connection.to === created.id
                    && connection.kind === 'input'
                )))
            };
        });
        assert.deepEqual(result, {created:true,insideFrame:true,connected:true});
        process.stdout.write('Issue #187 QuickAdd Frame drop browser smoke passed.\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
