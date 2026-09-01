const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.T37_SCREENSHOT_DIR || '';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';
const secondImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"%3E%3Cpath fill="%235a8dee" d="M0 0h1200v800H0z"/%3E%3C/svg%3E';
const parentImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="900"%3E%3Cpath fill="%23e45858" d="M0 0h900v900H0z"/%3E%3C/svg%3E';
const referenceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"%3E%3Cpath fill="%2344a66f" d="M0 0h800v1000H0z"/%3E%3C/svg%3E';

function alphaFromColor(color) {
    const modern = color.match(/\/\s*([\d.]+)\s*\)$/);
    if (modern) return Number(modern[1]);
    const match = color.match(/rgba?\([^/)]*(?:\/|,)\s*([\d.]+)\s*\)?$/);
    return match ? Number(match[1]) : 1;
}

(async () => {
    const browser = await chromium.launch({ headless:true, executablePath:browserExecutable });
    try {
        const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-image-studio-browser`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.imageStudio
            && document.querySelector('#imageEditModal')?.dataset.icContractStatus === 'ready'
        ));

        await page.evaluate(({imageUrl, nextImageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const id = 't37-image-node';
                nodes.splice(0, nodes.length, {
                    id,
                    type:'smart-image',
                    x:260,
                    y:210,
                    w:520,
                    h:330,
                    images:[{
                        url:${JSON.stringify(imageUrl)},
                        name:'t37-browser-probe.png',
                        kind:'image',
                        natural_w:1600,
                        natural_h:1000
                    }, {
                        url:${JSON.stringify(nextImageUrl)},
                        name:'t37-browser-next.svg',
                        kind:'image',
                        natural_w:1200,
                        natural_h:800
                    }]
                });
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:id, index:0};
                render();
                window.SmartCanvasModules.imageStudio.open({nodeId:id, imageIndex:0, mode:'preview'});
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng, nextImageUrl:secondImage});

        await page.waitForFunction(() => document.querySelector('#imageEditModal')?.open);
        await page.waitForFunction(() => {
            const dialog = document.querySelector('#imageEditModal')?.shadowRoot?.querySelector('[part="dialog"]');
            if (!dialog) return false;
            const bounds = dialog.getBoundingClientRect();
            return Math.abs(bounds.width - window.innerWidth) < 2
                && Math.abs(bounds.height - window.innerHeight) < 2;
        });
        const lightState = await page.locator('#imageEditModal').evaluate(modal => {
            const dialog = modal.shadowRoot.querySelector('[part="dialog"]');
            const header = modal.shadowRoot.querySelector('[part="header"]');
            const body = modal.shadowRoot.querySelector('[part="body"]');
            const footer = modal.shadowRoot.querySelector('[part="footer"]');
            const modeToolbar = modal.querySelector('#imageEditModeToolbar');
            const workbench = modal.querySelector('#imageEditWorkbench');
            const stage = modal.querySelector('#imageEditStage');
            const image = modal.querySelector('#previewCurrentImage');
            const selectedMode = modal.querySelector('[data-image-edit-mode="preview"]');
            const previewDownloadBase = modal.querySelector('#previewDownloadBtn')?.shadowRoot?.querySelector('[part="base"]');
            const bounds = dialog.getBoundingClientRect();
            const stageBounds = stage.getBoundingClientRect();
            const footerBounds = footer.getBoundingClientRect();
            const workbenchBounds = workbench.getBoundingClientRect();
            return {
                viewport:[window.innerWidth, window.innerHeight],
                studioScale:getComputedStyle(document.documentElement).getPropertyValue('--studio-ui-scale').trim(),
                hostZoom:getComputedStyle(modal).zoom,
                open:modal.open,
                contract:modal.dataset.icContractStatus,
                immersive:modal.hasAttribute('immersive'),
                size:modal.getAttribute('size'),
                dismissPolicy:modal.getAttribute('dismiss-policy'),
                backdropFilter:getComputedStyle(modal).getPropertyValue('--ic-dialog-backdrop-filter').trim(),
                width:Math.round(bounds.width),
                height:Math.round(bounds.height),
                inlineSize:getComputedStyle(dialog).inlineSize,
                blockSize:getComputedStyle(dialog).blockSize,
                maxInlineSize:getComputedStyle(dialog).maxInlineSize,
                maxBlockSize:getComputedStyle(dialog).maxBlockSize,
                dialogBackground:getComputedStyle(dialog).backgroundColor,
                headerBackground:getComputedStyle(header).backgroundColor,
                bodyDisplay:getComputedStyle(body).display,
                stageBounds:[
                    Math.round(stageBounds.left),
                    Math.round(stageBounds.top),
                    Math.round(stageBounds.width),
                    Math.round(stageBounds.height),
                ],
                stageDirectChild:stage.parentElement === modal,
                footerBackground:getComputedStyle(footer).backgroundColor,
                titleVisible:Boolean(modal.querySelector('#imageEditTitle, #imageEditSubtitle')),
                modeToolbar:modeToolbar.localName,
                modeToolbarContract:modeToolbar.dataset.icContractStatus,
                workbench:workbench.localName,
                workbenchContract:workbench.dataset.icContractStatus,
                workbenchSize:[Math.round(workbenchBounds.width), Math.round(workbenchBounds.height)],
                workbenchAtBottom:workbenchBounds.bottom <= footerBounds.bottom + 1 && footerBounds.top > window.innerHeight / 2,
                selectedModeBackground:getComputedStyle(selectedMode).backgroundColor,
                selectedModeColor:getComputedStyle(selectedMode).color,
                unselectedModeBackground:getComputedStyle(modal.querySelector('[data-image-edit-mode="crop"]')).backgroundColor,
                unselectedModeColor:getComputedStyle(modal.querySelector('[data-image-edit-mode="crop"]')).color,
                selectedModeFontSize:getComputedStyle(selectedMode).fontSize,
                previewButtonFontSize:getComputedStyle(previewDownloadBase).fontSize,
                previewButtonColor:getComputedStyle(previewDownloadBase).color,
                stageBackground:getComputedStyle(stage).backgroundColor,
                imageBackground:getComputedStyle(image).backgroundColor,
                previewActionsHidden:modal.querySelector('#imagePreviewActions').hidden,
                commitActionsHidden:modal.querySelector('#imageEditCommitActions').hidden,
                mode:modal.querySelector('#imageEditModeTabs')?.value,
                mediaKind:modal.querySelector('#previewMediaContainer')?.getAttribute('kind'),
                compareVisible:getComputedStyle(modal.querySelector('#compareToggleBtn')).display !== 'none',
                comparePicker:modal.querySelector('#compareThumbs')?.localName,
                comparePickerContract:modal.querySelector('#compareThumbs')?.dataset.icContractStatus,
                panoramaLoading:modal.querySelector('#panoramaLoading')?.localName,
                panoramaLoadingContract:modal.querySelector('#panoramaLoading')?.dataset.icContractStatus,
                positionHintHidden:modal.querySelector('#previewGroupNavHint')?.hidden,
                positionCount:modal.querySelector('#previewGroupNavCount')?.textContent.trim(),
                positionText:modal.querySelector('.preview-group-nav-position')?.textContent.replace(/\s+/g, ' ').trim(),
            };
        });
        assert.equal(lightState.open, true);
        assert.equal(lightState.contract, 'ready');
        assert.equal(lightState.immersive, true);
        assert.equal(lightState.size, 'x-large');
        assert.equal(lightState.dismissPolicy, 'explicit');
        assert.match(lightState.backdropFilter, /blur\(4px\)/);
        assert.ok(Math.abs(lightState.width - lightState.viewport[0]) <= 1 && Math.abs(lightState.height - lightState.viewport[1]) <= 1);
        assert.ok(alphaFromColor(lightState.dialogBackground) < 0.5, lightState.dialogBackground);
        assert.equal(alphaFromColor(lightState.headerBackground), 0, lightState.headerBackground);
        assert.equal(alphaFromColor(lightState.footerBackground), 0, lightState.footerBackground);
        assert.equal(lightState.bodyDisplay, 'block');
        assert.ok(lightState.stageBounds.every((value, index) => Math.abs(value - [0, 0, ...lightState.viewport][index]) <= 1));
        assert.equal(lightState.stageDirectChild, true);
        assert.equal(lightState.titleVisible, false);
        assert.deepEqual(
            [lightState.modeToolbar, lightState.modeToolbarContract, lightState.workbench, lightState.workbenchContract],
            ['ic-image-edit-mode-toolbar', 'ready', 'ic-image-edit-dock', 'ready'],
        );
        assert.equal(lightState.workbenchSize[1], 48);
        assert.ok(lightState.workbenchSize[0] > 0 && lightState.workbenchSize[0] <= 820, lightState.workbenchSize);
        assert.equal(lightState.workbenchAtBottom, true);
        assert.equal(lightState.selectedModeBackground, 'rgb(20, 20, 20)');
        assert.equal(lightState.selectedModeColor, 'rgb(255, 255, 255)');
        assert.equal(lightState.unselectedModeBackground, 'rgba(0, 0, 0, 0)');
        assert.equal(lightState.unselectedModeColor, 'rgb(64, 64, 64)');
        assert.equal(lightState.selectedModeFontSize, '12px');
        assert.equal(lightState.previewButtonFontSize, '12px');
        assert.equal(lightState.previewButtonColor, 'rgb(20, 20, 20)');
        assert.equal(alphaFromColor(lightState.stageBackground), 0, lightState.stageBackground);
        assert.equal(alphaFromColor(lightState.imageBackground), 0, lightState.imageBackground);
        assert.equal(lightState.previewActionsHidden, false);
        assert.equal(lightState.commitActionsHidden, true);
        assert.equal(lightState.mode, 'preview');
        assert.equal(lightState.mediaKind, 'image');
        assert.equal(lightState.compareVisible, false);
        assert.deepEqual(
            [lightState.comparePicker, lightState.comparePickerContract, lightState.panoramaLoading, lightState.panoramaLoadingContract],
            ['ic-tabs', 'ready', 'ic-loading', 'ready'],
        );
        assert.equal(lightState.positionHintHidden, false);
        assert.equal(lightState.positionCount, '1 / 2');
        assert.equal(lightState.positionText, '1 / 2');

        // Software-only CI runners may not expose WebGL; default runs still cover panorama.
        if (process.env.SKIP_PANORAMA !== '1') {
        assert.equal(await page.locator('#imageEditModeToolbar #panoramaToggleBtn').count(), 1);
        await page.evaluate(() => {
            window.__panoramaRevealSamples = [];
            const started = performance.now();
            const sample = () => {
                const image = document.querySelector('#previewCurrentImage');
                const stage = document.querySelector('#panoramaStage');
                const ready = stage?.classList.contains('ready');
                const panoramaVisible = stage && getComputedStyle(stage).display !== 'none';
                window.__panoramaRevealSamples.push({
                    imageVisible:Boolean(image && getComputedStyle(image).display !== 'none'),
                    panoramaVisible:Boolean(panoramaVisible),
                    ready:Boolean(ready),
                });
                if(!(ready && panoramaVisible) && performance.now() - started < 3000) requestAnimationFrame(sample);
            };
            sample();
        });
        await page.locator('#panoramaToggleBtn').click();
        await page.waitForFunction(() => (
            document.querySelector('#panoramaStage')?.classList.contains('ready')
            && getComputedStyle(document.querySelector('#panoramaStage')).display !== 'none'
        ));
        const panoramaDebug = await page.evaluate(() => ({
            display:getComputedStyle(document.querySelector('#panoramaControls')).display,
            inlineDisplay:document.querySelector('#panoramaControls')?.style.display,
            toolsHidden:document.querySelector('#imagePanoramaTools')?.hidden,
            previewToolsHidden:document.querySelector('#imagePreviewTools')?.hidden,
            togglePressed:document.querySelector('#panoramaToggleBtn')?.hasAttribute('pressed'),
            toggleBackground:getComputedStyle(document.querySelector('#panoramaToggleBtn')?.shadowRoot?.querySelector('[part="base"]')).backgroundColor,
            toggleColor:getComputedStyle(document.querySelector('#panoramaToggleBtn')?.shadowRoot?.querySelector('[part="base"]')).color,
            toggleFontWeight:getComputedStyle(document.querySelector('#panoramaToggleBtn')?.shadowRoot?.querySelector('[part="base"]')).fontWeight,
            previewSelected:document.querySelector('[data-image-edit-mode="preview"]')?.getAttribute('aria-selected'),
            previewBackground:getComputedStyle(document.querySelector('[data-image-edit-mode="preview"]')).backgroundColor,
            revealSamples:window.__panoramaRevealSamples || [],
            mode:document.querySelector('#imageEditModeTabs')?.value,
            modalClass:document.querySelector('#imageEditModal')?.className,
        }));
        assert.notEqual(panoramaDebug.display, 'none', `${JSON.stringify(panoramaDebug)}\n${pageErrors.join('\n')}`);
        assert.equal(panoramaDebug.toggleBackground, lightState.selectedModeBackground, JSON.stringify(panoramaDebug));
        assert.equal(panoramaDebug.toggleColor, lightState.selectedModeColor);
        assert.equal(panoramaDebug.toggleFontWeight, '400');
        assert.equal(panoramaDebug.previewSelected, 'false');
        assert.equal(alphaFromColor(panoramaDebug.previewBackground), 0, panoramaDebug.previewBackground);
        assert.equal(
            panoramaDebug.revealSamples.some(sample => !sample.ready && !sample.imageVisible),
            false,
            JSON.stringify(panoramaDebug.revealSamples),
        );
        const panoramaToolbarState = await page.locator('#imageEditWorkbench').evaluate(toolbar => ({
            ratio:toolbar.querySelector('#panoramaRatioTabs')?.value,
            resetVisible:getComputedStyle(toolbar.querySelector('#panoramaResetBtn')).display !== 'none',
            exportVisible:getComputedStyle(toolbar.querySelector('#panoramaExportBtn')).display !== 'none',
            atBottom:toolbar.closest('#imageEditModal')?.classList.contains('image-panorama-mode'),
        }));
        assert.deepEqual(panoramaToolbarState, {ratio:'wide', resetVisible:true, exportVisible:true, atBottom:true});
        await page.locator('[data-image-edit-mode="preview"]').click();
        await page.waitForFunction(() => (
            !document.querySelector('#panoramaToggleBtn')?.hasAttribute('pressed')
            && document.querySelector('[data-image-edit-mode="preview"]')?.getAttribute('aria-selected') === 'true'
        ));
        }

        await page.evaluate(({initialUrl, nextUrl, parentUrl, referenceUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const targetNode = nodes.find(node => node.id === 't37-image-node') || {
                    id:'t37-image-node', type:'smart-image', x:260, y:210, w:520, h:330,
                    images:[
                        {url:${JSON.stringify(initialUrl)}, name:'t37-browser-probe.png', kind:'image', natural_w:1600, natural_h:1000},
                        {url:${JSON.stringify(nextUrl)}, name:'t37-browser-next.svg', kind:'image', natural_w:1200, natural_h:800}
                    ]
                };
                targetNode.runInputRefs = [
                    {url:${JSON.stringify(parentUrl)}, name:'duplicate-parent.svg', kind:'image'},
                    {url:${JSON.stringify(referenceUrl)}, name:'run-reference.svg', kind:'image'}
                ];
                nodes.splice(0, nodes.length, targetNode, {
                    id:'t37-parent-a', type:'smart-image', x:0, y:0,
                    images:[{url:${JSON.stringify(referenceUrl)}, name:'parent-match.svg', kind:'image', natural_w:1600, natural_h:1000}]
                }, {
                    id:'t37-parent-b', type:'smart-image', x:0, y:0,
                    images:[{url:${JSON.stringify(parentUrl)}, name:'parent-square.svg', kind:'image', natural_w:900, natural_h:900}]
                });
                canvas.connections = [
                    {from:'t37-parent-a', to:'t37-image-node', kind:'input'},
                    {from:'t37-parent-b', to:'t37-image-node', kind:'flow'}
                ];
                openImageEditor('t37-image-node', 0);
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {initialUrl:tinyPng, nextUrl:secondImage, parentUrl:parentImage, referenceUrl:referenceImage});
        await page.waitForTimeout(200);
        const compareAvailability = await page.evaluate(() => ({
            display:getComputedStyle(document.querySelector('#compareToggleBtn')).display,
        }));
        assert.notEqual(compareAvailability.display, 'none', JSON.stringify({compareAvailability,pageErrors}));
        await page.locator('#compareToggleBtn').click();
        await page.waitForFunction(() => document.querySelector('#previewStage')?.classList.contains('compare-on'));
        const compareState = await page.evaluate(matchingUrl => ({
            selectedMatchingParent:document.querySelector('#previewCompareImage')?.src === matchingUrl,
            compareOn:document.querySelector('#previewStage')?.classList.contains('compare-on'),
            sourceCount:document.querySelectorAll('#compareThumbs [data-compare-idx]').length,
            pickerRole:document.querySelector('#compareThumbs')?.getAttribute('role'),
            pickerContract:document.querySelector('#compareThumbs')?.dataset.icContractStatus,
            selectedCount:document.querySelectorAll('#compareThumbs [aria-selected="true"]').length,
            choicesOwnedByPicker:[...document.querySelectorAll('#compareThumbs [data-compare-idx]')]
                .every(choice => choice.parentElement?.localName === 'ic-tabs'),
        }), referenceImage);
        assert.deepEqual(compareState, {
            selectedMatchingParent:true,
            compareOn:true,
            sourceCount:2,
            pickerRole:'tablist',
            pickerContract:'ready',
            selectedCount:1,
            choicesOwnedByPicker:true,
        });
        await page.locator('#compareThumbs [data-compare-idx="1"]').click();
        assert.equal(await page.locator('#previewCompareImage').getAttribute('src'), parentImage);
        assert.equal(await page.locator('#compareThumbs [aria-selected="true"]').count(), 1);
        await page.locator('#compareThumbs [data-compare-idx="1"]').click();
        await page.waitForFunction(() => !document.querySelector('#previewStage')?.classList.contains('compare-on'));
        assert.equal(await page.locator('#compareThumbs [aria-selected="true"]').count(), 0);

        assert.equal(await page.locator('#previewPrevBtn, #previewNextBtn').count(), 0);
        await page.evaluate(() => {
            const modal = document.querySelector('#imageEditModal');
            const originalShow = modal.show.bind(modal);
            modal.__t37ShowCalls = 0;
            modal.show = (...args) => {
                modal.__t37ShowCalls += 1;
                return originalShow(...args);
            };
            previewZoom = 1.25;
            previewPan = {x:18, y:-12};
            applyPreviewTransform();
        });
        const transformBeforeSwitch = await page.locator('#previewFrame').evaluate(el => el.style.transform);
        await page.locator('#previewGroupNextBtn').click();
        await page.waitForFunction(() => !document.querySelector('#previewStage')?.classList.contains('compare-on'));
        assert.equal(await page.locator('#previewCurrentImage').getAttribute('src'), secondImage);
        assert.equal(await page.locator('#previewGroupNavCount').textContent(), '2 / 2');
        assert.equal(await page.locator('#previewFrame').evaluate(el => el.style.transform), transformBeforeSwitch);
        assert.equal(await page.locator('#imageEditModal').evaluate(modal => modal.__t37ShowCalls), 0);
        await page.locator('#compareToggleBtn').click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#compareThumbs')).display !== 'none');
        const noRatioMatchState = await page.evaluate(() => ({
            compareOn:document.querySelector('#previewStage')?.classList.contains('compare-on'),
            thumbnailCount:document.querySelectorAll('#compareThumbs [data-compare-idx]').length,
            selectedThumbnailCount:document.querySelectorAll('#compareThumbs [aria-pressed="true"]').length,
            indexCount:document.querySelectorAll('#compareThumbs .compare-thumb-index').length,
            thumbnailTags:[...document.querySelectorAll('#compareThumbs [data-compare-idx]')].map(element => element.localName),
        }));
        assert.deepEqual(noRatioMatchState, {
            compareOn:false,
            thumbnailCount:2,
            selectedThumbnailCount:0,
            indexCount:0,
            thumbnailTags:['button','button'],
        });
        const compareThumbnailLayout = await page.evaluate(() => {
            const toggle = document.querySelector('#compareToggleBtn');
            const thumbs = document.querySelector('#compareThumbs');
            const thumbnail = thumbs.querySelector('.compare-thumb');
            const toggleRect = toggle.getBoundingClientRect();
            const thumbRect = thumbnail.getBoundingClientRect();
            const thumbsStyle = getComputedStyle(thumbs);
            return {
                toggleHeight:Math.round(toggleRect.height),
                thumbWidth:Math.round(thumbRect.width),
                thumbHeight:Math.round(thumbRect.height),
                containerPadding:thumbsStyle.padding,
                containerBorderWidth:thumbsStyle.borderTopWidth,
                containerBackground:thumbsStyle.backgroundColor,
            };
        });
        assert.equal(compareThumbnailLayout.thumbWidth, compareThumbnailLayout.thumbHeight, JSON.stringify(compareThumbnailLayout));
        assert.equal(compareThumbnailLayout.thumbHeight, compareThumbnailLayout.toggleHeight, JSON.stringify(compareThumbnailLayout));
        assert.equal(compareThumbnailLayout.containerPadding, '0px', JSON.stringify(compareThumbnailLayout));
        assert.equal(compareThumbnailLayout.containerBorderWidth, '0px', JSON.stringify(compareThumbnailLayout));
        assert.equal(compareThumbnailLayout.containerBackground, 'rgba(0, 0, 0, 0)', JSON.stringify(compareThumbnailLayout));
        await page.locator('#compareThumbs [data-compare-idx="0"]').click();
        await page.waitForFunction(() => document.querySelector('#previewStage')?.classList.contains('compare-on'));
        const selectedThumbnailStyle = await page.locator('#compareThumbs [data-compare-idx="0"]').evaluate(thumbnail => {
            const probe = document.createElement('span');
            probe.style.border = 'var(--ui-border-width-strong) solid var(--ui-color-border-selected)';
            document.body.appendChild(probe);
            const actual = getComputedStyle(thumbnail);
            const expected = getComputedStyle(probe);
            const result = {
                borderWidth:actual.borderTopWidth,
                borderColor:actual.borderTopColor,
                expectedBorderWidth:expected.borderTopWidth,
                expectedBorderColor:expected.borderTopColor,
            };
            probe.remove();
            return result;
        });
        assert.equal(selectedThumbnailStyle.borderWidth, selectedThumbnailStyle.expectedBorderWidth, JSON.stringify(selectedThumbnailStyle));
        assert.equal(selectedThumbnailStyle.borderColor, selectedThumbnailStyle.expectedBorderColor, JSON.stringify(selectedThumbnailStyle));
        await page.locator('#previewGroupNextBtn').focus();
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => document.querySelector('#previewGroupNavCount')?.textContent.trim() === '1 / 2');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'previewGroupNextBtn');
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('#previewGroupNavCount')?.textContent.trim() === '2 / 2');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'previewGroupNextBtn');

        await page.locator('[data-image-edit-mode="crop"]').click();
        await page.waitForFunction(() => (
            document.querySelector('#imageEditModeTabs')?.value === 'crop'
            && !document.querySelector('#imageCropTools')?.hidden
        ));
        const cropState = await page.evaluate(() => ({
            mode:document.querySelector('#imageEditModeTabs')?.value,
            cropToolbar:document.querySelector('#imageCropTools')?.localName,
            cropRatio:document.querySelector('#cropRatioTabs')?.value,
            applyButton:document.querySelector('#imageEditApplyBtn')?.localName,
        }));
        assert.deepEqual(cropState, {
            mode:'crop',
            cropToolbar:'ic-toolbar',
            cropRatio:'adaptive',
            applyButton:'ic-button',
        });
        await page.waitForTimeout(600);
        await page.locator('#cropRatioTabs button[data-value="4:3"]').click();
        await page.waitForFunction(() => document.querySelector('#cropRatioTabs')?.value === '4:3');
        await page.waitForFunction(ratio => {
            const box = document.querySelector('#cropBox');
            return Math.abs(parseFloat(box?.style.width || 0) / Math.max(1, parseFloat(box?.style.height || 0)) - ratio) < .01;
        }, 4 / 3);
        const firstFourThreeBox = await page.locator('#cropBox').boundingBox();
        await page.locator('#cropRatioTabs button[data-value="9:16"]').click();
        await page.waitForFunction(() => document.querySelector('#cropRatioTabs')?.value === '9:16');
        await page.waitForFunction(ratio => {
            const box = document.querySelector('#cropBox');
            return Math.abs(parseFloat(box?.style.width || 0) / Math.max(1, parseFloat(box?.style.height || 0)) - ratio) < .01;
        }, 9 / 16);
        await page.locator('#cropRatioTabs button[data-value="4:3"]').click();
        await page.waitForFunction(() => document.querySelector('#cropRatioTabs')?.value === '4:3');
        await page.waitForFunction(ratio => {
            const box = document.querySelector('#cropBox');
            return Math.abs(parseFloat(box?.style.width || 0) / Math.max(1, parseFloat(box?.style.height || 0)) - ratio) < .01;
        }, 4 / 3);
        const secondFourThreeBox = await page.locator('#cropBox').boundingBox();
        assert.ok(Math.abs(firstFourThreeBox.width - secondFourThreeBox.width) <= 1, JSON.stringify({firstFourThreeBox, secondFourThreeBox}));
        assert.ok(Math.abs(firstFourThreeBox.height - secondFourThreeBox.height) <= 1, JSON.stringify({firstFourThreeBox, secondFourThreeBox}));
        const cropVisualState = await page.locator('#imageEditWorkbench').evaluate(workbench => {
            const picker = workbench.querySelector('#cropRatioTabs');
            const buttons = [...picker.shadowRoot.querySelectorAll('button[data-value]')];
            const tools = workbench.shadowRoot.querySelector('[part="tools"]');
            const surface = workbench.shadowRoot.querySelector('[part="surface"]');
            const cropCanvas = document.querySelector('#cropCanvas');
            const cropBox = document.querySelector('#cropBox');
            const northwest = cropBox.querySelector('[data-crop-handle="nw"]');
            const rect = element => {
                const bounds = element.getBoundingClientRect();
                return {
                    top:Math.round(bounds.top),
                    right:Math.round(bounds.right),
                    bottom:Math.round(bounds.bottom),
                    left:Math.round(bounds.left),
                    width:Math.round(bounds.width),
                    height:Math.round(bounds.height),
                };
            };
            return {
                variant:picker.getAttribute('data-component-variant'),
                buttonRects:buttons.map(rect),
                glyphDisplays:buttons.map(button => getComputedStyle(button.querySelector('.glyph')).display),
                tools:rect(tools),
                surface:rect(surface),
                canvas:rect(cropCanvas),
                box:rect(cropBox),
                boxBorderColor:getComputedStyle(cropBox).borderTopColor,
                boxOutlineColor:getComputedStyle(cropBox).outlineColor,
                gridLineCount:cropBox.querySelectorAll('.crop-grid-line').length,
                shadeRects:[...document.querySelectorAll('[data-crop-shade]')].map(rect),
                shadeDisplays:[...document.querySelectorAll('[data-crop-shade]')].map(shade => getComputedStyle(shade).display),
                northwestBackground:getComputedStyle(northwest).backgroundColor,
                northwestBorderTopWidth:getComputedStyle(northwest).borderTopWidth,
                northwestBorderLeftWidth:getComputedStyle(northwest).borderLeftWidth,
            };
        });
        assert.equal(cropVisualState.variant, 'toolbar');
        assert.ok(cropVisualState.buttonRects.every(rect => rect.height === 32), JSON.stringify(cropVisualState));
        assert.ok(cropVisualState.buttonRects.every(rect => rect.top >= cropVisualState.tools.top && rect.bottom <= cropVisualState.tools.bottom), JSON.stringify(cropVisualState));
        assert.ok(cropVisualState.buttonRects.every(rect => rect.top >= cropVisualState.surface.top && rect.bottom <= cropVisualState.surface.bottom), JSON.stringify(cropVisualState));
        assert.ok(cropVisualState.glyphDisplays.every(display => display === 'none'), JSON.stringify(cropVisualState));
        assert.equal(cropVisualState.boxBorderColor, 'rgba(255, 255, 255, 0.96)');
        assert.equal(cropVisualState.boxOutlineColor, 'rgba(0, 0, 0, 0.42)');
        assert.equal(cropVisualState.gridLineCount, 4);
        assert.ok(cropVisualState.shadeDisplays.every(display => display === 'block'), JSON.stringify(cropVisualState));
        assert.ok(cropVisualState.shadeRects.some(rect => rect.width > 0 && rect.height > 0), JSON.stringify(cropVisualState));
        assert.equal(cropVisualState.northwestBackground, 'rgba(0, 0, 0, 0)');
        assert.equal(cropVisualState.northwestBorderTopWidth, '2px');
        assert.equal(cropVisualState.northwestBorderLeftWidth, '2px');
        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-crop.png'), fullPage:true });
        }
        await page.locator('[data-image-edit-mode="crop"]').focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#imageEditModeTabs').evaluate(tabs => tabs.value), 'crop');
        await page.locator('#imageEditCancelBtn').click();
        await page.waitForFunction(() => (
            document.querySelector('#imageEditModal')?.open
            && document.querySelector('#imageEditModeTabs')?.value === 'preview'
        ));
        const cancelState = await page.evaluate(() => ({
            stillOpen:document.querySelector('#imageEditModal')?.open,
            mode:document.querySelector('#imageEditModeTabs')?.value,
            previewActionsHidden:document.querySelector('#imagePreviewActions')?.hidden,
            commitActionsHidden:document.querySelector('#imageEditCommitActions')?.hidden,
        }));
        assert.deepEqual(cancelState, {
            stillOpen:true,
            mode:'preview',
            previewActionsHidden:false,
            commitActionsHidden:true,
        });

        await page.locator('[data-image-edit-mode="mask"]').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModeTabs')?.value === 'mask');
        const maskVisualState = await page.locator('#cropCanvas').evaluate(cropCanvas => {
            const frame = getComputedStyle(cropCanvas, '::after');
            const drawCanvas = cropCanvas.querySelector('#editDrawCanvas');
            return {
                frameContent:frame.content,
                frameBorderColor:frame.borderTopColor,
                framePointerEvents:frame.pointerEvents,
                drawFilter:getComputedStyle(drawCanvas).filter,
                shadeDisplays:[...cropCanvas.querySelectorAll('[data-crop-shade]')].map(shade => getComputedStyle(shade).display),
            };
        });
        assert.equal(maskVisualState.frameContent, '""');
        assert.equal(maskVisualState.frameBorderColor, 'rgba(255, 255, 255, 0.94)');
        assert.equal(maskVisualState.framePointerEvents, 'none');
        assert.match(maskVisualState.drawFilter, /drop-shadow/);
        assert.ok(maskVisualState.shadeDisplays.every(display => display === 'none'), JSON.stringify(maskVisualState));
        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-mask.png'), fullPage:true });
        }
        await page.locator('#imageEditCancelBtn').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModeTabs')?.value === 'preview');

        await page.locator('[data-image-edit-mode="brush"]').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModeTabs')?.value === 'brush');
        await page.locator('#paintBrushColor').evaluate(async colorField => {
            colorField.setColor('#18a957');
            await colorField.updateComplete;
            colorField.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true}));
        });
        await page.locator('#paintBrushSize').evaluate(async slider => {
            slider.value = '80';
            slider.setAttribute('value', '80');
            await slider.updateComplete;
            slider.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true}));
        });
        const brushAlignmentState = await page.locator('#imageEditWorkbench').evaluate(workbench => {
            const tools = workbench.shadowRoot.querySelector('[part="tools"]');
            const slider = workbench.querySelector('#paintBrushSize');
            const sliderTrack = slider.shadowRoot.querySelector('[part="track"]');
            const sliderThumb = slider.shadowRoot.querySelector('[part~="thumb"]');
            const brushValue = workbench.querySelector('#paintBrushSizeValue');
            const colorField = workbench.querySelector('#paintBrushColor');
            const colorInput = colorField.shadowRoot.querySelector('[part~="form-control-input"]');
            const colorTrigger = colorField.shadowRoot.querySelector('[part~="trigger"]');
            const confirmBase = workbench.querySelector('#imageEditApplyBtn').shadowRoot.querySelector('[part="base"]');
            const buttons = [...workbench.querySelectorAll('#imageBrushTools [data-brush-tool]')];
            const rect = element => {
                const bounds = element.getBoundingClientRect();
                return {
                    top:Math.round(bounds.top),
                    bottom:Math.round(bounds.bottom),
                    height:Math.round(bounds.height),
                    centerY:Math.round((bounds.top + bounds.bottom) * 10) / 20,
                };
            };
            return {
                tools:rect(tools),
                slider:rect(slider),
                sliderTrack:rect(sliderTrack),
                sliderThumb:rect(sliderThumb),
                sliderThumbRight:Math.round(sliderThumb.getBoundingClientRect().right),
                brushValueLeft:Math.round(brushValue.getBoundingClientRect().left),
                buttons:buttons.map(rect),
                icons:buttons.map(button => button.getAttribute('icon')),
                buttonBackgrounds:buttons.map(button => getComputedStyle(button.shadowRoot.querySelector('[part="base"]')).backgroundColor),
                buttonColors:buttons.map(button => getComputedStyle(button.shadowRoot.querySelector('[part="base"]')).color),
                confirmBackground:getComputedStyle(confirmBase).backgroundColor,
                confirmColor:getComputedStyle(confirmBase).color,
                colorInputSize:[Math.round(colorInput.getBoundingClientRect().width), Math.round(colorInput.getBoundingClientRect().height)],
                colorTriggerSize:[Math.round(colorTrigger.getBoundingClientRect().width), Math.round(colorTrigger.getBoundingClientRect().height)],
                colorValue:colorField.value,
                colorTriggerColor:getComputedStyle(colorTrigger).color,
                colorTriggerFill:getComputedStyle(colorTrigger, '::before').backgroundColor,
                customIconStatuses:buttons.slice(3).map(button => button.querySelector('ic-icon')?.dataset.iconStatus),
                customIconPathCounts:buttons.slice(3).map(button => button.querySelector('ic-icon')?.shadowRoot.querySelectorAll('path').length),
                iconStrokeWidths:buttons.map(button => getComputedStyle(button.querySelector('ic-icon')?.shadowRoot.querySelector('svg')).strokeWidth),
                toolbarText:workbench.querySelector('#imageBrushTools')?.textContent.replace(/\s+/g, ' ').trim(),
                sizeValue:workbench.querySelector('#paintBrushSizeValue')?.textContent.trim(),
                sliderPartMarginBlockStart:getComputedStyle(sliderTrack.parentElement).marginBlockStart,
            };
        });
        assert.deepEqual(brushAlignmentState.icons, ['pencil', 'rectangle-horizontal', 'circle', 'number-label', 'text-label']);
        assert.ok(alphaFromColor(brushAlignmentState.buttonBackgrounds[0]) > 0, JSON.stringify(brushAlignmentState.buttonBackgrounds));
        assert.ok(brushAlignmentState.buttonBackgrounds.slice(1).every(color => alphaFromColor(color) === 0), JSON.stringify(brushAlignmentState.buttonBackgrounds));
        assert.equal(brushAlignmentState.buttonBackgrounds[0], brushAlignmentState.confirmBackground);
        assert.equal(brushAlignmentState.buttonColors[0], brushAlignmentState.confirmColor);
        assert.deepEqual(brushAlignmentState.colorInputSize, [32, 32]);
        assert.deepEqual(brushAlignmentState.colorTriggerSize, [32, 32]);
        assert.equal(brushAlignmentState.colorValue, '#18a957');
        assert.equal(brushAlignmentState.colorTriggerColor, 'rgb(24, 169, 87)');
        assert.equal(brushAlignmentState.colorTriggerFill, 'rgb(24, 169, 87)');
        assert.deepEqual(brushAlignmentState.customIconStatuses, ['ready', 'ready']);
        assert.deepEqual(brushAlignmentState.customIconPathCounts, [2, 2]);
        assert.ok(brushAlignmentState.iconStrokeWidths.every(width => width === brushAlignmentState.iconStrokeWidths[0]), JSON.stringify(brushAlignmentState.iconStrokeWidths));
        assert.doesNotMatch(brushAlignmentState.toolbarText, /标注工具/);
        assert.equal(brushAlignmentState.sizeValue, '80');
        assert.ok(Math.abs(brushAlignmentState.sliderTrack.centerY - brushAlignmentState.tools.centerY) <= 1, JSON.stringify(brushAlignmentState));
        assert.ok(Math.abs(brushAlignmentState.sliderThumb.centerY - brushAlignmentState.tools.centerY) <= 1, JSON.stringify(brushAlignmentState));
        assert.ok(brushAlignmentState.brushValueLeft >= brushAlignmentState.sliderThumbRight, JSON.stringify(brushAlignmentState));
        assert.ok(brushAlignmentState.buttons.every(button => Math.abs(button.centerY - brushAlignmentState.tools.centerY) <= 1), JSON.stringify(brushAlignmentState));
        assert.ok(Number.parseFloat(brushAlignmentState.sliderPartMarginBlockStart) > 0, brushAlignmentState);
        await page.locator('#imageBrushTools [data-brush-tool="free"]').hover();
        await page.waitForFunction(() => document.querySelector('#imageEditModal > ic-tooltip[open]'));
        const brushTooltipState = await page.locator('#imageEditModal > ic-tooltip[open]').evaluate(tooltip => {
            const surface = tooltip.shadowRoot.querySelector('[part="surface"]');
            const bounds = surface.getBoundingClientRect();
            return {
                parent:tooltip.parentElement?.id,
                zIndex:getComputedStyle(surface).zIndex,
                visible:bounds.width > 0 && bounds.height > 0,
                text:surface.textContent.trim(),
            };
        });
        assert.equal(brushTooltipState.parent, 'imageEditModal');
        assert.equal(brushTooltipState.zIndex, '120');
        assert.equal(brushTooltipState.visible, true);
        assert.ok(brushTooltipState.text.length > 0, brushTooltipState);
        const drawBounds = await page.locator('#editDrawCanvas').boundingBox();
        await page.mouse.move(drawBounds.x + drawBounds.width * .35, drawBounds.y + drawBounds.height * .45);
        await page.mouse.down();
        await page.mouse.move(drawBounds.x + drawBounds.width * .55, drawBounds.y + drawBounds.height * .55, {steps:5});
        await page.mouse.up();
        assert.equal(await page.locator('#brushUndoBtn').isDisabled(), false);
        await page.locator('#brushUndoBtn').click();
        assert.equal(await page.locator('#brushRedoBtn').isDisabled(), false);
        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-brush.png'), fullPage:true });
        }
        await page.mouse.move(10, 10);
        await page.locator('#imageEditCancelBtn').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModeTabs')?.value === 'preview');

        await page.locator('[data-image-edit-mode="resize"]').click();
        await page.waitForFunction(() => (
            document.querySelector('#imageEditModeTabs')?.value === 'resize'
            && !document.querySelector('#imageResizeTools')?.hidden
        ));
        const resizeState = await page.locator('#imageEditWorkbench').evaluate(workbench => {
            const numberInput = workbench.querySelector('#imageResizeScaleInput');
            const numberBase = numberInput?.shadowRoot?.querySelector('[part="base"]');
            const surface = workbench.shadowRoot?.querySelector('[part="surface"]');
            const tools = workbench.shadowRoot?.querySelector('[part="tools"]');
            const rect = element => {
                const bounds = element.getBoundingClientRect();
                return {
                    top:Math.round(bounds.top),
                    bottom:Math.round(bounds.bottom),
                    height:Math.round(bounds.height),
                };
            };
            return {
                number:rect(numberInput),
                numberBase:rect(numberBase),
                surface:rect(surface),
                tools:rect(tools),
                toolsOverflowY:getComputedStyle(tools).overflowY,
            };
        });
        assert.ok(resizeState.numberBase.top >= resizeState.surface.top, JSON.stringify(resizeState));
        assert.ok(resizeState.numberBase.bottom <= resizeState.surface.bottom, JSON.stringify(resizeState));
        assert.ok(resizeState.numberBase.top >= resizeState.tools.top, JSON.stringify(resizeState));
        assert.ok(resizeState.numberBase.bottom <= resizeState.tools.bottom, JSON.stringify(resizeState));
        assert.equal(resizeState.numberBase.height, 32, JSON.stringify(resizeState));
        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-resize.png'), fullPage:true });
        }
        await page.locator('#imageEditCancelBtn').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModeTabs')?.value === 'preview');

        await page.locator('[data-image-edit-mode="grid"]').click();
        await page.waitForFunction(() => (
            document.querySelector('#imageEditModeTabs')?.value === 'grid'
            && !document.querySelector('#imageGridTools')?.hidden
        ));
        const gridState = await page.locator('#imageEditWorkbench').evaluate(workbench => {
            const surface = workbench.shadowRoot?.querySelector('[part="surface"]');
            const tools = workbench.shadowRoot?.querySelector('[part="tools"]');
            const toolbar = workbench.querySelector('#imageGridTools');
            const numberBases = ['#gridHorizontalLines', '#gridVerticalLines'].map(selector => (
                toolbar.querySelector(selector)?.shadowRoot?.querySelector('[part="base"]')
            ));
            const presetRow = toolbar.querySelector('.grid-preset-row');
            const elements = [
                toolbar.querySelector('#gridOperationControl'),
                ...toolbar.querySelectorAll('.grid-split-control:not([style*="display:none"])'),
                ...toolbar.querySelectorAll('.grid-split-control:not([style*="display:none"]) ic-button'),
                ...numberBases,
            ].filter(element => (
                element
                && getComputedStyle(element).display !== 'none'
                && element.getBoundingClientRect().height > 0
            ));
            const rect = element => {
                const bounds = element.getBoundingClientRect();
                return {
                    name:element.id || element.localName || element.className,
                    top:Math.round(bounds.top),
                    bottom:Math.round(bounds.bottom),
                    height:Math.round(bounds.height),
                };
            };
            return {
                surface:rect(surface),
                tools:rect(tools),
                toolbar:rect(toolbar),
                toolsClientWidth:tools.clientWidth,
                toolsScrollWidth:tools.scrollWidth,
                workbenchMaxWidth:getComputedStyle(workbench).maxWidth,
                wideAttribute:workbench.hasAttribute('wide'),
                toolbarDockWidth:toolbar.dataset.dockWidth,
                controls:elements.map(rect),
                presetWrap:getComputedStyle(presetRow).flexWrap,
                presetDirection:getComputedStyle(presetRow).flexDirection,
                presetAlignItems:getComputedStyle(presetRow).alignItems,
                presetChildren:[...presetRow.children].map(child => ({...rect(child), display:getComputedStyle(child).display})),
                toolbarDensity:getComputedStyle(toolbar).getPropertyValue('--ui-density-control-height').trim(),
                segmentedDensity:getComputedStyle(toolbar.querySelector('#gridOperationControl')).getPropertyValue('--ui-density-control-height').trim(),
                segmentedButtons:[...toolbar.querySelectorAll('#gridOperationControl > button')].map(button => ({
                    ...rect(button),
                    cssHeight:getComputedStyle(button).height,
                    minHeight:getComputedStyle(button).minHeight,
                    paddingBlock:getComputedStyle(button).paddingBlock,
                    lineHeight:getComputedStyle(button).lineHeight,
                })),
                overflowY:getComputedStyle(tools).overflowY,
            };
        });
        assert.equal(gridState.presetWrap, 'nowrap', JSON.stringify(gridState));
        assert.equal(gridState.wideAttribute, true, JSON.stringify(gridState));
        assert.equal(gridState.toolbarDockWidth, 'wide', JSON.stringify(gridState));
        assert.ok(gridState.toolbar.top >= gridState.tools.top, JSON.stringify(gridState));
        assert.ok(gridState.toolbar.bottom <= gridState.tools.bottom, JSON.stringify(gridState));
        assert.ok(gridState.controls.every(control => control.top >= gridState.tools.top), JSON.stringify(gridState));
        assert.ok(gridState.controls.every(control => control.bottom <= gridState.tools.bottom), JSON.stringify(gridState));
        assert.ok(gridState.toolsScrollWidth >= gridState.toolsClientWidth, JSON.stringify(gridState));
        assert.equal(gridState.overflowY, 'hidden', JSON.stringify(gridState));
        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-grid.png'), fullPage:true });
        }
        await page.locator('#imageEditCancelBtn').click();
        await page.waitForFunction(() => document.querySelector('#imageEditModeTabs')?.value === 'preview');

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes[0].images = nodes[0].images.slice(0, 1);
                openImageEditor('t37-image-node', 0, {previewSwitch:true});
            })();`;
            document.body.appendChild(script);
            script.remove();
        });
        await page.waitForFunction(() => document.querySelector('#previewGroupNavHint')?.hidden);
        const singleImageState = await page.locator('#imageEditWorkbench').evaluate(workbench => ({
            navigationHidden:workbench.querySelector('#previewGroupNavHint')?.hidden,
            width:Math.round(workbench.getBoundingClientRect().width),
        }));
        assert.equal(singleImageState.navigationHidden, true);
        assert.ok(singleImageState.width < lightState.workbenchSize[0], {singleImageState, multiImageSize:lightState.workbenchSize});

        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-light.png'), fullPage:true });
        }
        await page.evaluate(() => applyTheme('dark'));
        await page.waitForFunction(() => (
            document.documentElement.classList.contains('theme-dark')
            && document.documentElement.dataset.uiTheme === 'dark'
        ));
        await page.waitForTimeout(300);
        const darkSelectedModeState = await page.locator('[data-image-edit-mode="preview"]').evaluate(selectedMode => {
            const semanticProbe = document.createElement('span');
            semanticProbe.style.background = 'var(--ui-color-text-primary)';
            semanticProbe.style.color = 'var(--ui-color-text-on-action-primary)';
            document.body.appendChild(semanticProbe);
            const state = {
                background:getComputedStyle(selectedMode).backgroundColor,
                color:getComputedStyle(selectedMode).color,
                expectedBackground:getComputedStyle(semanticProbe).backgroundColor,
                expectedColor:getComputedStyle(semanticProbe).color,
            };
            semanticProbe.remove();
            return state;
        });
        assert.equal(darkSelectedModeState.background, darkSelectedModeState.expectedBackground);
        assert.equal(darkSelectedModeState.color, darkSelectedModeState.expectedColor);
        assert.notEqual(darkSelectedModeState.background, lightState.selectedModeBackground);
        if (screenshotDir) {
            await page.screenshot({ path:path.join(screenshotDir, 't37-image-studio-dark.png'), fullPage:true });
        }

        await page.evaluate(() => {
            render();
            const thumbnail = document.querySelector('.image-node[data-id="t37-image-node"] :is(.thumb-item,.image-wrap)');
            window.SmartCanvasModules.imageStudio.close();
            thumbnail?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true, view:window}));
        });
        await page.waitForTimeout(1000);
        const reopenState = await page.evaluate(() => {
            const modal = document.querySelector('#imageEditModal');
            return {
                open:modal?.open,
                openAttribute:modal?.hasAttribute('open'),
                openClass:modal?.classList.contains('open'),
                imageSource:document.querySelector('#cropImage')?.getAttribute('src') || '',
                thumbnailExists:Boolean(document.querySelector('.image-node[data-id="t37-image-node"] :is(.thumb-item,.image-wrap)')),
            };
        });
        assert.ok(reopenState.open && reopenState.openClass && reopenState.imageSource, JSON.stringify(reopenState));
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.open);
        await page.evaluate(() => {
            render();
            const modal = document.querySelector('#imageEditModal');
            modal.classList.add('open');
            const thumbnail = document.querySelector('.image-node[data-id="t37-image-node"] :is(.thumb-item,.image-wrap)');
            thumbnail?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true, view:window}));
        });
        await page.waitForTimeout(500);
        const staleClassReopenState = await page.evaluate(() => {
            const modal = document.querySelector('#imageEditModal');
            return {
                open:modal?.open,
                openAttribute:modal?.hasAttribute('open'),
                openClass:modal?.classList.contains('open'),
                imageSource:document.querySelector('#cropImage')?.getAttribute('src') || '',
            };
        });
        assert.ok(staleClassReopenState.open && staleClassReopenState.openClass && staleClassReopenState.imageSource, JSON.stringify(staleClassReopenState));
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.open);
        const canvasZoomAfterEditorState = await page.evaluate(() => {
            const modal = document.querySelector('#imageEditModal');
            modal.classList.add('open');
            const script = document.createElement('script');
            script.textContent = `(() => {
                const before = viewport.scale;
                shell.dispatchEvent(new WheelEvent('wheel', {
                    bubbles:true,
                    cancelable:true,
                    clientX:Math.round(shell.clientWidth / 2),
                    clientY:Math.round(shell.clientHeight / 2),
                    ctrlKey:true,
                    deltaY:-120,
                }));
                window.__t37CanvasZoomAfterEditor = {
                    before,
                    after:viewport.scale,
                    studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
                    modalOwnsWheel:smartModalOwnsWheel(),
                    composerFocused:composer?.classList.contains('focused') || false,
                    blockingModal:Boolean(document.querySelector('.log-modal.open,.shortcut-modal.open,.smart-context-result-backdrop:not([hidden]),.reference-viewer-backdrop:not([hidden])')),
                    effectiveTool:smartEffectiveTool(),
                };
            })();`;
            document.body.appendChild(script);
            script.remove();
            modal.classList.remove('open');
            return window.__t37CanvasZoomAfterEditor;
        });
        assert.equal(canvasZoomAfterEditorState.studioOpen, false, JSON.stringify(canvasZoomAfterEditorState));
        assert.notEqual(canvasZoomAfterEditorState.after, canvasZoomAfterEditorState.before, JSON.stringify(canvasZoomAfterEditorState));
        for (const mode of ['grid', 'resize']) {
            await page.evaluate(nextMode => {
                const script = document.createElement('script');
                script.textContent = `window.SmartCanvasModules.imageStudio.open({nodeId:'t37-image-node', imageIndex:0, mode:${JSON.stringify(nextMode)}, groupAware:false});`;
                document.body.appendChild(script);
                script.remove();
            }, mode);
            await page.waitForFunction(nextMode => (
                document.querySelector('#imageEditModal')?.open
                && document.querySelector('#imageEditModeTabs')?.value === nextMode
            ), mode);
            await page.getByRole('button', {name:'Close', exact:true}).click();
            await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.open);
            const modeExitZoomState = await page.evaluate(nextMode => {
                const script = document.createElement('script');
                script.textContent = `(() => {
                    const before = viewport.scale;
                    shell.dispatchEvent(new WheelEvent('wheel', {
                        bubbles:true,
                        cancelable:true,
                        ctrlKey:true,
                        clientX:Math.round(shell.clientWidth / 2),
                        clientY:Math.round(shell.clientHeight / 2),
                        deltaY:-120,
                    }));
                    window.__t37ModeExitZoom = {
                        mode:${JSON.stringify(nextMode)},
                        before,
                        after:viewport.scale,
                        studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
                    };
                })();`;
                document.body.appendChild(script);
                script.remove();
                return window.__t37ModeExitZoom;
            }, mode);
            assert.equal(modeExitZoomState.studioOpen, false, JSON.stringify(modeExitZoomState));
            assert.notEqual(modeExitZoomState.after, modeExitZoomState.before, JSON.stringify(modeExitZoomState));
        }
        await page.evaluate(() => {
            window.SmartCanvasModules.imageStudio.open({nodeId:'t37-image-node',imageIndex:0,mode:'crop',groupAware:false});
            finishImageStudioCommit('t37-image-node', 0);
        });
        await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.open);
        const acceptedCloseState = await page.evaluate(() => ({
            studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
            selectedId,
            selectedImage:{...selectedImage},
            cropStateCleared:cropState === null,
        }));
        assert.deepEqual(acceptedCloseState, {
            studioOpen:false,
            selectedId:'t37-image-node',
            selectedImage:{nodeId:'t37-image-node',index:0},
            cropStateCleared:true,
        });
        const targetedMutationState = await page.evaluate(imageUrl => {
            nodes.splice(0, nodes.length, ...Array.from({length:105}, (_, index) => ({
                id:`t37-target-${index}`,
                type:'smart-image',
                x:120 + (index % 15) * 54,
                y:120 + Math.floor(index / 15) * 54,
                w:48,
                h:48,
                images:[{url:imageUrl,name:`before-${index}.png`,kind:'image',natural_w:48,natural_h:48}]
            })));
            selectedId = 't37-target-0';
            selectedIds = [];
            render();
            const before = new Map(
                [...document.querySelectorAll('.image-node[data-id^="t37-target-"]')]
                    .map(element => [element.dataset.id, element])
            );
            const targetBefore = before.get('t37-target-0');
            const mutationStartedAt = performance.now();
            window.SmartCanvasModules.canvasMutation.update({
                nodeId:'t37-target-0',
                mutate(node){ node.images[0].name = 'after.png'; },
                options:{imageIndex:0,save:false}
            });
            const stableIds = [...before.keys()].filter(id => id !== 't37-target-0');
            const unchangedSameIdentity = stableIds.every(
                id => document.querySelector(`.image-node[data-id="${id}"]`) === before.get(id)
            );
            const targetAfter = document.querySelector('.image-node[data-id="t37-target-0"]');
            const targetSelectedAfterUpdate = targetAfter?.classList.contains('selected') || false;
            const source = nodes[0];
            const maskNode = window.SmartCanvasModules.canvasMutation.create({
                kind:'image',
                data:{images:[{url:imageUrl,name:'mask.png',kind:'image',role:'mask'}]},
                options:{
                    placement:{anchor:{kind:'source',sourceNodeId:source.id},relation:'downstream',arrangement:'single'},
                    reveal:false,
                    save:false
                }
            });
            const sourceRect = nodeRect(source);
            const maskRect = nodeRect(maskNode);
            return {
                visibleNodeCount:before.size,
                unchangedSameIdentity,
                targetWasReplaced:targetAfter !== targetBefore,
                targetSelected:targetSelectedAfterUpdate,
                maskSelected:selectedId === maskNode.id,
                sourceImageCount:source.images.length,
                maskImageCount:maskNode.images.length,
                maskRole:maskNode.images[0]?.role || '',
                maskIsDownstream:maskRect.x >= sourceRect.x + sourceRect.width,
                noBusinessConnection:(canvas.connections || []).every(connection => (
                    connection.from !== maskNode.id && connection.to !== maskNode.id
                )),
                updateDurationMs:performance.now() - mutationStartedAt,
            };
        }, tinyPng);
        assert.ok(targetedMutationState.visibleNodeCount >= 100, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.unchangedSameIdentity, true, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.targetWasReplaced, true, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.targetSelected, true, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.maskSelected, true, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.sourceImageCount, 1, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.maskImageCount, 1, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.maskRole, 'mask', JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.maskIsDownstream, true, JSON.stringify(targetedMutationState));
        assert.equal(targetedMutationState.noBusinessConnection, true, JSON.stringify(targetedMutationState));
        const pixelPerformanceState = await page.evaluate(() => {
            const canvasEl = editDrawCanvas();
            const sizeBaselines = [[1024,1024],[2048,2048],[3840,2160]].map(([width,height]) => {
                canvasEl.width = width;
                canvasEl.height = height;
                resetEditDrawingHistory();
                const startedAt = performance.now();
                pushEditDrawHistory();
                return {
                    size:[width,height],
                    snapshotDurationMs:performance.now() - startedAt,
                    snapshotBytes:editDrawSnapshotBytes(editDrawUndoStack[0]),
                };
            });
            canvasEl.width = 3840;
            canvasEl.height = 2160;
            resetEditDrawingHistory();
            const snapshotStartedAt = performance.now();
            for(let index = 0; index < 3; index++) pushEditDrawHistory();
            const snapshotDurationMs = performance.now() - snapshotStartedAt;
            const historyBytes = editDrawUndoStack.reduce(
                (total,snapshot) => total + editDrawSnapshotBytes(snapshot),
                0
            );
            const ctx = canvasEl.getContext('2d');
            const originalGetImageData = ctx.getImageData.bind(ctx);
            let moveReadbackCount = 0;
            ctx.getImageData = (...args) => {
                moveReadbackCount += 1;
                return originalGetImageData(...args);
            };
            imageEditMode = 'mask';
            editDrawState = {x:100,y:100,sx:100,sy:100,pointerId:1,snapshot:null};
            const strokeStartedAt = performance.now();
            for(let index = 1; index <= 120; index++){
                strokeFreeDrawPoint({x:100 + index * 8,y:100 + (index % 12) * 6});
            }
            const strokeDurationMs = performance.now() - strokeStartedAt;
            editDrawState = null;
            ctx.getImageData = originalGetImageData;
            return {
                canvas:[canvasEl.width,canvasEl.height],
                sizeBaselines,
                historyCount:editDrawUndoStack.length,
                historyBytes,
                budget:EDIT_DRAW_HISTORY_BYTE_BUDGET,
                snapshotDurationMs,
                strokeDurationMs,
                moveReadbackCount,
            };
        });
        assert.deepEqual(pixelPerformanceState.canvas, [3840,2160]);
        assert.deepEqual(pixelPerformanceState.sizeBaselines.map(entry => entry.size), [
            [1024,1024],
            [2048,2048],
            [3840,2160],
        ]);
        assert.ok(pixelPerformanceState.historyCount <= 2, JSON.stringify(pixelPerformanceState));
        assert.ok(pixelPerformanceState.historyBytes <= pixelPerformanceState.budget, JSON.stringify(pixelPerformanceState));
        assert.equal(pixelPerformanceState.moveReadbackCount, 0, JSON.stringify(pixelPerformanceState));
        assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
        console.log(JSON.stringify({ lightState, compareState, cropState, cropVisualState, cancelState, maskVisualState, brushAlignmentState, brushTooltipState, resizeState, gridState, singleImageState, darkSelectedModeState, acceptedCloseState, targetedMutationState, pixelPerformanceState }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
