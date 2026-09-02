const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
let baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const username = process.env.SMART_CANVAS_TEST_USERNAME || 'issue112tester';
const password = process.env.SMART_CANVAS_TEST_PASSWORD || 'issue112-test-password';
const skipLogin = process.env.SMART_CANVAS_SKIP_LOGIN === '1';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function startManualServer() {
    const port = await reservePort();
    const child = spawn('python3', ['tests/smart_canvas_manual_server.py'], {
        cwd:root,
        env:{...process.env,SMART_CANVAS_PORT:String(port)},
        stdio:['ignore','pipe','pipe'],
    });
    const output = [];
    child.stdout.on('data', chunk => output.push(chunk.toString()));
    child.stderr.on('data', chunk => output.push(chunk.toString()));
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`Manual server startup timed out: ${output.join('')}`)),
            10000,
        );
        const ready = chunk => {
            if(!chunk.toString().includes('Smart Canvas manual server:')) return;
            clearTimeout(timeout);
            resolve();
        };
        child.stdout.on('data', ready);
        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Manual server exited with ${code}: ${output.join('')}`));
        });
    });
    return {child,url:`http://127.0.0.1:${port}`};
}

async function stopManualServer(child) {
    if(!child || child.exitCode !== null) return;
    child.kill('SIGINT');
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        delay(3000),
    ]);
    if(child.exitCode === null) child.kill('SIGTERM');
}

