const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function expectedFocusColor(theme) {
    return theme === 'dark' ? 'rgb(165, 165, 165)' : 'rgb(115, 115, 115)';
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    try {
        const context = await browser.newContext({
            viewport: { width: 1180, height: 800 },
            reducedMotion: 'reduce',
        });
        await context.route('**/static/js/infinite-canvas-ui/prompt-template-library.js*', async route => {
            const response = await route.fetch();
            if (response.ok()) {
                await route.fulfill({ response });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: 'export class IcPromptTemplateLibrary extends HTMLElement {}',
            });
        });
        await context.route('**/static/js/smart-canvas/canvas-persistence.js*', async route => {
            const response = await route.fetch();
            const source = await response.text();
            const editableSource = source.replace(
                /function canvasPersistenceEditable\(\)\{[\s\S]*?\n\}/,
                'function canvasPersistenceEditable(){ return true; }',
            );
            assert.notEqual(editableSource, source);
            await route.fulfill({ response, body: editableSource });
        });

        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-151-focus-ring`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            customElements.get('ic-button')
            && window.SmartCanvasModules?.viewportSelection
            && typeof render === 'function',
        ));
        await page.waitForFunction(() => typeof canvas !== 'undefined');

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length, {
                    id:'issue-151-prompt', type:'smart-prompt', title:'提示词',
                    x:160, y:180, w:360, h:260, text:'验证向内聚焦描边', textHtml:'验证向内聚焦描边'
                });
                canvas = {id:'issue-151-focus-ring', nodes, connections:[], logs:[]};
                selectedId = 'issue-151-prompt';
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                composer.style.display = 'none';
                render();
            })();`;
            document.body.appendChild(script);
            script.remove();
        });
        await page.waitForFunction(() => {
            const trigger = document.querySelector(
                '#smartNodeFloatingPortal [data-smart-node-action="focus-editor"]',
            );
            if (!trigger || !trigger.getClientRects().length) return false;
            trigger.click();
            return true;
        });
        await page.waitForFunction(() => {
            const surface = document.getElementById('promptNodeFocusSurface');
            const editor = surface?.querySelector('.prompt-node-text');
            return surface?.hasAttribute('open') && editor?.isContentEditable
                && document.activeElement === editor;
        });

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => {
            const surface = document.getElementById('promptNodeFocusSurface');
            const trigger = document.querySelector(
                '#smartNodeFloatingPortal [data-smart-node-action="focus-editor"]',
            );
            return !surface?.hasAttribute('open') && document.activeElement === trigger;
        });

        const measure = async theme => page.evaluate(selectedTheme => {
            document.documentElement.dataset.uiTheme = selectedTheme;
            const trigger = document.querySelector(
                '#smartNodeFloatingPortal [data-smart-node-action="focus-editor"]',
            );
            const base = trigger?.shadowRoot?.querySelector('[part~="base"]');
            const toolbar = trigger?.closest('ic-smart-node-toolbar');
            const content = toolbar?.shadowRoot?.querySelector('[part="content"]');
            const style = getComputedStyle(base);
            const contentStyle = getComputedStyle(content);
            const outlineWidth = Number.parseFloat(style.outlineWidth);
            const outlineOffset = Number.parseFloat(style.outlineOffset);
            return {
                activeAction: document.activeElement?.dataset.smartNodeAction || '',
                focusVisible: base?.matches(':focus-visible') || false,
                outlineColor: style.outlineColor,
                outlineWidth,
                outlineOffset,
                externalExtent: Math.max(0, outlineWidth + outlineOffset),
                boxShadow: style.boxShadow,
                overflowX: contentStyle.overflowX,
                overflowY: contentStyle.overflowY,
            };
        }, theme);

        for (const theme of ['light', 'dark']) {
            const state = await measure(theme);
            assert.deepEqual(state, {
                activeAction: 'focus-editor',
                focusVisible: true,
                outlineColor: expectedFocusColor(theme),
                outlineWidth: 1,
                outlineOffset: -1,
                externalExtent: 0,
                boxShadow: 'none',
                overflowX: 'auto',
                overflowY: 'hidden',
            }, `${theme} focus state: ${JSON.stringify(state)}`);
        }

        process.stdout.write('Issue #151 inset focus ring browser smoke passed.\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
