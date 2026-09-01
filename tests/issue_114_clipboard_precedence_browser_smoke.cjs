const assert = require('node:assert/strict');
const { chromium } = require('playwright');


const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shortcut = process.platform === 'darwin' ? 'Meta' : 'Control';
const clipboardKey = 'smart_canvas_node_clipboard_v1';


function initialCanvas(id) {
  return {
    id,
    title: `Issue #114 · ${id}`,
    project: 'default',
    revision: 1,
    nodes: [
      {
        id: 'node-a', type: 'smart-prompt', x: 120, y: 180, w: 316, h: 180,
        title: 'Node A', text: 'clipboard node A', llmEnabled: false,
      },
      {
        id: 'node-b', type: 'smart-prompt', x: 560, y: 180, w: 316, h: 180,
        title: 'Node B', text: 'clipboard node B', llmEnabled: false,
      },
    ],
    connections: [{ from: 'node-a', to: 'node-b', kind: 'input' }],
    settings: {},
    logs: [],
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
    return { user: { id: 'issue-114-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname.startsWith('/api/canvases/')) {
    return { canvas: initialCanvas(decodeURIComponent(pathname.split('/').pop())) };
  }
  return {};
}


async function openCanvas(page, id, { preserveSession = false } = {}) {
  if (!preserveSession && page.url() !== 'about:blank') {
    await page.evaluate(key => sessionStorage.removeItem(key), clipboardKey);
  }
  await page.goto(`${baseUrl}/static/smart-canvas.html?id=${encodeURIComponent(id)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });
  await page.waitForFunction(() => (
    window.SmartCanvasModules?.clipboardOwnership
    && window.SmartCanvasModules?.viewportSelection?.selection
    && document.querySelectorAll('.image-node').length === 2
  ), null, { timeout: 15000 });
}


async function selectAndCopyNodes(page, nodeIds) {
  const previousCopyId = await page.evaluate(key => (
    JSON.parse(sessionStorage.getItem(key) || 'null')?.copyId || ''
  ), clipboardKey);
  await page.evaluate(ids => {
    selectedId = ids.length === 1 ? ids[0] : '';
    selectedIds = ids.length > 1 ? ids.slice() : [];
    selectedImage = { nodeId: '', index: -1 };
    render();
    document.getElementById('shell').focus({ preventScroll: true });
  }, nodeIds);
  await page.keyboard.press(`${shortcut}+C`);
  await page.waitForFunction(({ key, previous }) => {
    const record = JSON.parse(sessionStorage.getItem(key) || 'null');
    return record?.copyId && record.copyId !== previous;
  }, { key: clipboardKey, previous: previousCopyId });
}


async function selectAndCopy(page, nodeId) {
  return selectAndCopyNodes(page, [nodeId]);
}


async function pasteOnCanvas(page) {
  await page.evaluate(() => document.getElementById('shell').focus({ preventScroll: true }));
  await page.keyboard.press(`${shortcut}+V`);
}


async function nodeState(page) {
  return page.evaluate(() => ({
    count: nodes.length,
    texts: nodes.map(node => node.text || ''),
    types: nodes.map(node => node.type || ''),
    connections: canvas.connections.length,
    clipboard: JSON.parse(sessionStorage.getItem('smart_canvas_node_clipboard_v1') || 'null'),
  }));
}


async function writeText(page, value) {
  await page.evaluate(text => navigator.clipboard.writeText(text), value);
}


async function explicitPasteState(page) {
  await page.evaluate(() => openCreateMenu(
    { clientX: 1320, clientY: 760 },
    { allowPaste: true },
  ));
  await page.waitForFunction(() => document.getElementById('createMenu')?.hasAttribute('open'));
  const result = await page.locator('#createMenu').evaluate(menu => {
    const item = menu.querySelector(':scope > ic-menu-item[value="paste"]');
    return { hidden: item.hidden, disabled: item.hasAttribute('disabled') };
  });
  await page.keyboard.press('Escape');
  return result;
}


(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    class ClipboardPreviewWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = ClipboardPreviewWebSocket.CONNECTING;
        this.listeners = new Map();
        this.revision = 1;
        this.inverses = new Map();
        setTimeout(() => {
          this.readyState = ClipboardPreviewWebSocket.OPEN;
          this.emit('open', {});
          const id = decodeURIComponent(new URL(url).pathname.split('/').pop());
          setTimeout(() => this.emit('message', { data: JSON.stringify({
            type: 'canvas_snapshot',
            revision: this.revision,
            canvas: {
              id,
              title: `Issue #114 · ${id}`,
              project: 'default',
              revision: this.revision,
              nodes: [
                {
                  id: 'node-a', type: 'smart-prompt', x: 120, y: 180,
                  w: 316, h: 180, title: 'Node A', text: 'clipboard node A',
                  llmEnabled: false,
                },
                {
                  id: 'node-b', type: 'smart-prompt', x: 560, y: 180,
                  w: 316, h: 180, title: 'Node B', text: 'clipboard node B',
                  llmEnabled: false,
                },
              ],
              connections: [{ from: 'node-a', to: 'node-b', kind: 'input' }],
              settings: {},
              logs: [],
            },
          }) }), 0);
        }, 0);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type, listener) {
        this.listeners.set(
          type,
          (this.listeners.get(type) || []).filter(item => item !== listener),
        );
      }

      emit(type, event) {
        this[`on${type}`]?.(event);
        (this.listeners.get(type) || []).forEach(listener => listener(event));
      }

      send(raw) {
        const message = JSON.parse(raw);
        if (message.type === 'ping') {
          setTimeout(() => this.emit('message', { data: JSON.stringify({
            type: 'pong', revision: this.revision,
          }) }), 0);
          return;
        }
        if (message.type !== 'canvas_mutation') return;
        const operation = message.operation || {};
        const revertedOperationId = String(operation.reverts_operation_id || '');
        let changes = operation.changes || {};
        if (revertedOperationId) {
          changes = this.inverses.get(revertedOperationId) || {};
        } else {
          this.inverses.set(String(operation.operation_id || ''), {
            node_deletes: (changes.node_creates || [])
              .map(rawNode => String((rawNode?.node || rawNode)?.id || ''))
              .filter(Boolean),
            connection_removes: changes.connection_adds || [],
          });
        }
        this.revision += 1;
        setTimeout(() => this.emit('message', { data: JSON.stringify({
          type: 'canvas_mutation',
          revision: this.revision,
          operation_id: operation.operation_id || '',
          ...(revertedOperationId ? { reverts_operation_id: revertedOperationId } : {}),
          changes,
        }) }), 0);
      }

      close(code = 1000) {
        this.readyState = ClipboardPreviewWebSocket.CLOSED;
        this.onclose?.({ code });
      }
    }
    window.WebSocket = ClipboardPreviewWebSocket;
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/ai/upload') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: [{
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
            name: 'clipboard.png',
            kind: 'image',
          }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apiPayload(request.url())),
    });
  });

  try {
    // Node -> Node -> paste uses the newest Node Package and one Undo removes it.
    await openCanvas(page, 'node-node');
    await selectAndCopy(page, 'node-a');
    await selectAndCopy(page, 'node-b');
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 3);
    assert.equal(await page.evaluate(() => canvasPersistence.synced({ timeout: 3000 })), true);
    let state = await nodeState(page);
    assert.equal(state.texts.filter(text => text === 'clipboard node B').length, 2);
    assert.equal(state.texts.filter(text => text === 'clipboard node A').length, 1);
    await page.keyboard.press(`${shortcut}+Z`);
    await page.waitForFunction(() => nodes.length === 2);

    // A valid marker supports consecutive paste intents without duplicate dispatch.
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 3);
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 4);
    state = await nodeState(page);
    assert.equal(state.texts.filter(text => text === 'clipboard node B').length, 3);

    // Multi-Node paste keeps the internal Connection and rigid relative placement.
    await openCanvas(page, 'rigid-package');
    await selectAndCopyNodes(page, ['node-a', 'node-b']);
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 4);
    const rigidPackage = await page.evaluate(() => {
      const originalA = nodes.find(node => node.id === 'node-a');
      const originalB = nodes.find(node => node.id === 'node-b');
      const copyA = nodes.find(node => node.id !== 'node-a' && node.text === originalA.text);
      const copyB = nodes.find(node => node.id !== 'node-b' && node.text === originalB.text);
      return {
        deltaA: { x: copyA.x - originalA.x, y: copyA.y - originalA.y },
        deltaB: { x: copyB.x - originalB.x, y: copyB.y - originalB.y },
        internalConnection: canvas.connections.some(connection => (
          connection.from === copyA.id && connection.to === copyB.id
        )),
      };
    });
    assert.deepEqual(rigidPackage.deltaA, rigidPackage.deltaB);
    assert.equal(rigidPackage.internalConnection, true);

    // Node -> text -> Canvas paste is a no-op, including after the former 90 ms fallback.
    await openCanvas(page, 'node-text-canvas');
    await selectAndCopy(page, 'node-a');
    await writeText(page, 'newer external text');
    await pasteOnCanvas(page);
    await page.waitForTimeout(180);
    state = await nodeState(page);
    assert.equal(state.count, 2);
    assert.equal(state.connections, 1);
    assert.equal(state.clipboard, null);
    assert.deepEqual(await explicitPasteState(page), { hidden: false, disabled: true });

    // Node -> text -> editable composer preserves native text paste.
    await openCanvas(page, 'node-text-input');
    await selectAndCopy(page, 'node-a');
    await writeText(page, 'native input paste');
    await page.evaluate(() => document.getElementById('promptInput').focus({ preventScroll: true }));
    await page.keyboard.press(`${shortcut}+V`);
    await page.waitForFunction(() => document.getElementById('promptInput').textContent.includes('native input paste'));
    state = await nodeState(page);
    assert.equal(state.count, 2);
    assert.equal(state.clipboard, null);

    // Node -> image paste creates media only and cannot append the old Node later.
    await openCanvas(page, 'node-media');
    await selectAndCopy(page, 'node-a');
    await page.evaluate(async () => {
      const bytes = Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ), character => character.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
      ]);
    });
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 3);
    await page.waitForTimeout(180);
    state = await nodeState(page);
    assert.equal(state.count, 3);
    assert.equal(state.types.filter(type => type === 'smart-image').length, 1);
    assert.equal(state.texts.filter(text => text === 'clipboard node A').length, 1);
    assert.equal(state.clipboard, null);

    // Text -> Node makes Node the newest system clipboard owner again.
    await openCanvas(page, 'text-node');
    await writeText(page, 'older text');
    await selectAndCopy(page, 'node-b');
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 3);
    state = await nodeState(page);
    assert.equal(state.texts.filter(text => text === 'clipboard node B').length, 2);

    // A mismatched application marker cannot use the valid session payload.
    await openCanvas(page, 'mismatched-marker');
    await selectAndCopy(page, 'node-a');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      const ownership = window.SmartCanvasModules.clipboardOwnership;
      transfer.setData(ownership.MIME, JSON.stringify({
        version: ownership.VERSION,
        copyId: 'forged-copy-id',
      }));
      transfer.setData('text/plain', 'forged marker');
      window.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }));
    });
    await page.waitForTimeout(180);
    state = await nodeState(page);
    assert.equal(state.count, 2);
    assert.equal(state.clipboard, null);

    // Marker write failure invalidates the session payload and never revives it.
    await openCanvas(page, 'marker-write-failure');
    await page.evaluate(() => {
      selectedId = 'node-a';
      selectedIds = [];
      selectedImage = { nodeId: '', index: -1 };
      render();
      document.getElementById('shell').focus({ preventScroll: true });
      document.execCommand = command => {
        if (command !== 'copy') return false;
        const event = new Event('copy', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: {
          setData() { throw new Error('clipboard marker rejected'); },
          getData() { return ''; },
        } });
        window.dispatchEvent(event);
        return true;
      };
    });
    await page.keyboard.press(`${shortcut}+C`);
    state = await nodeState(page);
    assert.equal(state.clipboard, null);
    await pasteOnCanvas(page);
    await page.waitForTimeout(180);
    state = await nodeState(page);
    assert.equal(state.count, 2);

    // A valid marker and session payload survive same-tab Canvas navigation.
    await openCanvas(page, 'cross-canvas-source');
    await selectAndCopy(page, 'node-b');
    await openCanvas(page, 'cross-canvas-target', { preserveSession: true });
    await pasteOnCanvas(page);
    await page.waitForFunction(() => nodes.length === 3);
    state = await nodeState(page);
    assert.equal(state.texts.filter(text => text === 'clipboard node B').length, 2);
    assert.equal(state.clipboard.sourceCanvasId, 'cross-canvas-source');

    assert.deepEqual(errors, []);
    console.log('Issue #114 clipboard precedence browser smoke passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
