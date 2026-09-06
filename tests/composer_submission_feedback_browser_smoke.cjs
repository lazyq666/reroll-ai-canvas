const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startManualServer() {
  const port = await reservePort();
  const child = spawn('python3', ['tests/smart_canvas_manual_server.py'], {
    cwd: root,
    env: { ...process.env, SMART_CANVAS_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Manual server startup timed out: ${output.join('')}`)), 10000);
    const check = chunk => {
      if (!chunk.toString().includes('Smart Canvas manual server:')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', check);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Manual server exited with ${code}: ${output.join('')}`));
    });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

async function stopManualServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGTERM');
}


async function scenario(context, baseUrl, {count=1, status='queued', lang='zh', failure=false, offline=false, keyboard=false, theme='light', empty=false, priorAlert=false, expanded=true}={}) {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const shouldRetry = failure;
  let requests = 0;
  const pageErrors=[];
  page.on('pageerror', error => pageErrors.push(error.message));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/canvas-image-tasks', async route => {
    if(route.request().method() !== 'POST') return route.continue();
    requests++;
    await gate;
    await route.fulfill({status:failure ? 400 : 200, contentType:'application/json', body:JSON.stringify(
      failure ? {detail:'Rejected test submission'} : {task_id:'composer-feedback-task',status,actor_id:'manual-test'}
    )});
  });
  await page.route('**/api/canvas-image-tasks/composer-feedback-task', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({id:'composer-feedback-task',status:'running'})
  }));
  try {
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-148-complex&manual=1&fixture=issue-148-complex`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => canvas?.id === 'issue-148-complex' && window.SmartCanvasModules?.canvasPersistence?.online?.()
      && document.querySelector('#runBtn')?.dataset.icContractStatus === 'ready');
    await page.evaluate(({count,lang,theme,offline,empty,priorAlert}) => {
      window.StudioI18n.set(lang);
      applyTheme(theme);
      const source = nodes.find(node => node.id === 'generator-source');
      source.referenceGenerationKind = 'image';
      source.runSettings = {...source.runSettings,count};
      source.x=420; source.y=260;
      viewport.x=0; viewport.y=0; viewport.scale=1;
      window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
      selectedId=source.id; selectedIds=[]; selectedImage={nodeId:'',index:-1};
      window.SmartCanvasModules.viewportSelection.selection.refresh();
      updateComposer();
      setPromptText(empty ? '' : 'Preserve my composer prompt');
      savePromptDraftForCurrent();
      if(priorAlert) toast('Earlier generation failed', {persistent:true,tone:'danger'});
      if(offline) generationRunOnline = () => false;
    }, {count,lang,theme,offline,empty,priorAlert});
    if(expanded){
      await page.locator('#composerFocusToggle').click();
      await page.waitForFunction(() => composer.classList.contains('focused'));
    }
    if(keyboard) {
      await page.locator('#runBtn').focus();
      await page.keyboard.press('Enter');
    } else await page.locator('#runBtn').click();
    if(empty){
      await page.waitForFunction(() => !runBtn.loading);
      assert.equal(await page.evaluate(() => composer.classList.contains('focused')), expanded);
      assert.equal(requests,0);
      return;
    }
    if(!offline){
      await page.waitForFunction(() => nodes.some(node => node.generationOperationId));
      const busy = await page.evaluate(() => ({loading:runBtn.loading, focused:composer.classList.contains('focused'), label:runBtn.label}));
      assert.equal(busy.loading, true, 'Composer must show primary icon button loading during submission');
      assert.equal(busy.focused, expanded, 'Do not change editing mode before acceptance');
      assert.equal(await page.locator('#runBtn').isVisible(),true,'Submitting button must remain visible in normal mode');
      const buttonBox = await page.locator('#runBtn').boundingBox();
      assert.ok(buttonBox && buttonBox.y >= 0 && buttonBox.y + buttonBox.height <= page.viewportSize().height, `Submitting button left the viewport: ${JSON.stringify(buttonBox)}`);
      assert.equal(busy.label, lang === 'zh' ? '正在提交…' : 'Submitting…');
      assert.equal(await page.evaluate(async () => {
        await runBtn.updateComplete;
        return !!runBtn.shadowRoot.querySelector('[part~="spinner"]');
      }),true,'Use the public primary button spinner');
      // Exercise the host handler too: duplicate intent must be blocked even before rendering updates.
      await page.evaluate(() => { runBtn.onclick(); runBtn.onclick(); });
      await page.waitForTimeout(100);
      assert.equal(requests, 1);
      const nextLang = lang === 'zh' ? 'en' : 'zh';
      await page.evaluate(value => window.StudioI18n.set(value), nextLang);
      await page.waitForFunction(value => runBtn.label === value, nextLang === 'en' ? 'Submitting…' : '正在提交…');
      await page.evaluate(value => window.StudioI18n.set(value), lang);
      release();
    }
    await page.waitForFunction(() => !runBtn.loading);
    if(failure){
      assert.equal(await page.evaluate(() => composer.classList.contains('focused')), expanded);
      assert.equal(await page.locator('ic-toast[data-i18n="smart.generationQueued"]').count(), 0);
      assert.ok(await page.evaluate(() => promptInput.textContent.includes('Preserve my composer prompt')));
      failure=false;
      await page.locator('#runBtn').click();
      await page.waitForFunction(() => !runBtn.loading && !composer.classList.contains('focused'));
      await page.locator('ic-toast[data-i18n="smart.generationQueued"]').waitFor({state:'visible'});
      assert.equal(requests,2,'Failure must allow a successful retry, even with an existing failure Alert');
    } else {
      await page.waitForFunction(() => !composer.classList.contains('focused'));
      const key = offline ? 'smart.generationSavedOffline' : status === 'queued' ? 'smart.generationQueued' : 'smart.generationSubmitted';
      const message = page.locator(`ic-toast[data-i18n="${key}"]`);
      await message.waitFor({state:'visible'});
      assert.equal(await message.count(), 1);
      assert.ok(await page.evaluate(() => promptInput.textContent.includes('Preserve my composer prompt')));
      assert.equal(await page.evaluate(() => runBtn.disabled), false, 'Accepted runs must allow another intentional submission');
      await page.evaluate(value => window.StudioI18n.set(value), lang === 'zh' ? 'en' : 'zh');
      const translated = offline ? (lang === 'zh' ? 'Saved. Will submit when back online.' : '已保存，联网后提交')
        : status === 'queued' ? (lang === 'zh' ? 'Added to queue' : '已加入队列')
        : (lang === 'zh' ? 'Generation submitted' : '生成任务已提交');
      assert.equal(await message.textContent(), translated);
      await page.screenshot({path:`/tmp/composer-feedback-${count}-${theme}-${offline ? 'offline' : status}.png`});
    }
    assert.equal(requests, offline ? 0 : shouldRetry ? 2 : 1);
    assert.deepEqual(pageErrors,[]);
  } finally { release(); await page.close(); }
}

(async () => {
  const server = await startManualServer();
  let browser;
  try {
    browser = await chromium.launch({headless:true,executablePath:browserExecutable});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    for(const options of [
      {expanded:false}, {expanded:false,count:3}, {expanded:false,failure:true},
      {}, {count:3,lang:'en',theme:'dark',keyboard:true}, {status:'running'},
      {failure:true}, {count:3,failure:true}, {offline:true}, {empty:true}, {priorAlert:true},
    ]) await scenario(context,server.url,options);
    console.log('PASS: Composer loading, duplicate guard, acceptance before completion, queue/submitted/offline feedback, failure preservation, batch, keyboard, Light/Dark, language switching');
  } finally { await browser?.close(); await stopManualServer(server.child); }
})().catch(error => { console.error(error); process.exitCode=1; });
