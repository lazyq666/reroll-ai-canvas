const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"%3E%3Cpath fill="%235a8dee" d="M0 0h240v160H0z"/%3E%3C/svg%3E';
const secondSourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 160 240"%3E%3Cpath fill="%23e45858" d="M0 0h160v240H0z"/%3E%3C/svg%3E';
const uploadedImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"%3E%3Cpath fill="%2318a957" d="M0 0h120v80H0z"/%3E%3C/svg%3E';

const flowCases = [
    {name:'crop', mode:'crop', result:'replace', suffix:'_crop.png'},
    {name:'brush', mode:'brush', result:'replace', suffix:'_paint.png', draw:true},
    {name:'resize', mode:'resize', result:'replace', suffix:'_resize_50pct.png'},
    {name:'mask', mode:'mask', result:'create', suffix:'_mask.png', draw:true, outputImages:1},
    {name:'grid-split', mode:'grid', result:'create', suffix:'_2_r1_c2.png', split:true, outputImages:2},
    {name:'grid-join', mode:'grid', result:'create', suffix:'_join.png', join:true, twoImages:true, outputImages:1},
];

function multipartFileNames(request) {
    const body = request.postDataBuffer();
    if (!body) return [];
    return [...body.toString('latin1').matchAll(/filename="([^"]+)"/g)].map(match => match[1]);
}

