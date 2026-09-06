const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        await page.goto(`${process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794'}/static/smart-canvas.html?id=shift-selection-regression`);
        await page.waitForFunction(() => window.SmartCanvasModules?.viewportSelection?.selection);
        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `
                nodes.splice(0, nodes.length, ...['a','b','c'].map((id,index) => ({
                    id, type:'smart-image', x:160 + index * 340, y:280, w:220, h:180,
                    images:[{url:'/static/images/test/fixture.svg',name:id,kind:'image'}]
                })));
                canvas = {id:'shift-selection-regression',nodes,connections:[],logs:[]};
                selectedId = ''; selectedIds = []; viewport.x = 0; viewport.y = 0; viewport.scale = 1;
                render(); window.SmartCanvasModules.viewportSelection.viewport.apply();
            `;
            document.body.appendChild(script); script.remove();
        });
        const click = async (id, shift=false) => {
            const node = page.locator('.image-node[data-id="' + id + '"]');
            const box = await node.boundingBox();
            if(shift) await page.keyboard.down('Shift');
            await page.mouse.click(box.x + 90,box.y + 90);
            if(shift) await page.keyboard.up('Shift');
        };
        const expectIds = async ids => assert.deepEqual(
            await page.evaluate(() => window.SmartCanvasModules.viewportSelection.selection.ids().sort()), ids
        );
        await click('a',true); await expectIds(['a']);
        await click('b',true); await expectIds(['a','b']);
        await click('b',true); await expectIds(['a','b']);
        await click('c'); await expectIds(['c']);
        await click('a',true); await expectIds(['a','c']);
        await click('b',true); await expectIds(['a','b','c']);
        await page.mouse.click(1100,650); await expectIds([]);
        await page.mouse.move(110,220); await page.mouse.down();
        await page.mouse.move(780,510,{steps:12}); await page.mouse.up();
        await expectIds(['a','b']);
        await click('c',true); await expectIds(['a','b','c']);
        console.log('PASS: Shift adds nodes, repeated clicks preserve selection, plain click and marquee still work.');
    } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
