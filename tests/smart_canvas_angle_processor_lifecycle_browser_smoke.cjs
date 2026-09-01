const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    try {
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=angle-lifecycle-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));
        await page.waitForLoadState('networkidle');

        await page.evaluate(({imageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const id = 'angle-lifecycle-source';
                nodes.splice(0, nodes.length, {
                    id,
                    type:'smart-image',
                    x:240,
                    y:220,
                    w:320,
                    h:240,
                    images:[{
                        url:${JSON.stringify(imageUrl)},
                        name:'angle-source.png',
                        kind:'image',
                        natural_w:1,
                        natural_h:1
                    }]
                });
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:id, index:0};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                canvasPersistence.schedule = () => {};
                syncSmartNodeFloatingPortal();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng});

        await page.waitForFunction(() => Boolean(
            document.querySelector('#smartNodeFloatingPortal [data-smart-node-action="angle-control"]')
        ));
        await page.locator('#smartNodeFloatingPortal [data-smart-node-action="angle-control"]').click();
        await page.waitForFunction(() => Boolean(
            document.querySelector('ic-ai-processor-dialog[open] [data-angle-viewport] canvas')
        ));

        const lifecycle = await page.locator('ic-ai-processor-dialog').evaluate(async dialog => {
            await dialog.hide('accepted');
            return {
                open:dialog.open,
                controller:dialog.angleController,
                canvasCount:dialog.querySelectorAll('[data-angle-viewport] canvas').length,
                scrollLocked:document.documentElement.classList.contains('wa-scroll-lock'),
            };
        });
        assert.deepEqual(lifecycle, {
            open:false,
            controller:null,
            canvasCount:0,
            scrollLocked:false,
        });

        const zoom = await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const before = viewport.scale;
                shell.dispatchEvent(new WheelEvent('wheel', {
                    bubbles:true,
                    cancelable:true,
                    ctrlKey:true,
                    clientX:720,
                    clientY:450,
                    deltaY:-120
                }));
                window.__angleZoomProbe = {before, after:viewport.scale};
            })();`;
            document.body.appendChild(script);
            script.remove();
            return window.__angleZoomProbe;
        });
        assert.notEqual(zoom.after, zoom.before, JSON.stringify(zoom));
        console.log('Smart Canvas angle processor lifecycle browser smoke passed.');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