async function installHarness(page) {
    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            window.__t37MediaFlow = {
                ready() {
                    return Boolean(canvas && Array.isArray(nodes));
                },
                setup({sourceUrl, secondUrl, twoImages}) {
                    const source = {
                        id:'t37-media-source',
                        type:'smart-image',
                        x:180,
                        y:190,
                        w:360,
                        h:240,
                        images:[{
                            url:sourceUrl,
                            name:'source.png',
                            kind:'image',
                            natural_w:240,
                            natural_h:160
                        }]
                    };
                    if(twoImages) source.images.push({
                        url:secondUrl,
                        name:'source-second.png',
                        kind:'image',
                        natural_w:160,
                        natural_h:240
                    });
                    const stable = {
                        id:'t37-media-stable',
                        type:'smart-image',
                        x:780,
                        y:210,
                        w:240,
                        h:180,
                        images:[{
                            url:secondUrl,
                            name:'stable.png',
                            kind:'image',
                            natural_w:160,
                            natural_h:240
                        }]
                    };
                    nodes.splice(0, nodes.length, source, stable);
                    canvas.connections = [];
                    selectedId = source.id;
                    selectedIds = [];
                    selectedImage = {nodeId:source.id,index:0};
                    render();
                    window.__t37MediaFlow.refs = {
                        source:document.querySelector('.image-node[data-id="t37-media-source"]'),
                        stable:document.querySelector('.image-node[data-id="t37-media-stable"]')
                    };
                    window.SmartCanvasModules.imageStudio.open({
                        nodeId:source.id,
                        imageIndex:0,
                        mode:'preview',
                        groupAware:false
                    });
                },
                snapshot() {
                    const source = nodes.find(node => node.id === 't37-media-source');
                    const stable = nodes.find(node => node.id === 't37-media-stable');
                    const draw = document.querySelector('#editDrawCanvas');
                    const cropBox = document.querySelector('#cropBox')?.getBoundingClientRect();
                    const joinCanvas = document.querySelector('#gridJoinCanvas');
                    return {
                        studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
                        mode:document.querySelector('#imageEditModeTabs')?.value || '',
                        nodeState:JSON.stringify(nodes),
                        connectionState:JSON.stringify(canvas.connections || []),
                        nodeCount:nodes.length,
                        sourceImages:JSON.stringify(source?.images || []),
                        stableImages:JSON.stringify(stable?.images || []),
                        selectedId,
                        selectedImage:{...selectedImage},
                        sourceDomSame:document.querySelector('.image-node[data-id="t37-media-source"]') === window.__t37MediaFlow.refs.source,
                        stableDomSame:document.querySelector('.image-node[data-id="t37-media-stable"]') === window.__t37MediaFlow.refs.stable,
                        draft:{
                            draw:draw?.toDataURL() || '',
                            crop:cropBox ? [
                                Math.round(cropBox.x),
                                Math.round(cropBox.y),
                                Math.round(cropBox.width),
                                Math.round(cropBox.height)
                            ] : [],
                            resize:document.querySelector('#imageResizeScaleInput')?.value || '',
                            gridOperation:document.querySelector('#gridOperationControl')?.value || '',
                            gridHorizontal:document.querySelector('#gridHorizontalLines')?.value || '',
                            gridVertical:document.querySelector('#gridVerticalLines')?.value || '',
                            joinMarkup:joinCanvas?.innerHTML || '',
                        },
                        applyDisabled:Boolean(document.querySelector('#imageEditApplyBtn')?.disabled),
                        cancelDisabled:Boolean(document.querySelector('#imageEditCancelBtn')?.disabled),
                        toast:document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
                        toastVisible:Boolean(document.querySelector('ic-toast[data-ic-overlay]')),
                    };
                },
                success() {
                    const source = nodes.find(node => node.id === 't37-media-source');
                    const output = nodes.find(node => node.id === selectedId);
                    const sourceRect = source ? nodeRect(source) : null;
                    const outputRect = output ? nodeRect(output) : null;
                    return {
                        studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
                        nodeCount:nodes.length,
                        sourceImages:JSON.stringify(source?.images || []),
                        selectedId,
                        selectedImage:{...selectedImage},
                        selectedImageCount:output?.images?.length || 0,
                        selectedNames:(output?.images || []).map(image => image.name),
                        selectedRole:output?.images?.[0]?.role || '',
                        sourceDomSame:document.querySelector('.image-node[data-id="t37-media-source"]') === window.__t37MediaFlow.refs.source,
                        stableDomSame:document.querySelector('.image-node[data-id="t37-media-stable"]') === window.__t37MediaFlow.refs.stable,
                        downstream:Boolean(sourceRect && outputRect && output.id !== source.id && outputRect.x >= sourceRect.x + sourceRect.width),
                        connections:(canvas.connections || []).map(connection => ({...connection})),
                    };
                }
            };
        })();`;
        document.body.appendChild(script);
        script.remove();
    });
}

async function drawDraft(page) {
    await page.waitForFunction(() => {
        const canvas = document.querySelector('#editDrawCanvas');
        return Boolean(canvas && canvas.width > 0 && canvas.height > 0 && canvas.getBoundingClientRect().width > 20);
    });
    const box = await page.locator('#editDrawCanvas').boundingBox();
    assert.ok(box, 'Drawing canvas must be visible');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65, {steps:8});
    await page.mouse.up();
}

async function prepareFlow(page, flow) {
    await page.evaluate(({sourceUrl, secondUrl, twoImages}) => {
        window.__t37MediaFlow.setup({sourceUrl, secondUrl, twoImages});
    }, {sourceUrl:sourceImage, secondUrl:secondSourceImage, twoImages:flow.twoImages});
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.open);
    await page.waitForFunction(() => document.querySelector('#cropImage')?.naturalWidth > 0);
    await page.locator(`[data-image-edit-mode="${flow.mode}"]`).click();
    await page.waitForFunction(mode => document.querySelector('#imageEditModeTabs')?.value === mode, flow.mode);
    if (flow.draw) await drawDraft(page);
    if (flow.mode === 'crop') {
        await page.locator('#cropRatioTabs button[data-value="4:3"]').click();
        await page.waitForFunction(() => document.querySelector('#cropRatioTabs')?.value === '4:3');
    }
    if (flow.split) {
        await page.locator('#imageGridTools .grid-split-control ic-button').filter({hasText:'1×2'}).first().click();
        await page.waitForFunction(() => (
            document.querySelector('#gridHorizontalLines')?.value === '0'
            && document.querySelector('#gridVerticalLines')?.value === '1'
        ));
    }
    if (flow.join) {
        await page.locator('#gridJoinModeBtn').click();
        await page.waitForFunction(() => (
            document.querySelector('#gridOperationControl')?.value === 'join'
            && document.querySelectorAll('#gridJoinCanvas .grid-join-item').length === 2
        ));
    }
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors = [];
        const uploadRequests = [];
        let uploadResult = 'failure';
        await page.route('**/api/ai/upload', async route => {
            const request = route.request();
            const names = multipartFileNames(request);
            uploadRequests.push({
                result:uploadResult,
                names,
                contentType:request.headers()['content-type'] || '',
                bodyBytes:request.postDataBuffer()?.length || 0,
            });
            if (uploadResult === 'failure') {
                await route.fulfill({
                    status:503,
                    contentType:'application/json',
                    body:JSON.stringify({detail:'Media upload failed. Try again.'}),
                });
                return;
            }
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({files:names.map(name => ({url:uploadedImage,name,kind:'image'}))}),
            });
        });
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-image-studio-media-flow`, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.imageStudio
            && window.SmartCanvasModules?.canvasMutation
            && document.querySelector('#imageEditModal')?.dataset.icContractStatus === 'ready'
        ));
        await installHarness(page);
        await page.waitForFunction(() => window.__t37MediaFlow?.ready());

        const evidence = [];
        for (const flow of flowCases) {
            await prepareFlow(page, flow);
            const beforeFailure = await page.evaluate(() => window.__t37MediaFlow.snapshot());
            uploadResult = 'failure';
            const failedResponse = page.waitForResponse(response => (
                response.url().includes('/api/ai/upload') && response.status() === 503
            ));
            await page.locator('#imageEditApplyBtn').click();
            await failedResponse;
            await page.waitForFunction(() => Boolean(document.querySelector('ic-toast[data-ic-overlay]')));
            const afterFailure = await page.evaluate(() => window.__t37MediaFlow.snapshot());
            assert.equal(afterFailure.studioOpen, true, `${flow.name}: Studio closed after failure`);
            assert.equal(afterFailure.mode, flow.mode, `${flow.name}: mode changed after failure`);
            assert.equal(afterFailure.nodeState, beforeFailure.nodeState, `${flow.name}: Canvas model was partially written`);
            assert.equal(afterFailure.connectionState, beforeFailure.connectionState, `${flow.name}: Connections changed after failure`);
            assert.deepEqual(afterFailure.draft, beforeFailure.draft, `${flow.name}: draft changed after failure`);
            assert.equal(afterFailure.sourceDomSame, true, `${flow.name}: unchanged source DOM was replaced after failure`);
            assert.equal(afterFailure.stableDomSame, true, `${flow.name}: unchanged Node DOM was replaced after failure`);
            assert.equal(afterFailure.applyDisabled, false, `${flow.name}: retry is unavailable`);
            assert.equal(afterFailure.cancelDisabled, false, `${flow.name}: cancel is unavailable`);
            assert.equal(afterFailure.toastVisible, true, `${flow.name}: failure feedback is not visible`);
            assert.match(afterFailure.toast, /upload failed|上传失败/i, `${flow.name}: failure feedback is unclear`);

            uploadResult = 'success';
            const successfulResponse = page.waitForResponse(response => (
                response.url().includes('/api/ai/upload') && response.status() === 200
            ));
            await page.locator('#imageEditApplyBtn').click();
            await successfulResponse;
            await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.open);
            const success = await page.evaluate(() => window.__t37MediaFlow.success());
            assert.equal(success.studioOpen, false, `${flow.name}: Studio stayed open after success`);
            assert.equal(success.stableDomSame, true, `${flow.name}: unchanged Node DOM was replaced after success`);
            assert.deepEqual(success.connections, [], `${flow.name}: unexpected business Connection was created`);
            assert.ok(success.selectedNames.some(name => name.endsWith(flow.suffix)), `${flow.name}: wrong uploaded result selected`);
            if (flow.result === 'replace') {
                assert.equal(success.nodeCount, 2, `${flow.name}: replace flow created a Node`);
                assert.equal(success.selectedId, 't37-media-source', `${flow.name}: updated Node is not selected`);
                assert.deepEqual(success.selectedImage, {nodeId:'t37-media-source',index:0}, `${flow.name}: updated image is not selected`);
                assert.equal(success.sourceDomSame, false, `${flow.name}: updated Node DOM was not reconciled`);
            } else {
                assert.equal(success.nodeCount, 3, `${flow.name}: output Node was not created exactly once`);
                assert.notEqual(success.selectedId, 't37-media-source', `${flow.name}: source remained selected`);
                assert.deepEqual(success.selectedImage, {nodeId:success.selectedId,index:0}, `${flow.name}: new output image is not selected`);
                assert.equal(success.selectedImageCount, flow.outputImages, `${flow.name}: output media count is wrong`);
                assert.equal(success.sourceImages, beforeFailure.sourceImages, `${flow.name}: source Node was mutated`);
                assert.equal(success.sourceDomSame, true, `${flow.name}: unchanged source DOM was replaced`);
                assert.equal(success.downstream, true, `${flow.name}: Node Placement did not place output downstream`);
                if (flow.name === 'mask') assert.equal(success.selectedRole, 'mask', 'mask: output is not an independent mask Node');
            }
            const attempts = uploadRequests.slice(-2);
            assert.deepEqual(attempts.map(attempt => attempt.result), ['failure','success'], `${flow.name}: retry did not repeat upload`);
            assert.ok(attempts.every(attempt => attempt.contentType.startsWith('multipart/form-data; boundary=')), `${flow.name}: upload did not use FormData`);
            assert.ok(attempts.every(attempt => attempt.bodyBytes > 100), `${flow.name}: upload body did not contain real media bytes`);
            assert.deepEqual(attempts[1].names, attempts[0].names, `${flow.name}: retry lost the draft file names`);
            evidence.push({flow:flow.name, files:attempts[1].names, success});
        }

        assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
        console.log(JSON.stringify({uploadRequests,evidence}, null, 2));
        console.log('T37 Image Studio real media flow browser smoke passed.');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
