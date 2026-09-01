const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

let baseUrl = process.env.SMART_CANVAS_BASE_URL || '';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const iterations = Number(process.env.ISSUE_84_ITERATIONS || 100);
const reloads = Number(process.env.ISSUE_84_RELOADS || 1);
const root = path.resolve(__dirname, '..');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(requestUrl.pathname);
      const json = value => {
        const body = JSON.stringify(value);
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        response.end(body);
      };
      if (pathname === '/api/config') {
        json({ api_providers: [], available_models: { image: [], video: [], text: [] }, comfy_instances: [] });
        return;
      }
      if (pathname === '/api/workflows') {
        json({ workflows: [] });
        return;
      }
      if (pathname === '/api/prompt-libraries') {
        json({ library: { libraries: [] } });
        return;
      }
      if (pathname === '/api/image-model-capabilities' || pathname === '/api/video-model-capabilities') {
        json({});
        return;
      }
      if (/^\/api\/canvases\/[^/]+\/prompt-templates$/.test(pathname)) {
        json({ templates: [] });
        return;
      }
      if (/^\/api\/canvases\/[^/]+\/logs$/.test(pathname)) {
        json({ logs: [] });
        return;
      }
      const canvasMatch = pathname.match(/^\/api\/canvases\/([^/]+)$/);
      if (canvasMatch) {
        const id = decodeURIComponent(canvasMatch[1]);
        json({
          canvas: {
            id,
            title: 'Issue #84 first-click fixture',
            project: 'test',
            revision: 0,
            nodes: [],
            connections: [],
            logs: [],
            settings: {},
          },
        });
        return;
      }
      if (/^\/api\/smart-canvas\/[^/]+\/view-state$/.test(pathname)) {
        json({ view_state: null });
        return;
      }
      const file = path.resolve(root, pathname.replace(/^\/+/, ''));
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await fs.readFile(file);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function instrumentOnce(source, needle, replacement, resource) {
  const instrumented = source.replace(needle, replacement);
  assert.notEqual(instrumented, source, `Could not instrument ${resource}`);
  return instrumented;
}

async function installRoutes(context) {
  await context.route('**/static/js/infinite-canvas-ui/prompt-template-library.js*', async route => {
    const response = await route.fetch();
    if (response.ok()) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'export class IcPromptTemplateLibrary extends HTMLElement {}',
    });
  });

  await context.route('**/static/js/smart-canvas/canvas-persistence.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = instrumentOnce(
      source,
      /function canvasPersistenceEditable\(\)\{[\s\S]*?\n\}/,
      'function canvasPersistenceEditable(){ return true; }',
      'canvas-persistence.js',
    );
    await route.fulfill({ response, body });
  });

  await context.route('**/static/js/smart-canvas/generation-run.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = instrumentOnce(
      source,
      "    run({nodeId='', mode='single'}={}){\n",
      "    run({nodeId='', mode='single'}={}){\n"
        + "        if(window.__issue84InterceptRuns){\n"
        + "            window.__issue84ComposerRunCalls.push({nodeId,mode});\n"
        + "            return Promise.resolve(true);\n"
        + "        }\n",
      'generation-run.js',
    );
    await route.fulfill({ response, body });
  });

  await context.route('**/static/js/smart-canvas.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = instrumentOnce(
      source,
      'async function runPromptLLMNode(nodeId, options={}){\n',
      'async function runPromptLLMNode(nodeId, options={}){\n'
        + '    if(window.__issue84InterceptRuns){\n'
        + '        window.__issue84PromptNodeRunCalls.push({nodeId});\n'
        + '        return true;\n'
        + '    }\n',
      'smart-canvas.js',
    );
    await route.fulfill({ response, body });
  });
}

