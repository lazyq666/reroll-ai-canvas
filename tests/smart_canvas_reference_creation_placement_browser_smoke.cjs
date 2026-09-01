const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({
        headless:true,
        executablePath:browserExecutable
    });
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(
        `${baseUrl}/static/smart-canvas.html?id=reference-creation-placement-regression`,
        {waitUntil:'domcontentloaded'}
    );
    await page.waitForFunction(() => Boolean(
        window.SmartCanvasModules?.canvasMutation
        && typeof render === 'function'
        && canvas?.id
    ));

    async function resetMultiOutputSource() {
        await page.evaluate(imageUrl => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length, {
                    id:'source',
                    type:'smart-image',
                    x:100,
                    y:100,
                    generationOutputNode:true,
                    generationMediaW:768,
                    generationMediaH:1024,
                    activeOutputId:'output-b',
                    scale:0.8,
                    images:[
                        {
                            url:${JSON.stringify(imageUrl + '#a')},
                            kind:'image',
                            outputId:'output-a',
                            natural_w:768,
                            natural_h:1024
                        },
                        {
                            url:${JSON.stringify(imageUrl + '#b')},
                            kind:'image',
                            outputId:'output-b',
                            natural_w:768,
                            natural_h:1024
                        }
                    ]
                });
                canvas.nodes = nodes;
                canvas.connections = [];
                selectedId = 'source';
                selectedIds = [];
                selectedImage = {nodeId:'source',index:0};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                render();
                syncSmartNodeFloatingPortal();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, tinyPng);
        await page.waitForFunction(() => Boolean(
            document.querySelector('.image-node[data-id="source"]')
            && document.querySelector(
                '#smartNodeFloatingPortal [data-smart-node-action="generate-image"]'
            )
        ));
    }

    async function createdNodePosition() {
        await page.waitForFunction(() => nodes.length === 2);
        return page.evaluate(() => {
            const created = nodes.find(node => node.id !== 'source');
            return {x:created?.x,y:created?.y};
        });
    }

    await resetMultiOutputSource();
    await page.locator(
        '#smartNodeFloatingPortal [data-smart-node-action="generate-image"]'
    ).click();
    assert.deepEqual(await createdNodePosition(), {x:1102,y:100});

    await resetMultiOutputSource();
    await page.locator(
        '.image-node[data-id="source"] [data-node-quick-add][data-port="out"]'
    ).evaluate(trigger => trigger.click());
    await page.waitForFunction(() => Boolean(referenceGenerateMenuState));
    await page.evaluate(() => referenceGenerateMenu.dispatchEvent(
        new CustomEvent('ic-select', {detail:{value:'image'}})
    ));
    assert.deepEqual(await createdNodePosition(), {x:1102,y:100});

    await browser.close();
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
