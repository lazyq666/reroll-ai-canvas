const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CANVAS_ID = 'issue-176-far-prompt-wheel';

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
    const longText = Array.from({length:30}, (_, index) => `第 ${index + 1} 行提示词`).join('\n');
    return {
        id:CANVAS_ID,
        title:'Issue 176 far prompt wheel regression',
        revision:0,
        nodes:[
            {
                id:'prompt-short', type:'smart-prompt', title:'短提示词',
                x:120, y:120, w:320, h:220, text:'内容完整展示',
            },
            {
                id:'prompt-overflow', type:'smart-prompt', title:'长提示词',
                x:120, y:420, w:320, h:220, text:longText,
            },
            {
                id:'prompt-generation-short', type:'smart-prompt', title:'短提示词生成',
                x:560, y:120, w:320, h:220, text:'内容完整展示', llmEnabled:true,
            },
            {
                id:'prompt-generation-overflow', type:'smart-prompt', title:'长提示词生成',
                x:560, y:420, w:320, h:220, text:longText, llmEnabled:true,
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

async function wheelOverFarPrompt(page, nodeId) {
    await page.evaluate(id => {
        const node = nodes.find(item => item.id === id);
        viewport.x = shell.clientWidth / 2 - (node.x + node.w / 2) * viewport.scale;
        viewport.y = shell.clientHeight / 2 - (node.y + node.h / 2) * viewport.scale;
        window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
    }, nodeId);
    await settleFrames(page);
    const node = page.locator(`.image-node[data-id="${nodeId}"]`);
    await node.locator('.far-prompt-skeleton').waitFor();
    const point = await node.locator('.far-prompt-skeleton').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
    });
    const before = await page.evaluate(() => ({
        x:viewport.x, y:viewport.y, scale:viewport.scale,
    }));
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => ({
        x:viewport.x, y:viewport.y, scale:viewport.scale,
    }));
    return {nodeId, before, after};
}

