// Local fixtures only: start the actual Smart Canvas page and run its LOD assertions.
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const port = process.env.SMART_CANVAS_PORT || '18797';
const base = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const server = spawn('python3', ['tests/smart_canvas_lod_media_server.py'], {
        cwd:root, env:{...process.env, SMART_CANVAS_PORT:port}, stdio:'ignore',
    });
    let browser;
    try {
        let ready = false;
        for(let i = 0; i < 100; i++) {
            if(server.exitCode !== null) throw new Error('LOD fixture server exited');
            try { ready = (await fetch(`${base}/__lod-test-results`)).ok; } catch {}
            if(ready) break;
            await delay(100);
        }
        if(!ready) throw new Error('LOD fixture server did not start');
        browser = await chromium.launch({channel:'chrome', headless:true});
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        await page.route('**/assets/lod-toggle.png', route => route.fulfill({path:path.join(root, 'static/images/test/fixture.svg')}));
        await page.goto(`${base}/static/smart-canvas.html?id=lod-media&manual=1`);
        await page.waitForFunction(() => {
            try {
                const report = JSON.parse(document.querySelector('#lod-test-results')?.textContent || 'null');
                return report && ['pass','fail'].includes(report.status);
            } catch { return false; }
        }, null, {timeout:60000});
        const report = await page.locator('#lod-test-results').evaluate(el => JSON.parse(el.textContent));
        if(report.status !== 'pass') process.exitCode = 1;
        const bridgeCheck = await page.evaluate(async () => {
            const old = document.createElement('div'), fresh = document.createElement('div');
            old.innerHTML = '<div data-image-index="0" data-media-signature="image:fixture"><img class="far-node-thumbnail"></div>';
            fresh.innerHTML = '<div data-image-index="0" data-media-signature="image:fixture"><img data-original-src="fixture"></div>';
            const image = old.querySelector('img');
            image.src = '/api/media-preview?w=64&url=%2Fassets%2Flod-test.png';
            await image.decode();
            window.SmartCanvasModules.canvasFarPresentation.bridgeTransition(old, fresh);
            const bridge = fresh.querySelector('canvas.lod-transition-image');
            if (!bridge) return null;
            const alpha = bridge.getContext('2d').getImageData(0,0,1,1).data[3];
            return {width:bridge.width,height:bridge.height,alpha};
        });
        assert.deepEqual(bridgeCheck, {width:64,height:48,alpha:128}, 'Transition snapshot must retain the loaded bitmap and transparency');
        await page.evaluate(() => {
            setSmartImagePerformanceOptimization(true);
            viewport.x = 80; viewport.y = 60; viewport.scale = .35;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
            nodes.push({id:'lod-toggle',type:'smart-image',x:500,y:100,w:400,h:300,
                images:[{url:'/assets/lod-toggle.png',kind:'image',natural_w:400,natural_h:300}]});
            render();
            document.querySelector('#lod-test-results').hidden = true;
        });
        const waitForSource = preview => page.waitForFunction(preview => {
            const img = document.querySelector('[data-id="lod-toggle"] img');
            return img?.naturalWidth > 0 && (preview
                ? img.getAttribute('src').startsWith('/api/media-preview?')
                : img.getAttribute('src') === '/assets/lod-toggle.png');
        }, preview);
        await waitForSource(true);
        await page.locator('#smartSettingsToggle').click();
        await page.locator('#smartImagePerformanceToggle').click();
        await waitForSource(false);
        assert.equal(await page.evaluate(() => localStorage.getItem(SMART_IMAGE_PERFORMANCE_STORAGE_KEY)), 'off');
        await page.locator('#smartImagePerformanceToggle').click();
        await waitForSource(true);
        await page.evaluate(() => {
            viewport.scale = .18;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.locator('[data-id="lod-toggle"] .far-node-thumbnail').waitFor();
        assert.equal(await page.locator('[data-id="lod-toggle"] .far-node-thumbnail').evaluate(img => img.naturalWidth), 64);
        await page.locator('#smartImagePerformanceToggle').click();
        await page.locator('[data-id="lod-toggle"] .far-node-thumbnail').waitFor();
        assert.match(await page.locator('[data-id="lod-toggle"] .far-node-thumbnail').getAttribute('src'), /w=64/);
        await page.evaluate(() => {
            viewport.scale = .35;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await waitForSource(false);
        await page.locator('#smartImagePerformanceToggle').click();
        await waitForSource(true);
        assert.equal(await page.evaluate(() => localStorage.getItem(SMART_IMAGE_PERFORMANCE_STORAGE_KEY)), 'on');
        // Observe the actual transition synchronously, before the browser can
        // finish another load. A warm thumbnail must not flash a skeleton, and
        // the detail transition must retain a visible bitmap while it loads.
        await page.route('**/api/media-preview?*', async route => {
            if (new URL(route.request().url()).searchParams.get('w') === '64') await delay(400);
            await route.continue();
        });
        await page.evaluate(() => {
            viewport.scale = .18;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.locator('[data-id="lod-toggle"].canvas-lod-node-far').waitFor();
        const transition = await page.locator('[data-id="lod-toggle"]').evaluate(host => ({
            skeleton:!!host.querySelector('.far-node-image-skeleton'),
            visible:[...host.querySelectorAll('img,canvas.lod-transition-image')].some(img => (img.naturalWidth || (img.tagName === 'CANVAS' && img.width)) > 0 && Number(getComputedStyle(img).opacity) > 0),
        }));
        assert.equal(transition.visible, true, 'Warm far transition must retain a visible image');
        assert.equal(transition.skeleton, false, 'Warm far transition must not show a skeleton');
        await page.locator('[data-id="lod-toggle"] .far-node-thumbnail').waitFor();
        await page.evaluate(() => {
            viewport.scale = .35;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.waitForFunction(() => !document.querySelector('[data-id="lod-toggle"]')?.classList.contains('canvas-lod-node-far'));
        const recovered = await page.locator('[data-id="lod-toggle"]').evaluate(host =>
            [...host.querySelectorAll('img,canvas.lod-transition-image')].some(img => (img.naturalWidth || (img.tagName === 'CANVAS' && img.width)) > 0 && Number(getComputedStyle(img).opacity) > 0));
        assert.equal(recovered, true, 'Detail transition must retain a visible image');
        await page.unroute('**/api/media-preview?*');
        await page.evaluate(() => {
            nodes.push({id:'lod-layer-warm',type:'smart-layer-decomposition',x:100,y:100,w:240,h:180,
                images:[{url:'/assets/lod-layer-base.png',kind:'image',natural_w:240,natural_h:180}],
                layerDecompositionManifest:{canvas_width:240,canvas_height:180},
                layerDecompositionItems:[{id:'base',role:'base',z_index:0,media:{url:'/assets/lod-layer-base.png'}}]});
            render();
        });
        await page.locator('[data-id="lod-layer-warm"] .layer-decomposition-item img').waitFor();
        await page.waitForFunction(() => document.querySelector('[data-id="lod-layer-warm"] .layer-decomposition-item img')?.naturalWidth > 0);
        await page.evaluate(() => { viewport.scale = .18; window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false}); });
        await page.locator('[data-id="lod-layer-warm"] .far-node-thumbnail').waitFor();
        await page.route('**/api/media-preview?*', async route => {
            if (new URL(route.request().url()).searchParams.get('w') !== '64') await delay(400);
            await route.continue();
        });
        await page.evaluate(() => { viewport.scale = .35; window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false}); });
        await page.waitForFunction(() => !document.querySelector('[data-id="lod-layer-warm"]')?.classList.contains('canvas-lod-node-far'));
        assert.equal(await page.locator('[data-id="lod-layer-warm"] .layer-decomposition-item').evaluate(item =>
            [...item.querySelectorAll('img,canvas.lod-transition-image')].some(img => (img.naturalWidth || (img.tagName === 'CANVAS' && img.width)) > 0 && Number(getComputedStyle(img).opacity) > 0)), true,
            'Layer remains visible while switching to detail');
        await page.locator('[data-id="lod-layer-warm"] .lod-transition-image').waitFor({state:'detached'});
        await page.unroute('**/api/media-preview?*');
        await page.locator('#smartSettingsToggle').click();
        report.results.push({name:'actual settings switch selects previews or originals; far thumbnails stay independent',status:'pass'});
        console.log(JSON.stringify(report, null, 2));
        if(process.env.LOD_SCREENSHOT_DIR) {
            for(const theme of ['light','dark']) {
                await page.evaluate(theme => {
                    document.querySelector('#lod-test-results').hidden = true;
                    window.StudioTheme.apply(theme);
                    viewport.x = 100; viewport.y = 100; viewport.scale = .18;
                    window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                }, theme);
                await page.screenshot({path:path.join(process.env.LOD_SCREENSHOT_DIR, `far-skeleton-${theme}.png`)});
            }
        }
    } finally {
        await browser?.close();
        server.kill('SIGTERM');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
