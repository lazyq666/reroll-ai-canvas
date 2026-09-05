// Run against tests.shared_run_slots_browser_app on SMART_CANVAS_BASE_URL.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8798';

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    const login = await context.request.post(`${base}/api/auth/login`, {
      data:{username:'shared-slots-test',password:'shared-slots-test-password'},
    });
    assert.equal(login.status(), 200);
    const {outputs} = await (await context.request.get(`${base}/_test/outputs`)).json();
    const errors = [];
    const report = [];
    for (const scenario of ['server-first','browser-first','reload-pending','offline']) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      let terminal = false;
      let polls = 0;
      await page.route(`**/api/canvas-image-tasks/run-${scenario}`, route => {
        polls++;
        return route.fulfill({json:{id:`run-${scenario}`,status:terminal?'succeeded':'running',
          created_at:1,updated_at:2,result:terminal?{image_items:outputs}:undefined}});
      });
      const ready = () => page.waitForFunction(() =>
        typeof canvas !== 'undefined' && canvas?.id && nodes.length >= 3
        && window.SmartCanvasModules?.canvasPersistence?.online?.());
      const settled = () => page.waitForFunction(() => nodes.length === 3
        && nodes.filter(n => n.generationOutputNode).every(n =>
          n.images?.length === 1 && !n.pending && !n.running && !n.pendingTasks?.length));
      const state = () => page.evaluate(() => nodes.filter(n => n.generationOutputNode)
        .sort((a,b) => a.generationSlotIndex - b.generationSlotIndex)
        .map(n => ({id:n.id,urls:n.images.map(i => i.url)})));
      const url = `${base}/static/smart-canvas.html?id=${scenario}`;
      await page.goto(url, {waitUntil:'domcontentloaded'});
      await ready();
      await page.waitForFunction(() => nodes.filter(n => n.pending === 1).length === 2);
      if (scenario === 'reload-pending') {
        await page.reload({waitUntil:'domcontentloaded'});
        await ready();
      }
      if (scenario === 'browser-first') {
        terminal = true;
        await settled();
        await page.evaluate(async () => {
          await window.SmartCanvasModules.canvasPersistence.save();
          await window.SmartCanvasModules.canvasPersistence.synced();
        });
      }
      if (scenario === 'offline') await page.goto('about:blank');
      const completed = await context.request.post(`${base}/_test/complete/${scenario}`);
      assert.equal(completed.status(), 200, await completed.text());
      terminal = true;
      if (scenario === 'offline') {
        await page.goto(url, {waitUntil:'domcontentloaded'});
        await ready();
      }
      await settled();
      const expected = outputs.map((output,index) => ({id:`slot-${index}`,urls:[output.url]}));
      assert.deepEqual(await state(), expected, scenario);
      const retry = await context.request.post(`${base}/_test/complete/${scenario}`);
      assert.equal(retry.status(), 200);
      for (let index = 0; index < 3; index++) {
        await page.reload({waitUntil:'domcontentloaded'});
        await ready();
        await settled();
        assert.deepEqual(await state(), expected, `${scenario}: reload ${index}`);
      }
      const saved = await (await context.request.get(`${base}/api/canvases/${scenario}`)).json();
      assert.equal(saved.canvas.nodes.length, 3);
      assert.deepEqual(saved.canvas.nodes.filter(n => n.generationOutputNode)
        .sort((a,b) => a.generationSlotIndex - b.generationSlotIndex)
        .map(n => n.images.map(i => i.url)), outputs.map(i => [i.url]));
      report.push({scenario,polls,nodes:3,outputs:2,reloads:3});
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({scenarios:report,pageErrors:errors}, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
