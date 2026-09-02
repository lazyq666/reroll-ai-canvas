const { chromium } = require('playwright');

const baseUrl = process.env.MODEL_ICON_BASE_URL || 'http://127.0.0.1:3101';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    await page.route('**/api/config', route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({
            image_models:['gpt-image-2','nano-banana-pro','midjourney','mystery-image-v1'],
            api_providers:[
                {id:'openai',name:'OpenAI',enabled:true,image_models:['gpt-image-2']},
                {id:'gemini',name:'Gemini',enabled:true,image_models:['nano-banana-pro']},
                {id:'midjourney',name:'Midjourney',enabled:true,image_models:['midjourney']},
                {id:'custom-studio',name:'Custom Studio',enabled:true,image_models:['mystery-image-v1']},
            ],
            available_models:{image:[
                {id:'openai-gpt',provider_id:'openai',provider_name:'OpenAI',model:'gpt-image-2',name:'GPT Image 2'},
                {id:'gemini-nano',provider_id:'gemini',provider_name:'Gemini',model:'nano-banana-pro',name:'Nano Banana Pro'},
                {id:'midjourney-v7',provider_id:'midjourney',provider_name:'Midjourney',model:'midjourney',name:'Midjourney V7'},
                {id:'custom-mystery',provider_id:'custom-studio',provider_name:'Custom Studio',model:'mystery-image-v1',name:'Mystery Image'},
            ]},
        }),
    }));
    await page.route('**/api/batch-generation/history', route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({batches:[]}),
    }));

    const login = await page.request.post(`${baseUrl}/api/auth/login`, {data:{
        username:'batch-browser-designer',
        password:'batch-browser-password',
    }});
    if (!login.ok()) throw new Error(`Browser login failed: ${login.status()}`);

    await page.goto(`${baseUrl}/static/online.html`, {waitUntil:'networkidle'});
    const structure = await page.evaluate(() => ({
        title:document.title,
        heading:document.querySelector('.batch-page-header ic-heading')?.textContent.trim(),
        historyButton:document.querySelector('.batch-page-header > #batchHistoryButton') !== null,
        batchVisible:document.querySelector('#batchGenerationMode')?.hidden === false,
        removedSurfaceCount:document.querySelectorAll('#generationModeTabs, #singleModeTab, #batchModeTab, #singleGenerationMode, #singleGenerationHistory, #genBtn, #modelSelect').length,
    }));
    if (structure.title !== '批量生成' || structure.heading !== '批量生成'
        || !structure.historyButton || !structure.batchVisible || structure.removedSurfaceCount) {
        throw new Error(`Batch-only online page mismatch: ${JSON.stringify(structure)}`);
    }
    await page.waitForSelector('#batchModelChoices .batch-choice-card');
    const cards = await page.locator('#batchModelChoices .batch-choice-card').evaluateAll(items => items.map(item => ({
        text:item.textContent.replace(/\s+/g, ' ').trim(),
        image:item.querySelector('.model-vendor-icon img')?.getAttribute('src') || '',
        fallback:Boolean(item.querySelector('.model-vendor-icon--fallback svg')),
        iconWidth:Math.round(item.querySelector('.model-vendor-icon')?.getBoundingClientRect().width || 0),
    })));

    const expectedImages = new Map([
        ['GPT Image 2', '/static/images/providers/chatgpt.svg'],
        ['Nano Banana Pro', '/static/images/providers/gemini.svg'],
        ['Midjourney V7', '/static/images/providers/midjourney.svg'],
    ]);
    for (const [name, source] of expectedImages) {
        const card = cards.find(item => item.text.includes(name));
        if (!card || !card.image.endsWith(source) || card.iconWidth !== 18) {
            throw new Error(`Batch icon mismatch for ${name}: ${JSON.stringify(card)}`);
        }
    }
    const fallback = cards.find(item => item.text.includes('Mystery Image'));
    if (!fallback?.fallback || fallback.iconWidth !== 18) {
        throw new Error(`Batch generic fallback mismatch: ${JSON.stringify(fallback)}`);
    }

    await page.click('#batchHistoryButton');
    await page.waitForSelector('#batchHistoryStep:not([hidden])');
    const history = await page.evaluate(() => ({
        emptyVisible:document.querySelector('#batchHistoryEmpty')?.hidden === false,
        tableHidden:document.querySelector('#batchHistoryTableWrap')?.hidden === true,
    }));
    if (!history.emptyVisible || !history.tableHidden) {
        throw new Error(`Batch history empty state mismatch: ${JSON.stringify(history)}`);
    }
    await page.click('#closeBatchHistory');
    await page.waitForSelector('#batchSetupStep:not([hidden])');

    console.log(JSON.stringify({structure,cards,history}, null, 2));
    await browser.close();
})().catch(error => {
    console.error(error);
    process.exit(1);
});
