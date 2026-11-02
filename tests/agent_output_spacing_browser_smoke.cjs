const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {chromium} = require('playwright');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');

function assertSpaced({rects, frame}) {
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    assert.ok(a.x >= frame.x && a.y >= frame.y
      && a.x + a.width <= frame.x + frame.width && a.y + a.height <= frame.y + frame.height,
    `Output escaped Frame: ${JSON.stringify({a, frame})}`);
    for (const b of rects.slice(i + 1)) {
      assert.ok(a.x + a.width + 63.9 <= b.x || b.x + b.width + 63.9 <= a.x
        || a.y + a.height + 63.9 <= b.y || b.y + b.height + 63.9 <= a.y,
      `Output overlap/gap lost: ${JSON.stringify({a, b})}`);
    }
  }
}

(async () => {
  const child = spawn(path.join(root, '.venv/bin/python'), ['tests/agent_output_spacing_browser_fixture.py'],
    {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  let logs = '', browser;
  child.stderr.on('data', data => { logs += data; });
  try {
    const auth = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error(`Fixture startup: ${logs}`)), 15000);
      child.stdout.on('data', data => {
        output += data;
        const line = output.split('\n').find(value => value.startsWith('{"port"'));
        if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(Error(`Fixture exited: ${logs}`)); });
    });
    const base = `http://127.0.0.1:${auth.port}`;
    browser = await chromium.launch({headless: true,
      executablePath: process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addCookies([{name: 'ic_session', value: auth.cookie, url: base}]);
    let providerRequests = 0;
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (/canvas-(image|video)-tasks|generate/.test(url.pathname) && route.request().method() === 'POST') {
        providerRequests++;
        return route.abort('blockedbyclient');
      }
      if (url.pathname.startsWith('/api/agent/') || url.pathname.startsWith('/api/account/')
        || ['/api/canvases/canvas-test', '/api/model-capabilities'].includes(url.pathname)) return route.continue();
      if (url.pathname === '/api/auth/me') return route.fulfill({json: {user: auth.user}});
      if (url.pathname === '/api/local-generation-submissions') return route.fulfill({json: {enabled: false}});
      const body = apiPayload(url.href);
      if (url.pathname === '/api/config') {
        body.api_providers = [{id:'apimart', name:'APIMART', enabled:true,
          image_models:['gpt-image-2-official'], video_models:[], chat_models:[]}];
        body.available_models.image = [{id:'apimart|gpt-image-2-official',
          provider_id:'apimart', model:'gpt-image-2-official', name:'GPT Image 2', visible:true}];
      }
      return route.fulfill({json: body});
    });
    const response = await fetch(`${base}/api/agent/v1/canvases/canvas-test/submissions`, {
      method: 'POST', headers: {Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json',
        'Idempotency-Key': 'browser-output-spacing'},
      body: JSON.stringify({tasks: Array.from({length: 20}, (_, i) => ({kind:'image', prompt:'An original test illustration',
        model:{provider_id:'apimart', model:'gpt-image-2-official'},
        params:{aspect_ratio:['1:1', '16:9', '9:16'][i % 3]}}))}),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/static/smart-canvas.html?id=canvas-test`);
    await page.waitForFunction(() => canvas?.id === 'canvas-test' && window.SmartCanvasModules.canvasPersistence.online());
    const portraitSizes = () => page.evaluate(() => ['normal-portrait','legacy-pending-size','user-resized-portrait'].map(id => {
      const node = nodes.find(n => n.id === id);
      const rect = nodeRect(node);
      const direct = singleImageLayout(node.images[0], node, nodeScale(node));
      return {size:[rect.width,rect.height], direct:[direct.width,direct.height], w:node.w, h:node.h};
    }));
    const expectedPortraits = await portraitSizes();
    assert.deepEqual(expectedPortraits.map(n => n.size), [[295,440],[295,440],[640,954]]);
    assert.deepEqual(expectedPortraits.map(n => n.direct), expectedPortraits.map(n => n.size));
    assert.equal(expectedPortraits[1].w, 440, 'Presentation must not rewrite legacy saved bounds');
    assert.equal(expectedPortraits[1].h, 440);
    const measure = () => page.evaluate(({ids, frameId}) => ({
      rects: ids.map(id => nodeRect(nodes.find(n => n.id === id))),
      frame: nodeRect(nodes.find(n => n.id === frameId)),
    }), {ids:result.task_ids, frameId:result.frame_id});
    const original = await measure();
    assertSpaced(original);
    // Keep actual run orchestration, pending sizing, output application and sync.
    // Replace only cost-bearing Provider submission with a deferred result.
    await page.evaluate(async ids => {
      const submitted = [];
      submitAndSettleGenerationProvider = async node => {
        submitted.push(node.id);
        return {deferred:true};
      };
      for (const id of ids) {
        await window.SmartCanvasModules.generationRun.run({nodeId:id, fromDraft:true});
        if (!submitted.includes(id) || !nodes.find(n => n.id === id).pending) throw Error(`Run did not prepare ${id}`);
        const node = nodes.find(n => n.id === id);
        if (node.generationMediaW !== node.w || node.generationMediaH !== node.h)
          throw Error(`Reused draft lost its stable preview bounds: ${id}`);
      }
      canvasPersistence.schedule(); await canvasPersistence.synced();
    }, result.task_ids);
    const pending = await measure();
    assertSpaced(pending);
    assert.ok(pending.rects.some(rect => rect.width >= 440), 'Actual pending sizing was not exercised');
    await page.evaluate(async ids => {
      ids.forEach((id, i) => {
        const node = nodes.find(n => n.id === id);
        const [w,h] = [[1024,1024], [1600,900], [900,1600]][i % 3];
        window.SmartCanvasModules.generationOutput.apply({node, strategy:'pending', kind:'image',
          outputs:[{url:`/assets/input/output-${i}.png`, kind:'image', natural_w:w, natural_h:h}]});
      });
      render(); canvasPersistence.schedule(); await canvasPersistence.synced();
    }, result.task_ids);
    assertSpaced(await measure());
    await page.reload();
    await page.waitForFunction(() => window.SmartCanvasModules.canvasPersistence.online());
    const reloaded = await measure();
    assertSpaced(reloaded);
    assert.deepEqual(await portraitSizes(), expectedPortraits, 'Preview sizes must survive save/reload and preserve user resize');
    assert.deepEqual(reloaded.rects.map(n => [n.x,n.y]), original.rects.map(n => [n.x,n.y]));
    assert.equal(providerRequests, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: 20 Agent tasks → actual run/pending → output → SQLite reload; gap >=64; legacy portrait sizes match; user resize preserved; zero Provider requests');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGINT');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
