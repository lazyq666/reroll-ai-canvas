const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CANVAS_ID = 'issue-172-container-navigation-badge';

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

function canvasFixture() {
    return {
        id:CANVAS_ID,
        title:'Issue 172 container navigation badge',
        revision:0,
        nodes:[
            {
                id:'frame-a', type:'smart-frame', title:'镜头分区',
                x:500, y:500, w:620, h:420, items:[], frameColor:'violet',
            },
            {
                id:'group-a', type:'smart-group', title:'角色编组',
                x:2600, y:560, w:420, h:300, items:[], images:[],
            },
        ],
        connections:[],
        settings:{},
        logs:[],
    };
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

async function dragBadge(page, nodeId, dx, dy) {
    const badge = page.locator(`.image-node[data-id="${nodeId}"] > .smart-container-navigation-badge`);
    const before = await badge.evaluate(element => {
        const nodeElement = element.parentElement;
        const badgeRect = element.getBoundingClientRect();
        const nodeRect = nodeElement.getBoundingClientRect();
        const model = nodes.find(node => node.id === nodeElement.dataset.id);
        return {
            badge:{left:badgeRect.left, top:badgeRect.top},
            node:{left:nodeRect.left, top:nodeRect.top},
            model:{x:model.x, y:model.y},
        };
    });
    const box = await badge.boundingBox();
    assert.ok(box, `${nodeId}: badge is not visible`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    const during = await badge.evaluate(element => {
        const nodeElement = element.parentElement;
        const badgeRect = element.getBoundingClientRect();
        const nodeRect = nodeElement.getBoundingClientRect();
        const model = nodes.find(node => node.id === nodeElement.dataset.id);
        return {
            dragKind:window.SmartCanvasModules.canvasInteraction.active()?.kind || '',
            draggedNodeIds:window.SmartCanvasModules.canvasInteraction.active()?.nodeIds || [],
            badge:{left:badgeRect.left, top:badgeRect.top},
            node:{left:nodeRect.left, top:nodeRect.top},
            model:{x:model.x, y:model.y},
        };
    });
    await page.mouse.up();
    return {before, during};
}

(async () => {
    if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
    const browser = await chromium.launch({headless:true, executablePath:CHROME});
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
                        (this.listeners.get(type) || []).filter(item => item !== listener),
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
        await page.route('http://canvas.local/**', async route => {
            const pathname = new URL(route.request().url()).pathname;
            let body = null;
            if (pathname === '/api/config') {
                body = {api_providers:[], available_models:{image:[], video:[], text:[]}, comfy_instances:[]};
            } else if (pathname === '/api/workflows') {
                body = {workflows:[]};
            } else if (pathname === '/api/prompt-libraries') {
                body = {library:{libraries:[]}};
            } else if (pathname === '/api/smart-canvas/prompt-templates') {
                body = {templates:[]};
            } else if (pathname.startsWith('/api/canvases/')) {
                body = {canvas:canvasFixture()};
            } else if (pathname.startsWith('/api/')) {
                body = {};
            }
            if (body !== null) {
                await route.fulfill({
                    status:200,
                    contentType:'application/json; charset=utf-8',
                    body:JSON.stringify(body),
                });
                return;
            }
            await fulfillWorkspaceFile(route);
        });
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', error => errors.push(error.stack || error.message));

        await page.goto(`http://canvas.local/static/smart-canvas.html?id=${CANVAS_ID}`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => (
            document.title === 'Issue 172 container navigation badge'
            && typeof nodes !== 'undefined'
            && nodes.length === 2
        ));
        assert.equal(
            await page.locator('.smart-container-navigation-badge').count(),
            0,
            'container badges must not render in detail mode',
        );

        await page.evaluate(() => {
            viewport.scale = 0.2;
            viewport.x = 300;
            viewport.y = 250;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.waitForFunction(() => (
            document.querySelector('#shell')?.dataset.canvasLod === 'far'
            && document.querySelectorAll('.smart-container-navigation-badge').length === 2
        ));
        await settleFrames(page);

        const badgeState = await page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;border:1px solid var(--ui-color-border-nodes);border-radius:var(--ui-radius-s);background:var(--ui-color-surface)';
            document.body.appendChild(probe);
            const probeStyle = getComputedStyle(probe);
            const expected = {
                radius:probeStyle.borderRadius,
                borderColor:probeStyle.borderColor,
                backgroundColor:probeStyle.backgroundColor,
            };
            probe.remove();
            return [...document.querySelectorAll('.smart-container-navigation-badge')].map(badge => {
                const style = getComputedStyle(badge);
                return {
                    nodeId:badge.parentElement.dataset.id,
                    parentKind:badge.parentElement.getAttribute('kind'),
                    text:badge.textContent,
                    directChild:badge.parentElement.matches('.image-node.canvas-lod-node-far'),
                    radius:style.borderRadius,
                    expectedRadius:expected.radius,
                    borderColor:style.borderColor,
                    expectedBorderColor:expected.borderColor,
                    backgroundColor:style.backgroundColor,
                    expectedBackgroundColor:expected.backgroundColor,
                    pointerEvents:style.pointerEvents,
                };
            });
        });
        assert.deepEqual(
            badgeState.map(item => [item.nodeId, item.parentKind, item.text, item.directChild]),
            [
                ['frame-a', 'frame', '镜头分区', true],
                ['group-a', 'smart-group', '角色编组', true],
            ],
        );
        badgeState.forEach(item => {
            assert.equal(item.radius, item.expectedRadius, `${item.nodeId}: radius differs from node token`);
            assert.equal(item.borderColor, item.expectedBorderColor, `${item.nodeId}: border differs from node token`);
            assert.equal(item.backgroundColor, item.expectedBackgroundColor, `${item.nodeId}: surface differs from node token`);
            assert.equal(item.pointerEvents, 'auto', `${item.nodeId}: badge is not draggable`);
        });

        const darkBadgeState = await page.evaluate(() => {
            document.documentElement.classList.add('theme-dark', 'studio-theme-dark');
            document.documentElement.dataset.uiTheme = 'dark';
            document.documentElement.style.colorScheme = 'dark';
            document.body.classList.add('theme-dark', 'studio-theme-dark');
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;border:1px solid var(--ui-color-border-nodes);border-radius:var(--ui-radius-s);background:var(--ui-color-surface)';
            document.body.appendChild(probe);
            const probeStyle = getComputedStyle(probe);
            const expected = {
                radius:probeStyle.borderRadius,
                borderColor:probeStyle.borderColor,
                backgroundColor:probeStyle.backgroundColor,
            };
            probe.remove();
            return [...document.querySelectorAll('.smart-container-navigation-badge')].map(badge => {
                const style = getComputedStyle(badge);
                return {
                    nodeId:badge.parentElement.dataset.id,
                    radius:style.borderRadius,
                    borderColor:style.borderColor,
                    backgroundColor:style.backgroundColor,
                    expected,
                };
            });
        });
        darkBadgeState.forEach(item => {
            assert.equal(item.radius, item.expected.radius, `${item.nodeId}: dark radius differs from node token`);
            assert.equal(item.borderColor, item.expected.borderColor, `${item.nodeId}: dark border differs from node token`);
            assert.equal(item.backgroundColor, item.expected.backgroundColor, `${item.nodeId}: dark surface differs from node token`);
        });

        const drags = [];
        for (const nodeId of ['frame-a', 'group-a']) {
            const result = await dragBadge(page, nodeId, 44, 30);
            drags.push({nodeId, ...result});
            assert.equal(result.during.dragKind, 'move-nodes', `${nodeId}: badge did not start node drag`);
            assert.ok(result.during.draggedNodeIds.includes(nodeId), `${nodeId}: wrong node entered the drag`);
            assert.ok(Math.abs((result.during.badge.left - result.before.badge.left) - 44) < 1, `${nodeId}: badge lagged horizontally`);
            assert.ok(Math.abs((result.during.badge.top - result.before.badge.top) - 30) < 1, `${nodeId}: badge lagged vertically`);
            assert.ok(Math.abs((result.during.node.left - result.before.node.left) - 44) < 1, `${nodeId}: node did not follow badge horizontally`);
            assert.ok(Math.abs((result.during.node.top - result.before.node.top) - 30) < 1, `${nodeId}: node did not follow badge vertically`);
            assert.ok(Math.abs((result.during.model.x - result.before.model.x) - 220) < 1, `${nodeId}: model x did not use Canvas scale`);
            assert.ok(Math.abs((result.during.model.y - result.before.model.y) - 150) < 1, `${nodeId}: model y did not use Canvas scale`);
        }

        await page.evaluate(() => {
            viewport.scale = 0.4;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.waitForFunction(() => (
            document.querySelector('#shell')?.dataset.canvasLod === 'detail'
            && document.querySelectorAll('.smart-container-navigation-badge').length === 0
        ));
        assert.equal(errors.length, 0, errors.join('\n'));
        process.stdout.write(`${JSON.stringify({result:'passed', badges:{light:badgeState, dark:darkBadgeState}, drags})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
