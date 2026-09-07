const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const ROOT = require('node:path').resolve(__dirname, '..');
const PORT = 19500 + Math.floor(Math.random() * 400);
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const preview = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd:ROOT, env:{...process.env, API_SETTINGS_PREVIEW_PORT:String(PORT)}, stdio:['ignore','pipe','pipe'],
  });
  let browser;
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('Preview did not start')),10000);
      preview.stdout.on('data',chunk=>{if(String(chunk).includes('API Settings preview:')){clearTimeout(timer);resolve();}});
      preview.once('exit',code=>{clearTimeout(timer);reject(new Error(`Preview exited: ${code}`));});
    });
    browser = await chromium.launch({headless:true, executablePath:CHROME});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    let inventory={image:[{id:'test:model',model:'model',name:'Original',provider_id:'test',provider_name:'Test',visible:true}],video:[],text:[]};
    let applied=0, previews=0, exports=0, exportedName='', failedSave=false, matrixReads=0;
    const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    await page.route('**/api/admin/available-models',route=>{
      if(route.request().method()==='PUT'){
        if(failedSave) return json(route,{detail:'Synthetic save failure'},500);
        const body=route.request().postDataJSON();
        for(const row of inventory.image) if(body.names?.[row.id]) row.name=body.names[row.id];
      }
      return json(route,{models:inventory});
    });
    await page.route('**/api/admin/model-capability-matrix',route=>{
      matrixReads++;
      return json(route,{models:applied?[{model_id:'restored',capability_tags:['transparent_png']}]:[]});
    });
    await page.route('**/api/providers/export-encrypted',route=>{
      exports++; exportedName=inventory.image[0].name;
      return route.fulfill({status:200,headers:{'Content-Disposition':'attachment; filename="test.icapi"'},body:'synthetic-backup'});
    });
    await page.route('**/api/providers/import-encrypted',route=>{
      const body=route.request().postDataBuffer().toString();
      if(body.includes('wrong-password')) return json(route,{detail:'api.packageImportFailed'},400);
      if(/name="preview"\r\n\r\ntrue/.test(body)){
        previews++;
        return json(route,{version:2,providers:['Test'],added:1,updated:0,models:1});
      }
      applied++;
      inventory={image:[{id:'test:restored',model:'restored',name:'Restored',provider_id:'test',provider_name:'Test',visible:false}],video:[],text:[]};
      return json(route,{added:[{id:'test',name:'Test'}],updated:[]});
    });
    await page.goto(`http://127.0.0.1:${PORT}/api-settings`,{waitUntil:'networkidle'});
    assert.equal(await page.locator('#apiTransferDialog, #apiSettingsImportInput, .api-transfer-group').count(),0);
    const apiPage = await page.context().newPage();
    await apiPage.route('**/api/providers', route => json(route, {providers:[{
      id:'test',name:applied?'Restored Provider':'Source Provider',protocol:'openai',base_url:'https://example.invalid/v1',
      has_key:true,enabled:true,image_models:['model'],chat_models:[],video_models:[],
    }]}));
    await apiPage.goto(`http://127.0.0.1:${PORT}/api-settings`,{waitUntil:'networkidle'});
    await apiPage.getByRole('tab',{name:'Source Provider OPENAI',exact:true}).waitFor();
    await page.goto(`http://127.0.0.1:${PORT}/static/available-model-management.html`,{waitUntil:'networkidle'});
    await page.evaluate(()=>StudioI18n.set('zh'));
    const password=page.locator('#apiTransferPassword input');
    const confirmation=page.locator('#apiTransferPasswordConfirm input');
    await page.locator('.model-name-input input').fill('Saved before backup');
    await page.locator('#export-model-settings').click();
    await password.fill('test-password');
    await confirmation.fill('mismatched-password');
    await page.locator('#api-transfer-submit').click();
    await page.waitForFunction(()=>!document.getElementById('api-transfer-error').hidden);
    assert.equal(exports,0);
    await confirmation.fill('test-password');
    await page.evaluate(()=>StudioI18n.set('en'));
    assert.match(await page.locator('#apiTransferTitle').textContent(),/Export/);
    assert.equal(await confirmation.inputValue(),'test-password');
    const download=page.waitForEvent('download');
    await page.locator('#api-transfer-submit').click();
    await download;
    await page.waitForFunction(()=>!document.getElementById('export-model-settings').disabled);
    assert.equal(exportedName,'Saved before backup');
    assert.equal(await password.inputValue(),'');
    const beginImport=async(secret)=>{
      const chooserPromise=page.waitForEvent('filechooser');
      await page.locator('#import-model-settings').click();
      const chooser=await chooserPromise;
      await chooser.setFiles({name:'test.icapi',mimeType:'application/octet-stream',buffer:Buffer.from('fixture')});
      await page.waitForFunction(()=>document.getElementById('apiTransferDialog').open);
      assert.equal(await confirmation.isVisible(),false);
      await password.fill(secret);
      await page.locator('#api-transfer-submit').click();
    };
    await beginImport('wrong-password');
    await page.waitForFunction(()=>{const el=document.getElementById('backup-message');return !el.hidden&&el.getAttribute('tone')==='danger';});
    assert.equal(applied,0);
    await beginImport('test-password');
    await page.waitForFunction(()=>document.getElementById('apiImportConfirmation').open);
    await page.locator('#apiImportConfirmation').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('import-model-settings').disabled);
    assert.equal(applied,0);
    const readsBefore=matrixReads;
    await beginImport('test-password');
    await page.waitForFunction(()=>document.getElementById('apiImportConfirmation').open);
    await page.locator('#apiImportConfirmation').getByRole('button',{name:'Import',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.model-id')?.textContent==='restored');
    await page.locator('.model-capability-tags ic-badge').waitFor();
    assert.equal(applied,1);
    await apiPage.getByRole('tab',{name:'Restored Provider OPENAI',exact:true}).waitFor();
    assert.equal(previews,2);
    assert.ok(matrixReads>readsBefore);
    assert.equal(await page.locator('.model-visibility-checkbox').evaluate(el=>el.checked),false);
    await page.waitForFunction(()=>{const el=document.getElementById('backup-message');return !el.hidden&&el.getAttribute('tone')==='success';});
    failedSave=true;
    await page.locator('.model-name-input input').fill('Unsaved');
    await page.locator('#export-model-settings').click();
    await page.waitForFunction(()=>{const el=document.getElementById('page-message');return !el.hidden&&el.getAttribute('tone')==='danger';});
    assert.equal(exports,1,'a failed model save must prevent a stale backup');
    await page.evaluate(()=>{StudioI18n.set('zh');StudioTheme.set('dark');});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
    assert.deepEqual(errors,[]);
    console.log('Model-page backup: save-before-export, validation, download, cancel, bad password, preview/apply, inventory/capability refresh, failed-save protection, i18n and narrow layout passed');
  } finally {
    if(browser) await browser.close();
    preview.kill('SIGTERM');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
