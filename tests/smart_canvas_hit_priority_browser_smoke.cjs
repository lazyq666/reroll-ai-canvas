const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function pointerState(page, x, y, options={}) {
    await page.mouse.move(x, y, {steps:options.steps || 8});
    await page.waitForTimeout(options.wait ?? 34);
    return page.evaluate(({x, y}) => {
        const hit = document.elementFromPoint(x, y);
        const zone = document.querySelector('.smart-node-quick-add-zone:is(.is-active,.is-exit-grace,.is-menu-locked,.is-keyboard-locked)');
        const hovered = document.querySelector('.connection-materialization.is-pointer-hover');
        return {
            hitClass:hit?.closest?.('.conn-cut')
                ? 'conn-cut'
                : hit?.closest?.('[data-node-quick-add]')
                ? 'smart-node-quick-add'
                : hit?.getAttribute?.('class') || hit?.localName || '',
            zoneNode:zone?.closest('.image-node')?.dataset.id || '',
            zonePort:zone?.querySelector('[data-node-quick-add]')?.dataset.port || '',
            zoneState:zone?.className || '',
            zonePointerEvents:zone ? getComputedStyle(zone).pointerEvents : '',
            hoveredConnection:hovered?.dataset.connectionKey || '',
            selectedConnection:document.querySelector('.connection-selected')?.dataset.connectionKey || '',
            hasCut:Boolean(document.querySelector('.conn-cut')),
            shellClass:document.querySelector('.shell')?.className || '',
            frameHeadPointerEvents:getComputedStyle(document.querySelector('.smart-frame-node .node-head')).pointerEvents,
            connectionLayerPointerEvents:document.querySelector('.connection-layer')
                ? getComputedStyle(document.querySelector('.connection-layer')).pointerEvents
                : '',
            connectionHitPointerEvents:document.querySelector('[data-connection-key="line-a|line-b|flow"] .conn-hit')
                ? getComputedStyle(document.querySelector('[data-connection-key="line-a|line-b|flow"] .conn-hit')).pointerEvents
                : '',
        };
    }, {x, y});
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const errors = [];
    try {
        const context = await browser.newContext({viewport:{width:1280, height:820}});
        const page = await context.newPage();
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
                    this.listeners.set(
                        type,
                        (this.listeners.get(type) || []).filter(item => item !== listener)
                    );
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
        await page.route('**/api/**', async route => {
            const pathname = new URL(route.request().url()).pathname;
            const body = pathname === '/api/config'
                ? {api_providers:[], available_models:{image:[],video:[],text:[]}, comfy_instances:[]}
                : pathname === '/api/workflows'
                ? {workflows:[]}
                : pathname === '/api/prompt-libraries'
                ? {library:{libraries:[]}}
                : pathname === '/api/smart-canvas/prompt-templates'
                ? {templates:[]}
                : pathname.startsWith('/api/canvases/')
                ? {canvas:{
                    id:'hit-priority-regression',
                    title:'Hit Priority Regression',
                    revision:0,
                    nodes:[],
                    connections:[],
                    logs:[],
                }}
                : {};
            await route.fulfill({
                status:200,
                contentType:'application/json; charset=utf-8',
                body:JSON.stringify(body),
            });
        });
        page.on('console', message => {
            if(message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=hit-priority-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && window.SmartCanvasModules?.smartContainer
            && document.querySelector('svg.connection-layer')
            && document.title === 'Hit Priority Regression'
        ));
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length,
                    {id:'frame-a', type:'smart-frame', title:'命中测试', x:100, y:100, w:760, h:560, items:[], frameColor:'blue'},
                    {id:'line-a', type:'smart-prompt', title:'A', text:'A', x:160, y:230, w:260, h:118},
                    {id:'line-b', type:'smart-prompt', title:'B', text:'B', x:600, y:230, w:260, h:118},
                    {id:'title-a', type:'smart-prompt', title:'T1', text:'T1', x:-180, y:30, w:260, h:118},
                    {id:'title-b', type:'smart-prompt', title:'T2', text:'T2', x:980, y:30, w:260, h:118},
                    {id:'frame-button', type:'smart-prompt', title:'FB', text:'FB', x:116, y:30, w:260, h:118},
                    {id:'overlap-a', type:'smart-prompt', title:'O1', text:'O1', x:160, y:500, w:260, h:118},
                    {id:'overlap-b', type:'smart-prompt', title:'O2', text:'O2', x:484, y:500, w:260, h:118},
                    {id:'layer-a', type:'smart-prompt', title:'L1', text:'L1', x:0, y:680, w:200, h:100},
                    {id:'layer-b', type:'smart-prompt', title:'L2', text:'L2', x:1000, y:680, w:200, h:100},
                    {id:'layer-group', type:'smart-group', title:'编组', x:480, y:670, w:240, h:120, items:[]}
                );
                canvas = {id:'hit-priority-regression', nodes, connections:[
                    {from:'line-a', to:'line-b', kind:'flow'},
                    {from:'title-a', to:'title-b', kind:'flow'},
                    {from:'layer-a', to:'layer-b', kind:'flow'}
                ], logs:[]};
                selectedId = '';
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                render();
            })();`;
            document.body.appendChild(script);
            script.remove();
        });
        await page.waitForSelector('.connection-layer .conn-hit', {state:'attached'});
        const geometry = await page.evaluate(() => {
            const pointOn = (key, ratio) => {
                const path = document.querySelector(`[data-connection-key="${key}"] .conn-hit`);
                const point = path.getPointAtLength(path.getTotalLength() * ratio);
                return {x:point.x, y:point.y};
            };
            const zoneCenter = (nodeId, port) => {
                const zone = document.querySelector(`.image-node[data-id="${nodeId}"] [data-port="${port}"]`).closest('.smart-node-quick-add-zone');
                const rect = zone.getBoundingClientRect();
                return {x:(rect.left + rect.right) / 2, y:(rect.top + rect.bottom) / 2};
            };
            const overlapA = zoneCenter('overlap-a', 'out');
            const overlapB = zoneCenter('overlap-b', 'in');
            const expandedTargetRect = document.querySelector(
                '.image-node[data-id="overlap-a"]'
            ).getBoundingClientRect();
            return {
                lineHover:pointOn('line-a|line-b|flow', .5),
                lineSelect:pointOn('line-a|line-b|flow', .55),
                quickAdd:zoneCenter('line-a', 'out'),
                frameButton:zoneCenter('frame-button', 'out'),
                titleLine:pointOn('title-a|title-b|flow', .5),
                groupLine:pointOn('layer-a|layer-b|flow', .5),
                overlapA,
                overlapB,
                expandedTarget:{
                    x:expandedTargetRect.left - 20,
                    y:(expandedTargetRect.top + expandedTargetRect.bottom) / 2,
                },
                overlapBoundary:{
                    x:(overlapA.x + overlapB.x) / 2,
                    y:(overlapA.y + overlapB.y) / 2,
                },
            };
        });

        const smartGroupLayer = await page.evaluate(point => {
            const hit = document.elementFromPoint(point.x, point.y);
            const group = document.querySelector('.smart-group-node[data-id="layer-group"]');
            const connection = document.querySelector('[data-connection-key="layer-a|layer-b|flow"]');
            return {
                hitGroupId:hit?.closest?.('.smart-group-node')?.dataset.id || '',
                hitConnection:Boolean(hit?.closest?.('[data-connection-key="layer-a|layer-b|flow"]')),
                groupZIndex:getComputedStyle(group).zIndex,
                connectionZIndex:getComputedStyle(connection.closest('.connection-layer')).zIndex,
            };
        }, geometry.groupLine);
        assert.deepEqual(smartGroupLayer, {
            hitGroupId:'layer-group',
            hitConnection:false,
            groupZIndex:'2',
            connectionZIndex:'1',
        });

        const frameBackground = await page.evaluate(() => {
            const hit = document.elementFromPoint(320, 440);
            return {
                target:hit?.className || hit?.localName || '',
                frameId:hit?.closest?.('.smart-frame-node')?.dataset.id || '',
                connectionLayer:hit?.classList?.contains?.('connection-layer') || false,
            };
        });
        assert.equal(frameBackground.connectionLayer, false);
        assert.equal(frameBackground.frameId, 'frame-a');
        await page.mouse.click(320, 440);
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.smart-frame-node').evaluate(el => el.classList.contains('selected')), true);

        const frameTitle = await page.evaluate(point => {
            const hit = document.elementFromPoint(point.x, point.y);
            return {
                frameControl:Boolean(hit?.closest?.('.smart-frame-node .node-head')),
                connection:Boolean(hit?.closest?.('.conn-hit')),
            };
        }, geometry.titleLine);
        assert.deepEqual(frameTitle, {frameControl:true, connection:false});

        await pointerState(page, 200, 180);
        assert.equal(
            await page.locator('.image-node[data-id="frame-button"] .smart-node-quick-add-zone.is-preview').count(),
            2
        );
        let state = await pointerState(page, geometry.frameButton.x, geometry.frameButton.y);
        assert.match(state.hitClass, /smart-node-quick-add/, JSON.stringify(state));
        assert.equal(state.zoneNode, 'frame-button');
        await pointerState(page, 320, 440, {steps:1, wait:12});
        await page.waitForTimeout(100);

        state = await pointerState(page, geometry.lineHover.x, geometry.lineHover.y);
        assert.equal(state.hoveredConnection, 'line-a|line-b|flow', JSON.stringify({state,geometry}));
        state = await pointerState(page, geometry.quickAdd.x, geometry.quickAdd.y);
        assert.equal(state.zoneNode, 'line-a');
        assert.equal(state.zonePort, 'out');
        assert.match(state.zoneState, /is-active/);
        assert.equal(state.hoveredConnection, '');

        state = await pointerState(page, geometry.lineHover.x, geometry.lineHover.y, {steps:1, wait:12});
        assert.match(state.zoneState, /is-exit-grace/);
        assert.equal(state.zonePointerEvents, 'none');
        assert.equal(state.hoveredConnection, 'line-a|line-b|flow');
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.smart-node-quick-add-zone.is-exit-grace').count(), 0);

        state = await pointerState(page, geometry.overlapBoundary.x - 1, geometry.overlapBoundary.y);
        const firstOverlap = `${state.zoneNode}:${state.zonePort}`;
        state = await pointerState(page, geometry.overlapBoundary.x + 1, geometry.overlapBoundary.y);
        assert.equal(`${state.zoneNode}:${state.zonePort}`, firstOverlap);
        state = await pointerState(page, geometry.overlapBoundary.x + 8, geometry.overlapBoundary.y);
        assert.notEqual(`${state.zoneNode}:${state.zonePort}`, firstOverlap);
        const visibleOverlapButtons = await page.evaluate(() => [
            ...document.querySelectorAll(
                '.image-node:is([data-id="overlap-a"],[data-id="overlap-b"]) .smart-node-quick-add-zone:is(.is-preview,.is-active,.is-exit-grace,.is-menu-locked,.is-keyboard-locked)'
            )
        ].map(zone => ({
            node:zone.closest('.image-node')?.dataset.id,
            port:zone.querySelector('[data-node-quick-add]')?.dataset.port,
        })));
        assert.deepEqual(
            visibleOverlapButtons,
            [
                {node:'overlap-b', port:'out'},
                {node:'overlap-b', port:'in'},
            ],
            'switching to O2 must immediately hide every O1 quick-add button'
        );

        state = await pointerState(page, geometry.quickAdd.x, geometry.quickAdd.y);
        await page.mouse.click(geometry.quickAdd.x, geometry.quickAdd.y);
        await page.waitForTimeout(34);
        state = await pointerState(page, geometry.lineHover.x, geometry.lineHover.y);
        assert.equal(state.zoneNode, 'line-a');
        assert.match(state.zoneState, /is-menu-locked/);
        assert.equal(state.hoveredConnection, 'line-a|line-b|flow');
        state = await pointerState(page, geometry.overlapB.x, geometry.overlapB.y);
        assert.equal(state.zoneNode, 'line-a');
        assert.match(state.zoneState, /is-menu-locked/);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(34);
        state = await pointerState(page, geometry.overlapB.x, geometry.overlapB.y);
        assert.equal(state.zoneNode, 'overlap-b');

        await page.locator('.image-node[data-id="line-a"] [data-port="out"]').evaluate(trigger => {
            (trigger.shadowRoot?.querySelector('button') || trigger).focus();
        });
        await page.waitForTimeout(16);
        state = await pointerState(page, geometry.overlapA.x, geometry.overlapA.y);
        assert.equal(state.zoneNode, 'line-a');
        assert.match(state.zoneState, /is-keyboard-locked/);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(34);
        state = await pointerState(page, geometry.overlapA.x, geometry.overlapA.y);
        assert.equal(state.zoneNode, 'overlap-a');

        await pointerState(page, geometry.quickAdd.x, geometry.quickAdd.y);
        await page.mouse.down();
        await page.mouse.move(geometry.quickAdd.x + 20, geometry.quickAdd.y, {steps:4});
        await page.waitForTimeout(16);
        const dragging = await page.evaluate(() => ({
            exclusive:document.querySelector('.shell')?.classList.contains('port-dragging'),
            hoverCount:document.querySelectorAll('.connection-materialization.is-pointer-hover').length,
            activeZones:[...document.querySelectorAll('.smart-node-quick-add-zone.is-active')]
                .map(zone => zone.closest('.image-node')?.dataset.id),
        }));
        assert.deepEqual(dragging, {exclusive:true, hoverCount:0, activeZones:['line-a']});
        await page.mouse.move(geometry.expandedTarget.x, geometry.expandedTarget.y, {steps:8});
        await page.waitForTimeout(200);
        const expandedTarget = await page.evaluate(() => {
            const zone=document.querySelector('.smart-node-quick-add-zone.is-port-target');
            const trigger=zone?.querySelector('[data-node-quick-add]');
            return {
                nodeId:zone?.closest('.image-node')?.dataset.id || '',
                port:trigger?.dataset.port || '',
                visible:zone ? getComputedStyle(zone).opacity === '1' : false,
                pointerEvents:zone ? getComputedStyle(zone).pointerEvents : '',
                triggerActive:Boolean(trigger?.classList.contains('is-active')),
                nodeHighlighted:Boolean(zone?.closest('.image-node')?.classList.contains('port-hover')),
            };
        });
        assert.deepEqual(expandedTarget, {
            nodeId:'overlap-a',
            port:'in',
            visible:true,
            pointerEvents:'auto',
            triggerActive:true,
            nodeHighlighted:true,
        });
        await page.mouse.up();
        await page.waitForTimeout(34);
        assert.equal(await page.locator('.shell.port-dragging').count(), 0);
        assert.equal(await page.locator('.smart-node-quick-add-zone.is-port-target').count(), 0);
        assert.equal(await page.evaluate(() => canvas.connections.some(connection => (
            connection.from === 'line-a'
            && connection.to === 'overlap-a'
            && connection.kind === 'input'
        ))), true);

        await pointerState(page, geometry.lineSelect.x, geometry.lineSelect.y);
        await page.mouse.click(geometry.lineSelect.x, geometry.lineSelect.y);
        await page.waitForTimeout(34);
        state = await pointerState(page, geometry.quickAdd.x, geometry.quickAdd.y);
        assert.equal(state.selectedConnection, 'line-a|line-b|flow');
        assert.equal(state.hasCut, true);
        assert.equal(state.zoneNode, 'line-a');

        await page.evaluate(() => {
            const cut = document.querySelector('.conn-cut');
            const transform = cut?.getAttribute('transform')?.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
            window.__cutPoint = transform ? {x:Number(transform[1]), y:Number(transform[2])} : null;
        });
        const cutPoint = await page.evaluate(() => window.__cutPoint);
        await page.evaluate(point => {
            const node = nodes.find(item => item.id === 'overlap-a');
            const zone = document.querySelector('.image-node[data-id="overlap-a"] [data-port="out"]')
                .closest('.smart-node-quick-add-zone');
            const rect = zone.getBoundingClientRect();
            node.x += point.x - (rect.left + rect.right) / 2;
            node.y += point.y - (rect.top + rect.bottom) / 2;
            render();
        }, cutPoint);
        await page.waitForTimeout(34);
        state = await pointerState(page, cutPoint.x, cutPoint.y);
        assert.match(state.hitClass, /conn-cut|conn-cut-icon/);
        assert.equal(state.hasCut, true);
        assert.doesNotMatch(state.zoneState, /is-active/);
        assert.notEqual(state.zonePointerEvents, 'auto');
        await page.mouse.click(cutPoint.x, cutPoint.y);
        await page.waitForTimeout(34);
        assert.equal(await page.locator('.conn-cut').count(), 0);
        assert.equal(await page.locator('[data-connection-key="line-a|line-b|flow"]').count(), 0);

        assert.deepEqual(errors, []);
        console.log(JSON.stringify({
            passed:true,
            frameBackground,
            frameTitle,
            smartGroupLayer,
            visibleButtonOverFrameControl:'quick-add button',
            lineToQuickAdd:'active',
            exitGrace:'80ms non-blocking',
            overlapHysteresis:'stable then switched',
            menuKeyboardDrag:'locked and restored',
            selectedAndCut:'preserved, prioritized, and deleted',
        }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
