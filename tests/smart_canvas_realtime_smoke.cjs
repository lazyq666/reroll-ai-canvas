const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:3100';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';
const rounds = Math.max(1, Number(process.env.REALTIME_SMOKE_ROUNDS || 8));
const durationMs = Math.max(0, Number(process.env.REALTIME_SMOKE_DURATION_MS || 0));
const roundDelayMs = Math.max(
    0,
    Number(process.env.REALTIME_SMOKE_ROUND_DELAY_MS || (durationMs ? 1000 : 0)),
);

const sharedProjection = value => ({
    title: value?.title || '',
    icon: value?.icon || '',
    revision: Number(value?.revision || 0),
    nodes: value?.nodes || [],
    connections: value?.connections || [],
    settings: value?.settings || {},
    logs: value?.logs || [],
});

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: browserExecutable,
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    let canvasId = '';
    let controlPage = null;
    const pages = [];
    try {
        controlPage = await context.newPage();
        await controlPage.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
        await submitLogin(controlPage, baseUrl, smokeUsername, smokePassword);
        const canvas = await controlPage.evaluate(async () => {
            const created = await fetch('/api/canvases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Realtime smoke', kind: 'smart' }),
            }).then(response => response.json());
            const record = created.canvas;
            const saved = await fetch(`/api/canvases/${record.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: record.title,
                    icon: record.icon,
                    nodes: [],
                    connections: [],
                    viewport: {},
                    logs: [],
                    settings: {},
                    base_updated_at: record.updated_at,
                    client_id: 'realtime-smoke-bootstrap',
                }),
            }).then(response => response.json());
            return saved.canvas;
        });
        canvasId = canvas.id;

        for (let index = 0; index < 5; index += 1) {
            const page = await context.newPage();
            page.on('pageerror', error => {
                errors.push(`client-${index} pageerror: ${error.stack || error.message}`);
            });
            page.on('console', message => {
                if (message.type() === 'error') {
                    errors.push(`client-${index} console: ${message.text()}`);
                }
            });
            await page.goto(
                `${baseUrl}/static/smart-canvas.html?id=${encodeURIComponent(canvasId)}`,
                { waitUntil: 'domcontentloaded' },
            );
            await page.waitForFunction(() => (
                window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready'
            ), null, { timeout: 15000 });
            pages.push(page);
        }
        const capacityCloseCode = await controlPage.evaluate(id => (
            new Promise((resolve, reject) => {
                const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                const socket = new WebSocket(
                    `${protocol}//${location.host}/ws/canvases/${encodeURIComponent(id)}?layout_gap=64&client_id=capacity-sixth`,
                );
                const timer = setTimeout(
                    () => reject(new Error('Sixth client capacity check timed out')),
                    5000,
                );
                socket.onmessage = () => {
                    clearTimeout(timer);
                    socket.close();
                    reject(new Error('Sixth realtime client was unexpectedly accepted'));
                };
                socket.onerror = () => {};
                socket.onclose = event => {
                    clearTimeout(timer);
                    resolve(event.code);
                };
            })
        ), canvasId);
        if (capacityCloseCode !== 4429) {
            throw new Error(`Sixth client closed with ${capacityCloseCode}, expected 4429`);
        }

        const serverSnapshot = () => controlPage.evaluate(async id => (
            fetch(`/api/canvases/${encodeURIComponent(id)}`)
                .then(response => response.json())
                .then(data => data.canvas)
        ), canvasId);
        const waitForRevision = async minimumRevision => {
            await Promise.all(pages.map(page => page.waitForFunction(
                revision => {
                    const status = window.SmartCanvasModules.canvasPersistence.status();
                    return status.state === 'ready'
                        && !status.pending
                        && status.revision >= revision;
                },
                minimumRevision,
                { timeout: 15000 },
            )));
        };
        const settle = async () => {
            await Promise.all(pages.map(page => page.waitForFunction(() => {
                const status = window.SmartCanvasModules.canvasPersistence.status();
                return status.state === 'ready' && !status.pending;
            }, null, { timeout: 15000 })));
            const snapshot = await serverSnapshot();
            await waitForRevision(Number(snapshot.revision || 0));
            return snapshot;
        };

        await pages[0].evaluate(async () => {
            const mutation = window.SmartCanvasModules.canvasMutation;
            const prepared = [
                { id: 'node-a', type: 'smart-image', x: 100, y: 100, title: 'A', images: [] },
                { id: 'node-b', type: 'smart-prompt', x: 420, y: 100, w: 316, h: 240, title: 'B', text: '', images: [] },
                { id: 'group-prompt', type: 'smart-prompt', x: 100, y: 500, w: 316, h: 240, title: 'Group prompt', text: '', images: [] },
                { id: 'group-image', type: 'smart-image', x: 460, y: 500, title: 'Group image', images: [] },
            ];
            prepared.forEach(node => mutation.create({
                kind: 'prepared',
                data: { node },
                options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
            }));
            render();
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        await settle();

        await Promise.all([
            pages[0].evaluate(async () => {
                window.SmartCanvasModules.canvasMutation.create({
                    kind: 'prepared',
                    data: {
                        node: {
                            id: 'node-x',
                            type: 'smart-image',
                            x: 800,
                            y: 100,
                            title: 'X',
                            images: [],
                        },
                    },
                    options: { skipUndo: true, select: false, render: true, save: false, positionMode: 'exact' },
                });
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
            pages[1].evaluate(async () => {
                window.SmartCanvasModules.canvasMutation.create({
                    kind: 'prepared',
                    data: {
                        node: {
                            id: 'node-y',
                            type: 'smart-image',
                            x: 1080,
                            y: 100,
                            title: 'Y',
                            images: [],
                        },
                    },
                    options: { skipUndo: true, select: false, render: true, save: false, positionMode: 'exact' },
                });
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
        ]);
        await settle();

        await Promise.all([
            pages[0].evaluate(async () => {
                nodes.find(node => node.id === 'node-a').x = 180;
                render();
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
            pages[1].evaluate(async () => {
                nodes.find(node => node.id === 'node-b').title = 'B remote';
                render();
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
        ]);
        await settle();

        await Promise.all([
            pages[0].evaluate(async () => {
                nodes.find(node => node.id === 'node-a').title = 'same-field-a';
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
            pages[1].evaluate(async () => {
                nodes.find(node => node.id === 'node-a').title = 'same-field-b';
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
        ]);
        let snapshot = await settle();
        const sameFieldTitles = await Promise.all(pages.map(page => page.evaluate(() => (
            nodes.find(node => node.id === 'node-a')?.title || ''
        ))));
        if (new Set(sameFieldTitles).size !== 1) {
            throw new Error(`Same-field writes diverged: ${JSON.stringify(sameFieldTitles)}`);
        }

        await Promise.all([
            pages[0].evaluate(async () => {
                window.SmartCanvasModules.canvasMutation.connect({
                    fromId: 'node-x',
                    toId: 'node-y',
                    input: true,
                });
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
            pages[1].evaluate(async () => {
                window.SmartCanvasModules.canvasMutation.connect({
                    fromId: 'node-x',
                    toId: 'node-y',
                    input: true,
                });
                await window.SmartCanvasModules.canvasPersistence.save();
            }),
        ]);
        snapshot = await settle();
        if (snapshot.connections.filter(
            connection => connection.from === 'node-x' && connection.to === 'node-y',
        ).length !== 1) {
            throw new Error('Duplicate Connection was not collapsed');
        }

        await pages[0].evaluate(async () => {
            const group = window.SmartCanvasModules.smartContainer.group([
                'group-prompt',
                'group-image',
            ]);
            if (!group) throw new Error('Smart Group creation failed');
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        snapshot = await settle();
        const groupId = snapshot.nodes.find(node => node.type === 'smart-group')?.id;
        if (!groupId) throw new Error('Smart Group did not reach the server');
        await pages[1].evaluate(async id => {
            const group = nodes.find(node => node.id === id);
            group.x += 75;
            group.y += 35;
            render();
            await window.SmartCanvasModules.canvasPersistence.save();
        }, groupId);
        await settle();

        await pages[2].evaluate(async () => {
            const mutation = window.SmartCanvasModules.canvasMutation;
            mutation.create({
                kind: 'prepared',
                data: {
                    node: {
                        id: 'frame-preserve',
                        type: 'smart-frame',
                        x: 1500,
                        y: 300,
                        w: 500,
                        h: 360,
                        title: 'Preserve frame',
                        frameColor: 'blue',
                        items: [],
                    },
                },
                options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
            });
            mutation.create({
                kind: 'prepared',
                data: {
                    node: {
                        id: 'frame-preserve-child',
                        type: 'smart-image',
                        x: 1650,
                        y: 430,
                        title: 'Preserved child',
                        images: [],
                    },
                },
                options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
            });
            window.SmartCanvasModules.smartContainer.reconcileFrames();
            render();
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        await settle();
        await pages[2].evaluate(async () => {
            window.SmartCanvasModules.smartContainer.remove(
                ['frame-preserve'],
                { preserveFrameContents: true },
            );
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        snapshot = await settle();
        if (
            snapshot.nodes.some(node => node.id === 'frame-preserve')
            || !snapshot.nodes.some(node => node.id === 'frame-preserve-child')
        ) {
            throw new Error('Frame preserve-contents deletion semantics diverged');
        }

        await pages[2].evaluate(async () => {
            const mutation = window.SmartCanvasModules.canvasMutation;
            mutation.create({
                kind: 'prepared',
                data: {
                    node: {
                        id: 'frame-cascade',
                        type: 'smart-frame',
                        x: 2200,
                        y: 300,
                        w: 500,
                        h: 360,
                        title: 'Cascade frame',
                        frameColor: 'violet',
                        items: [],
                    },
                },
                options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
            });
            mutation.create({
                kind: 'prepared',
                data: {
                    node: {
                        id: 'frame-cascade-child',
                        type: 'smart-image',
                        x: 2350,
                        y: 430,
                        title: 'Cascade child',
                        images: [],
                    },
                },
                options: { skipUndo: true, select: false, render: false, save: false, positionMode: 'exact' },
            });
            window.SmartCanvasModules.smartContainer.reconcileFrames();
            render();
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        await settle();
        await pages[2].evaluate(async () => {
            window.SmartCanvasModules.smartContainer.remove(['frame-cascade']);
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        snapshot = await settle();
        if (snapshot.nodes.some(node => (
            node.id === 'frame-cascade' || node.id === 'frame-cascade-child'
        ))) {
            throw new Error('Frame cascade deletion did not remove descendants');
        }

        const beforeUndoY = snapshot.nodes.find(node => node.id === 'node-b').y;
        await pages[0].evaluate(async () => {
            nodes.find(node => node.id === 'node-b').y += 90;
            render();
            await window.SmartCanvasModules.canvasPersistence.save();
        });
        snapshot = await settle();
        const movedY = snapshot.nodes.find(node => node.id === 'node-b').y;
        if (movedY === beforeUndoY) throw new Error('Move before Undo was not committed');
        await pages[0].evaluate(() => {
            window.SmartCanvasModules.canvasMutation.history({ action: 'undo' });
        });
        snapshot = await settle();
        if (snapshot.nodes.find(node => node.id === 'node-b').y !== beforeUndoY) {
            throw new Error('Per-user Undo did not restore its own field');
        }
        await pages[0].evaluate(() => {
            window.SmartCanvasModules.canvasMutation.history({ action: 'redo' });
        });
        snapshot = await settle();
        if (snapshot.nodes.find(node => node.id === 'node-b').y !== movedY) {
            throw new Error('Per-user Redo did not replay its own field');
        }
        await pages[0].evaluate(() => {
            window.SmartCanvasModules.canvasMutation.history({ action: 'undo' });
        });
        snapshot = await settle();

        const stackedUndoStartY = snapshot.nodes.find(
            node => node.id === 'node-b'
        ).y;
        for (const offset of [90, 180, 270]) {
            await pages[0].evaluate(async nextY => {
                nodes.find(node => node.id === 'node-b').y = nextY;
                render();
                await window.SmartCanvasModules.canvasPersistence.save();
            }, stackedUndoStartY + offset);
            await settle();
        }
        for (const expectedY of [
            stackedUndoStartY + 180,
            stackedUndoStartY + 90,
            stackedUndoStartY,
        ]) {
            await pages[0].evaluate(() => {
                window.SmartCanvasModules.canvasMutation.history({ action: 'undo' });
            });
            snapshot = await settle();
            if (snapshot.nodes.find(node => node.id === 'node-b').y !== expectedY) {
                throw new Error(
                    `Stacked Undo restored the wrong move: expected ${expectedY}`
                );
            }
        }

        await pages[4].evaluate(() => {
            window.SmartCanvasModules.canvasPersistence.retry();
        });
        await pages[4].waitForFunction(() => (
            window.SmartCanvasModules.canvasPersistence.status().state === 'ready'
        ), null, { timeout: 10000 });
        await settle();

        const stableNodeIds = [
            'node-a',
            'node-b',
            'node-x',
            'node-y',
            'frame-preserve-child',
        ];
        const propagationLatencies = [];
        const stabilityStartedAt = Date.now();
        let completedRounds = 0;
        while (
            completedRounds < rounds
            || Date.now() - stabilityStartedAt < durationMs
        ) {
            const round = completedRounds;
            const startedAt = Date.now();
            await Promise.all(pages.map((page, index) => page.evaluate(
                async ({ nodeId, roundIndex, clientIndex }) => {
                    const node = nodes.find(item => item.id === nodeId);
                    node.x = Number(node.x || 0) + clientIndex + 1;
                    node.title = `stable-${clientIndex}-${roundIndex}`;
                    render();
                    await window.SmartCanvasModules.canvasPersistence.save();
                },
                {
                    nodeId: stableNodeIds[index],
                    roundIndex: round,
                    clientIndex: index,
                },
            )));
            snapshot = await settle();
            await pages[4].waitForFunction(
                ({ nodeId, expected }) => (
                    nodes.find(node => node.id === nodeId)?.title === expected
                ),
                {
                    nodeId: stableNodeIds[0],
                    expected: `stable-0-${round}`,
                },
                { timeout: 5000 },
            );
            propagationLatencies.push(Date.now() - startedAt);
            completedRounds += 1;
            if (durationMs && completedRounds % 60 === 0) {
                console.error(JSON.stringify({
                    progress: true,
                    clients: pages.length,
                    rounds: completedRounds,
                    elapsedMs: Date.now() - stabilityStartedAt,
                    latestRevision: Number(snapshot.revision || 0),
                }));
            }
            if (roundDelayMs) {
                await new Promise(resolve => setTimeout(resolve, roundDelayMs));
            }
        }

        snapshot = await settle();
        const serverProjection = sharedProjection(snapshot);
        const clientProjections = await Promise.all(pages.map(page => page.evaluate(() => ({
            title: canvas.title || '',
            icon: canvas.icon || '',
            revision: Number(canvas.revision || 0),
            nodes: canvas.nodes || [],
            connections: canvas.connections || [],
            settings: canvas.settings || {},
            logs: canvas.logs || [],
        }))));
        clientProjections.forEach((projection, index) => {
            if (JSON.stringify(projection) !== JSON.stringify(serverProjection)) {
                throw new Error(`Client ${index} diverged from server Snapshot`);
            }
        });
        if (errors.length) throw new Error(errors.join('\n'));
        const sortedLatencies = propagationLatencies.slice().sort((a, b) => a - b);
        const p95Index = Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1);
        const p95LatencyMs = sortedLatencies[p95Index];
        if (p95LatencyMs > 500) {
            throw new Error(`Realtime propagation P95 exceeded 500ms: ${p95LatencyMs}ms`);
        }
        process.stdout.write(JSON.stringify({
            ok: true,
            clients: pages.length,
            capacityCloseCode,
            rounds:completedRounds,
            requestedDurationMs:durationMs,
            elapsedMs:Date.now() - stabilityStartedAt,
            finalRevision: serverProjection.revision,
            nodeCount: serverProjection.nodes.length,
            connectionCount: serverProjection.connections.length,
            propagationLatencySamples:propagationLatencies.length <= 100
                ? propagationLatencies
                : [
                    ...propagationLatencies.slice(0, 5),
                    ...propagationLatencies.slice(-5),
                ],
            propagationLatencyCount:propagationLatencies.length,
            propagationLatencyMinMs:sortedLatencies[0],
            propagationLatencyMaxMs:sortedLatencies[sortedLatencies.length - 1],
            p95LatencyMs,
        }, null, 2));
    } finally {
        if (canvasId && controlPage && !controlPage.isClosed()) {
            await controlPage.evaluate(async id => {
                await fetch(`/api/canvases/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                });
                await fetch(`/api/canvases/${encodeURIComponent(id)}/purge`, {
                    method: 'DELETE',
                });
            }, canvasId).catch(() => {});
        }
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
