const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser = null;

(async () => {
    browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/dialog-case.html`, {waitUntil:'networkidle'});
    await page.waitForFunction(() => document.documentElement.dataset.dialogCaseStatus === 'ready', null, {timeout:10000}).catch(async error => {
        const state = await page.evaluate(() => ({status:document.documentElement.dataset.dialogCaseStatus, contract:[...document.querySelectorAll('ic-ai-processor-dialog')].map(dialog => ({status:dialog.dataset.icContractStatus, reason:dialog.dataset.icContractReason}))}));
        throw new Error(`${error.message}; state=${JSON.stringify(state)}; pageErrors=${JSON.stringify(pageErrors)}`);
    });

    await page.locator('#reverse-prompt-dialog').evaluate(async dialog => {
        dialog.processor = 'outpaint';
        dialog.sourceWidth = 720;
        dialog.sourceHeight = 1100;
        dialog.groups = [];
        dialog.models = [{id:'image-model', name:'Image Model'}];
        await dialog.show();
    });
    const outpaintDefault = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        open:dialog.open,
        size:dialog.size,
        dialogWidth:Math.round(dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect().width),
        dialogHeight:Math.round(dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect().height),
        handleCount:dialog.querySelectorAll('[data-outpaint-handle]').length,
        resolution:dialog.querySelector('[data-outpaint-resolution]')?.textContent.trim(),
        prompt:dialog.prompt,
        confirmDisabled:dialog.confirmAction.disabled,
        hasWhite:Boolean(dialog.querySelector('[data-fill-color="#ffffff"]')),
        hasBlack:Boolean(dialog.querySelector('[data-fill-color="#000000"]')),
        hasCustom:Boolean(dialog.querySelector('ic-color-field[name="outpaint-custom-color"]')),
        fieldLabelCount:dialog.querySelectorAll('.ai-processor-field-label').length,
        emptyStateCount:dialog.querySelectorAll('[data-ai-processor-empty]').length,
        ratioValue:dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]')?.ratio,
        outputResolution:dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]')?.resolution,
        ratioPresets:dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]')?.getAttribute('ratio-presets'),
        outputResolutions:dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]')?.getAttribute('resolutions'),
        ratioVariant:dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]')?.getAttribute('ratio-variant'),
        headerPaddingTop:getComputedStyle(dialog.shadowRoot.querySelector('[part="header"]')).paddingTop,
    }));
    assert.deepEqual(outpaintDefault, {
        open:true,
        size:'large',
        dialogWidth:1152,
        dialogHeight:768,
        handleCount:8,
        resolution:'720 × 1100',
        prompt:'Remove the solid-color area and fill the scene',
        confirmDisabled:true,
        hasWhite:true,
        hasBlack:true,
        hasCustom:true,
        fieldLabelCount:0,
        emptyStateCount:0,
        ratioValue:'adaptive',
        outputResolution:'auto',
        ratioPresets:'adaptive,source,1:1,2:3,3:2,3:4,4:3,9:16,16:9,21:9,9:21',
        outputResolutions:'auto,1k,2k,4k',
        ratioVariant:'outpaint',
        headerPaddingTop:'24px',
    });
    const customColorDefault = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const white = dialog.querySelector('[data-fill-color="#ffffff"]').getBoundingClientRect();
        const black = dialog.querySelector('[data-fill-color="#000000"]').getBoundingClientRect();
        const option = dialog.querySelector('[data-custom-color-option]');
        const custom = option.querySelector('ic-color-field');
        const optionRect = option.getBoundingClientRect();
        const whiteStyle = getComputedStyle(dialog.querySelector('[data-fill-color="#ffffff"]'));
        return {
            whiteSize:[Math.round(white.width),Math.round(white.height)],
            blackSize:[Math.round(black.width),Math.round(black.height)],
            customSize:[Math.round(optionRect.width),Math.round(optionRect.height)],
            visibleLabel:getComputedStyle(custom.shadowRoot.querySelector('[part~="form-control-label"]')).display,
            hintBackground:getComputedStyle(option.querySelector('[data-custom-color-hint]')).backgroundImage,
            hasCustomColor:option.dataset.hasCustomColor,
            selected:option.dataset.selected,
            whiteSelectedBoxShadow:whiteStyle.boxShadow,
            whiteSelectedOutline:whiteStyle.outlineStyle,
        };
    });
    assert.deepEqual(customColorDefault.whiteSize, customColorDefault.blackSize, JSON.stringify(customColorDefault));
    assert.deepEqual(customColorDefault.customSize, customColorDefault.whiteSize, JSON.stringify(customColorDefault));
    assert.equal(customColorDefault.visibleLabel, 'none', JSON.stringify(customColorDefault));
    assert.notEqual(customColorDefault.hintBackground, 'none', JSON.stringify(customColorDefault));
    assert.equal(customColorDefault.hasCustomColor, 'false', JSON.stringify(customColorDefault));
    assert.equal(customColorDefault.selected, 'false', JSON.stringify(customColorDefault));
    assert.equal(customColorDefault.whiteSelectedBoxShadow.includes('inset'), true, JSON.stringify(customColorDefault));
    assert.equal(customColorDefault.whiteSelectedOutline, 'none', JSON.stringify(customColorDefault));
    const customColorSelected = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const custom = dialog.querySelector('ic-color-field[name="outpaint-custom-color"]');
        custom.value = '#ff3366';
        custom.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
        const option = dialog.querySelector('[data-custom-color-option]');
        return {
            fillColor:dialog.fillColor,
            customFillColor:dialog.customFillColor,
            hasCustomColor:option.dataset.hasCustomColor,
            selected:option.dataset.selected,
            hintDisplay:getComputedStyle(option.querySelector('[data-custom-color-hint]')).display,
            selectedBoxShadow:getComputedStyle(option).boxShadow,
            selectedOutline:getComputedStyle(option).outlineStyle,
        };
    });
    assert.equal(customColorSelected.fillColor, '#ff3366');
    assert.equal(customColorSelected.customFillColor, '#ff3366');
    assert.equal(customColorSelected.hasCustomColor, 'true');
    assert.equal(customColorSelected.selected, 'true');
    assert.equal(customColorSelected.hintDisplay, 'none');
    assert.equal(customColorSelected.selectedBoxShadow.includes('inset'), true, JSON.stringify(customColorSelected));
    assert.equal(customColorSelected.selectedOutline, 'none', JSON.stringify(customColorSelected));
    await page.waitForFunction(() => document.querySelector('#reverse-prompt-dialog [data-outpaint-frame]')?.getBoundingClientRect().height > 0);
    const outpaintAspect = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const frame = dialog.querySelector('[data-outpaint-frame]').getBoundingClientRect();
        const image = dialog.querySelector('[data-outpaint-source]').getBoundingClientRect();
        const stage = dialog.querySelector('[data-outpaint-stage]').getBoundingClientRect();
        const guidance = dialog.querySelector('[data-outpaint-guidance]').getBoundingClientRect();
        const panel = dialog.querySelector('[data-ai-processor-panel]').getBoundingClientRect();
        const column = dialog.querySelector('[data-outpaint-canvas-column]').getBoundingClientRect();
        const stageStyle = getComputedStyle(dialog.querySelector('[data-outpaint-stage]'));
        const settings = dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]');
        settings.open = true;
        const picker = settings.shadowRoot.querySelector('ic-aspect-ratio-picker');
        const automatic = picker.shadowRoot.querySelector('[data-value="source"]').getBoundingClientRect();
        const square = picker.shadowRoot.querySelector('[data-value="1:1"]').getBoundingClientRect();
        const modelField = dialog.querySelector('ic-select[name="ai-processor-model"]').closest('.ai-processor-field').getBoundingClientRect();
        const settingsField = settings.closest('.ai-processor-field').getBoundingClientRect();
        const promptField = dialog.querySelector('ic-textarea[name="outpaint-prompt"]').closest('ic-form-field').getBoundingClientRect();
        const promptHeading = dialog.querySelector('[data-outpaint-prompt-heading]').getBoundingClientRect();
        const promptTitle = dialog.querySelector('[data-outpaint-prompt-heading] .ai-processor-option-title').getBoundingClientRect();
        const templatePicker = dialog.querySelector('[data-outpaint-prompt-heading] ic-select[name="ai-processor-group"]');
        const templatePickerRect = templatePicker.getBoundingClientRect();
        settings.open = false;
        return {
            frame:frame.width / frame.height,
            image:image.width / image.height,
            guidanceGap:guidance.top-stage.bottom,
            stageHeight:stage.height,
            unusedColumnHeight:column.height-stage.height-guidance.height-(guidance.top-stage.bottom),
            panelHeight:panel.height,
            stageBackgroundImage:stageStyle.backgroundImage,
            automaticSize:[Math.round(automatic.width), Math.round(automatic.height)],
            squareSize:[Math.round(square.width), Math.round(square.height)],
            modelFieldTop:Math.round(modelField.top),
            settingsFieldTop:Math.round(settingsField.top),
            outputFieldsBottom:Math.round(Math.max(modelField.bottom, settingsField.bottom)),
            promptTop:Math.round(promptField.top),
            promptHeadingTop:Math.round(promptHeading.top),
            promptHeadingBottom:Math.round(promptHeading.bottom),
            promptTitleLeft:Math.round(promptTitle.left),
            templatePickerLeft:Math.round(templatePickerRect.left),
            promptTitleCenter:Math.round(promptTitle.top + promptTitle.height / 2),
            templatePickerCenter:Math.round(templatePickerRect.top + templatePickerRect.height / 2),
            templatePickerLabel:templatePicker.getAttribute('label'),
            templatePickerAriaLabel:templatePicker.getAttribute('aria-label'),
            templatePickerValue:templatePicker.value,
        };
    });
    assert.ok(Math.abs(outpaintAspect.frame - 720 / 1100) < .02, JSON.stringify(outpaintAspect));
    assert.ok(Math.abs(outpaintAspect.image - 720 / 1100) < .02, JSON.stringify(outpaintAspect));
    assert.ok(outpaintAspect.guidanceGap <= 12, JSON.stringify(outpaintAspect));
    assert.ok(outpaintAspect.stageHeight > 500, JSON.stringify(outpaintAspect));
    assert.ok(Math.abs(outpaintAspect.unusedColumnHeight) <= 2, JSON.stringify(outpaintAspect));
    assert.ok(Math.abs(outpaintAspect.panelHeight - (outpaintAspect.stageHeight + 28)) < 40, JSON.stringify(outpaintAspect));
    assert.notEqual(outpaintAspect.stageBackgroundImage, 'none', JSON.stringify(outpaintAspect));
    assert.deepEqual(outpaintAspect.automaticSize, outpaintAspect.squareSize, JSON.stringify(outpaintAspect));
    assert.ok(Math.abs(outpaintAspect.modelFieldTop - outpaintAspect.settingsFieldTop) <= 2, JSON.stringify(outpaintAspect));
    assert.ok(outpaintAspect.promptHeadingTop > outpaintAspect.outputFieldsBottom, JSON.stringify(outpaintAspect));
    assert.ok(outpaintAspect.promptTop > outpaintAspect.promptHeadingBottom, JSON.stringify(outpaintAspect));
    assert.ok(outpaintAspect.templatePickerLeft > outpaintAspect.promptTitleLeft, JSON.stringify(outpaintAspect));
    assert.ok(Math.abs(outpaintAspect.promptTitleCenter - outpaintAspect.templatePickerCenter) <= 2, JSON.stringify(outpaintAspect));
    assert.equal(outpaintAspect.templatePickerLabel, null, JSON.stringify(outpaintAspect));
    assert.equal(outpaintAspect.templatePickerAriaLabel, '提示词模板（可选）', JSON.stringify(outpaintAspect));
    assert.equal(outpaintAspect.templatePickerValue, '', JSON.stringify(outpaintAspect));
    await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const settings = dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]');
        settings.dispatchEvent(new CustomEvent('ic-change', {bubbles:true, composed:true, detail:{field:'ratio', value:'1:1'}}));
        settings.dispatchEvent(new CustomEvent('ic-change', {bubbles:true, composed:true, detail:{field:'resolution', value:'2k'}}));
    });
    const squareOutpaint = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        ratio:dialog.outpaintAspectRatio,
        outputResolution:dialog.outpaintResolution,
        resolution:dialog.querySelector('[data-outpaint-resolution]')?.textContent.trim(),
        outpaint:{...dialog.outpaint},
        detail:dialog.detail(),
    }));
    assert.equal(squareOutpaint.ratio, '1:1');
    assert.equal(squareOutpaint.outputResolution, '2k');
    assert.equal(squareOutpaint.detail.outpaintResolution, '2k');
    assert.equal(squareOutpaint.resolution, '1100 × 1100');
    assert.deepEqual(
        [squareOutpaint.outpaint.left, squareOutpaint.outpaint.right, squareOutpaint.outpaint.top, squareOutpaint.outpaint.bottom],
        [190, 190, 0, 0],
    );
    const lockedSquare = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const frame = dialog.querySelector('[data-outpaint-frame]').getBoundingClientRect();
        const target = dialog.outpaintSize();
        const scale = Math.min(frame.width / target.width, frame.height / target.height);
        dialog.drag = {handle:'right', pointerId:1, x:0, y:0, start:{...dialog.outpaint}};
        dialog.moveOutpaintDrag({clientX:120 * scale, clientY:0});
        dialog.drag = null;
        const changed = dialog.outpaintSize();
        return {
            selected:dialog.outpaintAspectRatio,
            picker:dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]')?.ratio,
            ratio:changed.width / changed.height,
            resolution:dialog.querySelector('[data-outpaint-resolution]')?.textContent.trim(),
        };
    });
    assert.equal(lockedSquare.selected, '1:1');
    assert.equal(lockedSquare.picker, '1:1');
    assert.ok(Math.abs(lockedSquare.ratio - 1) < .001, JSON.stringify(lockedSquare));
    assert.equal(lockedSquare.resolution, '1220 × 1220');
    const outpaintExpanded = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        dialog.outpaint = {left:50, right:75, top:20, bottom:30, atLimit:false};
        dialog.outpaintAspectRatio = 'adaptive';
        dialog.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]').ratio = 'adaptive';
        dialog.syncOutpaintVisual();
        dialog.syncActions();
        return {
            resolution:dialog.querySelector('[data-outpaint-resolution]')?.textContent.trim(),
            confirmDisabled:dialog.confirmAction.disabled,
        };
    });
    assert.deepEqual(outpaintExpanded, {resolution:'845 × 1150', confirmDisabled:false});
    await page.locator('#reverse-prompt-dialog').evaluate(dialog => dialog.hide('test'));
    await page.waitForFunction(() => document.querySelector('#reverse-prompt-dialog')?.open === false);

    await page.locator('#reverse-prompt-dialog').evaluate(async dialog => {
        dialog.processor = 'angle-control';
        dialog.models = [{id:'image-model', name:'Image Model'}];
        await dialog.show();
    });
    await page.waitForFunction(() => Boolean(document.querySelector('#reverse-prompt-dialog [data-angle-viewport] canvas')));
    const angleDefault = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        open:dialog.open,
        size:dialog.size,
        dialogWidth:Math.round(dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect().width),
        dialogHeight:Math.round(dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect().height),
        confirmDisabled:dialog.confirmAction.disabled,
        groupCount:dialog.querySelectorAll('ic-select[name="ai-processor-group"]').length,
        canvasCount:dialog.querySelectorAll('[data-angle-viewport] canvas').length,
        command:dialog.angleState.command,
        prompt:dialog.prompt,
        bodySlack:Math.round(dialog.shadowRoot.querySelector('[part="body"]').getBoundingClientRect().height - dialog.querySelector('[data-ai-processor-layout="angle-control"]').getBoundingClientRect().height),
        bodyHeight:Math.round(dialog.shadowRoot.querySelector('[part="body"]').getBoundingClientRect().height),
        controllerHeight:Math.round(dialog.querySelector('[data-angle-controller]').getBoundingClientRect().height),
        viewportWidth:Math.round(dialog.querySelector('[data-angle-viewport]').getBoundingClientRect().width),
        controlsInPanel:Boolean(dialog.querySelector('[data-ai-processor-panel] .ai-angle-controls')),
        controlsInPreview:Boolean(dialog.querySelector('[data-angle-controller-column] .ai-angle-controls')),
        angleRatio:dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]')?.ratio,
        angleResolution:dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]')?.resolution,
        angleRatioPresets:dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]')?.getAttribute('ratio-presets'),
        angleResolutions:dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]')?.getAttribute('resolutions'),
    }));
    assert.deepEqual(angleDefault, {
        open:true,
        size:'large',
        dialogWidth:1152,
        dialogHeight:768,
        confirmDisabled:true,
        groupCount:0,
        canvasCount:1,
        command:'',
        prompt:'其他不做修改',
        bodySlack:angleDefault.bodySlack,
        bodyHeight:angleDefault.bodyHeight,
        controllerHeight:angleDefault.controllerHeight,
        viewportWidth:angleDefault.viewportWidth,
        controlsInPanel:true,
        controlsInPreview:false,
        angleRatio:'source',
        angleResolution:'auto',
        angleRatioPresets:'source,square,portrait,landscape,portrait43,landscape43,story,wide,ultrawide',
        angleResolutions:'auto,1k,2k,4k',
    });
    assert.ok(angleDefault.bodySlack <= 48, JSON.stringify(angleDefault));
    assert.ok(angleDefault.controllerHeight > 550, JSON.stringify(angleDefault));
    assert.ok(angleDefault.bodyHeight - angleDefault.controllerHeight <= 48, JSON.stringify(angleDefault));
    assert.ok(angleDefault.viewportWidth > 650, JSON.stringify(angleDefault));

    const angleControlLayout = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const model = dialog.querySelector('ic-select[name="ai-processor-model"]');
        const settings = dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]');
        const prompt = dialog.querySelector('[data-angle-prompt]');
        const modelField = model.closest('.ai-processor-field');
        const settingsField = settings.closest('.ai-processor-field');
        const copy = dialog.querySelector('.ai-angle-control-copy');
        const reset = dialog.querySelector('[data-angle-reset-horizontal]');
        const slider = dialog.querySelector('[data-angle-horizontal]');
        const header = dialog.shadowRoot.querySelector('[part="header"]');
        const modelControlRect = model.shadowRoot.querySelector('[part~="combobox"]').getBoundingClientRect();
        const settingsRect = settings.getBoundingClientRect();
        const promptRect = prompt.getBoundingClientRect();
        const promptTextareaRect = prompt.shadowRoot.querySelector('[part="textarea"]').getBoundingClientRect();
        const panel = dialog.querySelector('[data-ai-processor-panel]');
        const modelFieldRect = modelField.getBoundingClientRect();
        const settingsFieldRect = settingsField.getBoundingClientRect();
        const copyRect = copy.getBoundingClientRect();
        const resetRect = reset.getBoundingClientRect();
        const sliderStyle = getComputedStyle(slider);
        return {
            modelFieldTop:Math.round(modelFieldRect.top),
            settingsFieldTop:Math.round(settingsFieldRect.top),
            modelControlTop:Math.round(modelControlRect.top),
            settingsControlTop:Math.round(settingsRect.top),
            promptTop:Math.round(promptRect.top),
            promptTextareaHeight:Math.round(promptTextareaRect.height),
            outputFieldsBottom:Math.round(Math.max(modelFieldRect.bottom, settingsFieldRect.bottom)),
            panelFitsWithoutScroll:panel.scrollHeight <= panel.clientHeight + 1,
            panelScrollHeight:panel.scrollHeight,
            panelClientHeight:panel.clientHeight,
            copyCenter:Math.round(copyRect.top + copyRect.height / 2),
            resetCenter:Math.round(resetRect.top + resetRect.height / 2),
            sliderPaddingInline:[sliderStyle.paddingLeft, sliderStyle.paddingRight],
            headerPaddingTop:getComputedStyle(header).paddingTop,
        };
    });
    assert.ok(Math.abs(angleControlLayout.modelFieldTop - angleControlLayout.settingsFieldTop) <= 2, JSON.stringify(angleControlLayout));
    assert.ok(Math.abs(angleControlLayout.modelControlTop - angleControlLayout.settingsControlTop) <= 2, JSON.stringify(angleControlLayout));
    assert.ok(angleControlLayout.promptTop > angleControlLayout.outputFieldsBottom, JSON.stringify(angleControlLayout));
    assert.equal(angleControlLayout.promptTextareaHeight, 112, JSON.stringify(angleControlLayout));
    assert.equal(angleControlLayout.panelFitsWithoutScroll, true, JSON.stringify(angleControlLayout));
    assert.ok(Math.abs(angleControlLayout.copyCenter - angleControlLayout.resetCenter) <= 2, JSON.stringify(angleControlLayout));
    assert.deepEqual(angleControlLayout.sliderPaddingInline, ['12px','12px'], JSON.stringify(angleControlLayout));
    assert.equal(angleControlLayout.headerPaddingTop, '24px', JSON.stringify(angleControlLayout));

    const anglePickerLayout = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const settings = dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]');
        settings.open = true;
        const picker = settings.shadowRoot.querySelector('ic-aspect-ratio-picker');
        const source = picker.shadowRoot.querySelector('[data-value="source"]').getBoundingClientRect();
        const square = picker.shadowRoot.querySelector('[data-value="square"]').getBoundingClientRect();
        settings.open = false;
        return {source:[Math.round(source.width),Math.round(source.height)], square:[Math.round(square.width),Math.round(square.height)]};
    });
    assert.deepEqual(anglePickerLayout.source, anglePickerLayout.square, JSON.stringify(anglePickerLayout));

    const angleSizeSelection = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const picker = dialog.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]');
        picker.dispatchEvent(new CustomEvent('ic-change', {bubbles:true, composed:true, detail:{field:'ratio', value:'portrait'}}));
        picker.dispatchEvent(new CustomEvent('ic-change', {bubbles:true, composed:true, detail:{field:'resolution', value:'2k'}}));
        return {ratio:dialog.angleAspectRatio, resolution:dialog.angleResolution, detail:dialog.detail()};
    });
    assert.equal(angleSizeSelection.ratio, 'portrait');
    assert.equal(angleSizeSelection.resolution, '2k');
    assert.equal(angleSizeSelection.detail.angleAspectRatio, 'portrait');
    assert.equal(angleSizeSelection.detail.angleResolution, '2k');

    const defaultPromptAfterAngleChange = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const horizontal = dialog.querySelector('[data-angle-horizontal]');
        horizontal.value = '20';
        horizontal.setAttribute('value', '20');
        return dialog.angleController.update().prompt;
    });
    assert.equal(defaultPromptAfterAngleChange.endsWith('其他不做修改'), true, defaultPromptAfterAngleChange);
    assert.equal(defaultPromptAfterAngleChange.indexOf('Camera:') < defaultPromptAfterAngleChange.indexOf('其他不做修改'), true, defaultPromptAfterAngleChange);

    const controllerUpdate = await page.locator('#reverse-prompt-dialog').evaluate(dialog => {
        const prompt = dialog.querySelector('[data-angle-prompt]');
        prompt.value = 'Keep this user-authored line';
        prompt.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
        const distance = dialog.querySelector('[data-angle-distance]');
        distance.value = '5';
        distance.setAttribute('value', '5');
        return {detail:dialog.angleController.update(), sliderValue:distance.value, state:{...dialog.angleState}};
    });
    assert.equal(Number(controllerUpdate.sliderValue), 5);
    assert.equal(controllerUpdate.detail.command.includes('Medium long shot'), true, JSON.stringify(controllerUpdate));
    const angleChanged = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        prompt:dialog.prompt,
        confirmDisabled:dialog.confirmAction.disabled,
    }));
    assert.equal(angleChanged.prompt.includes('Keep this user-authored line'), true);
    assert.equal(angleChanged.prompt.includes('Medium long shot'), true);
    assert.equal(angleChanged.confirmDisabled, false);

    const angleControllerDisposed = await page.locator('#reverse-prompt-dialog').evaluate(async dialog => {
        await dialog.hide('accepted');
        return {
            open:dialog.open,
            controller:dialog.angleController,
            canvasCount:dialog.querySelectorAll('[data-angle-viewport] canvas').length,
        };
    });
    assert.deepEqual(angleControllerDisposed, {open:false, controller:null, canvasCount:0});

    await page.locator('#reverse-prompt-dialog').evaluate(dialog => dialog.show());
    await page.waitForFunction(() => Boolean(document.querySelector('#reverse-prompt-dialog[open] [data-angle-viewport] canvas')));
    await page.locator('#reverse-prompt-dialog [data-ic-ai-processor-owned="cancel"]').click();
    await page.waitForFunction(() => document.querySelector('#reverse-prompt-dialog')?.open === false);
    const cancelDisposed = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        controller:dialog.angleController,
        canvasCount:dialog.querySelectorAll('[data-angle-viewport] canvas').length,
    }));
    assert.deepEqual(cancelDisposed, {controller:null, canvasCount:0});

    await page.locator('#reverse-prompt-dialog').evaluate(dialog => dialog.show());
    await page.waitForFunction(() => Boolean(document.querySelector('#reverse-prompt-dialog[open] [data-angle-viewport] canvas')));
    await page.locator('#reverse-prompt-dialog').evaluate(dialog => dialog.shadowRoot.querySelector('[part="close-button"]').click());
    await page.waitForFunction(() => document.querySelector('#reverse-prompt-dialog')?.open === false);
    const closeButtonDisposed = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        controller:dialog.angleController,
        canvasCount:dialog.querySelectorAll('[data-angle-viewport] canvas').length,
    }));
    assert.deepEqual(closeButtonDisposed, {controller:null, canvasCount:0});

    await page.locator('#reverse-prompt-dialog').evaluate(dialog => dialog.show());
    await page.waitForFunction(() => Boolean(document.querySelector('#reverse-prompt-dialog[open] [data-angle-viewport] canvas')));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#reverse-prompt-dialog')?.open === false);
    const escapeDisposed = await page.locator('#reverse-prompt-dialog').evaluate(dialog => ({
        controller:dialog.angleController,
        canvasCount:dialog.querySelectorAll('[data-angle-viewport] canvas').length,
    }));
    assert.deepEqual(escapeDisposed, {controller:null, canvasCount:0});

    await browser.close();
    console.log('AI processor preset dialog browser smoke passed.');
})().catch(async error => {
    console.error(error);
    await browser?.close();
    process.exitCode = 1;
});
