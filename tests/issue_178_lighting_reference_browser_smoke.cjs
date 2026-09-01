const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sharp = require('sharp');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

async function changedPixelRatio(first, second, channelThreshold=8) {
    const [a, b] = await Promise.all([
        sharp(first).removeAlpha().raw().toBuffer({resolveWithObject:true}),
        sharp(second).removeAlpha().raw().toBuffer({resolveWithObject:true})
    ]);
    assert.deepEqual(a.info, b.info, '灯光预览对比帧必须使用相同尺寸和通道');
    let changed = 0;
    let totalDelta = 0;
    const pixels = a.info.width * a.info.height;
    for(let index=0; index<a.data.length; index+=a.info.channels) {
        const delta = Math.max(
            Math.abs(a.data[index] - b.data[index]),
            Math.abs(a.data[index + 1] - b.data[index + 1]),
            Math.abs(a.data[index + 2] - b.data[index + 2])
        );
        totalDelta += delta;
        if(delta >= channelThreshold) changed += 1;
    }
    return {ratio:changed / pixels, meanDelta:totalDelta / pixels};
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const context = await browser.newContext({acceptDownloads:true, viewport:{width:1600,height:1000}});
    if(process.env.ISSUE_178_THEME) {
        await context.addInitScript(theme => localStorage.setItem('studio_theme', theme), process.env.ISSUE_178_THEME);
    }
    const page = await context.newPage();
    let downloadCount = 0;
    page.on('download', () => { downloadCount += 1; });
    const browserErrors = [];
    const failedResources = [];
    page.on('pageerror', error => browserErrors.push(String(error?.stack || error)));
    page.on('console', message => { if(message.type()==='error') browserErrors.push(message.text()); });
    page.on('response', response => { if(response.status() >= 400) failedResources.push({status:response.status(),url:response.url()}); });
    page.on('requestfailed', request => failedResources.push({failure:request.failure()?.errorText,url:request.url()}));
    let uploadRequests = 0;
    await page.route('**/api/ai/upload', async route => {
        uploadRequests += 1;
        await route.abort();
    });
    try {
        await page.goto(`${baseUrl}/static/smart-canvas.html?manual=1&id=issue-178-lighting-reference`, {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));
        await page.waitForLoadState('networkidle');
        await page.evaluate(({imageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                const id='lighting-source';
                nodes.splice(0,nodes.length,{id,type:'smart-image',x:220,y:180,w:320,h:240,images:[{url:${JSON.stringify(imageUrl)},name:'source.png',kind:'image',natural_w:1,natural_h:1}]});
                if(!canvas) canvas={id:'issue-178-lighting-reference',title:'Issue 178',nodes,connections:[],logs:[],settings:{}};
                canvas.nodes=nodes; canvas.connections=[];
                selectedId=id; selectedIds=[]; selectedImage={nodeId:id,index:0};
                viewport.x=0; viewport.y=0; viewport.scale=1;
                render(); syncSmartNodeFloatingPortal();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng});
        await page.evaluate(async () => {
            window.SmartCanvasModules.canvasPersistence.schedule({delay:0});
            await window.SmartCanvasModules.canvasPersistence.synced({timeout:5000});
        });

        await page.waitForTimeout(800);
        const portalDiagnostic = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({html:portal.innerHTML,menuHtml:portal.dataset.menuHtml,open:portal.classList.contains('open')}));
        assert.ok(portalDiagnostic.html.includes('data-smart-node-action="lighting-reference"'), JSON.stringify({portalDiagnostic,browserErrors},null,2));
        const toolbarOrder = await page.locator('#smartNodeFloatingPortal [data-smart-node-action]').evaluateAll(actions => actions.map(action => action.dataset.smartNodeAction));
        assert.equal(toolbarOrder.indexOf('lighting-reference'), toolbarOrder.indexOf('angle-control') + 1, JSON.stringify(toolbarOrder));
        await page.locator('#smartNodeFloatingPortal [data-smart-node-action="lighting-reference"]').click();
        try {
            await page.waitForFunction(() => Boolean(document.querySelector('ic-ai-processor-dialog[open] [data-lighting-viewport] canvas')), null, {timeout:10000});
        } catch(error) {
            const dialogDiagnostic = await page.locator('ic-ai-processor-dialog').evaluate(dialog => ({
                open:dialog.open,
                processor:dialog.processor,
                error:dialog.error,
                errorText:dialog.querySelector('[data-ai-processor-error]')?.textContent,
                controller:Boolean(dialog.lightingController),
                root:Boolean(dialog.querySelector('[data-lighting-controller]'))
            }));
            throw new Error(JSON.stringify({message:error.message,dialogDiagnostic,browserErrors,failedResources},null,2));
        }

        const initial = await page.locator('ic-ai-processor-dialog').evaluate(dialog => ({
            processor:dialog.processor,
            controller:Boolean(dialog.lightingController),
            promptZh:dialog.querySelector('[data-lighting-prompt-zh]').value,
            promptEn:dialog.querySelector('[data-lighting-prompt-en]').value,
            sourceContext:Boolean(dialog.querySelector('[data-lighting-source-context]')),
            left:Boolean(dialog.querySelector('[data-lighting-controller-column]')),
            right:Boolean(dialog.querySelector('[data-ai-processor-panel]')),
            confirmDisabled:dialog.confirmAction.disabled
        }));
        assert.deepEqual(initial, {
            processor:'lighting-reference',
            controller:true,
            promptZh:initial.promptZh,
            promptEn:initial.promptEn,
            sourceContext:true,
            left:true,
            right:true,
            confirmDisabled:false
        });
        assert.match(initial.promptZh, /画面左侧/);
        assert.match(initial.promptEn, /image-left/);
        assert.match(initial.promptEn, /one dominant, unseen off-camera warm-neutral-white key/);
        assert.doesNotMatch(initial.promptEn, /(?:azimuth|elevation|4200K|8°|-2 EV|camera-left)/);
        const removedHelperCopy = await page.locator('ic-ai-processor-dialog').evaluate(dialog => ({
            text:dialog.textContent,
            hasSourceCaption:Boolean(dialog.querySelector('[data-lighting-source-context] figcaption'))
        }));
        for(const copy of [
            '选择一个 Prompt 权威值',
            '相机相对坐标；负方位角始终在左侧',
            '相对于当前场景的 EV',
            '来源图 · 仅作视觉上下文',
            '同一状态固定生成，不调用模型'
        ]) assert.doesNotMatch(removedHelperCopy.text, new RegExp(copy));
        assert.equal(removedHelperCopy.hasSourceCaption, false);

        const shadowSwitchLayout = await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
            const row = dialog.querySelector('.ai-lighting-switch-row');
            const title = row?.querySelector('#ai-lighting-casts-shadow-label');
            const control = row?.querySelector('ic-switch[data-lighting-casts-shadow]');
            const optionTitle = dialog.querySelector('.ai-lighting-control-copy span:first-child');
            const titleRect = title?.getBoundingClientRect();
            const controlRect = control?.getBoundingClientRect();
            return {
                text:title?.textContent?.trim(),
                titleFirst:row?.firstElementChild === title,
                switchLast:row?.lastElementChild === control,
                titleFontSize:title ? getComputedStyle(title).fontSize : '',
                optionFontSize:optionTitle ? getComputedStyle(optionTitle).fontSize : '',
                horizontal:Boolean(titleRect && controlRect && titleRect.right < controlRect.left),
                centerDelta:titleRect && controlRect
                    ? Math.abs((titleRect.top + titleRect.height / 2) - (controlRect.top + controlRect.height / 2))
                    : Infinity
            };
        });
        assert.equal(shadowSwitchLayout.text, '开启投影');
        assert.equal(shadowSwitchLayout.titleFirst, true);
        assert.equal(shadowSwitchLayout.switchLast, true);
        assert.equal(shadowSwitchLayout.titleFontSize, shadowSwitchLayout.optionFontSize);
        assert.equal(shadowSwitchLayout.horizontal, true);
        assert.ok(shadowSwitchLayout.centerDelta <= 1, `开启投影标题与 Switch 必须垂直居中：${JSON.stringify(shadowSwitchLayout)}`);

        const textFieldSizes = await page.locator('ic-ai-processor-dialog').evaluate(dialog =>
            [...dialog.querySelectorAll('[data-ai-processor-layout="lighting-reference"] :is(ic-number-input,ic-color-field,ic-textarea)')]
                .map(field => ({tag:field.localName,label:field.label,size:field.getAttribute('size')}))
        );
        assert.ok(textFieldSizes.length >= 9, JSON.stringify(textFieldSizes));
        assert.ok(
            textFieldSizes.every(field => field.size === 'small'),
            `灯光参考的所有 Text Field 必须使用 Small：${JSON.stringify(textFieldSizes)}`
        );

        const lightingSpacing = await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
            const controls = getComputedStyle(dialog.querySelector('.ai-lighting-controls'));
            const option = getComputedStyle(dialog.querySelector('.ai-lighting-control-row'));
            return {
                groupRowGap:controls.rowGap,
                groupColumnGap:controls.columnGap,
                optionRowGap:option.rowGap,
                optionColumnGap:option.columnGap
            };
        });
        assert.deepEqual(lightingSpacing, {
            groupRowGap:'24px',
            groupColumnGap:'24px',
            optionRowGap:'4px',
            optionColumnGap:'8px'
        });

        const directionHeadingAlignment = await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
            const heading = dialog.querySelector('#ai-lighting-direction-heading')?.getBoundingClientRect();
            const reset = dialog.querySelector('[data-lighting-reset-direction]')?.getBoundingClientRect();
            return heading && reset
                ? {headingCenter:heading.top + heading.height / 2, resetCenter:reset.top + reset.height / 2}
                : null;
        });
        assert.ok(directionHeadingAlignment, '主光方向标题与重置按钮必须存在');

        const sliderAlignment = await page.locator('ic-ai-processor-dialog').evaluate(dialog =>
            [...dialog.querySelectorAll('.ai-lighting-control-row')].map(row => {
                const rowRect = row.getBoundingClientRect();
                const sliderRect = row.querySelector('ic-slider')?.shadowRoot?.querySelector('[part~="track"]')?.getBoundingClientRect();
                return {
                    left:sliderRect ? Math.abs(sliderRect.left - rowRect.left) : Infinity,
                    right:sliderRect ? Math.abs(sliderRect.right - rowRect.right) : Infinity
                };
            })
        );
        assert.ok(sliderAlignment.length >= 6, JSON.stringify(sliderAlignment));
        const headingAligned = Math.abs(directionHeadingAlignment.headingCenter - directionHeadingAlignment.resetCenter) <= 1;
        const slidersAligned = sliderAlignment.every(alignment => alignment.left <= 1 && alignment.right <= 1);
        assert.ok(
            headingAligned && slidersAligned,
            `标题与 Slider 可见轨道必须垂直/水平对齐：${JSON.stringify({directionHeadingAlignment,sliderAlignment})}`
        );

        const preview = page.locator('ic-ai-processor-dialog [data-lighting-viewport]');
        const captureLightingPatch = async patch => {
            const state = await page.locator('ic-ai-processor-dialog').evaluate((dialog, value) => {
                const current = dialog.lightingController.state();
                dialog.lightingController.setIntent({
                    ...current,
                    lights:[{...current.lights[0], ...value}]
                });
                return dialog.lightingController.state();
            }, patch);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            return {state, frame:await preview.screenshot({animations:'disabled'})};
        };
        const hardSource = await captureLightingPatch({angular_size_degrees:0.5});
        const softSource = await captureLightingPatch({angular_size_degrees:30});
        assert.equal(hardSource.state.lights[0].angular_size_degrees, 0.5);
        assert.equal(softSource.state.lights[0].angular_size_degrees, 30);
        const dimKey = await captureLightingPatch({relative_exposure_ev:-4});
        const brightKey = await captureLightingPatch({relative_exposure_ev:4});
        const exposureVisualDelta = await changedPixelRatio(dimKey.frame, brightKey.frame);
        assert.ok(
            exposureVisualDelta.ratio >= 0.01 && exposureVisualDelta.meanDelta >= 1,
            `同一路径调整主光曝光后必须发生重绘：${JSON.stringify(exposureVisualDelta)}`
        );
        const sourceSizeVisualDelta = await changedPixelRatio(hardSource.frame, softSource.frame);
        assert.ok(
            sourceSizeVisualDelta.ratio >= 0.01 && sourceSizeVisualDelta.meanDelta >= 1,
            `表观光源尺寸从 0.5° 调到 30° 后，左侧预览应出现可见的高光与阴影软硬变化：${JSON.stringify(sourceSizeVisualDelta)}`
        );
        await captureLightingPatch({angular_size_degrees:8, relative_exposure_ev:0});

        const colorMode = page.locator('ic-ai-processor-dialog ic-segmented-control[data-lighting-color-mode]');
        assert.equal(await colorMode.count(), 1, '颜色模式必须使用公共 Segmented Control');
        assert.equal(await colorMode.getAttribute('size'), 'small');
        await colorMode.locator('button[data-value="rgb"]').click();
        await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog [data-lighting-controller]')?.dataset.lightingColorMode === 'rgb');
        const rgbField = page.locator('ic-ai-processor-dialog ic-color-field[name="ai-lighting-rgb"]');
        assert.equal(await rgbField.count(), 1, 'RGB 颜色控件必须具备有效的表单 name');
        const colorTrigger = rgbField.locator('#trigger');
        assert.equal(await colorTrigger.isEnabled(), true, 'RGB 颜色 Trigger 必须可交互');
        await colorTrigger.click();
        await page.waitForFunction(() => {
            const field=document.querySelector('ic-ai-processor-dialog ic-color-field[name="ai-lighting-rgb"]');
            return Boolean(field?.shadowRoot?.querySelector('wa-popup')?.active);
        });
        const popupRect = await rgbField.evaluate(field => field.shadowRoot.querySelector('[part~="base"]').getBoundingClientRect().toJSON());
        assert.ok(popupRect.width > 0 && popupRect.height > 0, JSON.stringify(popupRect));
        await colorTrigger.click();
        await page.waitForFunction(() => {
            const field=document.querySelector('ic-ai-processor-dialog ic-color-field[name="ai-lighting-rgb"]');
            return !field?.shadowRoot?.querySelector('wa-popup')?.active;
        });

        const viewport = page.locator('[data-lighting-viewport] canvas');
        const box = await viewport.boundingBox();
        await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.48);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.35, {steps:6});
        await page.mouse.up();
        const dragged = await page.locator('ic-ai-processor-dialog').evaluate(dialog => dialog.lightingController.state());
        assert.notEqual(dragged.lights[0].azimuth_degrees, -45);
        assert.notEqual(dragged.lights[0].elevation_degrees, 35);

        const precise = await page.locator('ic-ai-processor-dialog').evaluate(dialog => {
            const input=dialog.querySelector('[data-lighting-azimuth-value]');
            input.value='-60';
            input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
            return dialog.lightingController.state();
        });
        assert.equal(precise.lights[0].azimuth_degrees, -60);
        assert.equal(precise.coordinate_space.x, 'camera_right');
        if(process.env.ISSUE_178_SCREENSHOT) {
            await page.locator('ic-ai-processor-dialog .ai-lighting-switch-row').scrollIntoViewIfNeeded();
            await page.screenshot({path:process.env.ISSUE_178_SCREENSHOT, fullPage:false});
        }
        await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="confirm"]').click();
        await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === false);
        await page.waitForFunction(() => Boolean(
            document.querySelector('#composer.open')
            && document.getElementById('promptInput')?.textContent?.includes('change only the lighting')
        ));
        const success = await page.evaluate(() => {
            const script=document.createElement('script');
            script.textContent=`(() => {
                const generation=nodes.find(node=>node.referenceGenerationKind==='image');
                const source=nodes.find(node=>node.id==='lighting-source');
                window.__issue178Success={
                    nodeCount:nodes.length,
                    generation:{id:generation?.id,title:generation?.title,kind:generation?.referenceGenerationKind,promptDraftText:generation?.promptDraftText,promptDraftHtml:generation?.promptDraftHtml,promptDraftTouched:generation?.promptDraftTouched,lightingPrompt:generation?.lightingPrompt,metadata:generation?.metadata,runSettings:generation?.runSettings,images:generation?.images},
                    sourceUrl:source?.images?.[0]?.url,
                    sourceMetadata:source?.metadata,
                    connections:canvas.connections.map(connection=>({from:connection.from,to:connection.to,kind:connection.kind}))
                };
            })();`;
            document.body.appendChild(script); script.remove();
            const dialog=document.querySelector('ic-ai-processor-dialog');
            return {...window.__issue178Success,composerOpen:document.querySelector('#composer')?.classList.contains('open'),composerPrompt:document.getElementById('promptInput')?.textContent,controller:dialog.lightingController,canvasCount:dialog.querySelectorAll('[data-lighting-viewport] canvas').length};
        });
        assert.equal(success.nodeCount, 2);
        assert.equal(success.sourceUrl, tinyPng);
        const expectedEnglishPrompt = await page.evaluate(intent => window.InfiniteCanvasLightingIntent.compileLightingPrompts(intent).en, success.generation.metadata.lightingIntent);
        assert.equal(success.generation.kind, 'image');
        assert.deepEqual(success.generation.images, []);
        assert.equal(success.generation.promptDraftText, expectedEnglishPrompt);
        assert.equal(success.generation.promptDraftTouched, true);
        assert.deepEqual(success.generation.lightingPrompt, {en:expectedEnglishPrompt});
        assert.equal(success.composerOpen, true);
        assert.equal(success.composerPrompt, expectedEnglishPrompt);
        assert.equal(downloadCount, 0);
        assert.ok(success.generation.runSettings);
        assert.equal(success.generation.metadata.lightingIntent.schema, 'ic-lighting-intent/1');
        assert.equal(success.generation.metadata.lightingIntent.compiler_version, 'lighting-prompt/2');
        assert.deepEqual(success.sourceMetadata.lightingIntent, success.generation.metadata.lightingIntent);
        assert.deepEqual(success.connections, [{from:'lighting-source',to:success.generation.id,kind:'input'}]);
        assert.equal(success.controller, null);
        assert.equal(success.canvasCount, 0);
        assert.equal(uploadRequests, 0);

        await page.evaluate(() => {
            const script=document.createElement('script');
            script.textContent=`(() => {
                selectedId='lighting-source'; selectedIds=[]; selectedImage={nodeId:'lighting-source',index:0};
                render(); syncSmartNodeFloatingPortal();
            })();`;
            document.body.appendChild(script); script.remove();
        });
        await page.locator('#smartNodeFloatingPortal [data-smart-node-action="lighting-reference"]').click();
        await page.waitForFunction(() => Boolean(document.querySelector('ic-ai-processor-dialog[open]')?.lightingController));
        const reopenedIntent = await page.locator('ic-ai-processor-dialog').evaluate(dialog => dialog.lightingController.state());
        assert.deepEqual(reopenedIntent, success.sourceMetadata.lightingIntent);
        await page.locator('ic-ai-processor-dialog [data-ic-ai-processor-owned="cancel"]').click();
        await page.waitForFunction(() => document.querySelector('ic-ai-processor-dialog')?.open === false);

        await page.evaluate(() => window.SmartCanvasModules.canvasPersistence.synced({timeout:5000}));
        const beforeUndoRevision = await page.evaluate(() => window.SmartCanvasModules.canvasPersistence.status().revision);

        await page.evaluate(() => {
            document.activeElement?.blur?.();
            const script=document.createElement('script');
            script.textContent='window.__issue178UndoTriggered=canvasMutation.history({action:\'undo\'});';
            document.body.appendChild(script); script.remove();
        });
        try {
            await page.waitForFunction(before => {
                const status=window.SmartCanvasModules.canvasPersistence.status();
                return status.revision > before && !status.pending;
            }, beforeUndoRevision, {timeout:5000});
        } catch(error) {
            const status=await page.evaluate(() => window.SmartCanvasModules.canvasPersistence.status());
            throw new Error(JSON.stringify({message:error.message,beforeUndoRevision,status,browserErrors,failedResources},null,2));
        }
        const undone = await page.evaluate(() => {
            const script=document.createElement('script');
            script.textContent='window.__issue178Undone={nodeCount:nodes.length,connectionCount:canvas.connections.length,sourceUrl:nodes[0]?.images?.[0]?.url,triggered:window.__issue178UndoTriggered,status:window.SmartCanvasModules.canvasPersistence.status()};';
            document.body.appendChild(script); script.remove();
            return window.__issue178Undone;
        });
        assert.equal(undone.triggered, true);
        assert.ok(undone.status.revision > beforeUndoRevision, JSON.stringify({beforeUndoRevision,undone}));
        assert.equal(undone.status.state, 'ready');
        // The manual WebSocket acknowledges the revert operation but intentionally
        // does not emulate the server's inverse diff, so local Nodes remain here.
        assert.equal(undone.nodeCount, 2);
        console.log('Issue #178 lighting reference browser smoke passed.');
    } finally {
        await context.close();
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
