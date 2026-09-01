const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:3100';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';
const giantNodeCount = Math.max(
    5000,
    Number(process.env.SMART_CANVAS_VIRTUALIZATION_NODE_COUNT || 5000),
);
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

async function settleFrames(page, count = 2) {
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

function giantCanvasFixture() {
    const nodes = [];
    for (let index = 0; index < giantNodeCount; index += 1) {
        const local = index < 24;
        const column = local ? index % 6 : (index - 24) % 100;
        const row = local ? Math.floor(index / 6) : Math.floor((index - 24) / 100);
        let x = local ? 100 + column * 360 : 50000 + column * 360;
        let y = local ? 100 + row * 280 : 30000 + row * 280;
        if (index === 26) { x = -50000; y = 450; }
        if (index === 27) { x = 50000; y = 450; }
        const variant = index % 10;
        const base = {
            id: `giant-node-${index}`,
            x,
            y,
            title: `Giant Node ${index}`,
            created_at: 1000 + index,
        };
        if (variant === 1) {
            nodes.push({ ...base, type: 'smart-prompt', w: 316, h: 180, text: `Prompt ${index}`, images: [] });
        } else if (variant === 2) {
            nodes.push({ ...base, type: 'smart-text', w: 260, h: 140, text: `Text ${index}`, images: [] });
        } else if (variant === 3) {
            nodes.push({ ...base, type: 'smart-loop', w: 340, h: 168, count: 2, images: [] });
        } else if (variant === 4) {
            nodes.push({ ...base, type: 'smart-frame', w: 330, h: 220, items: [], frameColor: 'blue', images: [] });
        } else if (variant === 5) {
            nodes.push({ ...base, type: 'smart-group', w: 320, h: 210, items: [], images: [] });
        } else {
            nodes.push({
                ...base,
                type: 'smart-image',
                generationOutputNode:index === 0,
                images: index === 0
                    ? [{
                        url:tinyPng,
                        name:'giant-0-a.png',
                        kind:'image',
                        outputId:'giant-output-0-a',
                        natural_w:1600,
                        natural_h:900,
                    }]
                    : index === giantNodeCount - 1
                        ? [{
                            url:tinyPng,
                            name:`giant-${index}.png`,
                            kind:'image',
                            natural_w:1600,
                            natural_h:900,
                        }]
                        : [],
            });
        }
    }
    const connections = [];
    for (let index = 0; index + 1 < nodes.length; index += 11) {
        connections.push({
            from: nodes[index].id,
            to: nodes[index + 1].id,
            kind: 'flow',
        });
    }
    connections.push({
        from: 'giant-node-26',
        to: 'giant-node-27',
        kind: 'flow',
    });
    return { nodes, connections };
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
        window.__smartCanvasLongTasks = [];
        try {
            const observer = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => {
                    window.__smartCanvasLongTasks.push(entry.duration);
                });
            });
            observer.observe({ type: 'longtask', buffered: true });
        } catch (error) {}
    });
    const page = await context.newPage();
    const errors = [];
    let canvasId = '';
    let syncPage = null;
    page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    try {
        await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
        await submitLogin(page, baseUrl, smokeUsername, smokePassword);
        errors.length = 0;

        const fixture = giantCanvasFixture();
        const canvas = await page.evaluate(async value => {
            const created = await fetch('/api/canvases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Virtualization smoke', kind: 'smart' }),
            }).then(response => response.json());
            const record = created.canvas;
            const saved = await fetch(`/api/canvases/${record.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: record.title,
                    icon: record.icon,
                    nodes: value.nodes,
                    connections: value.connections,
                    viewport: { x: 0, y: 0, scale: 1 },
                    settings: {},
                    logs: [],
                    base_updated_at: record.updated_at,
                    client_id: 'virtualization-smoke-bootstrap',
                }),
            }).then(response => response.json());
            return saved.canvas;
        }, fixture);
        canvasId = canvas.id;

        await page.goto(
            `${baseUrl}/static/smart-canvas.html?id=${encodeURIComponent(canvasId)}`,
            { waitUntil: 'domcontentloaded', timeout: 120000 },
        );
        await page.waitForFunction(() => (
            window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready'
            && document.querySelector('.image-node[data-id="giant-node-0"]')
        ), null, { timeout: 120000 });
        await settleFrames(page);
        await page.waitForTimeout(180);

        const targetId = `giant-node-${giantNodeCount - 1}`;
        const initial = await page.evaluate(targetNodeId => {
            const minimap = document.querySelector('ic-smart-minimap');
            const minimapRoot = minimap?.shadowRoot;
            return {
                totalNodes: nodes.length,
                mountedNodes: document.querySelectorAll('.image-node').length,
                mountedMedia: document.querySelectorAll('.image-node img,.image-node video').length,
                distantMounted: Boolean(document.querySelector(`.image-node[data-id="${targetNodeId}"]`)),
                mountedConnections: document.querySelectorAll('.connection-materialization').length,
                crossingConnectionMounted:Boolean(document.querySelector(
                    '[data-connection-key="giant-node-26|giant-node-27|flow"]'
                )),
                mountedFrames:document.querySelectorAll('.smart-frame-node').length,
                mountedGroups:document.querySelectorAll('.smart-group-node').length,
                modelFrames:nodes.filter(node => node.type === 'smart-frame').length,
                modelGroups:nodes.filter(node => node.type === 'smart-group').length,
                minimapNodeMaps:minimapRoot?.querySelectorAll('.minimap-node-map').length || 0,
                minimapLightChildren:minimap?.children.length ?? -1,
                minimapMaskCount:minimapRoot?.querySelectorAll('.smart-minimap-outside-mask').length || 0,
                minimapSemanticKinds:[...minimapRoot?.querySelectorAll('path[data-minimap-kind]') || []]
                    .filter(path => path.getAttribute('d'))
                    .map(path => `${path.dataset.minimapKind}:${path.dataset.frameColor || ''}`),
                diagnostics:window.SmartCanvasModules.canvasVirtualization.diagnostics(),
            };
        }, targetId);
        if (
            initial.totalNodes !== giantNodeCount
            || initial.mountedNodes >= 200
            || initial.mountedMedia >= 200
            || initial.distantMounted
            || initial.mountedConnections <= 0
            || initial.mountedConnections >= 50
            || !initial.crossingConnectionMounted
            || initial.mountedFrames <= 0
            || initial.mountedGroups <= 0
            || initial.modelFrames <= initial.mountedFrames
            || initial.modelGroups <= initial.mountedGroups
            || initial.minimapNodeMaps !== 1
            || initial.minimapLightChildren !== 0
            || initial.minimapMaskCount !== 1
            || !initial.minimapSemanticKinds.includes('frame:blue')
            || !initial.minimapSemanticKinds.includes('group:')
            || !initial.minimapSemanticKinds.includes('text:')
            || !initial.minimapSemanticKinds.includes('media:')
            || initial.diagnostics.totalNodeCount !== giantNodeCount
            || initial.diagnostics.reconciliationDuration >= 1500
        ) {
            throw new Error(`Giant Smart Canvas was not virtualized: ${JSON.stringify(initial)}`);
        }

        const minimapBox = await page.locator('ic-smart-minimap').boundingBox();
        if (!minimapBox) throw new Error('Smart minimap was not visible');
        const minimapBefore = await page.evaluate(() => (
            window.SmartCanvasModules.viewportSelection.viewport.center()
        ));
        await page.mouse.click(
            minimapBox.x + minimapBox.width * 0.78,
            minimapBox.y + minimapBox.height * 0.58,
        );
        await settleFrames(page, 3);
        const minimapAfter = await page.evaluate(() => (
            window.SmartCanvasModules.viewportSelection.viewport.center()
        ));
        if (Math.hypot(
            minimapAfter.x - minimapBefore.x,
            minimapAfter.y - minimapBefore.y,
        ) < 10) {
            throw new Error(`Smart minimap pointer navigation did not move the viewport: ${JSON.stringify({minimapBefore,minimapAfter})}`);
        }
        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:720,y:450});
        });
        await settleFrames(page, 3);

        await page.evaluate(() => {
            window.__virtualizationNodeIdentity = document.querySelector(
                '.image-node[data-id="giant-node-0"]'
            );
            window.__virtualizationConnectionIdentity = document.querySelector(
                '[data-connection-key="giant-node-26|giant-node-27|flow"]'
            );
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:720,y:450});
        });
        await settleFrames(page, 3);
        const retained = await page.evaluate(() => ({
            node:window.__virtualizationNodeIdentity === document.querySelector(
                '.image-node[data-id="giant-node-0"]'
            ),
            connection:window.__virtualizationConnectionIdentity === document.querySelector(
                '[data-connection-key="giant-node-26|giant-node-27|flow"]'
            ),
        }));
        if (!retained.node || !retained.connection) {
            throw new Error(`Visible materializations lost identity: ${JSON.stringify(retained)}`);
        }

        const dragHandle = await page.locator(
            '.image-node[data-id="giant-node-0"]'
        ).boundingBox();
        if (!dragHandle) throw new Error('Local drag handle was not materialized');
        await page.mouse.move(
            dragHandle.x + 12,
            dragHandle.y + 12,
        );
        await page.mouse.down();
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules.canvasInteraction.active('move-nodes')
        ));
        const farPanStarted = await page.evaluate(targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:target.x + 130,
                y:target.y + 90,
            });
            return performance.now();
        }, targetId);
        await settleFrames(page, 3);
        const pinnedDuringDrag = await page.evaluate(() => ({
            active:window.SmartCanvasModules.canvasInteraction.active('move-nodes'),
            sourceMounted:Boolean(document.querySelector('.image-node[data-id="giant-node-0"]')),
            diagnostics:window.SmartCanvasModules.canvasVirtualization.diagnostics(),
        }));
        const farPanDuration = await page.evaluate(
            started => performance.now() - started,
            farPanStarted,
        );
        if (!pinnedDuringDrag.active || !pinnedDuringDrag.sourceMounted) {
            throw new Error(`Canvas Interaction was not pinned: ${JSON.stringify(pinnedDuringDrag)}`);
        }
        await page.mouse.up();
        await page.waitForFunction(() => (
            !window.SmartCanvasModules.canvasInteraction.active()
            && !document.querySelector('.image-node[data-id="giant-node-0"]')
        ), null, { timeout: 30000 });
        await page.waitForSelector(`.image-node[data-id="${targetId}"]`);
        const far = await page.evaluate(({targetNodeId,panDuration}) => {
            const target = document.querySelector(`.image-node[data-id="${targetNodeId}"]`);
            const media = target?.querySelector('img,video');
            return {
                panDuration,
                mountedNodes:document.querySelectorAll('.image-node').length,
                mountedMedia:document.querySelectorAll('.image-node img,.image-node video').length,
                mountedConnections:document.querySelectorAll('.connection-materialization').length,
                mountedFrames:document.querySelectorAll('.smart-frame-node').length,
                mountedGroups:document.querySelectorAll('.smart-group-node').length,
                targetMediaSource:media?.currentSrc || media?.src || '',
                targetOriginalSource:media?.dataset?.originalSrc || '',
                targetPreviewSize:Number(media?.dataset?.previewSize || 0),
                targetMediaLoading:media?.getAttribute('loading') || '',
                diagnostics:window.SmartCanvasModules.canvasVirtualization.diagnostics(),
            };
        }, {targetNodeId:targetId,panDuration:farPanDuration});
        if (
            far.panDuration >= 1500
            || far.mountedNodes >= 200
            || far.mountedMedia >= 200
            || far.mountedConnections >= 50
            || far.mountedFrames <= 0
            || far.mountedGroups <= 0
            || !far.targetMediaSource.startsWith('data:image/')
            || !far.targetOriginalSource.startsWith('data:image/')
            || far.targetPreviewSize < 64
        ) {
            throw new Error(`Far Render Set failed: ${JSON.stringify(far)}`);
        }

        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:720,y:450});
        });
        await page.waitForFunction(targetNodeId => (
            !document.querySelector(`.image-node[data-id="${targetNodeId}"]`)
        ), targetId);
        const offscreenOutput = await page.evaluate(({targetNodeId,url}) => {
            const target = nodes.find(node => node.id === targetNodeId);
            window.SmartCanvasModules.generationOutput.apply({
                node:target,
                outputs:[{
                    url,
                    name:'offscreen-completed.png',
                    kind:'image',
                    natural_w:2048,
                    natural_h:1024,
                }],
                strategy:'replace',
                generatedResult:false,
            });
            render();
            return {
                imageName:target.images?.[0]?.name || '',
                mounted:Boolean(document.querySelector(`.image-node[data-id="${targetNodeId}"]`)),
                mountedNodes:document.querySelectorAll('.image-node').length,
            };
        }, {targetNodeId:targetId,url:tinyPng});
        if (
            offscreenOutput.imageName !== 'offscreen-completed.png'
            || offscreenOutput.mounted
            || offscreenOutput.mountedNodes >= 200
        ) {
            throw new Error(`Offscreen Generation Output forced DOM: ${JSON.stringify(offscreenOutput)}`);
        }
        await page.evaluate(targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:target.x + 130,
                y:target.y + 90,
            });
        }, targetId);
        await page.waitForSelector(`.image-node[data-id="${targetId}"] img`);
        const completedOutput = await page.evaluate(targetNodeId => ({
            imageName:nodes.find(node => node.id === targetNodeId)?.images?.[0]?.name || '',
            mediaSource:document.querySelector(
                `.image-node[data-id="${targetNodeId}"] img`
            )?.src || '',
        }), targetId);
        if (
            completedOutput.imageName !== 'offscreen-completed.png'
            || !completedOutput.mediaSource.startsWith('data:image/')
        ) {
            throw new Error(`Generation Output did not rematerialize: ${JSON.stringify(completedOutput)}`);
        }

        await page.evaluate(() => {
            const textNode = nodes.find(node => node.id === 'giant-node-2');
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:textNode.x + 130,
                y:textNode.y + 70,
            });
        });
        await page.waitForSelector('.image-node[data-id="giant-node-2"] .smart-canvas-text');
        await page.dblclick('.image-node[data-id="giant-node-2"] .smart-canvas-text');
        await page.waitForFunction(() => document.querySelector(
            '.image-node[data-id="giant-node-2"] .smart-canvas-text'
        )?.isContentEditable);
        const editorBeforePan = await page.evaluate(() => ({
            activeNodeId:document.activeElement?.closest?.('.image-node')?.dataset?.id || '',
            editing:Boolean(document.querySelector(
                '.image-node[data-id="giant-node-2"] .smart-canvas-text'
            )?.isContentEditable),
            diagnostics:window.SmartCanvasModules.canvasVirtualization.diagnostics(),
        }));
        const editorAfterCenter = await page.evaluate(targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:target.x + 130,
                y:target.y + 90,
            });
            return {
                activeNodeId:document.activeElement?.closest?.('.image-node')?.dataset?.id || '',
                editing:Boolean(document.querySelector(
                    '.image-node[data-id="giant-node-2"] .smart-canvas-text'
                )?.isContentEditable),
                diagnostics:window.SmartCanvasModules.canvasVirtualization.diagnostics(),
            };
        }, targetId);
        await settleFrames(page, 3);
        const pinnedEditor = await page.evaluate(() => ({
            mounted:Boolean(document.querySelector('.image-node[data-id="giant-node-2"]')),
            editing:Boolean(document.querySelector(
                '.image-node[data-id="giant-node-2"] .smart-canvas-text'
            )?.isContentEditable),
        }));
        if (!pinnedEditor.mounted || !pinnedEditor.editing) {
            throw new Error(`Inline editor was not pinned: ${JSON.stringify({
                editorBeforePan,
                editorAfterCenter,
                pinnedEditor,
            })}`);
        }
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.waitForFunction(() => (
            !document.querySelector('.image-node[data-id="giant-node-2"]')
        ));

        await page.evaluate(() => {
            const source = nodes.find(node => node.id === 'giant-node-6');
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:source.x + 130,
                y:source.y + 90,
            });
        });
        await page.waitForSelector('.image-node[data-id="giant-node-6"]');
        const composerOpened = await page.evaluate(() => {
            const element = document.querySelector('.image-node[data-id="giant-node-6"]');
            element?.onclick?.({stopPropagation(){}});
            return {
                hasHandler:typeof element?.onclick === 'function',
                selectedId,
                open:document.querySelector('#composer')?.classList.contains('open'),
            };
        });
        if (!composerOpened.open) {
            throw new Error(`Prompt Authoring did not open: ${JSON.stringify(composerOpened)}`);
        }
        await page.click('#promptInput');
        await page.evaluate(targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:target.x + 130,
                y:target.y + 90,
            });
        }, targetId);
        await settleFrames(page, 3);
        const pinnedPromptAuthoring = await page.evaluate(() => ({
            sourceMounted:Boolean(document.querySelector('.image-node[data-id="giant-node-6"]')),
            promptFocused:document.activeElement === document.querySelector('#promptInput'),
        }));
        if (!pinnedPromptAuthoring.sourceMounted || !pinnedPromptAuthoring.promptFocused) {
            throw new Error(`Prompt Authoring source was not pinned: ${JSON.stringify(pinnedPromptAuthoring)}`);
        }
        await page.click(`.image-node[data-id="${targetId}"] .node-body`);
        await page.waitForFunction(() => (
            !document.querySelector('.image-node[data-id="giant-node-6"]')
        ));
        await page.evaluate(targetNodeId => {
            document.querySelector(`.image-node[data-id="${targetNodeId}"]`)
                ?.onclick?.({stopPropagation(){}});
        }, targetId);
        await page.waitForFunction(targetNodeId => (
            window.SmartCanvasModules.viewportSelection.selection.ids()
                .includes(targetNodeId)
        ), targetId);

        await page.evaluate(async () => {
            window.SmartCanvasModules.canvasPersistence.schedule({delay:0});
            await window.SmartCanvasModules.canvasPersistence.save();
            await window.SmartCanvasModules.canvasPersistence.synced({timeout:30000});
        });

        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:720,y:450});
        });
        await page.waitForFunction(targetNodeId => (
            !document.querySelector(`.image-node[data-id="${targetNodeId}"]`)
        ), targetId);
        const offscreenSelection = await page.evaluate(targetNodeId => ({
            selected:window.SmartCanvasModules.viewportSelection.selection
                .ids().includes(targetNodeId),
            modelPresent:Boolean(nodes.find(node => node.id === targetNodeId)),
            mounted:Boolean(document.querySelector(
                `.image-node[data-id="${targetNodeId}"]`
            )),
        }), targetId);
        if (
            !offscreenSelection.selected
            || !offscreenSelection.modelPresent
            || offscreenSelection.mounted
        ) {
            throw new Error(`Offscreen Canvas Selection failed: ${JSON.stringify(offscreenSelection)}`);
        }
        syncPage = await context.newPage();
        syncPage.on('pageerror', error => errors.push(`sync pageerror: ${error.stack || error.message}`));
        syncPage.on('console', message => {
            if (message.type() === 'error') errors.push(`sync console: ${message.text()}`);
        });
        await syncPage.goto(
            `${baseUrl}/static/smart-canvas.html?id=${encodeURIComponent(canvasId)}`,
            { waitUntil:'domcontentloaded', timeout:120000 },
        );
        await syncPage.waitForFunction(() => (
            window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready'
        ), null, { timeout:120000 });
        const syncMutation = await syncPage.evaluate(async targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            target.x += 720;
            target.title = 'Synced Offscreen Node';
            render({syncVirtualization:false,nodeIds:[target.id]});
            window.SmartCanvasModules.canvasPersistence.schedule({delay:0});
            await window.SmartCanvasModules.canvasPersistence.save();
            await window.SmartCanvasModules.canvasPersistence.synced({timeout:30000});
            return {x:target.x,title:target.title};
        }, targetId);
        await page.waitForFunction(({targetNodeId,x}) => {
            const target = nodes.find(node => node.id === targetNodeId);
            return target?.x === x && target?.title === 'Synced Offscreen Node';
        }, {targetNodeId:targetId,x:syncMutation.x}, {timeout:30000});
        const offscreenSync = await page.evaluate(targetNodeId => ({
            mounted:Boolean(document.querySelector(`.image-node[data-id="${targetNodeId}"]`)),
            model:nodes.find(node => node.id === targetNodeId),
            totalNodes:nodes.length,
        }), targetId);
        if (
            offscreenSync.mounted
            || offscreenSync.model?.x !== syncMutation.x
            || offscreenSync.totalNodes !== giantNodeCount
        ) {
            throw new Error(`Offscreen Canvas Sync failed: ${JSON.stringify(offscreenSync)}`);
        }
        await page.evaluate(targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({
                x:target.x + 130,
                y:target.y + 90,
            });
        }, targetId);
        await page.waitForSelector(`.image-node[data-id="${targetId}"]`);
        const syncedMaterialization = await page.evaluate(targetNodeId => {
            const target = nodes.find(node => node.id === targetNodeId);
            const element = document.querySelector(`.image-node[data-id="${targetNodeId}"]`);
            return {
                modelX:target?.x,
                domLeft:parseFloat(element?.style.left || 'NaN'),
                title:target?.title || '',
            };
        }, targetId);
        if (
            syncedMaterialization.modelX !== syncedMaterialization.domLeft
            || syncedMaterialization.title !== 'Synced Offscreen Node'
        ) {
            throw new Error(`Synced Node did not materialize correctly: ${JSON.stringify(syncedMaterialization)}`);
        }

        const persisted = await page.evaluate(async ({id,targetNodeId}) => {
            const record = await fetch(`/api/canvases/${encodeURIComponent(id)}`)
                .then(response => response.json());
            const target = record.canvas.nodes.find(node => node.id === targetNodeId);
            return {
                nodeCount:record.canvas.nodes.length,
                targetX:target?.x,
                targetTitle:target?.title,
                outputName:target?.images?.[0]?.name,
            };
        }, {id:canvasId,targetNodeId:targetId});
        if (
            persisted.nodeCount !== giantNodeCount
            || persisted.targetX !== syncMutation.x
            || persisted.targetTitle !== 'Synced Offscreen Node'
            || persisted.outputName !== 'offscreen-completed.png'
        ) {
            throw new Error(`Complete Canvas model was not persisted: ${JSON.stringify(persisted)}`);
        }
        await syncPage.close();
        syncPage = null;

        await page.evaluate(() => {
            window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:720,y:450});
        });
        await settleFrames(page, 3);
        const doubledStarted = await page.evaluate(startIndex => {
            const started = performance.now();
            for (let index = startIndex; index < startIndex * 2; index += 1) {
                const node = {
                    id:`giant-extra-${index}`,
                    type:index % 17 === 0
                        ? 'smart-frame'
                        : index % 19 === 0
                            ? 'smart-group'
                            : 'smart-image',
                    x:200000 + (index % 100) * 360,
                    y:80000 + Math.floor((index - startIndex) / 100) * 280,
                    w:260,
                    h:180,
                    items:[],
                    images:[],
                    title:`Extra Node ${index}`,
                    created_at:20000 + index,
                };
                window.SmartCanvasModules.canvasMutation.create({
                    kind:'prepared',
                    data:{node},
                    options:{skipUndo:true,select:false,render:false,save:false,positionMode:'exact'},
                });
            }
            render();
            return started;
        }, giantNodeCount);
        await settleFrames(page, 3);
        await page.waitForTimeout(180);
        const doubled = await page.evaluate(started => {
            const longTasks = window.__smartCanvasLongTasks || [];
            const minimap = document.querySelector('ic-smart-minimap');
            const minimapRoot = minimap?.shadowRoot;
            return {
                duration:performance.now() - started,
                totalNodes:nodes.length,
                mountedNodes:document.querySelectorAll('.image-node').length,
                mountedMedia:document.querySelectorAll('.image-node img,.image-node video').length,
                mountedConnections:document.querySelectorAll('.connection-materialization').length,
                minimapNodeMaps:minimapRoot?.querySelectorAll('.minimap-node-map').length || 0,
                minimapLightChildren:minimap?.children.length ?? -1,
                longTaskCount:longTasks.length,
                maxLongTask:longTasks.length ? Math.max(...longTasks) : 0,
                diagnostics:window.SmartCanvasModules.canvasVirtualization.diagnostics(),
            };
        }, doubledStarted);
        if (
            doubled.totalNodes !== giantNodeCount * 2
            || doubled.mountedNodes >= 200
            || doubled.mountedMedia >= 200
            || doubled.mountedConnections >= 50
            || doubled.minimapNodeMaps !== 1
            || doubled.minimapLightChildren !== 0
            || doubled.diagnostics.totalNodeCount !== giantNodeCount * 2
            || doubled.diagnostics.reconciliationDuration >= 1500
            || doubled.maxLongTask >= 2000
        ) {
            throw new Error(`Distant Node growth was not bounded: ${JSON.stringify(doubled)}`);
        }

        if (errors.length) throw new Error(errors.join('\n'));
        process.stdout.write(JSON.stringify({
            ok:true,
            canvasId,
            budgets:{
                maxMountedNodes:200,
                maxMountedConnections:50,
                maxReconciliationMs:1500,
                maxPanMs:1500,
                maxLongTaskMs:2000,
            },
            initial,
            retained,
            pinnedDuringDrag,
            far,
            offscreenOutput,
            completedOutput,
            pinnedEditor,
            pinnedPromptAuthoring,
            offscreenSelection,
            offscreenSync:{
                mounted:offscreenSync.mounted,
                totalNodes:offscreenSync.totalNodes,
                targetX:offscreenSync.model?.x,
            },
            persisted,
            doubled,
        }, null, 2));
    } finally {
        await syncPage?.close().catch(() => {});
        if (canvasId) {
            await page.evaluate(async id => {
                await fetch(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' });
                await fetch(`/api/canvases/${encodeURIComponent(id)}/purge`, { method: 'DELETE' });
            }, canvasId).catch(() => {});
        }
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
