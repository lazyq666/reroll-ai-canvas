// Full temporary app, actual ConnectionManager/SQLite/native WebSockets, no Provider calls.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
    const server = spawn(process.env.PYTHON || path.join(root, '.venv/bin/python'),
        ['-u', '-m', 'tests.canvas_sync_large_live_app'], {cwd:root,
            env:{...process.env, CANVAS_SYNC_TEST_PASSWORD:randomBytes(24).toString('hex')},
            stdio:['ignore', 'pipe', 'pipe']});
    let logs = '', browser;
    server.stderr.on('data', data=>{logs = (logs + data).slice(-8000);});
    try {
        const auth = await new Promise((resolve, reject) => {
            let output = '';
            const timer = setTimeout(()=>reject(Error(`Fixture startup failed: ${logs}`)), 30000);
            server.stdout.on('data', data=>{
                output += data;
                const line = output.split('\n').find(value=>value.startsWith('{"port"'));
                if(line) {clearTimeout(timer); resolve(JSON.parse(line));}
            });
            server.once('exit', ()=>{clearTimeout(timer); reject(Error(`Fixture exited: ${logs}`));});
        });
        const base = `http://127.0.0.1:${auth.port}`;
        browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER
            || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
        const context = await browser.newContext();
        await context.addCookies([{name:'ic_session', value:auth.cookie, url:base}]);
        let providerRequests = 0;
        await context.route(/\/api\/(generate|canvas-(image|video)-tasks|agent\/v1\/image-runs)/, route=>{
            providerRequests++;
            return route.abort('blockedbyclient');
        });
        await context.addInitScript(() => {
            window.syncTrace = {opens:0, closes:[], snapshots:[], noops:0, sends:0, pongs:0};
            const Native = window.WebSocket;
            window.WebSocket = class extends Native {
                constructor(...args) {
                    super(...args);
                    if(!String(args[0]).includes('/ws/canvases/')) return;
                    this.addEventListener('open', ()=>window.syncTrace.opens++);
                    this.addEventListener('close', event=>window.syncTrace.closes.push({code:event.code, reason:event.reason}));
                    this.addEventListener('message', event=>{
                        const message = JSON.parse(event.data);
                        if(message.type === 'canvas_snapshot') window.syncTrace.snapshots.push(new Blob([event.data]).size);
                        if(message.type === 'canvas_mutation' && message.changed === false) window.syncTrace.noops++;
                        if(message.type === 'pong') window.syncTrace.pongs++;
                    });
                }
                send(value) {
                    if(JSON.parse(value).type === 'canvas_mutation') window.syncTrace.sends++;
                    return super.send(value);
                }
            };
        });
        const pages = [], errors = [];
        const settled = page=>page.waitForFunction(() => {
            const status = window.SmartCanvasModules?.canvasPersistence?.status();
            return status?.state === 'ready' && !status.pending;
        }, null, {timeout:30000});
        for(let index=0; index<2; index++) {
            const page = await context.newPage();
            page.on('pageerror', error=>errors.push(error.message));
            await page.goto(`${base}/static/smart-canvas.html?id=${auth.canvas_id}`, {waitUntil:'domcontentloaded'});
            await settled(page);
            pages.push(page);
        }
        const [first, second] = pages;
        for(const page of pages) {
            const trace = await page.evaluate(()=>window.syncTrace);
            assert.equal(trace.opens, 1);
            assert.ok(trace.snapshots[0] > 16 * 1024 * 1024);
            assert.deepEqual(trace.closes, []);
            assert.equal(await page.evaluate(()=>nodes.length), 212);
        }
        process.stdout.write(`Two editors received ${auth.snapshot_bytes} byte Canvas snapshots\n`);

        // Force an actual first no-op receipt through the full server and native
        // socket, including an editable hold and subsequent local/remote edits.
        const firstState = await first.evaluate(() => {
            const persistence = window.SmartCanvasModules.canvasPersistence;
            persistence.hold({scope:'test-drag'});
            const state = {x:nodes[0].x, y:nodes[0].y, noops:syncTrace.noops};
            canvasPersistenceSendOperation({canvas_updates:[{path:['title'], value:canvas.title}]});
            nodes[0].x += 40;
            persistence.schedule({delay:0});
            return state;
        });
        await first.waitForFunction(count=>syncTrace.noops > count, firstState.noops);
        await second.evaluate(() => {
            nodes[0].y += 24;
            return window.SmartCanvasModules.canvasPersistence.save();
        });
        await settled(second);
        const remoteRevision = await second.evaluate(()=>canvasPersistenceRevision);
        await first.waitForFunction(revision=>canvasPersistenceObservedRevision() >= revision, remoteRevision);
        await first.evaluate(()=>window.SmartCanvasModules.canvasPersistence.release({scope:'test-drag'}));
        await Promise.all(pages.map(settled));
        await second.waitForFunction(x=>nodes[0].x === x, firstState.x + 40);
        for(const page of pages) {
            assert.deepEqual(await page.evaluate(()=>({x:nodes[0].x, y:nodes[0].y})),
                {x:firstState.x + 40, y:firstState.y + 24});
            assert.deepEqual(await page.evaluate(()=>syncTrace.closes), []);
        }

        const sends = await first.evaluate(()=>syncTrace.sends);
        await first.evaluate(async () => {
            for(let index=0; index<5; index++) {
                nodes[0].images = nodes[0].images.map(image=>Object.fromEntries(Object.entries(image).reverse()));
                await window.SmartCanvasModules.canvasPersistence.save();
            }
        });
        assert.equal(await first.evaluate(()=>syncTrace.sends), sends,
            'Equivalent metadata must not create a repeated save stream');

        // Reconnect against the same large document, then replay a real no-op
        // operation twice. Native server replies must not create another close.
        await first.evaluate(()=>window.SmartCanvasModules.canvasPersistence.retry());
        await first.waitForFunction(()=>syncTrace.opens === 2);
        await settled(first);
        const beforeNoop = await first.evaluate(()=>syncTrace.noops);
        await first.evaluate(() => {
            const changes = {canvas_updates:[{path:['title'], value:canvas.title}]};
            window.noopOperation = {operation_id:'browser:no-op-replay', base_revision:canvasPersistenceRevision, changes};
            canvasPersistenceSendOperation(changes,{operationId:noopOperation.operation_id});
        });
        await first.waitForFunction(count=>syncTrace.noops > count, beforeNoop);
        await settled(first);
        await first.evaluate(()=>window.SmartCanvasModules.canvasPersistence.sendPresence({
            type:'canvas_mutation', canvas_id:canvasId, operation:noopOperation,
        }));
        await first.waitForFunction(count=>syncTrace.noops > count + 1, beforeNoop);
        await settled(first);
        process.stdout.write('No-op, concurrent edits and large-snapshot reconnect passed; observing three real heartbeats\n');
        const pongBaseline = await Promise.all(pages.map(page=>page.evaluate(()=>syncTrace.pongs)));
        await Promise.all(pages.map((page,index)=>page.waitForFunction(
            count=>syncTrace.pongs >= count + 3, pongBaseline[index], {timeout:55000})));
        const traces = await Promise.all(pages.map(page=>page.evaluate(()=>syncTrace)));
        assert.equal(traces[0].opens, 2);
        assert.equal(traces[0].closes.length, 1, 'only the requested reconnect is allowed');
        assert.equal(traces[0].closes[0].code, 4000);
        assert.equal(traces[1].opens, 1);
        assert.deepEqual(traces[1].closes, []);
        for(const page of pages) {
            await settled(page);
            assert.equal(await page.locator('#canvasSyncStatus').isVisible(), false);
        }
        for(const [language, expected] of [['en', 'Live collaboration connected'], ['zh', '实时协作已连接']]) {
            await first.evaluate(value=>window.StudioI18n.set(value), language);
            assert.equal(await first.locator('#canvasSyncStatus').textContent(), expected);
            assert.equal(await first.locator('#canvasSyncStatus').isVisible(), false);
        }
        assert.equal(providerRequests, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({pass:true, snapshotBytes:auth.snapshot_bytes, editors:2,
            unexpectedCloses:0, providerRequests, pageErrors:errors.length,
            heartbeatReplies:traces.map(trace=>trace.pongs)}));
    } finally {
        await browser?.close();
        server.kill('SIGTERM');
        await new Promise(resolve=>server.exitCode !== null ? resolve() : server.once('exit', resolve));
    }
})().catch(error=>{console.error(error); process.exitCode=1;});
