const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    try {
        const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
        await context.route('**/static/js/smart-canvas/canvas-persistence.js*', async route => {
            const response = await route.fetch();
            const source = await response.text();
            const editableSource = source.replace(
                /function canvasPersistenceEditable\(\)\{[\s\S]*?\n\}/,
                'function canvasPersistenceEditable(){ return true; }',
            );
            await route.fulfill({ response, body: editableSource });
        });
        const page = await context.newPage();
        await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
        await submitLogin(page, baseUrl, smokeUsername, smokePassword);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-126-template-text`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.promptAuthoring
            && typeof render === 'function'
            && typeof updateComposer === 'function'
            && typeof beginPromptNodeTextEdit === 'function'
        ));
        await page.waitForLoadState('networkidle');

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
            const composerNode = {
                id: 'issue-126-composer',
                type: 'smart-image',
                title: 'Composer target',
                x: 180,
                y: 180,
                w: 300,
                h: 220,
                generationOutputNode: true,
                images: [],
                promptDraftHtml: '',
                promptDraftText: '',
            };
            const promptNode = {
                id: 'issue-126-prompt',
                type: 'smart-prompt',
                title: 'Prompt target',
                x: 600,
                y: 180,
                w: 320,
                h: 220,
                text: '',
                textHtml: '',
            };
            canvas = {
                id: 'issue-126-template-text',
                title: 'Issue 126',
                nodes: [composerNode, promptNode],
                connections: [],
                viewport: { x: 0, y: 0, scale: 1 },
                settings: {},
                logs: [],
            };
            nodes = canvas.nodes;
            promptLibraries = [{
                id: 'common',
                name: '通用',
                categories: [{ id: 'structure', name: '结构' }],
                items: [{
                    id: 'editable-structure',
                    name: '可编辑结构模板',
                    category: 'structure',
                    positive: '镜头结构第一行\\n镜头结构第二行',
                }],
            }];
            activePromptLibraryId = 'common';
            builtinPromptTemplates = promptLibraries[0].items;
            selectedId = composerNode.id;
            selectedIds = [];
            selectedImage = { nodeId: '', index: -1 };
            render();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
            })();`;
            document.body.appendChild(script);
            script.remove();
        });

        const composer = page.locator('#promptInput');
        await page.waitForSelector('#composer.open #promptInput');
        const composerPicker = await composer.evaluate(editor => {
            editor.focus();
            editor.textContent = '/可编辑';
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            setPromptQuickTarget(editor, activeComposerNode());
            mentionRange = range.cloneRange();
            promptQuickQuery = '可编辑';
            promptQuickQueryRaw = '可编辑';
            renderPromptTemplateQuickPicker();
            return {
                libraries: promptLibraries.length,
                trigger: promptQuickTriggerAtCaret(editor),
                open: mentionPicker.hasAttribute('open'),
                optionCount: mentionPicker.shadowRoot.querySelectorAll('[part="option"]').length,
            };
        });
        assert.deepEqual(composerPicker, {
            libraries: 1,
            trigger: { trigger: '/', rawQuery: '可编辑', query: '可编辑', start: 0 },
            open: true,
            optionCount: 1,
        });
        await page.waitForFunction(() => document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1);
        await composer.press('Enter');
        const composerInsert = await composer.evaluate(editor => ({
            text: editor.textContent,
            tokenCount: editor.querySelectorAll('.prompt-template-token').length,
            draft: nodes.find(node => node.id === 'issue-126-composer')?.promptDraftText || '',
        }));
        assert.equal(composerInsert.tokenCount, 0);
        assert.match(composerInsert.text, /镜头结构第一行\n镜头结构第二行/);
        assert.match(composerInsert.draft, /镜头结构第一行\n镜头结构第二行/);

        await composer.evaluate(editor => {
            editor.textContent = editor.textContent.replace('第二行', '第二行（已微调）');
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        });
        assert.match(
            await page.evaluate(() => nodes.find(node => node.id === 'issue-126-composer')?.promptDraftText || ''),
            /第二行（已微调）/,
        );

        await page.evaluate(() => {
            selectedId = 'issue-126-prompt';
            selectedIds = [];
            selectedImage = { nodeId: '', index: -1 };
            render();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            beginPromptNodeTextEdit('issue-126-prompt');
        });
        const promptEditor = page.locator('.image-node[data-id="issue-126-prompt"] .prompt-node-text');
        await promptEditor.waitFor({ state: 'visible' });
        await promptEditor.evaluate(editor => {
            editor.focus();
            editor.textContent = '/可编辑';
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            setPromptQuickTarget(editor, nodes.find(item => item.id === 'issue-126-prompt'));
            mentionRange = range.cloneRange();
            promptQuickQuery = '可编辑';
            promptQuickQueryRaw = '可编辑';
            renderPromptTemplateQuickPicker();
        });
        await page.waitForFunction(() => document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1);
        await page.locator('#mentionPicker').locator('[part="option"]').first().evaluate(button => {
            button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
        });
        const promptInsert = await promptEditor.evaluate(editor => {
            const node = nodes.find(item => item.id === 'issue-126-prompt');
            return {
                text: editor.textContent,
                tokenCount: editor.querySelectorAll('.prompt-template-token').length,
                storedText: node?.text || '',
                storedHtml: node?.textHtml || '',
            };
        });
        assert.equal(promptInsert.tokenCount, 0);
        assert.match(promptInsert.text, /镜头结构第一行\n镜头结构第二行/);
        assert.equal(promptInsert.storedText.trim(), promptInsert.text.trim());
        assert.doesNotMatch(promptInsert.storedHtml, /prompt-template-token/);

        const legacyState = await page.evaluate(() => {
            const legacy = '<span class="prompt-template-token" contenteditable="false" data-prompt-text="旧模板正文"><span class="prompt-template-token-label">旧模板</span><button class="prompt-template-token-remove">×</button></span>';
            const editor = document.createElement('div');
            editor.innerHTML = structuredPromptEditorHtml(legacy, '');
            return {
                text: editor.textContent,
                tokenCount: editor.querySelectorAll('.prompt-template-token').length,
            };
        });
        assert.deepEqual(legacyState, { text: '旧模板正文', tokenCount: 0 });

        process.stdout.write(`${JSON.stringify({ composerInsert, promptInsert, legacyState })}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
