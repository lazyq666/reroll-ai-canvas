const assert = require('node:assert/strict');
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
        headless:true,
        executablePath:browserExecutable,
    });
    const page = await browser.newPage({viewport:{width:1100,height:760}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(`${baseUrl}/login`, {waitUntil:'domcontentloaded'});
        await submitLogin(page, baseUrl, smokeUsername, smokePassword);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-12-asset-mention`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(window.SmartCanvasModules?.promptAuthoring));
        await page.waitForFunction(() => ['ready', 'error'].includes(
            document.documentElement.dataset.canvasOpeningPhase,
        ));
        await page.evaluate(({image}) => {
            window.SmartCanvasModules.canvasOpening?.prepare?.();
            const source = {
                id:'issue-12-source',
                type:'smart-image',
                x:240,
                y:160,
                w:300,
                h:220,
                title:'引用来源',
                images:[{url:`${image}#wolf`, name:'狼人', kind:'image'}],
                referenceGenerationKind:'image',
                generationOutputNode:true,
                promptDraftHtml:'',
                promptDraftText:'',
            };
            canvas = {
                id:'issue-12-asset-mention',
                title:'Issue 12 asset mention',
                nodes:[source],
                connections:[],
                viewport:{x:0,y:0,scale:1},
                settings:{},
                logs:[],
            };
            nodes = canvas.nodes;
            selectedId = source.id;
            selectedIds = [];
            selectedImage = {nodeId:source.id,index:0};
            render();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
            composer.style.position = 'fixed';
            composer.style.top = '404px';
            composer.style.visibility = 'visible';
        }, {image:tinyPng});

        const prompt = page.locator('#promptInput');
        await page.waitForSelector('#composer.open #promptInput');
        await prompt.click();
        await prompt.type('@');
        await page.waitForFunction(() => document.querySelector('#mentionPicker')?.hasAttribute('open'));
        await page.evaluate(() => {
            document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[data-tab="assets"]').click();
        });
        await page.waitForFunction(() => document.querySelector('#mentionPicker')?.activeTab === 'assets');
        await prompt.type('狼');
        const state = await page.evaluate(() => ({
            activeTab:document.querySelector('#mentionPicker')?.activeTab,
            queryText:document.querySelector('#promptInput')?.textContent,
            open:document.querySelector('#mentionPicker')?.hasAttribute('open'),
        }));
        assert.deepEqual(state, {
            activeTab:'assets',
            queryText:'@狼',
            open:true,
        });
        await prompt.press('Escape');
        await page.evaluate(async () => {
            document.querySelector('#composer').classList.remove('open');
            document.querySelector('#composer').style.visibility = 'hidden';
            const listing = await fetch('/api/workspace-assets?query=&limit=60');
            const current = await listing.json();
            if (current.folders?.some(folder => folder.name === '角色与场景设计素材')) return;
            const response = await fetch('/api/workspace-assets/folders', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({name:'角色与场景设计素材'}),
            });
            if (!response.ok) throw new Error(`Could not create visual test folder: ${response.status}`);
        });
        await page.evaluate(() => document.querySelector('#workspaceAssetDockToggle').click());
        await page.waitForFunction(() => document.querySelector('#workspaceAssetDialog')?.hasAttribute('open'));
        await page.waitForFunction(() => Boolean(
            document.querySelector('#workspaceAssetPanel')?.shadowRoot
                ?.querySelector('.folder-row-managed'),
        ));
        const dialogState = await page.evaluate(async () => {
            const panel = document.querySelector('#workspaceAssetPanel');
            const root = panel.shadowRoot;
            const row = root.querySelector('.folder-row-managed');
            const label = row.querySelector('.folder-label');
            const actions = row.querySelector('.folder-actions');
            const lightLabelRect = label.getBoundingClientRect();
            const lightActionsRect = actions.getBoundingClientRect();
            const light = {
                searchFocused:root.activeElement === root.querySelector('[data-search]'),
                fontSize:getComputedStyle(label).fontSize,
                labelClearOfActions:lightLabelRect.right <= lightActionsRect.left + 0.5,
            };
            window.StudioTheme.apply('dark');
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const darkLabelRect = label.getBoundingClientRect();
            const darkActionsRect = actions.getBoundingClientRect();
            return {
                light,
                dark:{
                    applied:document.documentElement.classList.contains('theme-dark'),
                    fontSize:getComputedStyle(label).fontSize,
                    labelClearOfActions:darkLabelRect.right <= darkActionsRect.left + 0.5,
                },
            };
        });
        assert.deepEqual(dialogState, {
            light:{searchFocused:false,fontSize:'14px',labelClearOfActions:true},
            dark:{applied:true,fontSize:'14px',labelClearOfActions:true},
        });
        await page.locator('ic-workspace-asset-library .folder-row-managed').hover();
        await page.screenshot({path:'/tmp/issue-12-asset-library-dialog-dark.png'});
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log(JSON.stringify({state,dialogState}));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
