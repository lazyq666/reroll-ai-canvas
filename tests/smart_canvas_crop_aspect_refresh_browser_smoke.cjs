const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"%3E%3Cpath fill="%235a8dee" d="M0 0h1600v1000H0z"/%3E%3C/svg%3E';
const croppedImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="900" height="1600" viewBox="0 0 900 1600"%3E%3Cpath fill="%2344a66f" d="M0 0h900v1600H0z"/%3E%3C/svg%3E';

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
    const timeout = setTimeout(
      () => reject(new Error(`Manual server startup timed out: ${output.join('')}`)),
      10000,
    );
    const ready = chunk => {
      if (!chunk.toString().includes('Smart Canvas manual server:')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', ready);
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

function closeTo(actual, expected, tolerance = 0.02) {
  return Math.abs(actual - expected) <= tolerance;
}

(async () => {
  const manual = await startManualServer();
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/ai/upload', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: [{ url: croppedImage, name: 'portrait-crop.svg', kind: 'image' }],
      }),
    }));

    await page.goto(`${manual.url}/static/smart-canvas.html?id=crop-aspect-refresh&manual=1`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.imageStudio
        && canvas
        && Array.isArray(nodes)
        && document.querySelector('#imageEditModal')?.dataset.icContractStatus === 'ready'
    ));

    await page.evaluate(imageUrl => {
      nodes.splice(0, nodes.length, {
        id: 'crop-aspect-node',
        type: 'smart-image',
        x: 260,
        y: 210,
        w: 260,
        h: 163,
        generationOutputNode: true,
        generationMediaW: 260,
        generationMediaH: 163,
        images: [{
          url: imageUrl,
          name: 'landscape-source.svg',
          kind: 'image',
          natural_w: 1600,
          natural_h: 1000,
        }],
      });
      canvas.nodes = nodes;
      canvas.connections = [];
      selectedId = 'crop-aspect-node';
      selectedIds = [];
      selectedImage = { nodeId: 'crop-aspect-node', index: 0 };
      render();
      window.SmartCanvasModules.imageStudio.open({
        nodeId: 'crop-aspect-node', imageIndex: 0, mode: 'crop', groupAware: false,
      });
    }, sourceImage);

    await page.waitForFunction(() => Boolean(
      document.querySelector('#imageEditModal')?.open
        && window.SmartCanvasModules.imageStudio.current()?.sourceReady
        && document.querySelector('#imageEditModeTabs')?.value === 'crop'
    ));
    await page.locator('#cropRatioTabs button[data-value="9:16"]').click();
    await page.waitForFunction(ratio => {
      const box = document.querySelector('#cropBox');
      return Math.abs(
        parseFloat(box?.style.width || 0) / Math.max(1, parseFloat(box?.style.height || 0)) - ratio
      ) < 0.01;
    }, 9 / 16);
    await page.locator('#imageEditApplyBtn').click();

    await page.waitForFunction(expectedUrl => (
      !document.querySelector('#imageEditModal')?.open
        && nodes.find(node => node.id === 'crop-aspect-node')?.images?.[0]?.url === expectedUrl
    ), croppedImage);
    await page.waitForFunction(() => {
      const image = nodes.find(node => node.id === 'crop-aspect-node')?.images?.[0];
      return Number(image?.natural_w || 0) > 0 && Number(image?.natural_h || 0) > 0;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    )));

    const state = await page.evaluate(() => {
      const node = nodes.find(candidate => candidate.id === 'crop-aspect-node');
      const element = document.querySelector('.image-node[data-id="crop-aspect-node"]');
      const media = element?.querySelector('.node-img');
      return {
        imageSize: [Number(node?.images?.[0]?.natural_w || 0), Number(node?.images?.[0]?.natural_h || 0)],
        nodeSize: [Number(node?.w || 0), Number(node?.h || 0)],
        elementSize: [parseFloat(element?.style.width || 0), parseFloat(element?.style.height || 0)],
        mediaSize: [parseFloat(media?.style.width || 0), parseFloat(media?.style.height || 0)],
      };
    });
    const expectedRatio = 9 / 16;
    const ratios = {
      image: state.imageSize[0] / Math.max(1, state.imageSize[1]),
      node: state.nodeSize[0] / Math.max(1, state.nodeSize[1]),
      element: state.elementSize[0] / Math.max(1, state.elementSize[1]),
      media: state.mediaSize[0] / Math.max(1, state.mediaSize[1]),
    };

    assert.ok(closeTo(ratios.image, expectedRatio), JSON.stringify({ state, ratios }));
    assert.ok(closeTo(ratios.node, expectedRatio), JSON.stringify({ state, ratios }));
    assert.ok(closeTo(ratios.element, expectedRatio), JSON.stringify({ state, ratios }));
    assert.ok(closeTo(ratios.media, expectedRatio), JSON.stringify({ state, ratios }));
    assert.deepEqual(pageErrors, []);
    process.stdout.write(`${JSON.stringify({ passed: true, state, ratios }, null, 2)}\n`);
  } finally {
    await browser?.close();
    await stopManualServer(manual.child);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