async function wheelOverDetailPrompt(page, nodeId, editorSelector, {boundary=false, selected=false}={}) {
    await page.evaluate(id => {
        const node = nodes.find(item => item.id === id);
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        viewport.scale = 1;
        viewport.x = shell.clientWidth / 2 - (node.x + node.w / 2);
        viewport.y = shell.clientHeight / 2 - (node.y + node.h / 2);
        window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        window.SmartCanvasModules.viewportSelection.selection.refresh();
    }, nodeId);
    await settleFrames(page);
    const node = page.locator(`.image-node[data-id="${nodeId}"]`);
    if (selected) {
        await node.click({position:{x:16, y:16}});
        await settleFrames(page);
    }
    const editor = page.locator(`.image-node[data-id="${nodeId}"] ${editorSelector}`);
    await editor.waitFor();
    const before = await editor.evaluate((element, atBoundary) => {
        element.scrollTop = atBoundary ? element.scrollHeight : 0;
        return {
            scrollTop:element.scrollTop,
            scrollHeight:element.scrollHeight,
            clientHeight:element.clientHeight,
            selected:element.closest('.image-node')?.classList.contains('selected') || false,
            viewport:{x:viewport.x, y:viewport.y, scale:viewport.scale},
        };
    }, boundary);
    const point = await editor.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(80);
    const after = await editor.evaluate(element => ({
        scrollTop:element.scrollTop,
        viewport:{x:viewport.x, y:viewport.y, scale:viewport.scale},
    }));
    return {
        nodeId,
        boundary,
        selected,
        overflowing:before.scrollHeight > before.clientHeight + 1,
        before,
        after,
    };
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
            document.title === 'Issue 176 far prompt wheel regression'
            && document.querySelectorAll('.image-node.prompt-smart-node').length === 4
        ));

        const detailResults = {
            short:[],
            selectedShort:[],
            unselectedOverflow:[],
            selectedOverflow:[],
            selectedBoundary:[],
        };
        for (const [nodeId, selector] of [
            ['prompt-short', '.prompt-node-text'],
            ['prompt-generation-short', '.prompt-llm-instruction'],
        ]) {
            detailResults.short.push(await wheelOverDetailPrompt(page, nodeId, selector));
            detailResults.selectedShort.push(await wheelOverDetailPrompt(page, nodeId, selector, {selected:true}));
        }
        for (const [nodeId, selector] of [
            ['prompt-overflow', '.prompt-node-text'],
            ['prompt-generation-overflow', '.prompt-llm-instruction'],
        ]) {
            detailResults.unselectedOverflow.push(await wheelOverDetailPrompt(page, nodeId, selector));
            detailResults.selectedOverflow.push(await wheelOverDetailPrompt(page, nodeId, selector, {selected:true}));
            detailResults.selectedBoundary.push(await wheelOverDetailPrompt(page, nodeId, selector, {boundary:true, selected:true}));
        }
        detailResults.short.forEach(result => {
            assert.equal(result.overflowing, false, `${result.nodeId}: short editor unexpectedly overflows`);
            assert.equal(result.before.selected, false, `${result.nodeId}: node unexpectedly selected`);
            assert.equal(result.after.scrollTop, result.before.scrollTop, `${result.nodeId}: short editor scrolled`);
            assert.equal(result.after.viewport.x, result.before.viewport.x, `${result.nodeId}: horizontal viewport changed`);
            assert.equal(result.after.viewport.scale, result.before.viewport.scale, `${result.nodeId}: viewport zoomed`);
            assert.ok(
                result.after.viewport.y < result.before.viewport.y,
                `${result.nodeId}: non-overflowing editor still blocked Canvas pan: ${JSON.stringify(result)}`,
            );
        });
        detailResults.selectedShort.forEach(result => {
            assert.equal(result.overflowing, false, `${result.nodeId}: short editor unexpectedly overflows`);
            assert.equal(result.before.selected, true, `${result.nodeId}: click did not select node`);
            assert.equal(result.after.scrollTop, result.before.scrollTop, `${result.nodeId}: short editor scrolled`);
            assert.equal(result.after.viewport.x, result.before.viewport.x, `${result.nodeId}: horizontal viewport changed`);
            assert.equal(result.after.viewport.scale, result.before.viewport.scale, `${result.nodeId}: viewport zoomed`);
            assert.ok(
                result.after.viewport.y < result.before.viewport.y,
                `${result.nodeId}: selected non-overflowing editor blocked Canvas pan: ${JSON.stringify(result)}`,
            );
        });
        detailResults.unselectedOverflow.forEach(result => {
            assert.equal(result.overflowing, true, `${result.nodeId}: long editor does not overflow`);
            assert.equal(result.before.selected, false, `${result.nodeId}: node unexpectedly selected`);
            assert.equal(result.after.scrollTop, result.before.scrollTop, `${result.nodeId}: unselected editor consumed Wheel`);
            assert.equal(result.after.viewport.x, result.before.viewport.x, `${result.nodeId}: horizontal viewport changed`);
            assert.equal(result.after.viewport.scale, result.before.viewport.scale, `${result.nodeId}: viewport zoomed`);
            assert.ok(
                result.after.viewport.y < result.before.viewport.y,
                `${result.nodeId}: unselected editor still blocked Canvas pan: ${JSON.stringify(result)}`,
            );
        });
        detailResults.selectedOverflow.forEach(result => {
            assert.equal(result.overflowing, true, `${result.nodeId}: long editor does not overflow`);
            assert.equal(result.before.selected, true, `${result.nodeId}: click did not select node`);
            assert.ok(result.after.scrollTop > result.before.scrollTop, `${result.nodeId}: selected editor did not scroll`);
            assert.deepEqual(result.after.viewport, result.before.viewport, `${result.nodeId}: Wheel leaked to Canvas`);
        });
        detailResults.selectedBoundary.forEach(result => {
            assert.equal(result.overflowing, true, `${result.nodeId}: boundary editor does not overflow`);
            assert.equal(result.before.selected, true, `${result.nodeId}: click did not select node`);
            assert.equal(result.after.scrollTop, result.before.scrollTop, `${result.nodeId}: boundary scroll position changed`);
            assert.deepEqual(result.after.viewport, result.before.viewport, `${result.nodeId}: boundary Wheel leaked to Canvas`);
        });

        await page.evaluate(() => {
            viewport.scale = 0.22;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.waitForFunction(() => (
            document.querySelector('#shell')?.dataset.canvasLod === 'far'
            && document.querySelectorAll('.image-node.canvas-lod-node-far .far-prompt-skeleton').length === 4
        ));

        const results = [];
        for (const nodeId of ['prompt-short', 'prompt-generation-short']) {
            results.push(await wheelOverFarPrompt(page, nodeId));
        }
        assert.equal(errors.length, 0, errors.join('\n'));
        results.forEach(result => {
            assert.equal(result.after.x, result.before.x, `${result.nodeId}: horizontal viewport changed`);
            assert.equal(result.after.scale, result.before.scale, `${result.nodeId}: viewport zoomed`);
            assert.ok(
                result.after.y < result.before.y,
                `${result.nodeId}: far skeleton still blocked Canvas pan: ${JSON.stringify(result)}`,
            );
        });
        process.stdout.write(`${JSON.stringify({result:'passed', detail:detailResults, far:results})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
