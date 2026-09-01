const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: browserExecutable,
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=prompt-quick-picker-newline&manual=1`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(window.SmartCanvasModules?.promptAuthoring));
        await page.evaluate(image => {
            const node = {
                id: 'quick-picker-newline-node',
                type: 'smart-image',
                x: 260,
                y: 170,
                w: 300,
                h: 220,
                title: '换行触发验证',
                images: [{ url: image, name: '参考图 1', kind: 'image' }],
                generationOutputNode: true,
                promptDraftHtml: '',
                promptDraftText: '',
            };
            canvas = {
                id: 'prompt-quick-picker-newline',
                title: 'Prompt quick picker newline smoke',
                nodes: [node],
                connections: [],
                viewport: { x: 0, y: 0, scale: 1 },
                settings: {},
                logs: [],
            };
            nodes = canvas.nodes;
            selectedId = node.id;
            selectedIds = [];
            selectedImage = { nodeId: node.id, index: 0 };
            promptLibraries = [{
                id: 'styles',
                name: '风格库',
                categories: [],
                items: [{
                    id: 'warm-cg',
                    name: '暖阳赛璐璐CG',
                    positive: 'FIRST_TEMPLATE_PROMPT',
                }],
            }];
            activePromptLibraryId = 'styles';
            builtinPromptTemplates = promptLibraries[0].items;
            render();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
        }, tinyPng);
        await page.waitForSelector('#composer.open #promptInput');

        for (const trigger of ['@', '/']) {
            const state = await page.evaluate(trigger => {
                const editor = document.querySelector('#promptInput');
                const picker = document.querySelector('#mentionPicker');
                closeMentionPicker();
                editor.innerHTML = `第一行<br>${trigger}`;
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                editor.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    data: trigger,
                    inputType: 'insertText',
                }));
                const before = range.cloneRange();
                before.selectNodeContents(editor);
                before.setEnd(selection.anchorNode, selection.anchorOffset);
                return {
                    html: editor.innerHTML,
                    textBeforeCaret: before.toString(),
                    open: picker.hasAttribute('open'),
                };
            }, trigger);
            if (!state.open) {
                throw new Error(`${trigger} trigger did not open after a newline: ${JSON.stringify(state)}`);
            }
            if (trigger === '@') {
                await page.keyboard.press('Escape');
                continue;
            }
            await page.locator('#mentionPicker').locator('[part="option"]').first().click();
            const selectionState = await page.evaluate(trigger => {
                const editor = document.querySelector('#promptInput');
                return {
                    html: editor.innerHTML,
                    pickerOpen: document.querySelector('#mentionPicker').hasAttribute('open'),
                    templateInserted: editor.textContent.includes('FIRST_TEMPLATE_PROMPT'),
                    triggerRemained: editor.innerHTML.includes(`<br>${trigger}`),
                };
            }, trigger);
            if (selectionState.pickerOpen
                || selectionState.triggerRemained
                || !selectionState.templateInserted) {
                throw new Error(`${trigger} selection failed after a newline: ${JSON.stringify(selectionState)}`);
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
