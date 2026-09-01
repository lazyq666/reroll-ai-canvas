const assert = require('node:assert/strict');
const { chromium } = require('playwright');


const baseUrl = process.env.ISSUE_81_PREVIEW_URL || 'http://127.0.0.1:8811';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const canvasId = 'issue-81-theme-switch-preview';


function canvasPayload() {
  return {
    canvas: {
      id: canvasId,
      title: 'Issue #81 · Theme switch',
      project: 'default',
      revision: 1,
      nodes: [],
      connections: [],
      settings: {},
      logs: [],
    },
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
    return { user: { id: 'issue-81-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === `/api/canvases/${canvasId}`) return canvasPayload();
  return {};
}


async function themeState(page) {
  return page.evaluate(() => {
    const control = document.getElementById('smartCanvasThemeToggle');
    return {
      tag: control?.tagName.toLowerCase(),
      label: control?.getAttribute('label'),
      size: control?.getAttribute('size'),
      icon: control?.getAttribute('icon'),
      contract: control?.dataset.icContractStatus,
      uiTheme: document.documentElement.dataset.uiTheme,
      htmlDark: document.documentElement.classList.contains('theme-dark'),
      bodyDark: document.body.classList.contains('theme-dark'),
      studioTheme: localStorage.getItem('studio_theme'),
      canvasTheme: localStorage.getItem('canvas_theme'),
    };
  });
}


async function settingsState(page) {
  return page.evaluate(() => {
    let reference = document.getElementById('issue81DropdownCommandReference');
    if (!reference) {
      reference = document.createElement('ic-menu');
      reference.id = 'issue81DropdownCommandReference';
      reference.setAttribute('label', 'Reference menu');
      reference.setAttribute('trigger', 'dropdown');
      reference.setAttribute('selection', 'command');
      const item = document.createElement('ic-menu-item');
      item.setAttribute('kind', 'command');
      item.setAttribute('label', 'Reference item');
      reference.append(item);
      document.body.append(reference);
    }
    const panel = document.getElementById('smartSettingsPanel');
    const row = panel.querySelector('.smart-canvas-settings-row');
    const menuSurface = reference.shadowRoot.querySelector('[part="surface"]');
    const menuItemBase = reference.querySelector('ic-menu-item').shadowRoot.querySelector('[part="base"]');
    const panelStyle = getComputedStyle(panel);
    const rowStyle = getComputedStyle(row);
    const menuStyle = getComputedStyle(menuSurface);
    const menuItemStyle = getComputedStyle(menuItemBase);
    const tokenProbe = document.createElement('span');
    tokenProbe.style.cssText = 'color:var(--ui-color-text-tertiary);font-size:var(--ui-font-size-2)';
    document.body.append(tokenProbe);
    const tokenProbeStyle = getComputedStyle(tokenProbe);
    const expectedDescriptionStyle = {
      color: tokenProbeStyle.color,
      fontSize: tokenProbeStyle.fontSize,
    };
    tokenProbe.remove();
    const dockControl = document.getElementById('smartCanvasDockPositionControl');
    const settingsBody = panel.querySelector('.smart-canvas-settings-body');
    const sectionHeading = panel.querySelector('.smart-canvas-settings-section-heading');
    const dockTab = dockControl?.querySelector('[data-value]');
    const imageToggle = document.getElementById('smartImagePerformanceToggle');
    const engineSelect = document.getElementById('engineSelect');
    const zoomSlider = document.getElementById('smartCanvasZoomSpeed');
    const panSlider = document.getElementById('smartCanvasPanSpeed');
    const helpers = [...panel.querySelectorAll('.smart-canvas-settings-copy > span')].map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: element.textContent.trim(),
        oneLine: rect.height <= Number.parseFloat(style.lineHeight) * 1.1,
        fits: element.scrollWidth <= element.clientWidth + 1,
        color: style.color,
        fontSize: style.fontSize,
      };
    });
    const switchLayout = control => {
      const hostRect = control.getBoundingClientRect();
      const track = control.shadowRoot.querySelector('[part~="control"]');
      const labelPart = control.shadowRoot.querySelector('[part~="label"]');
      const trackRect = track.getBoundingClientRect();
      return {
        ariaLabelledby: control.getAttribute('aria-labelledby'),
        ownedLabelPresent: Boolean(control.querySelector('[data-ic-owned-label]')),
        labelDisplay: getComputedStyle(labelPart).display,
        rightGap: Number((hostRect.right - trackRect.right).toFixed(2)),
      };
    };
    return {
      panel: {
        width: panelStyle.width,
        padding: panelStyle.padding,
        bodyPaddingBottom: getComputedStyle(settingsBody).paddingBottom,
        headingMarginTop: getComputedStyle(sectionHeading).marginTop,
        headingMarginBottom: getComputedStyle(sectionHeading).marginBottom,
        borderRadius: panelStyle.borderRadius,
        background: panelStyle.backgroundColor,
        boxShadow: panelStyle.boxShadow,
      },
      reference: {
        padding: menuStyle.padding,
        borderRadius: menuStyle.borderRadius,
        background: menuStyle.backgroundColor,
        boxShadow: menuStyle.boxShadow,
      },
      row: {
        minHeight: rowStyle.minHeight,
        fontSize: rowStyle.fontSize,
      },
      referenceItem: {
        minHeight: menuItemStyle.minHeight,
        fontSize: menuItemStyle.fontSize,
      },
      expectedDescriptionStyle,
      dock: {
        position: document.getElementById('smartCanvasDock')?.dataset.position,
        tag: dockControl?.tagName.toLowerCase(),
        componentName: dockControl?.dataset.componentName,
        label: dockControl?.getAttribute('label'),
        size: dockControl?.getAttribute('size'),
        orientation: dockControl?.getAttribute('orientation'),
        combination: dockControl?.getAttribute('data-legal-combination'),
        value: dockControl?.getAttribute('value'),
        fontSize: dockTab ? getComputedStyle(dockTab).fontSize : '',
        contract: dockControl?.dataset.icContractStatus,
      },
      image: {
        tag: imageToggle?.tagName.toLowerCase(),
        size: imageToggle?.getAttribute('size'),
        checked: imageToggle?.checked,
        contract: imageToggle?.dataset.icContractStatus,
      },
      switchLayouts: [switchLayout(imageToggle)],
      sections:[...panel.querySelectorAll('.smart-canvas-settings-section > h2, .smart-canvas-settings-section-heading > h2')].map(heading => heading.textContent.trim()),
      engine:{
        tag:engineSelect?.tagName.toLowerCase(),
        size:engineSelect?.getAttribute('size'),
        componentName:engineSelect?.dataset.componentName,
        contract:engineSelect?.dataset.icContractStatus,
      },
      zoom: {
        tag: zoomSlider?.tagName.toLowerCase(),
        size: zoomSlider?.getAttribute('size'),
        width: getComputedStyle(zoomSlider).width,
        value: zoomSlider?.getAttribute('value'),
        valueText: zoomSlider?.getAttribute('value-text'),
        contract: zoomSlider?.dataset.icContractStatus,
      },
      pan: {
        tag: panSlider?.tagName.toLowerCase(),
        size: panSlider?.getAttribute('size'),
        width: getComputedStyle(panSlider).width,
        value: panSlider?.getAttribute('value'),
        valueText: panSlider?.getAttribute('value-text'),
        contract: panSlider?.dataset.icContractStatus,
      },
      helpers,
      simplificationTogglePresent: Boolean(document.getElementById('smartFarModeToggle')),
      simplificationThresholdPresent: Boolean(document.getElementById('smartFarModeThreshold')),
    };
  });
}


