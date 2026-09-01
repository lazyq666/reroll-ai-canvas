const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');


const baseUrl = process.env.T34_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.T34_SCREENSHOT_DIR || '/tmp';
const themes = ['light', 'dark'];


function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') {
    return { api_providers: [], available_models: {}, comfy_instances: [] };
  }
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/auth/me') {
    return { user: { id: 't34-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === '/api/canvases/t34-shell-preview') {
    return {
      canvas: {
        id: 't34-shell-preview',
        title: 'T34 · 返回与画布标题',
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


(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const evidence = [];
  try {
    for (const theme of themes) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      await page.addInitScript(selectedTheme => {
        if (!sessionStorage.getItem('t34-preview-initialized')) {
          localStorage.clear();
          sessionStorage.clear();
          sessionStorage.setItem('t34-preview-initialized', '1');
          localStorage.setItem('smartCanvasDockPosition', 'bottom');
        }
        localStorage.setItem('studio_theme', selectedTheme);
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
      }, theme);
      await page.route('**/api/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(apiPayload(route.request().url())),
      }));
      await page.goto(`${baseUrl}/static/smart-canvas.html?id=t34-shell-preview`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForFunction(() => (
        customElements.get('ic-button')
        && document.querySelector('.smart-back')?.dataset.icContractStatus === 'ready'
        && document.getElementById('smartCanvasDock')?.dataset.icContractStatus === 'ready'
        && [...document.querySelectorAll('#smartCanvasDock > ic-icon-button')]
          .every(button => button.dataset.icContractStatus === 'ready')
        && document.getElementById('smartTitle')?.textContent === 'T34 · 返回与画布标题'
      ), null, { timeout: 15000 });
      await page.waitForTimeout(150);

      const result = await page.locator('.smart-back').evaluate(control => {
        const host = control.getBoundingClientRect();
        const base = control.shadowRoot.querySelector('[part="base"]').getBoundingClientRect();
        const baseStyle = getComputedStyle(control.shadowRoot.querySelector('[part="base"]'));
        const icon = control.querySelector('ic-icon');
        return {
          component: control.localName,
          contract: control.dataset.icContractStatus,
          title: document.getElementById('smartTitle').textContent,
          nativeTitle: control.hasAttribute('title'),
          accessibleLabel: control.getAttribute('aria-label'),
          icon: icon?.getAttribute('name'),
          iconStatus: icon?.dataset.iconStatus,
          host: { width: Math.round(host.width), height: Math.round(host.height) },
          base: { width: Math.round(base.width), height: Math.round(base.height) },
          background: baseStyle.backgroundColor,
          foreground: baseStyle.color,
          border: { width: baseStyle.borderTopWidth, style: baseStyle.borderTopStyle, color: baseStyle.borderTopColor },
          boxShadow: baseStyle.boxShadow,
          invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
          directWebAwesomeConsumers: [...document.querySelectorAll('*')]
            .filter(node => node.localName.startsWith('wa-')).length,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          hiddenFileInputs: [...document.querySelectorAll('input[type="file"][hidden]')]
            .every(input => getComputedStyle(input).display === 'none'),
        };
      });
      await page.evaluate(() => {
        window.__t34BackClicked = false;
        window.backToCanvasList = () => { window.__t34BackClicked = true; };
      });
      await page.locator('.smart-back').click();
      result.clickPreserved = await page.evaluate(() => window.__t34BackClicked);
      result.dockBottom = await page.locator('#smartCanvasDock').evaluate(dock => {
        const rect = dock.getBoundingClientRect();
        const buttons = [...dock.querySelectorAll(':scope > ic-icon-button')];
        return {
          component: dock.localName,
          contract: dock.dataset.icContractStatus,
          position: dock.dataset.position,
          orientation: dock.getAttribute('orientation'),
          ariaOrientation: dock.getAttribute('aria-orientation'),
          buttonCount: buttons.length,
          publicButtonsReady: buttons.every(button => button.dataset.icContractStatus === 'ready'),
          nativeTitleCount: buttons.filter(button => button.hasAttribute('title')).length,
          dividerOrientation: dock.querySelector(':scope > ic-divider')?.getAttribute('orientation'),
          rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
          bottomGap: Math.round(window.innerHeight - rect.bottom),
        };
      });
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.locator('#smartBrushTool').hover();
      await page.waitForFunction(() => document.querySelector('body > ic-tooltip[open]'));
      result.brushTooltipBottom = await page.locator('body > ic-tooltip[open]').evaluate(tooltip => {
        const label = tooltip.shadowRoot.querySelector('[part="label"]');
        const shortcut = tooltip.shadowRoot.querySelector('[part="shortcut"]');
        return {
          placement: tooltip.getAttribute('placement'),
          label: label?.textContent,
          shortcut: shortcut?.textContent,
          labelColor: getComputedStyle(label).color,
          shortcutColor: getComputedStyle(shortcut).color,
        };
      });
      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-dock-${theme}-bottom.png`,
        fullPage: false,
      });

      await page.mouse.move(100, 100);
      await page.locator('#smartPointerTool').focus();
      await page.keyboard.press('ArrowRight');
      result.horizontalKeyboardTarget = await page.evaluate(() => document.activeElement?.id);
      await page.locator('#smartSettingsToggle').click();
      await page.waitForFunction(() => document.getElementById('smartSettingsPanel')?.classList.contains('open'));
      await page.waitForTimeout(200);
      result.bottomPositionSetting = await page.locator('#smartCanvasDockPositionControl').evaluate(control => ({
        value: control.getAttribute('value'),
        contract: control.dataset.icContractStatus,
        label: control.getAttribute('label'),
        componentName: control.dataset.componentName,
        size: control.getAttribute('size'),
        orientation: control.getAttribute('orientation'),
      }));
      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-dock-${theme}-settings-bottom.png`,
        fullPage: false,
      });
      await page.locator('#smartCanvasDockPositionControl > [data-value="left"]').click();
      await page.waitForFunction(() => (
        document.getElementById('smartCanvasDock')?.dataset.position === 'left'
        && localStorage.getItem('smartCanvasDockPosition') === 'left'
      ));
      result.dockLeft = await page.locator('#smartCanvasDock').evaluate(dock => {
        const rect = dock.getBoundingClientRect();
        const buttons = [...dock.querySelectorAll(':scope > ic-icon-button')];
        return {
          position: dock.dataset.position,
          orientation: dock.getAttribute('orientation'),
          ariaOrientation: dock.getAttribute('aria-orientation'),
          dividerOrientation: dock.querySelector(':scope > ic-divider')?.getAttribute('orientation'),
          positionSetting: document.getElementById('smartCanvasDockPositionControl')?.getAttribute('value'),
          tooltipPlacements: [...new Set(buttons.map(button => button.getAttribute('tooltip-placement')))],
          rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
          centerOffset: Math.round((rect.top + rect.height / 2) - window.innerHeight / 2),
          shellScroll: {
            left: document.getElementById('shell').scrollLeft,
            top: document.getElementById('shell').scrollTop,
          },
          buttonsInsideViewport: buttons.every(button => {
            const item = button.getBoundingClientRect();
            return item.top >= 0 && item.bottom <= window.innerHeight;
          }),
        };
      });
      result.leftSettingsPanel = await page.locator('#smartSettingsPanel').evaluate(panel => {
        const panelRect = panel.getBoundingClientRect();
        const dockRect = document.getElementById('smartCanvasDock').getBoundingClientRect();
        return {
          open: panel.classList.contains('open'),
          selectedPosition: document.getElementById('smartCanvasDockPositionControl')?.getAttribute('value'),
          clearsDock: panelRect.left >= dockRect.right,
          insideViewport: panelRect.top >= 0 && panelRect.right <= window.innerWidth && panelRect.bottom <= window.innerHeight,
        };
      });
      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-dock-${theme}-settings-left.png`,
        fullPage: false,
      });
      await page.locator('#smartPointerTool').focus();
      await page.keyboard.press('ArrowDown');
      result.verticalKeyboardTarget = await page.evaluate(() => document.activeElement?.id);
      await page.locator('#smartSettingsToggle').click();
      await page.waitForFunction(() => !document.getElementById('smartSettingsPanel')?.classList.contains('open'));
      await page.waitForTimeout(200);
      await page.locator('#smartBrushTool').hover();
      await page.waitForFunction(() => document.querySelector('body > ic-tooltip[open]'));
      result.brushTooltipLeft = await page.locator('body > ic-tooltip[open]').evaluate(tooltip => ({
        placement: tooltip.getAttribute('placement'),
        label: tooltip.shadowRoot.querySelector('[part="label"]')?.textContent,
        shortcut: tooltip.shadowRoot.querySelector('[part="shortcut"]')?.textContent,
      }));
      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-dock-${theme}-left.png`,
        fullPage: false,
      });
      await page.mouse.move(100, 100);
      await page.locator('#smartBrushTool').click();
      await page.waitForFunction(() => document.getElementById('smartBrushOptions')?.classList.contains('open'));
      result.leftBrushOptions = await page.locator('#smartBrushOptions').evaluate(panel => {
        const panelRect = panel.getBoundingClientRect();
        const dockRect = document.getElementById('smartCanvasDock').getBoundingClientRect();
        return {
          clearsDock: panelRect.left >= dockRect.right,
          insideViewport: panelRect.top >= 0 && panelRect.right <= window.innerWidth && panelRect.bottom <= window.innerHeight,
        };
      });
      await page.locator('#smartPointerTool').click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (
        document.getElementById('smartCanvasDock')?.dataset.position === 'left'
        && document.getElementById('smartCanvasDock')?.dataset.icContractStatus === 'ready'
      ));
      result.leftPositionRestored = await page.evaluate(() => (
        localStorage.getItem('smartCanvasDockPosition') === 'left'
        && document.getElementById('smartCanvasDock')?.getAttribute('orientation') === 'vertical'
        && document.getElementById('smartCanvasDockPositionControl')?.value === 'left'
      ));

      await page.locator('#shell').dblclick({ position: { x: 720, y: 420 } });
      await page.waitForFunction(() => document.getElementById('createMenu')?.hasAttribute('open'));
      await page.locator('#createMenu > ic-menu-item[value="upload"]').focus();
      result.createMenu = await page.locator('#createMenu').evaluate(menu => {
        const surface = menu.shadowRoot.querySelector('[part="surface"]');
        const rect = surface.getBoundingClientRect();
        const items = [...menu.querySelectorAll(':scope > ic-menu-item:not([hidden])')];
        const firstButton = items[0]?.shadowRoot?.querySelector('button');
        const firstButtonStyle = firstButton ? getComputedStyle(firstButton) : null;
        const surfaceStyle = getComputedStyle(surface);
        return {
          component: menu.localName,
          contract: menu.dataset.icContractStatus,
          label: menu.getAttribute('label'),
          trigger: menu.getAttribute('trigger'),
          selection: menu.getAttribute('selection'),
          size: menu.getAttribute('size'),
          itemCount: items.length,
          publicItemsReady: items.every(item => item.dataset.icContractStatus === 'ready'),
          iconNames: items.map(item => item.getAttribute('icon')),
          labels: items.map(item => item.getAttribute('label')),
          nativeAuthoredButtons: menu.querySelectorAll('button').length,
          firstFocusedValue: document.activeElement?.getAttribute?.('value'),
          pointerFocusIndicatorSuppressed: Boolean(
            document.documentElement.dataset.icInputModality === 'pointer'
            && firstButtonStyle?.outlineStyle === 'none'
            && firstButtonStyle?.boxShadow === 'none'
            && firstButtonStyle?.backgroundColor === 'rgba(0, 0, 0, 0)'
          ),
          pasteHidden: menu.querySelector(':scope > ic-menu-item[value="paste"]')?.hidden,
          border: { width: surfaceStyle.borderTopWidth, style: surfaceStyle.borderTopStyle, color: surfaceStyle.borderTopColor },
          boxShadow: surfaceStyle.boxShadow,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
          },
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        };
      });
      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-create-menu-${theme}.png`,
        fullPage: false,
      });
      await page.locator('#createMenu > ic-menu-item[value="upload"]').hover();
      result.createMenuPointerHover = await page.locator('#createMenu > ic-menu-item[value="upload"]').evaluate(item => {
        const style = getComputedStyle(item.shadowRoot.querySelector('button'));
        return {
          hoverBackgroundVisible: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
          keyboardRingHidden: style.outlineStyle === 'none' && style.boxShadow === 'none',
        };
      });
      await page.locator('#createMenu > ic-menu-item[value="upload"]').focus();
      await page.keyboard.press('ArrowDown');
      result.createMenuKeyboardTarget = await page.evaluate(() => document.activeElement?.getAttribute?.('value'));
      result.createMenuKeyboardFocusIndicator = await page.locator('#createMenu > ic-menu-item[value="prompt"]').evaluate(item => {
        const style = getComputedStyle(item.shadowRoot.querySelector('button'));
        return {
          keyboardModalityActive: document.documentElement.dataset.icInputModality === 'keyboard',
          outlineVisible: style.outlineStyle !== 'none',
          shadowVisible: style.boxShadow !== 'none',
        };
      });
      await page.keyboard.press('Escape');
      result.createMenuEscape = await page.evaluate(() => ({
        closed: !document.getElementById('createMenu')?.hasAttribute('open'),
        focusReturnedTo: document.activeElement?.id,
      }));

      await page.mouse.dblclick(1436, 896);
      await page.waitForFunction(() => document.getElementById('createMenu')?.hasAttribute('open'));
      result.createMenuEdge = await page.locator('#createMenu').evaluate(menu => {
        const rect = menu.shadowRoot.querySelector('[part="surface"]').getBoundingClientRect();
        const firstItem = menu.querySelector(':scope > ic-menu-item:not([hidden])');
        const firstStyle = getComputedStyle(firstItem.shadowRoot.querySelector('button'));
        return {
          shiftedFromInvocationPoint: rect.left < window.innerWidth - 4 && rect.top < window.innerHeight - 4,
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
          pointerFocusIndicatorSuppressed: document.documentElement.dataset.icInputModality === 'pointer'
            && firstStyle.outlineStyle === 'none'
            && firstStyle.boxShadow === 'none'
            && firstStyle.backgroundColor === 'rgba(0, 0, 0, 0)',
        };
      });
      await page.locator('#createMenu > ic-menu-item[value="prompt"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.image-node.prompt-smart-node').length === 1);
      result.createMenuSelection = await page.evaluate(() => ({
        closed: !document.getElementById('createMenu')?.hasAttribute('open'),
        promptNodeCount: document.querySelectorAll('.image-node.prompt-smart-node').length,
      }));

      const createdPromptNode = page.locator('.image-node.prompt-smart-node').first();
      await createdPromptNode.hover();
      const referenceTrigger = createdPromptNode.locator('[data-node-quick-add][data-port="out"]');
      const referenceTriggerBox = await referenceTrigger.boundingBox();
      assert.ok(referenceTriggerBox, 'quick add trigger should have a visible drag origin');
      const referenceTriggerCenter = {
        x: referenceTriggerBox.x + referenceTriggerBox.width / 2,
        y: referenceTriggerBox.y + referenceTriggerBox.height / 2,
      };
      await referenceTrigger.dispatchEvent('mousedown', {
        button: 0,
        buttons: 1,
        clientX: referenceTriggerCenter.x,
        clientY: referenceTriggerCenter.y,
      });
      await page.mouse.move(720, 420, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => (
        document.getElementById('referenceGenerateMenu')?.hasAttribute('open')
        && document.querySelectorAll('path.port-drag-temp').length === 1
      ));
      await page.mouse.click(280, 180);
      await page.waitForFunction(() => (
        !document.getElementById('referenceGenerateMenu')?.hasAttribute('open')
        && document.querySelectorAll('path.port-drag-temp').length === 0
      ));
      result.referenceGenerateBlankDismiss = await page.evaluate(() => ({
        closed: !document.getElementById('referenceGenerateMenu')?.hasAttribute('open'),
        temporaryGuideCount: document.querySelectorAll('path.port-drag-temp').length,
      }));

      await createdPromptNode.hover();
      await referenceTrigger.click({ force: true });
      await page.waitForFunction(() => (
        document.getElementById('referenceGenerateMenu')?.hasAttribute('open')
        && document.activeElement?.matches?.('#referenceGenerateMenu > ic-menu-item[value="text"]')
      ));
      result.referenceGenerateMenu = await page.locator('#referenceGenerateMenu').evaluate(menu => {
        const surface = menu.shadowRoot.querySelector('[part="surface"]');
        const rect = surface.getBoundingClientRect();
        const items = [...menu.querySelectorAll(':scope > ic-menu-item')];
        const heading = menu.querySelector(':scope > .reference-generate-label');
        const headingRect = heading?.getBoundingClientRect();
        return {
          component: menu.localName,
          contract: menu.dataset.icContractStatus,
          trigger: menu.getAttribute('trigger'),
          selection: menu.getAttribute('selection'),
          size: menu.getAttribute('size'),
          values: items.map(item => item.getAttribute('value')),
          publicItemsReady: items.every(item => item.dataset.icContractStatus === 'ready'),
          publicIconsReady: items.every(item => item.shadowRoot.querySelector('ic-icon')?.dataset.iconStatus === 'ready'),
          visibleHeading: heading?.textContent?.trim(),
          headingVisible: Boolean(headingRect?.width && headingRect?.height),
          firstFocusedValue: document.activeElement?.getAttribute?.('value'),
          sourcePinned: document.activeElement?.closest('.image-node')?.classList.contains('reference-menu-source')
            || Boolean(document.querySelector('.image-node.reference-menu-source')),
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        };
      });
      await page.locator('#referenceGenerateMenu > ic-menu-item[value="video"]').click();
      await page.waitForFunction(() => (
        !document.getElementById('referenceGenerateMenu')?.hasAttribute('open')
        && document.querySelectorAll('.image-node').length === 2
      ));
      result.referenceGenerateSelection = await referenceTrigger.evaluate(trigger => ({
        closed: !document.getElementById('referenceGenerateMenu')?.hasAttribute('open'),
        triggerExpanded: trigger.getAttribute('aria-expanded'),
        sourcePinned: trigger.closest('.image-node')?.classList.contains('reference-menu-source'),
        nodeCount: document.querySelectorAll('.image-node').length,
      }));

      result.textReferenceTooltip = await page.evaluate(async () => {
        const anchor = document.createElement('button');
        anchor.id = 't34TextReferenceProbe';
        anchor.type = 'button';
        anchor.dataset.textPreview = 'T34 上游文本引用预览';
        document.getElementById('shell').appendChild(anchor);
        anchor.focus();
        showInputTextPreviewTooltip(anchor);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const tooltip = document.getElementById('inputTextPreviewTooltip');
        const surface = tooltip.shadowRoot.querySelector('[role="tooltip"]');
        const rect = surface.getBoundingClientRect();
        const result = {
          component: tooltip.localName,
          contract: tooltip.dataset.icContractStatus,
          placement: tooltip.getAttribute('placement'),
          content: tooltip.getAttribute('content'),
          open: tooltip.hasAttribute('open'),
          describedBy: anchor.getAttribute('aria-describedby'),
          tooltipId: surface.id,
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        };
        hideInputTextPreviewTooltip();
        result.closed = !tooltip.hasAttribute('open');
        result.descriptionRestored = !anchor.hasAttribute('aria-describedby');
        anchor.remove();
        return result;
      });

      await createdPromptNode.evaluate(node => {
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
      result.nodeClipboardScope = await page.evaluate(() => ({
        sessionNodeCount: JSON.parse(
          sessionStorage.getItem('smart_canvas_node_clipboard_v1') || 'null'
        )?.nodes?.length || 0,
        persistentClipboardCleared: !localStorage.getItem('smart_canvas_node_clipboard_v1'),
      }));
      await page.locator('#shell').click({button:'right', position:{x:720,y:420}});
      await page.waitForFunction(() => (
        document.getElementById('createMenu')?.hasAttribute('open')
        && !document.querySelector('#createMenu > ic-menu-item[value="paste"]')?.hidden
      ));
      result.blankCanvasPaste = await page.locator('#createMenu').evaluate(menu => {
        const paste = menu.querySelector(':scope > ic-menu-item[value="paste"]');
        return {
          visible: !paste.hidden,
          enabled: !paste.hasAttribute('disabled'),
          shortcut: paste.querySelector('kbd')?.textContent,
          separatorVisible: !menu.querySelector('[data-create-menu-paste-separator]')?.hidden,
          separatorImmediatelyBeforePaste: paste.previousElementSibling?.matches('[data-create-menu-paste-separator]'),
          structureSeparatorVisible: !menu.querySelector('[data-create-menu-structure-separator]')?.hidden,
          visibleValues: Array.from(menu.querySelectorAll(':scope > ic-menu-item:not([hidden])'))
            .map(item => item.getAttribute('value')),
          firstFocusedValue: document.activeElement?.getAttribute?.('value'),
        };
      });
      await page.keyboard.press('Escape');

      const promptNode = page.locator('.image-node.prompt-smart-node').first();
      const promptTextSurface = promptNode.locator('.prompt-node-text');
      await promptTextSurface.evaluate(surface => {
        const rect = surface.getBoundingClientRect();
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        surface.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + Math.min(24, rect.width / 2),
          clientY: rect.top + Math.min(24, rect.height / 2),
        }));
      });
      await page.waitForFunction(() => document.getElementById('smartNodeContextMenu')?.hasAttribute('open'));
      result.inactivePromptTextContextMenu = await page.evaluate(() => ({
        opened: document.getElementById('smartNodeContextMenu')?.hasAttribute('open'),
        nodeId: smartContextMenuState?.nodeId || '',
      }));
      await page.keyboard.press('Escape');
      result.activePromptTextNativeContext = await promptTextSurface.evaluate(surface => {
        beginPromptNodeTextEdit(surface.dataset.nodeId);
        const event = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 32,
          clientY: 32,
        });
        surface.dispatchEvent(event);
        const result = {
          editable: surface.isContentEditable,
          customMenuStayedClosed: !document.getElementById('smartNodeContextMenu')?.hasAttribute('open'),
          nativeContextAllowed: !event.defaultPrevented,
        };
        surface.blur();
        return result;
      });
      await promptNode.evaluate(node => {
        const rect = node.getBoundingClientRect();
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: Math.min(window.innerWidth - 8, rect.left + 24),
          clientY: Math.min(window.innerHeight - 8, rect.top + 24),
        }));
      });
      await page.waitForFunction(() => (
        document.getElementById('smartNodeContextMenu')?.hasAttribute('open')
        && document.activeElement?.matches?.('#smartNodeContextMenu > ic-menu-item[value="edit-prompt"]')
      ));
      await page.waitForFunction(() => [...document.querySelectorAll('#smartNodeContextMenu > ic-menu-item')]
        .every(item => item.shadowRoot?.querySelector('ic-icon')?.dataset.iconStatus === 'ready'));
      result.nodeContextMenu = await page.locator('#smartNodeContextMenu').evaluate(menu => {
        const surface = menu.shadowRoot.querySelector('[part="surface"]');
        const rect = surface.getBoundingClientRect();
        const surfaceStyle = getComputedStyle(surface);
        const items = [...menu.querySelectorAll(':scope > ic-menu-item')];
        const firstStyle = getComputedStyle(items[0].shadowRoot.querySelector('button'));
        const itemHeights = items.map(item => Math.round(item.shadowRoot.querySelector('button').getBoundingClientRect().height));
        return {
          component: menu.localName,
          contract: menu.dataset.icContractStatus,
          surfaceRole: surface.getAttribute('role'),
          accessibleLabel: surface.getAttribute('aria-label'),
          trigger: menu.getAttribute('trigger'),
          selection: menu.getAttribute('selection'),
          size: menu.getAttribute('size'),
          appearance: menu.getAttribute('appearance'),
          values: items.map(item => item.getAttribute('value')),
          publicItemsReady: items.every(item => item.dataset.icContractStatus === 'ready'),
          publicIconsReady: items.every(item => item.shadowRoot.querySelector('ic-icon')?.dataset.iconStatus === 'ready'),
          visibleIconCount: items.filter(item => {
            const icon = item.shadowRoot.querySelector('.icon');
            return icon && getComputedStyle(icon).display !== 'none' && icon.getBoundingClientRect().width > 0;
          }).length,
          separatorCount: menu.querySelectorAll(':scope > [role="separator"]').length,
          disabledValues: items.filter(item => item.hasAttribute('disabled')).map(item => item.getAttribute('value')),
          dangerValues: items.filter(item => item.getAttribute('tone') === 'danger').map(item => item.getAttribute('value')),
          shortcuts: Object.fromEntries(items.filter(item => item.querySelector('kbd')).map(item => [item.getAttribute('value'), item.querySelector('kbd').textContent])),
          nativeAuthoredButtons: menu.querySelectorAll('button').length,
          surfaceWidth: Math.round(rect.width),
          surfaceOverflowY: surfaceStyle.overflowY,
          surfaceMaxHeight: surfaceStyle.maxHeight,
          scrollable: surface.scrollHeight > surface.clientHeight,
          itemHeights: [...new Set(itemHeights)],
          firstFocusedValue: document.activeElement?.getAttribute?.('value'),
          pointerFocusIndicatorSuppressed: document.documentElement.dataset.icInputModality === 'pointer'
            && firstStyle.outlineStyle === 'none'
            && firstStyle.boxShadow === 'none'
            && firstStyle.backgroundColor === 'rgba(0, 0, 0, 0)',
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        };
      });
      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-node-context-menu-${theme}.png`,
        fullPage: false,
      });
      const expectedCopyNodeId = await promptNode.getAttribute('data-id');
      await page.keyboard.down('Shift');
      await page.waitForFunction(() => document.querySelector('#smartNodeContextMenu > ic-menu-item[value="copy-node-id"]'));
      result.nodeContextMenuShiftReveal = await page.locator('#smartNodeContextMenu').evaluate(menu => ({
        values: [...menu.querySelectorAll(':scope > ic-menu-item')].map(item => item.getAttribute('value')),
        label: menu.querySelector(':scope > ic-menu-item[value="copy-node-id"]')?.getAttribute('label'),
      }));
      await page.locator('#smartNodeContextMenu > ic-menu-item[value="copy-node-id"]').hover();
      result.nodeContextMenuShiftHover = await page.locator('#smartNodeContextMenu > ic-menu-item[value="copy-node-id"]').evaluate(item => {
        const probe = document.createElement('span');
        probe.style.background = 'var(--ui-color-action-secondary-hover)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          actual: getComputedStyle(item.shadowRoot.querySelector('[part="base"]')).backgroundColor,
          expected,
        };
      });
      await page.locator('#smartNodeContextMenu > ic-menu-item[value="copy-node-id"]').click();
      await page.keyboard.up('Shift');
      await page.waitForFunction(() => !document.getElementById('smartNodeContextMenu')?.hasAttribute('open'));
      result.nodeContextMenuCopyId = {
        expected: expectedCopyNodeId,
        clipboard: await page.evaluate(() => navigator.clipboard.readText()),
      };
      await promptNode.evaluate(node => {
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: Math.min(window.innerWidth - 8, rect.left + 24),
          clientY: Math.min(window.innerHeight - 8, rect.top + 24),
        }));
      });
      await page.waitForFunction(() => document.getElementById('smartNodeContextMenu')?.hasAttribute('open'));
      result.nodeContextMenuShiftReleased = await page.locator('#smartNodeContextMenu').evaluate(menu => (
        !menu.querySelector(':scope > ic-menu-item[value="copy-node-id"]')
      ));
      await page.keyboard.press('ArrowDown');
      result.nodeContextMenuKeyboardTarget = await page.evaluate(() => document.activeElement?.getAttribute?.('value'));
      await page.keyboard.press('Escape');
      result.nodeContextMenuEscape = await page.evaluate(() => ({
        closed: !document.getElementById('smartNodeContextMenu')?.hasAttribute('open'),
        focusReturnedTo: document.activeElement?.id,
      }));

      await promptNode.evaluate(node => {
        node.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: window.innerWidth - 2,
          clientY: window.innerHeight - 2,
        }));
      });
      await page.waitForFunction(() => document.getElementById('smartNodeContextMenu')?.hasAttribute('open'));
      result.nodeContextMenuEdge = await page.locator('#smartNodeContextMenu').evaluate(menu => {
        const rect = menu.shadowRoot.querySelector('[part="surface"]').getBoundingClientRect();
        return {
          shiftedFromInvocationPoint: rect.left < window.innerWidth - 2 && rect.top < window.innerHeight - 2,
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        };
      });
      await page.locator('#smartNodeContextMenu > ic-menu-item[value="duplicate"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.image-node.prompt-smart-node').length === 2);
      result.nodeContextMenuSelection = await page.evaluate(() => ({
        closed: !document.getElementById('smartNodeContextMenu')?.hasAttribute('open'),
        promptNodeCount: document.querySelectorAll('.image-node.prompt-smart-node').length,
      }));
      await page.locator('#shell').click({button:'right', position:{x:720,y:420}});
      await page.waitForFunction(() => (
        document.getElementById('createMenu')?.hasAttribute('open')
        && !document.querySelector('#createMenu > ic-menu-item[value="paste"]')?.hasAttribute('disabled')
      ));
      await page.locator('#createMenu > ic-menu-item[value="paste"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.image-node.prompt-smart-node').length === 3);
      result.blankCanvasPasteAction = await page.evaluate(() => ({
        closed: !document.getElementById('createMenu')?.hasAttribute('open'),
        promptNodeCount: document.querySelectorAll('.image-node.prompt-smart-node').length,
      }));
      result.theme = theme;
      result.errors = errors;

      await page.screenshot({
        path: `${screenshotDir}/t34-smart-canvas-back-${theme}.png`,
        fullPage: false,
      });
      evidence.push(result);
      await context.close();
    }

    console.log(JSON.stringify(evidence, null, 2));
    evidence.forEach(result => {
      assert.equal(result.component, 'ic-button');
      assert.equal(result.contract, 'ready');
      assert.equal(result.title, 'T34 · 返回与画布标题');
      assert.equal(result.nativeTitle, false);
      assert.equal(result.accessibleLabel, '返回画布列表');
      assert.equal(result.icon, 'back');
      assert.equal(result.iconStatus, 'ready');
      assert.equal(result.host.height, 40);
      assert.equal(result.base.height, 40);
      assert.equal(result.invalidContracts, 0);
      assert.equal(result.directWebAwesomeConsumers, 0);
      assert.equal(result.horizontalOverflow, 0);
      assert.equal(result.hiddenFileInputs, true);
      assert.equal(result.clickPreserved, true);
      assert.equal(result.dockBottom.component, 'ic-smart-canvas-dock');
      assert.equal(result.dockBottom.contract, 'ready');
      assert.equal(result.dockBottom.position, 'bottom');
      assert.equal(result.dockBottom.orientation, 'horizontal');
      assert.equal(result.dockBottom.ariaOrientation, 'horizontal');
      assert.equal(result.dockBottom.buttonCount, 10);
      assert.equal(result.dockBottom.publicButtonsReady, true);
      assert.equal(result.dockBottom.nativeTitleCount, 0);
      assert.equal(result.dockBottom.dividerOrientation, 'vertical');
      assert.equal(result.dockBottom.rect.height, 48);
      assert.equal(result.brushTooltipBottom.placement, 'block-start');
      assert.equal(result.brushTooltipBottom.label, '画笔');
      assert.equal(result.brushTooltipBottom.shortcut, 'P');
      assert.notEqual(result.brushTooltipBottom.shortcutColor, result.brushTooltipBottom.labelColor);
      assert.equal(result.horizontalKeyboardTarget, 'smartHandTool');
      assert.deepEqual(result.bottomPositionSetting, {
        value: 'bottom',
        contract: 'ready',
        label: '工具栏位置',
        componentName: 'ic-tabs-small',
        size: 'small',
        orientation: 'horizontal',
      });
      assert.equal(result.dockLeft.position, 'left');
      assert.equal(result.dockLeft.orientation, 'vertical');
      assert.equal(result.dockLeft.ariaOrientation, 'vertical');
      assert.equal(result.dockLeft.dividerOrientation, 'horizontal');
      assert.equal(result.dockLeft.positionSetting, 'left');
      assert.deepEqual(result.dockLeft.tooltipPlacements, ['inline-end']);
      assert.equal(result.dockLeft.rect.width, 48);
      assert.equal(result.dockLeft.centerOffset, 0);
      assert.deepEqual(result.dockLeft.shellScroll, { left: 0, top: 0 });
      assert.equal(result.dockLeft.buttonsInsideViewport, true);
      assert.equal(result.verticalKeyboardTarget, 'smartHandTool');
      assert.deepEqual(result.brushTooltipLeft, { placement: 'inline-end', label: '画笔', shortcut: 'P' });
      assert.deepEqual(result.leftSettingsPanel, { open: true, selectedPosition: 'left', clearsDock: true, insideViewport: true });
      assert.deepEqual(result.leftBrushOptions, { clearsDock: true, insideViewport: true });
      assert.equal(result.leftPositionRestored, true);
      assert.equal(result.createMenu.component, 'ic-menu');
      assert.equal(result.createMenu.contract, 'ready');
      assert.equal(result.createMenu.label, '创建节点');
      assert.equal(result.createMenu.trigger, 'dropdown');
      assert.equal(result.createMenu.selection, 'command');
      assert.equal(result.createMenu.size, 'small');
      assert.equal(result.createMenu.itemCount, 7);
      assert.equal(result.createMenu.publicItemsReady, true);
      assert.deepEqual(result.createMenu.iconNames, ['upload', 'prompt', 'generate', 'group', 'frame', 'split', 'loop']);
      assert.deepEqual(result.createMenu.labels, ['上传媒体', '提示词', '生成图片/视频', '编组', '分区', '分隔符', '批量运行']);
      assert.equal(result.createMenu.nativeAuthoredButtons, 0);
      assert.equal(result.createMenu.firstFocusedValue, 'upload');
      assert.equal(result.createMenu.pointerFocusIndicatorSuppressed, true);
      assert.equal(result.createMenu.pasteHidden, true);
      assert.equal(result.border.width, '0px');
      assert.equal(result.border.style, 'none');
      assert.equal(result.boxShadow, result.createMenu.boxShadow);
      assert.equal(result.createMenu.insideViewport, true);
      assert.deepEqual(result.createMenuPointerHover, {
        hoverBackgroundVisible: true,
        keyboardRingHidden: true,
      });
      assert.equal(result.createMenuKeyboardTarget, 'prompt');
      assert.deepEqual(result.createMenuKeyboardFocusIndicator, {
        keyboardModalityActive: true,
        outlineVisible: true,
        shadowVisible: true,
      });
      assert.deepEqual(result.createMenuEscape, { closed: true, focusReturnedTo: 'shell' });
      assert.deepEqual(result.createMenuEdge, {
        shiftedFromInvocationPoint: true,
        insideViewport: true,
        pointerFocusIndicatorSuppressed: true,
      });
      assert.deepEqual(result.createMenuSelection, { closed: true, promptNodeCount: 1 });
      assert.deepEqual(result.referenceGenerateMenu, {
        component: 'ic-menu',
        contract: 'ready',
        trigger: 'context',
        selection: 'command',
        size: 'small',
        values: ['text', 'image', 'video'],
        publicItemsReady: true,
        publicIconsReady: true,
        visibleHeading: '引用该节点生成',
        headingVisible: true,
        firstFocusedValue: 'text',
        sourcePinned: true,
        insideViewport: true,
      });
      assert.deepEqual(result.referenceGenerateBlankDismiss, {
        closed: true,
        temporaryGuideCount: 0,
      });
      assert.deepEqual(result.referenceGenerateSelection, {
        closed: true,
        triggerExpanded: 'false',
        sourcePinned: false,
        nodeCount: 2,
      });
      assert.equal(result.textReferenceTooltip.component, 'ic-tooltip');
      assert.equal(result.textReferenceTooltip.contract, 'ready');
      assert.equal(result.textReferenceTooltip.placement, 'block-start');
      assert.equal(result.textReferenceTooltip.content, 'T34 上游文本引用预览');
      assert.equal(result.textReferenceTooltip.open, true);
      assert.equal(result.textReferenceTooltip.describedBy, result.textReferenceTooltip.tooltipId);
      assert.equal(result.textReferenceTooltip.insideViewport, true);
      assert.equal(result.textReferenceTooltip.closed, true);
      assert.equal(result.textReferenceTooltip.descriptionRestored, true);
      assert.deepEqual(result.nodeClipboardScope, {
        sessionNodeCount: 1,
        persistentClipboardCleared: true,
      });
      assert.equal(result.inactivePromptTextContextMenu.opened, true);
      assert.ok(result.inactivePromptTextContextMenu.nodeId);
      assert.deepEqual(result.activePromptTextNativeContext, {
        editable: true,
        customMenuStayedClosed: true,
        nativeContextAllowed: true,
      });
      assert.deepEqual(result.blankCanvasPaste, {
        visible: true,
        enabled: true,
        shortcut: '⌘V',
        separatorVisible: true,
        separatorImmediatelyBeforePaste: true,
        structureSeparatorVisible: true,
        visibleValues: ['upload', 'prompt', 'generate', 'group', 'frame', 'splitter', 'loop', 'paste'],
        firstFocusedValue: 'upload',
      });
      assert.equal(result.nodeContextMenu.component, 'ic-smart-node-context-menu');
      assert.equal(result.nodeContextMenu.contract, 'ready');
      assert.equal(result.nodeContextMenu.surfaceRole, 'menu');
      assert.equal(result.nodeContextMenu.accessibleLabel, '节点操作');
      assert.equal(result.nodeContextMenu.trigger, 'context');
      assert.equal(result.nodeContextMenu.selection, 'command');
      assert.equal(result.nodeContextMenu.size, 'small');
      assert.equal(result.nodeContextMenu.appearance, 'iconless');
      assert.deepEqual(result.nodeContextMenu.values, [
        'edit-prompt', 'copy-prompt', 'save-prompt-preset',
        'disconnect-all',
        'copy', 'duplicate', 'delete',
      ]);
      assert.equal(result.nodeContextMenu.publicItemsReady, true);
      assert.equal(result.nodeContextMenu.publicIconsReady, true);
      assert.equal(result.nodeContextMenu.visibleIconCount, 0);
      assert.equal(result.nodeContextMenu.separatorCount, 2);
      assert.deepEqual(result.nodeContextMenu.disabledValues, []);
      assert.deepEqual(result.nodeContextMenu.dangerValues, ['delete']);
      assert.deepEqual(result.nodeContextMenu.shortcuts, {
        copy: '⌘C',
        duplicate: '⌘D',
        delete: 'Delete',
      });
      assert.equal(result.nodeContextMenu.nativeAuthoredButtons, 0);
      assert.equal(result.nodeContextMenu.surfaceWidth, 224);
      assert.equal(result.nodeContextMenu.surfaceOverflowY, 'hidden');
      assert.equal(result.nodeContextMenu.surfaceMaxHeight, 'none');
      assert.equal(result.nodeContextMenu.scrollable, false);
      assert.deepEqual(result.nodeContextMenu.itemHeights, [28]);
      assert.equal(result.nodeContextMenu.firstFocusedValue, 'edit-prompt');
      assert.equal(result.nodeContextMenu.pointerFocusIndicatorSuppressed, true);
      assert.equal(result.nodeContextMenu.insideViewport, true);
      assert.deepEqual(result.nodeContextMenuShiftReveal, {
        values: ['edit-prompt', 'copy-prompt', 'save-prompt-preset', 'copy', 'copy-node-id', 'duplicate', 'delete'],
        label: '复制节点 ID',
      });
      assert.equal(result.nodeContextMenuShiftHover.actual, result.nodeContextMenuShiftHover.expected);
      assert.ok(result.nodeContextMenuCopyId.expected);
      assert.equal(result.nodeContextMenuCopyId.clipboard, result.nodeContextMenuCopyId.expected);
      assert.equal(result.nodeContextMenuShiftReleased, true);
      assert.equal(result.nodeContextMenuKeyboardTarget, 'copy-prompt');
      assert.deepEqual(result.nodeContextMenuEscape, { closed: true, focusReturnedTo: 'shell' });
      assert.deepEqual(result.nodeContextMenuEdge, { shiftedFromInvocationPoint: true, insideViewport: true });
      assert.deepEqual(result.nodeContextMenuSelection, { closed: true, promptNodeCount: 2 });
      assert.deepEqual(result.blankCanvasPasteAction, { closed: true, promptNodeCount: 3 });
      assert.deepEqual(result.errors, []);
    });
    assert.notEqual(evidence[0].background, evidence[1].background);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
