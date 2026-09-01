const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const videoFixtureUrl = '/static/images/test/fixture.mp4';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:900}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=inline-video-play-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && customElements.get('ic-icon-button')
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));

        await page.evaluate(({videoUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                window.__installInlineVideoPlayFixture = mode => {
                    const count = mode === 'multi' ? 2 : 1;
                    const images = Array.from({length:count}, (_, index) => ({
                        url:${JSON.stringify(videoUrl)},
                        name:'video-' + (index + 1) + '.mp4',
                        kind:'video',
                        natural_w:640,
                        natural_h:360
                    }));
                    const node = {
                        id:'inline-video-node-a',
                        type:'smart-image',
                        title:'视频节点',
                        x:360,
                        y:220,
                        w:360,
                        h:220,
                        images
                    };
                    nodes.splice(0, nodes.length, node);
                    canvas = {id:'inline-video-play-regression', nodes, connections:[], logs:[]};
                    selectedId = '';
                    selectedIds = [];
                    selectedImage = {nodeId:'', index:-1};
                    composer?.classList.remove('focused');
                    syncPromptFocusBackdrop();
                    viewport.x = 0;
                    viewport.y = 0;
                    viewport.scale = 1;
                    render();
                };
                window.__addSecondInlineVideoNode = () => {
                    nodes.push({
                        id:'inline-video-node-b',
                        type:'smart-image',
                        title:'第二个视频节点',
                        x:780,
                        y:220,
                        w:360,
                        h:220,
                        images:[{
                            url:${JSON.stringify(videoUrl)},
                            name:'video-b.mp4',
                            kind:'video',
                            natural_w:640,
                            natural_h:360
                        }]
                    });
                    render();
                };
                window.__inlineVideoFixtureState = () => {
                    const node = nodes.find(item => item.id === 'inline-video-node-a');
                    return {
                        selectedId,
                        selectedImage:{...selectedImage},
                        active:(node?.images || []).map(item => Boolean(item._inlineVideoActive))
                    };
                };
                window.__installInlineVideoPlayFixture('single');
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {videoUrl:videoFixtureUrl});

        const nodeSelector = '.image-node[data-id="inline-video-node-a"]';
        const mainButton = page.locator(`${nodeSelector} .media-video-card > ic-video-play-button.smart-video-play`);
        await mainButton.waitFor();
        await page.waitForTimeout(250);

        const mainState = await mainButton.evaluate(button => ({
            tag:button.localName,
            size:button.getAttribute('size'),
            label:button.getAttribute('label'),
            ariaLabel:button.shadowRoot.querySelector('button')?.getAttribute('aria-label'),
            contract:button.dataset.icContractStatus,
            contractReason:button.dataset.icContractReason || '',
            nativeLightDomButtons:button.querySelectorAll('button').length,
        }));
        assert.deepEqual(mainState, {
            tag:'ic-video-play-button',
            size:'m',
            label:'播放',
            ariaLabel:'播放',
            contract:'ready',
            contractReason:'',
            nativeLightDomButtons:0,
        });

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await page.evaluate(async ({activeTheme, selector}) => {
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                await new Promise(resolve => setTimeout(resolve, 100));
                const button = document.querySelector(selector);
                const base = button.shadowRoot.querySelector('[part="base"]');
                const asset = button.shadowRoot.querySelector('[part="asset"]');
                return {
                    width:getComputedStyle(button).width,
                    height:getComputedStyle(button).height,
                    background:getComputedStyle(base).backgroundColor,
                    backdropFilter:getComputedStyle(base).backdropFilter,
                    asset:asset.getAttribute('src'),
                };
            }, {activeTheme:theme, selector:`${nodeSelector} .media-video-card > ic-video-play-button.smart-video-play`});
        }
        for (const theme of ['light', 'dark']) {
            assert.equal(themeStyles[theme].width, '64px');
            assert.equal(themeStyles[theme].height, '64px');
            assert.equal(themeStyles[theme].background, 'rgba(0, 0, 0, 0)');
            assert.equal(themeStyles[theme].backdropFilter, 'blur(10px)');
            assert.match(themeStyles[theme].asset, /\/static\/images\/ui\/video-play-button\.svg$/);
        }

        await page.locator(`${nodeSelector} .media-video-card`).click({force:true, position:{x:12, y:12}});
        await page.waitForTimeout(250);
        const afterMainDom = await page.evaluate(selector => {
            const node = document.querySelector(selector);
            const button = node?.querySelector('ic-video-play-button.smart-video-play');
            return {
                hasVideo:Boolean(node?.querySelector('video[data-inline-video-active="1"]')),
                buttonDisplay:button?.style.display || '',
                hasPreview:Boolean(node?.querySelector('img[data-preview-kind="video"]')),
                playerCount:node?.querySelectorAll('ic-media-player-controls').length || 0,
                videos:[...node?.querySelectorAll('video') || []].map(video => ({
                    inline:video.dataset.inlineVideoActive || '',
                    controls:video.controls,
                    loop:video.loop,
                    muted:video.muted,
                    noFullscreen:video.controlsList.contains('nofullscreen'),
                    dataUrl:video.dataset.url || '',
                })),
            };
        }, nodeSelector);
        assert.deepEqual(afterMainDom, {
            hasVideo:true,
            buttonDisplay:'',
            hasPreview:false,
            playerCount:0,
            videos:[{
                inline:'1',
                controls:true,
                loop:true,
                muted:false,
                noFullscreen:true,
                dataUrl:videoFixtureUrl,
            }],
        });
        const afterMainPlay = await page.evaluate(() => window.__inlineVideoFixtureState());
        assert.deepEqual(afterMainPlay, {
            selectedId:'inline-video-node-a',
            selectedImage:{nodeId:'inline-video-node-a', index:0},
            active:[true],
        });
        const nodeLoopButton = page.locator('#smartNodeFloatingPortal [data-smart-node-action="video-loop"]');
        await nodeLoopButton.waitFor();
        const nodeLoopDefault = await nodeLoopButton.evaluate(button => ({
            label:button.textContent.trim(),
            pressed:button.hasAttribute('pressed'),
            ariaPressed:button.getAttribute('aria-pressed'),
            icon:button.querySelector('ic-icon')?.getAttribute('name') || '',
            background:getComputedStyle(button.shadowRoot.querySelector('[part="base"]')).backgroundColor,
        }));
        assert.equal(nodeLoopDefault.label, '循环已开启');
        assert.equal(nodeLoopDefault.pressed, true);
        assert.equal(nodeLoopDefault.ariaPressed, 'true');
        assert.equal(nodeLoopDefault.icon, 'check');
        assert.equal(nodeLoopDefault.background, 'rgb(20, 20, 20)');

        const inlineVideo = page.locator(`${nodeSelector} video[data-inline-video-active="1"]`);
        await page.waitForFunction(selector => {
            const video = document.querySelector(selector);
            return Boolean(video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 2.5);
        }, `${nodeSelector} video[data-inline-video-active="1"]`);
        await inlineVideo.evaluate(async video => {
            video.currentTime = Math.max(0, video.duration - 0.2);
            if(Math.abs(video.currentTime - (video.duration - 0.2)) > 0.05){
                await new Promise(resolve => video.addEventListener('seeked', resolve, {once:true}));
            }
            await video.play();
        });
        await page.waitForFunction(selector => {
            const video = document.querySelector(selector);
            return Boolean(video && !video.paused && video.currentTime < 0.5);
        }, `${nodeSelector} video[data-inline-video-active="1"]`);
        const inlineLoopPlayback = await inlineVideo.evaluate(video => ({
            currentTime:video.currentTime,
            paused:video.paused,
        }));
        assert.equal(inlineLoopPlayback.paused, false, JSON.stringify(inlineLoopPlayback));
        assert.ok(inlineLoopPlayback.currentTime < 0.5, JSON.stringify(inlineLoopPlayback));
        const inlinePlaybackBeforeFullscreen = await inlineVideo.evaluate(async video => {
            video.currentTime = 2;
            if(Math.abs(video.currentTime - 2) > 0.05){
                await new Promise(resolve => video.addEventListener('seeked', resolve, {once:true}));
            }
            await video.play();
            return {currentTime:video.currentTime, paused:video.paused};
        });
        assert.ok(Math.abs(inlinePlaybackBeforeFullscreen.currentTime - 2) < 0.2, JSON.stringify(inlinePlaybackBeforeFullscreen));
        assert.equal(inlinePlaybackBeforeFullscreen.paused, false);
        await inlineVideo.dblclick({force:true, position:{x:24, y:24}});
        await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
        await page.waitForFunction(() => document.querySelector('#previewCurrentVideo')?.readyState >= 1);
        await page.waitForTimeout(150);
        const playbackHandoff = await page.evaluate(selector => {
            const background = document.querySelector(selector);
            const fullscreen = document.querySelector('#previewCurrentVideo');
            return {
                backgroundPaused:Boolean(background?.paused),
                backgroundTime:Number(background?.currentTime || 0),
                backgroundNoFullscreen:Boolean(background?.controlsList.contains('nofullscreen')),
                fullscreenPaused:Boolean(fullscreen?.paused),
                fullscreenTime:Number(fullscreen?.currentTime || 0),
                fullscreenNoFullscreen:Boolean(fullscreen?.controlsList.contains('nofullscreen')),
            };
        }, `${nodeSelector} video[data-inline-video-active="1"]`);
        assert.equal(playbackHandoff.backgroundPaused, true, JSON.stringify(playbackHandoff));
        assert.ok(Math.abs(playbackHandoff.backgroundTime - 2) < 0.35, JSON.stringify(playbackHandoff));
        assert.equal(playbackHandoff.backgroundNoFullscreen, true, JSON.stringify(playbackHandoff));
        assert.equal(playbackHandoff.fullscreenPaused, false, JSON.stringify(playbackHandoff));
        assert.ok(playbackHandoff.fullscreenTime >= 1.8, JSON.stringify(playbackHandoff));
        assert.equal(playbackHandoff.fullscreenNoFullscreen, true, JSON.stringify(playbackHandoff));

        await page.evaluate(() => {
            document.documentElement.classList.remove('theme-dark', 'studio-theme-dark');
            document.documentElement.dataset.uiTheme = 'light';
            document.documentElement.style.colorScheme = 'light';
            document.body.classList.remove('theme-dark', 'studio-theme-dark');
        });

        const loopButtonState = () => page.locator('#previewVideoLoopBtn').evaluate(button => {
            const base = button.shadowRoot?.querySelector('[part="base"]');
            return {
                label:button.textContent.trim(),
                icon:button.querySelector('ic-icon')?.getAttribute('name') || '',
                hierarchy:button.getAttribute('hierarchy'),
                pressed:button.hasAttribute('pressed'),
                ariaPressed:button.getAttribute('aria-pressed') || button.shadowRoot?.querySelector('button')?.getAttribute('aria-pressed') || '',
                background:base ? getComputedStyle(base).backgroundColor : '',
                color:base ? getComputedStyle(base).color : '',
                contract:button.dataset.icContractStatus || '',
                contractReason:button.dataset.icContractReason || '',
            };
        });
        const fullscreenLoopDefault = await loopButtonState();
        if(!fullscreenLoopDefault.pressed) await page.locator('#previewVideoLoopBtn').click();
        await page.locator('#previewVideoLoopBtn').click();
        await page.waitForFunction(() => {
            const button = document.querySelector('#previewVideoLoopBtn');
            const base = button?.shadowRoot?.querySelector('[part="base"]');
            return button && base && !button.hasAttribute('pressed') && getComputedStyle(base).backgroundColor !== 'rgb(20, 20, 20)';
        });
        const fullscreenLoopOff = await loopButtonState();
        assert.equal(fullscreenLoopOff.label, '自动循环');
        assert.equal(fullscreenLoopOff.icon, 'loop');
        assert.equal(fullscreenLoopOff.hierarchy, 'secondary');
        assert.equal(fullscreenLoopOff.pressed, false);
        assert.equal(fullscreenLoopOff.ariaPressed, 'false');
        assert.equal(await page.locator('#previewCurrentVideo').evaluate(video => video.loop), false);

        assert.equal(fullscreenLoopDefault.pressed, true);
        await page.locator('#previewCurrentVideo').evaluate(async video => {
            video.currentTime = 3;
            await video.play();
        });
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        await page.waitForFunction(selector => {
            const video = document.querySelector(selector);
            return Boolean(video && !video.paused && !video.loop && video.currentTime >= 2.8);
        }, `${nodeSelector} video[data-inline-video-active="1"]`);
        const inlineAfterFullscreenClose = await page.locator(`${nodeSelector} video[data-inline-video-active="1"]`).evaluate(video => ({
            currentTime:video.currentTime,
            paused:video.paused,
            loop:video.loop,
        }));
        assert.equal(inlineAfterFullscreenClose.paused, false, JSON.stringify(inlineAfterFullscreenClose));
        assert.equal(inlineAfterFullscreenClose.loop, false, JSON.stringify(inlineAfterFullscreenClose));
        assert.ok(inlineAfterFullscreenClose.currentTime >= 2.8, JSON.stringify(inlineAfterFullscreenClose));
        const nodeLoopOff = await nodeLoopButton.evaluate(button => ({
            label:button.textContent.trim(),
            pressed:button.hasAttribute('pressed'),
            icon:button.querySelector('ic-icon')?.getAttribute('name') || '',
        }));
        assert.deepEqual(nodeLoopOff, {label:'自动循环', pressed:false, icon:'loop'});

        await page.locator('#smartNodeFloatingPortal [data-smart-node-action="video-play"]').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
        const fullscreenLoopPersistedOff = await loopButtonState();
        assert.equal(fullscreenLoopPersistedOff.label, '自动循环');
        assert.equal(fullscreenLoopPersistedOff.pressed, false);
        assert.equal(fullscreenLoopPersistedOff.icon, 'loop');
        assert.equal(await page.locator('#previewCurrentVideo').evaluate(video => video.loop), false);

        await page.locator('#previewVideoLoopBtn').click();
        await page.waitForFunction(() => {
            const base = document.querySelector('#previewVideoLoopBtn')?.shadowRoot?.querySelector('[part="base"]');
            return base && getComputedStyle(base).backgroundColor === 'rgb(20, 20, 20)';
        });
        const fullscreenLoopOnAgain = await loopButtonState();
        assert.equal(fullscreenLoopOnAgain.label, '循环已开启');
        assert.equal(fullscreenLoopOnAgain.icon, 'check');
        assert.equal(fullscreenLoopOnAgain.hierarchy, 'secondary');
        assert.equal(fullscreenLoopOnAgain.pressed, true);
        assert.equal(fullscreenLoopOnAgain.ariaPressed, 'true');
        assert.equal(fullscreenLoopOnAgain.background, 'rgb(20, 20, 20)', JSON.stringify(fullscreenLoopOnAgain));
        assert.equal(fullscreenLoopOnAgain.color, 'rgb(255, 255, 255)');
        assert.equal(fullscreenLoopOnAgain.contract, 'ready', fullscreenLoopOnAgain.contractReason);
        assert.notEqual(fullscreenLoopOnAgain.background, fullscreenLoopOff.background);
        assert.equal(await page.locator('#previewCurrentVideo').evaluate(video => video.loop), true);
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        await page.locator('#smartNodeFloatingPortal [data-smart-node-action="video-play"]').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
        const fullscreenLoopReset = await loopButtonState();
        assert.equal(fullscreenLoopReset.label, '循环已开启');
        assert.equal(fullscreenLoopReset.icon, 'check');
        assert.equal(fullscreenLoopReset.hierarchy, 'secondary');
        assert.equal(fullscreenLoopReset.pressed, true);
        assert.equal(await page.locator('#previewCurrentVideo').evaluate(video => video.loop), true);
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());

        await page.locator(`${nodeSelector} video[data-inline-video-active="1"]`).evaluate(async video => {
            video.currentTime = 4;
            await video.play();
        });
        await page.evaluate(() => window.__addSecondInlineVideoNode());
        await page.waitForTimeout(350);
        const secondNodeSelector = '.image-node[data-id="inline-video-node-b"]';
        await page.locator(`${secondNodeSelector} .media-video-card`).click({force:true, position:{x:12, y:12}});
        await page.waitForTimeout(700);
        const selectionSwitchState = await page.evaluate(({first, second}) => {
            const firstNode = document.querySelector(first);
            const secondVideo = document.querySelector(second)?.querySelector('video[data-inline-video-active="1"]');
            return {
                selectedId,
                firstHasButton:Boolean(firstNode?.querySelector('ic-video-play-button.smart-video-play')),
                firstHasActiveVideo:Boolean(firstNode?.querySelector('video[data-inline-video-active="1"]')),
                secondHasButton:Boolean(document.querySelector(second)?.querySelector('ic-video-play-button.smart-video-play')),
                secondHasActiveVideo:Boolean(secondVideo),
                secondPaused:secondVideo?.paused,
            };
        }, {first:nodeSelector, second:secondNodeSelector});
        assert.equal(selectionSwitchState.selectedId, 'inline-video-node-b', JSON.stringify(selectionSwitchState));
        assert.equal(selectionSwitchState.firstHasButton, true, JSON.stringify(selectionSwitchState));
        assert.equal(selectionSwitchState.firstHasActiveVideo, false, JSON.stringify(selectionSwitchState));
        assert.equal(selectionSwitchState.secondHasActiveVideo, true, JSON.stringify(selectionSwitchState));
        assert.equal(selectionSwitchState.secondPaused, false, JSON.stringify(selectionSwitchState));
        const afterSelectingSecondVideo = await page.evaluate(({first, second}) => ({
            selectedId,
            firstHasCover:Boolean(document.querySelector(first)?.querySelector('ic-video-play-button.smart-video-play')),
            secondPlaying:Boolean(document.querySelector(second)?.querySelector('video[data-inline-video-active="1"]') && !document.querySelector(second).querySelector('video').paused),
        }), {first:nodeSelector, second:secondNodeSelector});
        assert.deepEqual(afterSelectingSecondVideo, {
            selectedId:'inline-video-node-b',
            firstHasCover:true,
            secondPlaying:true,
        });

        await page.waitForTimeout(350);
        await page.locator(`${nodeSelector} .media-video-card`).click({force:true, position:{x:12, y:12}});
        await page.waitForFunction(({first, second}) => {
            const firstVideo = document.querySelector(first)?.querySelector('video[data-inline-video-active="1"]');
            return Boolean(
                firstVideo
                && !firstVideo.paused
                && firstVideo.currentTime >= 3.8
                && document.querySelector(second)?.querySelector('ic-video-play-button.smart-video-play')
            );
        }, {first:nodeSelector, second:secondNodeSelector});
        const resumedFirstVideo = await page.locator(`${nodeSelector} video[data-inline-video-active="1"]`).evaluate(video => ({
            currentTime:video.currentTime,
            paused:video.paused,
        }));
        assert.equal(resumedFirstVideo.paused, false, JSON.stringify(resumedFirstVideo));
        assert.ok(resumedFirstVideo.currentTime >= 3.8, JSON.stringify(resumedFirstVideo));

        await page.locator(`${nodeSelector} video[data-inline-video-active="1"]`).click({position:{x:20, y:20}});
        await page.waitForFunction(selector => document.querySelector(selector)?.paused === true, `${nodeSelector} video[data-inline-video-active="1"]`);
        await page.locator(`${nodeSelector} video[data-inline-video-active="1"]`).click({position:{x:20, y:20}});
        await page.waitForFunction(selector => document.querySelector(selector)?.paused === false, `${nodeSelector} video[data-inline-video-active="1"]`);
        const selectedClickPlaybackToggle = {paused:false};

        await page.keyboard.press('Space');
        await page.waitForFunction(selector => document.querySelector(selector)?.paused === true, `${nodeSelector} video[data-inline-video-active="1"]`);
        await page.keyboard.press('Space');
        await page.waitForFunction(selector => document.querySelector(selector)?.paused === false, `${nodeSelector} video[data-inline-video-active="1"]`);
        const keyboardPlaybackToggle = {paused:false};

        await page.evaluate(() => document.getElementById('smartShortcutDialog')?.show?.());
        await page.waitForFunction(selector => document.querySelector(selector)?.paused === true, `${nodeSelector} video[data-inline-video-active="1"]`);
        await page.evaluate(() => document.getElementById('smartShortcutDialog')?.hide?.());
        await page.waitForTimeout(100);
        const dialogPausedWithoutResume = await page.locator(`${nodeSelector} video[data-inline-video-active="1"]`).evaluate(video => video.paused);
        assert.equal(dialogPausedWithoutResume, true);

        await page.evaluate(() => {
            selectedId = '';
            selectedIds = ['inline-video-node-a', 'inline-video-node-b'];
            selectedImage = {nodeId:'', index:-1};
            render();
        });
        await page.waitForFunction(({first, second}) => [first, second].every(selector => {
            const node = document.querySelector(selector);
            return node?.querySelector('ic-video-play-button.smart-video-play') && !node.querySelector('video[data-inline-video-active="1"]');
        }), {first:nodeSelector, second:secondNodeSelector});
        const multiSelectionPaused = true;
        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.selection.clear();
            render();
        });
        await page.waitForFunction(() => !document.getElementById('smartMultiSelectionBox')?.hasAttribute('open'));
        await page.locator(`${nodeSelector} .media-video-card`).click({position:{x:12, y:12}});
        await page.waitForFunction(selector => {
            const video = document.querySelector(selector)?.querySelector('video[data-inline-video-active="1"]');
            return Boolean(video && !video.paused && video.currentTime >= 3.8);
        }, nodeSelector);

        await page.evaluate(selector => {
            document.querySelector(selector)?.querySelectorAll('video[data-inline-video-active]')
                .forEach(video => delete video.dataset.inlineVideoActive);
            window.__installInlineVideoPlayFixture('multi');
        }, nodeSelector);
        const thumbButtons = page.locator(`${nodeSelector} .thumb-item ic-video-play-button.thumb-video-play`);
        await page.waitForFunction(selector => {
            const buttons = [...document.querySelectorAll(selector)];
            return buttons.length === 2 && buttons.every(button => button.dataset.icContractStatus === 'ready');
        }, `${nodeSelector} .thumb-item ic-video-play-button.thumb-video-play`);
        assert.equal(await thumbButtons.count(), 2);
        assert.deepEqual(await thumbButtons.evaluateAll(buttons => buttons.map(button => ({
            size:button.getAttribute('size'),
            width:getComputedStyle(button).width,
            height:getComputedStyle(button).height,
        }))), [
            {size:'s', width:'32px', height:'32px'},
            {size:'s', width:'32px', height:'32px'},
        ]);
        await thumbButtons.first().locator('button').click();
        await page.waitForFunction(selector => {
            const video = document.querySelector(selector)?.querySelector('video[data-url]');
            const item = document.querySelector(selector);
            return Boolean(
                video
                && video.controls
                && video.loop
                && !video.muted
                && video.controlsList.contains('nofullscreen')
                && item?.querySelectorAll('ic-media-player-controls').length === 0
            );
        }, `${nodeSelector} .thumb-item[data-image-index="0"]`);
        const afterThumbPlay = await page.evaluate(() => window.__inlineVideoFixtureState());
        assert.deepEqual(afterThumbPlay, {
            selectedId:'inline-video-node-a',
            selectedImage:{nodeId:'inline-video-node-a', index:0},
            active:[true, false],
        });

        const casePage = await context.newPage();
        await casePage.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/action-case.html?case=inline-video-play&theme=light&viewport=desktop&locale=zh-CN&content=normal&density=medium&motion=standard`, {
            waitUntil:'domcontentloaded',
        });
        await casePage.waitForFunction(() => document.documentElement.dataset.actionCaseStatus === 'ready');
        const libraryPattern = await casePage.locator('[data-component-name="ic-video-play-button"]').evaluate(section => ({
            title:section.querySelector('h2')?.textContent.trim(),
            buttons:[...section.querySelectorAll('ic-video-play-button')].map(button => ({
                size:button.getAttribute('size'),
                label:button.getAttribute('label'),
                contract:button.dataset.icContractStatus,
            })),
        }));
        assert.deepEqual(libraryPattern, {
            title:'视频封面播放按钮',
            buttons:[
                {size:'m', label:'播放', contract:'ready'},
                {size:'s', label:'播放缩略视频', contract:'ready'},
            ],
        });
        await casePage.screenshot({
            path:'/tmp/smart-canvas-inline-video-play-library-light.png',
            fullPage:true,
        });

        process.stdout.write(`${JSON.stringify({mainState, themeStyles, afterMainPlay, nodeLoopDefault, inlineLoopPlayback, inlinePlaybackBeforeFullscreen, playbackHandoff, fullscreenLoopDefault, fullscreenLoopOff, inlineAfterFullscreenClose, fullscreenLoopPersistedOff, fullscreenLoopOnAgain, fullscreenLoopReset, afterSelectingSecondVideo, resumedFirstVideo, selectedClickPlaybackToggle, keyboardPlaybackToggle, dialogPausedWithoutResume, multiSelectionPaused, afterThumbPlay, libraryPattern})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
