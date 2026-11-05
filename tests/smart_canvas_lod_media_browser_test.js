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
        for(const scale of scales) {
            zoom(scale);
            await until(() => !smartCanvasDetailRecoveryFrame, 'Recovery batches did not finish');
            if(scale < .20) {
                await until(() => world.querySelectorAll('.image-node.canvas-lod-node-far').length >= 8, 'Far nodes did not render');
                check(firstImages().every(img => !img), 'Far image nodes must release their images');
                check(world.querySelectorAll('.far-node-image-skeleton').length >= 9, 'Far image skeletons missing');
            } else {
                await until(settled, 'Detail images did not recover');
                check(new Set(firstImages()).size === 8, 'Repeated URLs must keep separate media instances');
            }
        }
        return {scales, restored:scales.at(-1) >= .20};
    };
    try {
        await until(() => window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready', 'Canvas failed to initialize');
        zoom(.35);
        await until(settled, 'Initial images did not become visible');
        await test('thresholds: below 20% enters, above 25% restores', async () => {
            const observed = [];
            for(const [scale, mode] of [[.20,'detail'],[.199,'far'],[.20,'far'],[.24,'far'],[.25,'far'],[.251,'detail']]) {
                zoom(scale);
                await until(() => !smartCanvasDetailRecoveryFrame, 'Threshold recovery did not finish');
                check(canvasLevelOfDetail.diagnostics().mode === mode, `Wrong LOD at ${scale}`);
                if(mode === 'far') check(firstImages().every(img => !img), 'Threshold transition retained images');
                else await until(settled, 'Threshold transition did not restore images');
                observed.push({scale, mode});
            }
            return {observed};
        });
        await test('new far image requests no bitmap until zoomed in', async () => {
            const url = '/static/images/test/fixture.svg?far-cold-image';
            const host = () => world.querySelector('[data-id="lod-cold-image"]');
            zoom(.18);
            nodes.push({id:'lod-cold-image',type:'smart-image',x:100,y:100,w:240,h:360,
                images:[{url,kind:'image',natural_w:240,natural_h:360}]});
            try {
                render();
                await until(() => host()?.querySelector('.far-node-image-skeleton'), 'New far skeleton did not mount');
                await sleep(100);
                check(!host().querySelector('img'), 'New far node mounted a bitmap');
                check(!performance.getEntriesByType('resource').some(entry => entry.name.includes('far-cold-image')), 'New far node requested its image');
                const farWidth = host().style.width, farHeight = host().style.height;
                zoom(.35);
                await until(() => host()?.querySelector('img')?.naturalWidth > 0, 'New image did not load on zoom in');
                check(host().style.width === farWidth && host().style.height === farHeight, 'Zoom changed stored node geometry');
                return {farImageRequests:0, restored:true};
            } finally {
                nodes.splice(nodes.findIndex(node => node.id === 'lod-cold-image'),1);
                zoom(.35); render();
                await until(settled, 'Fixture did not recover');
            }
        });
        await test('layer composite releases layers in far mode and restores them on zoom', async () => {
            const host = () => world.querySelector('[data-id="lod-layers"]');
            nodes.push({id:'lod-layers',type:'smart-layer-decomposition',x:100,y:100,w:240,h:360,
                images:[{url:'/static/images/test/fixture.svg?layer-base',kind:'image',natural_w:240,natural_h:360}],
                layerDecompositionManifest:{canvas_width:240,canvas_height:360},
                layerDecompositionItems:[{role:'base',z_index:0,media:{url:'/static/images/test/fixture.svg?layer-base'}}]});
            try {
                zoom(.35); render();
                await until(() => host()?.querySelector('.layer-decomposition-stage img')?.naturalWidth > 0, 'Composite did not load');
                zoom(.18);
                await until(() => host()?.querySelector('.far-node-image-skeleton'), 'Composite skeleton did not mount');
                check(!host().querySelector('img'), 'Composite retained its layer images');
                const originalSelection = {...selectedImage};
                host().querySelector('.far-node-image-skeleton').click();
                check(selectedImage.nodeId === originalSelection.nodeId && selectedImage.index === originalSelection.index, 'Composite skeleton acquired ordinary image selection');
                zoom(.35);
                await until(() => host()?.querySelector('.layer-decomposition-stage img')?.naturalWidth > 0, 'Composite did not recover');
            } finally {
                nodes.splice(nodes.findIndex(node => node.id === 'lod-layers'),1);
                zoom(.35); render();
                await until(settled, 'Fixture did not recover');
            }
        });
        await test('detail to far: eight nodes and repeated media URL', () => exercise([.18]));
        check(firstImages().every(img => !img), 'Far images must be unmounted');
        await test('far to detail: more than one recovery batch', () => exercise([.35]));
        await test('multi-image first instance stays distinct', () => {
            const images = [...world.querySelectorAll('.image-node[data-id="lod-0"] img[data-original-src]')];
            check(images.length === 2 && images[0] !== images[1], 'Multi-image instances collapsed');
        });
        await test('image group replaces every visible thumbnail with a skeleton and restores it', async () => {
            const group = () => world.querySelector('[data-id="lod-image-group"]');
            const images = () => [...group().querySelectorAll('img[data-original-src]')];
            nodes.push({id:'lod-image-group',type:'smart-image',x:100,y:100,w:720,h:560,
                images:Array.from({length:10}, (_,i) => ({url:`/static/images/test/fixture.svg?group=${i}`,
                    kind:'image',name:`image-${i}.svg`,natural_w:1076,natural_h:1448}))});
            try {
                zoom(.35); render();
                await until(() => group() && images().length === 10 && images().every(img => img.dataset.mediaState === 'ready'
                    && img.naturalWidth > 0 && Number(getComputedStyle(img).opacity) === 1), 'Ten-image group did not load');
                for(const theme of ['light','dark']) {
                    window.StudioTheme.apply(theme);
                    for(const scale of [.18,.35,.18,.35]) {
                        zoom(scale);
                        await until(() => group().classList.contains(scale === .18 ? 'canvas-lod-node-far' : 'canvas-lod-node-detail'), 'Group LOD did not update');
                        await until(() => !smartCanvasDetailRecoveryFrame, 'Group recovery did not finish');
                        if(scale === .35) {
                            await until(() => images().length === 10 && images().every(img => img.naturalWidth > 0 && img.dataset.mediaState === 'ready'), 'Group images did not recover');
                            images().forEach((img,i) => check(img.dataset.originalSrc.endsWith(`group=${i}`), 'Restored image order changed'));
                        } else {
                            check(images().length === 0, 'Far group retained real images');
                            check(group().querySelectorAll('.far-node-image-skeleton').length === 10, 'Far group skeletons missing');
                        }
                        if(scale === .18) {
                            const cells = [...group().querySelectorAll('.far-node-media')];
                            check(cells.length === 10, 'Far mode did not preserve all media positions');
                            check(cells[1].getBoundingClientRect().left > cells[0].getBoundingClientRect().left, 'Far media lost its columns');
                            check(cells.every(cell => cell.getBoundingClientRect().width > 0 && cell.getBoundingClientRect().height > 0), 'Far thumbnail has no size');
                            check(cells.every(cell => {
                                const rect = cell.querySelector('.far-node-image-skeleton').getBoundingClientRect();
                                const outer = cell.getBoundingClientRect();
                                return rect.width >= outer.width - 1 && rect.height >= outer.height - 1;
                            }), 'Skeleton does not fill its media cell');
                            check(!group().querySelector('video,audio,button,.image-name-badge'), 'Far grid retained detailed controls');
                        }
                    }
                }
                return {restoredImages:10, farSkeletons:10, themes:['light','dark']};
            } finally {
                nodes.splice(nodes.findIndex(node => node.id === 'lod-image-group'),1);
                window.StudioTheme.apply('light'); render();
            }
        });
        await test('compact 280 by 220 image group retains multiple visible media', async () => {
            nodes.push({id:'lod-compact-group',type:'smart-image',x:100,y:100,w:280,h:220,
                images:Array.from({length:10}, (_,i) => ({url:`/static/images/test/fixture.svg?compact=${i}`,
                    kind:'image',natural_w:100,natural_h:100}))});
            try {
                zoom(.18); render();
                await until(() => world.querySelector('[data-id="lod-compact-group"] .far-node-media-grid'), 'Compact group did not render');
                const cells = [...world.querySelectorAll('[data-id="lod-compact-group"] .far-node-media')];
                check(cells.length > 1 && cells.length < 10, 'Compact group must retain multiple visible images and cull hidden rows');
                check(cells[0].dataset.imageIndex === '0' && cells[1].dataset.imageIndex === '1', 'Compact group changed media order');
                return {visibleMedia:cells.length, totalMedia:10};
            } finally {
                nodes.splice(nodes.findIndex(node => node.id === 'lod-compact-group'),1);
                zoom(.35); render();
            }
        });
        await until(settled, 'Detail images did not settle');
        await test('rapid reversals reject stale presentation work', async () => {
            for(const scale of [.18,.35,.18,.35,.18,.35]) { zoom(scale); await sleep(15); }
            await until(settled, 'Images did not recover after rapid zoom');
            await exercise([.18]);
            await sleep(300);
            check(firstImages().every(img => !img), 'Late image loads escaped the far skeletons');
            return exercise([.35]);
        });
        await test('dark theme restores images after far skeletons', async () => {
            const theme = window.StudioTheme.get();
            try {
                window.StudioTheme.apply('dark');
                await until(settled, 'Theme update did not settle');
                return await exercise([.18,.35]);
            } finally { window.StudioTheme.apply(theme); }
        });
        await test('language switching keeps both LOD presentations usable', async () => {
            const language = window.StudioI18n.lang();
            try {
                window.StudioI18n.set('en');
                await until(settled, 'English presentation did not settle');
                check(document.documentElement.lang === 'en', 'English UI did not apply');
                const english = await exercise([.18,.35]);
                window.StudioI18n.set('zh');
                await until(settled, 'Chinese presentation did not settle');
                check(document.documentElement.lang === 'zh-CN', 'Chinese UI did not apply');
                const chinese = await exercise([.18,.35]);
                return {english, chinese};
            } finally { window.StudioI18n.set(language); }
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
                zoom(.18); refreshSmartAdaptiveImageResolution(img);
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
            zoom(.18); await sleep(150);
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
                const continuity = await exercise([.18,.35]);
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
