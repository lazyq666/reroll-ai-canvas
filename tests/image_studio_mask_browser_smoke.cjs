const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROJECT_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const PYTHON = process.env.SMART_CANVAS_PYTHON
  || (fs.existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : 'python3');

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('manual server did not start')), 10000);
    child.once('exit', code => reject(new Error(`manual server exited with ${code}`)));
    child.stdout.on('data', chunk => {
      if (!String(chunk).includes('Smart Canvas manual server:')) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

(async () => {
  const port = await freePort();
  const server = spawn(PYTHON, ['tests/smart_canvas_manual_server.py'], {
    cwd:ROOT, env:{...process.env, SMART_CANVAS_PORT:String(port)},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({headless:true, executablePath:CHROME});
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${port}/static/smart-canvas.html?id=mask-regression&manual=1`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.imageStudio
      && document.querySelector('#imageEditModal')?.dataset.icContractStatus === 'ready'
      && typeof canvas !== 'undefined' && canvas
    ));
    await page.evaluate(() => {
      const source = document.createElement('canvas');
      source.width = 800;
      source.height = 600;
      source.getContext('2d').fillRect(0, 0, 800, 600);
      nodes.splice(0, nodes.length, {
        id:'mask-source', type:'smart-image', x:320, y:220, w:400, h:300,
        images:[{url:source.toDataURL(), name:'mask-source.png', kind:'image', natural_w:800, natural_h:600}],
      });
      canvas.nodes = nodes;
      canvas.connections = [];
      render();
      window.SmartCanvasModules.imageStudio.open({nodeId:'mask-source', imageIndex:0, mode:'mask', groupAware:false});
    });
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.open
      && document.querySelector('#editDrawCanvas')?.width === 800);
    const bounds = await page.locator('#editDrawCanvas').boundingBox();
    const point = (x, y) => [bounds.x + bounds.width * x, bounds.y + bounds.height * y];
    const alpha = (x, y) => page.locator('#editDrawCanvas').evaluate((el, p) =>
      el.getContext('2d').getImageData(Math.round(el.width * p[0]), Math.round(el.height * p[1]), 1, 1).data[3], [x, y]);
    await page.mouse.move(...point(0.2, 0.4));
    await page.mouse.down();
    await page.mouse.move(...point(0.5, 0.4), {steps:12});
    assert.ok(await alpha(0.2, 0.4) > 8, 'The start of a continuous mask stroke must survive later pointer moves');
    await page.mouse.move(...point(0.8, 0.4), {steps:12});
    await page.mouse.up();
    for (const x of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      assert.ok(await alpha(x, 0.4) > 8, `Continuous mask must retain x=${x}`);
    }
    await page.mouse.move(...point(0.2, 0.65));
    await page.mouse.down();
    await page.mouse.move(...point(0.8, 0.65), {steps:12});
    await page.mouse.up();
    assert.ok(await alpha(0.5, 0.4) > 8, 'A second stroke must preserve the first stroke');
    await page.locator('#maskUndoBtn').click();
    assert.ok(await alpha(0.5, 0.4) > 8, 'Undo must preserve the first stroke');
    assert.equal(await alpha(0.5, 0.65), 0, 'Undo must remove the second stroke');
    await page.locator('#maskRedoBtn').click();
    assert.ok(await alpha(0.5, 0.65) > 8, 'Redo must restore the second stroke');
    const exported = await page.evaluate(() => {
      const mask = maskCanvasFromDrawCanvas(editDrawCanvas());
      const ctx = mask.getContext('2d');
      return [[0.2,0.4], [0.5,0.4], [0.8,0.4], [0.5,0.65], [0.5,0.85]]
        .map(([x,y]) => [...ctx.getImageData(Math.round(mask.width*x), Math.round(mask.height*y), 1, 1).data]);
    });
    assert.deepEqual(exported, [
      [255,255,255,255], [255,255,255,255], [255,255,255,255], [255,255,255,255], [0,0,0,255],
    ], 'Export must preserve all painted regions and leave the background black');
    // Repaint the same region: coverage stays opaque, while the entire preview
    // stays translucent. Pointer moves must not read back the whole bitmap.
    await page.evaluate(() => {
      const ctx = editDrawCanvas().getContext('2d');
      window.maskReadback = {count:0, original:ctx.getImageData};
      ctx.getImageData = function (...args) {
        window.maskReadback.count += 1;
        return window.maskReadback.original.apply(this, args);
      };
    });
    await page.mouse.move(...point(0.2, 0.4));
    await page.mouse.down();
    await page.evaluate(() => { window.maskReadback.count = 0; });
    await page.mouse.move(...point(0.8, 0.4), {steps:24});
    await page.mouse.up();
    const readbackCount = await page.evaluate(() => {
      editDrawCanvas().getContext('2d').getImageData = window.maskReadback.original;
      return window.maskReadback.count;
    });
    assert.equal(readbackCount, 0, 'Mask movement must not read back bitmap pixels');
    assert.equal(await alpha(0.5, 0.4), await alpha(0.5, 0.65), 'Overlapping strokes must have uniform coverage');
    const opacity = await page.locator('#editDrawCanvas').evaluate(el => Number(getComputedStyle(el).opacity));
    assert.ok(Math.abs(opacity - 115 / 255) < 0.001, 'Mask preview must remain translucent');
    await page.locator('[data-image-edit-mode="brush"]').click();
    assert.equal(await page.locator('#editDrawCanvas').evaluate(el => getComputedStyle(el).opacity), '1',
      'Mask preview opacity must not affect the brush tool');
    assert.deepEqual(errors, []);
    console.log('PASS: continuous mask, multiple strokes, undo/redo, export, uniform preview, and no move readback');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