function debuggerUrl(browser) {
    return new Promise((resolve, reject) => {
        let stderr = '';
        const timeout = setTimeout(
            () => reject(new Error(`Chrome debugger did not start: ${stderr}`)),
            10000,
        );
        browser.stderr.on('data', chunk => {
            stderr += chunk.toString();
            const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (!match) return;
            clearTimeout(timeout);
            resolve(match[1]);
        });
        browser.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Chrome exited before debugger startup (${code}): ${stderr}`));
        });
    });
}

async function connectCdp(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, {once:true});
        socket.addEventListener('error', reject, {once:true});
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', message => {
        const payload = JSON.parse(message.data);
        const operation = pending.get(payload.id);
        if (!operation) return;
        pending.delete(payload.id);
        if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
        else operation.resolve(payload.result);
    });
    return {
        send(method, params={}, sessionId) {
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                pending.set(id, {resolve, reject});
                socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
            });
        },
    };
}

async function evaluate(cdp, sessionId, expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise:true,
        returnByValue:true,
    }, sessionId);
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    }
    return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs=15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evaluate(cdp, sessionId, expression)) return;
        await delay(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
}

function waitForProcessExit(child, timeout=5000) {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(resolve, timeout);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

(async () => {
    if (!fs.existsSync(browserExecutable)) {
        throw new Error(`Chrome executable not found: ${browserExecutable}`);
    }
    const manual = skipLogin ? await startManualServer() : null;
    if(manual) baseUrl = manual.url;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-112-browser-'));
    const browser = spawn(browserExecutable, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
    ], {stdio:['ignore','ignore','pipe']});
    let cdp;
    try {
        cdp = await connectCdp(await debuggerUrl(browser));
        const target = await cdp.send('Target.createTarget', {url:'about:blank'});
        const attached = await cdp.send('Target.attachToTarget', {
            targetId:target.targetId,
            flatten:true,
        });
        const sessionId = attached.sessionId;
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
        if(!skipLogin){
            await cdp.send('Page.navigate', {url:`${baseUrl}/login`}, sessionId);
            await waitFor(cdp, sessionId, 'document.readyState !== "loading"');
            const login = await evaluate(cdp, sessionId, `(async () => {
                const response = await fetch('/api/auth/login', {
                    method:'POST',
                    credentials:'same-origin',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({username:${JSON.stringify(username)},password:${JSON.stringify(password)}})
                });
                return {ok:response.ok,status:response.status,text:await response.text()};
            })()`);
            assert.equal(login.ok, true, `Smart Canvas smoke login failed: ${login.status} ${login.text}`);
            await cdp.send('Page.navigate', {url:`${baseUrl}/`}, sessionId);
            await waitFor(cdp, sessionId, `location.pathname === '/' && document.readyState !== 'loading'`);
        }
        await cdp.send('Page.navigate', {
            url:`${baseUrl}/static/smart-canvas.html?id=issue-112-modal${skipLogin ? '&manual=1' : ''}`,
        }, sessionId);
        try {
            await waitFor(cdp, sessionId, `Boolean(
                window.SmartCanvasModules?.viewportSelection?.selection
                && document.getElementById('smartContextResultApply')
            )`, 30000);
        } catch (error) {
            const pageState = await evaluate(cdp, sessionId, `({
                url:location.href,
                title:document.title,
                readyState:document.readyState,
                bodyText:document.body?.innerText?.slice(0,500) || '',
                hasModules:Boolean(window.SmartCanvasModules),
                moduleKeys:Object.keys(window.SmartCanvasModules || {})
            })`);
            throw new Error(`${error.message}\n${JSON.stringify(pageState)}`);
        }
        const runInfo = await evaluate(cdp, sessionId, `(async () => {
            const id='issue-112-current-node';
            const inputUrl='data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#7c3aed"/></svg>');
            nodes.splice(0,nodes.length,{
                id,type:'smart-image',x:240,y:220,w:320,h:240,
                images:[{url:inputUrl,name:'result.png',kind:'image'}],outputKind:'image',
                manualInputRefs:[{url:'keep-existing-input', kind:'image'}],
                runAt:1700000000000,runStartedAt:1000,runFinishedAt:4250,runElapsedMs:3250,
                runPrompt:'Recorded generation prompt',
                runSettings:{engine:'api',model:'gpt-image-2',videoDuration:5},
                generationInputSnapshot:{refs:[
                    {url:inputUrl,name:'source.png',kind:'image',inputInstanceId:'input-1'},
                    {url:inputUrl,name:'source.png',kind:'image',inputInstanceId:'input-2'},
                    {url:'/assets/source.mp4',name:'source.mp4',kind:'video',inputInstanceId:'input-3'}
                ]}
            });
            if(!canvas) canvas={id:canvasId,title:'Issue 112',nodes,connections:[],revision:0};
            canvas.nodes=nodes;
            canvas.connections=[];
            selectedId=id;
            selectedIds=[];
            selectedImage={nodeId:'',index:-1};
            render();
            updateComposer();
            await runSmartContextMenuAction('view-run-info',{nodeId:id,mediaNodeId:id,mediaIndex:-1});
            const infoText=document.getElementById('smartContextResultText').value;
            const imageItems=[...document.querySelectorAll('#smartContextResultInputList .smart-context-result-input')];
            const result={
                modalVisible:!document.getElementById('smartContextResultBackdrop').hidden,
                hasElapsed:infoText.includes(trf('smart.runElapsed',{value:formatRunDuration(3250)})),
                hidesVideoDuration:!infoText.includes(trf('smart.durationInfo',{value:5})),
                applyVisible:getComputedStyle(document.getElementById('smartContextResultApply')).display !== 'none',
                imageCount:imageItems.length,
                imageNames:imageItems.map(item => item.querySelector('span')?.textContent || '')
            };
            return result;
        })()`);
        assert.deepEqual(runInfo, {
            modalVisible:true,
            hasElapsed:true,
            hidesVideoDuration:true,
            applyVisible:true,
            imageCount:2,
            imageNames:['source.png','source.png'],
        });
        if(!skipLogin){
            await evaluate(cdp, sessionId, `document.getElementById('smartContextResultApply').click()`);
            const state = await evaluate(cdp, sessionId, `(() => ({
                modalHidden:document.getElementById('smartContextResultBackdrop').hidden,
                selectedId,
                promptDraftText:nodes.find(node => node.id === selectedId)?.promptDraftText || '',
                composerText:document.getElementById('promptInput')?.textContent || '',
                manualInputRefs:(nodes.find(node => node.id === selectedId)?.manualInputRefs || [])
                    .map(ref => ({url:ref.url,kind:ref.kind}))
            }))()`);
            assert.deepEqual(state, {
                modalHidden:true,
                selectedId:'issue-112-current-node',
                promptDraftText:'Recorded generation prompt',
                composerText:'Recorded generation prompt',
                manualInputRefs:[{url:'keep-existing-input',kind:'image'}],
            });
        }
        const multiImageRunInfo = await evaluate(cdp, sessionId, `(async () => {
            const id='issue-16-multi-image-node';
            const upstreamPrompt='Upstream prompt from connected text node';
            const localPrompt='Local prompt body';
            const fullPrompt=upstreamPrompt + '\\n\\n' + localPrompt;
            const imageUrl=index => 'data:image/svg+xml,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
                + '<rect width="32" height="32" fill="hsl(' + (index * 72) + ',70%,55%)"/></svg>'
            );
            nodes.splice(0,nodes.length,{
                id,type:'smart-image',x:240,y:220,w:480,h:480,
                images:[0,1,2,3].map(index => ({
                    url:imageUrl(index),name:'result-' + (index + 1) + '.png',kind:'image'
                })),
                outputKind:'image',generationOutputNode:true,
                runAt:1700000000000,
                runPrompt:localPrompt,
                runModelPrompt:fullPrompt,
                runSettings:{engine:'api',model:'midjourney',count:4},
                generationInputSnapshot:{prompt:fullPrompt,refs:[]}
            });
            canvas.nodes=nodes;
            canvas.connections=[];
            selectedId=id;
            selectedIds=[];
            selectedImage={nodeId:'',index:-1};
            render();
            await runSmartContextMenuAction('view-run-info',{
                nodeId:id,mediaNodeId:id,mediaIndex:-1
            });
            const nodeText=document.getElementById('smartContextResultText').value;
            const nodeApplyText=smartContextResultState?.applyText || '';
            closeSmartContextResult();
            await runSmartContextMenuAction('view-run-info',{
                nodeId:id,mediaNodeId:id,mediaIndex:2
            });
            const imageText=document.getElementById('smartContextResultText').value;
            const imageApplyText=smartContextResultState?.applyText || '';
            return {
                nodeHasUpstream:nodeText.includes(upstreamPrompt),
                imageHasUpstream:imageText.includes(upstreamPrompt),
                nodeHasLocal:nodeText.includes(localPrompt),
                imageHasLocal:imageText.includes(localPrompt),
                nodeApplyText,
                imageApplyText
            };
        })()`);
        assert.deepEqual(multiImageRunInfo, {
            nodeHasUpstream:true,
            imageHasUpstream:true,
            nodeHasLocal:true,
            imageHasLocal:true,
            nodeApplyText:'Local prompt body',
            imageApplyText:'Local prompt body',
        });
        console.log('Generation-info modal browser smoke passed (Issues #112 and #16).');
    } finally {
        try {
            if (cdp) await cdp.send('Browser.close');
        } catch {}
        await waitForProcessExit(browser);
        if (browser.exitCode === null) {
            browser.kill('SIGTERM');
            await waitForProcessExit(browser);
        }
        if (profile.startsWith(`${os.tmpdir()}${path.sep}issue-112-browser-`)) {
            fs.rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:100});
        }
        await stopManualServer(manual?.child);
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