(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(canvas => {
      if (!localStorage.getItem('studio_theme')) localStorage.setItem('studio_theme', 'light');
      if (!localStorage.getItem('canvas_theme')) localStorage.setItem('canvas_theme', 'light');
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
            this.onmessage?.({
              data: JSON.stringify({
                type: 'canvas_snapshot',
                revision: 1,
                canvas,
              }),
            });
          }, 0);
        }

        send(raw) {
          const message = JSON.parse(raw);
          if (message.type === 'ping') {
            this.onmessage?.({ data: JSON.stringify({ type: 'pong', revision: 1 }) });
          }
        }

        close(code = 1000) {
          this.readyState = PreviewWebSocket.CLOSED;
          this.onclose?.({ code });
        }
      }
      window.WebSocket = PreviewWebSocket;
    }, canvasPayload().canvas);
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(apiPayload(route.request().url())),
    }));

    const openPage = async () => {
      await page.goto(`${baseUrl}/static/smart-canvas.html?id=${canvasId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      const bootstrap = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        hasControl: Boolean(document.getElementById('smartCanvasThemeToggle')),
        bodyText: document.body?.innerText.slice(0, 240),
      }));
      assert.equal(bootstrap.hasControl, true, JSON.stringify({ bootstrap, errors }));
      try {
        await page.waitForFunction(() => (
          customElements.get('ic-switch')
          && customElements.get('ic-tabs')
          && customElements.get('ic-slider')
        ), null, { timeout: 15000 });
      } catch (error) {
        throw new Error(JSON.stringify({ bootstrap, errors, cause: error.message }));
      }
      await page.waitForFunction(() => [
        'smartCanvasDockPositionControl',
        'smartCanvasThemeToggle',
        'smartImagePerformanceToggle',
        'smartCanvasZoomSpeed',
        'smartCanvasPanSpeed',
      ].every(id => document.getElementById(id)?.dataset.icContractStatus === 'ready'));
      await page.waitForFunction(() => !document.querySelector('.smart-canvas-setting-switch > [data-ic-owned-label]'));
      await page.locator('#smartSettingsToggle').click();
      await page.waitForFunction(() => document.getElementById('smartSettingsPanel')?.classList.contains('open'));
    };

    await openPage();
    const initial = await themeState(page);
    assert.deepEqual(initial, {
      tag: 'ic-icon-button',
      label: '切换深色模式',
      size: 's',
      icon: 'theme',
      contract: 'ready',
      uiTheme: 'light',
      htmlDark: false,
      bodyDark: false,
      studioTheme: 'light',
      canvasTheme: 'light',
    });

    const settings = await settingsState(page);
    assert.equal(settings.panel.width, '344px');
    assert.equal(settings.panel.padding, '0px');
    assert.equal(settings.panel.bodyPaddingBottom, '0px');
    assert.equal(settings.panel.headingMarginTop, '8px');
    assert.equal(settings.panel.headingMarginBottom, '0px');
    assert.deepEqual(settings.sections, ['画布', '生成', '操作']);
    assert.deepEqual(settings.engine, {tag:'ic-select', size:'small', componentName:'ic-select-small', contract:'ready'});
    assert.deepEqual(settings.dock, {
      position: 'left',
      tag: 'ic-tabs',
      componentName: 'ic-tabs-small',
      label: '工具栏位置',
      size: 'small',
      orientation: 'horizontal',
      combination: 'horizontal-automatic-label',
      value: 'left',
      fontSize: '12px',
      contract: 'ready',
    });
    assert.deepEqual(settings.image, {
      tag: 'ic-switch',
      size: 'm',
      checked: true,
      contract: 'ready',
    });
    assert.deepEqual(settings.switchLayouts.map(layout => layout.ariaLabelledby), ['smartImagePerformanceLabel']);
    assert.equal(settings.switchLayouts.every(layout => (
      !layout.ownedLabelPresent
      && layout.labelDisplay === 'none'
      && Math.abs(layout.rightGap) <= 0.5
    )), true, JSON.stringify(settings.switchLayouts));
    assert.deepEqual(settings.zoom, { tag: 'ic-slider', size: 's', width: '128px', value: '100', valueText: '1 倍', contract: 'ready' });
    assert.deepEqual(settings.pan, { tag: 'ic-slider', size: 's', width: '128px', value: '100', valueText: '1 倍', contract: 'ready' });
    assert.deepEqual(settings.helpers, []);
    assert.equal(settings.simplificationTogglePresent, false);
    assert.equal(settings.simplificationThresholdPresent, false);
    if (process.env.ISSUE_81_SCREENSHOT_PATH) {
      await page.waitForTimeout(200);
      await page.screenshot({ path: process.env.ISSUE_81_SCREENSHOT_PATH, fullPage: false });
    }

    await page.locator('#smartCanvasDockPositionControl > [data-value="bottom"]').click();
    await page.waitForFunction(() => (
      document.getElementById('smartCanvasDock')?.dataset.position === 'bottom'
      && localStorage.getItem('smartCanvasDockPosition') === 'bottom'
    ));
    await page.locator('#smartCanvasDockPositionControl > [data-value="left"]').click();
    await page.waitForFunction(() => (
      document.getElementById('smartCanvasDock')?.dataset.position === 'left'
      && localStorage.getItem('smartCanvasDockPosition') === 'left'
    ));
    await page.locator('#smartImagePerformanceToggle').click();
    await page.waitForFunction(() => (
      localStorage.getItem('smartCanvasImagePerformanceOptimization') === 'off'
    ));
    assert.equal(await page.locator('#smartImagePerformanceToggle').evaluate(control => control.checked), false);

    await page.locator('#smartCanvasThemeToggle').click();
    await page.waitForFunction(() => document.documentElement.dataset.uiTheme === 'dark');
    const dark = await themeState(page);
    assert.equal(dark.icon, 'light');
    assert.equal(dark.label, '切换浅色模式');
    assert.equal(dark.htmlDark, true);
    assert.equal(dark.bodyDark, true);
    assert.equal(dark.studioTheme, 'dark');
    assert.equal(dark.canvasTheme, 'dark');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (
      document.documentElement.dataset.uiTheme === 'dark'
      && document.getElementById('smartCanvasThemeToggle')?.getAttribute('icon') === 'light'
    ));
    const reloaded = await themeState(page);
    assert.equal(reloaded.icon, 'light');
    assert.equal(reloaded.uiTheme, 'dark');
    assert.equal(reloaded.studioTheme, 'dark');

    await page.evaluate(() => window.StudioI18n?.set('en'));
    await page.waitForFunction(() => document.getElementById('smartCanvasThemeToggle')?.getAttribute('label') === 'Switch to Light Mode');
    assert.equal((await themeState(page)).label, 'Switch to Light Mode');

    await page.locator('#smartSettingsToggle').click();
    await page.waitForFunction(() => {
      const panel = document.getElementById('smartSettingsPanel');
      const control = document.getElementById('smartCanvasThemeToggle');
      return panel?.classList.contains('open')
        && getComputedStyle(panel).visibility === 'visible'
        && control?.getBoundingClientRect().height > 0;
    });
    const englishSettings = await settingsState(page);
    assert.deepEqual(englishSettings.helpers, []);
    const keyboardFocus = await page.locator('#smartCanvasThemeToggle').evaluate(control => {
      const button = control.shadowRoot?.querySelector('button');
      button?.focus();
      return {
        buttonFound: Boolean(button),
        documentActive: document.activeElement?.tagName,
        shadowActive: control.shadowRoot?.activeElement?.tagName,
        shadowHtml: control.shadowRoot?.innerHTML.slice(0, 1200),
      };
    });
    assert.equal(keyboardFocus.buttonFound, true, JSON.stringify(keyboardFocus));
    assert.equal(keyboardFocus.shadowActive, 'BUTTON', JSON.stringify(keyboardFocus));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.dataset.uiTheme === 'light');
    const light = await themeState(page);
    assert.equal(light.icon, 'theme');
    assert.equal(light.htmlDark, false);
    assert.equal(light.bodyDark, false);
    assert.equal(light.studioTheme, 'light');
    assert.equal(light.canvasTheme, 'light');
    assert.deepEqual(errors, []);

    process.stdout.write(`${JSON.stringify({ initial, dark, reloaded, light })}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
