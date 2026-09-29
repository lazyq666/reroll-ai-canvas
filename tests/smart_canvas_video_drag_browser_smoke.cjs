const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const base = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const executablePath = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath});
    try {
        const page = await browser.newPage({viewport:{width:1440, height:1000}});
        page.setDefaultTimeout(10000);
        await page.goto(`${base}/static/smart-canvas.html?componentReview=nodes`);
        await page.waitForFunction(() => document.documentElement.dataset.nodesStatus === 'ready');
        const selector = '.image-node[data-id="video-drag-a"]';
        const position = () => page.evaluate(() => nodes.map(({id,x,y}) => ({id,x,y})));
        const reset = async (multi=false) => {
            await page.mouse.move(10, 10);
            await page.evaluate(multi => {
                nodes.splice(0, nodes.length, ...['a','b'].map((suffix,index) => ({
                    id:`video-drag-${suffix}`, type:'smart-image', x:250+index*650, y:200,
                    w:360, h:203, images:[{url:'/static/images/test/fixture.mp4',
                        name:`${suffix}.mp4`, kind:'video', natural_w:640, natural_h:360}]
                })));
                canvas = {id:'video-drag-regression', nodes, connections:[], logs:[]};
                selectedId = 'video-drag-a';
                selectedIds = [];
                selectedImage = {nodeId:'',index:-1};
                viewport.x=0; viewport.y=0; viewport.scale=1;
                window.SmartCanvasModules.viewportSelection.viewport.apply();
                configureSmartCanvasVirtualization(); canvasLevelOfDetail.update(1);
                smartCanvasDetailRecoveryReady=null; render();
            }, multi);
            await page.locator(`${selector} .media-video-card`).hover({position:{x:50,y:40}});
            await page.waitForFunction(selector => document.querySelector(selector)?.dataset.inlineVideoActive === '1', `${selector} video`);
            if (multi) await page.evaluate(() => {
                selectedId=''; selectedIds=nodes.map(n=>n.id);
                window.SmartCanvasModules.viewportSelection.selection.refresh();
            });
        };
        const drag = async (locator, dx, dy) => {
            const box = await locator.boundingBox();
            assert.ok(box);
            const x=box.x+Math.min(50,box.width/2), y=box.y+Math.min(40,box.height/2);
            await page.mouse.move(x,y); await page.mouse.down();
            await page.mouse.move(x+dx,y+dy,{steps:10}); await page.mouse.up();
        };

        for (const theme of ['light','dark']) for (const language of ['zh','en']) {
            await page.evaluate(({theme,language}) => {
                applyTheme(theme); window.StudioI18n.set(language);
            }, {theme,language});
            await reset();
            await drag(page.locator(`${selector} video`),100,50);
            const after = await position();
            assert.deepEqual(after[0], {id:'video-drag-a',x:350,y:250}, 'Hovered video picture must drag the node');
            assert.deepEqual(after[1], {id:'video-drag-b',x:900,y:200});
            assert.equal(await page.locator('#smartNodeFloatingPortal [data-smart-node-action="video-loop"]').count(),0);

            const controls = page.locator(`${selector} ic-media-player-controls`);
            const beforeControls = await position();
            const loop = controls.locator('[data-loop]');
            const enabled = await page.locator(`${selector} video`).evaluate(v=>v.loop);
            await loop.click();
            assert.equal(await page.locator(`${selector} video`).evaluate(v=>v.loop),!enabled);
            assert.equal(await loop.getAttribute('label'), language==='zh'
                ? (enabled ? '开启循环播放' : '关闭循环播放')
                : (enabled ? 'Turn loop on' : 'Turn loop off'));
            await loop.press('Space');
            assert.equal(await page.locator(`${selector} video`).evaluate(v=>v.loop),enabled);
            await drag(controls.locator('[data-seek]'),40,0);
            assert.deepEqual(await position(),beforeControls,'Player controls must not move the node');
            assert.equal(await page.evaluate(()=>imageStudio.isOpen()),false);

            await page.locator(`${selector} video`).dblclick({position:{x:50,y:40}});
            await page.waitForFunction(()=>imageStudio.isOpen());
            const expanded = page.locator('.preview-frame ic-media-player-controls');
            assert.equal(await page.locator('#previewCurrentVideo').evaluate(v=>v.loop),enabled);
            await expanded.locator('[data-loop]').click();
            assert.equal(await page.locator('#previewCurrentVideo').evaluate(v=>v.loop),!enabled);
            await expanded.locator('[data-expand]').click();
            await page.waitForFunction(()=>!imageStudio.isOpen());
            assert.equal(await page.locator(`${selector} video`).evaluate(v=>v.loop),!enabled);
            assert.equal(await page.locator('#smartNodeFloatingPortal [data-smart-node-action="video-loop"]').count(),0);
        }
        await reset(true);
        await drag(page.locator(`${selector} video`),100,50);
        assert.deepEqual(await position(),[
            {id:'video-drag-a',x:350,y:250}, {id:'video-drag-b',x:1000,y:250}
        ]);
        console.log(JSON.stringify({ok:true,checks:'hover drag, multi-selection, controls isolation, double-click fullscreen, loop persistence, keyboard, Chinese/English, Light/Dark, removed toolbar loop'}));
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
