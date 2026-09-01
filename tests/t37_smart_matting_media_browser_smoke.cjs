const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="480"%3E%3Cpath fill="%234c8bf5" d="M0 0h640v480H0z"/%3E%3C/svg%3E';
const outputImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="480"%3E%3Cpath fill="%23ef5da8" d="M80 40h480v400H80z"/%3E%3C/svg%3E';

function mattingState(page, nodeId) {
    return page.locator(`.image-node[data-id="${nodeId}"]`).evaluate(node => {
        const pending = node.querySelector('ic-generation-pending[data-matting-pending]');
        const badge = node.querySelector('ic-badge.matting-pending-detail');
        const alert = node.querySelector('ic-alert');
        const legacy = node.querySelector('.jimeng-pending-cell,.jimeng-pending-overlay,.jimeng-pending-spinner,.matting-pending-cell,.loading-cell');
        const rect = element => {
            const box = element?.getBoundingClientRect();
            return box ? {width:Math.round(box.width), height:Math.round(box.height)} : null;
        };
        return {
            pendingState:pending?.getAttribute('state') || '',
            pendingLabel:pending?.getAttribute('label') || '',
            pendingContract:pending?.dataset.icContractStatus || '',
            pendingBusy:pending?.getAttribute('aria-busy') || '',
            badgeText:badge?.textContent?.trim() || '',
            badgeContract:badge?.dataset.icContractStatus || '',
            alertTone:alert?.getAttribute('tone') || '',
            alertHeading:alert?.getAttribute('heading') || '',
            alertText:alert?.textContent?.trim() || '',
            alertContract:alert?.dataset.icContractStatus || '',
            alertRole:alert?.getAttribute('role') || '',
            node:rect(node),
            body:rect(node.querySelector('.node-body')),
            feedback:rect(node.querySelector('.matting-pending-feedback,.matting-failure-feedback')),
            legacy:Boolean(legacy),
        };
    });
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors = [];
        const requests = [];
        let mode = 'success';
        let pollCount = 0;
        page.on('pageerror', error => pageErrors.push(error.message));

        await page.route('**/api/smart-canvas/matting', async route => {
            if(route.request().method() !== 'POST') return route.fallback();
            const body = route.request().postDataJSON();
            requests.push({type:'submit', mode, body});
            await new Promise(resolve => setTimeout(resolve, mode === 'success' ? 450 : 350));
            if(mode === 'failure') {
                await route.fulfill({
                    status:503,
                    contentType:'application/json',
                    body:JSON.stringify({detail:'Smart Matting 暂时不可用'}),
                });
                return;
            }
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({job_id:'t37-matting-job-success', status:'queued', position:3, queue_length:4}),
            });
        });
        await page.route('**/api/smart-canvas/matting/*', async route => {
            pollCount += 1;
            requests.push({type:'poll', pollCount});
            await new Promise(resolve => setTimeout(resolve, 350));
            if(pollCount === 1) {
                await route.fulfill({
                    status:200,
                    contentType:'application/json',
                    body:JSON.stringify({job_id:'t37-matting-job-success', status:'queued', position:2, queue_length:3}),
                });
                return;
            }
            if(pollCount === 2) {
                await route.fulfill({
                    status:200,
                    contentType:'application/json',
                    body:JSON.stringify({job_id:'t37-matting-job-success', status:'running', message:'正在提取前景'}),
                });
                return;
            }
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({
                    job_id:'t37-matting-job-success',
                    status:'succeeded',
                    output_url:outputImage,
                    output_name:'smart-matting.png',
                    model:'birefnet-general',
                    width:640,
                    height:480,
                }),
            });
        });

        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-smart-matting-media&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.smartMatting
            && window.SmartCanvasModules?.generationOutput
            && customElements.get('ic-generation-pending')
            && customElements.get('ic-alert')
            && customElements.get('ic-badge')
            && canvas
            && Array.isArray(nodes)
        ));

        await page.evaluate(({sourceImage}) => {
            nodes.splice(0, nodes.length,
                {
                    id:'t37-matting-source',
                    type:'smart-image',
                    x:180,
                    y:180,
                    w:320,
                    h:240,
                    title:'Matting Source',
                    images:[{url:sourceImage, name:'source.svg', kind:'image', natural_w:640, natural_h:480}],
                },
                {
                    id:'t37-matting-stable',
                    type:'smart-image',
                    x:180,
                    y:560,
                    w:240,
                    h:180,
                    title:'Stable',
                    images:[{url:sourceImage, name:'stable.svg', kind:'image', natural_w:640, natural_h:480}],
                },
            );
            canvas.connections = [];
            selectedId = 't37-matting-source';
            selectedIds = [];
            selectedImage = {nodeId:'t37-matting-source',index:0};
            render();
            window.__t37StableMattingNode = document.querySelector('.image-node[data-id="t37-matting-stable"]');
            window.__t37MattingSourceSize = (() => {
                const rect = document.querySelector('.image-node[data-id="t37-matting-source"]')?.getBoundingClientRect();
                return rect ? {width:Math.round(rect.width),height:Math.round(rect.height)} : null;
            })();
            window.SmartCanvasModules.smartMatting.run({nodeId:'t37-matting-source', imageIndex:0});
        }, {sourceImage});

        await page.waitForFunction(() => Boolean(
            nodes.find(node => node.mattingSourceNodeId === 't37-matting-source' && node.mattingJob?.status === 'submitting')
        ));
        const submittingId = await page.evaluate(() => (
            nodes.find(node => node.mattingSourceNodeId === 't37-matting-source' && node.mattingJob)?.id || ''
        ));
        const submittingState = await mattingState(page, submittingId);
        assert.equal(submittingState.pendingState, 'queued');
        assert.match(submittingState.pendingLabel, /提交|submitt/i);
        assert.equal(submittingState.pendingContract, 'ready');
        assert.equal(submittingState.pendingBusy, 'true');
        assert.deepEqual(submittingState.node, await page.evaluate(() => window.__t37MattingSourceSize));
        assert.equal(submittingState.badgeContract, '');
        assert.equal(submittingState.badgeText, '');
        assert.equal(submittingState.legacy, false);

        await page.evaluate(id => { window.__t37MattingOutputId = id; }, submittingId);
        await page.waitForFunction(() => (
            nodes.find(node => node.id === window.__t37MattingOutputId)?.mattingJob?.status === 'queued'
        ));
        const queuedState = await mattingState(page, submittingId);
        assert.equal(queuedState.pendingState, 'queued');
        assert.match(queuedState.pendingLabel, /第\s*[23]\s*位|queue/i);
        assert.equal(queuedState.pendingContract, 'ready');
        assert.equal(queuedState.legacy, false);

        await page.evaluate(() => applyTheme('dark'));
        await page.waitForFunction(() => (
            nodes.find(node => node.id === window.__t37MattingOutputId)?.mattingJob?.status === 'running'
        ), null, {timeout:6000});
        const runningState = await mattingState(page, submittingId);
        assert.equal(runningState.pendingState, 'generating');
        assert.match(runningState.pendingLabel, /前景|Matting|执行/i);
        assert.equal(runningState.pendingContract, 'ready');
        assert.equal(runningState.legacy, false);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.uiTheme), 'dark');

        await page.waitForFunction(({outputImage}) => {
            const output = nodes.find(node => node.id === window.__t37MattingOutputId);
            return output?.images?.[0]?.url === outputImage && !output.mattingJob;
        }, {outputImage}, {timeout:7000});
        const successState = await page.evaluate(({sourceImage, outputImage}) => {
            const source = nodes.find(node => node.id === 't37-matting-source');
            const output = nodes.find(node => node.id === window.__t37MattingOutputId);
            const sourceRect = nodeRect(source);
            const outputRect = nodeRect(output);
            return {
                sourceImages:source.images.map(image => image.url),
                outputImages:output.images.map(image => image.url),
                outputName:output.images[0]?.name || '',
                outputSize:[output.images[0]?.natural_w, output.images[0]?.natural_h],
                mattingSourceNodeId:output.mattingResult?.sourceNodeId || '',
                model:output.mattingResult?.model || '',
                hasJob:Boolean(output.mattingJob),
                downstream:outputRect.x >= sourceRect.x + sourceRect.width,
                sourceNodeSize:{width:Math.round(sourceRect.width),height:Math.round(sourceRect.height)},
                outputNodeSize:{width:Math.round(outputRect.width),height:Math.round(outputRect.height)},
                stableDomSame:document.querySelector('.image-node[data-id="t37-matting-stable"]') === window.__t37StableMattingNode,
                legacyGallery:Boolean(document.querySelector(`.image-node[data-id="${output.id}"] .generation-output-view`)),
                connections:canvas.connections.map(connection => ({from:connection.from,to:connection.to,kind:connection.kind || ''})),
                expected:{sourceImage,outputImage},
            };
        }, {sourceImage, outputImage});
        assert.deepEqual(successState.sourceImages, [sourceImage]);
        assert.deepEqual(successState.outputImages, [outputImage]);
        assert.equal(successState.outputName, 'smart-matting.png');
        assert.deepEqual(successState.outputSize, [640, 480]);
        assert.equal(successState.mattingSourceNodeId, 't37-matting-source');
        assert.equal(successState.model, 'birefnet-general');
        assert.equal(successState.hasJob, false);
        assert.equal(successState.downstream, true);
        assert.deepEqual(successState.outputNodeSize, successState.sourceNodeSize);
        assert.equal(successState.stableDomSame, true);
        assert.equal(successState.legacyGallery, false);
        assert.deepEqual(successState.connections, [{from:'t37-matting-source',to:submittingId,kind:'flow'}]);

        mode = 'failure';
        await page.evaluate(() => {
            window.SmartCanvasModules.smartMatting.run({nodeId:'t37-matting-source', imageIndex:0});
        });
        await page.waitForFunction(() => Boolean(
            nodes.find(node => (
                node.id !== window.__t37MattingOutputId
                && node.mattingSourceNodeId === 't37-matting-source'
                && node.mattingJob?.status === 'failed'
            ))
        ));
        const failedId = await page.evaluate(() => (
            nodes.find(node => (
                node.id !== window.__t37MattingOutputId
                && node.mattingSourceNodeId === 't37-matting-source'
                && node.mattingJob?.status === 'failed'
            ))?.id || ''
        ));
        const failedState = await mattingState(page, failedId);
        assert.equal(failedState.pendingState, '');
        assert.equal(failedState.alertTone, 'danger');
        assert.match(failedState.alertHeading, /抠图失败|Matting failed/i);
        assert.match(failedState.alertText, /暂时不可用|提交失败|unavailable|failed/i);
        assert.equal(failedState.alertContract, 'ready');
        assert.equal(failedState.alertRole, 'alert');
        assert.equal(failedState.legacy, false);
        assert.ok(failedState.feedback.width <= failedState.body.width);
        assert.ok(failedState.feedback.height <= failedState.body.height);

        const finalCanvasState = await page.evaluate(failedNodeId => ({
            nodeCount:nodes.length,
            sourceImageCount:nodes.find(node => node.id === 't37-matting-source')?.images?.length || 0,
            failedPending:nodes.find(node => node.id === failedNodeId)?.pending,
            failedRunning:nodes.find(node => node.id === failedNodeId)?.running,
            connections:canvas.connections.length,
            legacyDom:Boolean(document.querySelector('.jimeng-pending-cell,.matting-pending-cell,.loading-cell.single')),
        }), failedId);
        assert.deepEqual(finalCanvasState, {
            nodeCount:4,
            sourceImageCount:1,
            failedPending:0,
            failedRunning:false,
            connections:2,
            legacyDom:false,
        });
        assert.deepEqual(pageErrors, []);
        assert.equal(requests.filter(request => request.type === 'submit').length, 2);
        assert.ok(requests.filter(request => request.type === 'poll').length >= 3);
        console.log(JSON.stringify({submittingState, queuedState, runningState, failedState, successState, finalCanvasState, requests}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
