const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function reservePort(){
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function startManualServer(){
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
        const timeout = setTimeout(() => reject(new Error(`Manual server startup timed out: ${output.join('')}`)), 10000);
        const check = chunk => {
            if(!chunk.toString().includes('Smart Canvas manual server:')) return;
            clearTimeout(timeout);
            resolve();
        };
        child.stdout.on('data', check);
        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Manual server exited with ${code}: ${output.join('')}`));
        });
    });
    return {child,url:`http://127.0.0.1:${port}`};
}

async function stopManualServer(child){
    if(!child || child.exitCode !== null) return;
    child.kill('SIGINT');
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    if(child.exitCode === null) child.kill('SIGTERM');
}

async function installScenario(page, {id, references}){
    await page.evaluate(({id, references}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const node = {
                id:${JSON.stringify(id)},
                type:'smart-image',
                x:360,
                y:220,
                w:320,
                h:220,
                images:[],
                generationOutputNode:true,
                referenceGenerationKind:'image',
                manualInputRefs:${JSON.stringify(references)},
                runSettings:{
                    engine:'api',
                    apiKind:'image',
                    ratio:'source',
                    resolution:'4k',
                    customRatio:'1:1',
                    customRatioWidth:1,
                    customRatioHeight:1
                }
            };
            canvas = {
                id:'issue-192-auto-aspect-browser',
                title:'Issue 192',
                nodes:[node],
                connections:[],
                viewport:{x:0,y:0,scale:1},
                settings:{},
                logs:[]
            };
            nodes = canvas.nodes;
            selectedId = node.id;
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            render();
            updateComposer();
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {id, references});
    await page.waitForFunction(expectedId => (
        selectedId === expectedId
        && document.querySelector('#composer.open ic-generation-settings-picker[data-smart-generation-settings]')
            ?.dataset.icContractStatus === 'ready'
    ), id);
    await page.waitForTimeout(200);
}

async function pickerState(page){
    return page.locator('#composer ic-generation-settings-picker[data-smart-generation-settings]').evaluate(picker => {
        const aspect = picker.shadowRoot.querySelector('ic-aspect-ratio-picker');
        return {
            ratio:picker.ratio,
            sourceRatio:picker.getAttribute('source-ratio') || '',
            ratioPresets:(picker.getAttribute('ratio-presets') || '').split(',').filter(Boolean),
            text:picker.shadowRoot.querySelector('[part="trigger"]').textContent.trim(),
            sourceOption:Boolean(aspect?.shadowRoot.querySelector('[data-value="source"]')),
        };
    });
}

(async () => {
    if(!fs.existsSync(browserExecutable)) throw new Error(`Chrome not found: ${browserExecutable}`);
    const {child,url:origin} = await startManualServer();
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1280,height:800}});
        page.setDefaultTimeout(15000);
        await page.goto(`${origin}/static/smart-canvas.html?id=issue-192-auto-aspect-browser&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.imageCapabilities
            && canvas
            && Array.isArray(nodes)
            && customElements.get('ic-generation-settings-picker')
        ), null, {timeout:30000});

        const issueImage = {
            url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="405" height="240"/%3E',
            name:'issue-192.svg',
            kind:'image',
            natural_w:405,
            natural_h:240,
        };
        await installScenario(page, {id:'within-seven-percent', references:[issueImage]});
        const accepted = await pickerState(page);
        const referenceAspectRatio = await page.evaluate(reference => (
            window.SmartCanvasModules.imageCapabilities.referenceAspectRatio([reference])
        ), issueImage);
        assert.deepEqual(accepted, {
            ratio:'source',
            sourceRatio:'16:9',
            ratioPresets:['source','square','portrait','landscape','portrait43','landscape43','story','wide'],
            text:'原图(16:9) / 4k / 自动',
            sourceOption:true,
        });
        assert.equal(referenceAspectRatio, '405:240');

        const unsupportedImage = {
            url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1080" height="1000"/%3E',
            name:'outside-seven-percent.svg',
            kind:'image',
            natural_w:1080,
            natural_h:1000,
        };
        await installScenario(page, {id:'outside-seven-percent', references:[unsupportedImage]});
        const rejected = await pickerState(page);
        assert.equal(rejected.sourceRatio, '');
        assert.equal(rejected.ratioPresets.includes('source'), false);
        assert.equal(rejected.sourceOption, false);
        assert.notEqual(rejected.text.includes('原图(1:1)'), true);

        const staleSubmission = await page.evaluate(reference => {
            const api = window.SmartCanvasModules.imageCapabilities;
            return api.resolveForSubmission(
                {ratio:'source',resolution:'1k',customRatio:'1:1'},
                [reference],
                api.fallback()
            );
        }, unsupportedImage);
        assert.equal(staleSubmission.valid, false);
        assert.equal(staleSubmission.reason, 'unsupported-reference-ratio');
        assert.equal(staleSubmission.target_aspect_ratio, null);

        console.log(JSON.stringify({
            passed:true,accepted,referenceAspectRatio,rejected,staleSubmission,
        }, null, 2));
    } finally {
        await browser.close();
        await stopManualServer(child);
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
