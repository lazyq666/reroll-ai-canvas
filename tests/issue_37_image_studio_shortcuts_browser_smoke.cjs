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
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

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
    cwd:ROOT,
    env:{...process.env, SMART_CANVAS_PORT:String(port)},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  try {
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.goto(
      `http://127.0.0.1:${port}/static/smart-canvas.html?id=issue-37-image-studio-shortcuts&manual=1`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.imageStudio
      && window.SmartCanvasModules?.canvasPersistence
      && document.querySelector('#imageEditModal')?.dataset.icContractStatus === 'ready'
      && typeof render === 'function'
    ));
    await page.waitForFunction(() => typeof canvas !== 'undefined' && Boolean(canvas));

    await page.evaluate(imageUrl => {
      const script = document.createElement('script');
      script.textContent = `(() => {
        const source = {
          id:'issue-37-source',
          type:'smart-image',
          title:'Image Studio shortcut source',
          x:320,
          y:220,
          w:520,
          h:330,
          images:[{
            url:${JSON.stringify(imageUrl)},
            name:'issue-37-source.png',
            kind:'image',
            natural_w:1600,
            natural_h:1000
          }]
        };
        nodes.splice(0, nodes.length, source);
        canvas.nodes = nodes;
        canvas.connections = [];
        selectedId = source.id;
        selectedIds = [];
        selectedImage = {nodeId:source.id, index:0};
        viewport.x = 0;
        viewport.y = 0;
        viewport.scale = 1;
        render();
      })();`;
      document.body.appendChild(script);
      script.remove();
    }, TINY_PNG);
    await page.waitForFunction(() => document.querySelectorAll('.image-node').length === 1);

    await page.evaluate(() => window.SmartCanvasModules.canvasMutation.duplicate({
      nodeIds:['issue-37-source'],
      mode:'offset',
      preserveConnections:true,
    }));
    await page.waitForFunction(() => nodes.length === 2);
    assert.equal(await page.evaluate(() => (
      window.SmartCanvasModules.canvasPersistence.synced({timeout:3000})
    )), true);
    await page.evaluate(() => {
      window.__issue37CanvasUndoRequests = 0;
      const originalSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function sendWithUndoProbe(raw) {
        try {
          const message = JSON.parse(raw);
          if (message.type === 'canvas_mutation' && message.operation?.reverts_operation_id) {
            window.__issue37CanvasUndoRequests += 1;
          }
        } catch {}
        return originalSend.call(this, raw);
      };
    });

    await page.evaluate(() => window.SmartCanvasModules.imageStudio.open({
      nodeId:'issue-37-source',
      imageIndex:0,
      mode:'brush',
      groupAware:false,
    }));
    await page.waitForFunction(() => (
      document.querySelector('#imageEditModal')?.open
      && document.querySelector('#imageEditModeTabs')?.value === 'brush'
      && !document.querySelector('#editDrawCanvas')?.hidden
    ));

    const drawBounds = await page.locator('#editDrawCanvas').boundingBox();
    assert.ok(drawBounds?.width > 0 && drawBounds?.height > 0, 'Brush canvas must be visible');
    await page.mouse.move(drawBounds.x + drawBounds.width * 0.35, drawBounds.y + drawBounds.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(
      drawBounds.x + drawBounds.width * 0.55,
      drawBounds.y + drawBounds.height * 0.55,
      {steps:5},
    );
    await page.mouse.up();
    assert.equal(await page.locator('#brushUndoBtn').isDisabled(), false);

    await page.keyboard.press('Control+z');
    const afterStudioUndo = await page.evaluate(() => ({
      studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
      undoDisabled:document.querySelector('#brushUndoBtn')?.disabled,
      redoDisabled:document.querySelector('#brushRedoBtn')?.disabled,
    }));
    assert.deepEqual(afterStudioUndo, {
      studioOpen:true,
      undoDisabled:true,
      redoDisabled:false,
    });
    assert.equal(await page.evaluate(() => window.__issue37CanvasUndoRequests), 0);

    await page.keyboard.press('Control+Shift+z');
    const afterStudioRedo = await page.evaluate(() => ({
      studioOpen:window.SmartCanvasModules.imageStudio.isOpen(),
      undoDisabled:document.querySelector('#brushUndoBtn')?.disabled,
      redoDisabled:document.querySelector('#brushRedoBtn')?.disabled,
    }));
    assert.deepEqual(afterStudioRedo, {
      studioOpen:true,
      undoDisabled:false,
      redoDisabled:true,
    });

    await page.keyboard.press('Meta+z');
    assert.deepEqual(await page.evaluate(() => ({
      undoDisabled:document.querySelector('#brushUndoBtn')?.disabled,
      redoDisabled:document.querySelector('#brushRedoBtn')?.disabled,
    })), {
      undoDisabled:true,
      redoDisabled:false,
    });
    await page.keyboard.press('Meta+Shift+z');
    assert.deepEqual(await page.evaluate(() => ({
      undoDisabled:document.querySelector('#brushUndoBtn')?.disabled,
      redoDisabled:document.querySelector('#brushRedoBtn')?.disabled,
    })), {
      undoDisabled:false,
      redoDisabled:true,
    });
    assert.equal(await page.evaluate(() => window.__issue37CanvasUndoRequests), 0);

    await page.locator('#paintBrushSize').evaluate(slider => slider.focus());
    await page.keyboard.press('Control+z');
    assert.deepEqual(await page.evaluate(() => ({
      undoDisabled:document.querySelector('#brushUndoBtn')?.disabled,
      redoDisabled:document.querySelector('#brushRedoBtn')?.disabled,
      canvasUndoRequests:window.__issue37CanvasUndoRequests,
    })), {
      undoDisabled:false,
      redoDisabled:true,
      canvasUndoRequests:0,
    });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (
      !document.querySelector('#imageEditModal')?.open
      && !document.querySelector('#imageEditModal')?.hasAttribute('open')
    ));
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__issue37CanvasUndoRequests === 1);
    assert.equal(await page.evaluate(() => window.SmartCanvasModules.imageStudio.isOpen()), false);
    assert.deepEqual(errors, []);
    process.stdout.write(JSON.stringify({ok:true, checks:6}, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
