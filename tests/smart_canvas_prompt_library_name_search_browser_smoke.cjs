const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:3100';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';
const skipLogin = process.env.SMART_CANVAS_SKIP_LOGIN === '1';
const coverOnly = process.env.SMART_CANVAS_PROMPT_COVER_ONLY === '1';
const canvasId = 'prompt-library-name-search-smoke';

(async () => {
    const browser = await chromium.launch({
        headless:true,
        executablePath:browserExecutable,
    });
    const page = await browser.newPage({viewport:{width:1100,height:760}});
    if(!skipLogin) {
        await page.goto(`${baseUrl}/login`, {waitUntil:'domcontentloaded'});
        await submitLogin(page, baseUrl, smokeUsername, smokePassword);
    }
    await page.route(`**/api/canvases/${canvasId}`, route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({canvas:{
            id:canvasId,
            title:'Prompt library name search smoke',
            kind:'smart',
            revision:1,
            nodes:[],
            connections:[],
            viewport:{x:0,y:0,scale:1},
            settings:{},
            logs:[],
        }}),
    }));
    await page.route(`**/api/canvases/${canvasId}/prompt-templates`, route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({revision:1,templates:[]}),
    }));
    let coverUploadBody = '';
    await page.route('**/api/prompt-libraries/covers', route => {
        coverUploadBody = route.request().postDataBuffer()?.toString('utf8') || '';
        return route.fulfill({
            status:200,
            contentType:'application/json',
            body:JSON.stringify({cover:{
                media_id:'a'.repeat(64),
                url:`/api/prompt-libraries/covers/${'a'.repeat(64)}.png`,
                name:'template-cover.png',
                kind:'image',
            }}),
        });
    });
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=${canvasId}`, {
        waitUntil:'domcontentloaded',
    });
    await page.waitForFunction(expectedId => (
        document.readyState === 'complete'
        && typeof canvas !== 'undefined'
        && canvas?.id === expectedId
    ), canvasId);
    if(coverOnly) {
        const uploadedCover = await page.evaluate(() => uploadPromptTemplateCover(
            new File(['browser-cover'], 'template-cover.png', {type:'image/png'})
        ));
        if(uploadedCover.url !== `/api/prompt-libraries/covers/${'a'.repeat(64)}.png`) {
            throw new Error(`Unexpected dedicated cover URL: ${uploadedCover.url}`);
        }
        if(!coverUploadBody.includes('name="file"') || !coverUploadBody.includes('template-cover.png')) {
            throw new Error('Prompt cover did not use the dedicated multipart field');
        }
        await browser.close();
        process.stdout.write(JSON.stringify({ok:true, coverUpload:true}));
        return;
    }
    await page.evaluate(expectedId => {
        const node = {
            id:'prompt-search-node',
            type:'smart-image',
            x:260,
            y:170,
            w:300,
            h:220,
            title:'提示词搜索验证',
            images:[],
            promptDraftHtml:'',
            promptDraftText:'',
            runSettings:{},
        };
        canvas = {
            id:expectedId,
            title:'Prompt library name search smoke',
            kind:'smart',
            nodes:[node],
            connections:[],
            viewport:{x:0,y:0,scale:1},
            settings:{},
            logs:[],
        };
        nodes = canvas.nodes;
        selectedId = node.id;
        selectedIds = [];
        selectedImage = {nodeId:'',index:-1};
        promptLibraries = [{
            id:'styles',
            name:'仅库名命中词',
            categories:[{id:'cg',name:'3D分类'}],
            items:[{
                id:'warm-cg',
                name:'暖阳赛璐璐CG',
                category:'cg',
                // Legacy-only fields must not become searchable again.
                scene:'仅旧场景命中词',
                scene_en:'legacy scene only',
                cover:'/assets/仅封面命中词.png',
                positive:'FIRST_TEMPLATE_PROMPT',
            }],
        }];
        activePromptLibraryId = 'styles';
        render();
    }, canvasId);

    const prompt = page.locator('#promptInput');
    await page.waitForSelector('#composer.open #promptInput');
    await prompt.click();
    await prompt.type('/仅库名命中词');
    await page.waitForFunction(() => Boolean(document.querySelector('#mentionPicker')?.shadowRoot
        ?.querySelector('[part="empty"]')));
    const libraryQueryMatches = await page.locator('#mentionPicker')
        .locator('[part="option"]').count();
    if(libraryQueryMatches !== 0) {
        throw new Error(`Library name unexpectedly matched ${libraryQueryMatches} templates`);
    }

    await prompt.press('Escape');
    await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', {
            bubbles:true,
            inputType:'deleteContentBackward',
        }));
    });
    await prompt.type('/仅旧场景命中词');
    await page.waitForFunction(() => Boolean(document.querySelector('#mentionPicker')?.shadowRoot
        ?.querySelector('[part="empty"]')));
    const legacySceneMatches = await page.locator('#mentionPicker')
        .locator('[part="option"]').count();
    if(legacySceneMatches !== 0) {
        throw new Error(`Legacy scene unexpectedly matched ${legacySceneMatches} templates`);
    }

    await prompt.press('Escape');
    await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', {
            bubbles:true,
            inputType:'deleteContentBackward',
        }));
    });
    await prompt.type('/仅封面命中词');
    await page.waitForFunction(() => Boolean(document.querySelector('#mentionPicker')?.shadowRoot
        ?.querySelector('[part="empty"]')));
    const coverMatches = await page.locator('#mentionPicker')
        .locator('[part="option"]').count();
    if(coverMatches !== 0) {
        throw new Error(`Cover URL unexpectedly matched ${coverMatches} templates`);
    }

    await prompt.press('Escape');
    await page.evaluate(() => {
        const editor = document.querySelector('#promptInput');
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', {
            bubbles:true,
            inputType:'deleteContentBackward',
        }));
    });
    await prompt.type('/暖阳');
    await page.waitForFunction(() => (
        document.querySelector('#mentionPicker')?.shadowRoot
            ?.querySelectorAll('[part="option"]').length === 1
        && document.querySelector('#mentionPicker')?.shadowRoot?.querySelector('.name')
            ?.textContent.trim() === '暖阳赛璐璐CG'
    ));

    const uploadedCover = await page.evaluate(() => uploadPromptTemplateCover(
        new File(['browser-cover'], 'template-cover.png', {type:'image/png'})
    ));
    if(uploadedCover.url !== `/api/prompt-libraries/covers/${'a'.repeat(64)}.png`) {
        throw new Error(`Unexpected dedicated cover URL: ${uploadedCover.url}`);
    }
    if(!coverUploadBody.includes('name="file"') || !coverUploadBody.includes('template-cover.png')) {
        throw new Error('Prompt cover did not use the dedicated multipart field');
    }

    await browser.close();
    process.stdout.write(JSON.stringify({
        ok:true,
        libraryQueryMatches,
        legacySceneMatches,
        coverMatches,
        coverUpload:true,
    }));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
