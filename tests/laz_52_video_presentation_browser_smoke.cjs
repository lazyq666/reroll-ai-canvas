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
        await page.goto(`${baseUrl}/static/smart-canvas.html?componentReview=nodes`, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => window.SmartCanvasModules?.viewportSelection?.selection
            && document.documentElement.dataset.nodesStatus === 'ready');
        await page.waitForTimeout(350);
        await page.addScriptTag({content:`
            nodes.splice(0, nodes.length, {
                id:'laz-52-video', type:'smart-image', outputKind:'video',
                x:360, y:220, w:360, h:220,
                images:[{url:'/static/images/test/fixture.mp4', kind:'video', natural_w:640, natural_h:360}],
            });
            canvas = {id:'laz-52', nodes, connections:[], logs:[]};
            selectedId = ''; selectedIds = []; selectedImage = {nodeId:'', index:-1};
            viewport.x = 0; viewport.y = 0; viewport.scale = 1;
            window.SmartCanvasModules.viewportSelection.viewport.apply();
            configureSmartCanvasVirtualization();
            canvasLevelOfDetail.update(1);
            smartCanvasDetailRecoveryReady = null;
            render();
        `});
        const node = '.image-node[data-id="laz-52-video"]';
        await page.locator(`${node} .media-video-card`).click({position:{x:12, y:12}});
        await page.waitForFunction(selector => {
            const video = document.querySelector(`${selector} video[data-inline-video-active]`);
            return video && video.readyState >= 2 && !video.paused;
        }, node);
        await page.locator(`${node} video`).evaluate(async video => {
            video.currentTime = 1;
            await new Promise(resolve => video.addEventListener('seeked', resolve, {once:true}));
            video.volume = 0.4;
            video.playbackRate = 1.25;
            window.__laz52Video = video;
            window.__laz52Events = [];
            for(const type of ['pause', 'play', 'emptied', 'loadstart', 'seeking']) {
                video.addEventListener(type, () => window.__laz52Events.push(type));
            }
        });
        await page.locator('[data-smart-node-action="video-play"]').click();
        await page.waitForFunction(() => document.getElementById('imageEditModal')?.classList.contains('open'));
        await page.waitForTimeout(300);
        const expanded = await page.evaluate(() => ({
            samePlayer:document.getElementById('previewCurrentVideo') === window.__laz52Video,
            paused:window.__laz52Video.paused,
            events:window.__laz52Events,
        }));
        assert.equal(expanded.samePlayer, true, `Full screen must keep the same player: ${JSON.stringify(expanded)}`);
        assert.equal(expanded.paused, false);
        assert.deepEqual(expanded.events, [], 'Changing presentation must not pause, reload or seek');
        await page.locator('#imageEditModal').getByRole('button', {name:/^(关闭|Close)$/}).click();
        await page.waitForFunction(() => !document.getElementById('imageEditModal')?.classList.contains('open'));
        await page.waitForTimeout(300);
        const returned = await page.evaluate(selector => ({
            samePlayer:document.querySelector(`${selector} video`) === window.__laz52Video,
            paused:window.__laz52Video.paused,
            visible:window.__laz52Video.checkVisibility(),
            volume:window.__laz52Video.volume,
            rate:window.__laz52Video.playbackRate,
            events:window.__laz52Events,
        }), node);
        assert.equal(returned.samePlayer, true, JSON.stringify(returned));
        assert.equal(returned.paused, false);
        assert.equal(returned.visible, true);
        assert.equal(returned.volume, 0.4);
        assert.equal(returned.rate, 1.25);
        assert.deepEqual(returned.events, []);
        await page.locator(`${node} video`).evaluate(video => video.pause());
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('video,audio')].some(media => !media.paused)), false,
            'Pausing the visible player must leave no hidden playback');

        // A paused player keeps its identity and time through double-click and rapid reopen.
        const pausedTime = await page.evaluate(() => window.__laz52Video.currentTime);
        await page.locator(`${node} video`).dblclick({position:{x:24, y:24}});
        await page.waitForFunction(() => document.getElementById('imageEditModal').classList.contains('open'));
        assert.equal(await page.evaluate(() => document.getElementById('previewCurrentVideo') === window.__laz52Video), true);
        assert.equal(await page.evaluate(() => window.__laz52Video.paused), true);
        await page.evaluate(() => {
            for(let i = 0; i < 5; i++){
                window.SmartCanvasModules.imageStudio.close();
                window.SmartCanvasModules.imageStudio.open({nodeId:'laz-52-video', groupAware:false});
            }
        });
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => window.__laz52Video.paused), true);
        assert.ok(Math.abs(await page.evaluate(() => window.__laz52Video.currentTime) - pausedTime) < 0.1);

        // Redraw and language/theme changes must not create another player behind the dialog.
        for(const [theme, lang] of [['light','zh'], ['dark','en']]){
            await page.evaluate(({theme, lang}) => {
                window.StudioTheme?.set?.(theme);
                window.StudioI18n.set(lang);
                nodes[0].title = `Video ${lang}`;
                render();
            }, {theme, lang});
            await page.waitForTimeout(150);
            assert.equal(await page.evaluate(() => document.getElementById('previewCurrentVideo') === window.__laz52Video), true);
            assert.equal(await page.locator(`${node} video`).count(), 0);
            assert.equal(await page.locator('#previewVideoLoopBtn').innerText(), lang === 'en' ? 'Loop on' : '循环已开启');
        }
        await page.screenshot({path:'/tmp/laz-52-fullscreen.png'});
        await page.locator('#previewVideoLoopBtn').click();
        assert.equal(await page.evaluate(() => window.__laz52Video.loop), false);
        await page.evaluate(async () => {
            await window.__laz52Video.play();
            window.dispatchEvent(new Event('blur'));
            window.SmartCanvasModules.imageStudio.close();
        });
        assert.equal(await page.evaluate(() => window.__laz52Video.paused), true, 'Returning after interruption must stay paused');
        assert.equal(await page.locator(`${node} video`).evaluate(video => video === window.__laz52Video && !video.loop), true);

        // Browsers without atomic DOM moves still reuse the player and preserve playback.
        await page.evaluate(async () => {
            const video = window.__laz52Video;
            video.currentTime = 0.2;
            await new Promise(resolve => video.addEventListener('seeked', resolve, {once:true}));
            await video.play();
            const moveBefore = Element.prototype.moveBefore;
            try {
                Element.prototype.moveBefore = undefined;
                window.SmartCanvasModules.imageStudio.open({nodeId:'laz-52-video', groupAware:false});
                window.SmartCanvasModules.imageStudio.close();
            } finally {
                Element.prototype.moveBefore = moveBefore;
            }
        });
        await page.waitForTimeout(150);
        assert.equal(await page.locator(`${node} video`).evaluate(video => video === window.__laz52Video && !video.paused), true);

        // The same URL in another media instance has its own playback state.
        await page.evaluate(() => {
            nodes[0].images.push({...nodes[0].images[0], _inlineVideoActive:false});
            render();
            window.SmartCanvasModules.imageStudio.open({nodeId:'laz-52-video', imageIndex:0, groupAware:false});
        });
        await page.evaluate(() => navigatePreviewImage(1));
        await page.waitForFunction(() => {
            const video = document.getElementById('previewCurrentVideo');
            return video?.readyState >= 2 && !video.paused;
        });
        assert.equal(await page.evaluate(() => window.__laz52Video.paused), true);
        assert.equal(await page.evaluate(() => document.getElementById('previewCurrentVideo') !== window.__laz52Video), true);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('video,audio')].filter(media => !media.paused).length), 1);
        await page.evaluate(() => {
            window.__laz52DeletedVideo = document.getElementById('previewCurrentVideo');
            nodes.splice(0, nodes.length);
            render();
        });
        assert.equal(await page.evaluate(() => window.__laz52DeletedVideo.paused), true);
        assert.equal(await page.evaluate(() => window.__laz52DeletedVideo.isConnected), false);
        assert.equal(await page.evaluate(() => smartPlaybackSession.entries.size), 0);
        assert.equal(await page.evaluate(() => document.getElementById('imageEditModal').classList.contains('open')), false);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('video,audio')].some(media => !media.paused)), false);

        // A late metadata response must not undo an interruption or restart a removed player.
        const fixture = await page.request.get(`${baseUrl}/static/images/test/fixture.mp4`);
        const bytes = await fixture.body();
        let releaseMedia;
        const mediaGate = new Promise(resolve => { releaseMedia = resolve; });
        await page.route('**/laz-52-delayed.mp4', async route => {
            await mediaGate;
            await route.fulfill({status:200, contentType:'video/mp4', body:bytes});
        });
        await page.evaluate(() => {
            nodes.push({id:'laz-52-delayed', type:'smart-image', x:360, y:220, w:360, h:220,
                images:[{url:'/static/laz-52-delayed.mp4', kind:'video', natural_w:640, natural_h:360}]});
            selectedId = 'laz-52-delayed'; selectedImage = {nodeId:selectedId, index:0};
            render();
            window.__laz52Delayed = smartPlaybackActivateVideo(selectedId, 0);
            window.SmartCanvasModules.imageStudio.open({nodeId:selectedId, groupAware:false});
            smartPlaybackPauseForInterruption('test');
            window.SmartCanvasModules.imageStudio.close();
        });
        releaseMedia();
        await page.waitForFunction(() => window.__laz52Delayed.readyState >= 2);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => window.__laz52Delayed.paused), true);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('video,audio')].some(media => !media.paused)), false);
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.open({nodeId:'laz-52-delayed', groupAware:false}));
        await page.waitForFunction(() => document.getElementById('imageEditModal').dataset.motionState === 'open');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('imageEditModal').classList.contains('open'));
        assert.equal(await page.evaluate(() => window.__laz52Delayed.paused && window.__laz52Delayed.isConnected), true);
        assert.deepEqual(pageErrors, []);
        process.stdout.write('LAZ-52 video presentation browser smoke passed.\n');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
