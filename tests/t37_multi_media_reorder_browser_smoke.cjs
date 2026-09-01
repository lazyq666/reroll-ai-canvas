const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = color => (
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="${color}"/></svg>`)}`
);

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-multi-media-reorder&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasInteraction
            && typeof canvas !== 'undefined'
            && canvas
            && Array.isArray(nodes)
            && typeof render === 'function'
        ));
        await page.evaluate(urls => {
            nodes.splice(0, nodes.length, {
                id:'reorder-group',
                type:'smart-image',
                x:260,
                y:180,
                w:780,
                h:360,
                title:'Reorder group',
                images:[
                    {url:urls[0],name:'a.png',kind:'image',natural_w:300,natural_h:200},
                    {url:urls[1],name:'b.png',kind:'image',natural_w:300,natural_h:200},
                    {url:urls[2],name:'c.png',kind:'image',natural_w:300,natural_h:200},
                ],
            });
            canvas.connections = [];
            selectedId = 'reorder-group';
            selectedIds = [];
            selectedImage = {nodeId:'reorder-group',index:0};
            render();
        }, [svg('#4c8bf5'), svg('#f05b78'), svg('#1aab6d')]);
        await page.waitForSelector('.image-node[data-id="reorder-group"] .thumb-item[data-image-index="2"]');

        const source = page.locator('.image-node[data-id="reorder-group"] .thumb-item[data-image-index="0"]');
        const target = page.locator('.image-node[data-id="reorder-group"] .thumb-item[data-image-index="2"]');
        const sourceRect = await source.boundingBox();
        const targetRect = await target.boundingBox();
        await page.mouse.move(sourceRect.x + sourceRect.width / 2, sourceRect.y + sourceRect.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetRect.x + targetRect.width / 2, targetRect.y + targetRect.height / 2);
        await page.waitForTimeout(50);

        const during = await page.evaluate(() => ({
            interaction:window.SmartCanvasModules.canvasInteraction.active()?.kind || '',
            order:nodes[0].images.map(image => image.name),
            nodeCount:nodes.length,
            targetIndex:document.querySelector(
                '.image-node[data-id="reorder-group"] .thumb-item.media-reorder-target'
            )?.dataset.imageIndex || '',
        }));
        assert.deepEqual(during, {
            interaction:'detach-media',
            order:['a.png','b.png','c.png'],
            nodeCount:1,
            targetIndex:'2',
        });

        await page.mouse.up();
        await page.waitForFunction(() => (
            nodes.length === 1
            && nodes[0].images.map(image => image.name).join(',') === 'b.png,c.png,a.png'
        ));
        const afterReorder = await page.evaluate(() => ({
            order:nodes[0].images.map(image => image.name),
            domOrder:[...document.querySelectorAll(
                '.image-node[data-id="reorder-group"] .thumb-item .image-name-badge'
            )].map(element => element.textContent.trim()),
            selectedId,
            selectedImage:{...selectedImage},
            nodeCount:nodes.length,
            connections:canvas.connections.length,
            previewCleared:!document.querySelector('.media-reorder-source,.media-reorder-target'),
        }));
        assert.deepEqual(afterReorder, {
            order:['b.png','c.png','a.png'],
            domOrder:['b.png','c.png','a.png'],
            selectedId:'reorder-group',
            selectedImage:{nodeId:'reorder-group',index:2},
            nodeCount:1,
            connections:0,
            previewCleared:true,
        });

        const detachSource = page.locator(
            '.image-node[data-id="reorder-group"] .thumb-item[data-image-index="2"]'
        );
        const detachRect = await detachSource.boundingBox();
        await page.mouse.move(detachRect.x + detachRect.width / 2, detachRect.y + detachRect.height / 2);
        await page.mouse.down();
        await page.mouse.move(1160, 700);
        await page.mouse.up();
        await page.waitForFunction(() => nodes.length === 2);
        const afterDetach = await page.evaluate(() => ({
            sourceOrder:nodes.find(node => node.id === 'reorder-group')?.images.map(image => image.name) || [],
            detached:nodes.find(node => node.id !== 'reorder-group')?.images?.map(image => image.name) || [],
            connections:canvas.connections.length,
            dragVisualsCleared:!document.querySelector('.media-reorder-ghost')
                && !document.body.classList.contains('smart-media-reorder-drag'),
        }));
        assert.deepEqual(afterDetach, {
            sourceOrder:['b.png','c.png'],
            detached:['a.png'],
            connections:0,
            dragVisualsCleared:true,
        });
        assert.deepEqual(pageErrors, []);
        console.log(JSON.stringify({during, afterReorder, afterDetach}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
