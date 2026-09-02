const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function uploadedKind(name='') {
    if (name.endsWith('.mp4')) return 'video';
    if (name.endsWith('.mp3')) return 'audio';
    return 'image';
}

function uploadedUrl(kind) {
    if (kind === 'video') return 'data:video/mp4;base64,AAAA';
    if (kind === 'audio') return 'data:audio/mpeg;base64,AAAA';
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="48"%3E%3Cpath fill="%234c8bf5" d="M0 0h64v48H0z"/%3E%3C/svg%3E';
}

async function chooseUpload(page, nodeId, file) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator(`.image-node[data-id="${nodeId}"] ic-upload-surface`).evaluate(
        picker => picker.shadowRoot.querySelector('ic-button').click(),
    );
    const chooser = await chooserPromise;
    await chooser.setFiles(file);
}

async function selectedNodeState(page, nodeId) {
    await page.keyboard.press('Escape');
    await page.evaluate(() => setPromptAuthoringFocused(false));
    const node = page.locator(`.image-node[data-id="${nodeId}"]`);
    try {
        await node.click({position:{x:24,y:24},timeout:1500});
    } catch (_error) {
        await node.dispatchEvent('mousedown', {button:0,buttons:1,clientX:24,clientY:24});
        await node.dispatchEvent('mouseup', {button:0,buttons:0,clientX:24,clientY:24});
        await node.dispatchEvent('click', {button:0,buttons:0,clientX:24,clientY:24});
    }
    await page.waitForFunction(id => selectedId === id, nodeId);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    return page.evaluate(id => {
        const node = nodes.find(item => item.id === id);
        const eligibility = smartNodeGenerationEligibility(node);
        return {
            selectedId,
            composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
            runDisabled:Boolean(document.querySelector('#runBtn')?.disabled),
            generationKind:document.querySelector('#apiKindToggle')?.value || '',
            kindToggleDisabled:Boolean(document.querySelector('#apiKindToggle')?.disabled),
            eligibility:{...eligibility},
        };
    }, nodeId);
}

