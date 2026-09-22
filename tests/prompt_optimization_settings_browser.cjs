const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
    '.css':'text/css; charset=utf-8',
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.svg':'image/svg+xml',
};
const tinyImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" fill="%234c8bf5"/%3E%3C/svg%3E';

function startServer(){
    return new Promise((resolve, reject) => {
        const server = http.createServer((request, response) => {
            const requestPath = decodeURIComponent(
                new URL(request.url, 'http://127.0.0.1').pathname,
            );
            const filePath = path.resolve(ROOT, `.${requestPath}`);
            if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)){
                response.writeHead(403).end('Forbidden');
                return;
            }
            fs.readFile(filePath, (error, body) => {
                if(error){
                    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
                    return;
                }
                response.writeHead(200, {
                    'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream',
                }).end(body);
            });
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

(async()=>{
 const server=await startServer();const browser=await chromium.launch({headless:true,executablePath:CHROME});
 const page=await browser.newPage({viewport:{width:900,height:800}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let config={version:2,image:{provider:'',model:'',instructions:{}},video:{provider:'',model:'',instructions:{}}},saved=0,fail=false;
 await page.route('**/api/prompt-optimization-settings',async route=>{
   if(route.request().method()==='PUT'){
     if(fail) return route.fulfill({status:500,body:'failed'});
     config=route.request().postDataJSON();saved++;
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(config)});
 });
 await page.route('**/api/available-models',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({models:{text:[{id:'test:text',provider_id:'test',provider_name:'Test provider',model:'text-model',name:'Text model'}]}})}));
 try {
   await page.goto(`http://127.0.0.1:${server.address().port}/static/prompt-optimization-settings.html`);
   await page.waitForFunction(()=>!document.querySelector('#settingsForm').inert);
   const input=page.locator('#optimizationInstructions').getByRole('textbox');
   await input.fill('Keep the subject and simplify the wording.');
   await page.evaluate(()=>{const picker=document.querySelector('#optimizationModel');picker.value='test:text';picker.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#saveOptimizationSettings').getByRole('button').click();
   await page.waitForFunction(()=>document.querySelector('#settingsMessage').getAttribute('tone')==='success');
   assert.equal(saved,1);assert.equal(config.image.provider,'test');assert.equal(config.image.model,'text-model');assert.equal(config.image.instructions.smart,'Keep the subject and simplify the wording.');
   await page.reload();await page.waitForFunction(()=>!document.querySelector('#settingsForm').inert);
   assert.equal(await input.inputValue(),config.image.instructions.smart);
   assert.equal(await page.locator('#optimizationPreset option[value="camera"]').count(),0);
   await page.evaluate(()=>{const picker=document.querySelector('#optimizationMedia');picker.value='video';picker.dispatchEvent(new Event('change',{bubbles:true}));});
   assert.equal(await page.evaluate(()=>document.querySelector('#optimizationModel').value),'__default__');
   await input.fill('Keep motion continuous.');
   assert.equal(await page.locator('#optimizationPreset').isVisible(),true);
   await page.evaluate(()=>{const picker=document.querySelector('#optimizationPreset');picker.value='camera';picker.dispatchEvent(new Event('change',{bubbles:true}));});
   await input.fill('Track the subject steadily.');
   await page.evaluate(()=>{const picker=document.querySelector('#optimizationMedia');picker.value='image';picker.dispatchEvent(new Event('change',{bubbles:true}));});
   assert.equal(await input.inputValue(),config.image.instructions.smart);
   assert.equal(await page.evaluate(()=>document.querySelector('#optimizationModel').value),'test:text');
   await page.locator('#saveOptimizationSettings').getByRole('button').click();
   await page.waitForFunction(()=>!document.querySelector('#settingsForm').inert);
   assert.equal(config.video.instructions.smart,'Keep motion continuous.');
   assert.equal(config.video.provider,'');
   assert.equal(config.video.default_preset,'camera');
   assert.equal(config.image.default_preset,'smart');
   assert.equal(config.video.instructions.camera,'Track the subject steadily.');
   await page.reload();await page.waitForFunction(()=>!document.querySelector('#settingsForm').inert);
   await page.evaluate(()=>{const picker=document.querySelector('#optimizationMedia');picker.value='video';picker.dispatchEvent(new Event('change',{bubbles:true}));});
   assert.equal(await page.evaluate(()=>document.querySelector('#optimizationPreset').value),'camera');
   assert.equal(await input.inputValue(),'Track the subject steadily.');
   await page.evaluate(()=>{const picker=document.querySelector('#optimizationMedia');picker.value='image';picker.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.evaluate(()=>StudioI18n.set('en'));
   assert.equal(await page.locator('#saveOptimizationSettings').textContent(),'Save settings');
   assert.equal(await input.inputValue(),config.image.instructions.smart,'language change preserves drafts');
   assert.equal(await page.evaluate(()=>document.querySelector('#optimizationPreset').displayLabel),'Smart optimization');
   fail=true;await input.fill('Unsaved edits');await page.locator('#saveOptimizationSettings').getByRole('button').click();
   await page.waitForFunction(()=>document.querySelector('#settingsMessage').getAttribute('tone')==='danger');
   assert.equal(await input.inputValue(),'Unsaved edits');
   await page.screenshot({path:'/tmp/laz37-settings.png',animations:'disabled'});
   assert.deepEqual(errors,[]);console.log('Optimization settings browser acceptance passed');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
