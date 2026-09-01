const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true,executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        page.setDefaultTimeout(20000);
        const runtimeErrors = [];
        page.on('pageerror', error => runtimeErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-148-complex&manual=1&fixture=issue-148-complex`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            canvas?.nodes?.find(node => node.id === 'generator-source')
            && window.SmartCanvasModules?.generationRun
            && document.getElementById('runBtn')?.dataset.icContractStatus === 'ready'
        ));

        await page.keyboard.press('z');
        const sourceNode = page.locator('.image-node[data-id="generator-source"]');
        await sourceNode.click();
        await sourceNode.click();
        await page.waitForSelector('#composer.open #promptInput');
        const prompt = page.locator('#promptInput');
        await prompt.click();
        await prompt.fill('Issue #148：霓虹城市与漂浮岛屿，电影感');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'promptInput');

        await page.locator('#runBtn').click();
        await page.waitForFunction(() => {
            const batch = canvas.nodes.filter(node => node.generationBatchId);
            return batch.length === 4
                && batch.every(node => (node.images || []).some(image => (
                    String(image.url || '').startsWith('data:image/svg+xml;base64,')
                )));
        }, {timeout:15000});

        const result = await page.evaluate(() => {
            const batch = canvas.nodes
                .filter(node => node.generationBatchId)
                .sort((left,right) => Number(left.generationSlotIndex) - Number(right.generationSlotIndex));
            return {
                activeElement:document.activeElement?.id || '',
                count:batch.length,
                ids:batch.map(node => node.id),
                layout:batch.map(node => node.generationBatchLayout),
                y:batch.map(node => node.y),
                imageCounts:batch.map(node => (node.images || []).length),
            };
        });
        assert.equal(result.count, 4);
        assert.deepEqual(result.layout, ['horizontal','horizontal','horizontal','horizontal']);
        assert.equal(new Set(result.y).size, 1);
        assert.deepEqual(result.imageCounts, [1,1,1,1]);
        assert.deepEqual(runtimeErrors, []);
        console.log(JSON.stringify({passed:true,result}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
