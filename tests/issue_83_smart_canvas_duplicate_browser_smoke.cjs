const assert = require('node:assert/strict');
const { chromium } = require('playwright');


const baseUrl = process.env.ISSUE_83_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const canvasId = 'issue-83-duplicate-preview';
let serverCanvas = null;
let serverRevision = 1;
const acceptedMutations = new Map();


function initialCanvas() {
  return {
    id: canvasId,
    title: 'Issue #83 · 创建副本关系',
    project: 'default',
    revision: 1,
    nodes: [
      {
        id: 'a',
        type: 'smart-prompt',
        x: 80,
        y: 180,
        w: 316,
        h: 180,
        title: 'A',
        text: '上游输入',
        llmEnabled: false,
      },
      {
        id: 'b',
        type: 'smart-prompt',
        x: 500,
        y: 180,
        w: 316,
        h: 180,
        title: 'B',
        text: '待复制节点',
        llmEnabled: false,
        inputNodeIds: ['a'],
        sourceNodeId: 'a',
        runPrompt: '保持原配方',
        runSettings: { provider: 'fixture-provider', model: 'fixture-model' },
      },
      {
        id: 'c',
        type: 'smart-prompt',
        x: 920,
        y: 180,
        w: 316,
        h: 180,
        title: 'C',
        text: '原下游节点',
        llmEnabled: false,
        inputNodeIds: ['b'],
      },
    ],
    connections: [
      { from: 'a', to: 'b', kind: 'input', sourceOutputId: 'a-output' },
      { from: 'b', to: 'c', kind: 'input', sourceOutputId: 'b-output' },
    ],
    settings: {},
    logs: [],
  };
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function emptyChanges() {
  return {
    node_creates: [],
    node_updates: [],
    node_unsets: [],
    node_deletes: [],
    connection_adds: [],
    connection_removes: [],
    canvas_updates: [],
    canvas_unsets: [],
  };
}


function connectionKey(connection = {}) {
  return [connection.from || '', connection.to || '', connection.kind || 'flow'].join('\u001f');
}


function applyServerChanges(changes = {}) {
  const deletedIds = new Set((changes.node_deletes || []).map(String));
  if (deletedIds.size) {
    serverCanvas.nodes = serverCanvas.nodes.filter(node => !deletedIds.has(String(node.id)));
    serverCanvas.connections = serverCanvas.connections.filter(connection => (
      !deletedIds.has(String(connection.from)) && !deletedIds.has(String(connection.to))
    ));
  }
  for (const raw of changes.node_creates || []) {
    const node = raw?.node || raw;
    if (node?.id && !serverCanvas.nodes.some(item => item.id === node.id)) {
      serverCanvas.nodes.push(clone(node));
    }
  }
  const removedKeys = new Set((changes.connection_removes || []).map(connectionKey));
  serverCanvas.connections = serverCanvas.connections.filter(
    connection => !removedKeys.has(connectionKey(connection)),
  );
  const connectionKeys = new Set(serverCanvas.connections.map(connectionKey));
  for (const connection of changes.connection_adds || []) {
    const key = connectionKey(connection);
    if (!connectionKeys.has(key)) {
      serverCanvas.connections.push(clone(connection));
      connectionKeys.add(key);
    }
  }
}


function inverseFor(changes = {}) {
  return {
    ...emptyChanges(),
    node_deletes: (changes.node_creates || []).map(raw => String((raw?.node || raw)?.id || '')).filter(Boolean),
    connection_removes: clone(changes.connection_adds || []),
  };
}


function websocketReply(rawMessage) {
  const message = JSON.parse(rawMessage);
  if (message.type === 'ping') {
    return { type: 'pong', revision: serverRevision };
  }
  if (message.type !== 'canvas_mutation') return null;
  const operation = message.operation || {};
  const revertedOperationId = String(operation.reverts_operation_id || '');
  const changes = revertedOperationId
    ? clone(acceptedMutations.get(revertedOperationId) || emptyChanges())
    : clone(operation.changes || emptyChanges());
  if (!revertedOperationId) {
    acceptedMutations.set(String(operation.operation_id || ''), inverseFor(changes));
  }
  applyServerChanges(changes);
  serverRevision += 1;
  serverCanvas.revision = serverRevision;
  return {
    type: 'canvas_mutation',
    revision: serverRevision,
    operation_id: operation.operation_id,
    ...(revertedOperationId ? { reverts_operation_id: revertedOperationId } : {}),
    changes,
  };
}


function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') {
    return { api_providers: [], available_models: {}, comfy_instances: [] };
  }
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/auth/me') {
    return { user: { id: 'issue-83-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === `/api/canvases/${canvasId}`) return { canvas: clone(serverCanvas) };
  return {};
}


async function duplicateState(page) {
  return page.evaluate(() => {
    const originalIds = new Set(['a', 'b', 'c']);
    const original = nodes.find(node => node.id === 'b');
    const duplicate = nodes.find(node => !originalIds.has(node.id));
    const recipeFor = node => node
      ? {
          sourceNodeId: node.sourceNodeId,
          runPrompt: node.runPrompt,
          runSettings: node.runSettings,
        }
      : null;
    return {
      nodeCount: nodes.length,
      duplicateId: duplicate?.id || '',
      duplicateInputs: duplicate?.inputNodeIds || [],
      recipe: recipeFor(duplicate),
      originalRecipe: recipeFor(original),
      hasParentInput: Boolean(duplicate && canvas.connections.some(connection => (
        connection.from === 'a'
        && connection.to === duplicate.id
        && connection.kind === 'input'
      ))),
      hasCopiedOutput: Boolean(duplicate && canvas.connections.some(connection => (
        connection.from === duplicate.id
        && connection.to === 'c'
      ))),
      childInputs: nodes.find(node => node.id === 'c')?.inputNodeIds || [],
    };
  });
}


(async () => {
  serverCanvas = initialCanvas();
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.exposeFunction('__issue83WebSocketOpen', () => ({
      type: 'canvas_snapshot',
      revision: serverRevision,
      canvas: clone(serverCanvas),
    }));
    await page.exposeFunction('__issue83WebSocketExchange', raw => websocketReply(raw));
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('studio_theme', 'light');
      class PreviewWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
          this.readyState = PreviewWebSocket.CONNECTING;
          setTimeout(async () => {
            this.readyState = PreviewWebSocket.OPEN;
            this.onopen?.({});
            const snapshot = await window.__issue83WebSocketOpen();
            this.onmessage?.({ data: JSON.stringify(snapshot) });
          }, 0);
        }

        send(raw) {
          window.__issue83WebSocketExchange(raw).then(reply => {
            if (reply) this.onmessage?.({ data: JSON.stringify(reply) });
          });
        }

        close(code = 1000) {
          this.readyState = PreviewWebSocket.CLOSED;
          this.onclose?.({ code });
        }
      }
      window.WebSocket = PreviewWebSocket;
    });
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apiPayload(route.request().url())),
    }));
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=${canvasId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForFunction(() => (
      customElements.get('ic-menu-item')
      && document.querySelectorAll('.image-node').length === 3
      && document.querySelector('.image-node[data-id="b"]')
    ), null, { timeout: 15000 });
    const nodeB = page.locator('.image-node[data-id="b"]');
    await nodeB.click({ button: 'right', position: { x: 120, y: 80 } });
    await page.waitForFunction(() => document.getElementById('smartNodeContextMenu')?.hasAttribute('open'));
    await page.locator('#smartNodeContextMenu > ic-menu-item[value="duplicate"]').click();
    await page.waitForFunction(() => nodes.length === 4);
    assert.equal(await page.evaluate(() => (
      window.SmartCanvasModules.canvasPersistence.synced({ timeout: 3000 })
    )), true);
    const contextMenuDuplicate = await duplicateState(page);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => nodes.length === 3);
    assert.equal(await page.evaluate(() => (
      window.SmartCanvasModules.canvasPersistence.synced({ timeout: 3000 })
    )), true);
    const afterUndo = await page.evaluate(() => ({
      nodeIds: nodes.map(node => node.id),
      connections: canvas.connections,
    }));

    await nodeB.click();
    await page.keyboard.press('Control+d');
    await page.waitForFunction(() => nodes.length === 4);
    const commandDuplicate = await duplicateState(page);
    assert.equal(await page.evaluate(() => (
      window.SmartCanvasModules.canvasPersistence.synced({ timeout: 3000 })
    )), true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => nodes.length === 4);
    const reloadedDuplicate = await duplicateState(page);

    await page.locator('#smartSettingsToggle').click();
    await page.locator('#smartShortcutSettingsAction').click();
    await page.waitForFunction(() => document.getElementById('smartShortcutDialog')?.open);
    const shortcutModal = await page.locator('#smartShortcutDialog').evaluate(modal => ({
      optionDragCount: modal.querySelectorAll('[data-i18n="smart.shortcutAltCopy"]').length,
      optionShiftSpecialCount: modal.querySelectorAll('[data-i18n="smart.shortcutAltShiftCopy"]').length,
      rowCount: modal.querySelectorAll('[data-shortcut-row]').length,
    }));

    const expectedDuplicate = {
      nodeCount: 4,
      duplicateInputs: ['a'],
      hasParentInput: true,
      hasCopiedOutput: false,
      childInputs: ['b'],
    };
    assert.ok(contextMenuDuplicate.duplicateId);
    assert.deepEqual(contextMenuDuplicate.recipe, contextMenuDuplicate.originalRecipe);
    assert.deepEqual(
      { ...contextMenuDuplicate, duplicateId: undefined, recipe: undefined, originalRecipe: undefined },
      { ...expectedDuplicate, duplicateId: undefined, recipe: undefined, originalRecipe: undefined },
    );
    assert.deepEqual(afterUndo, {
      nodeIds: ['a', 'b', 'c'],
      connections: [
        { from: 'a', to: 'b', kind: 'input', sourceOutputId: 'a-output' },
        { from: 'b', to: 'c', kind: 'input', sourceOutputId: 'b-output' },
      ],
    });
    assert.ok(commandDuplicate.duplicateId);
    assert.deepEqual(commandDuplicate.recipe, commandDuplicate.originalRecipe);
    assert.deepEqual(
      { ...commandDuplicate, duplicateId: undefined, recipe: undefined, originalRecipe: undefined },
      { ...expectedDuplicate, duplicateId: undefined, recipe: undefined, originalRecipe: undefined },
    );
    assert.equal(reloadedDuplicate.duplicateId, commandDuplicate.duplicateId);
    assert.deepEqual(reloadedDuplicate, commandDuplicate);
    assert.deepEqual(shortcutModal, {
      optionDragCount: 1,
      optionShiftSpecialCount: 0,
      rowCount: 19,
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      contextMenuDuplicate,
      afterUndo,
      commandDuplicate,
      reloadedDuplicate,
      shortcutModal,
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
