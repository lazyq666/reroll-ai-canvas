const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.ISSUE_113_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') return { api_providers: [], available_models: {}, comfy_instances: [] };
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') {
    return {
      library: {
        common: {
          id: 'common',
          name: '通用',
          scope: 'common',
          readonly: false,
          categories: [{ id: 'general', name: '通用', library_id: 'system', category_id: 'general' }],
          items: [{
            id: 'editable-template',
            source_id: 'editable-template',
            library_id: 'system',
            name: '可编辑模板',
            category: 'general',
            positive: '原始提示词',
          }],
        },
      },
    };
  }
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/auth/me') {
    return { user: { id: 'issue-113-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === '/api/canvases/issue-113-modal-context-menu') {
    return {
      canvas: {
        id: 'issue-113-modal-context-menu',
        title: 'Issue 113',
        project: 'default',
        revision: 1,
        nodes: [{
          id: 'clipboard-source',
          type: 'smart-prompt',
          x: 240,
          y: 220,
          w: 316,
          h: 180,
          title: '剪贴板源节点',
          text: '节点内容',
          images: [],
        }],
        connections: [],
        settings: {},
        logs: [],
      },
    };
  }
  return {};
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      class PreviewWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
          this.readyState = PreviewWebSocket.CONNECTING;
          setTimeout(() => {
            this.readyState = PreviewWebSocket.OPEN;
            this.onopen?.({});
          }, 0);
        }

        send() {}
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
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-113-modal-context-menu`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForFunction(() => (
      customElements.get('ic-prompt-template-library')
      && document.getElementById('promptTemplateDockToggle')?.dataset.icContractStatus === 'ready'
      && document.querySelector('.image-node[data-id="clipboard-source"]')
    ), null, { timeout: 15000 });

    await page.locator('.image-node[data-id="clipboard-source"]').evaluate(node => {
      const script = document.createElement('script');
      script.textContent = `selectedId = ${JSON.stringify(node.dataset.id)}; selectedIds = []; selectedImage = {nodeId:'', index:-1}; render();`;
      document.body.appendChild(script);
      script.remove();
    });
    await page.locator('#shell').focus();
    await page.keyboard.press('Meta+C');
    await page.waitForFunction(() => Boolean(
      JSON.parse(sessionStorage.getItem('smart_canvas_node_clipboard_v1') || 'null')?.nodes?.length
    ));

    await page.locator('#smartHandTool').click();
    await page.locator('#promptTemplateDockToggle').click();
    await page.waitForFunction(() => {
      const dialog = document.getElementById('promptTemplateDialog');
      return dialog?.open && dialog.dialog?.matches(':modal');
    });

    const panelRect = await page.locator('#promptTemplateDialog').evaluate(dialog => {
      const rect = dialog.dialog.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    assert.ok(panelRect.left > 8 && panelRect.top > 8, 'test requires visible modal backdrop space');
    assert.deepEqual(await page.evaluate(() => ({
      dialogParent:document.getElementById('promptTemplateDialog')?.parentElement?.localName,
      libraryParent:document.getElementById('promptTemplatePanel')?.parentElement?.id,
      canvasContainsLibrary:document.getElementById('shell')?.contains(document.getElementById('promptTemplatePanel')),
    })), { dialogParent:'body', libraryParent:'promptTemplateDialog', canvasContainsLibrary:false });

    const searchInput = page.locator('#promptTemplatePanel').locator('[data-search] input');
    await searchInput.click();
    assert.deepEqual(await page.evaluate(() => ({
      canvasPanning:document.getElementById('shell')?.classList.contains('panning'),
      activeHost:document.activeElement?.id,
    })), { canvasPanning:false, activeHost:'promptTemplatePanel' });

    const fieldContext = await page.locator('#promptTemplatePanel').evaluate(library => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true });
      library.shadowRoot.querySelector('[data-search]').dispatchEvent(event);
      return { nativeContextAllowed: !event.defaultPrevented };
    });
    assert.deepEqual(fieldContext, { nativeContextAllowed: true });
    assert.equal(await page.locator('#createMenu').evaluate(menu => menu.hasAttribute('open')), false);

    await page.mouse.click(8, 8, { button: 'right' });
    await page.waitForTimeout(100);

    const state = await page.evaluate(() => ({
      modalOpen: document.getElementById('promptTemplateDialog')?.open,
      createMenuOpen: document.getElementById('createMenu')?.hasAttribute('open'),
      nodeMenuOpen: document.getElementById('smartNodeContextMenu')?.hasAttribute('open'),
    }));
    assert.deepEqual(state, {
      modalOpen: true,
      createMenuOpen: false,
      nodeMenuOpen: false,
    });

    await page.mouse.dblclick(8, 8);
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => ({
      modalOpen:document.getElementById('promptTemplateDialog')?.open,
      createMenuOpen:document.getElementById('createMenu')?.hasAttribute('open'),
    })), { modalOpen:true, createMenuOpen:false });

    const dropState = await page.locator('#promptTemplatePanel').evaluate(library => {
      const transfer = new DataTransfer();
      transfer.setData('application/x-smart-asset', JSON.stringify({url:'/static/images/favicon.png'}));
      const event = new DragEvent('drop', {bubbles:true, cancelable:true, composed:true, dataTransfer:transfer});
      library.shadowRoot.querySelector('[data-search]').dispatchEvent(event);
      return {defaultPrevented:event.defaultPrevented};
    });
    assert.deepEqual(dropState, {defaultPrevented:false});
    assert.equal(await page.locator('.image-node').count(), 1);

    const commonTab = page.locator('#promptTemplatePanel').locator('[data-library-switch] > [data-value="common"]').first();
    await commonTab.click();
    await page.locator('#promptTemplatePanel').locator('[data-template-edit]').first().click();
    const templateNameInput = page.locator('#promptTemplatePanel').locator('[data-editor-name] input');
    await templateNameInput.fill('');
    await page.evaluate(async () => navigator.clipboard.writeText('正常文本粘贴'));
    await templateNameInput.focus();
    await page.keyboard.press('Meta+V');
    await page.waitForTimeout(100);

    const pasteState = {
      inputValue: await templateNameInput.inputValue(),
      nodeCount: await page.locator('.image-node').count(),
    };
    assert.deepEqual(pasteState, {
      inputValue: '正常文本粘贴',
      nodeCount: 1,
    });
    console.log(JSON.stringify({ ...state, ...pasteState }));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
