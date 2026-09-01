const { chromium } = require('playwright');

const baseUrl = process.env.ISSUE_87_BASE_URL || 'http://127.0.0.1:3101';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const batch = {
    id:'issue-87-gallery', owner:'designer-1', name:'Issue 87 结果画廊', status:'completed',
    created_at:1700000000,
    progress:{succeeded:2,failed:0,cancelled:0,running:0,queued:0,total:2},
    tasks:[
        {
            index:0, status:'succeeded', prompt:'红狐，森林', provider_id:'openai',
            model:'gpt-image-2', model_name:'团队主力生图', ratio:'1:1',
            outputs:['/assets/output/issue-87-openai.png'],
        },
        {
            index:1, status:'succeeded', prompt:'雪豹，雪山', provider_id:'unknown-provider',
            model:'unknown-image-v1', ratio:'1:1',
            outputs:['/assets/output/issue-87-fallback.png'],
        },
    ],
    snapshot:{
        models:[
            {provider_id:'openai',model:'gpt-image-2',name:'团队主力生图'},
            {provider_id:'unknown-provider',model:'unknown-image-v1',name:'unknown-image-v1'},
        ],
        ratios:['1:1'],
        settings:{resolution:'2k',quality:'high',outputs_per_submission:1,submissions_per_task:1},
    },
};

async function verifyTheme(browser, theme) {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const login = await page.request.post(`${baseUrl}/api/auth/login`, {data:{
        username:'batch-browser-designer', password:'batch-browser-password',
    }});
    if (!login.ok()) throw new Error(`${theme} fixture login failed: ${login.status()}`);
    await page.addInitScript(selectedTheme => {
        localStorage.setItem('studio_theme', selectedTheme);
        localStorage.setItem('canvas_theme', selectedTheme);
    }, theme);
    await page.route('**/api/config', route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({available_models:{image:[]},api_providers:[]}),
    }));
    await page.route('**/api/batch-generation/history', route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({batches:[batch]}),
    }));
    await page.route('**/api/batch-generation/batches/issue-87-gallery', route => route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify(batch),
    }));

    await page.goto(`${baseUrl}/static/online.html`, {waitUntil:'networkidle'});
    await page.click('#batchHistoryButton');
    await page.click('[data-open-batch="issue-87-gallery"]');
    await page.waitForSelector('#batchDetailStep:not([hidden]) [data-batch-output-index]');

    const models = await page.locator('[data-batch-output-index] .batch-result-model').evaluateAll(items => items.map(item => {
        const display = item.querySelector('.batch-model-display');
        const icon = item.querySelector('.model-vendor-icon');
        const bounds = item.getBoundingClientRect();
        const iconBounds = icon?.getBoundingClientRect();
        return {
            text:display?.textContent.trim(),
            title:display?.getAttribute('title'),
            visible:getComputedStyle(item).display !== 'none' && bounds.width > 0 && bounds.height > 0,
            iconVisible:Boolean(iconBounds && iconBounds.width > 0 && iconBounds.height > 0),
            providerIcon:Boolean(icon?.querySelector('img')),
            fallbackIcon:Boolean(icon?.classList.contains('model-vendor-icon--fallback')),
        };
    }));
    const expected = [
        {text:'团队主力生图',title:'团队主力生图',providerIcon:true,fallbackIcon:false},
        {text:'unknown-image-v1',title:'unknown-image-v1',providerIcon:false,fallbackIcon:true},
    ];
    if (models.length !== expected.length || models.some((model, index) => (
        !model.visible || !model.iconVisible || model.text !== expected[index].text
        || model.title !== expected[index].title
        || model.providerIcon !== expected[index].providerIcon
        || model.fallbackIcon !== expected[index].fallbackIcon
    ))) {
        throw new Error(`${theme} gallery model identity is incorrect: ${JSON.stringify(models)}`);
    }

    const cards = page.locator('[data-batch-output-index]');
    if (await cards.count() !== 2 || await cards.locator('ic-button[download]').count() !== 2) {
        throw new Error(`${theme} gallery outputs or download actions changed`);
    }
    await cards.first().dblclick();
    await page.waitForFunction(() => document.querySelector('#batchImageEditModal')?.hasAttribute('open'));
    if (await page.locator('#batchImageCounter').textContent() !== '1 / 2') {
        throw new Error(`${theme} gallery preview navigation changed`);
    }
    await page.close();
}

(async () => {
    const browser = await chromium.launch({headless:true,executablePath:browserExecutable});
    try {
        await verifyTheme(browser, 'light');
        await verifyTheme(browser, 'dark');
        console.log('Issue #87 batch result gallery model browser smoke passed');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
