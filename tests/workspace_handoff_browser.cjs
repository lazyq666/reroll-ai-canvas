// Production handoff page and components; deterministic HTTP responses exercise UI states.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
let state = {state:'ready'}, error = '', accepted = '';
const code = 'a'.repeat(32);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/workspace-storage-settings') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({active:{workspace_directory:'/test/Workspace'}, configured:{}, cloud_records:{enabled:false}}));
  }
  if (pathname === '/preferences-fixture') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(`<script src="/static/js/i18n.js"></script><script type="module" src="/static/js/infinite-canvas-ui/core.js"></script><script src="/static/js/preferences.js"></script><iframe src="/static/smart-canvas.html?handoff-fixture"></iframe>`);
  }
  if (pathname === '/static/smart-canvas.html') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(`<script>window.blocked=true; window.prepared=0; window.SmartCanvasModules={preparePageRefresh:async()=>{window.prepared++; if(window.blocked)throw Error('unsaved');},pageRefreshBlocked:()=>window.blocked?'busy':'',canvasPersistence:{status:()=>({pending:window.blocked})}};</script>`);
  }
  if (pathname.startsWith('/api/runtime/')) {
    res.setHeader('Content-Type', 'application/json');
    if (['/api/runtime/recovery/handoff/conflicts', '/api/runtime/handoff/conflicts'].includes(pathname)) return res.end(JSON.stringify({
      current:{path:'.infinite-canvas-service/handoff.json',readable:true,size:10,modified_ns:0,sha256:'a'.repeat(64)},
      files:[{path:'.infinite-canvas-service/handoff-PC.json',kind:'record',readable:true,size:10,modified_ns:0,sha256:'a'.repeat(64),same_as_current:true}],
      snapshot:'confirmed-list',can_archive:true,backup_directory:'/test/device/conflicts'
    }));
    if (req.method === 'GET') return res.end(JSON.stringify(state));
    let text = ''; for await (const chunk of req) text += chunk;
    if (pathname === '/api/runtime/recovery/handoff') {
      accepted = JSON.parse(text).handoff_id;
      res.statusCode = 409; return res.end(JSON.stringify({code:'handoff.code'}));
    }
    if (error) { if (error === 'handoff.conflict') state = {state:'failed',code:error}; res.statusCode = 409; return res.end(JSON.stringify({code:error})); }
    state = {state:'sealed', id:code}; return res.end(JSON.stringify(state));
  }
  const relative = pathname === '/workspace-handoff' ? '/static/workspace-handoff.html' : pathname;
  const file = path.resolve(root, '.' + relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const type = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream';
    const bytes = fs.readFileSync(file); res.writeHead(200, {'Content-Type':type}); res.end(bytes);
  } catch (_) { res.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:900}});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/workspace-handoff`;
    await page.goto(url);
    await page.locator('#handoff-close').waitFor({state:'visible'});
    await page.waitForFunction(() => customElements.get('ic-button'));
    error = 'handoff.editors';
    await page.locator('#handoff-close').click();
    await page.waitForFunction(() => document.querySelector('#handoff-message').textContent.includes('仍有画布'));
    await page.evaluate(() => { StudioI18n.set('en'); StudioTheme.set('dark'); });
    assert.match(await page.locator('#handoff-message').innerText(), /Canvases are still open/);
    assert.equal(await page.locator('h1').innerText(), 'Safe workspace handoff');
    await page.screenshot({path:'/tmp/workspace-handoff-dark.png'});
    error = 'handoff.conflict';
    await page.locator('#handoff-close').click();
    await page.locator('#handoff-conflict-files').getByText('.infinite-canvas-service/handoff-PC.json', {exact:true}).waitFor({state:'visible'});
    assert.equal(await page.locator('#handoff-recovery').isVisible(), false);
    assert.equal(await page.locator('#handoff-archive').isVisible(), false);
    assert.equal(await page.locator('#handoff-close-conflicts-note').isVisible(), true);
    await page.reload();
    await page.locator('#handoff-conflict-files').getByText('.infinite-canvas-service/handoff-PC.json', {exact:true}).waitFor({state:'visible'});
    assert.match(await page.locator('#handoff-message').innerText(), /Conflicting copies/);
    error = '';
    await page.locator('#handoff-close').focus();
    await page.keyboard.press('Enter');
    await page.locator('#handoff-result').waitFor({state:'visible'});
    assert.equal(await page.locator('#handoff-code').innerText(), code);
    assert.equal(await page.locator('#handoff-close').isVisible(), false);
    assert.match(await page.locator('#handoff-message').innerText(), /Ready on this device/);
    await page.reload();
    await page.locator('#handoff-result').waitFor({state:'visible'});
    await page.setViewportSize({width:390,height:820});
    await page.evaluate(() => { StudioI18n.set('zh'); StudioTheme.set('light'); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path:'/tmp/workspace-handoff-light.png'});
    state = {state:'recovery', code:'handoff.required'};
    await page.reload();
    await page.locator('#handoff-recovery').waitFor({state:'visible'});
    assert.equal(await page.locator('#handoff-code').innerText(), '');
    assert.equal(await page.locator('#handoff-expected').evaluate(el => el.value || ''), '');
    await page.locator('#handoff-expected input').fill('previous-device-code');
    await page.locator('#handoff-accept').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#handoff-message').textContent.includes('编号不匹配'));
    assert.equal(accepted, 'previous-device-code');
    await page.locator('#handoff-conflicts').waitFor({state:'visible'});
    assert.match(await page.locator('#handoff-conflict-files').innerText(), /handoff-PC.json/);
    assert.equal(await page.locator('#handoff-confirm-conflicts').isChecked(), false);
    await page.locator('#handoff-confirm-conflicts').check();
    await page.locator('#handoff-archive').click();
    await page.waitForFunction(() => document.querySelector('#handoff-message').textContent.includes('编号不匹配'));
    assert.equal(await page.locator('#handoff-confirm-conflicts').isChecked(), false);
    await page.evaluate(() => StudioI18n.set('en'));
    assert.match(await page.locator('#handoff-message').innerText(), /code does not match/);
    // Production settings must wait for the Canvas save boundary inside its frame.
    state = {state:'ready'};
    await page.goto(`http://127.0.0.1:${server.address().port}/preferences-fixture`);
    await page.waitForFunction(() => window.openPreferencesModal && document.querySelector('iframe')?.contentWindow?.SmartCanvasModules);
    await page.evaluate(() => window.openPreferencesModal());
    await page.locator('[data-workspace-handoff]').click();
    await page.waitForFunction(() => document.querySelector('iframe').contentWindow.prepared === 1);
    assert.match(page.url(), /preferences-fixture/);
    assert.match(await page.locator('.preferences-message').innerText(), /尚未保存|not finished saving/);
    await page.evaluate(() => StudioI18n.set('en'));
    assert.match(await page.locator('.preferences-message').innerText(), /not finished saving/);
    await page.evaluate(() => { document.querySelector('iframe').contentWindow.blocked = false; });
    await page.locator('[data-workspace-handoff]').click();
    await page.waitForURL('**/workspace-handoff');
    assert.deepEqual(errors, []);
    console.log('PASS: production handoff page; close/block/reload/recovery, Chinese/English, light/dark, keyboard and narrow layout');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
