// Run against tests.batch_generation_browser_app, never a real Workspace.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const baseUrl=process.env.BATCH_GENERATION_BASE_URL || 'http://127.0.0.1:3117';
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    try {
        const page=await browser.newPage();
        await page.request.post(`${baseUrl}/api/auth/login`,{data:{username:'batch-browser-designer',password:'batch-browser-password'}});
        let reads=0;
        const batch={id:'recovery-test',name:'Recovery test',status:'running',created_at:1700000000,
            progress:{total:1,running:1},tasks:[],snapshot:{}};
        await page.route('**/api/batch-generation/history',route=>route.fulfill({json:{batches:[batch]}}));
        await page.route('**/api/batch-generation/batches/recovery-test',route=>{
            reads++;
            if(reads===2) return route.fulfill({status:503,json:{detail:'temporary test failure'}});
            return route.fulfill({json:{...batch,name:reads>=3?'Recovered result':batch.name,status:reads>=3?'completed':'running'}});
        });
        await page.goto(`${baseUrl}/static/online.html`,{waitUntil:'networkidle'});
        await page.click('#batchHistoryButton');
        await page.click('[data-open-batch="recovery-test"]');
        await page.waitForFunction(()=>document.querySelector('#batchDetailName').textContent==='Recovered result',null,{timeout:12000});
        assert.equal(reads,3);
        await page.evaluate(()=>window.StudioI18n.set('en'));
        await page.waitForFunction(()=>document.querySelector('#batchDetailStatus').textContent.trim()==='Completed');
        await page.evaluate(()=>window.StudioI18n.set('zh'));
        await page.waitForFunction(()=>document.querySelector('#batchDetailStatus').textContent.trim()==='已完成');
        console.log('PASS: real batch page recovers after a 503; English and Chinese completion states update');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
