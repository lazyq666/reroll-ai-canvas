const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webm':'video/webm','.woff2':'font/woff2','.json':'application/json'};
let dismissed = new Set();
let updateRequests = 0;
let updateAvailable = true;

function items() {
  return [
    {
      id:'codex', display_name:'Codex CLI', state:updateAvailable ? 'update_available' : 'current',
      update_available:updateAvailable, local_version:updateAvailable ? '1.0.0' : '2.0.0',
      available_version:'2.0.0', release_date:'2026-09-04',
      release_notes:'<img src=x onerror="window.__remoteNoteExecuted=true"> Safer notification flow',
      source_url:'https://github.com/openai/codex/releases/latest', channel:'npm'
    },
    {
      id:'jimeng', display_name:'Dreamina CLI', state:'uncomparable', update_available:false,
      local_version:'', local_display_version:'34f0ca9', raw_version:'build 34f0ca9', available_version:'1.1.0',
      local_build_time:'2026-07-13T15:39:22Z', release_date:'2026-08-18',
      detail_key:'cliUpdates.uncomparableDreamina', source_url:'https://jimeng.jianying.com/cli'
    },
    {id:'gemini-cli', display_name:'Antigravity CLI', state:'current', update_available:false, local_version:'1.1.25', available_version:'1.1.25'}
  ];
}
function snapshot() {
  const value = items();
  return {session_id:'browser-session', checking:false, items:value, notification_items:value.filter(item=>item.update_available&&!dismissed.has(item.id))};
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/auth/me') return response.end(JSON.stringify({user:{id:'admin-1',username:'admin',display_name:'Admin',role:'admin'}}));
  if (url.pathname === '/api/admin/cli-updates' && request.method === 'GET') return response.end(JSON.stringify(snapshot()));
  if (url.pathname === '/api/admin/cli-updates/check') return response.end(JSON.stringify(snapshot()));
  if (url.pathname === '/api/admin/cli-updates/dismiss') {
    let body=''; request.on('data', chunk=>body+=chunk); return request.on('end',()=>{
      for(const id of JSON.parse(body||'{}').cli_ids||[]) dismissed.add(id);
      response.end(JSON.stringify(snapshot()));
    });
  }
  if (url.pathname === '/__test/no-updates' && request.method === 'POST') {
    updateAvailable = false;
    dismissed = new Set();
    return response.end(JSON.stringify({ok:true}));
  }
  if (/\/api\/admin\/cli-updates\/[^/]+\/update$/.test(url.pathname)) updateRequests += 1;
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type','application/json');
    return response.end(JSON.stringify({canvases:[],projects:[],active:null}));
  }
  const requested = url.pathname === '/' ? '/static/index.html' : url.pathname;
  const file = path.resolve(root, `.${decodeURIComponent(requested)}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(response);
});

async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true, executablePath:process.env.CLI_UPDATE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:850}});
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('cliUpdateDialog')?.open);
    assert.equal(await page.locator('#cliUpdateDialog').getAttribute('label'),'CLI 版本提醒');
    assert.equal(await page.locator('.cli-update-item').count(),2,'only updates and secondary diagnostic states are shown');
    assert.equal(await page.locator('.cli-update-item[data-cli-id="gemini-cli"]').count(),0,'up-to-date CLIs are omitted');
    assert.equal(await page.locator('.cli-update-intro').count(),0,'redundant explanatory copy is removed');
    assert.equal(await page.locator('#cliUpdateDialog > [slot="footer"]').count(),0,'the dialog has no redundant footer actions');
    assert.equal(await page.locator('.cli-update-item[data-cli-id="codex"] .cli-update-state').textContent(),'更新可用');
    assert.equal(await page.locator('.cli-update-item[data-cli-id="jimeng"] .cli-update-state').textContent(),'无法判断');
    assert.deepEqual(await page.locator('.cli-update-item[data-cli-id="codex"] .cli-update-version-value').allTextContents(),['1.0.0','2.0.0']);
    assert.deepEqual(await page.locator('.cli-update-item[data-cli-id="jimeng"] .cli-update-version-caption').allTextContents(),['本机构建','官方发行']);
    assert.equal(await page.locator('.cli-update-item[data-cli-id="jimeng"] .cli-update-item-date').textContent(),'本机构建 2026-07-13 15:39:22 UTC · 官方发布 2026-08-18');
    assert.equal(await page.locator('.cli-update-item .cli-update-icon img').count(),2,'known CLI icons are visible');
    const tones = await page.evaluate(() => ({
      update: getComputedStyle(document.querySelector('.cli-update-state.is-update')).color,
      secondary: getComputedStyle(document.querySelector('.cli-update-state.is-secondary')).color,
      secondarySurface: getComputedStyle(document.querySelector('.cli-update-item.is-secondary')).backgroundColor,
      secondaryIcon: getComputedStyle(document.querySelector('.cli-update-item.is-secondary .cli-update-icon img')).filter,
    }));
    assert.notEqual(tones.update,tones.secondary,'update and indeterminate states have distinct emphasis');
    assert.equal(tones.secondarySurface,'rgba(0, 0, 0, 0)','secondary information does not need another card surface');
    assert.notEqual(tones.secondaryIcon,'none','the indeterminate CLI icon is neutralized');
    assert.equal(await page.getByText('更新',{exact:true}).count(),0,'the product exposes no CLI update action');
    assert.equal(await page.locator('.cli-update-item[data-cli-id="codex"] .cli-update-item-detail img').count(),0,'remote notes stay plain text');
    assert.equal(await page.evaluate(()=>window.__remoteNoteExecuted),undefined,'remote notes cannot execute');

    if (process.env.CLI_UPDATE_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.CLI_UPDATE_SCREENSHOT_DIR,{recursive:true});
      await page.waitForFunction(()=>!document.getElementById('studioEntryMotion'));
      await page.screenshot({path:path.join(process.env.CLI_UPDATE_SCREENSHOT_DIR,'cli-update-light.png')});
      await page.evaluate(()=>StudioTheme.set('dark'));
      await page.screenshot({path:path.join(process.env.CLI_UPDATE_SCREENSHOT_DIR,'cli-update-dark.png')});
      await page.evaluate(()=>StudioTheme.set('light'));
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(process.env.CLI_UPDATE_SCREENSHOT_DIR,'cli-update-mobile.png')});
      await page.setViewportSize({width:1280,height:850});
    }

    await page.evaluate(()=>StudioI18n.set('en'));
    await page.waitForFunction(()=>document.getElementById('cliUpdateDialog').label==='CLI version updates');
    assert.equal(await page.locator('.cli-update-item[data-cli-id="codex"] .cli-update-state').textContent(),'Update available');
    assert.match(await page.locator('.cli-update-item[data-cli-id="jimeng"] .cli-update-item-detail').textContent(),/build identity/);
    assert.match(await page.locator('.cli-update-item[data-cli-id="jimeng"] .cli-update-item-detail').textContent(),/no reliable mapping/);
    assert.equal(await page.locator('.cli-update-item[data-cli-id="jimeng"] .cli-update-item-date').textContent(),'Local build 2026-07-13 15:39:22 UTC · Official release 2026-08-18');
    assert.equal(await page.locator('.cli-update-item[data-cli-id="codex"] .cli-update-item-bottom a').getAttribute('aria-label'),'View the official release page for Codex CLI');

    await page.locator('#cliUpdateDialog').getByRole('button',{name:'Close'}).click();
    await page.waitForFunction(()=>!document.getElementById('cliUpdateDialog').open);
    await page.waitForFunction(()=>fetch('/api/admin/cli-updates').then(response=>response.json()).then(data=>data.notification_items.length===0));
    assert.equal(dismissed.has('codex'),true);
    assert.equal(updateRequests,0,'the page never calls a CLI update endpoint');

    await page.request.post(`http://127.0.0.1:${server.address().port}/__test/no-updates`);
    const checked = page.waitForResponse(response=>response.url().endsWith('/api/admin/cli-updates/check'));
    await page.evaluate(()=>window.postMessage({type:'cli-update-check'}, window.location.origin));
    await checked;
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#cliUpdateDialog').evaluate(dialog=>dialog.open),false,'no dialog is shown when every CLI is current');
    assert.equal(await page.locator('.cli-update-item').count(),0,'no current CLI rows are rendered');
    assert.ok(errors.every(error=>/favicon|play\(\)/i.test(error)) , `unexpected page errors: ${errors.join('; ')}`);
    process.stdout.write(JSON.stringify({dialog:true,adminStartupNotification:true,attentionOnly:true,neutralIndeterminate:true,plainTextNotes:true,i18n:true,notificationOnly:true,closeDismiss:true,noUpdateNoDialog:true},null,2)+'\n');
  } finally {
    await browser.close(); server.close();
  }
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