async function createScenario(page) {
  await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-84-first-click`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(
    customElements.get('ic-icon-button')
      && window.SmartCanvasModules?.generationRun
      && document.querySelector('#runBtn')?.dataset.icContractStatus === 'ready'
      && typeof canvas !== 'undefined'
      && canvas?.id === 'issue-84-first-click'
      && Array.isArray(nodes),
  ));
  await page.evaluate(() => {
    window.__issue84InterceptRuns = true;
    window.__issue84ComposerRunCalls = [];
    window.__issue84PromptNodeRunCalls = [];
    const group = {
      id: 'issue-84-composer-target',
      type: 'smart-group',
      title: 'Composer target',
      x: 100,
      y: 100,
      w: 360,
      h: 260,
      items: [],
      promptDraftHtml: 'first click composer prompt',
      promptDraftText: 'first click composer prompt',
    };
    const promptNode = {
      id: 'issue-84-prompt-node-target',
      type: 'smart-prompt',
      title: 'Prompt node target',
      x: 600,
      y: 100,
      w: 360,
      h: 260,
      llmEnabled: true,
      llmInstruction: 'first click prompt node instruction',
      llmProvider: 'openai',
      llmModel: 'gpt-4o-mini',
      llmInputMedia: [],
      running: false,
    };
    nodes.splice(0, nodes.length, group, promptNode);
    canvas = {
      id: 'issue-84-first-click',
      nodes,
      connections: [],
      logs: [],
    };
    selectedId = group.id;
    selectedIds = [];
    selectedImage = { nodeId: '', index: -1 };
    render();
    updateComposer();
  });
  await page.waitForFunction(() => {
    const composerButton = document.querySelector('#runBtn');
    const promptButton = document.querySelector(
      '.image-node[data-id="issue-84-prompt-node-target"] .prompt-node-run',
    );
    return composerButton
      && composerButton.dataset.icContractStatus === 'ready'
      && !composerButton.disabled
      && promptButton?.dataset.icContractStatus === 'ready'
      && !promptButton.disabled;
  });
}

async function clickOnceAndAssert(page, selector, counter, expected, label) {
  const control = page.locator(selector);
  const clickTarget = expected % 2 === 0 ? control : control.locator('button');
  await clickTarget.click();
  await page.waitForFunction(
    ({ counterName, count }) => window[counterName]?.length === count,
    { counterName: counter, count: expected },
  );
  const actual = await page.evaluate(counterName => window[counterName].length, counter);
  assert.equal(actual, expected, `${label}: first click did not submit exactly once`);
}

(async () => {
  assert.ok(Number.isInteger(iterations) && iterations > 0, 'ISSUE_84_ITERATIONS must be positive');
  assert.ok(Number.isInteger(reloads) && reloads > 0, 'ISSUE_84_RELOADS must be positive');
  let staticServer = null;
  if (!baseUrl) {
    staticServer = await startStaticServer();
    baseUrl = staticServer.url;
  }
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await installRoutes(context);
    let composer = 0;
    let promptNode = 0;
    for (let reload = 1; reload <= reloads; reload += 1) {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await createScenario(page);

      for (let index = 1; index <= iterations; index += 1) {
        await page.evaluate(() => {
          selectedId = 'issue-84-composer-target';
          selectedIds = [];
          selectedImage = { nodeId: '', index: -1 };
          window.SmartCanvasModules.viewportSelection.selection.refresh();
          updateComposer();
          promptInput.focus();
          promptInput.textContent = `composer iteration ${window.__issue84ComposerRunCalls.length + 1}`;
          promptInput.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: 'x',
          }));
        });
        await page.waitForFunction(() => !document.querySelector('#runBtn')?.disabled);
        await clickOnceAndAssert(
          page,
          '#runBtn',
          '__issue84ComposerRunCalls',
          index,
          `Composer reload ${reload}, iteration ${index}`,
        );

        await page.evaluate(() => render({
          syncVirtualization: false,
          nodeIds: ['issue-84-prompt-node-target'],
        }));
        const instruction = page.locator(
          '.image-node[data-id="issue-84-prompt-node-target"] .prompt-llm-instruction',
        );
        await instruction.dblclick();
        await instruction.fill(`prompt node iteration ${index}`);
        await clickOnceAndAssert(
          page,
          '.image-node[data-id="issue-84-prompt-node-target"] .prompt-node-run',
          '__issue84PromptNodeRunCalls',
          index,
          `Prompt node reload ${reload}, iteration ${index}`,
        );
      }

      const result = await page.evaluate(() => ({
        composer: window.__issue84ComposerRunCalls.length,
        promptNode: window.__issue84PromptNodeRunCalls.length,
      }));
      assert.deepEqual(result, { composer: iterations, promptNode: iterations });
      composer += result.composer;
      promptNode += result.promptNode;
      await page.close();
    }
    const totalPerSurface = reloads * iterations;
    assert.deepEqual({ composer, promptNode }, {
      composer: totalPerSurface,
      promptNode: totalPerSurface,
    });
    process.stdout.write(`${JSON.stringify({
      passed: true,
      reloads,
      iterationsPerReload: iterations,
      totalPerSurface,
      composer,
      promptNode,
    })}\n`);
  } finally {
    await browser?.close();
    if (staticServer) {
      await new Promise(resolve => staticServer.server.close(resolve));
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
