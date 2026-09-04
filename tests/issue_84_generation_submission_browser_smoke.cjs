const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reloads = Number(process.env.ISSUE_84_FULL_FLOW_RELOADS || 5);

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
    const timeout = setTimeout(() => reject(new Error(`Manual server startup timed out: ${output.join('')}`)), 10000);
    const check = chunk => {
      if (!chunk.toString().includes('Smart Canvas manual server:')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', check);
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

async function installFastRecovery(context) {
  await context.route('**/static/js/smart-canvas/generation-recovery.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace('setTimeout(resolve, 2000)', 'setTimeout(resolve, 0)');
    assert.notEqual(body, source, 'Could not shorten generation recovery polling');
    await route.fulfill({ response, body });
  });
}

async function runScenario(context, baseUrl, reload) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  let imageSubmissions = 0;
  const imagePayloads = [];
  let textSubmissions = 0;
  const textTaskId = `issue-84-text-${reload}`;

  await page.route('**/api/canvas-llm-tasks', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    textSubmissions += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ task_id: textTaskId, status: 'queued', actor_id: 'manual-test' }),
    });
  });
  await page.route(`**/api/canvas-llm-tasks/${textTaskId}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: textTaskId,
        status: 'succeeded',
        created_at: 1,
        updated_at: 2,
        result: { text: `Issue #84 generated text ${reload}` },
      }),
    });
  });
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/canvas-image-tasks') {
      imageSubmissions += 1;
      imagePayloads.push(request.postDataJSON());
    }
  });

  await page.goto(
    `${baseUrl}/static/smart-canvas.html?id=issue-148-complex&manual=1&fixture=issue-148-complex`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(() => Boolean(
    canvas?.id === 'issue-148-complex'
      && window.SmartCanvasModules?.generationRun
      && window.SmartCanvasModules?.canvasPersistence?.online?.()
      && document.querySelector('#runBtn')?.dataset.icContractStatus === 'ready',
  ));

  await page.evaluate(() => {
    const source = nodes.find(item => item.id === 'generator-source');
    source.referenceGenerationKind = 'image';
    source.runSettings = { ...source.runSettings, count: 3 };
    source.x = 420;
    source.y = 260;
    viewport.x = 0;
    viewport.y = 0;
    viewport.scale = 1;
    window.SmartCanvasModules.viewportSelection.viewport.apply({ persist: false });
    selectedId = 'generator-source';
    selectedIds = [];
    selectedImage = { nodeId: '', index: -1 };
    window.SmartCanvasModules.viewportSelection.selection.refresh();
    updateComposer();
  });
  await page.waitForFunction(() => !document.querySelector('#runBtn')?.disabled);
  await page.locator('#runBtn').click();
  await page.waitForFunction(() => nodes.filter(node => (
    (node.sourceNodeId === 'generator-source'
      || node.generationBatchSourceNodeId === 'generator-source')
      && (node.images || []).some(image => image.generatedResult || image.url)
  )).length === 3);
  assert.equal(imageSubmissions, 1, `reload ${reload}: one image intent must submit one Generation Run`);
  assert.equal(imagePayloads[0]?.n, 3, `reload ${reload}: the Generation Run must carry the total output count`);

  await page.evaluate(() => {
    const node = nodes.find(item => item.id === 'tree-a');
    node.llmEnabled = true;
    node.llmInstruction = 'Generate a structured prompt from this instruction';
    node.llmProvider = 'openai';
    node.llmModel = 'gpt-4o-mini';
    node.running = false;
    node.x = 260;
    node.y = 220;
    viewport.x = 0;
    viewport.y = 0;
    viewport.scale = 1;
    window.SmartCanvasModules.viewportSelection.viewport.apply({ persist: false });
    availableModels.text = [{
      id: 'openai|gpt-4o-mini',
      provider_id: 'openai',
      provider_name: 'OpenAI',
      model: 'gpt-4o-mini',
      name: 'GPT-4o mini',
    }];
    render({ syncVirtualization: false, nodeIds: [node.id] });
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('.image-node[data-id="tree-a"] .prompt-node-run');
    return button?.dataset.icContractStatus === 'ready' && !button.disabled;
  });
  await page.locator('.image-node[data-id="tree-a"] .prompt-node-run').click();
  await page.waitForFunction(expected => nodes.some(node => node.text === expected), `Issue #84 generated text ${reload}`);
  assert.equal(textSubmissions, 1, `reload ${reload}: Prompt Node first click must submit exactly one text task`);

  const result = {
    reload,
    imageSubmissions,
    imageRequestedCount:imagePayloads[0]?.n || 0,
    textSubmissions,
    generatedImageOutputs: await page.evaluate(() => nodes.filter(node => (
      (node.sourceNodeId === 'generator-source'
        || node.generationBatchSourceNodeId === 'generator-source')
        && (node.images || []).some(image => image.generatedResult || image.url)
    )).length),
    generatedTextOutputs: await page.evaluate(expected => nodes.filter(node => node.text === expected).length, `Issue #84 generated text ${reload}`),
  };
  await page.close();
  return result;
}

(async () => {
  assert.ok(Number.isInteger(reloads) && reloads > 0, 'ISSUE_84_FULL_FLOW_RELOADS must be positive');
  const manual = await startManualServer();
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await installFastRecovery(context);
    const results = [];
    for (let reload = 1; reload <= reloads; reload += 1) {
      results.push(await runScenario(context, manual.url, reload));
    }
    assert.equal(results.reduce((sum, item) => sum + item.imageSubmissions, 0), reloads);
    assert.equal(results.every(item => item.imageRequestedCount === 3), true);
    assert.equal(results.every(item => item.generatedImageOutputs === 3), true);
    assert.equal(results.reduce((sum, item) => sum + item.textSubmissions, 0), reloads);
    process.stdout.write(`${JSON.stringify({ passed: true, reloads, results })}\n`);
  } finally {
    await browser?.close();
    await stopManualServer(manual.child);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
