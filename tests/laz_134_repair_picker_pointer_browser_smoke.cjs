const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {server} = require('./image_repair_browser_fixture.cjs');

async function openPicker(page, editorId, query = 'Reference artwork') {
    const editor = page.locator(`#${editorId}`);
    await editor.click();
    await editor.press('End');
    await page.keyboard.type(` @${query}`);
    await page.waitForFunction(() => document.getElementById('mentionPicker').hasAttribute('open'));
}

async function selectWithMouse(page, tile, editorId) {
    await tile.waitFor({state: 'visible'});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await tile.boundingBox();
    const point = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
    const before = await page.evaluate(({point, editorId}) => {
        window.repairPickerPointerPath = [];
        document.addEventListener('pointerdown', event => {
            window.repairPickerPointerPath = event.composedPath().map(element => element.id || element.localName).filter(Boolean);
        }, {capture: true, once: true});
        return {
            hit: document.elementFromPoint(point.x, point.y)?.id,
            tokens: document.querySelectorAll(`#${editorId} .mention-image-token`).length,
            prompt: document.getElementById(editorId).textContent,
            brush: document.getElementById('imageRepairBrush').hasAttribute('pressed'),
            underlyingClicks: window.repairPickerUnderlyingClicks.length,
        };
    }, {point, editorId});
    await page.mouse.click(point.x, point.y);
    const after = await page.evaluate(editorId => ({
        pointerPath: window.repairPickerPointerPath,
        tokens: document.querySelectorAll(`#${editorId} .mention-image-token`).length,
        prompt: document.getElementById(editorId).textContent,
        brush: document.getElementById('imageRepairBrush').hasAttribute('pressed'),
        underlyingClicks: window.repairPickerUnderlyingClicks.length,
    }), editorId);
    assert.equal(after.tokens, before.tokens + 1, JSON.stringify({before, after}));
    assert.equal(before.hit, 'mentionPicker');
    assert.ok(after.pointerPath.includes('mentionPicker'), JSON.stringify(after.pointerPath));
    assert.equal(after.brush, before.brush);
    assert.equal(after.underlyingClicks, before.underlyingClicks);
    assert.match(after.prompt, /^Match the texture in /);
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    const page = await browser.newPage({viewport: {width: 1440, height: 960}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.route('**/api/model-capabilities?**', async route => {
            const data = await (await route.fetch()).json();
            data.inputs.image.maximum = 4;
            await route.fulfill({json: data});
        });
        await page.route('**/api/workspace-assets?**', route => route.fulfill({json: {
            items: [{id: 'asset-entry', media_id: 'reference-artwork', url: '/assets/reference-alias.png', name: 'Reference alias'}],
            next_cursor: '',
        }}));
        await page.goto(`${base}/static/smart-canvas.html?id=image-repair-browser&manual=1`);
        await page.waitForSelector('#fixture-open');
        await page.evaluate(() => {
            window.SmartCanvasModules.canvasMutation.create({
                kind: 'image',
                data: {x: 800, y: 120, images: [{url: '/assets/reference.png', media_id: 'reference-artwork', name: 'Reference artwork', kind: 'image'}]},
                options: {select: false, positionMode: 'exact'},
            });
            window.StudioI18n.set('en');
            applyTheme('light');
            window.repairPickerUnderlyingClicks = [];
            document.addEventListener('click', event => {
                const control = event.composedPath().find(element => ['imageRepairBrush', 'imageRepairRectangle', 'imageRepairPresets'].includes(element.id));
                if (control) window.repairPickerUnderlyingClicks.push(control.id);
            }, true);
        });
        await page.click('#fixture-open');
        await page.waitForFunction(() => !document.getElementById('imageRepairPrompt').readOnly);
        await page.locator('#imageRepairPrompt').fill('Match the texture in ');
        await openPicker(page, 'imageRepairPrompt');
        const tile = page.locator('#mentionPicker [part="option"]').filter({hasText: 'Reference artwork'});
        await selectWithMouse(page, tile, 'imageRepairPrompt');
        assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(), 1);
        await openPicker(page, 'imageRepairPrompt');
        await page.locator('#mentionPicker [data-tab="assets"]').click();
        await page.waitForFunction(() => document.getElementById('mentionPicker').items.some(item => item.media?.src?.includes('reference-alias')));
        await page.evaluate(() => {
            window.StudioI18n.set('zh');
            applyTheme('dark');
        });
        await selectWithMouse(page, page.locator('#mentionPicker [part="option"]').first(), 'imageRepairPrompt');
        assert.equal(await page.locator('#imageRepairReferences ic-reference-thumbnail').count(), 1);
        await openPicker(page, 'imageRepairPrompt');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#mentionPicker').evaluate(element => element.open), false);
        assert.equal(await page.locator('#imageEditModal').evaluate(element => element.open), true);
        await openPicker(page, 'imageRepairPrompt');
        await page.locator('.image-repair-viewport').click({position: {x: 10, y: 10}});
        assert.equal(await page.locator('#mentionPicker').evaluate(element => element.open), false, 'Clicking outside the picker within the modal dismisses it');
        await openPicker(page, 'imageRepairPrompt');
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        assert.equal(await page.locator('#mentionPicker').evaluate(element => element.open), false);
        await page.waitForFunction(() => !document.getElementById('imageEditModal').open);
        await page.evaluate(() => {
            window.SmartCanvasModules.canvasMutation.create({
                kind: 'prepared',
                data: {node: {
                    id: 'pointer-composer', type: 'smart-image', referenceGenerationKind: 'image',
                    x: 400, y: 200, w: 280, h: 180, images: [],
                    runSettings: {engine: 'api', apiKind: 'image', count: 1},
                }},
                options: {select: true, positionMode: 'exact'},
            });
            viewport.x = 0;
            viewport.y = 0;
            viewport.scale = 1;
            window.SmartCanvasModules.viewportSelection.viewport.apply();
            updateComposer();
        });
        await page.locator('#promptInput').fill('Match the texture in ');
        await openPicker(page, 'promptInput');
        await selectWithMouse(page, tile, 'promptInput');
        await page.click('#fixture-open');
        await page.waitForFunction(() => !document.getElementById('imageRepairPrompt').readOnly);
        await page.locator('#imageRepairPrompt').fill('Match the texture in ');
        await openPicker(page, 'imageRepairPrompt');
        await selectWithMouse(page, page.locator('#mentionPicker [part="option"]').first(), 'imageRepairPrompt');
        assert.deepEqual(errors, []);
        console.log('PASS LAZ-134 mouse selection, asset tabs, dismiss/reopen and normal Composer across modal scopes, languages and themes');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
    server.close();
});
