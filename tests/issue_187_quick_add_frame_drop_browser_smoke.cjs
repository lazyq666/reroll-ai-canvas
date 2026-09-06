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
        await page.addInitScript(() => {
            const raf = requestAnimationFrame; window.nativeQuickAddRaf = raf;
            window.requestAnimationFrame = callback => {
                if (callback.name === 'draw') {
                    if (window.quickAddFrame?.callback !== callback) window.quickAddFrame = {callback, start:performance.now()};
                    return 0;
                }
                return raf(callback);
            };
        });
        await page.goto(
            `${baseUrl}/static/smart-canvas.html?id=issue-187-quick-add-frame-drop`,
            {waitUntil:'domcontentloaded'}
        );
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasMutation
            && typeof render === 'function'
            && canvas?.id
        ));
        if (process.env.GOOEY_THEME) await page.evaluate(theme => { document.documentElement.dataset.uiTheme=theme; }, process.env.GOOEY_THEME);
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

        await page.waitForFunction(() => window.quickAddFrame);
        const reveal = [];
        for (const ms of [0,40,80,120,200,400,750]) {
            reveal.push(await page.evaluate(ms => {
                quickAddFrame.callback(quickAddFrame.start + ms);
                const menu = referenceGenerateMenu, svg = menu.shadowRoot.querySelector('.gooey-silhouette');
                const close = menu.surface.querySelector('[part="close"]');
                const line = document.querySelector('path.port-drag-temp');
                const endpoint = line.getPointAtLength(line.getTotalLength()).matrixTransform(line.getScreenCTM());
                return {ms, sourceIcon:menu._invoker.getAttribute('icon'),
                    rotation:new DOMMatrix(getComputedStyle(close.querySelector('ic-icon')).transform).b,
                    scale:new DOMMatrix(getComputedStyle(svg).transform).a,
                    endpoint:{x:endpoint.x,y:endpoint.y},
                    close:close.getBoundingClientRect().toJSON()};
            }, ms));
            if (process.env.GOOEY_SCREENSHOTS && [0,40,120,200,400,750].includes(ms)) {
                await page.screenshot({path:`${process.env.GOOEY_SCREENSHOTS}-${ms}.png`,clip:{x:dropPoint.x-110,y:dropPoint.y-110,width:220,height:150}});
            }
        }
        assert(reveal.every(f => f.sourceIcon === 'add'), 'Dragging must leave the source Quick Add as +');
        assert(reveal.every(f => Math.abs(f.rotation) < .001), 'Drop center is always X, without a plus rotation');
        assert(reveal[0].scale < .15 && reveal[1].scale > reveal[0].scale && reveal[2].scale > reveal[1].scale,
            'Liquid grows continuously from the connection endpoint before the fan separates');
        assert.equal(reveal[3].scale, 1);
        assert(reveal.every(f => Math.abs(f.endpoint.x-dropPoint.x)<1 && Math.abs(f.endpoint.y-dropPoint.y)<1),
            'The retained connection ends exactly at the released point');
        assert(reveal.every(f => Math.abs(f.close.x+f.close.width/2-dropPoint.x)<1 && Math.abs(f.close.y+f.close.height/2-dropPoint.y)<1),
            'Growing X stays centered on the connection endpoint');
        await page.waitForFunction(() => !referenceGenerateMenu.surface.hasAttribute('data-gooey'));
        const closeCenter=await page.locator('#referenceGenerateMenu [part="close"]').boundingBox();
        assert(Math.abs(closeCenter.x+22-dropPoint.x)<=1 && Math.abs(closeCenter.y+22-dropPoint.y)<=1,'drag-release fan is centered at the drop point');
        await page.evaluate(() => { window.requestAnimationFrame = window.nativeQuickAddRaf; });
        const buttons = page.locator('#referenceGenerateMenu ic-menu-item button');
        assert.equal(await buttons.count(), 3, 'drag release opens the same three icon buttons');
        for (const button of await buttons.all()) {
            const rect = await button.boundingBox();
            assert.equal(rect.width, 44);
            assert.equal(rect.height, 44);
        }
        await page.locator('#referenceGenerateMenu ic-menu-item[value="image"] button').hover();
        await page.locator('#referenceGenerateMenu ic-menu-item[value="image"] ic-tooltip[open]').waitFor();
        await page.locator('#referenceGenerateMenu ic-menu-item[value="image"] button').click();
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
        await page.waitForFunction(() => referenceGenerateMenu.dataset.motionState === 'closed');
        for (const cancel of ['close', 'escape', 'outside']) {
            if (cancel === 'outside') await page.emulateMedia({reducedMotion:'reduce'});
            const sourceRect = await source.boundingBox();
            await page.mouse.move(sourceRect.x+20,sourceRect.y+20);
            await quickAdd.waitFor({state:'visible'});
            await quickAdd.hover();
            await page.mouse.down();
            await page.mouse.move(1150,250,{steps:8});
            await page.mouse.up();
            await page.waitForFunction(() => referenceGenerateMenu.hasAttribute('open') && !referenceGenerateMenu.surface.hasAttribute('data-gooey'));
            assert.equal(await quickAdd.getAttribute('icon'),'add');
            if (cancel === 'outside') assert.equal(await page.locator('#referenceGenerateMenu .gooey-silhouette').count(),0);
            if (cancel === 'close') await page.locator('#referenceGenerateMenu [part="close"]').click();
            else if (cancel === 'escape') await page.keyboard.press('Escape');
            else await page.mouse.click(1350,100);
            await page.waitForFunction(() => referenceGenerateMenu.dataset.motionState === 'closed');
            assert.deepEqual(await page.evaluate(() => ({nodes:nodes.length,connections:canvas.connections.length,
                pending:Boolean(referenceGenerateMenuState),lines:document.querySelectorAll('path.port-drag-temp').length})),
                {nodes:3,connections:1,pending:false,lines:0}, `${cancel} cancels the pending connection without creating anything`);
            assert.equal(await quickAdd.getAttribute('icon'),'add');
        }
        process.stdout.write('Issue #187 QuickAdd Frame drop browser smoke passed.\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
