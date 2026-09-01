const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
    '.css':'text/css; charset=utf-8',
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.svg':'image/svg+xml',
};
const promptText = 'Prompt restored from the completed generation run.';
const editedPromptText = 'User-authored replacement prompt.';
const tinyImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" fill="%234c8bf5"/%3E%3C/svg%3E';

function startServer(){
    return new Promise((resolve, reject) => {
        const server = http.createServer((request, response) => {
            const requestPath = decodeURIComponent(
                new URL(request.url, 'http://127.0.0.1').pathname,
            );
            const filePath = path.resolve(ROOT, `.${requestPath}`);
            if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)){
                response.writeHead(403).end('Forbidden');
                return;
            }
            fs.readFile(filePath, (error, body) => {
                if(error){
                    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
                    return;
                }
                response.writeHead(200, {
                    'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream',
                }).end(body);
            });
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function selectNode(page, nodeId){
    await page.locator(`ic-canvas-node[data-id="${nodeId}"]`).click({
        position:{x:24,y:24},
    });
    await page.waitForFunction(id => selectedId === id, nodeId);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

(async () => {
    if(!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
    const server = await startServer();
    const browser = await chromium.launch({headless:true, executablePath:CHROME});
    const page = await browser.newPage({viewport:{width:1180,height:760}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));
    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        await page.goto(
            `${origin}/static/smart-canvas.html?id=issue-191-prompt-restore`,
            {waitUntil:'domcontentloaded'},
        );
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-canvas-node')
            && window.SmartCanvasModules?.promptAuthoring
        ), null, {timeout:30000});
        await page.evaluate(({promptText,tinyImage}) => {
            const prompt = {
                id:'upstream-prompt',
                type:'smart-prompt',
                title:'Upstream prompt',
                text:promptText,
                x:100,
                y:100,
                w:260,
                h:180,
            };
            const ordinary = {
                id:'ordinary-image',
                type:'smart-image',
                title:'Ordinary image',
                images:[{url:tinyImage,name:'ordinary.svg',kind:'image'}],
                x:100,
                y:380,
                w:220,
                h:180,
            };
            const output = {
                id:'generation-output',
                type:'smart-image',
                title:'Image',
                images:[{url:tinyImage,name:'generation-output.svg',kind:'image'}],
                referenceGenerationKind:'image',
                generationOutputNode:true,
                outputKind:'image',
                runPrompt:promptText,
                runModelPrompt:promptText,
                runPromptRefs:[],
                runInputRefs:[{url:tinyImage,name:'ordinary.svg',kind:'image',nodeId:ordinary.id,imageIndex:0}],
                promptDraftHtml:'',
                promptDraftText:'',
                inputNodeIds:[prompt.id,ordinary.id],
                x:500,
                y:220,
                w:260,
                h:220,
            };
            const duplicatedDraftOutput = {
                ...output,
                id:'generation-output-with-duplicated-draft',
                promptDraftHtml:promptText,
                promptDraftText:promptText,
                x:820,
            };
            canvas = {
                id:'issue-191-prompt-restore',
                title:'Issue 191 prompt restore',
                nodes:[prompt,ordinary,output,duplicatedDraftOutput],
                connections:[
                    {from:prompt.id,to:output.id,kind:'input'},
                    {from:ordinary.id,to:output.id,kind:'input'},
                    {from:prompt.id,to:duplicatedDraftOutput.id,kind:'input'},
                    {from:ordinary.id,to:duplicatedDraftOutput.id,kind:'input'},
                ],
                viewport:{x:0,y:0,scale:1},
                settings:{},
                logs:[],
            };
            nodes = canvas.nodes;
            selectedId = output.id;
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument(canvas);
            canvasPersistenceRevision = 0;
            render();
            updateComposer();
        }, {promptText,tinyImage});
        await page.waitForSelector('#composer.open');

        const restoredStates = [];
        for(let iteration = 0; iteration < 4; iteration++){
            await selectNode(page, 'ordinary-image');
            await selectNode(page, 'generation-output');
            restoredStates.push(await page.evaluate(() => {
                const node = nodes.find(item => item.id === 'generation-output');
                return {
                    text:document.querySelector('#promptInput')?.innerText || '',
                    draftHtml:node?.promptDraftHtml || '',
                    draftText:node?.promptDraftText || '',
                    restoredFor:document.querySelector('#promptInput')
                        ?.dataset?.restoredGenerationSnapshotFor || '',
                };
            }));
        }

        const nodeState = await page.evaluate(() => {
            const node = nodes.find(item => item.id === 'generation-output');
            return {
                promptDraftHtml:node.promptDraftHtml,
                promptDraftText:node.promptDraftText,
                runPrompt:node.runPrompt,
            };
        });
        assert.deepEqual(
            restoredStates.map(state => state.text),
            Array(4).fill(promptText),
            JSON.stringify(restoredStates),
        );
        assert.deepEqual(nodeState, {
            promptDraftHtml:'',
            promptDraftText:'',
            runPrompt:promptText,
        });

        const duplicatedDraftStates = [];
        for(let iteration = 0; iteration < 2; iteration++){
            await selectNode(page, 'ordinary-image');
            await selectNode(page, 'generation-output-with-duplicated-draft');
            duplicatedDraftStates.push(await page.locator('#promptInput').innerText());
        }
        assert.deepEqual(duplicatedDraftStates, Array(2).fill(promptText));

        await selectNode(page, 'generation-output');
        await page.locator('#promptInput').fill(editedPromptText);
        await page.waitForFunction(expected => (
            nodes.find(item => item.id === 'generation-output')?.promptDraftText === expected
        ), editedPromptText);
        await selectNode(page, 'ordinary-image');
        await selectNode(page, 'generation-output');
        const editedState = await page.evaluate(() => {
            const node = nodes.find(item => item.id === 'generation-output');
            return {
                composerText:document.querySelector('#promptInput')?.innerText || '',
                promptDraftText:node?.promptDraftText || '',
                runPrompt:node?.runPrompt || '',
            };
        });
        assert.deepEqual(editedState, {
            composerText:editedPromptText,
            promptDraftText:editedPromptText,
            runPrompt:promptText,
        });
        const unexpectedPageErrors = pageErrors.filter(message => (
            !message.includes('canvas.loadFailed')
        ));
        assert.deepEqual(unexpectedPageErrors, []);
        process.stdout.write(JSON.stringify({
            passed:true,
            restoredLengths:restoredStates.map(state => state.text.length),
            duplicatedDraftLengths:duplicatedDraftStates.map(value => value.length),
            nodeState:{
                promptDraftHtmlLength:nodeState.promptDraftHtml.length,
                promptDraftTextLength:nodeState.promptDraftText.length,
                runPromptLength:nodeState.runPrompt.length,
            },
            editedState:{
                composerTextLength:editedState.composerText.length,
                promptDraftTextLength:editedState.promptDraftText.length,
                runPromptLength:editedState.runPrompt.length,
            },
        }, null, 2));
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
