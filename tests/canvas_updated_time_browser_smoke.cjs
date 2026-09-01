const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const requests = [];

function canvasFixture(id, kind) {
    return {
        id,
        kind,
        title:kind === 'smart' ? 'Smart read only' : 'Classic read only',
        icon:'layers',
        project:'default',
        updated_at:100,
        updated_by:'designer-1',
        revision:0,
        viewport:{x:0, y:0, scale:1},
        nodes:[
            {
                id:`${kind}-prompt`,
                type:kind === 'smart' ? 'smart-prompt' : 'prompt',
                title:'Prompt',
                text:'只浏览，不编辑。\n'.repeat(30),
                textHtml:'只浏览，不编辑。<br>'.repeat(30),
                x:120,
                y:140,
                w:360,
                h:260,
            },
            ...(kind === 'smart' ? [{
                id:'smart-image',
                type:'smart-image',
                title:'Image',
                queued:true,
                images:[{
                    url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                    name:'pixel.gif',
                    kind:'image',
                    natural_w:1,
                    natural_h:1,
                }],
                x:560,
                y:140,
                w:320,
                h:220,
            }] : []),
        ],
        connections:[],
        settings:{},
        logs:[],
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

async function installRoutes(context) {
    await context.route('http://canvas.local/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
            requests.push({method:request.method(), pathname:url.pathname});
        }
        if (url.pathname === '/api/config') {
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({
                    api_providers:[],
                    available_models:{image:[], video:[], text:[]},
                    comfy_instances:[],
                }),
            });
            return;
        }
        if (url.pathname === '/api/workflows') {
            await route.fulfill({status:200, contentType:'application/json', body:'{"workflows":[]}'});
            return;
        }
        if (url.pathname === '/api/prompt-libraries') {
            await route.fulfill({status:200, contentType:'application/json', body:'{"library":{"libraries":[]}}'});
            return;
        }
        if (url.pathname === '/api/smart-canvas/prompt-templates') {
            await route.fulfill({status:200, contentType:'application/json', body:'{"templates":[]}'});
            return;
        }
        if (url.pathname.endsWith('/view-state')) {
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:request.method() === 'GET' ? '{"view_state":null}' : '{"view_state":{"center_x":40,"center_y":20,"scale":1}}',
            });
            return;
        }
        const match = url.pathname.match(/^\/api\/canvases\/(classic|smart)-read-only$/);
        if (match) {
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({canvas:canvasFixture(`${match[1]}-read-only`, match[1])}),
            });
            return;
        }
        if (url.pathname.startsWith('/api/')) {
            await route.fulfill({status:200, contentType:'application/json', body:'{}'});
            return;
        }
        await fulfillWorkspaceFile(route);
    });
}

function forbiddenCanvasWrites(canvasId) {
    return requests.filter(request => (
        request.pathname === `/api/canvases/${canvasId}/touch`
        || (
            request.pathname === `/api/canvases/${canvasId}`
            && request.method !== 'GET'
        )
    ));
}

(async () => {
    if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
    const browser = await chromium.launch({headless:true, executablePath:CHROME});
    try {
        const context = await browser.newContext({viewport:{width:1280, height:820}});
        await installRoutes(context);

        const classic = await context.newPage();
        await classic.goto('http://canvas.local/static/canvas.html?id=classic-read-only', {
            waitUntil:'domcontentloaded',
        });
        await classic.waitForFunction(() => (
            typeof canvas !== 'undefined'
            && canvas?.id === 'classic-read-only'
            && !document.getElementById('shell')?.classList.contains('no-canvas')
        ));
        assert.deepEqual(forbiddenCanvasWrites('classic-read-only'), []);
        await classic.close();

        const smart = await context.newPage();
        await smart.addInitScript(snapshot => {
            window.__issue102SocketMessages = [];
            class ReadOnlyWebSocket {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;
                constructor(url) {
                    this.url = url;
                    this.readyState = ReadOnlyWebSocket.CONNECTING;
                    this.listeners = new Map();
                    setTimeout(() => {
                        this.readyState = ReadOnlyWebSocket.OPEN;
                        this.emit('open', {});
                        this.emit('message', {data:JSON.stringify(snapshot)});
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
                send(raw) {
                    try {
                        const message = JSON.parse(raw);
                        window.__issue102SocketMessages.push(message);
                        if (message.type === 'ping') {
                            setTimeout(() => this.emit('message', {
                                data:JSON.stringify({type:'pong', revision:0}),
                            }), 0);
                        }
                    } catch (_error) {}
                }
                close() {
                    this.readyState = ReadOnlyWebSocket.CLOSED;
                    this.emit('close', {code:1000});
                }
            }
            window.WebSocket = ReadOnlyWebSocket;
        }, {
            type:'canvas_snapshot',
            revision:0,
            canvas:canvasFixture('smart-read-only', 'smart'),
        });
        await smart.goto('http://canvas.local/static/smart-canvas.html?id=smart-read-only', {
            waitUntil:'domcontentloaded',
        });
        await smart.waitForFunction(() => (
            typeof canvas !== 'undefined'
            && canvas?.id === 'smart-read-only'
            && document.querySelector('.image-node[data-id="smart-prompt"]')
            && window.SmartCanvasModules.canvasPersistence.status().state === 'ready'
        ));
        await smart.waitForTimeout(250);
        const mutationsAfterOpen = await smart.evaluate(() => (
            window.__issue102SocketMessages.filter(
                message => message.type === 'canvas_mutation',
            )
        ));
        assert.deepEqual(mutationsAfterOpen, []);

        const selectedNode = smart.locator('.image-node[data-id="smart-image"]');
        await selectedNode.dispatchEvent('click');
        const selectedAfterClick = await smart.evaluate(() => (
            window.SmartCanvasModules.viewportSelection.selection.ids()
        ));
        assert.ok(
            selectedAfterClick.includes('smart-image'),
            JSON.stringify(selectedAfterClick),
        );
        const box = await selectedNode.boundingBox();
        assert.ok(box);
        await smart.mouse.move(box.x + 100, box.y + 20);
        await smart.mouse.down();
        await smart.mouse.move(box.x + 102, box.y + 21);
        await smart.mouse.up();
        await smart.locator('.image-node[data-id="smart-prompt"] .prompt-node-text').evaluate(editor => {
            editor.scrollTop = Math.min(80, editor.scrollHeight);
            editor.dispatchEvent(new Event('scroll', {bubbles:true}));
        });
        await smart.evaluate(() => {
            viewport.x += 40;
            viewport.y += 20;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:true});
        });
        await smart.waitForTimeout(1200);

        const state = await smart.evaluate(() => ({
            selectedIds:window.SmartCanvasModules.viewportSelection.selection.ids(),
            viewport:{x:viewport.x, y:viewport.y, scale:viewport.scale},
            socketMutations:window.__issue102SocketMessages.filter(
                message => message.type === 'canvas_mutation',
            ),
        }));
        assert.equal(state.viewport.x, 40);
        assert.equal(state.viewport.y, 20);
        assert.deepEqual(state.socketMutations, []);
        assert.deepEqual(forbiddenCanvasWrites('smart-read-only'), []);
        assert.ok(
            requests.some(request => (
                request.pathname === '/api/smart-canvas/smart-read-only/view-state'
                && request.method === 'PUT'
            )),
            requests,
        );
        await smart.close();

        process.stdout.write('Issue #102 Canvas Updated Time browser smoke passed.\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
