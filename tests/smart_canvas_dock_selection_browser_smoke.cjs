const assert = require('node:assert/strict');
const { chromium } = require('playwright');


const baseUrl = process.env.SMART_CANVAS_DOCK_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';


function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') {
    return { api_providers: [], available_models: {}, comfy_instances: [] };
  }
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/auth/me') {
    return { user: { id: 'dock-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === '/api/canvases/dock-selection-preview') {
    return {
      canvas: {
        id: 'dock-selection-preview',
        title: 'Dock selection preview',
        project: 'default',
        revision: 1,
        nodes: [],
        connections: [],
        settings: {},
        logs: [],
      },
    };
  }
  return {};
}


function dockState(page, buttonId) {
  return page.locator(`#${buttonId}`).evaluate(button => ({
    active: button.classList.contains('active'),
    pressed: button.hasAttribute('pressed'),
    ariaPressed: button.hasAttribute('aria-pressed'),
    expanded: button.getAttribute('aria-expanded'),
    selectedToolIds: [...document.querySelectorAll('#smartCanvasDock > ic-icon-button[pressed]')]
      .map(tool => tool.id),
  }));
}


(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=dock-selection-preview`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForFunction(() => (
      document.getElementById('smartCanvasDock')?.dataset.icContractStatus === 'ready'
      && [...document.querySelectorAll('#smartCanvasDock > ic-icon-button')]
        .every(button => button.dataset.icContractStatus === 'ready')
      && document.getElementById('smartTitle')?.textContent === 'Dock selection preview'
    ), null, { timeout: 15000 });

    assert.deepEqual(await dockState(page, 'smartPointerTool'), {
      active: true,
      pressed: true,
      ariaPressed: true,
      expanded: null,
      selectedToolIds: ['smartPointerTool'],
    });

    await page.locator('#smartHandTool').click();
    assert.deepEqual(await dockState(page, 'smartHandTool'), {
      active: true,
      pressed: true,
      ariaPressed: true,
      expanded: null,
      selectedToolIds: ['smartHandTool'],
    });

    await page.locator('#promptTemplateDockToggle').click();
    await page.waitForFunction(() => (
      document.getElementById('promptTemplateDialog')?.open
      && document.getElementById('promptTemplateDockToggle')?.getAttribute('aria-expanded') === 'true'
    ));
    assert.deepEqual(await dockState(page, 'promptTemplateDockToggle'), {
      active: false,
      pressed: false,
      ariaPressed: false,
      expanded: 'true',
      selectedToolIds: ['smartHandTool'],
    });
    await page.evaluate(() => document.getElementById('promptTemplateDialog')?.hide?.('test'));
    await page.waitForFunction(() => !document.getElementById('promptTemplateDialog')?.open);

    await page.locator('#smartSettingsToggle').click();
    await page.waitForFunction(() => document.getElementById('smartSettingsPanel')?.classList.contains('open'));
    assert.deepEqual(await dockState(page, 'smartSettingsToggle'), {
      active: false,
      pressed: false,
      ariaPressed: false,
      expanded: 'true',
      selectedToolIds: ['smartHandTool'],
    });
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
