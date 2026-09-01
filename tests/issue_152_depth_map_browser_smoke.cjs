const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="480"%3E%3Cdefs%3E%3ClinearGradient id="g"%3E%3Cstop stop-color="%23fff"/%3E%3Cstop offset="1" stop-color="%23111"/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath fill="url(%23g)" d="M0 0h640v480H0z"/%3E%3C/svg%3E';
const depthImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

(async () => {
  const manual = await startManualServer();
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/static/js/smart-canvas/generation-recovery.js*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const body = source.replace('setTimeout(resolve, 2000)', 'setTimeout(resolve, 25)');
      assert.notEqual(body, source, 'Could not shorten Generation Run polling');
      await route.fulfill({ response, body });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    const submissions = [];
    let allowSuccess = false;
    let failNextSubmission = false;
    let statusRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/smart-canvas/depth-map', async route => {
      submissions.push(route.request().postDataJSON());
      const taskId = failNextSubmission
        ? 'issue-152-depth-failed-task'
        : 'issue-152-depth-task';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: taskId, status: 'queued', actor_id: 'browser-test' }),
      });
    });
    await page.route('**/api/canvas-image-tasks/issue-152-depth-task', async route => {
      statusRequests += 1;
      const task = allowSuccess ? {
        id: 'issue-152-depth-task',
        type: 'image-processor',
        status: 'succeeded',
        phase: 'completed',
        progress: 100,
        message: '深度图处理完成',
        created_at: 1,
        updated_at: 2,
        result: {
          image_items: [{ url: depthImage, name: 'depth.png', kind: 'image', natural_w: 640, natural_h: 480 }],
        },
      } : {
        id: 'issue-152-depth-task',
        type: 'image-processor',
        status: 'running',
        phase: 'downloading-model',
        progress: 42,
        message: '正在下载模型 42%',
        created_at: 1,
        updated_at: 1.5,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(task) });
    });
    await page.route('**/api/canvas-image-tasks/issue-152-depth-failed-task', async route => {
      statusRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'issue-152-depth-failed-task',
          type: 'image-processor',
          status: 'failed',
          phase: 'failed',
          progress: 18,
          message: '模型校验失败',
          error: '模型校验失败',
          created_at: 3,
          updated_at: 4,
        }),
      });
    });

    await page.goto(`${manual.url}/static/smart-canvas.html?id=issue-152-browser&manual=1`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.smartDepthMap
        && window.SmartCanvasModules?.canvasPersistence?.online?.()
        && window.SmartCanvasModules?.imageStudio
        && Array.isArray(nodes)
    ));
    await page.evaluate(imageUrl => {
      nodes.splice(0, nodes.length, {
        id: 'issue-152-source',
        type: 'smart-image',
        x: 220,
        y: 180,
        w: 320,
        h: 240,
        title: 'Source',
        images: [{ url: imageUrl, name: 'source.svg', kind: 'image', natural_w: 640, natural_h: 480 }],
      });
      canvas.nodes = nodes;
      canvas.connections = [];
      selectedId = 'issue-152-source';
      selectedIds = [];
      selectedImage = { nodeId: 'issue-152-source', index: 0 };
      render();
      window.SmartCanvasModules.imageStudio.open({
        nodeId: 'issue-152-source', imageIndex: 0, mode: 'crop', groupAware: false,
      });
    }, sourceImage);
    await page.waitForFunction(() => Boolean(
      document.querySelector('#imageEditModal')?.open
        && window.SmartCanvasModules.imageStudio.current()?.sourceReady
        && document.querySelector('#depthMapActionBtn')?.dataset.icContractStatus === 'ready'
        && document.querySelector('#depthMapActionBtn ic-icon')?.dataset.iconStatus === 'ready'
    ));
    const readToolbarEntryStyles = () => page.evaluate(() => {
      const summarize = (host, surface) => {
        const px = value => Math.round(value * 100) / 100;
        const icon = host.querySelector('ic-icon');
        const label = host.querySelector('span');
        const surfaceRect = surface.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const style = getComputedStyle(surface);
        const iconStyle = getComputedStyle(icon);
        return {
          height: px(surfaceRect.height),
          paddingInlineStart: px(iconRect.left - surfaceRect.left),
          paddingInlineEnd: px(surfaceRect.right - labelRect.right),
          iconLabelGap: px(labelRect.left - iconRect.right),
          iconWidth: px(iconRect.width),
          iconHeight: px(iconRect.height),
          iconFontSize: iconStyle.fontSize,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderRadius,
        };
      };
      const mode = document.querySelector('[data-image-edit-mode="mask"]');
      const action = document.querySelector('#depthMapActionBtn');
      const actionSurface = action.shadowRoot.querySelector('[part~="base"]');
      return {
        mode: summarize(mode, mode),
        action: summarize(action, actionSurface),
      };
    });
    const assertToolbarEntryStyles = (theme, styles) => assert.deepEqual(
      styles.action,
      styles.mode,
      `Depth Map entry style drifted from the mode entries in ${theme}: ${JSON.stringify(styles)}`,
    );
    assertToolbarEntryStyles('light theme', await readToolbarEntryStyles());

    await page.evaluate(() => {
      document.documentElement.classList.add('theme-dark');
      document.body.classList.add('theme-dark');
    });
    assertToolbarEntryStyles('dark theme', await readToolbarEntryStyles());

    await page.locator('#depthMapActionBtn').click();
    await page.waitForFunction(() => Boolean(
      !document.querySelector('#imageEditModal')?.open
        && nodes.find(node => node.outputKind === 'depth-map' && node.imageProcessorJob?.active)
    ));
    await page.waitForFunction(() => {
      const pending = document.querySelector('.image-node ic-generation-pending[description]');
      return pending?.getAttribute('label') === '处理中'
        && pending?.getAttribute('description') === '正在下载模型 42%';
    });

    const pendingState = await page.evaluate(() => {
      const source = nodes.find(node => node.id === 'issue-152-source');
      const output = nodes.find(node => node.outputKind === 'depth-map');
      const pending = document.querySelector(`.image-node[data-id="${output.id}"] ic-generation-pending`);
      return {
        modalOpen: document.querySelector('#imageEditModal')?.open,
        source: { x: source.x, y: source.y, w: source.w, h: source.h },
        output: {
          id: output.id, x: output.x, y: output.y, title: output.title,
          sourceNodeId: output.depthMapSourceNodeId,
          sourceImageIndex: output.depthMapSourceImageIndex,
          phase: output.imageProcessorJob?.phase,
          progress: output.imageProcessorJob?.progress,
        },
        pending: {
          label: pending?.getAttribute('label'),
          description: pending?.getAttribute('description'),
          ariaLabel: pending?.getAttribute('aria-label'),
          contract: pending?.dataset.icContractStatus,
          labelColor: getComputedStyle(pending?.shadowRoot?.querySelector('ic-badge')?.shadowRoot?.querySelector('.badge')).color,
          background: getComputedStyle(pending?.shadowRoot?.querySelector('.pending')).backgroundColor,
        },
        connections: canvas.connections.filter(connection => (
          connection.from === 'issue-152-source' && connection.to === output.id
        )).length,
      };
    });
    assert.equal(pendingState.modalOpen, false);
    assert.equal(pendingState.output.title, '深度图');
    assert.equal(pendingState.output.sourceNodeId, 'issue-152-source');
    assert.equal(pendingState.output.sourceImageIndex, 0);
    assert.equal(pendingState.output.phase, 'downloading-model');
    assert.equal(pendingState.output.progress, 42);
    assert.equal(pendingState.pending.label, '处理中');
    assert.equal(pendingState.pending.description, '正在下载模型 42%');
    assert.match(pendingState.pending.ariaLabel, /处理中.*正在下载模型 42%/);
    assert.equal(pendingState.pending.contract, 'ready');
    assert.notEqual(pendingState.pending.labelColor, pendingState.pending.background);
    assert.equal(pendingState.connections, 1);
    assert.ok(
      pendingState.output.x >= pendingState.source.x + pendingState.source.w,
      `Depth Node was not placed after its source: ${JSON.stringify(pendingState)}`,
    );
    assert.equal(submissions.length, 1);
    assert.deepEqual(
      Object.keys(submissions[0]).sort(),
      ['canvas_id', 'generation_operation_id', 'generation_request_index', 'node_id', 'source_image_index', 'source_node_id'],
    );
    assert.equal(submissions[0].source_node_id, 'issue-152-source');
    assert.equal(submissions[0].node_id, pendingState.output.id);

    allowSuccess = true;
    await page.waitForFunction(expectedUrl => {
      const output = nodes.find(node => node.outputKind === 'depth-map');
      return output?.images?.[0]?.url === expectedUrl
        && !output.imageProcessorJob
        && !output.pending;
    }, depthImage);
    const completedState = await page.evaluate(() => {
      const output = nodes.find(node => node.outputKind === 'depth-map');
      const element = document.querySelector(`.image-node[data-id="${output.id}"]`);
      return {
        id: output.id,
        title: element?.querySelector('.node-title')?.textContent?.trim() || '',
        image: output.images?.[0]?.url || '',
        pending: Boolean(element?.querySelector('ic-generation-pending')),
        selectedSource: selectedId,
      };
    });
    assert.equal(completedState.id, pendingState.output.id, 'Completion replaced the Node instead of its contents');
    assert.equal(completedState.title, '深度图');
    assert.equal(completedState.image, depthImage);
    assert.equal(completedState.pending, false);
    assert.equal(completedState.selectedSource, 'issue-152-source');

    failNextSubmission = true;
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.open({
      nodeId: 'issue-152-source', imageIndex: 0, mode: 'crop', groupAware: false,
    }));
    await page.waitForFunction(() => Boolean(
      document.querySelector('#imageEditModal')?.open
        && window.SmartCanvasModules.imageStudio.current()?.sourceReady
    ));
    await page.locator('#depthMapActionBtn').press('Enter');
    await page.waitForFunction(() => nodes.some(node => (
      node.outputKind === 'depth-map'
        && node.imageProcessorJob?.phase === 'failed'
        && node.generationRunFeedback?.failedCount === 1
    )));
    const failedState = await page.evaluate(successfulId => {
      const failed = nodes.find(node => (
        node.outputKind === 'depth-map'
          && node.id !== successfulId
          && node.imageProcessorJob?.phase === 'failed'
      ));
      return {
        exists: Boolean(failed),
        title: failed?.title || '',
        pending: failed?.pending || 0,
        error: failed?.imageProcessorJob?.error || '',
        standardFeedback: Boolean(document.querySelector(
          `.image-node[data-id="${failed?.id}"] .generation-failure-target`
        )),
      };
    }, completedState.id);
    assert.equal(failedState.exists, true, 'A failed Depth Node was removed');
    assert.equal(failedState.title, '深度图');
    assert.equal(failedState.pending, 0);
    assert.match(failedState.error, /模型校验失败/);
    assert.equal(failedState.standardFeedback, true);
    assert.equal(submissions.length, 2);
    assert.deepEqual(pageErrors, []);

    process.stdout.write(`${JSON.stringify({
      passed: true,
      submissions: submissions.length,
      statusRequests,
      outputNodeId: completedState.id,
    })}\n`);
  } finally {
    await browser?.close();
    await stopManualServer(manual.child);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
