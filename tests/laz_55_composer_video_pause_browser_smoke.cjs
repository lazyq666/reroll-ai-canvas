const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const executablePath = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath});
    try {
        const page = await browser.newPage({viewport:{width:1440, height:900}});
        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e.message));
        page.setDefaultTimeout(10000);
        await page.route('**/api/local-generation-submissions', route => route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:false})}));
        await page.route('**/api/canvases/issue-47-text-composer', route => route.fulfill({contentType:'application/json',body:JSON.stringify({canvas:{id:'issue-47-text-composer',canvas_type:'smart',nodes:[],connections:[],settings:{},revision:0}})}));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-47-text-composer&manual=1&fixture=issue-47-text-composer`, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => window.SmartCanvasModules?.viewportSelection?.selection
            && canvas?.id === 'issue-47-text-composer');
        await page.waitForTimeout(350);
        await page.addScriptTag({content:`
            nodes.splice(0, nodes.length, {
                id:'laz-55-video', type:'smart-image', outputKind:'video',
                x:360, y:220, w:360, h:220,
                images:[{url:'/static/images/test/fixture.mp4', kind:'video', natural_w:640, natural_h:360}],
            }, {id:'laz-55-generation',type:'smart-image',referenceGenerationKind:'image',images:[],x:800,y:200,w:260,h:180,runSettings:{engine:'api',apiKind:'image',provider_id:'manual-mock',model:'mock-image-1',count:1}});
            canvas = {id:'laz-55', nodes, connections:[], logs:[]};
            selectedId = ''; selectedIds = []; selectedImage = {nodeId:'', index:-1};
            viewport.x = 0; viewport.y = 0; viewport.scale = 1;
            window.SmartCanvasModules.viewportSelection.viewport.apply();
            configureSmartCanvasVirtualization();
            canvasLevelOfDetail.update(1);
            smartCanvasDetailRecoveryReady = null;
            render();
        `});
        const node = '.image-node[data-id="laz-55-video"]';
        await page.locator(`${node} .media-video-card`).click({position:{x:12, y:12}});
        await page.waitForFunction(selector => {
            const video = document.querySelector(`${selector} video[data-inline-video-active]`);
            return video && video.readyState >= 2 && !video.paused;
        }, node);
        // Keep background playback active while arranging the authoring target.
        await page.addScriptTag({content:`selectedId='laz-55-generation'; selectedIds=[]; updateComposer();`});
        assert.equal(await page.locator(`${node} video`).evaluate(video => video.paused), false,
            'Video must still be playing before the expand action');
        await page.locator('#composerFocusToggle').click();
        await page.waitForFunction(() => composer.classList.contains('focused'));
        assert.equal(await page.locator(`${node} video`).evaluate(video => video.paused), true,
            'Expanding Composer must pause the playing video');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !composer.classList.contains('focused'));
        await page.waitForTimeout(350);
        assert.equal(await page.locator(`${node} video`).evaluate(video => video.paused), true,
            'Collapsing Composer must not resume video');
        assert.deepEqual(pageErrors, []);
        console.log('LAZ-55 Composer interruption passed');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