async function finalGateResult(page, nodeId) {
    return page.evaluate(id => window.SmartCanvasModules.generationRun.run({nodeId:id}), nodeId);
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1600,height:1000}});
        const uploads = [];
        await page.route('**/api/ai/upload', async route => {
            const body = route.request().postDataBuffer()?.toString('latin1') || '';
            const name = body.match(/filename="([^"]+)"/)?.[1] || 'upload.png';
            const kind = uploadedKind(name);
            uploads.push({name,kind});
            await new Promise(resolve => setTimeout(resolve, 250));
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({files:[{name,kind,url:uploadedUrl(kind),natural_w:64,natural_h:48}]}),
            });
        });
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-161-media-composer&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.generationRun
            && document.querySelector('#runBtn')?.dataset.icContractStatus === 'ready'
            && customElements.get('ic-upload-surface')
            && canvas
            && Array.isArray(nodes)
        ));
        await page.evaluate(() => {
            const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="48"%3E%3Cpath fill="%2366a" d="M0 0h64v48H0z"/%3E%3C/svg%3E';
            nodes.splice(0, nodes.length,
                {id:'upload-image',type:'smart-image',x:20,y:60,images:[]},
                {id:'upload-video',type:'smart-image',x:640,y:60,images:[],uploadMediaKind:'video',runSettings:{engine:'api',apiKind:'image'}},
                {id:'upload-audio',type:'smart-image',x:1240,y:60,images:[]},
                normalizeLegacySmartNode({id:'ready-image',type:'smart-image',x:20,y:390,images:[{url:image,name:'ready.svg',kind:'image'}],uploadedAttachment:true,promptDraftHtml:'ready draft',promptDraftText:'ready draft',runSettings:{engine:'api',apiKind:'image'}}),
                {id:'smart-group',type:'smart-group',x:600,y:390,w:280,h:210,items:[],promptDraftHtml:'group draft',promptDraftText:'group draft'},
                {id:'generation-pending',type:'smart-image',x:900,y:390,images:[],pending:1,referenceGenerationKind:'image',runSettings:{engine:'api',apiKind:'image'}},
                {id:'generation-running',type:'smart-image',x:1240,y:390,images:[],running:true,pending:1,referenceGenerationKind:'image',promptDraftHtml:'next run draft',promptDraftText:'next run draft',generationInputSnapshot:{prompt:'frozen run prompt',refs:[],settings:{engine:'api',apiKind:'image'}},runSettings:{engine:'api',apiKind:'image'}},
                {id:'generation-failed',type:'smart-image',x:20,y:720,images:[],referenceGenerationKind:'image',generationRunFeedback:{successfulCount:0,failedCount:1,reasons:['Mock failure']},runSettings:{engine:'api',apiKind:'image'}},
                {id:'generation-completed',type:'smart-image',x:640,y:720,images:[{url:image,name:'result.svg',kind:'image',generatedResult:true}],referenceGenerationKind:'image',generationOutputNode:true,runAt:Date.now(),runSettings:{engine:'api',apiKind:'image'}},
                normalizeLegacySmartNode({id:'legacy-generation-output',type:'smart-image',x:940,y:720,images:[{url:image,name:'legacy-result.svg',kind:'image',generatedResult:true}],generationOutputNode:true,outputKind:'image',runAt:Date.now(),runSettings:{engine:'api',apiKind:'image'}}),
                {id:'unsupported-frame',type:'smart-frame',x:1180,y:720,w:260,h:180,items:[]},
            );
            canvas.connections = [];
            selectedId = 'upload-image';
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            render();
        });
        await page.waitForSelector('.image-node[data-id="upload-image"] ic-upload-surface');

        const emptyImage = await selectedNodeState(page, 'upload-image');
        assert.equal(emptyImage.composerOpen, false);
        assert.equal(emptyImage.eligibility.runnable, false);
        assert.equal(emptyImage.runDisabled, true);
        assert.equal(await finalGateResult(page, 'upload-image'), false);

        const uploadCases = [
            ['upload-image', {name:'source.png',mimeType:'image/png',buffer:Buffer.from('image')}],
            ['upload-video', {name:'source.mp4',mimeType:'video/mp4',buffer:Buffer.from('video')}],
            ['upload-audio', {name:'source.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('audio')}],
        ];
        const uploadStates = [];
        for (const [nodeId,file] of uploadCases) {
            const before = await selectedNodeState(page, nodeId);
            assert.equal(before.composerOpen, false, `${nodeId} opened Composer before upload`);
            assert.equal(before.eligibility.runnable, false, nodeId);
            assert.equal(before.runDisabled, true, nodeId);
            await chooseUpload(page, nodeId, file);
            await page.waitForFunction(id => (
                document.querySelector(`.image-node[data-id="${id}"] ic-upload-surface`)?.hasAttribute('busy')
            ), nodeId);
            const uploading = await page.evaluate(id => ({
                selectedId,
                composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
                runnable:smartNodeGenerationEligibility(nodes.find(node => node.id === id)).runnable,
                runDisabled:Boolean(document.querySelector('#runBtn')?.disabled),
            }), nodeId);
            assert.deepEqual(uploading, {
                selectedId:nodeId,
                composerOpen:false,
                runnable:false,
                runDisabled:true,
            });
            await page.waitForFunction(id => nodes.find(node => node.id === id)?.images?.length === 1, nodeId);
            const ready = await selectedNodeState(page, nodeId);
            assert.equal(ready.composerOpen, false);
            assert.equal(ready.eligibility.runnable, false);
            assert.equal(ready.runDisabled, true);
            assert.equal(await finalGateResult(page, nodeId), false);
            uploadStates.push({nodeId,before,uploading,ready});
        }

        const roleStates = {};
        for (const nodeId of [
            'smart-group','generation-pending','generation-running',
            'generation-failed','generation-completed','legacy-generation-output',
        ]) {
            const state = await selectedNodeState(page, nodeId);
            assert.equal(state.eligibility.runnable, true, nodeId);
            assert.equal(state.composerOpen, true, nodeId);
            assert.equal(state.runDisabled, false, nodeId);
            roleStates[nodeId] = state;
        }
        assert.equal(
            await page.evaluate(() => nodes.find(node => node.id === 'legacy-generation-output')?.referenceGenerationKind || ''),
            'image',
        );
        const readyImage = await selectedNodeState(page, 'ready-image');
        assert.equal(readyImage.composerOpen, false);
        assert.equal(readyImage.eligibility.runnable, false);
        assert.equal(readyImage.runDisabled, true);
        assert.equal(await finalGateResult(page, 'ready-image'), false);

        await selectedNodeState(page, 'generation-running');
        await page.evaluate(() => {
            promptInput.textContent = 'edited next run draft';
            promptInput.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:'edited next run draft'}));
        });
        await selectedNodeState(page, 'smart-group');
        const frozenRun = await page.evaluate(() => {
            const node = nodes.find(item => item.id === 'generation-running');
            return {
                nextDraft:node?.promptDraftText || '',
                snapshotPrompt:node?.generationInputSnapshot?.prompt || '',
                snapshotKind:node?.generationInputSnapshot?.settings?.apiKind || '',
            };
        });
        assert.deepEqual(frozenRun, {
            nextDraft:'edited next run draft',
            snapshotPrompt:'frozen run prompt',
            snapshotKind:'image',
        });

        await page.locator('.image-node[data-id="unsupported-frame"]').click({position:{x:24,y:24}});
        await page.waitForFunction(() => !document.querySelector('#composer')?.classList.contains('open'));
        const unsupported = await page.evaluate(() => ({
            composerOpen:document.querySelector('#composer')?.classList.contains('open') || false,
            runDisabled:Boolean(document.querySelector('#runBtn')?.disabled),
            runnable:smartNodeGenerationEligibility(nodes.find(node => node.id === 'unsupported-frame')).runnable,
        }));
        assert.deepEqual(unsupported, {composerOpen:false,runDisabled:true,runnable:false});

        assert.deepEqual(uploads.map(item => item.kind), ['image','video','audio']);
        console.log(JSON.stringify({passed:true,uploads,emptyImage,uploadStates,readyImage,roleStates,frozenRun,unsupported}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
