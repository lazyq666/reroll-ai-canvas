const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const ROOT = require('node:path').resolve(__dirname, '..');
const PORT = 19500 + Math.floor(Math.random() * 400);
const browserExecutable = process.env.API_SETTINGS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function waitForPreview(server){
  return new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(new Error('Preview did not start: '+output)),10000);
    const inspect=chunk=>{output+=chunk;if(output.includes('API Settings preview:')){clearTimeout(timer);resolve();}};
    server.stdout.on('data',inspect);server.stderr.on('data',inspect);
    server.once('exit',code=>{clearTimeout(timer);reject(new Error('Preview exited: '+code));});
  });
}
(async()=>{
  const preview=spawn('node',['tests/api_settings_browser_app.cjs'],{cwd:ROOT,env:{...process.env,API_SETTINGS_PREVIEW_PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
  let browser;
  let release=()=>{};
  try {
    await waitForPreview(preview);
    browser=await chromium.launch({headless:true,executablePath:browserExecutable});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(5000);
    let requests=0;
    let providerReads=0;
    let providerWrites=0;
    page.on('request',request=>{
      if(new URL(request.url()).pathname!=='/api/providers') return;
      if(request.method()==='GET') providerReads++;
      if(request.method()==='PUT') providerWrites++;
    });
    let nextResponse;
    const response=(body,status=200)=>{
      let resolve;
      const gate=new Promise(done=>{resolve=done;});
      nextResponse={body,status,gate};
      release=resolve;
    };
    await page.route('**/api/providers/test-connection',async route=>{
      requests++;
      const current=nextResponse;
      assert.ok(current,'Unexpected extra connection check');
      nextResponse=null;
      await current.gate;
      await route.fulfill({status:current.status,contentType:'application/json',body:JSON.stringify(current.body)});
    });
    await page.goto(`http://127.0.0.1:${PORT}/api-settings`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof selectProvider==='function' && document.querySelector('[data-value="modelscope"]'));
    await page.waitForFunction(()=>!document.querySelector('ic-toast[data-ic-overlay]'));
    await page.evaluate(()=>selectProvider('long-provider-name'));
    const button=page.locator('#testUrlBtn');
    const result=page.locator('#connectionVerificationResult');
    const settled=()=>page.waitForFunction(()=>!document.querySelector('#testUrlBtn').loading);

    response({ok:false,status:401,message:'Invalid API key (test fixture)'});
    await button.click();
    const box=await button.boundingBox();
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    // The handler also guards duplicate programmatic/keyboard activations.
    await page.evaluate(()=>{void testConnection();void testConnection();});
    await page.waitForTimeout(100);
    assert.equal(requests,1,'One active check must issue only one request');
    assert.equal(await button.evaluate(el=>el.loading),true);
    assert.equal(await button.locator("button").isDisabled(),true);
    const loadingToasts=await page.locator('ic-toast[data-ic-overlay]').allTextContents();
    assert.deepEqual(loadingToasts,[]);
    release();
    await settled();
    await page.waitForTimeout(4600);
    assert.equal(await result.isVisible(),true,'Failure must survive the former toast lifetime');
    assert.match(await result.textContent(),/401.*Invalid API key/);
    for(const language of ['en','zh']){
      await page.evaluate(lang=>window.StudioI18n.set(lang),language);
      assert.equal(await result.getAttribute('heading'),language==='zh'?'API 连接检测失败':'API connection check failed');
      assert.match(await result.textContent(),language==='zh'?/地址验证未通过/:/URL verification failed/);
    }
    for(const dark of [true,false]){
      await page.evaluate(value=>{
        document.documentElement.classList.toggle('studio-theme-dark',value);
        document.documentElement.classList.toggle('theme-dark',value);
      },dark);
      const rect=await result.boundingBox();
      assert.ok(rect.width>0 && rect.height>0 && rect.x>=0 && rect.x+rect.width<=1440);
    }
    await result.locator('.dismiss').click();
    await page.evaluate(()=>window.StudioI18n.set('en'));
    assert.equal(await result.isVisible(),false,'Language changes must not restore dismissed results');

    const readsBeforeCheck=providerReads;
    const writesBeforeCheck=providerWrites;
    response({ok:true,model_count:2,all:['image-test','text-test'],image_models:['image-test'],chat_models:['text-test'],video_models:[],protocol:'openai',image_request_mode:'openai'});
    await button.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#testUrlBtn').loading);
    release();
    await settled();
    await page.waitForTimeout(100);
    const afterSuccessToasts=await page.locator('ic-toast[data-ic-overlay]').allTextContents();
    assert.deepEqual(afterSuccessToasts,[], 'A successful check must not trigger repeated loading notifications');
    assert.equal(providerWrites,writesBeforeCheck,'Unchanged connection checks must not save settings');
    assert.equal(providerReads,readsBeforeCheck,'Unchanged checks must not reload providers');
    await page.evaluate(()=>{
      broadcastStudioApiChange();
      window.postMessage({type:'providers-changed',source:apiSettingsChangeSource},location.origin);
    });
    await page.waitForTimeout(150);
    assert.equal(providerReads,readsBeforeCheck,'Own broadcasts and shell echoes must be ignored');
    assert.equal(await result.getAttribute('tone'),'success');
    assert.match(await result.textContent(),/2 models found/);
    await page.evaluate(()=>window.StudioI18n.set('zh'));
    assert.match(await result.textContent(),/找到 2 个模型/);
    await page.waitForTimeout(4600);
    assert.equal(await result.isVisible(),true);

    response({detail:'Gateway unavailable (test fixture)'},503);
    await button.click();release();await settled();
    assert.equal(await result.getAttribute('tone'),'danger');
    assert.match(await result.textContent(),/503.*Gateway unavailable/);

    response({ok:false,status:401,message:'Stale rejection'});
    await button.click();
    await page.getByRole('tab',{name:'RunningHub',exact:true}).click();
    release();await settled();
    assert.equal(await result.isVisible(),false,'Old results must not appear under another provider');
    await page.evaluate(()=>selectProvider('long-provider-name'));

    response({ok:false,status:401,message:'Old credentials'});
    await button.click();
    await page.locator('#baseInput').locator('input').fill('https://updated.example.test/v1');
    release();await settled();
    assert.equal(await result.isVisible(),false,'An edited connection invalidates its pending result');

    response({ok:false,status:0,message:''});
    await button.click();release();await settled();
    assert.match(await result.textContent(),/未收到平台响应/);
    assert.doesNotMatch(await result.textContent(),/HTTP 0/);
    const writesBeforeDetection=providerWrites;
    const readsBeforeDetection=providerReads;
    response({ok:true,model_count:2,all:['image-test','text-test'],image_models:['image-test'],chat_models:['text-test'],video_models:[],protocol:'openai',image_request_mode:'openai-json'});
    await button.click();release();await settled();
    await page.waitForTimeout(150);
    assert.equal(providerWrites,writesBeforeDetection+1,'Changed detected settings must still be saved');
    assert.equal(providerReads,readsBeforeDetection,'Saving a detected setting must not reload itself');
    assert.equal(await result.getAttribute('tone'),'success');
    const writesBeforeProtocol=providerWrites;
    response({ok:true,model_count:1,all:['text-test'],image_models:[],chat_models:['text-test'],video_models:[],protocol:'gemini',image_request_mode:'openai'});
    await button.click();release();await settled();
    assert.equal(await result.getAttribute('tone'),'success');
    assert.equal(providerWrites,writesBeforeProtocol+1,'Detected protocol changes save once and retain their result');
    assert.equal(requests,8);
    console.log('PASS: one active check, durable success/failure, retry, HTTP/network errors, stale-result guards, dismissal, keyboard, Chinese/English, Light/Dark');
  } finally {
    release();
    await browser?.close();
    preview.kill('SIGTERM');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
