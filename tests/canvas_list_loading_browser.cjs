const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport:{ width:1200, height:800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    let cards = deferred();
    let projects = deferred();
    let cardRequests = 0;
    let projectRequests = 0;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let payload = {};
      let status = 200;
      if (url.pathname === '/api/auth/me') payload = { user:{ id:'loader-test', username:'test', role:'admin' } };
      if (url.pathname === '/api/canvases') {
        cardRequests++;
        const response = await cards.promise;
        payload = response.payload;
        status = response.status || 200;
      }
      if (url.pathname === '/api/projects') {
        projectRequests++;
        payload = await projects.promise;
      }
      await route.fulfill({ status, contentType:'application/json', body:JSON.stringify(payload) });
    });
    await page.goto(`${base}/static/canvas-list.html`);
    await page.waitForFunction(() => customElements.get('ic-loading') && document.querySelector('#boardLoading').shadowRoot);
    const loading = page.locator('#boardLoading');
    const empty = page.locator('#boardEmptyHint');
    const language = async value => {
      await page.evaluate(lang => window.postMessage({ type:'studio-lang', lang }, location.origin), value);
      await page.waitForFunction(lang => window.StudioI18n.lang() === lang, value);
    };
    await language('en'); // The App Shell sends this while the initial requests are pending.
    assert.equal(await loading.isVisible(), true);
    assert.equal(await empty.isVisible(), false, 'Pending canvas reads must not display the no-projects empty state under the loader');
    assert.equal(await loading.getAttribute('label'), 'Loading canvases');
    await language('zh');
    assert.equal(await loading.getAttribute('label'), '正在加载画布');
    cards.resolve({ payload:{ canvases:[], total:0 } });
    await page.waitForResponse(response => new URL(response.url()).pathname === '/api/canvases');
    await page.waitForTimeout(50);
    assert.ok(projectRequests > 0);
    assert.equal(await loading.isVisible(), true, 'Empty cards with unresolved project access must remain loading');
    assert.equal(await empty.isVisible(), false);
    if (process.env.CANVAS_LIST_LOADING_SCREENSHOT) await page.screenshot({ path:process.env.CANVAS_LIST_LOADING_SCREENSHOT });
    projects.resolve({ projects:[{ id:'default', name:'Default', order:0 }, { id:'empty-b', name:'Empty B', order:1 }] });
    await loading.waitFor({ state:'hidden' });
    await empty.waitFor({ state:'visible' });
    assert.equal(await empty.getAttribute('title'), '暂无画布');
    assert.equal(await empty.locator(':scope > span:not([slot])').textContent(), '为当前项目创建第一块画布');

    cards = deferred();
    await page.locator('.ws-project-row[data-project-id="empty-b"]').click();
    await loading.waitFor({ state:'visible' });
    assert.equal(await empty.isVisible(), false);
    cards.resolve({ payload:{ canvases:[], total:0 } });
    await loading.waitFor({ state:'hidden' });
    await empty.waitFor({ state:'visible' });
    assert.equal(await empty.getAttribute('title'), '暂无画布');

    cards = deferred(); projects = deferred();
    await page.locator('#boardRefresh').click();
    await loading.waitFor({ state:'visible' });
    assert.equal(await empty.isVisible(), false, 'Refresh must hide the previous empty state immediately');
    cards.resolve({ payload:{ canvases:[], total:0 } });
    projects.resolve({ projects:[] });
    await loading.waitFor({ state:'hidden' });
    await empty.waitFor({ state:'visible' });
    assert.match(await empty.locator(':scope > span:not([slot])').textContent(), /管理员/);

    cards = deferred(); projects = deferred();
    await page.locator('#boardRefresh').click();
    await loading.waitFor({ state:'visible' });
    cards.resolve({ status:500, payload:{ detail:'fixture failure' } });
    await loading.waitFor({ state:'hidden' });
    assert.equal(await empty.getAttribute('title'), '画布暂时无法加载');
    assert.deepEqual(errors, []);
    assert.equal(cardRequests, 4);
    console.log('PASS: loading, empty project, no access, refresh, failure and bilingual states are mutually exclusive');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
