/* LAZ-71: execute in the real page served by smart_canvas_lod_media_server.py. */
(async () => {
    const report = document.createElement('pre');
    report.id = 'lod-test-results';
    report.style = 'position:fixed;right:12px;top:12px;z-index:99999;background:white;color:black;padding:12px;max-width:620px;max-height:45vh;overflow:auto;font:12px monospace';
    report.textContent = 'Running LOD media regression';
    document.body.append(report);
    const results = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const check = (value, message) => { if(!value) throw new Error(message); };
    const until = async (predicate, message) => {
        for(let i=0; i<200; i++) { if(predicate()) return; await sleep(25); }
        throw new Error(message);
    };
    const test = async (name, run) => {
        try { results.push({name, status:'pass', ...await run()}); }
        catch(error) { results.push({name, status:'fail', error:String(error.stack || error)}); }
        report.textContent = JSON.stringify(results, null, 2);
    };
    const zoom = scale => {
        viewport.x = 80; viewport.y = 60; viewport.scale = scale;
        window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
    };
    const firstImages = () => Array.from({length:8}, (_,i) =>
        world.querySelector(`.image-node[data-id="lod-${i}"] [data-image-index="0"] img[data-original-src]`));
    const settled = () => firstImages().every(img => img?.complete && img.naturalWidth > 0
        && img.dataset.mediaState === 'ready' && Number(getComputedStyle(img).opacity) === 1);
    const exercise = async scales => {
        const originals = firstImages();
        check(originals.every(Boolean), 'All eight images must be mounted before the test');
        const badFrames = [];
        let running = true, frameCount = 0;
        const sample = () => {
            frameCount++;
            const images = firstImages();
            if(images.some(img => !img || !img.complete || !img.naturalWidth
                || Number(getComputedStyle(img).opacity) < .999)) {
                badFrames.push(images.map(img => img ? {state:img.dataset.mediaState,
                    opacity:Number(getComputedStyle(img).opacity), complete:img.complete} : null));
            }
            if(running) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        for(const scale of scales) { zoom(scale); await sleep(scales.length > 1 ? 45 : 400); }
        await sleep(400);
        await until(() => frameCount >= 10 && !smartCanvasDetailRecoveryFrame,
            'The browser did not finish painting the recovery batches');
        running = false;
        const replaced = originals.filter((img,i) => img !== firstImages()[i]).length;
        check(frameCount > 5, 'The browser must paint enough frames to observe the transition');
        check(badFrames.length === 0 && replaced === 0,
            `${badFrames.length} faded/blank frames; ${replaced} images replaced; first=${JSON.stringify(badFrames[0])}`);
        check(new Set(firstImages()).size === 8, 'Duplicate URLs must keep separate media instances');
        return {frameCount, fadedFrames:badFrames.length, replaced};
    };
    try {
        await until(() => window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready', 'Canvas failed to initialize');
        zoom(.35);
        await until(settled, 'Initial images did not become visible');
        await test('detail to far: eight nodes and repeated media URL', () => exercise([.2]));
        await until(settled, 'Far images did not settle');
        await test('far to detail: more than one recovery batch', () => exercise([.35]));
        await test('multi-image first instance stays distinct', () => {
            const images = [...world.querySelectorAll('.image-node[data-id="lod-0"] img[data-original-src]')];
            check(images.length === 2 && images[0] !== images[1], 'Multi-image instances collapsed');
        });
        await until(settled, 'Detail images did not settle');
        await test('rapid reversals reject stale presentation work', () => exercise([.2,.35,.2,.35,.2,.35]));
        await test('dark theme preserves the same images in both directions', async () => {
            const theme = window.StudioTheme.get();
            try {
                window.StudioTheme.apply('dark');
                await until(settled, 'Theme update did not settle');
                return await exercise([.2,.35]);
            } finally { window.StudioTheme.apply(theme); }
        });
        await test('language switching keeps both LOD presentations usable', async () => {
            const language = window.StudioI18n.lang();
            try {
                window.StudioI18n.set('en');
                await until(settled, 'English presentation did not settle');
                check(document.documentElement.lang === 'en', 'English UI did not apply');
                const english = await exercise([.2,.35]);
                window.StudioI18n.set('zh');
                await until(settled, 'Chinese presentation did not settle');
                check(document.documentElement.lang === 'zh-CN', 'Chinese UI did not apply');
                const chinese = await exercise([.2,.35]);
                return {english, chinese};
            } finally { window.StudioI18n.set(language); }
        });
        await test('different source, index and video posters cannot be transplanted as the same image', () => {
            const shellFor = (index, url, video=false) => {
                const el = document.createElement('div'); el.dataset.id = 'identity-test';
                el.innerHTML = `<div class="far-node-media" data-image-index="${index}">${video
                    ? smartVideoPreviewHtml(url) : smartPreviewImgHtml(url)}</div>`;
                return el;
            };
            const old = shellFor(0, '/static/images/test/fixture.svg');
            const image = old.querySelector('img');
            for(const fresh of [shellFor(1, '/static/images/test/fixture.svg'), shellFor(0, '/different.svg'), shellFor(0, '/static/images/test/fixture.svg', true)]) {
                transplantSmartLodImages(old, fresh);
                check(old.contains(image), 'A different media instance stole the existing image');
            }
        });
        await test('first load still uses loading feedback', async () => {
            const host = document.createElement('div');
            host.className = 'image-node';
            host.innerHTML = smartPreviewImgHtml('/__lod-slow-image.svg?first-load');
            document.body.append(host);
            try {
                const img = host.querySelector('img');
                check(img.dataset.mediaState === 'loading' && Number(getComputedStyle(img).opacity) === 0, 'Initial loading feedback missing');
                bindSmartPreviewImageFallbacks(host);
                await until(() => img.dataset.mediaState === 'ready', 'First load never became ready');
            } finally { host.remove(); }
        });
        await test('real preview upgrade, downgrade and failed upgrade keep the current image visible', async () => {
            zoom(1 / (window.devicePixelRatio || 1));
            const host = document.createElement('div');
            host.className = 'image-node';
            host.style = 'width:900px;height:600px;left:100px;top:100px';
            host.innerHTML = smartPreviewImgHtml('/assets/lod-preview.png', 512, 'style="width:900px;height:600px"');
            document.body.append(host);
            const img = host.querySelector('img');
            const originalOptimization = smartImagePerformanceOptimization;
            smartImagePerformanceOptimization = true;
            let running = false;
            try {
                bindSmartPreviewImageFallbacks(host);
                await until(() => img.dataset.mediaState === 'ready' && Number(getComputedStyle(img).opacity) === 1, 'Initial preview did not settle');
                const initial = img.getAttribute('src');
                let fadedFrames = 0;
                running = true;
                const sample = () => {
                    if(!running) return;
                    if(Number(getComputedStyle(img).opacity) < .999 || !img.naturalWidth) fadedFrames++;
                    requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
                refreshSmartAdaptiveImageResolution(img);
                await sleep(80);
                check(img.getAttribute('src') === initial, 'Slow upgrade removed the visible image too early');
                await until(() => img.dataset.previewSize === '1024', 'Upgrade never applied');
                zoom(.2); refreshSmartAdaptiveImageResolution(img);
                await until(() => img.dataset.previewSize === '512', 'Far mode did not release the high-resolution source');
                const low = img.getAttribute('src');
                zoom(2 / (window.devicePixelRatio || 1)); refreshSmartAdaptiveImageResolution(img);
                await sleep(400);
                check(img.getAttribute('src') === low && img.dataset.previewSize === '512', 'Failed upgrade replaced the visible preview');
                check(fadedFrames === 0, `Resolution changes produced ${fadedFrames} faded frames`);
                return {fadedFrames};
            } finally {
                running = false;
                host.remove();
                smartImagePerformanceOptimization = originalOptimization;
            }
        });
        await test('active video player is released in far mode and returns paused', async () => {
            nodes.push({id:'lod-video',type:'smart-image',x:100,y:100,w:400,h:225,
                images:[{url:'/static/images/test/fixture.mp4',kind:'video',name:'fixture.mp4',natural_w:640,natural_h:360}]});
            zoom(.35); render();
            await until(() => world.querySelector('[data-id="lod-video"] .image-wrap'), 'Video node did not mount');
            smartPlaybackActivateVideo('lod-video',0,{play:false});
            const player = world.querySelector('[data-id="lod-video"] video');
            check(player, 'Video fixture must contain a real player');
            await until(() => player.readyState >= 1, 'Video metadata did not load');
            zoom(.2); await sleep(150);
            check(!player.isConnected && !world.querySelector('[data-id="lod-video"] video'), 'Far mode retained a video player');
            zoom(.35); await sleep(400);
            const restored = world.querySelector('[data-id="lod-video"] video');
            check(!restored || restored.paused, 'Detail mode started playing video automatically');
        });
        await test('large canvas retains viewport culling without keeping offscreen images', async () => {
            const originalCount = nodes.length;
            try {
                for(let i=0; i<5000; i++) nodes.push({id:`offscreen-${i}`,type:'smart-image',
                    x:50000+(i%100)*500,y:50000+Math.floor(i/100)*400,w:400,h:300,
                    images:[{url:'/static/images/test/fixture.svg',kind:'image',natural_w:1076,natural_h:1448}]});
                zoom(.35); render();
                await until(settled, 'Large canvas did not settle');
                const continuity = await exercise([.2,.35]);
                const mounted = world.querySelectorAll(':scope > .image-node').length;
                check(mounted < 50 && !world.querySelector('[data-id^="offscreen-"]'), 'Offscreen nodes were materialized');
                return {...continuity, total:nodes.length, mounted};
            } finally { nodes.splice(originalCount); render(); }
        });
    } catch(error) { results.push({name:'setup', status:'fail', error:String(error.stack || error)}); }
    const summary = {status:results.every(item => item.status === 'pass') ? 'pass' : 'fail', results};
    report.textContent = JSON.stringify(summary, null, 2);
    await fetch('/__lod-test-results', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(summary)});
})();
