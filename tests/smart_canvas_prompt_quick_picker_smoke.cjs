const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:3100';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: browserExecutable,
    });
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await submitLogin(page, baseUrl, smokeUsername, smokePassword);
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=prompt-quick-picker-smoke`, {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(window.SmartCanvasModules?.promptAuthoring));
    await page.waitForFunction(() => ['ready', 'error'].includes(
        document.documentElement.dataset.canvasOpeningPhase,
    ));
    await page.evaluate(({ image }) => {
        window.SmartCanvasModules.canvasOpening?.prepare?.();
        const referenceImages = [
            ...Array.from({ length: 42 }, (_, index) => ({
                url: `${image}#role-${index + 1}`,
                name: `角色 ${index + 1}`,
                kind: 'image',
            })),
            { url: `${image}#scene-one`, name: '场景 1', kind: 'image' },
        ];
        const node = {
            id: 'quick-picker-node',
            type: 'smart-image',
            x: 260,
            y: 170,
            w: 300,
            h: 220,
            title: '快捷引用验证',
            images: referenceImages,
            referenceGenerationKind: 'image',
            generationOutputNode: true,
            promptDraftHtml: '',
            promptDraftText: '',
        };
        const promptNode = {
            id: 'quick-picker-prompt-node',
            type: 'smart-prompt',
            x: 650,
            y: 170,
            w: 316,
            h: 220,
            title: '提示词节点快捷引用验证',
            text: '',
        };
        canvas = {
            id: 'prompt-quick-picker-smoke',
            title: 'Prompt quick picker smoke',
            nodes: [node, promptNode],
            connections: [{
                id: 'quick-picker-input',
                from: node.id,
                to: promptNode.id,
                kind: 'input',
            }],
            viewport: { x: 0, y: 0, scale: 1 },
            settings: {},
            logs: [],
        };
        nodes = canvas.nodes;
        selectedId = node.id;
        selectedIds = [];
        selectedImage = { nodeId: node.id, index: 0 };
        promptLibraries = [
            {
                id: 'styles',
                name: '风格库',
                categories: [
                    { id: 'real', name: '真人风格' },
                    { id: 'cg', name: '3D风格' },
                ],
                items: [
                    {
                        id: 'warm-cg',
                        name: '暖阳赛璐璐CG',
                        category: 'cg',
                        positive: 'FIRST_TEMPLATE_PROMPT',
                    },
                    {
                        id: 'handmade-3d',
                        name: '手绘质感3D动画',
                        category: 'cg',
                        positive: 'SECOND_TEMPLATE_PROMPT',
                    },
                ],
            },
        ];
        activePromptLibraryId = 'styles';
        builtinPromptTemplates = promptLibraries[0].items;
        render();
        window.SmartCanvasModules.viewportSelection.selection.refresh();
        updateComposer();
        composer.style.position = 'fixed';
        composer.style.top = '420px';
        composer.style.visibility = 'visible';
    }, { image: tinyPng });

    await page.waitForSelector('#composer.open #promptInput');
    const prompt = page.locator('#promptInput');
    await prompt.click();
    await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        editor.textContent = '/test 生成图片';
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    });
    await prompt.type(' 继续输入');
    const historicalTriggerStayedClosed = await page.locator('#mentionPicker').evaluate(
        picker => !picker.hasAttribute('open'),
    );
    if(!historicalTriggerStayedClosed){
        throw new Error('Historical / trigger unexpectedly opened the quick picker');
    }
    await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', {
            bubbles:true,
            inputType:'deleteContentBackward',
        }));
    });
    await prompt.type('@');
    await page.waitForFunction(() => document.querySelector('#mentionPicker')?.hasAttribute('open'));
    const inputMenu = await page.evaluate(() => {
        const picker = document.querySelector('#mentionPicker');
        const surface = picker.shadowRoot.querySelector('[part="surface"]');
        const content = picker.shadowRoot.querySelector('[part="listbox"]');
        const container = document.querySelector('#composer .composer-card');
        const pickerRect = surface.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        content.scrollTop = 120;
        return {
            rows: picker.shadowRoot.querySelectorAll('[part="option"]').length,
            pickerWidth: Math.round(pickerRect.width),
            containerWidth: Math.round(containerRect.width),
            pickerHeight: Math.round(pickerRect.height),
            maxHeight: Math.round(Number.parseFloat(getComputedStyle(surface).maxHeight)),
            containerTop:Math.round(containerRect.top),
            composerTop:document.querySelector('#composer').style.top,
            leftOffset: Math.round(pickerRect.left - containerRect.left),
            gap: Math.round(containerRect.top - pickerRect.bottom),
            headerPresent: Boolean(picker.shadowRoot.querySelector('.prompt-quick-header')),
            footerPresent: Boolean(picker.shadowRoot.querySelector('.prompt-quick-footer')),
            primaryTabsPresent: Boolean(picker.shadowRoot.querySelector('.prompt-quick-primary-tabs')),
            categoryTabsPresent: Boolean(picker.shadowRoot.querySelector('.prompt-quick-category-tabs')),
            contentScrollable: content.scrollHeight > content.clientHeight && content.scrollTop > 0,
        };
    });
    if (inputMenu.rows !== 43
        || inputMenu.pickerWidth !== inputMenu.containerWidth
        || inputMenu.pickerHeight !== 288
        || inputMenu.maxHeight !== 288
        || inputMenu.leftOffset !== 0
        || inputMenu.gap !== 4
        || inputMenu.headerPresent
        || inputMenu.footerPresent
        || inputMenu.primaryTabsPresent
        || inputMenu.categoryTabsPresent
        || !inputMenu.contentScrollable) {
        throw new Error(`Unexpected @ menu: ${JSON.stringify(inputMenu)}`);
    }
    const inputMenuScreenshotPath = '/tmp/smart-canvas-input-mention-menu.png';
    await page.screenshot({ path: inputMenuScreenshotPath });
    const hoverScrollState = await page.evaluate(async () => {
        const picker = document.querySelector('#mentionPicker');
        const content = picker.shadowRoot.querySelector('[part="listbox"]');
        const firstOption = picker.shadowRoot.querySelector('[part="option"][data-index="0"]');
        content.scrollTop = 120;
        const before = content.scrollTop;
        firstOption.dispatchEvent(new PointerEvent('pointerenter'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {
            before,
            after: content.scrollTop,
            firstSelected: firstOption.getAttribute('aria-selected') === 'true',
        };
    });
    if (hoverScrollState.before <= 0
        || hoverScrollState.after !== hoverScrollState.before
        || !hoverScrollState.firstSelected) {
        throw new Error(`Hover unexpectedly moved the list: ${JSON.stringify(hoverScrollState)}`);
    }
    await prompt.type('场景');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1
        && document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelector('[part="option"][data-index="0"] .name')
            ?.textContent.trim() === '场景 1'
    ));
    const inputSearchState = await page.evaluate(() => {
        const picker = document.querySelector('#mentionPicker');
        return {
            queryText: document.querySelector('#promptInput').textContent,
            resultNames: [...picker.shadowRoot.querySelectorAll('[part="option"] .name')]
                .map(element => element.textContent.trim()),
        };
    });
    await page.locator('#mentionPicker').locator('[part="option"]').first().click();
    await page.waitForFunction(() => nodes[0]?.manualInputRefs?.length === 1);
    const attachmentState = await page.evaluate(() => ({
        promptText: document.querySelector('#promptInput').textContent,
        attachmentCount: nodes[0]?.manualInputRefs?.length || 0,
        thumbCount: document.querySelectorAll('#inputThumbsRow .input-thumb').length,
        mentionCount: document.querySelectorAll('#promptInput .mention-image-token').length,
        mentionInstanceId: document.querySelector('#promptInput .mention-image-token')?.dataset.inputInstanceId || '',
        attachmentInstanceId: nodes[0]?.manualInputRefs?.[0]?.inputInstanceId || '',
    }));
    if (inputSearchState.queryText !== '@场景'
        || inputSearchState.resultNames.join('|') !== '场景 1'
        || attachmentState.promptText.includes('@')
        || attachmentState.attachmentCount !== 1
        || attachmentState.thumbCount < 1
        || attachmentState.mentionCount !== 1
        || !attachmentState.mentionInstanceId
        || attachmentState.mentionInstanceId !== attachmentState.attachmentInstanceId) {
        throw new Error(`Unexpected attachment state: ${JSON.stringify({ inputSearchState, attachmentState })}`);
    }
    await prompt.click();
    await prompt.type('@');
    await page.waitForFunction(() => {
        const picker = document.querySelector('#mentionPicker');
        const options = [...(picker?.shadowRoot?.querySelectorAll('[part="option"]') || [])];
        return options.length === 43
            && options.slice(0, 2).every((option, index) => option.querySelector('.media-badge')?.textContent.trim() === `图片${index + 1}`);
    });
    const referencedPickerState = await page.evaluate(() => {
        const options = [...document.querySelector('#mentionPicker').shadowRoot.querySelectorAll('[part="option"]')];
        const badges = options.slice(0, 2).map(option => option.querySelector('.media-badge'));
        const referencedRects = options.slice(0, 2).map(option => option.getBoundingClientRect());
        return {
            labels:options.slice(0, 3).map(option => option.querySelector('.name')?.textContent.trim()),
            badges:badges.map(badge => badge?.textContent.trim() || ''),
            rowMajor:Math.abs(referencedRects[0].top - referencedRects[1].top) <= 1
                && referencedRects[1].left > referencedRects[0].right,
            compactWidth:referencedRects.every(rect => Math.abs(rect.width - 65) <= 1),
            square:referencedRects.every(rect => Math.abs(rect.width - rect.height) <= 1),
            cover:options.slice(0, 2).every(option => getComputedStyle(option.querySelector('.media img')).objectFit === 'cover'),
            badgeBottom:badges.every((badge, index) => {
                const badgeRect = badge.getBoundingClientRect();
                const optionRect = options[index].getBoundingClientRect();
                return Math.abs(badgeRect.left - optionRect.left) <= 1
                    && Math.abs(badgeRect.right - optionRect.right) <= 1
                    && Math.abs(badgeRect.bottom - optionRect.bottom) <= 1
                    && Math.abs(badgeRect.height - 14) <= 1;
            }),
        };
    });
    const referencedOption = page.locator('#mentionPicker').locator('[part="option"]').nth(1);
    await referencedOption.hover();
    const referencedHoverState = await referencedOption.evaluate(option => ({
        label:option.querySelector('.media-copy .name')?.textContent.trim() || '',
        opacity:getComputedStyle(option.querySelector('.media-copy')).opacity,
    }));
    await referencedOption.click();
    await page.waitForFunction(() => !document.querySelector('#mentionPicker')?.hasAttribute('open'));
    const duplicateSelectionState = await page.evaluate(() => ({
        attachmentCount:nodes[0]?.manualInputRefs?.length || 0,
        mentionCount:document.querySelectorAll('#promptInput .mention-image-token').length,
        promptHasTrigger:document.querySelector('#promptInput').textContent.includes('@'),
    }));
    if (referencedPickerState.labels.slice(0, 2).join('|') !== '图片1|图片2'
        || referencedPickerState.badges.join('|') !== '图片1|图片2'
        || !referencedPickerState.rowMajor
        || !referencedPickerState.compactWidth
        || !referencedPickerState.square
        || !referencedPickerState.cover
        || !referencedPickerState.badgeBottom
        || referencedHoverState.label !== '图片2'
        || referencedHoverState.opacity !== '1'
        || duplicateSelectionState.attachmentCount !== 1
        || duplicateSelectionState.mentionCount !== 2
        || duplicateSelectionState.promptHasTrigger) {
        throw new Error(`Unexpected referenced picker state: ${JSON.stringify({ referencedPickerState, referencedHoverState, duplicateSelectionState })}`);
    }
    await page.locator('#inputThumbsRow .input-thumb').first().click();
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.hasAttribute('open'));
    const readOnlyImageViewer = await page.evaluate(() => ({
        open:Boolean(document.querySelector('#imageEditModal')?.open),
        preview:Boolean(document.querySelector('#previewStage')),
        download:Boolean(document.querySelector('#previewDownloadBtn,#previewDownloadAllBtn')),
    }));
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
    if(!readOnlyImageViewer.open || !readOnlyImageViewer.preview || !readOnlyImageViewer.download){
        throw new Error(`Unexpected read-only image viewer: ${JSON.stringify(readOnlyImageViewer)}`);
    }

    await prompt.click();
    await prompt.type('@zzzz-no-match');
    await page.waitForFunction(() => Boolean(
        document.querySelector('#mentionPicker')?.hasAttribute('open')
        && document.querySelector('#mentionPicker')?.shadowRoot?.querySelector('[part="empty"]')
    ));
    const zeroMatchStayedOpen = await page.locator('#mentionPicker').evaluate(
        picker => picker.hasAttribute('open'),
    );
    await prompt.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#mentionPicker')?.hasAttribute('open'));
    await page.evaluate(() => {
        document.querySelector('#composer').style.position = '';
        const editor = document.querySelector('#promptInput');
        editor.innerHTML = '第一行<br>'.repeat(40);
        editor.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText'}));
    });
    await page.locator('#composerFocusToggle').click();
    await page.waitForFunction(() => !document.querySelector('#composer')?.classList.contains('focus-transitioning'));
    const focusedState = await page.evaluate(() => {
        const composer = document.querySelector('#composer');
        const editor = document.querySelector('#promptInput');
        const before = {...viewport};
        document.querySelector('#composerFocusBackdrop').dispatchEvent(new MouseEvent('click', {
            bubbles:true,
            cancelable:true,
        }));
        editor.dispatchEvent(new WheelEvent('wheel', {
            bubbles:true,
            cancelable:true,
            deltaY:120,
        }));
        const rect = composer.getBoundingClientRect();
        return {
            open:composer.classList.contains('focused'),
            width:Math.round(rect.width),
            height:Math.round(rect.height),
            backdropStayedOpen:composer.classList.contains('focused'),
            viewportUnchanged:before.x === viewport.x
                && before.y === viewport.y
                && before.scale === viewport.scale,
            text:editor.textContent,
        };
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#composer')?.classList.contains('focused'));
    await page.waitForFunction(() => !document.querySelector('#composer')?.classList.contains('focus-transitioning'));
    const compactEditorState = await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        return {
            height:Math.round(editor.getBoundingClientRect().height),
            overflowY:getComputedStyle(editor).overflowY,
            text:editor.textContent,
        };
    });
    if (!zeroMatchStayedOpen
        || !focusedState.open
        || focusedState.width !== 850
        || focusedState.height !== 660
        || !focusedState.backdropStayedOpen
        || !focusedState.viewportUnchanged
        || focusedState.text !== compactEditorState.text
        || compactEditorState.height > 192
        || compactEditorState.overflowY !== 'auto') {
        throw new Error(`Unexpected Issue #71 Prompt state: ${JSON.stringify({ zeroMatchStayedOpen, focusedState, compactEditorState })}`);
    }
    await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'deleteContent'}));
    });

    await prompt.click();
    await prompt.type('/暖阳');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1
        && document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelector('[part="option"][data-index="0"] .name')
            ?.textContent.trim() === '暖阳赛璐璐CG'
    ));
    const templateMenuScreenshotPath = '/tmp/smart-canvas-template-quick-menu.png';
    await page.screenshot({ path: templateMenuScreenshotPath });
    await page.locator('#mentionPicker').locator('[part="option"]').first().click();
    await prompt.click();
    await prompt.type('/手绘');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1
        && document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelector('[part="option"][data-index="0"] .name')
            ?.textContent.trim() === '手绘质感3D动画'
    ));
    await page.locator('#mentionPicker').locator('[part="option"]').first().click();
    await page.waitForFunction(() => (
        document.querySelector('#promptInput')?.textContent.includes('FIRST_TEMPLATE_PROMPT')
        && document.querySelector('#promptInput')?.textContent.includes('SECOND_TEMPLATE_PROMPT')
    ));
    const templateState = await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        const resolved = window.SmartCanvasModules.promptAuthoring.resolve({
            nodeId: 'quick-picker-node',
            defaultImages: [],
        });
        return {
            editableText:editor.textContent,
            tokenCount:editor.querySelectorAll('.prompt-template-token').length,
            resolvedPrompt: resolved.prompt,
        };
    });
    if (templateState.tokenCount !== 0
        || templateState.resolvedPrompt.indexOf('FIRST_TEMPLATE_PROMPT')
            >= templateState.resolvedPrompt.indexOf('SECOND_TEMPLATE_PROMPT')) {
        throw new Error(`Unexpected template order: ${JSON.stringify(templateState)}`);
    }

    const screenshotPath = process.env.SMART_CANVAS_QA_SCREENSHOT
        || '/tmp/smart-canvas-prompt-quick-picker.png';
    await page.screenshot({ path: screenshotPath });
    await page.locator('#promptInput').evaluate(editor => {
        editor.textContent = editor.textContent.replace('FIRST_TEMPLATE_PROMPT', 'EDITED_TEMPLATE_PROMPT');
        editor.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText'}));
    });
    await page.waitForFunction(() => document.querySelector('#promptInput')?.textContent.includes('EDITED_TEMPLATE_PROMPT'));

    await page.evaluate(() => {
        selectedId = 'quick-picker-prompt-node';
        selectedIds = [];
        selectedImage = { nodeId: '', index: -1 };
        canvas.connections = [];
        render();
        beginPromptNodeTextEdit('quick-picker-prompt-node');
    });
    const promptEditor = page.locator('.image-node[data-id="quick-picker-prompt-node"] .prompt-node-text');
    await page.waitForFunction(() => (
        document.querySelector('.image-node[data-id="quick-picker-prompt-node"] .prompt-node-text')
            ?.getAttribute('contenteditable') === 'true'
    ));
    await promptEditor.type('/暖阳');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1
    ));
    await page.locator('#mentionPicker').locator('[part="option"]').first().click();
    await promptEditor.type('/手绘');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1
    ));
    await page.locator('#mentionPicker').locator('[part="option"]').first().click();
    await page.waitForFunction(() => {
        const editor = document.querySelector('.image-node[data-id="quick-picker-prompt-node"] .prompt-node-text');
        return editor?.textContent.includes('FIRST_TEMPLATE_PROMPT')
            && editor?.textContent.includes('SECOND_TEMPLATE_PROMPT');
    });
    await promptEditor.type('@角色 2');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length >= 1
        && document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelector('[part="option"][data-index="0"] .name')
            ?.textContent.trim() === '角色 2'
    ));
    const promptNodeMenuScreenshotPath = '/tmp/smart-canvas-prompt-node-quick-menu.png';
    await page.screenshot({ path: promptNodeMenuScreenshotPath });
    await page.locator('#mentionPicker').locator('[part="option"]').first().click();
    await page.waitForFunction(() => (
        nodes.find(node => node.id === 'quick-picker-prompt-node')?.manualInputRefs?.length === 1
    ));
    const promptNodeState = await page.evaluate(() => {
        const node = nodes.find(item => item.id === 'quick-picker-prompt-node');
        const editor = document.querySelector('.image-node[data-id="quick-picker-prompt-node"] .prompt-node-text');
        return {
            tokenCount:editor.querySelectorAll('.prompt-template-token').length,
            resolvedText: node?.text || '',
            hasAtTrigger: editor.textContent.includes('@'),
            attachmentCount: node?.manualInputRefs?.length || 0,
            attachmentThumbCount: document.querySelectorAll('.image-node[data-id="quick-picker-prompt-node"] ic-reference-thumbnail').length,
        };
    });
    if (promptNodeState.tokenCount !== 0
        || promptNodeState.resolvedText.indexOf('FIRST_TEMPLATE_PROMPT')
            >= promptNodeState.resolvedText.indexOf('SECOND_TEMPLATE_PROMPT')
        || promptNodeState.hasAtTrigger
        || promptNodeState.attachmentCount !== 1
        || promptNodeState.attachmentThumbCount < 1) {
        throw new Error(`Unexpected prompt node state: ${JSON.stringify(promptNodeState)}`);
    }
    await browser.close();
    process.stdout.write(JSON.stringify({
        ok: true,
        inputMenu,
        hoverScrollState,
        inputSearchState,
        attachmentState,
        referencedPickerState,
        referencedHoverState,
        duplicateSelectionState,
        readOnlyImageViewer,
        zeroMatchStayedOpen,
        focusedState,
        compactEditorState,
        templateState,
        screenshotPath,
        inputMenuScreenshotPath,
        templateMenuScreenshotPath,
        promptNodeMenuScreenshotPath,
        promptNodeState,
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exit(1);
});
