const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const uploadedImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="48"%3E%3Cpath fill="%234c8bf5" d="M0 0h64v48H0z"/%3E%3C/svg%3E';
const uploadedImages = [
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"%3E%3Cpath fill="%234c8bf5" d="M0 0h1600v900H0z"/%3E%3C/svg%3E',
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"%3E%3Cpath fill="%23e45858" d="M0 0h900v1600H0z"/%3E%3C/svg%3E',
];

function multipartFileNames(request) {
    const body = request.postDataBuffer();
    if (!body) return [];
    return [...body.toString('latin1').matchAll(/filename="([^"]+)"/g)].map(match => match[1]);
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors = [];
        const uploadRequests = [];
        const regressions = [];
        let uploadMode = 'partial';
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.route('**/api/ai/upload', async route => {
            const request = route.request();
            const names = multipartFileNames(request);
            const contentType = request.headers()['content-type'] || '';
            uploadRequests.push({mode:uploadMode, names, contentType});
            await new Promise(resolve => setTimeout(resolve, 250));
            const returnedNames = uploadMode === 'partial' ? names.slice(0, 1) : names;
            await route.fulfill({
                status:200,
                contentType:'application/json',
                body:JSON.stringify({
                    files:returnedNames.map((name, index) => ({
                        url:uploadedImages[index],
                        name,
                        kind:'image',
                        natural_w:index === 0 ? 1600 : 900,
                        natural_h:index === 0 ? 900 : 1600,
                    })),
                }),
            });
        });

        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-smart-canvas-media&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasMutation
            && customElements.get('ic-file-input')
            && customElements.get('ic-toast')
            && canvas
            && Array.isArray(nodes)
            && document.querySelector('#fileInput')?.dataset.icContractStatus === 'ready'
        ));

        await page.evaluate(({imageUrl}) => {
            nodes.splice(0, nodes.length,
                {
                    id:'t37-upload-target',
                    type:'smart-image',
                    x:180,
                    y:180,
                    w:316,
                    h:194,
                    title:'Create / Import Node',
                    images:[],
                },
                {
                    id:'t37-upload-stable',
                    type:'smart-image',
                    x:760,
                    y:220,
                    w:240,
                    h:180,
                    title:'Stable',
                    images:[{url:imageUrl, name:'stable.svg', kind:'image'}],
                },
            );
            canvas.connections = [];
            selectedId = 't37-upload-target';
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            render();
        }, {imageUrl:uploadedImage});
        await page.waitForFunction(() => (
            document.querySelector('.image-node[data-id="t37-upload-target"] ic-upload-surface.node-drop')?.dataset.icContractStatus === 'ready'
        ));
        await page.waitForFunction(() => {
            const image = document.querySelector('.image-node[data-id="t37-upload-stable"] img');
            return Boolean(image?.complete && image.naturalWidth > 0);
        });
        await page.waitForTimeout(1000);
        const initialContract = await page.evaluate(() => ({
            globalPicker:document.querySelector('#fileInput')?.localName || '',
            nodePicker:document.querySelector('.image-node[data-id="t37-upload-target"] .node-drop')?.localName || '',
            nodeSurfaceShape:document.querySelector('.image-node[data-id="t37-upload-target"] .node-drop')?.getAttribute('shape') || '',
            legacyToast:Boolean(document.querySelector('#toast')),
            uploadSurfaceContent:(() => {
                const node = document.querySelector('.image-node[data-id="t37-upload-target"]');
                const picker = node?.querySelector('ic-upload-surface.node-drop');
                const icon = picker?.shadowRoot?.querySelector('.icon-box');
                const probe = document.createElement('span');
                probe.style.cssText = 'border:var(--ui-border-width-thin) solid var(--ui-color-border-tertiary);background:var(--ui-color-surface);box-shadow:var(--ui-shadow-raised)';
                document.body.appendChild(probe);
                const expected = getComputedStyle(probe);
                const iconStyle = icon ? getComputedStyle(icon) : null;
                const result = {
                    title:picker?.shadowRoot?.querySelector('.copy strong')?.textContent?.trim() || '',
                    hint:picker?.shadowRoot?.querySelector('.copy span')?.textContent?.trim() || '',
                    hasSharedButton:Boolean(picker?.shadowRoot?.querySelector('ic-button')),
                    nodeHint:node?.querySelector('.node-hint')?.textContent?.trim() || '',
                    surfaceRole:picker?.shadowRoot?.querySelector('.surface')?.getAttribute('role') || '',
                    surfaceTabIndex:picker?.shadowRoot?.querySelector('.surface')?.tabIndex,
                    surfaceBorder:getComputedStyle(picker?.shadowRoot?.querySelector('.surface')).borderWidth,
                    iconBorder:iconStyle?.borderWidth || '',
                    iconBorderColor:iconStyle?.borderColor || '',
                    iconBackground:iconStyle?.backgroundColor || '',
                    iconShadow:iconStyle?.boxShadow || '',
                    expectedIconBorderColor:expected.borderColor,
                    expectedIconBackground:expected.backgroundColor,
                    expectedIconShadow:expected.boxShadow,
                };
                probe.remove();
                return result;
            })(),
            geometry:(() => {
                const node = document.querySelector('.image-node[data-id="t37-upload-target"]');
                const body = node?.querySelector('.node-body');
                const picker = body?.querySelector('ic-upload-surface.node-drop');
                const rect = element => {
                    const box = element?.getBoundingClientRect();
                    return box ? [Math.round(box.top), Math.round(box.bottom), Math.round(box.height)] : [];
                };
                return {node:rect(node), body:rect(body), picker:rect(picker), field:rect(picker?.shadowRoot?.querySelector('.surface'))};
            })(),
        }));
        assert.equal(initialContract.globalPicker, 'ic-file-input', 'global picker is not ic-file-input');
        assert.equal(initialContract.nodePicker, 'ic-upload-surface');
        assert.equal(initialContract.nodeSurfaceShape, 'node');
        assert.equal(initialContract.legacyToast, false, 'legacy toast surface still exists');
        assert.ok(initialContract.uploadSurfaceContent.title, 'node Surface title is missing');
        assert.ok(initialContract.uploadSurfaceContent.hint, 'node Surface behavior hint is missing');
        assert.equal(initialContract.uploadSurfaceContent.hasSharedButton, true, 'node Surface does not compose ic-button');
        assert.equal(initialContract.uploadSurfaceContent.nodeHint, '', 'legacy external node hint remains');
        assert.equal(initialContract.uploadSurfaceContent.surfaceRole, 'presentation');
        assert.equal(initialContract.uploadSurfaceContent.surfaceTabIndex, -1);
        assert.equal(initialContract.uploadSurfaceContent.surfaceBorder, '0px');
        assert.notEqual(initialContract.uploadSurfaceContent.iconBorder, '0px');
        assert.equal(initialContract.uploadSurfaceContent.iconBorderColor, initialContract.uploadSurfaceContent.expectedIconBorderColor);
        assert.equal(initialContract.uploadSurfaceContent.iconBackground, initialContract.uploadSurfaceContent.expectedIconBackground);
        assert.equal(initialContract.uploadSurfaceContent.iconShadow, initialContract.uploadSurfaceContent.expectedIconShadow);
        assert.ok(
            initialContract.geometry.field[1] <= initialContract.geometry.body[1] + 1,
            `upload Surface overflows its Node: ${JSON.stringify(initialContract.geometry)}`,
        );

        const uploadNode = page.locator('.image-node[data-id="t37-upload-target"]');
        const uploadIcon = uploadNode.locator('ic-upload-surface.node-drop').locator('.icon-box');
        const positionBeforeDrag = await uploadNode.evaluate(node => ({x:parseFloat(node.style.left),y:parseFloat(node.style.top)}));
        const uploadIconBox = await uploadIcon.boundingBox();
        assert.ok(uploadIconBox, 'upload node icon should be measurable');
        await page.mouse.move(uploadIconBox.x + uploadIconBox.width / 2, uploadIconBox.y + uploadIconBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(uploadIconBox.x + uploadIconBox.width / 2 + 42, uploadIconBox.y + uploadIconBox.height / 2 + 26, {steps:5});
        await page.mouse.up();
        await page.waitForTimeout(50);
        const positionAfterDrag = await uploadNode.evaluate(node => ({x:parseFloat(node.style.left),y:parseFloat(node.style.top)}));
        assert.ok(positionAfterDrag.x >= positionBeforeDrag.x + 41, JSON.stringify({positionBeforeDrag,positionAfterDrag}));
        assert.ok(positionAfterDrag.y >= positionBeforeDrag.y + 25, JSON.stringify({positionBeforeDrag,positionAfterDrag}));

        await page.evaluate(() => {
            window.__t37StableUploadNode = document.querySelector('.image-node[data-id="t37-upload-stable"]');
        });
        let chooser = null;
        [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('.image-node[data-id="t37-upload-target"] ic-upload-surface.node-drop').evaluate(picker => picker.shadowRoot.querySelector('ic-button').click()),
        ]);
        const partialResponse = page.waitForResponse(response => (
            response.url().includes('/api/ai/upload') && response.status() === 200
        ));
        await chooser.setFiles([
            {name:'partial-a.png', mimeType:'image/png', buffer:Buffer.from('partial-a')},
            {name:'partial-b.png', mimeType:'image/png', buffer:Buffer.from('partial-b')},
        ]);
        await page.waitForFunction(() => {
            const picker = document.querySelector('.image-node[data-id="t37-upload-target"] ic-upload-surface.node-drop');
            return picker?.hasAttribute('disabled') && Boolean(picker.shadowRoot?.querySelector('ic-loading'));
        });
        const busyState = await page.evaluate(() => {
            const picker = document.querySelector('.image-node[data-id="t37-upload-target"] ic-upload-surface.node-drop');
            return {
                busy:picker?.getAttribute('aria-busy'),
                loadingLabel:picker?.shadowRoot?.querySelector('ic-loading')?.getAttribute('label') || '',
            };
        });
        assert.equal(busyState.busy, 'true');
        assert.match(busyState.loadingLabel, /upload|上传/i, 'upload loading feedback is missing');
        await partialResponse;
        await page.waitForFunction(() => Boolean(document.querySelector('ic-toast[data-ic-overlay]')));
        await page.waitForFunction(() => !document.querySelector('.image-node[data-id="t37-upload-target"] ic-upload-surface.node-drop')?.hasAttribute('disabled'));

        const afterPartial = await page.evaluate(() => {
            const target = nodes.find(node => node.id === 't37-upload-target');
            const toast = document.querySelector('ic-toast[data-ic-overlay]');
            return {
                images:target?.images?.length || 0,
                nodeCount:nodes.length,
                connections:canvas.connections.length,
                stableDomSame:document.querySelector('.image-node[data-id="t37-upload-stable"]') === window.__t37StableUploadNode,
                toastTone:toast?.getAttribute('tone') || '',
                toastText:toast?.textContent?.trim() || '',
            };
        });
        assert.deepEqual(
            [afterPartial.images, afterPartial.nodeCount, afterPartial.connections],
            [0, 2, 0],
            'partial response changed Canvas model',
        );
        if (!afterPartial.stableDomSame) regressions.push('partial response rematerialized an unrelated Node');
        assert.equal(afterPartial.toastTone, 'danger', 'failure feedback is not ic-toast danger');
        assert.match(afterPartial.toastText, /upload|上传/i);
        await page.evaluate(() => document.querySelector('ic-toast[data-ic-overlay]')?.dismiss());

        uploadMode = 'success';
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            window.__t37StableUploadNode = document.querySelector('.image-node[data-id="t37-upload-stable"]');
        });
        [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('.image-node[data-id="t37-upload-target"] ic-upload-surface.node-drop').evaluate(picker => picker.shadowRoot.querySelector('ic-button').click()),
        ]);
        const successResponse = page.waitForResponse(response => (
            response.url().includes('/api/ai/upload') && response.status() === 200
        ));
        await chooser.setFiles([
            {name:'retry-a-wide.png', mimeType:'image/png', buffer:Buffer.from('retry-a')},
            {name:'retry-b-tall.png', mimeType:'image/png', buffer:Buffer.from('retry-b')},
        ]);
        await successResponse;
        await page.waitForFunction(() => (
            nodes.find(node => node.id === 't37-upload-target')?.images?.length === 2
        ));

        const afterRetry = await page.evaluate(() => {
            const target = nodes.find(node => node.id === 't37-upload-target');
            return {
                images:target?.images?.map(image => image.name) || [],
                uploadedAttachment:Boolean(target?.uploadedAttachment),
                generationOutputNode:Boolean(target?.generationOutputNode),
                hasActiveOutputId:Object.hasOwn(target || {}, 'activeOutputId'),
                selectedId,
                nodeCount:nodes.length,
                connections:canvas.connections.length,
                stableDomSame:document.querySelector('.image-node[data-id="t37-upload-stable"]') === window.__t37StableUploadNode,
                legacyGallery:Boolean(document.querySelector('.image-node[data-id="t37-upload-target"] .generation-output-view')),
                mediaLayout:[...document.querySelectorAll('.image-node[data-id="t37-upload-target"] .thumb-item')].map((item, index) => {
                    const media = item.querySelector('img,video,audio');
                    const name = item.querySelector('.image-name-badge');
                    const resolution = item.querySelector('.image-resolution-badge');
                    const box = element => {
                        const rect = element?.getBoundingClientRect();
                        return rect ? {top:rect.top, right:rect.right, bottom:rect.bottom, left:rect.left, width:rect.width, height:rect.height} : null;
                    };
                    return {
                        expectedAspect:index === 0 ? 1600 / 900 : 900 / 1600,
                        item:box(item),
                        media:box(media),
                        name:box(name),
                        resolution:box(resolution),
                        resolutionStyle:resolution ? {
                            background:getComputedStyle(resolution).backgroundColor,
                            color:getComputedStyle(resolution).color,
                            fontWeight:getComputedStyle(resolution).fontWeight,
                            paddingLeft:getComputedStyle(resolution).paddingLeft,
                            paddingRight:getComputedStyle(resolution).paddingRight,
                            borderWidth:getComputedStyle(resolution).borderTopWidth,
                            boxShadow:getComputedStyle(resolution).boxShadow,
                            backdropFilter:getComputedStyle(resolution).backdropFilter,
                        } : null,
                    };
                }),
            };
        });
        assert.deepEqual(afterRetry.images, ['retry-a-wide.png', 'retry-b-tall.png'], 'retry did not create a two-media Node');
        assert.equal(afterRetry.uploadedAttachment, true);
        assert.equal(afterRetry.generationOutputNode, false, 'ordinary upload became Generation Output gallery');
        assert.equal(afterRetry.hasActiveOutputId, false, 'ordinary upload became Generation Output gallery');
        assert.equal(afterRetry.legacyGallery, false, 'ordinary upload became Generation Output gallery');
        assert.deepEqual([afterRetry.selectedId, afterRetry.nodeCount, afterRetry.connections], ['t37-upload-target', 2, 0]);
        if (!afterRetry.stableDomSame) regressions.push('successful retry rematerialized an unrelated Node');
        afterRetry.mediaLayout.forEach((layout, index) => {
            assert.ok(layout.media && layout.name && layout.resolution, `media ${index} is missing layout evidence`);
            assert.equal(layout.resolution.height, 16, `media ${index} resolution badge is not 1rem high`);
            assert.deepEqual(layout.resolutionStyle, {
                background:'rgba(0, 0, 0, 0.25)',
                color:'rgb(255, 255, 255)',
                fontWeight:'400',
                paddingLeft:'6px',
                paddingRight:'6px',
                borderWidth:'0px',
                boxShadow:'none',
                backdropFilter:'blur(10px)',
            });
            if (Math.abs((layout.media.width / layout.media.height) - layout.expectedAspect) >= 0.03) {
                regressions.push(`media ${index} is forced into the wrong aspect ratio: ${JSON.stringify(layout)}`);
            }
            if (layout.name.top < layout.media.bottom - 1) {
                regressions.push(`media ${index} filename overlaps the image area: ${JSON.stringify(layout)}`);
            }
            if (!(layout.name.top >= layout.resolution.bottom - 1 || layout.name.bottom <= layout.resolution.top + 1)) {
                regressions.push(`media ${index} filename overlaps resolution feedback: ${JSON.stringify(layout)}`);
            }
        });

        await page.evaluate(() => document.querySelector('ic-toast[data-ic-overlay]')?.dismiss());
        const beforeUnsupportedDrop = await page.evaluate(() => nodes.length);
        await page.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['not media'], 'unsupported.txt', {type:'text/plain'}));
            const target = document.querySelector('#world');
            target.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer:transfer}));
            target.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:transfer}));
        });
        await page.waitForFunction(
            () => Boolean(document.querySelector('ic-toast[data-ic-overlay]')),
            null,
            {timeout:1500},
        ).catch(() => {});
        const afterUnsupportedDrop = await page.evaluate(() => ({
            nodeCount:nodes.length,
            toastTone:document.querySelector('ic-toast[data-ic-overlay]')?.getAttribute('tone') || '',
            toastText:document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || '',
        }));
        assert.equal(afterUnsupportedDrop.nodeCount, beforeUnsupportedDrop, 'unsupported Canvas drop created a Node');
        if (!/支持|support|格式|format|file/i.test(afterUnsupportedDrop.toastText)) {
            regressions.push(`unsupported Canvas drop did not show feedback: ${JSON.stringify(afterUnsupportedDrop)}`);
        }

        assert.equal(uploadRequests.length, 2);
        uploadRequests.forEach(request => {
            assert.match(request.contentType, /^multipart\/form-data; boundary=/, 'multipart/form-data; boundary=');
            assert.equal(request.names.length, 2);
        });
        assert.deepEqual(uploadRequests.map(request => request.mode), ['partial', 'success']);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(regressions, [], regressions.join('\n'));
        console.log(JSON.stringify({initialContract, busyState, afterPartial, afterRetry, afterUnsupportedDrop, uploadRequests}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
