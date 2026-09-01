const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
    'base64',
);
const STALE_MODEL = 'gemini-3.1-flash-image';
const AVAILABLE_MODEL = 'replacement-image-model';
const LARGE_SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160" viewBox="0 0 3840 2160"><rect width="3840" height="2160" fill="#64748b"/></svg>',
);

function canvasFixture() {
    return {
        id:'viewport-model-regression',
        title:'Viewport and model validation regression',
        revision:0,
        nodes:[
            {
                id:'media-node',
                type:'smart-image',
                x:120,
                y:120,
                w:320,
                h:180,
                uploadedAttachment:true,
                images:[{
                    url:'/assets/regression/viewport.png',
                    name:'viewport.png',
                    kind:'image',
                    natural_w:1600,
                    natural_h:900,
                }],
            },
            {
                id:'generation-node',
                type:'smart-image',
                x:520,
                y:120,
                w:260,
                h:178,
                images:[],
                generationOutputNode:true,
                runSettings:{
                    engine:'api',
                    apiKind:'image',
                    provider_id:'custom-api',
                    model:STALE_MODEL,
                    ratio:'1:1',
                    resolution:'1k',
                    count:1,
                },
            },
        ],
        connections:[],
        settings:{
            engine:'api',
            apiKind:'image',
            provider_id:'custom-api',
            model:STALE_MODEL,
            ratio:'1:1',
            resolution:'1k',
            count:1,
        },
        logs:[],
    };
}

function configFixture() {
    return {
        api_providers:[{
            id:'custom-api',
            name:'Custom API',
            enabled:true,
            image_models:[STALE_MODEL, AVAILABLE_MODEL],
            video_models:[],
            chat_models:[],
        }],
        available_models:{
            image:[{
                id:`custom-api|${encodeURIComponent(AVAILABLE_MODEL)}`,
                provider_id:'custom-api',
                provider_name:'Custom API',
                model:AVAILABLE_MODEL,
                name:AVAILABLE_MODEL,
                visible:true,
            }],
            video:[],
            text:[],
        },
        comfy_instances:[],
    };
}

async function fulfillWorkspaceFile(route) {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
        await route.fulfill({status:403, body:'Forbidden'});
        return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        await route.fulfill({status:404, body:'Not found'});
        return;
    }
    await route.fulfill({path:filePath});
}

