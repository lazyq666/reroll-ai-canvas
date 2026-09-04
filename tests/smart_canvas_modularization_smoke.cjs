const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:3100';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';
const overlayOnly = process.env.SMART_CANVAS_OVERLAY_ONLY === '1';
const uploadOnly = process.env.SMART_CANVAS_UPLOAD_ONLY === '1';
const focusedInteractionSmoke = overlayOnly || uploadOnly;
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';
const uploadFixture = fs.readFileSync(path.join(__dirname, '..', 'static', 'images', 'brand', 'logo.png'));

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await submitLogin(page, baseUrl, smokeUsername, smokePassword);
    // The login page intentionally probes /api/auth/me before authentication.
    errors.length = 0;

    const canvas = await page.evaluate(async ({ tinyPng: image, includeUpload }) => {
        const created = await fetch('/api/canvases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Module smoke', kind: 'smart' }),
        }).then(response => response.json());
        const record = created.canvas;
        const saved = await fetch(`/api/canvases/${record.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: record.title,
                icon: record.icon,
                nodes: [
                    {
                        id: 'smoke-image',
                        type: 'smart-image',
                        x: 100,
                        y: 100,
                        title: 'Smoke',
                        images: [{
                            url: image,
                            name: 'smoke.png',
                            kind: 'image',
                            natural_w: 1600,
                            natural_h: 900,
                        }],
                    },
                    ...(includeUpload ? [{
                        id: 'smoke-upload',
                        type: 'smart-image',
                        x: 760,
                        y: 100,
                        title: 'Upload',
                        images: [],
                    }] : []),
                ],
                connections: [],
                viewport: { x: 0, y: 0, scale: 1 },
                settings: {},
                logs: [],
                base_updated_at: record.updated_at,
                client_id: 'module-smoke',
            }),
        }).then(response => response.json());
        return saved.canvas;
    }, { tinyPng, includeUpload: focusedInteractionSmoke });

    await page.goto(
        `${baseUrl}/static/smart-canvas.html?id=${encodeURIComponent(canvas.id)}`,
        { waitUntil: 'networkidle' },
    );
    try {
        await page.waitForSelector('.image-node[data-id="smoke-image"]', { timeout: 15000 });
    } catch (error) {
        throw new Error(`${error.message}\n${errors.join('\n')}`);
    }
    await page.waitForFunction(() => (
        Boolean(window.SmartCanvasModules?.nodeGeometry)
        && Boolean(window.SmartCanvasModules?.imageStudioGeometry)
        && Boolean(window.SmartCanvasModules?.canvasPersistence)
        && Boolean(window.SmartCanvasModules?.viewportSelection)
        && Boolean(window.SmartCanvasModules?.canvasMutation)
        && Boolean(window.SmartCanvasModules?.smartContainer)
        && Boolean(window.SmartCanvasModules?.imageStudio)
        && Boolean(window.SmartCanvasModules?.generationSettings)
        && Boolean(window.SmartCanvasModules?.promptAuthoring)
        && Boolean(window.SmartCanvasModules?.generationProvider)
        && Boolean(window.SmartCanvasModules?.generationPending)
        && Boolean(window.SmartCanvasModules?.generationOutput)
        && Boolean(window.SmartCanvasModules?.smartMatting)
        && Boolean(window.SmartCanvasModules?.generationRun)
        && Boolean(window.SmartCanvasModules?.generationRecovery)
        && Boolean(window.SmartCanvasModules?.generationCascade)
    ));

    let nodeOverlayInteraction = null;
    if (!uploadOnly) {
        await page.click('.image-node[data-id="smoke-image"]', { button: 'right' });
        await new Promise(resolve => setTimeout(resolve, 250));
        nodeOverlayInteraction = await page.evaluate(() => {
            const node = document.querySelector('.image-node[data-id="smoke-image"]');
            const menu = document.querySelector('#smartNodeContextMenu');
            const composer = document.querySelector('#composer');
            if (!node || !menu || !composer) {
                return {
                    menuOpen: false,
                    composerOpen: false,
                    composerVisible: false,
                    verticalGap: null,
                    left: null,
                    right: null,
                    viewportWidth: window.innerWidth,
                };
            }
            const nodeBounds = node.getBoundingClientRect();
            const composerBounds = composer.getBoundingClientRect();
            return {
                menuOpen:
                    menu.classList.contains('open')
                    && menu.getAttribute('aria-hidden') === 'false',
                composerOpen: composer.classList.contains('open'),
                composerVisible: getComputedStyle(composer).visibility !== 'hidden',
                verticalGap: Math.round(composerBounds.top - nodeBounds.bottom),
                left: Math.round(composerBounds.left),
                right: Math.round(composerBounds.right),
                viewportWidth: window.innerWidth,
            };
        });
        if (
            !nodeOverlayInteraction.menuOpen
            || !nodeOverlayInteraction.composerOpen
            || !nodeOverlayInteraction.composerVisible
            || nodeOverlayInteraction.verticalGap !== 14
            || nodeOverlayInteraction.left < 14
            || nodeOverlayInteraction.right > nodeOverlayInteraction.viewportWidth - 14
        ) {
            throw new Error(
                `Unexpected Node overlay interaction: ${JSON.stringify(nodeOverlayInteraction)}`,
            );
        }
        await page.evaluate(() => {
            closeSmartNodeContextMenu();
            window.SmartCanvasModules.viewportSelection.selection.clear();
            render();
        });
    }

    let emptyPromptInteraction = null;
    let imageUploadInteraction = null;
    if (focusedInteractionSmoke) {
        await page.click('.image-node[data-id="smoke-upload"]');
        await page.waitForTimeout(150);
        emptyPromptInteraction = await page.evaluate(() => {
            const composer = document.querySelector('#composer');
            const prompt = document.querySelector('#promptInput');
            const run = document.querySelector('#runBtn');
            return {
                composerOpen: composer?.classList.contains('open') || false,
                prompt: prompt?.value || '',
                runDisabled: Boolean(run?.disabled),
                shadowRunDisabled: Boolean(run?.shadowRoot?.querySelector('[part~="base"]')?.disabled),
            };
        });
        if (
            !emptyPromptInteraction.composerOpen
            || emptyPromptInteraction.prompt !== ''
            || emptyPromptInteraction.runDisabled
            || emptyPromptInteraction.shadowRunDisabled
        ) {
            throw new Error(
                `Unexpected empty Prompt interaction: ${JSON.stringify(emptyPromptInteraction)}`,
            );
        }
        const emptyPromptGenerationRequests = [];
        const observeEmptyPromptRequest = request => {
            const pathname = new URL(request.url()).pathname;
            if (
                request.method() === 'POST'
                && (
                    pathname === '/api/canvas-image-tasks'
                    || pathname.includes('/generate')
                )
            ) {
                emptyPromptGenerationRequests.push(pathname);
            }
        };
        page.on('request', observeEmptyPromptRequest);
        await page.locator('#runBtn').locator('[part~="base"]').click();
        await page.waitForSelector('ic-toast[data-ic-overlay]');
        emptyPromptInteraction.toast = await page.locator('ic-toast[data-ic-overlay]').textContent();
        emptyPromptInteraction.generationRequests = emptyPromptGenerationRequests;
        page.off('request', observeEmptyPromptRequest);
        if (
            emptyPromptInteraction.toast.trim() !== '请输入提示词'
            || emptyPromptInteraction.generationRequests.length
        ) {
            throw new Error(
                `Unexpected empty Prompt feedback: ${JSON.stringify(emptyPromptInteraction)}`,
            );
        }
        await page.evaluate(() => document.querySelector('ic-toast[data-ic-overlay]')?.dismiss());

        let fileChooser = null;
        try {
            [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }),
                page.click('.image-node[data-id="smoke-upload"] .node-drop[data-upload-action="files"]'),
            ]);
        } catch (error) {
            throw new Error(
                `Image upload chooser did not open: ${error.message}\n${errors.join('\n')}`,
            );
        }
        await fileChooser.setFiles({
            name: 'upload-smoke.png',
            mimeType: 'image/png',
            buffer: uploadFixture,
        });
        await page.waitForSelector(
            '.image-node[data-id="smoke-upload"] .image-wrap[data-image-index="0"]',
            { timeout: 10000 },
        );
        imageUploadInteraction = await page.evaluate(() => {
            const node = document.querySelector('.image-node[data-id="smoke-upload"]');
            const image = node?.querySelector('.image-wrap[data-image-index="0"] img');
            const composer = document.querySelector('#composer');
            const kindToggle = document.querySelector('#apiKindToggle');
            const run = document.querySelector('#runBtn');
            return {
                nodeVisible: Boolean(node),
                imageVisible: Boolean(image),
                imageSource: image?.getAttribute('src') || '',
                composerOpen: composer?.classList.contains('open') || false,
                generationKind: kindToggle?.value || '',
                kindToggleDisabled: Boolean(kindToggle?.disabled),
                runDisabled: Boolean(run?.disabled),
                uploadPlaceholderVisible: Boolean(
                    node?.querySelector('.node-drop[data-upload-action="files"]'),
                ),
                toast: document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
            };
        });
        if (
            !imageUploadInteraction.nodeVisible
            || !imageUploadInteraction.imageVisible
            || !imageUploadInteraction.imageSource
            || !imageUploadInteraction.composerOpen
            || imageUploadInteraction.generationKind !== 'image'
            || imageUploadInteraction.kindToggleDisabled
            || imageUploadInteraction.runDisabled
            || imageUploadInteraction.uploadPlaceholderVisible
            || imageUploadInteraction.toast.includes('rememberRecentCanvasNode')
        ) {
            throw new Error(
                `Unexpected image upload interaction: ${JSON.stringify(imageUploadInteraction)}`,
            );
        }
        const uploadSynced = await page.evaluate(async () => {
            window.SmartCanvasModules.viewportSelection.selection.clear();
            render();
            await window.SmartCanvasModules.canvasPersistence.save();
            return window.SmartCanvasModules.canvasPersistence.synced({ timeout: 10000 });
        });
        if (!uploadSynced) throw new Error('Image upload did not finish Canvas Sync');
    }

    if (focusedInteractionSmoke) {
        const cleanup = await page.evaluate(async canvasId => {
            const deleted = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`, {
                method: 'DELETE',
            });
            const purged = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/purge`, {
                method: 'DELETE',
            });
            return { deleted: deleted.ok, purged: purged.ok };
        }, canvas.id);
        await browser.close();
        if (!cleanup.deleted || !cleanup.purged) {
            throw new Error(`Node overlay cleanup failed: ${JSON.stringify(cleanup)}`);
        }
        if (errors.length) throw new Error(errors.join('\n'));
        process.stdout.write(JSON.stringify({
            ok: true,
            canvasId: canvas.id,
            nodeOverlayInteraction,
            emptyPromptInteraction,
            imageUploadInteraction,
            cleanup,
        }, null, 2));
        return;
    }

    const localViewState = await page.evaluate(async canvasId => {
        const module = window.SmartCanvasModules.viewportSelection;
        const before = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`)
            .then(response => response.json());
        const selectedIds = module.selection.ids();
        module.viewport.centerOn({ x: 250, y: 180 });
        module.viewport.zoomPreview({ action: 'enter' });
        module.viewport.zoomPreview({ action: 'exit' });
        await new Promise(resolve => setTimeout(resolve, 700));
        const after = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`)
            .then(response => response.json());
        return {
            selectionMethods: Object.keys(module.selection).sort(),
            viewportMethods: Object.keys(module.viewport).sort(),
            selectedIds,
            beforeRevision: Number(before.canvas?.updated_at || 0),
            afterRevision: Number(after.canvas?.updated_at || 0),
        };
    }, canvas.id);
    if (
        localViewState.selectedIds.length !== 0
        || localViewState.beforeRevision !== localViewState.afterRevision
    ) {
        throw new Error(
            `Viewport or Selection leaked into Canvas Sync: ${JSON.stringify(localViewState)}`,
        );
    }

    const nodeGeometry = await page.evaluate(({ tinyPng: image }) => {
        const measured = window.SmartCanvasModules.nodeGeometry.createSession({
            nodes: [{
                id: 'smoke-image',
                type: 'smart-image',
                x: 100,
                y: 100,
                images: [{
                    url: image,
                    name: 'smoke.png',
                    kind: 'image',
                    natural_w: 1600,
                    natural_h: 900,
                }],
            }],
            connections: [],
        }).measure('smoke-image');
        const element = document.querySelector(
            '.image-node[data-id="smoke-image"]',
        );
        return {
            measured,
            rendered: {
                width: Number.parseFloat(element?.style.width || '0'),
                height: Number.parseFloat(element?.style.height || '0'),
            },
        };
    }, { tinyPng });
    if (
        nodeGeometry.measured.footprint.width !== 520
        || nodeGeometry.measured.footprint.height !== 293
        || nodeGeometry.rendered.width !== nodeGeometry.measured.footprint.width
        || nodeGeometry.rendered.height !== nodeGeometry.measured.footprint.height
    ) {
        throw new Error(`Unexpected Node geometry: ${JSON.stringify(nodeGeometry)}`);
    }

    const geometry = await page.evaluate(() => (
        window.SmartCanvasModules.imageStudioGeometry.splitGrid({
            width: 100,
            height: 80,
            rows: 2,
            cols: 2,
            gap: 4,
        })
    ));
    if (geometry.length !== 4 || geometry[0].w !== 48 || geometry[3].x !== 52) {
        throw new Error(`Unexpected Image Studio geometry: ${JSON.stringify(geometry)}`);
    }
    const generationModules = await page.evaluate(({ tinyPng: image }) => {
        const persistenceModule = window.SmartCanvasModules.canvasPersistence;
        const mutationModule = window.SmartCanvasModules.canvasMutation;
        const containerModule = window.SmartCanvasModules.smartContainer;
        const interactionModule = window.SmartCanvasModules.canvasInteraction;
        const settingsModule = window.SmartCanvasModules.generationSettings;
        const promptModule = window.SmartCanvasModules.promptAuthoring;
        const providerModule = window.SmartCanvasModules.generationProvider;
        const pendingModule = window.SmartCanvasModules.generationPending;
        const outputModule = window.SmartCanvasModules.generationOutput;
        const mattingModule = window.SmartCanvasModules.smartMatting;
        const runModule = window.SmartCanvasModules.generationRun;
        const recoveryModule = window.SmartCanvasModules.generationRecovery;
        const saved = settingsModule.saveForNode('smoke-image', {
            engine: 'api',
            apiKind: 'image',
            provider_id: 'smoke-provider',
            model: 'smoke-model',
            count: 1,
            videoTempShLinks: [
                { url: 'https://manual.example/image.png', manual: true },
                { url: 'https://temporary.example/image.png', manual: false },
            ],
        }, { remember: false });
        const loaded = settingsModule.forNode('smoke-image');
        loaded.model = 'mutated-outside-module';
        const reloaded = settingsModule.forNode('smoke-image');
        const status = runModule.status({ nodeId: 'smoke-image' });
        const authoringInput = document.querySelector('#promptInput');
        authoringInput.textContent = 'smoke prompt';
        const resolvedPrompt = promptModule.resolve({
            nodeId: 'smoke-image',
            defaultImages: [],
        });
        const pendingState = pendingModule.transition({ images: [] }, {
            type: 'submitted',
            tasks: [{ taskId: 'smoke-task' }],
            expectedCount: 1,
            startedAt: 100,
            now: 100,
        });
        const normalizedOutputs = outputModule.normalize({
            outputs: [image, image],
            kind: 'image',
        });
        mutationModule.create({
            kind: 'prepared',
            data: {
                node: {
                    id: 'container-smoke-prompt',
                    type: 'smart-prompt',
                    x: 520,
                    y: 520,
                    w: 260,
                    h: 170,
                    text: 'container smoke',
                    images: [],
                },
            },
            options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
        });
        mutationModule.create({
            kind: 'prepared',
            data: {
                node: {
                    id: 'container-smoke-image',
                    type: 'smart-image',
                    x: 820,
                    y: 520,
                    title: 'Container smoke image',
                    images: [{ url: image, name: 'container.png', kind: 'image' }],
                },
            },
            options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
        });
        const containerGroup = containerModule.group([
            'container-smoke-prompt',
            'container-smoke-image',
        ]);
        const groupedContainer = {
            memberIds: containerGroup
                ? containerModule.groupMembers(containerGroup).map(node => node.id)
                : [],
            imageCount: containerGroup
                ? containerModule.imageRefs(containerGroup).length
                : 0,
            imagePreserved: nodes.some(node => node.id === 'container-smoke-image'),
        };
        const containerUngrouped = containerGroup
            ? containerModule.ungroup(containerGroup.id)
            : false;
        const ungroupedContainer = {
            ok: containerUngrouped,
            groupRemoved: !nodes.some(node => node.id === containerGroup?.id),
            promptPreserved: nodes.some(node => node.id === 'container-smoke-prompt'),
            imageRestored: nodes.some(node =>
                node.type === 'smart-image'
                && node.id === 'container-smoke-image'
                && (node.images || []).some(item => item?.name === 'container.png')
            ),
        };
        authoringInput.textContent = '';
        runModule.resume();
        return {
            persistenceMethods: Object.keys(persistenceModule).sort(),
            mutationMethods: Object.keys(mutationModule).sort(),
            containerMethods: Object.keys(containerModule).sort(),
            interactionMethods: Object.keys(interactionModule).sort(),
            savedLinks: saved.videoTempShLinks.length,
            storedModel: reloaded.model,
            resolvedPrompt: resolvedPrompt.prompt,
            providerFieldKind: providerModule.fieldKind({ type: 'number', input: 'steps' }),
            reducerPending: pendingState.pending,
            normalizedOutputs: normalizedOutputs.length,
            mattingActive: mattingModule.isActive({ job: null }),
            pendingTasks: status.pendingTasks.length,
            recoveryQueued: recoveryModule.status({ nodeId: 'smoke-image' }).queued,
            loopRunning: status.loopRunning,
            groupedContainer,
            ungroupedContainer,
        };
    }, { tinyPng });
    if (
        JSON.stringify(generationModules.persistenceMethods)
            !== JSON.stringify([
                'editable',
                'hold',
                'load',
                'online',
                'receive',
                'release',
                'retry',
                'revert',
                'save',
                'schedule',
                'status',
                'synced',
            ])
        || JSON.stringify(generationModules.mutationMethods)
            !== JSON.stringify([
                'connect',
                'create',
                'disconnect',
                'duplicate',
                'history',
                'remove',
            ])
        || !generationModules.containerMethods.includes('group')
        || !generationModules.containerMethods.includes('ungroup')
        || !generationModules.containerMethods.includes('reconcileFrames')
        || !generationModules.containerMethods.includes('remove')
        || JSON.stringify(generationModules.interactionMethods)
            !== JSON.stringify(['active', 'begin', 'cancel', 'end', 'move'])
        || generationModules.savedLinks !== 1
        || generationModules.storedModel !== 'smoke-model'
        || generationModules.resolvedPrompt !== 'smoke prompt'
        || generationModules.providerFieldKind !== 'setting'
        || generationModules.reducerPending !== 1
        || generationModules.normalizedOutputs !== 1
        || generationModules.mattingActive
        || generationModules.pendingTasks !== 0
        || generationModules.recoveryQueued
        || generationModules.loopRunning
        || JSON.stringify(generationModules.groupedContainer.memberIds)
            !== JSON.stringify(['container-smoke-prompt', 'container-smoke-image'])
        || generationModules.groupedContainer.imageCount !== 1
        || !generationModules.groupedContainer.imagePreserved
        || !generationModules.ungroupedContainer.ok
        || !generationModules.ungroupedContainer.groupRemoved
        || !generationModules.ungroupedContainer.promptPreserved
        || !generationModules.ungroupedContainer.imageRestored
    ) {
        throw new Error(`Unexpected Generation Module state: ${JSON.stringify(generationModules)}`);
    }
    await page.route(`${baseUrl}/api/canvas-image-tasks/smoke-task`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                status: 'succeeded',
                result: {
                    images: [{ url: tinyPng, name: 'generated.png', kind: 'image' }],
                },
            }),
        });
    });
    await page.route(`${baseUrl}/api/canvas-image-tasks`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ task_id: 'smoke-task' }),
        });
    });
    await page.waitForFunction(
        () => window.SmartCanvasModules.canvasPersistence.online(),
        { timeout: 10000 },
    );
    const providerRun = await page.evaluate(async () => {
        window.smartCatalogHasSelection = () => true;
        document.querySelector('#promptInput').textContent = 'provider smoke prompt';
        const runResult = await window.SmartCanvasModules.generationRun.run({
            nodeId: 'smoke-image',
        });
        const output = nodes.find(node => node.id === 'smoke-image');
        const generatedOutputId = output?.activeOutputId || '';
        const generatedUrl = output?.images?.find(
            item => item.outputId === generatedOutputId
        )?.url || '';
        const mutation = window.SmartCanvasModules.canvasMutation;
        const target = mutation.create({
            kind:'prepared',
            data:{node:{
                id:'issue-71-pinned-target', type:'smart-image', x:520, y:100,
                title:'Pinned target', images:[], created_at:Date.now(),
            }},
            options:{skipUndo:true,select:false,render:false,save:false,positionMode:'exact'},
        });
        mutation.connect({fromId:output.id,toId:target.id,input:true});
        const pinnedConnection = canvas.connections.find(connection =>
            connection.from === output.id && connection.to === target.id
        );
        const originalOutputId = output.images.find(
            item => item.outputId !== generatedOutputId
        )?.outputId || '';
        window.SmartCanvasModules.generationOutput.select({
            node:output,
            outputId:originalOutputId,
        });
        const pinnedUrl = inputImagesFor(target)[0]?.url || '';
        const duplicate = mutation.duplicate({
            sourceNodes:[output],
            mode:'offset',
            skipUndo:true,
            select:false,
        }).nodes[0];
        const completionSnapshot = window.SmartCanvasModules.generationOutput
            .submissionSnapshot({node:output});
        window.SmartCanvasModules.generationOutput.select({
            node:output,
            outputId:generatedOutputId,
        });
        window.SmartCanvasModules.generationOutput.apply({
            node:output,
            outputs:[{url:`${generatedUrl}#delayed`,kind:'image'}],
            strategy:'append',
            submissionSnapshot:completionSnapshot,
        });
        const noStealActiveId = output.activeOutputId;
        await window.SmartCanvasModules.canvasPersistence.save();
        const stored = await fetch(`/api/canvases/${encodeURIComponent(canvas.id)}`)
            .then(response => response.json());
        const storedOutput = stored.canvas.nodes.find(node => node.id === output.id);
        return {
            found: Boolean(output),
            pending: Number(output?.pending || 0),
            taskCount: (output?.pendingTasks || []).length,
            outputCount: (output?.images || []).length,
            finished: Boolean(output?.runFinishedAt),
            sameNode: output?.id === 'smoke-image',
            generationOutputNode:Boolean(output?.generationOutputNode),
            pinnedIdentity:pinnedConnection?.sourceOutputId || '',
            generatedOutputId,
            pinnedUrl,
            generatedUrl,
            duplicateOutputCount:duplicate?.images?.length || 0,
            duplicateCopiedRecipe:Boolean(duplicate?.copiedGenerationRecipe),
            noSteal:noStealActiveId === generatedOutputId,
            hasNewOutput:Boolean(output?.hasNewGenerationOutput),
            persistedActiveId:storedOutput?.activeOutputId || '',
            persistedOutputCount:storedOutput?.images?.length || 0,
            runResult,
            selectedId,
            selectedNodeId:
                window.SmartCanvasModules.viewportSelection.selection.node()?.id || '',
            online: window.SmartCanvasModules.canvasPersistence.online(),
            toast: document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
        };
    });
    if (
        !providerRun.found
        || providerRun.pending !== 0
        || providerRun.taskCount !== 0
        || providerRun.outputCount !== 3
        || !providerRun.finished
        || !providerRun.sameNode
        || !providerRun.generationOutputNode
        || providerRun.pinnedIdentity !== providerRun.generatedOutputId
        || providerRun.pinnedUrl !== providerRun.generatedUrl
        || providerRun.duplicateOutputCount !== 1
        || !providerRun.duplicateCopiedRecipe
        || !providerRun.noSteal
        || !providerRun.hasNewOutput
        || providerRun.persistedActiveId !== providerRun.generatedOutputId
        || providerRun.persistedOutputCount !== 3
    ) {
        throw new Error(`Unexpected provider Generation Run: ${JSON.stringify(providerRun)}`);
    }
    const interactionLifecycle = await page.evaluate(async ({ tinyPng: image }) => {
        const interaction = window.SmartCanvasModules.canvasInteraction;
        const mutation = window.SmartCanvasModules.canvasMutation;
        mutation.create({
            kind: 'prepared',
            data: {
                node: {
                    id: 'interaction-smoke',
                    type: 'smart-image',
                    x: 300,
                    y: 500,
                    w: 180,
                    h: 140,
                    title: 'Interaction smoke',
                    images: [
                        { url: image, name: 'interaction-a.png', kind: 'image' },
                        { url: image, name: 'interaction-b.png', kind: 'image' },
                    ],
                    created_at: Date.now(),
                },
            },
            options: {
                skipUndo: true,
                select: false,
                render: false,
                save: false,
                positionMode: 'exact',
            },
        });
        render();
        const dispatchMouse = (target, type, options = {}) => {
            target.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: type === 'mouseup' ? 0 : 1,
                detail: 1,
                ...options,
            }));
        };
        const sourceNode = () => nodes.find(node => node.id === 'interaction-smoke');
        const nodeElement = () => document.querySelector(
            '.image-node[data-id="interaction-smoke"]',
        );

        const beforeResize = {
            width: Number(sourceNode()?.w || 0),
            height: Number(sourceNode()?.h || 0),
        };
        const resizeHandle = nodeElement()?.querySelector('.node-resize-handle');
        if (!resizeHandle) throw new Error('Interaction resize handle was not rendered');
        const resizeRect = resizeHandle.getBoundingClientRect();
        dispatchMouse(resizeHandle, 'mousedown', {
            clientX: resizeRect.left + 2,
            clientY: resizeRect.top + 2,
        });
        dispatchMouse(window, 'mousemove', {
            clientX: resizeRect.left + 72,
            clientY: resizeRect.top + 52,
        });
        dispatchMouse(window, 'mouseup', {
            clientX: resizeRect.left + 72,
            clientY: resizeRect.top + 52,
        });
        await new Promise(resolve => requestAnimationFrame(resolve));
        const afterResize = {
            width: Number(sourceNode()?.w || 0),
            height: Number(sourceNode()?.h || 0),
        };

        const beforeMove = {
            x: Number(sourceNode()?.x || 0),
            y: Number(sourceNode()?.y || 0),
        };
        const moveElement = nodeElement();
        const moveRect = moveElement.getBoundingClientRect();
        dispatchMouse(moveElement, 'mousedown', {
            clientX: moveRect.left + 24,
            clientY: moveRect.top + 24,
        });
        dispatchMouse(window, 'mousemove', {
            clientX: moveRect.left + 74,
            clientY: moveRect.top + 64,
        });
        dispatchMouse(window, 'mouseup', {
            clientX: moveRect.left + 74,
            clientY: moveRect.top + 64,
        });
        await new Promise(resolve => requestAnimationFrame(resolve));
        const afterMove = {
            x: Number(sourceNode()?.x || 0),
            y: Number(sourceNode()?.y || 0),
        };

        const thumb = nodeElement()?.querySelector('.thumb-item[data-image-index="1"]');
        if (!thumb) throw new Error('Interaction detachable thumbnail was not rendered');
        const thumbRect = thumb.getBoundingClientRect();
        dispatchMouse(thumb, 'mousedown', {
            clientX: thumbRect.left + thumbRect.width / 2,
            clientY: thumbRect.top + thumbRect.height / 2,
        });
        dispatchMouse(window, 'mousemove', {
            clientX: thumbRect.left + thumbRect.width / 2 + 24,
            clientY: thumbRect.top + thumbRect.height / 2 + 12,
        });
        dispatchMouse(window, 'mouseup', {
            clientX: thumbRect.left + thumbRect.width / 2 + 24,
            clientY: thumbRect.top + thumbRect.height / 2 + 12,
        });
        await new Promise(resolve => requestAnimationFrame(resolve));
        const detached = nodes.find(node => (
            node.id !== 'interaction-smoke'
            && (node.images || []).some(item => item?.name === 'interaction-b.png')
        ));
        return {
            beforeResize,
            afterResize,
            beforeMove,
            afterMove,
            sourceImageCount: (sourceNode()?.images || []).length,
            detachedNodeId: detached?.id || '',
            detachedImageCount: (detached?.images || []).length,
            active: interaction.active(),
        };
    }, { tinyPng });
    if (
        interactionLifecycle.afterResize.width <= interactionLifecycle.beforeResize.width
        || interactionLifecycle.afterResize.height <= interactionLifecycle.beforeResize.height
        || interactionLifecycle.afterMove.x <= interactionLifecycle.beforeMove.x
        || interactionLifecycle.afterMove.y <= interactionLifecycle.beforeMove.y
        || interactionLifecycle.sourceImageCount !== 1
        || !interactionLifecycle.detachedNodeId
        || interactionLifecycle.detachedImageCount !== 1
        || interactionLifecycle.active !== null
    ) {
        throw new Error(
            `Unexpected Canvas Interaction lifecycle: ${JSON.stringify(interactionLifecycle)}`,
        );
    }

    await page.evaluate(() => (
        window.SmartCanvasModules.imageStudio.open({
            nodeId: 'smoke-image',
            imageIndex: 0,
            mode: 'grid',
            groupAware: false,
        })
    ));
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
    await page.waitForFunction(() => document.querySelector('#cropImage')?.naturalWidth > 0);
    await page.evaluate(() => {
        applyGridPreset(2, 2);
    });
    const gridRects = await page.evaluate(() => gridSplitRects(100, 80));
    if (gridRects.length !== 4) throw new Error('Image Studio grid mode did not use the Module');
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());

    const cleanup = await page.evaluate(async canvasId => {
        const deleted = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`, {
            method: 'DELETE',
        });
        const purged = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/purge`, {
            method: 'DELETE',
        });
        return { deleted: deleted.ok, purged: purged.ok };
    }, canvas.id);
    if (!cleanup.deleted || !cleanup.purged) {
        throw new Error(`Module smoke cleanup failed: ${JSON.stringify(cleanup)}`);
    }

    await browser.close();
    if (errors.length) throw new Error(errors.join('\n'));
    process.stdout.write(JSON.stringify({
        ok: true,
        canvasId: canvas.id,
        nodeGeometry,
        geometryRects: geometry.length,
        gridRects: gridRects.length,
        localViewState,
        nodeOverlayInteraction,
        generationModules,
        providerRun,
        interactionLifecycle,
        cleanup,
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exit(1);
});
