const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {chromium} = require('playwright');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');

(async () => {
    const child = spawn(path.join(root, '.venv/bin/python'), ['tests/agent_run_renewal_browser_fixture.py'],
        {cwd:root, stdio:['ignore', 'pipe', 'pipe']});
    let logs = '', browser;
    child.stderr.on('data', data => { logs += data; });
    try {
        const auth = await new Promise((resolve, reject) => {
            let output = '';
            const timer = setTimeout(() => reject(Error(`Fixture startup: ${logs}`)), 15000);
            child.stdout.on('data', data => {
                output += data;
                const line = output.split('\n').find(value => value.startsWith('{"port"'));
                if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
            });
            child.once('exit', () => { clearTimeout(timer); reject(Error(`Fixture exited: ${logs}`)); });
        });
        const base = `http://127.0.0.1:${auth.port}`;
        browser = await chromium.launch({headless:true,
            executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
        const context = await browser.newContext();
        await context.addCookies([{name:'ic_session', value:auth.cookie, url:base}]);
        let providerRequests = 0;
        await context.route('**/api/**', route => {
            const url = new URL(route.request().url());
            if (/canvas-(image|video)-tasks|generate/.test(url.pathname) && route.request().method() === 'POST') {
                providerRequests++;
                return route.abort('blockedbyclient');
            }
            if (url.pathname.startsWith('/api/agent/') || url.pathname.startsWith('/api/account/')
                || ['/api/canvases/canvas-test', '/api/model-capabilities'].includes(url.pathname)) return route.continue();
            if (url.pathname === '/api/auth/me') return route.fulfill({json:{user:auth.user}});
            if (url.pathname === '/api/local-generation-submissions') return route.fulfill({json:{enabled:false}});
            const body = apiPayload(url.href);
            if (url.pathname === '/api/config') {
                body.api_providers = [{id:'apimart', name:'APIMART', enabled:true,
                    image_models:['gpt-image-2-official'], video_models:[], chat_models:[]}];
                body.available_models.image = [{id:'apimart|gpt-image-2-official', provider_id:'apimart',
                    model:'gpt-image-2-official', name:'GPT Image 2', visible:true}];
            }
            return route.fulfill({json:body});
        });
        const response = await fetch(`${base}/api/agent/v1/canvases/canvas-test/submissions`, {
            method:'POST', headers:{Authorization:`Bearer ${auth.token}`, 'Content-Type':'application/json',
                'Idempotency-Key':'delayed-renewal-authoring'},
            body:JSON.stringify({tasks:Array.from({length:20}, () => ({kind:'image', prompt:'An original test illustration',
                model:{provider_id:'apimart', model:'gpt-image-2-official'}, params:{count:1, aspect_ratio:'9:16'}}))}),
        });
        const authored = await response.json();
        assert.equal(response.status, 200, JSON.stringify(authored));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/static/smart-canvas.html?id=canvas-test`);
        await page.waitForFunction(() => canvas?.id === 'canvas-test' && window.SmartCanvasModules.canvasPersistence.online());
        const installProvider = target => target.evaluate(() => {
            window.agentSubmissions = [];
            window.agentPreflights = [];
            window.agentExecutions = [];
            const modules = window.SmartCanvasModules;
            const persistence = modules.canvasPersistence, generation = modules.generationRun;
            // Observe the real async boundaries so replay tests need no timing sleeps.
            modules.canvasPersistence = Object.freeze({...persistence, synced(options) {
                const promise = persistence.synced(options);
                if (options?.forGeneration) window.agentPreflights.push(promise);
                return promise;
            }});
            modules.generationRun = Object.freeze({...generation, run(options) {
                const promise = generation.run(options);
                window.agentExecutions.push(promise);
                return promise;
            }});
            // Keep real generation preflight, branch creation, output application and
            // SQLite sync. Replace only the cost-bearing Provider boundary.
            submitAndSettleGenerationProvider = async (node, prompt, refs, settings, options) => {
                window.agentSubmissions.push(node.id);
                await options.onAccepted({node, submission:{state:'completed'}});
                return {kind:'image', logged:true, urls:[{url:'/fixture/output.svg', kind:'image', natural_w:1360, natural_h:2048}]};
            };
            window.drainAgentExecution = async () => {
                await Promise.all(window.agentPreflights);
                await Promise.all(window.agentExecutions);
                canvasPersistence.schedule();
                await canvasPersistence.synced();
            };
        });
        await installProvider(page);
        const replay = (index, {queue = false, status = false} = {}) => page.evaluate(async ({nodeId, index, queue, status}) => {
            const editor = window.SmartCanvasModules.agentEditor;
            const request = {id:`replayed-request-${index}`, node_id:nodeId, state:'queued'};
            if (queue) editor.receive({type:'agent_run_requests', requests:[request]});
            editor.receive({...request, type:status ? 'agent_run_status' : 'agent_run_claim',
                state:'claimed', ...(!status ? {claimed:true} : {})});
            await window.drainAgentExecution();
        }, {nodeId:authored.task_ids[index], index, queue, status});
        for (let index = 0; index < 20; index++) await replay(index, {queue:true});
        assert.equal(await page.evaluate(() => window.agentSubmissions.length), 20);
        for (const index of [3, 4, 9, 10, 11, 13, 14]) {
            await replay(index, {status:true});
            await replay(index); // Legacy server renewal ACK delivered after completion.
        }
        assert.equal(await page.evaluate(() => window.agentSubmissions.length), 20,
            'seven late renewal replies must leave twenty runs, not twenty-seven');
        await page.evaluate(() => window.SmartCanvasModules.agentEditor.reconnect());
        for (const index of [3, 4, 9, 10, 11, 13, 14]) await replay(index, {queue:true});
        const actual = await page.evaluate(ids => ({
            submissions:window.agentSubmissions.length,
            targets:new Set(window.agentSubmissions).size,
            completed:nodes.filter(node => node.generationOutputNode && node.images?.length).length,
            originals:ids.filter(id => nodes.some(node => node.id === id && node.images?.length)).length,
        }), authored.task_ids);
        assert.deepEqual(actual, {submissions:20, targets:20, completed:20, originals:20});
        await page.reload();
        await page.waitForFunction(() => window.SmartCanvasModules.canvasPersistence.online());
        assert.equal(await page.evaluate(() => nodes.filter(node => node.generationOutputNode && node.images?.length).length), 20);

        // Exercise normal delivery through the real HTTP/WebSocket claim owner as
        // well: two editors competing for two new requests must execute each once.
        await installProvider(page);
        const page2 = await context.newPage();
        page2.on('pageerror', error => errors.push(error.message));
        await page2.goto(`${base}/static/smart-canvas.html?id=canvas-test`);
        await page2.waitForFunction(() => window.SmartCanvasModules.canvasPersistence.online());
        await installProvider(page2);
        const nextResponse = await fetch(`${base}/api/agent/v1/canvases/canvas-test/submissions`, {
            method:'POST', headers:{Authorization:`Bearer ${auth.token}`, 'Content-Type':'application/json',
                'Idempotency-Key':'normal-claims-authoring'},
            body:JSON.stringify({tasks:Array.from({length:2}, () => ({kind:'image', prompt:'A new explicitly requested illustration',
                model:{provider_id:'apimart', model:'gpt-image-2-official'}, params:{count:1, aspect_ratio:'9:16'}}))}),
        });
        const next = await nextResponse.json();
        assert.equal(nextResponse.status, 200, JSON.stringify(next));
        for (const editor of [page, page2]) {
            await editor.waitForFunction(ids => ids.every(id => nodes.some(node => node.id === id)), next.task_ids);
            await editor.evaluate(() => window.SmartCanvasModules.agentEditor.reportContext());
        }
        const runResponse = await fetch(`${base}/api/agent/v1/canvases/canvas-test/run-requests`, {
            method:'POST', headers:{Authorization:`Bearer ${auth.token}`, 'Content-Type':'application/json',
                'Idempotency-Key':'normal-claims-running'}, body:JSON.stringify({node_ids:next.task_ids}),
        });
        assert.equal(runResponse.status, 200, await runResponse.text());
        for (const editor of [page, page2]) {
            await editor.waitForFunction(ids => ids.every(id => nodes.find(node => node.id === id)?.images?.length), next.task_ids);
            await editor.evaluate(() => window.drainAgentExecution());
        }
        const normalSubmissions = [...await page.evaluate(() => window.agentSubmissions), ...await page2.evaluate(() => window.agentSubmissions)];
        assert.equal(normalSubmissions.length, 2);
        assert.deepEqual(normalSubmissions.sort(), [...next.task_ids].sort());
        for (const language of ['en', 'zh']) {
            await page.evaluate(language => window.StudioI18n.set(language), language);
            assert.equal(await page.evaluate(() => nodes.filter(node => node.generationOutputNode && node.images?.length).length), 22);
        }
        await page2.close();
        assert.equal(providerRequests, 0);
        assert.deepEqual(errors, []);
        console.log('PASS: 20 Agent requests + 7 delayed renewal ACKs + reconnect/stale queues → 20 submissions/outputs after SQLite reload; normal dual-editor claims exactly once; bilingual switch; zero paid Provider requests');
    } finally {
        if (browser) await browser.close();
        child.kill('SIGINT');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
