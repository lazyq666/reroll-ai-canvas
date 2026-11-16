const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const source = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#7799bb"/></svg>');

(async () => {
    const browser = await chromium.launch({
        headless:true,
        executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    try {
        const page = await browser.newPage({viewport:{width:1440, height:1000}});
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=grid-drag-test`, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => window.SmartCanvasModules?.imageStudio && document.querySelector('#imageEditModal')?.dataset.icContractStatus === 'ready');
        await page.evaluate(sourceUrl => {
            const script = document.createElement('script');
            script.textContent = `
                nodes.splice(0, nodes.length, {id:'grid-drag-source', type:'smart-image', x:100, y:100, w:600, h:400,
                    images:[{url:${JSON.stringify(sourceUrl)}, name:'grid.svg', kind:'image', natural_w:1200, natural_h:800}]});
                render();
                window.gridDragProbe = {
                    open(){ SmartCanvasModules.imageStudio.open({nodeId:'grid-drag-source', imageIndex:0, mode:'grid'}); },
                    preset:applyGridPreset,
                    snapshot(){ return {lines:gridSplitLines().map(line => ({...line})), custom:gridCustomMode, rects:gridSplitRects(1200,800), dragging:Boolean(gridCustomDrag)}; },
                    zoom(value){ imageEditZoom = value; applyImageEditZoom(); },
                    gap(value){ document.getElementById('gridGapSize').value = String(value); refreshGridSplitPreview(); },
                    language(value){ StudioI18n.set(value); refreshGridSplitPreview(); return document.getElementById('gridSplitCount').textContent; },
                    async exportSizes(){
                        const originalUpload = uploadImageBlobs;
                        const sizes = [];
                        uploadImageBlobs = async entries => {
                            for(const entry of entries){
                                const bitmap = await createImageBitmap(entry.blob);
                                sizes.push({w:bitmap.width, h:bitmap.height});
                                bitmap.close();
                            }
                            return [];
                        };
                        try { await applyImageGridSplit(); } finally { uploadImageBlobs = originalUpload; }
                        return sizes;
                    }
                };
                window.gridDragProbe.open();
            `;
            document.body.appendChild(script);
            script.remove();
        }, source);
        await page.waitForFunction(() => document.querySelector('#imageEditModal').dataset.sourceState === 'original-ready');
        const draw = page.locator('#editDrawCanvas');
        const snapshot = () => page.evaluate(() => gridDragProbe.snapshot());
        async function drag(fromX, fromY, toX, toY) {
            const box = await draw.boundingBox();
            await page.mouse.move(box.x + box.width * fromX, box.y + box.height * fromY);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * toX, box.y + box.height * toY, {steps:8});
            await page.mouse.up();
        }
        for(const theme of ['light', 'dark']){
            await page.evaluate(themeName => {
                document.documentElement.dataset.theme = themeName;
                gridDragProbe.preset(2, 3);
            }, theme);
            await drag(1 / 3, .2, .25, .2);
            await drag(.1, .5, .1, .6);
            let state = await snapshot();
            assert.equal(state.custom, false);
            assert.equal(state.rects.length, 6);
            assert.ok(Math.abs(state.rects[0].w - 300) <= 2, JSON.stringify(state));
            assert.ok(Math.abs(state.rects[0].h - 480) <= 2, JSON.stringify(state));
            const box = await draw.boundingBox();
            await page.mouse.move(box.x + box.width * .25 + 6, box.y + box.height * .2);
            assert.equal(await draw.evaluate(element => element.style.cursor), 'col-resize');
            await page.mouse.click(box.x + box.width * .8, box.y + box.height * .8);
            assert.deepEqual((await snapshot()).lines, state.lines);
            await drag(.25, .2, .9, .2);
            state = await snapshot();
            const vertical = state.lines.filter(line => line.type === 'v');
            assert.ok(vertical[0].pos < vertical[1].pos);
            assert.equal(state.rects.length, 6);
            await page.evaluate(() => gridDragProbe.preset(2, 3));
            assert.equal((await snapshot()).lines[1].pos, 1 / 3);
        }
        const fullSize = await draw.boundingBox();
        await page.evaluate(() => { gridDragProbe.preset(1, 2); gridDragProbe.zoom(.5); });
        assert.ok(Math.abs((await draw.boundingBox()).width - fullSize.width / 2) <= 1);
        await drag(.5, .3, .35, .3);
        assert.ok(Math.abs((await snapshot()).rects[0].w - 420) <= 3);
        const exportRects = (await snapshot()).rects;
        assert.deepEqual(await page.evaluate(() => gridDragProbe.exportSizes()), exportRects.map(({w, h}) => ({w, h})));
        const englishCount = await page.evaluate(() => gridDragProbe.language('en'));
        const chineseCount = await page.evaluate(() => gridDragProbe.language('zh'));
        assert.notEqual(englishCount, chineseCount);
        assert.ok(englishCount.includes('2') && chineseCount.includes('2'));
        await page.evaluate(() => gridDragProbe.gap(20));
        const beforeGapDrag = await snapshot();
        assert.ok(Math.abs(beforeGapDrag.rects[0].w - 410) <= 3);
        const gapBox = await draw.boundingBox();
        await page.mouse.move(gapBox.x + gapBox.width * (.35 + 10 / 1200), gapBox.y + gapBox.height * .3);
        await page.mouse.down();
        await page.mouse.move(gapBox.x + gapBox.width * (.45 + 10 / 1200), gapBox.y + gapBox.height * .3, {steps:6});
        await page.mouse.up();
        assert.ok(Math.abs((await snapshot()).rects[0].w - 530) <= 3);
        await page.evaluate(() => {
            const control = document.getElementById('gridVerticalLines');
            control.value = '2';
            control.dispatchEvent(new Event('input', {bubbles:true}));
        });
        assert.equal((await snapshot()).lines[0].pos, 1 / 3);
        await page.evaluate(() => { gridDragProbe.preset(1, 2); gridDragProbe.gap(0); });
        await drag(.5, .3, -.2, .3);
        assert.equal((await snapshot()).dragging, false);
        assert.ok((await snapshot()).lines[0].pos > 0);
        await page.locator('#gridCustomToggle').click();
        await drag(.2, .4, .2, .45);
        assert.equal((await snapshot()).lines.length, 1);
        await drag(.2, .45, .2, .65);
        assert.ok(Math.abs((await snapshot()).lines[0].pos - .65) < .01);
        await page.locator('#gridUndoBtn').click();
        assert.ok(Math.abs((await snapshot()).lines[0].pos - .45) < .01);
        console.log('PASS: regular/custom grid dragging, PNG dimensions, zoom, gaps, crossing, reset, undo, light/dark, zh/en');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
