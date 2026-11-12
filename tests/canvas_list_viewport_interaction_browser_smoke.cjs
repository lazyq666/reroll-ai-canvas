const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const records = Array.from({ length:48 }, (_, index) => ({
  id:`study-${String(index).padStart(2, '0')}`, title:`画面探索 ${String(index).padStart(2, '0')}`,
  project:'default', kind:'smart', owner_id:'designer', visibility:index % 3 ? 'shared' : 'private',
  created_by:index % 2 ? 'other' : 'designer',
  node_count:index + 1, updated_at:1800000000000 - index * 1000, created_at:1790000000000 + index * 1000,
  board_x:index * 5000, board_y:9000,
  cover_url:index % 2 ? '/static/images/test/fixture.svg' : '',
}));
const requests = [];
let fail = false;
let slowPending = false;
let delayReset = false;
const json = (response, payload, status = 200) => {
  response.writeHead(status, { 'Content-Type':'application/json' });
  response.end(JSON.stringify(payload));
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if(url.pathname.startsWith('/api/')){
    requests.push({ path:url.pathname, method:request.method, query:Object.fromEntries(url.searchParams) });
    if(url.pathname === '/api/auth/me') return json(response, { user:{ id:'designer', role:'admin', username:'Designer' } });
    if(url.pathname === '/api/account/agent-pairings') return json(response, { requests:[] });
    if(url.pathname === '/api/canvases/presence') return json(response, { canvases:Object.fromEntries(records.map(record => [record.id, []])) });
    if(url.pathname === '/api/projects') return json(response, { projects:[
      { id:'default', name:'视觉探索', canvas_count:48 },
      { id:'launch', name:'新品发布', canvas_count:0 },
    ] });
    if(url.pathname === '/api/canvases'){
      const query = url.searchParams;
      const search = query.get('search') || '';
      if(fail) return json(response, { detail:'fixture failure' }, 500);
      const items = records.filter(record => record.project === query.get('project')
        && (!query.get('visibility') || record.visibility === query.get('visibility'))
        && (query.get('mine') !== 'true' || record.created_by === 'designer')
        && record.title.includes(search));
      const sort = query.get('sort');
      const direction = query.get('direction') === 'asc' ? 1 : -1;
      items.sort((first, second) => direction * (sort === 'title'
        ? first.title.localeCompare(second.title)
        : first[sort === 'created' ? 'created_at' : 'updated_at'] - second[sort === 'created' ? 'created_at' : 'updated_at']));
      const offset = Number(query.get('cursor') || 0);
      const payload = { canvases:items.slice(offset, offset + 40), total:items.length, next_cursor:items.length > offset + 40 ? String(offset + 40) : '' };
      if(search === 'strasse') payload.canvases = [{ ...records[0], title:'Straße' }];
      if(delayReset && !query.get('cursor')) return setTimeout(() => json(response, payload), 500);
      if(search === 'slow'){
        slowPending = true;
        return setTimeout(() => { slowPending = false; json(response, payload); }, 900);
      }
      return json(response, payload);
    }
    return json(response, { canvases:[] });
  }
  const file = path.resolve(root, '.' + url.pathname);
  if(!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(file, (error, contents) => {
    if(error) return response.writeHead(404).end();
    response.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' });
    response.end(contents);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/static/canvas-list.html`);
    const ready = () => page.waitForFunction(() => document.querySelector('#board').getAttribute('aria-busy') === 'false');
    const titles = () => page.locator('.ws-card-title').allTextContents();
    const search = page.locator('#canvasSearch input');
    await ready();
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 40);
    assert.equal(await page.locator('#visibilityFilter').getAttribute('role'), 'radiogroup');
    assert.equal(await page.locator('#visibilityFilter [data-value="all"]').getAttribute('aria-checked'), 'true');
    await page.locator('#visibilityFilter [data-value="all"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 32);
    assert.equal(await page.locator('#visibilityFilter [data-value="shared"]').getAttribute('aria-checked'), 'true');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 40);
    assert.equal(await page.locator('ic-canvas-grid').count(), 1);
    assert.equal(await page.locator('ic-canvas-grid').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('ic-canvas-grid').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.equal(await page.locator('#boardResetView').count(), 0);
    assert.equal(await page.locator('#boardWorld').evaluate(element => getComputedStyle(element).transform), 'none');
    delayReset = true;
    await page.locator('#boardRefresh').click();
    await page.locator('#boardLoading').waitFor({ state:'visible' });
    assert.equal(await page.locator('#boardLoadMore').getAttribute('disabled'), '');
    await ready();
    delayReset = false;
    assert.equal(await page.locator('#boardLoadMore').getAttribute('disabled'), null);
    await page.locator('#board').hover();
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => document.querySelector('#board').scrollTop > 0);
    await page.locator('#boardLoadMore').click();
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 48);
    assert.equal(await page.locator('#boardLoadMore').isVisible(), false);
    await search.fill('47');
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 1);
    assert.deepEqual(await titles(), ['画面探索 47']);
    await page.locator('#visibilityFilter [data-value="mine"]').click();
    await page.locator('#boardEmptyHint').waitFor({ state:'visible' });
    assert.equal(await page.locator('#boardEmptyHint').getAttribute('title'), '没有匹配的画布');
    await page.locator('#emptyCreateCanvasBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 40);
    await page.locator('#visibilityFilter [data-value="mine"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 24);
    assert.deepEqual(await titles(), records.filter(record => record.created_by === 'designer').map(record => record.title));
    const mineRequest = requests.findLast(request => request.path === '/api/canvases');
    assert.equal(mineRequest.query.mine, 'true');
    assert.equal(mineRequest.query.visibility, '');
    await page.locator('#visibilityFilter [data-value="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 40);
    await page.locator('#canvasSort').click();
    await page.getByRole('option', { name:'创建时间', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.ws-card-title')?.textContent === '画面探索 47');
    await page.locator('#canvasDirection').click();
    await page.getByRole('option', { name:'升序', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('.ws-card-title')?.textContent === '画面探索 00');
    await search.fill('slow');
    await page.waitForRequest(request => new URL(request.url()).searchParams.get('search') === 'slow');
    await search.fill('46');
    await page.waitForFunction(() => document.querySelector('.ws-card-title')?.textContent === '画面探索 46');
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(slowPending, false);
    assert.deepEqual(await titles(), ['画面探索 46']);
    await search.fill('strasse');
    await page.waitForFunction(() => document.querySelector('.ws-card-title')?.textContent === 'Straße');
    fail = true;
    await search.fill('failure');
    await page.locator('#boardEmptyHint').waitFor({ state:'visible' });
    assert.equal(await page.locator('#boardEmptyHint').getAttribute('title'), '画布暂时无法加载');
    fail = false;
    await page.locator('#boardRefresh').click();
    await page.waitForFunction(() => document.querySelector('#boardEmptyHint').getAttribute('title') === '没有匹配的画布');
    await search.fill('');
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 40);
    await page.locator('#projectSearch input').fill('新品');
    assert.equal(await page.locator('.ws-project-row').count(), 1);
    await page.locator('.ws-project-row').click();
    await ready();
    await page.locator('#boardEmptyHint').waitFor({ state:'visible' });
    assert.equal(await page.locator('#listProjectName').textContent(), '新品发布');
    await page.locator('#projectSearch input').fill('');
    await page.locator('.ws-project-row[data-project-id="default"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 40);
    await page.locator('#trashEntry').click();
    await page.locator('#trashPanel.active').waitFor();
    await page.locator('#trashClose').click();
    await page.locator('#newCanvasBtn').click();
    await page.locator('#createCanvasName input').waitFor({ state:'visible' });
    await page.locator('#createCanvasCancel').click();
    await page.locator('.ws-card-menu').first().click();
    await page.locator('ic-menu.ws-card-pop[open]').waitFor();
    assert.equal(await page.locator('ic-menu-item[data-act="cut"]').getAttribute('label'), '迁移画布');
    await page.keyboard.press('Escape');
    assert.equal(requests.some(request => request.method === 'POST' && request.path.includes('/meta')), false);
    for(const width of [1920, 1440, 768, 390]){
      await page.setViewportSize({ width, height:900 });
      await page.locator('#board').evaluate(element => { element.scrollTop = 0; });
      await page.mouse.move(0, 0);
      await page.screenshot({ path:`/tmp/laz136-light-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#board').evaluate(element => element.scrollWidth <= element.clientWidth), true);
      assert.equal(await page.locator('#visibilityFilter').evaluate(element => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)'), true);
      if(width === 1920) assert.equal(await page.locator('#boardWorld').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 6);
      assert.equal(await page.locator('.ws-card-meta').first().evaluate(element =>
        getComputedStyle(element).color === getComputedStyle(element.querySelector('.ws-card-time')).color
        && getComputedStyle(element).color === getComputedStyle(element.querySelector('.ws-card-nodes')).color), true);
    }
    await page.evaluate(() => {
      window.postMessage({ type:'studio-lang', lang:'en' }, location.origin);
      document.documentElement.classList.add('studio-theme-dark', 'theme-dark');
    });
    await page.waitForFunction(() => document.querySelector('#canvasSearch').getAttribute('placeholder') === 'Search canvases');
    assert.equal(await page.locator('#visibilityFilter [data-value="all"]').textContent(), 'All canvases');
    assert.equal(await page.locator('#visibilityFilter [data-value="mine"]').textContent(), 'Mine');
    assert.equal(await page.locator('#visibilityFilter').getAttribute('aria-label'), 'Canvas categories');
    assert.equal(await page.locator('#board').getAttribute('aria-label'), 'Canvas list');
    await page.waitForFunction(() => document.querySelector('#canvasSort').displayLabel === 'Date created');
    assert.equal(await page.locator('#canvasDirection').evaluate(element => element.displayLabel), 'Ascending');
    await page.setViewportSize({ width:1440, height:900 });
    await page.locator('#board').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path:'/tmp/laz136-dark-en.png' });
    await page.locator('.ws-card-menu').first().click();
    await page.locator('ic-menu.ws-card-pop[open]').waitFor();
    assert.equal(await page.locator('ic-menu-item[data-act="cut"]').getAttribute('label'), 'Move canvas');
    await page.keyboard.press('Escape');
    await page.locator('.ws-card').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/smart-canvas\.html\?id=study-00/);
    assert.deepEqual(errors, []);
    console.log('PASS: grid scrolling, pagination, global search, visibility, sorting, stale responses, recovery, project search, menus, trash, creation entry, bilingual themes, responsive widths and keyboard navigation');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