async function settleFrames(page, count=3) {
    await page.evaluate(frameCount => new Promise(resolve => {
        let remaining = frameCount;
        const next = () => {
            remaining -= 1;
            if (remaining <= 0) resolve();
            else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
    }), count);
}

(async () => {
    if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
    const browser = await chromium.launch({headless:true, executablePath:CHROME});
    const context = await browser.newContext({viewport:{width:1280, height:820}});
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const browserErrors = [];
    let previewRequests = 0;
    const previewWidths = [];
    let studioOriginalRequests = 0;
    let studioBrokenOriginalRequests = 0;
    try {
        await page.addInitScript(() => {
            class SmokeWebSocket {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;
                constructor(url) {
                    this.url = url;
                    this.readyState = SmokeWebSocket.CONNECTING;
                    this.listeners = new Map();
                    setTimeout(() => {
                        this.readyState = SmokeWebSocket.OPEN;
                        this.emit('open', {});
                    }, 0);
                }
                addEventListener(type, listener) {
                    const listeners = this.listeners.get(type) || [];
                    listeners.push(listener);
                    this.listeners.set(type, listeners);
                }
                removeEventListener(type, listener) {
                    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
                }
                emit(type, event) {
                    this[`on${type}`]?.(event);
                    (this.listeners.get(type) || []).forEach(listener => listener(event));
                }
                send() {}
                close() {
                    this.readyState = SmokeWebSocket.CLOSED;
                    this.emit('close', {code:1000});
                }
            }
            window.WebSocket = SmokeWebSocket;
        });
        await page.route('http://canvas.local/**', async route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/media-preview') {
                previewRequests += 1;
                previewWidths.push(Number(url.searchParams.get('w') || 0));
                if (url.searchParams.get('url') === '/assets/regression/lod-video-broken.mp4') {
                    await route.fulfill({status:200, contentType:'image/png', body:'broken poster'});
                    return;
                }
                await route.fulfill({
                    status:200,
                    headers:{'Cache-Control':'no-store'},
                    contentType:'image/png',
                    body:TINY_PNG,
                });
                return;
            }
            if (url.pathname === '/assets/regression/viewport.png') {
                await route.fulfill({status:503, body:'transient original failure'});
                return;
            }
            if (url.pathname === '/assets/regression/studio-original.png') {
                studioOriginalRequests += 1;
                await route.fulfill({status:200, contentType:'image/svg+xml', body:LARGE_SVG});
                return;
            }
            if (url.pathname === '/assets/regression/studio-broken.png') {
                studioBrokenOriginalRequests += 1;
                await route.fulfill({status:200, contentType:'image/png', body:'broken original'});
                return;
            }
            if (
                url.pathname.startsWith('/assets/regression/lod-')
                || url.pathname.startsWith('/assets/regression/group-')
            ) {
                await route.fulfill({status:200, contentType:'image/png', body:TINY_PNG});
                return;
            }
            if (url.pathname === '/api/config') {
                await route.fulfill({
                    status:200,
                    contentType:'application/json',
                    body:JSON.stringify(configFixture()),
                });
                return;
            }
            const body = url.pathname === '/api/workflows'
                ? {workflows:[]}
                : url.pathname === '/api/prompt-libraries'
                ? {library:{libraries:[]}}
                : url.pathname === '/api/smart-canvas/prompt-templates'
                ? {templates:[]}
                : url.pathname.endsWith('/view-state')
                ? {view_state:null}
                : url.pathname.startsWith('/api/canvases/')
                ? {canvas:canvasFixture()}
                : null;
            if (body !== null) {
                await route.fulfill({
                    status:200,
                    contentType:'application/json',
                    body:JSON.stringify(body),
                });
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                await route.fulfill({status:200, contentType:'application/json', body:'{}'});
                return;
            }
            await fulfillWorkspaceFile(route);
        });
        page.on('console', message => {
            if (message.type() === 'error') browserErrors.push(message.text());
        });
        page.on('pageerror', error => browserErrors.push(error.stack || error.message));

        await page.goto('http://canvas.local/static/smart-canvas.html?id=viewport-model-regression', {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => (
            document.title === 'Viewport and model validation regression'
            && document.querySelector('.image-node[data-id="media-node"] img')?.naturalWidth > 0
        ));
        await settleFrames(page);

        const beforeComposer = await page.evaluate(() => ({
            toast:document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
            toastVisible:Boolean(document.querySelector('ic-toast[data-ic-overlay]')),
            selectedModel:settings.model,
            composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
        }));
        const farModeSettings = await page.evaluate(() => ({
            enabled:document.querySelector('#smartFarModeToggle')?.getAttribute('aria-checked') || '',
            value:document.querySelector('#smartFarModeThreshold')?.value || '',
            min:document.querySelector('#smartFarModeThreshold')?.min || '',
            max:document.querySelector('#smartFarModeThreshold')?.max || '',
            output:document.querySelector('#smartFarModeThresholdValue')?.textContent?.trim() || '',
        }));

        await page.evaluate(() => {
            nodes.push(
                {
                    id:'lod-multi-node', type:'smart-image', x:850, y:120, w:320, h:180,
                    uploadedAttachment:true,
                    images:[0, 1, 2].map(index => ({
                        url:`/assets/regression/lod-${index}.png`, name:`lod-${index}.png`,
                        kind:'image', natural_w:1600, natural_h:900,
                    })),
                },
                {
                    id:'lod-video-node', type:'smart-image', x:1220, y:120, w:320, h:180,
                    uploadedAttachment:true,
                    images:[{
                        url:'/assets/regression/lod-video.mp4', name:'lod-video.mp4',
                        kind:'video', natural_w:1920, natural_h:1080, _inlineVideoActive:true,
                    }],
                },
                {
                    id:'lod-video-broken-node', type:'smart-image', x:1220, y:340, w:320, h:180,
                    uploadedAttachment:true,
                    images:[{
                        url:'/assets/regression/lod-video-broken.mp4', name:'lod-video-broken.mp4',
                        kind:'video', natural_w:1920, natural_h:1080,
                    }],
                },
                {
                    id:'lod-audio-node', type:'smart-image', x:2310, y:120, w:320, h:180,
                    uploadedAttachment:true,
                    images:[{
                        url:'/assets/regression/lod-audio.mp3', name:'lod-audio.mp3',
                        kind:'audio', mime:'audio/mpeg',
                    }],
                },
                {
                    id:'lod-prompt-node', type:'smart-prompt', x:1590, y:120, w:320, h:220,
                    title:'Campaign prompt', text:'A detailed editable prompt',
                },
                {
                    id:'lod-prompt-generation-node', type:'smart-prompt', x:1590, y:380, w:320, h:220,
                    title:'Prompt generator', text:'Transform this prompt', llmEnabled:true,
                },
                {
                    id:'lod-pending-node', type:'smart-image', x:1940, y:120, w:320, h:180,
                    title:'Pending image', pending:true, running:true, outputKind:'image', images:[],
                },
                {
                    id:'lod-empty-upload-node', type:'smart-image', x:1940, y:340, w:320, h:180,
                    title:'Empty upload', images:[],
                },
                {
                    id:'lod-smart-group', type:'smart-group', x:800, y:500, w:340, h:286,
                    title:'品牌灵感', items:[], images:[
                        {url:'/assets/regression/group-0.png', kind:'image', natural_w:1200, natural_h:800},
                        {url:'/assets/regression/group-1.png', kind:'image', natural_w:1200, natural_h:800},
                    ],
                },
                {
                    id:'lod-frame', type:'smart-frame', x:500, y:380, w:700, h:420,
                    title:'发布流程', frameColor:'blue',
                },
                {
                    id:'lod-small-group', type:'smart-group', x:250, y:520, w:60, h:36,
                    title:'小型分组', items:[], images:[],
                },
                {
                    id:'lod-collision-group', type:'smart-group', x:1230, y:500, w:420, h:260,
                    title:'碰撞分组', items:[], images:[],
                },
                {
                    id:'lod-collision-frame', type:'smart-frame', x:1230, y:500, w:420, h:260,
                    title:'碰撞 Frame', frameColor:'purple',
                },
            );
            canvas.connections.push({from:'media-node', to:'lod-multi-node', kind:'flow'});
            render();
        });
        await settleFrames(page, 5);
        const detailAudioPresentation = await page.evaluate(() => {
            const audioCard = document.querySelector('.image-node[data-id="lod-audio-node"] .media-audio-card');
            const style = audioCard ? getComputedStyle(audioCard) : null;
            return {
                backgroundImage:style?.backgroundImage || '',
                backgroundColor:style?.backgroundColor || '',
                borderColor:style?.borderColor || '',
                borderStyle:style?.borderStyle || '',
            };
        });

        const lodHysteresis = [];
        let farPresentation = null;
        let farModeDoubleClickPreview = null;
        for (const scale of [0.22, 0.24, 0.29]) {
            await page.evaluate(nextScale => {
                viewport.scale = nextScale;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
            }, scale);
            await settleFrames(page);
            lodHysteresis.push(await page.evaluate(() => ({
                mode:document.querySelector('#shell')?.dataset.canvasLod || '',
                scale:Number(viewport.scale || 0),
            })));
            if (scale === 0.22) {
                farPresentation = await page.evaluate(() => {
                    const node = id => document.querySelector(`.image-node[data-id="${id}"]`);
                    const pendingNode = node('lod-pending-node');
                    const gradientSurfaces = pendingNode
                        ? [pendingNode, ...pendingNode.querySelectorAll('*')].filter(element => (
                            getComputedStyle(element).backgroundImage.includes('gradient')
                        ))
                        : [];
                    const pendingSurface = gradientSurfaces[0] || pendingNode;
                    const pendingStyle = pendingSurface ? getComputedStyle(pendingSurface) : null;
                    const pendingRect = pendingNode?.getBoundingClientRect();
                    const pendingSurfaceRect = pendingSurface?.getBoundingClientRect();
                    const promptSkeleton = node('lod-prompt-node')?.querySelector('.far-prompt-skeleton-line');
                    const selectedHoverProbe = document.createElement('span');
                    selectedHoverProbe.style.background = 'var(--ui-color-action-secondary-selected-hover)';
                    document.body.appendChild(selectedHoverProbe);
                    const selectedHoverColor = getComputedStyle(selectedHoverProbe).backgroundColor;
                    selectedHoverProbe.remove();
                    const surfaceProbe = document.createElement('span');
                    surfaceProbe.style.background = 'var(--ui-color-surface)';
                    document.body.appendChild(surfaceProbe);
                    const surfaceColor = getComputedStyle(surfaceProbe).backgroundColor;
                    surfaceProbe.remove();
                    const raisedProbe = document.createElement('span');
                    raisedProbe.style.boxShadow = 'var(--ui-shadow-raised)';
                    document.body.appendChild(raisedProbe);
                    const raisedShadow = getComputedStyle(raisedProbe).boxShadow;
                    raisedProbe.remove();
                    const componentStyle = id => {
                        const element = node(id);
                        const style = element ? getComputedStyle(element) : null;
                        return {
                            background:style?.backgroundColor || '',
                            borderColor:style?.borderColor || '',
                            borderRadius:style?.borderRadius || '',
                        };
                    };
                    const promptSkeletonState = id => {
                        const element = node(id);
                        const height = Number.parseFloat(element ? getComputedStyle(element).height : '0');
                        const expectedLines = Math.min(24, Math.max(1, Math.floor((height - 2 - 40 + 10) / 19)));
                        return {
                            height,
                            lines:element?.querySelectorAll('.far-prompt-skeleton-line').length ?? -1,
                            expectedLines,
                        };
                    };
                    const mediaBoundaryState = (id, placeholderSelector) => {
                        const element = node(id);
                        const placeholder = element?.querySelector(placeholderSelector);
                        const nodeStyle = element ? getComputedStyle(element) : null;
                        const placeholderStyle = placeholder ? getComputedStyle(placeholder) : null;
                        return {
                            nodeBorderRadius:nodeStyle?.borderRadius || '',
                            nodeBorderStyle:nodeStyle?.borderStyle || '',
                            nodeOverflow:nodeStyle?.overflow || '',
                            placeholderBorderRadius:placeholderStyle?.borderRadius || '',
                        };
                    };
                    return {
                        multiImageCount:node('lod-multi-node')?.querySelectorAll('img').length ?? -1,
                        videoElementCount:node('lod-video-node')?.querySelectorAll('video').length ?? -1,
                        videoPosterCount:node('lod-video-node')?.querySelectorAll('img').length ?? -1,
                        brokenVideoElementCount:node('lod-video-broken-node')?.querySelectorAll('video').length ?? -1,
                        brokenVideoPlaceholderCount:node('lod-video-broken-node')?.querySelectorAll('.far-node-video-placeholder ic-icon[name="video"]').length ?? -1,
                        audioElementCount:node('lod-audio-node')?.querySelectorAll('audio').length ?? -1,
                        audioIconCount:node('lod-audio-node')?.querySelectorAll('.far-node-audio ic-icon[name="audio"]').length ?? -1,
                        audioIconColor:(() => {
                            const icon = node('lod-audio-node')?.querySelector('.far-node-audio ic-icon[name="audio"]');
                            return icon ? getComputedStyle(icon).color : '';
                        })(),
                        audioPlaceholderStyle:(() => {
                            const placeholder = node('lod-audio-node')?.querySelector('.far-node-audio');
                            const style = placeholder ? getComputedStyle(placeholder) : null;
                            return {
                                backgroundImage:style?.backgroundImage || '',
                                backgroundColor:style?.backgroundColor || '',
                                borderColor:style?.borderColor || '',
                                borderStyle:style?.borderStyle || '',
                            };
                        })(),
                        audioPlaceholderFillsNode:(() => {
                            const audioNode = node('lod-audio-node');
                            const bodyRect = audioNode?.querySelector('.node-body')?.getBoundingClientRect();
                            const placeholderRect = audioNode?.querySelector('.far-node-audio')?.getBoundingClientRect();
                            return Boolean(
                                bodyRect && placeholderRect
                                && Math.abs(bodyRect.width - placeholderRect.width) < 1
                                && Math.abs(bodyRect.height - placeholderRect.height) < 1
                            );
                        })(),
                        audioGeometry:(() => {
                            const rect = selector => {
                                const value = selector?.getBoundingClientRect();
                                return value ? {width:value.width, height:value.height} : null;
                            };
                            const audioNode = node('lod-audio-node');
                            return {
                                node:rect(audioNode),
                                body:rect(audioNode?.querySelector('.node-body')),
                                placeholder:rect(audioNode?.querySelector('.far-node-audio')),
                            };
                        })(),
                        audioBoundary:mediaBoundaryState('lod-audio-node', '.far-node-audio'),
                        videoBoundary:mediaBoundaryState('lod-video-broken-node', '.far-node-video-placeholder'),
                        promptControlCount:node('lod-prompt-node')?.querySelectorAll('textarea,input,ic-prompt-composer,[contenteditable]').length ?? -1,
                        promptSkeletonLines:node('lod-prompt-node')?.querySelectorAll('.far-prompt-skeleton-line').length ?? -1,
                        promptSkeletonState:promptSkeletonState('lod-prompt-node'),
                        promptVisibleText:node('lod-prompt-node')?.innerText?.trim() || '',
                        promptGenerationControlCount:node('lod-prompt-generation-node')?.querySelectorAll('textarea,input,ic-prompt-composer,[contenteditable]').length ?? -1,
                        promptGenerationSkeletonLines:node('lod-prompt-generation-node')?.querySelectorAll('.far-prompt-skeleton-line').length ?? -1,
                        promptGenerationSkeletonState:promptSkeletonState('lod-prompt-generation-node'),
                        promptGenerationVisibleText:node('lod-prompt-generation-node')?.innerText?.trim() || '',
                        pendingText:pendingNode?.innerText?.trim() || '',
                        pendingBackgroundImage:pendingStyle?.backgroundImage || '',
                        pendingBorderStyle:pendingNode ? getComputedStyle(pendingNode).borderStyle : '',
                        emptyUploadText:node('lod-empty-upload-node')?.innerText?.trim() || '',
                        emptyUploadBackground:(() => {
                            const marker = node('lod-empty-upload-node')?.querySelector('.far-node-marker');
                            return marker ? getComputedStyle(marker).backgroundColor : '';
                        })(),
                        surfaceColor,
                        pendingGradientSurfaceCount:gradientSurfaces.length,
                        pendingSurfaceFillsNode:Boolean(
                            pendingRect && pendingSurfaceRect
                            && Math.abs(pendingRect.left - pendingSurfaceRect.left) < 1
                            && Math.abs(pendingRect.top - pendingSurfaceRect.top) < 1
                            && Math.abs(pendingRect.width - pendingSurfaceRect.width) < 1
                            && Math.abs(pendingRect.height - pendingSurfaceRect.height) < 1
                        ),
                        promptSkeletonColor:promptSkeleton ? getComputedStyle(promptSkeleton).backgroundColor : '',
                        selectedHoverColor,
                        groupGridCount:node('lod-smart-group')?.querySelectorAll('.far-smart-group-media-skeleton').length ?? -1,
                        groupSkeletonCount:node('lod-smart-group')?.querySelectorAll('.far-smart-group-media-skeleton-item').length ?? -1,
                        groupImageIconCount:node('lod-smart-group')?.querySelectorAll('.far-smart-group-media-skeleton-item ic-icon[name="image"]').length ?? -1,
                        groupMountedImageCount:node('lod-smart-group')?.querySelectorAll('img').length ?? -1,
                        groupImageIconColor:(() => {
                            const icon = node('lod-smart-group')?.querySelector('.far-smart-group-media-skeleton-item ic-icon[name="image"]');
                            return icon ? getComputedStyle(icon).color : '';
                        })(),
                        connectionCount:document.querySelectorAll('.connection-materialization').length,
                        navigationLabels:[...document.querySelectorAll('#smartNavigationLabels [data-navigation-label]')]
                            .map(label => ({
                                text:label.textContent?.trim() || '',
                                kind:label.dataset.navigationKind || '',
                                fontSize:getComputedStyle(label).fontSize,
                                background:getComputedStyle(label).backgroundColor,
                                borderColor:getComputedStyle(label).borderColor,
                                borderRadius:getComputedStyle(label).borderRadius,
                                boxShadow:getComputedStyle(label).boxShadow,
                            })),
                        groupComponentStyle:componentStyle('lod-smart-group'),
                        frameComponentStyle:componentStyle('lod-frame'),
                        raisedShadow,
                        diagnostics:window.SmartCanvasModules.canvasLevelOfDetail.diagnostics(),
                    };
                });
                await page.evaluate(() => {
                    window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:1010, y:210});
                });
                await settleFrames(page, 2);
                await page.locator('.image-node[data-id="lod-multi-node"] .far-node-media img').dblclick();
                await page.waitForFunction(() => window.SmartCanvasModules.imageStudio.isOpen());
                farModeDoubleClickPreview = await page.evaluate(() => ({
                    open:window.SmartCanvasModules.imageStudio.isOpen(),
                    previewSelected:document.querySelector('[data-image-edit-mode="preview"]')
                        ?.getAttribute('aria-selected') === 'true',
                    previewVisible:getComputedStyle(document.querySelector('#previewStage')).display !== 'none',
                }));
                await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
            }
        }
        await page.evaluate(() => {
            const fixtureIndex = nodes.findIndex(node => node.id === 'lod-empty-upload-node');
            if(fixtureIndex >= 0) nodes.splice(fixtureIndex, 1);
            render();
        });
        await settleFrames(page, 2);
        await page.evaluate(() => {
            selectedId = 'lod-video-node';
            selectedIds = ['lod-video-node'];
            window.SmartCanvasModules.viewportSelection.selection.refresh();
        });
        const deleteStartedAt = Date.now();
        await page.keyboard.press('Delete');
        await page.waitForFunction(() => !document.querySelector('.image-node[data-id="lod-video-node"]'));
        const deleteInteractionMs = Date.now() - deleteStartedAt;
        const labelPriorityBeforeSelection = await page.evaluate(() => {
            const labels = [...document.querySelectorAll('#smartNavigationLabels [data-navigation-label]')];
            return {
                collisionFrameVisible:labels.some(label => label.dataset.navigationLabel === 'lod-collision-frame'),
                collisionGroupVisible:labels.some(label => label.dataset.navigationLabel === 'lod-collision-group'),
            };
        });
        await page.evaluate(() => {
            viewport.scale = 0.14;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await settleFrames(page, 2);
        const fitAllScaleMode = await page.evaluate(() => ({
            scale:Number(viewport.scale || 0),
            mode:document.querySelector('#shell')?.dataset.canvasLod || '',
        }));
        const smallLabelBeforeSelection = await page.evaluate(() => (
            Boolean(document.querySelector('#smartNavigationLabels [data-navigation-label="lod-small-group"]'))
        ));
        await page.evaluate(() => {
            selectedId = 'lod-small-group';
            selectedIds = ['lod-small-group'];
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            window.scheduleSmartCanvasNavigationLabels();
        });
        await settleFrames(page, 2);
        const smallLabelAfterSelection = await page.evaluate(() => (
            Boolean(document.querySelector('#smartNavigationLabels [data-navigation-label="lod-small-group"]'))
        ));
        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.selection.clear();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            window.scheduleSmartCanvasNavigationLabels();
        });
        await page.evaluate(() => {
            viewport.scale = 1.15;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await settleFrames(page, 5);
        const focusedScaleMode = await page.evaluate(() => ({
            scale:Number(viewport.scale || 0),
            mode:document.querySelector('#shell')?.dataset.canvasLod || '',
        }));
        const detailPresentation = await page.evaluate(() => ({
            promptControlCount:document.querySelector('.image-node[data-id="lod-prompt-node"]')
                ?.querySelectorAll('textarea,input,ic-prompt-composer,[contenteditable]').length ?? -1,
            groupTitle:document.querySelector('.image-node[data-id="lod-smart-group"] .node-title')
                ?.textContent?.trim() || '',
        }));
        await page.evaluate(() => {
            const temporaryIds = new Set([
                'lod-multi-node', 'lod-video-node', 'lod-video-broken-node', 'lod-audio-node', 'lod-prompt-node', 'lod-prompt-generation-node', 'lod-pending-node', 'lod-smart-group', 'lod-frame',
                'lod-small-group', 'lod-collision-group', 'lod-collision-frame',
            ]);
            nodes = nodes.filter(node => !temporaryIds.has(node.id));
            canvas.connections = canvas.connections.filter(connection => (
                !temporaryIds.has(connection.from) && !temporaryIds.has(connection.to)
            ));
            render();
        });
        await settleFrames(page, 3);

        const studioPreviewStart = previewWidths.length;
        const studioBeforeOriginal = studioOriginalRequests;
        const studioLoadingGuard = await page.evaluate(() => {
            nodes.push({
                id:'studio-original-node', type:'smart-image', x:820, y:420, w:480, h:270,
                uploadedAttachment:true,
                images:[{
                    url:'/assets/regression/studio-original.png', name:'studio-original.png',
                    kind:'image', natural_w:3840, natural_h:2160,
                }],
            });
            render();
            window.SmartCanvasModules.imageStudio.open({
                nodeId:'studio-original-node', imageIndex:0, mode:'preview', groupAware:false,
            });
            setImageEditMode('crop', true);
            return {
                open:window.SmartCanvasModules.imageStudio.isOpen(),
                applyDisabled:Boolean(document.querySelector('#imageEditApplyBtn')?.disabled),
            };
        });
        await page.waitForTimeout(500);
        const studioOriginalState = await page.evaluate(() => {
            const image = document.querySelector('#cropImage');
            return {
                naturalWidth:Number(image?.naturalWidth || 0),
                naturalHeight:Number(image?.naturalHeight || 0),
                src:image?.getAttribute('src') || '',
                applyDisabled:Boolean(document.querySelector('#imageEditApplyBtn')?.disabled),
            };
        });
        const studioPreviewWidths = previewWidths.slice(studioPreviewStart);
        const studioOriginalRequestCount = studioOriginalRequests - studioBeforeOriginal;
        await page.evaluate(() => {
            window.SmartCanvasModules.imageStudio.close();
            nodes = nodes.filter(node => node.id !== 'studio-original-node');
            render();
        });
        await settleFrames(page, 3);
        const studioCleanup = await page.evaluate(() => ({
            cropSrc:document.querySelector('#cropImage')?.getAttribute('src') || '',
            previewSrc:document.querySelector('#previewCurrentImage')?.getAttribute('src') || '',
            compareSrc:document.querySelector('#previewCompareImage')?.getAttribute('src') || '',
            open:window.SmartCanvasModules.imageStudio.isOpen(),
        }));

        const brokenPreviewStart = previewWidths.length;
        const brokenOriginalStart = studioBrokenOriginalRequests;
        await page.evaluate(() => {
            nodes.push({
                id:'studio-broken-node', type:'smart-image', x:820, y:420, w:480, h:270,
                uploadedAttachment:true,
                images:[{
                    url:'/assets/regression/studio-broken.png', name:'studio-broken.png',
                    kind:'image', natural_w:3840, natural_h:2160,
                }],
            });
            render();
            window.SmartCanvasModules.imageStudio.open({
                nodeId:'studio-broken-node', imageIndex:0, mode:'preview', groupAware:false,
            });
            setImageEditMode('crop', true);
        });
        await page.waitForTimeout(500);
        const studioFailureState = await page.evaluate(() => {
            const image = document.querySelector('#cropImage');
            const notice = document.querySelector('#imageStudioResolutionNotice');
            return {
                naturalWidth:Number(image?.naturalWidth || 0),
                src:image?.getAttribute('src') || '',
                applyDisabled:Boolean(document.querySelector('#imageEditApplyBtn')?.disabled),
                noticeHidden:Boolean(notice?.hidden),
                notice:notice?.textContent?.trim() || '',
            };
        });
        const brokenPreviewWidths = previewWidths.slice(brokenPreviewStart);
        const brokenOriginalRequestCount = studioBrokenOriginalRequests - brokenOriginalStart;
        await page.evaluate(() => {
            window.SmartCanvasModules.imageStudio.close();
            nodes = nodes.filter(node => node.id !== 'studio-broken-node');
            render();
        });
        await settleFrames(page, 3);

        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:20000, y:20000});
        });
        await page.waitForFunction(() => !document.querySelector('.image-node[data-id="media-node"]'));
        const warmAfterEviction = await page.evaluate(() => (
            window.SmartCanvasModules.canvasVirtualization.diagnostics()
        ));
        await cdp.send('Network.clearBrowserCache');
        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:280, y:210});
        });
        await page.waitForSelector('.image-node[data-id="media-node"] img');
        await settleFrames(page);
        const rematerializedImage = await page.evaluate(() => {
            const img = document.querySelector('.image-node[data-id="media-node"] img');
            return {
                complete:Boolean(img?.complete),
                naturalWidth:Number(img?.naturalWidth || 0),
                src:img?.getAttribute('src') || '',
            };
        });
        const warmAfterReturn = await page.evaluate(() => (
            window.SmartCanvasModules.canvasVirtualization.diagnostics()
        ));

        const rapidViewportResult = await page.evaluate(async () => {
            const failures = [];
            const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
            for(let index = 0; index < 100; index += 1){
                viewport.scale = index % 2 === 0 ? 0.64 : 0.72;
                const center = {x:280 + (index % 7) * 2, y:210 + (index % 5) * 2};
                viewport.x = shell.clientWidth / 2 - center.x * viewport.scale;
                viewport.y = shell.clientHeight / 2 - center.y * viewport.scale;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                await nextFrame();
                await nextFrame();
                const node = document.querySelector('.image-node[data-id="media-node"]');
                const image = node?.querySelector('img');
                if(image && (!image.complete || image.naturalWidth <= 0)){
                    await Promise.race([
                        new Promise(resolve => {
                            image.addEventListener('load', resolve, {once:true});
                            image.addEventListener('error', resolve, {once:true});
                        }),
                        new Promise(resolve => setTimeout(resolve, 80)),
                    ]);
                }
                const source = image?.getAttribute('src') || '';
                if(
                    !node
                    || !image
                    || !image.complete
                    || image.naturalWidth <= 0
                    || !source
                    || !decodeURIComponent(source).includes('/assets/regression/viewport.png')
                    || image.closest('.image-node')?.dataset.id !== 'media-node'
                ) failures.push({index, source, naturalWidth:Number(image?.naturalWidth || 0)});
            }
            viewport.scale = 1;
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:280, y:210});
            return {iterations:100, failures};
        });
        await settleFrames(page, 4);

        await page.evaluate(png => {
            const created = createImageNodeAt(
                window.SmartCanvasModules.viewportSelection.viewport.screenToWorld({
                    clientX:1040,
                    clientY:680,
                }),
                [{url:png, name:'dragged-asset.png', kind:'image'}],
                {skipUndo:true}
            );
            created.uploadedAttachment = true;
            render();
        }, `data:image/png;base64,${TINY_PNG.toString('base64')}`);
        await page.waitForFunction(() => nodes.length === 3);
        await page.waitForTimeout(250);
        const afterMediaDrop = await page.evaluate(() => ({
            toast:document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
            toastVisible:Boolean(document.querySelector('ic-toast[data-ic-overlay]')),
            selectedModel:settings.model,
            composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
        }));

        await page.evaluate(() => {
            document.querySelector('ic-toast[data-ic-overlay]')?.dismiss?.();
        });
        await page.locator('.image-node[data-id="generation-node"]').click({position:{x:24, y:24}});
        await page.waitForFunction(() => document.querySelector('#composer')?.classList.contains('open'));
        await page.waitForTimeout(500);
        const afterComposer = await page.evaluate(() => ({
            toast:document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
            toastVisible:Boolean(document.querySelector('ic-toast[data-ic-overlay]')),
            composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
        }));

        await page.evaluate(png => {
            nodes.push(...Array.from({length:10}, (_, index) => ({
                id:`warm-limit-${index}`,
                type:'smart-image',
                x:120 + index * 4,
                y:360 + index * 4,
                w:160,
                h:90,
                uploadedAttachment:true,
                images:[{
                    url:png,
                    name:`warm-limit-${index}.png`,
                    kind:'image',
                    natural_w:1600,
                    natural_h:900,
                }],
            })));
            render();
        }, `data:image/png;base64,${TINY_PNG.toString('base64')}`);
        await page.waitForFunction(() => {
            const images = [...document.querySelectorAll('.image-node[data-id^="warm-limit-"] img')];
            return images.length === 10 && images.every(image => image.naturalWidth > 0);
        });
        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:50000, y:50000});
        });
        await page.waitForFunction(() => !document.querySelector('.image-node[data-id^="warm-limit-"]'));
        const boundedWarmCache = await page.evaluate(() => (
            window.SmartCanvasModules.canvasVirtualization.diagnostics()
        ));

        assert.deepEqual({
            noValidationBeforeComposer:
                beforeComposer.toast === ''
                && beforeComposer.toastVisible === false
                && beforeComposer.selectedModel === STALE_MODEL
                && beforeComposer.composerOpen === false
                && afterMediaDrop.toast === ''
                && afterMediaDrop.toastVisible === false
                && afterMediaDrop.selectedModel === STALE_MODEL
                && afterMediaDrop.composerOpen === false,
            lodUsesStableFarDetailThresholds:
                lodHysteresis.map(item => item.mode).join(',') === 'far,far,detail',
            farModeSettingsUseOneUnderstandableThreshold:
                JSON.stringify(farModeSettings) === JSON.stringify({
                    enabled:'true', value:'23', min:'10', max:'100', output:'23%',
                }),
            farModeKeepsStructureAndDropsUnreadableResources:
                farPresentation?.multiImageCount === 1
                && farPresentation?.videoElementCount === 0
                && farPresentation?.videoPosterCount === 1
                && farPresentation?.brokenVideoElementCount === 0
                && farPresentation?.brokenVideoPlaceholderCount === 1
                && farPresentation?.audioElementCount === 0
                && farPresentation?.audioIconCount === 1
                && farPresentation?.audioIconColor === farPresentation?.promptSkeletonColor
                && farPresentation?.audioPlaceholderStyle?.backgroundImage === detailAudioPresentation.backgroundImage
                && farPresentation?.audioPlaceholderStyle?.backgroundColor === detailAudioPresentation.backgroundColor
                && farPresentation?.audioPlaceholderStyle?.borderStyle === detailAudioPresentation.borderStyle
                && farPresentation?.audioPlaceholderFillsNode
                && farPresentation?.audioBoundary?.nodeBorderStyle !== 'none'
                && farPresentation?.audioBoundary?.nodeBorderRadius !== '0px'
                && farPresentation?.audioBoundary?.nodeOverflow === 'hidden'
                && farPresentation?.videoBoundary?.nodeBorderStyle !== 'none'
                && farPresentation?.videoBoundary?.nodeBorderRadius !== '0px'
                && farPresentation?.videoBoundary?.nodeOverflow === 'hidden'
                && farPresentation?.promptControlCount === 0
                && farPresentation?.promptSkeletonLines === farPresentation?.promptSkeletonState?.expectedLines
                && farPresentation?.promptSkeletonLines >= 5
                && farPresentation?.promptVisibleText === ''
                && farPresentation?.promptGenerationControlCount === 0
                && farPresentation?.promptGenerationSkeletonLines === farPresentation?.promptGenerationSkeletonState?.expectedLines
                && farPresentation?.promptGenerationSkeletonLines >= 5
                && farPresentation?.promptGenerationVisibleText === ''
                && farPresentation?.promptSkeletonColor === farPresentation?.selectedHoverColor
                && farPresentation?.emptyUploadText === '上传节点'
                && farPresentation?.emptyUploadBackground === farPresentation?.surfaceColor
                && farPresentation?.pendingText === '正在生成图片'
                && farPresentation?.pendingBackgroundImage.includes('gradient')
                && farPresentation?.pendingBorderStyle !== 'none'
                && farPresentation?.pendingGradientSurfaceCount === 1
                && farPresentation?.pendingSurfaceFillsNode
                && farPresentation?.groupGridCount === 1
                && farPresentation?.groupSkeletonCount === 2
                && farPresentation?.groupImageIconCount === 2
                && farPresentation?.groupMountedImageCount === 0
                && farPresentation?.groupImageIconColor === farPresentation?.promptSkeletonColor
                && farPresentation?.connectionCount >= 1
                && farPresentation?.navigationLabels.some(label => (
                    label.kind === 'frame'
                    && label.text === '发布流程'
                    && label.fontSize === '12px'
                    && label.background === farPresentation.frameComponentStyle.background
                    && label.borderColor === farPresentation.frameComponentStyle.borderColor
                    && label.borderRadius === farPresentation.frameComponentStyle.borderRadius
                ))
                && farPresentation?.navigationLabels.some(label => (
                    label.kind === 'group'
                    && label.text === '品牌灵感'
                    && label.fontSize === '12px'
                    && label.background === farPresentation.groupComponentStyle.background
                    && label.borderColor === farPresentation.groupComponentStyle.borderColor
                    && label.borderRadius === farPresentation.groupComponentStyle.borderRadius
                    && label.boxShadow === farPresentation.raisedShadow
                ))
                && farPresentation?.diagnostics.mode === 'far'
                && farPresentation?.diagnostics.renderSetCount >= 7
                && farPresentation?.diagnostics.mountedNodeCount >= 7
                && farPresentation?.diagnostics.imagePreviewCounts?.[512] >= 3
                && farPresentation?.diagnostics.videoElementCount === 0
                && detailPresentation.promptControlCount > 0
                && detailPresentation.groupTitle.includes('品牌灵感')
                && previewWidths.includes(512),
            farModeDoubleClickOpensPreview:
                farModeDoubleClickPreview?.open
                && farModeDoubleClickPreview?.previewSelected
                && farModeDoubleClickPreview?.previewVisible,
            deleteInteractionIsImmediate:deleteInteractionMs < 250,
            navigationLabelsRespectScreenSizeAndPriority:
                smallLabelBeforeSelection === false
                && labelPriorityBeforeSelection.collisionFrameVisible
                && labelPriorityBeforeSelection.collisionGroupVisible === false
                && smallLabelAfterSelection,
            physicalViewportScalesKeepTheirRealMeaning:
                fitAllScaleMode.scale === 0.14
                && fitAllScaleMode.mode === 'far'
                && focusedScaleMode.scale === 1.15
                && focusedScaleMode.mode === 'detail',
            rapidViewportChangesKeepTheVisibleImageStable:
                rapidViewportResult.iterations === 100
                && rapidViewportResult.failures.length === 0,
            imageStudioUsesOriginalAsTheOnlyEditingSource:
                studioLoadingGuard.open
                && studioLoadingGuard.applyDisabled
                && studioOriginalRequestCount >= 1
                && !studioPreviewWidths.includes(1536)
                && !studioPreviewWidths.includes(2048)
                && studioOriginalState.naturalWidth === 3840
                && studioOriginalState.naturalHeight === 2160
                && studioOriginalState.src.includes('/assets/regression/studio-original.png')
                && studioOriginalState.applyDisabled === false,
            imageStudioRejectsFailedOriginalAndReleasesTheSession:
                studioCleanup.open === false
                && studioCleanup.cropSrc === ''
                && studioCleanup.previewSrc === ''
                && studioCleanup.compareSrc === ''
                && brokenOriginalRequestCount >= 1
                && !brokenPreviewWidths.includes(2048)
                && studioFailureState.naturalWidth === 0
                && studioFailureState.src.includes('/assets/regression/studio-broken.png')
                && studioFailureState.applyDisabled
                && !studioFailureState.noticeHidden
                && studioFailureState.notice.includes('原图加载失败'),
            imageSurvivedRematerialization:
                rematerializedImage.complete
                && rematerializedImage.naturalWidth > 0
                && warmAfterEviction.warmNodeCount === 1
                && warmAfterEviction.warmMediaCount === 1
                && warmAfterReturn.warmNodeCount === 0
                && warmAfterReturn.warmMediaCount === 0,
            validationAfterComposer:
                afterComposer.composerOpen
                && afterComposer.toastVisible
                && afterComposer.toast.includes(STALE_MODEL)
                && afterComposer.toast.includes('已不可用'),
            warmCacheIsBounded:
                boundedWarmCache.warmNodeCount === 8
                && boundedWarmCache.warmMediaCount <= 12,
            browserErrors,
        }, {
            noValidationBeforeComposer:true,
            lodUsesStableFarDetailThresholds:true,
            farModeSettingsUseOneUnderstandableThreshold:true,
            farModeKeepsStructureAndDropsUnreadableResources:true,
            farModeDoubleClickOpensPreview:true,
            deleteInteractionIsImmediate:true,
            navigationLabelsRespectScreenSizeAndPriority:true,
            physicalViewportScalesKeepTheirRealMeaning:true,
            rapidViewportChangesKeepTheVisibleImageStable:true,
            imageStudioUsesOriginalAsTheOnlyEditingSource:true,
            imageStudioRejectsFailedOriginalAndReleasesTheSession:true,
            imageSurvivedRematerialization:true,
            validationAfterComposer:true,
            warmCacheIsBounded:true,
            browserErrors:[],
        }, JSON.stringify({beforeComposer, farModeSettings, detailAudioPresentation, lodHysteresis, farPresentation, farModeDoubleClickPreview, deleteInteractionMs, labelPriorityBeforeSelection, fitAllScaleMode, smallLabelBeforeSelection, smallLabelAfterSelection, focusedScaleMode, detailPresentation, studioLoadingGuard, studioOriginalState, studioPreviewWidths, studioOriginalRequestCount, studioCleanup, studioFailureState, brokenPreviewWidths, brokenOriginalRequestCount, previewWidths, afterMediaDrop, rematerializedImage, warmAfterEviction, warmAfterReturn, rapidViewportResult, afterComposer, boundedWarmCache, browserErrors}));
        process.stdout.write(JSON.stringify({
            result:'passed',
            previewRequests,
            deleteInteractionMs,
            rematerializedImage,
            boundedWarmCache:{
                warmNodeCount:boundedWarmCache.warmNodeCount,
                warmMediaCount:boundedWarmCache.warmMediaCount,
                mountedNodeCount:boundedWarmCache.mountedNodeCount,
                materializationDuration:boundedWarmCache.materializationDuration,
            },
        }, null, 2));
        process.stdout.write('\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
