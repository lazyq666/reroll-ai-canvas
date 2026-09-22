// Cache stays enabled: no route interception, cache clearing, hard refresh or
// browser replacement between the old release and the upgrade in each case.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const providerName = 'provider-opaque-very-long-file-name.png';

async function ready(page) {
  await page.waitForFunction(() => window.SmartCanvasModules?.canvasPersistence?.online?.()
    && window.upgradeProbe?.worker, null, {timeout: 20000}).catch(async error => {
      throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(() => ({
        url:location.href, status:window.SmartCanvasModules?.canvasPersistence?.status?.(),
        probe:window.upgradeProbe, text:document.body.innerText.slice(0,200),
      })))}`);
    });
}

async function generate(page, taskId) {
  return page.evaluate(async taskId => {
    const node = nodes.find(item => item.id === 'target');
    const result = await window.SmartCanvasModules.generationRecovery.settle({
      node, submission: {state:'pending', kind:'image', tasks:[{taskId, kind:'image', actorId:'fixture-admin'}]},
    });
    if (result.state !== 'completed') throw new Error(`Unexpected settlement: ${result.state}`);
    // Deliberately leave completion to its normal automatic save timer.
    return node.images.map(item => item.name);
  }, taskId);
}

async function settled(page) {
  await page.waitForFunction(() => !window.SmartCanvasModules.canvasPersistence.status().pending);
}

(async () => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.env.ASSET_TEST_PYTHON || 'python3', ['tests/frontend_upgrade_fixture.py', String(port)], {cwd:root});
  let serverLog = '';
  server.stderr.on('data', chunk => { serverLog += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const control = async (url, body) => {
    const response = await fetch(base + url, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    assert.equal(response.ok, true, `${url}: ${response.status}`);
    return response.json();
  };
  let browser;
  try {
    for (let attempt=0; ; attempt++) {
      try { await control('/fixture/state'); break; }
      catch (error) {
        if (attempt >= 120 || server.exitCode !== null) throw new Error(`Fixture did not start: ${serverLog}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    browser = await chromium.launch({headless:true,
      ...(process.env.IC_BROWSER_BIN ? {executablePath:process.env.IC_BROWSER_BIN} : {}),
      args:[...(process.platform === 'darwin' ? ['--use-mock-keychain','--password-store=basic'] : []),
        ...(process.env.IC_BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
    });
    const reports = [];
    for (const broken of [true, false]) {
      await control('/fixture/reset', {});
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const session = await context.newCDPSession(page);
      await session.send('Network.enable'); // Observation only; cache remains enabled.
      let phase = 'old';
      const responses = [];
      const cacheHits = new Set();
      session.on('Network.requestServedFromCache', event => cacheHits.add(event.requestId));
      session.on('Network.responseReceived', event => responses.push({phase, id:event.requestId, url:event.response.url, cache:Boolean(event.response.fromDiskCache || event.response.fromPrefetchCache)}));
      const url = `${base}/static/smart-canvas.html?id=upgrade-fixture`;
      await page.goto(url);
      await ready(page);
      const oldURL = await page.locator('script[src*="/generation-output.js"]').getAttribute('src');
      const oldProbe = await page.evaluate(() => ({...window.upgradeProbe, css:getComputedStyle(document.documentElement).getPropertyValue('--upgrade-probe').trim()}));
      assert.deepEqual(oldProbe, {direct:'old',lazy:'old',worker:'old',css:'old'});
      assert.deepEqual(await generate(page, 'warmup'), [providerName], 'Old release must reproduce the long-name behavior');
      await settled(page);
      // A new target output, while preserving the browser's cache and storage.
      await page.evaluate(async () => {
        const node=nodes.find(item=>item.id==='target'); node.images=[];
        window.SmartCanvasModules.canvasPersistence.schedule();
        await window.SmartCanvasModules.canvasPersistence.save();
        await window.SmartCanvasModules.canvasPersistence.synced();
      });
      await control('/fixture/upgrade', {broken});
      phase = 'new';
      await page.reload({waitUntil:'load'}); // ordinary reload, same page/context
      await ready(page);
      const newURL = await page.locator('script[src*="/generation-output.js"]').getAttribute('src');
      const names = await generate(page, 'after-upgrade');
      await settled(page);
      const state = await control('/fixture/state');
      assert(state.tasks.includes('canvas-image-tasks/after-upgrade'));
      assert(state.mutations.length > 0);
      if (broken) {
        assert.equal(oldURL, newURL);
        assert.deepEqual(names, [providerName], 'Control must fail the short-name acceptance with stale URLs');
        assert.deepEqual(state.persisted.nodes.find(item=>item.id==='target').images.map(item=>item.name), [providerName]);
      } else {
        assert.notEqual(oldURL, newURL);
        assert.deepEqual(names, ['image-01.png']);
        assert.deepEqual(state.persisted.nodes.find(item=>item.id==='target').images.map(item=>item.name), names);
        const probe = await page.evaluate(() => ({...window.upgradeProbe, css:getComputedStyle(document.documentElement).getPropertyValue('--upgrade-probe').trim()}));
        assert.deepEqual(probe, {direct:'new',lazy:'new',worker:'new',css:'new'});
        const peer = await context.newPage();
        await peer.goto(url);
        await ready(peer);
        assert.deepEqual(await peer.evaluate(() => nodes.find(item=>item.id==='target').images.map(item=>item.name)), names);
        // Rename through the real dialog, then verify a live peer and reopen.
        await page.evaluate(() => { renameSmartNodeImage('target', 0); });
        const dialog = page.locator('#smartAssetNameDialog');
        await dialog.waitFor({state:'attached'});
        await page.waitForFunction(() => document.querySelector('#smartAssetNameDialog')?.dataset.motionState === 'open');
        await page.locator('#smartAssetNameInput input').fill('Manual name');
        await dialog.locator('ic-button[hierarchy="primary"]').click();
        await page.waitForFunction(() => nodes.find(item=>item.id==='target').images[0].name==='Manual name.png');
        await peer.waitForFunction(() => nodes.find(item=>item.id==='target').images[0].name==='Manual name.png');
        // Replay the same provider artifact via the production settlement path.
        assert.deepEqual(await generate(page, 'replay-after-rename'), ['Manual name.png']);
        await settled(page);
        await page.reload();
        await ready(page);
        assert.deepEqual(await page.evaluate(() => nodes.find(item=>item.id==='target').images.map(item=>item.name)), ['Manual name.png']);
        await page.evaluate(() => window.StudioI18n.set('en'));
        assert.equal(await page.evaluate(() => window.StudioI18n.t('smart.renameMedia')), 'Rename media');
        await page.evaluate(() => window.StudioI18n.set('zh-CN'));
        assert.equal(await page.evaluate(() => window.StudioI18n.t('smart.renameMedia')), '重命名素材');
      }
      // Prove cache reuse, including the stale module in the negative control.
      const cached = responses.filter(item=>item.phase==='new' && (item.cache || cacheHits.has(item.id)));
      assert(cached.some(item=>item.url.includes('/js/i18n-core.js?')), 'An unaffected script must actually reuse browser cache');
      if (broken) assert(cached.some(item=>item.url.includes('/generation-output.js?')), 'Negative control must execute a cached old module');
      assert.deepEqual(errors, []);
      reports.push({scenario:broken?'stale-url control':'synchronized upgrade', names, cachedResponses:cached.length,
        saved:true, ...(broken?{}:{dependencyGraph:true,peerSync:true,reopen:true,manualRename:true,languageSwitch:true})});
      await context.close();
    }
    console.log(JSON.stringify(reports, null, 2));
  } catch (error) {
    throw new Error(`${error.stack}\n${serverLog.slice(-5000)}`);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
