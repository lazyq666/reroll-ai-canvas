const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = (index) => (
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="hsl(${index * 17} 70% 55%)"/><text x="20" y="110" font-size="54" fill="white">${index + 1}</text></svg>`)}`
);

(async () => {
    const browser = await chromium.launch({
        headless:true,
        executablePath:browserExecutable,
    });
    try {
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(
            `${baseUrl}/static/smart-canvas.html?id=t37-multi-media-layout-drag-feedback&manual=1`,
            {waitUntil:'domcontentloaded'},
        );
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasInteraction
            && typeof canvas !== 'undefined'
            && canvas
            && Array.isArray(nodes)
            && typeof render === 'function'
        ));
        await page.evaluate(urls => {
            nodes.splice(0, nodes.length, {
                id:'layout-drag-group',
                type:'smart-image',
                x:80,
                y:50,
                w:520,
                h:320,
                scale:2,
                title:'Layout and drag feedback',
                images:urls.map((url,index) => ({
                    url,
                    name:`image-${index + 1}.png`,
                    kind:'image',
                    natural_w:400,
                    natural_h:200,
                })),
            });
            canvas.connections = [];
            selectedId = 'layout-drag-group';
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            render();
        }, Array.from({length:20}, (_,index) => svg(index)));
        await page.waitForSelector(
            '.image-node[data-id="layout-drag-group"] .node-resize-handle',
        );

        const layoutSnapshot = () => page.evaluate(() => {
            const node = document.querySelector(
                '.image-node[data-id="layout-drag-group"]',
            );
            const grid = node.querySelector('.thumb-grid');
            const item = grid.querySelector('.thumb-item');
            const nodeRect = node.getBoundingClientRect();
            const gridRect = grid.getBoundingClientRect();
            const nodeStyle = getComputedStyle(node);
            const rightmostThumb = Math.max(
                ...[...grid.querySelectorAll('.thumb-item')].map(
                    thumb => thumb.getBoundingClientRect().right,
                ),
            );
            const rootRem = Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
            );
            return {
                nodeWidth:node.getBoundingClientRect().width,
                nodeHeight:node.getBoundingClientRect().height,
                thumbWidth:item.getBoundingClientRect().width,
                expectedThumbWidth:rootRem * 8,
                gridClientHeight:grid.clientHeight,
                gridScrollHeight:grid.scrollHeight,
                hasVerticalOverflow:grid.scrollHeight > grid.clientHeight + 1,
                scrollbarEdgeInset:Number(
                    (nodeRect.right - gridRect.right).toFixed(2),
                ),
                expectedScrollbarEdgeInset:Number((
                    Number.parseFloat(nodeStyle.paddingRight)
                    + Number.parseFloat(nodeStyle.borderRightWidth)
                ).toFixed(2)),
                thumbToScrollbarGap:Number(
                    (gridRect.right - rightmostThumb).toFixed(2),
                ),
            };
        });
        await page.evaluate(() => {
            Object.assign(nodes[0],{w:214,h:320});
            render();
        });
        const narrow = await layoutSnapshot();
        assert.equal(narrow.hasVerticalOverflow,true);
        assert.ok(
            Math.abs(
                narrow.scrollbarEdgeInset
                - narrow.expectedScrollbarEdgeInset
            ) <= 1,
            `scrollbar is not pinned to the Node edge: ${narrow.scrollbarEdgeInset} vs ${narrow.expectedScrollbarEdgeInset}`,
        );
        assert.ok(
            narrow.thumbToScrollbarGap >= 12,
            `scrollbar is too close to the thumbnail: ${narrow.thumbToScrollbarGap}px`,
        );
        await page.evaluate(() => {
            Object.assign(nodes[0],{w:520,h:320});
            render();
        });
        const before = await layoutSnapshot();
        assert.equal(before.hasVerticalOverflow, true);

        const handle = page.locator(
            '.image-node[data-id="layout-drag-group"] .node-resize-handle',
        );
        const handleRect = await handle.boundingBox();
        await page.mouse.move(
            handleRect.x + handleRect.width / 2,
            handleRect.y + handleRect.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
            handleRect.x + handleRect.width / 2 + 650,
            handleRect.y + handleRect.height / 2 + 550,
        );
        await page.mouse.up();
        await page.evaluate(() => new Promise(resolve => (
            requestAnimationFrame(() => requestAnimationFrame(resolve))
        )));

        const expanded = await layoutSnapshot();
        assert.ok(
            Math.abs(expanded.thumbWidth - expanded.expectedThumbWidth) <= 1,
            `thumbnail width ${expanded.thumbWidth} is not 8rem ${expanded.expectedThumbWidth}`,
        );
        assert.equal(
            expanded.hasVerticalOverflow,
            false,
            `expanded group still scrolls: ${expanded.gridScrollHeight} > ${expanded.gridClientHeight}`,
        );
        const expandedSize = await page.evaluate(() => ({
            width:nodes[0].w,
            height:nodes[0].h,
        }));
        await page.evaluate(() => {
            Object.assign(nodes[0],{w:2400,h:1800});
            render();
        });
        const oversized = await layoutSnapshot();
        assert.ok(
            Math.abs(oversized.thumbWidth - oversized.expectedThumbWidth) <= 1,
            `oversized group thumbnail ${oversized.thumbWidth} is not 8rem ${oversized.expectedThumbWidth}`,
        );
        await page.evaluate(size => {
            Object.assign(nodes[0],{w:size.width,h:size.height});
            render();
        }, expandedSize);
        await page.evaluate(() => new Promise(resolve => (
            requestAnimationFrame(() => requestAnimationFrame(resolve))
        )));

        const source = page.locator(
            '.image-node[data-id="layout-drag-group"] .thumb-item[data-image-index="0"]',
        );
        const target = page.locator(
            '.image-node[data-id="layout-drag-group"] .thumb-item[data-image-index="1"]',
        );
        const sourceRect = await source.boundingBox();
        const targetRect = await target.boundingBox();
        const nearTarget = {
            x:targetRect.x - 3,
            y:targetRect.y + targetRect.height / 2,
        };
        await page.mouse.move(
            sourceRect.x + sourceRect.width / 2,
            sourceRect.y + sourceRect.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(nearTarget.x, nearTarget.y);
        await page.waitForTimeout(50);

        const dragging = await page.evaluate(({x,y}) => {
            const node = document.querySelector(
                '.image-node[data-id="layout-drag-group"]',
            );
            const sourceItem = node.querySelector(
                '.thumb-item[data-image-index="0"]',
            );
            const ghost = document.querySelector('.media-reorder-ghost');
            const ghostRect = ghost?.getBoundingClientRect();
            const selectionBorder = getComputedStyle(sourceItem,'::after');
            return {
                selected:sourceItem.classList.contains('image-selected'),
                selectedBorder:Number.parseFloat(selectionBorder.borderTopWidth) > 0
                    && selectionBorder.borderTopColor !== 'rgba(0, 0, 0, 0)',
                sourceMoving:sourceItem.classList.contains('media-reorder-source'),
                targetIndex:node.querySelector(
                    '.thumb-item.media-reorder-target',
                )?.dataset.imageIndex || '',
                ghost:Boolean(ghost),
                magnetized:ghost?.classList.contains('is-magnetized') || false,
                ghostNearPointer:Boolean(
                    ghostRect
                    && Math.abs(ghostRect.left + ghostRect.width / 2 - x) < ghostRect.width
                    && Math.abs(ghostRect.top + ghostRect.height / 2 - y) < ghostRect.height
                ),
                shifted:[...node.querySelectorAll('.media-reorder-shift')]
                    .some(item => item.style.transform.includes('translate')),
                order:nodes[0].images.map(image => image.name),
            };
        }, nearTarget);
        assert.deepEqual(dragging, {
            selected:true,
            selectedBorder:true,
            sourceMoving:true,
            targetIndex:'1',
            ghost:true,
            magnetized:true,
            ghostNearPointer:true,
            shifted:true,
            order:Array.from({length:20}, (_,index) => `image-${index + 1}.png`),
        });

        await page.mouse.up();
        await page.waitForFunction(() => (
            nodes[0].images[0].name === 'image-2.png'
            && nodes[0].images[1].name === 'image-1.png'
        ));
        const released = await page.evaluate(() => ({
            order:nodes[0].images.slice(0,3).map(image => image.name),
            selectedImage:{...selectedImage},
            dropFeedback:Boolean(document.querySelector(
                '.thumb-item.media-reorder-drop-feedback',
            )),
            releasingGhost:Boolean(document.querySelector(
                '.media-reorder-ghost.is-releasing',
            )),
            connections:canvas.connections.length,
        }));
        assert.deepEqual(released, {
            order:['image-2.png','image-1.png','image-3.png'],
            selectedImage:{nodeId:'layout-drag-group',index:1},
            dropFeedback:true,
            releasingGhost:true,
            connections:0,
        });
        await page.waitForTimeout(420);
        const settled = await page.evaluate(() => ({
            ghost:Boolean(document.querySelector('.media-reorder-ghost')),
            feedback:Boolean(document.querySelector(
                '.media-reorder-drop-feedback,.media-reorder-shift',
            )),
        }));
        assert.deepEqual(settled, {ghost:false,feedback:false});
        await page.evaluate(() => {
            Object.assign(nodes[0],{type:'smart-group',w:1170,h:870});
            render();
        });
        await page.waitForSelector(
            '.image-node.smart-group-node[data-id="layout-drag-group"] .thumb-grid',
        );
        const smartGroup = await layoutSnapshot();
        assert.ok(
            Math.abs(
                smartGroup.thumbWidth - smartGroup.expectedThumbWidth
            ) <= 1,
        );
        assert.equal(smartGroup.hasVerticalOverflow,false);
        assert.deepEqual(pageErrors, []);
        console.log(JSON.stringify({
            before,
            narrow,
            expanded,
            oversized,
            dragging,
            released,
            settled,
            smartGroup,
        }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
