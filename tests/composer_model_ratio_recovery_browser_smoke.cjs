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
                    ratio:'square',
                    resolution:'4k',
                    customRatio:'1:1',
                    customRatioWidth:1,
                    customRatioHeight:1
                }
            };
            canvas = {
                id:'composer-model-ratio-recovery',
                title:'Model ratio recovery',
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

(async () => {
    if(!fs.existsSync(browserExecutable)) throw new Error(`Chrome not found: ${browserExecutable}`);
    const {child,url:origin} = await startManualServer();
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1280,height:800}});
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => console.error(error.message));
        await page.goto(`${origin}/static/smart-canvas.html?id=composer-model-ratio-recovery&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.imageCapabilities
            && customElements.get('ic-generation-settings-picker')
        ), null, {timeout:30000});

        await installScenario(page, {id:'model-switch-ratio', references:[]});
        await page.evaluate(() => {
            const selection = smartImageCapabilitySelection('');
            const key = smartImageCapabilityKey(selection.providerId, selection.modelId);
            smartImageCapabilityCache.set(key, smartImageCapabilityClean({
                ...smartCurrentImageCapability(''), known:true,
                aspect_ratios:['1:1','16:9','21:9'],
            }, selection.providerId, selection.modelId));
            settings.ratio = 'ultrawide';
            settings._imageRatioExplicit = true;
            renderDynamicParams();
        });
        const picker = page.locator('#composer ic-generation-settings-picker[data-smart-generation-settings]');
        await picker.locator('[part="trigger"]').evaluate(button => button.click());
        assert.equal(await picker.evaluate(element => element.open), true);
        await picker.evaluate(element => { element.open = false; });
        await page.evaluate(() => {
            const selection = smartImageCapabilitySelection('');
            smartImageCapabilityCache.set(
                smartImageCapabilityKey(selection.providerId, selection.modelId),
                smartImageCapabilityClean({...smartCurrentImageCapability(''), known:false,
                    aspect_ratios:['1:1','16:9']}, selection.providerId, selection.modelId),
            );
            renderDynamicParams();
        });
        await picker.locator('[part="trigger"]').evaluate(button => button.click());
        assert.equal(await picker.evaluate(element => element.open), true,
            'Picker must open when the previous ratio is outside fallback model options');
        assert.equal(await picker.evaluate(element => element.ratio), '');
        await picker.evaluate(element => { element.open = false; });
        await page.evaluate(() => {
            const fresh = {id:'inherited-settings',type:'smart-image',images:[],
                generationOutputNode:true,x:360,y:220,w:320,h:220,
                runSettings:{...settings}};
            nodes.push(fresh);
            selectedId = fresh.id;
            settings = smartSettingsForNode(fresh);
            updateComposer();
            renderDynamicParams();
        });
        await picker.locator('[part="trigger"]').evaluate(button => button.click());
        assert.equal(await picker.evaluate(element => element.open), true,
            'Inherited unsupported settings must not lock a new node picker');
        await picker.locator('ic-aspect-ratio-picker').locator('[data-value="wide"]').evaluate(button => button.click());
        assert.equal(await page.evaluate(() => settings.ratio), 'wide');
        console.log('PASS: unsupported ratio remains recoverable');
    } finally {
        await browser.close();
        await stopManualServer(child);
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
