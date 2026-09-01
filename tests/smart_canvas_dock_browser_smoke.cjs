const assert = require('node:assert/strict');
const { chromium } = require('playwright');


const baseUrl = process.env.SMART_CANVAS_DOCK_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';


(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.goto(`${baseUrl}/static/ui-component-library.html#smart-canvas-dock`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const frame = page.frameLocator('iframe[data-smart-canvas-dock-matrix]');
    await frame.locator('ic-smart-canvas-dock[data-position="left"]').waitFor({ timeout: 15000 });
    await frame.locator('ic-smart-canvas-dock[data-position="bottom"]').waitFor({ timeout: 15000 });
    await frame.locator('ic-smart-canvas-dock[data-position="left"]').evaluate(dock => (
      customElements.whenDefined('ic-smart-canvas-dock').then(() => {
        if (dock.dataset.icContractStatus !== 'ready') throw new Error('left Dock contract is not ready');
      })
    ));

    const result = await frame.locator('main').evaluate(main => {
      const readDock = position => {
        const dock = main.querySelector(`ic-smart-canvas-dock[data-position="${position}"]`);
        const rect = dock.getBoundingClientRect();
        const stage = dock.closest('article').getBoundingClientRect();
        const example = dock.parentElement.getBoundingClientRect();
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;border-radius:var(--ui-radius-l);color:var(--ui-color-text-secondary)';
        document.body.append(probe);
        const expectedStyle = getComputedStyle(probe);
        const dockStyle = getComputedStyle(dock);
        const defaultItemStyle = getComputedStyle(dock.querySelector(':scope > ic-icon-button:not([pressed])'));
        const radiusMatches = dockStyle.borderRadius === expectedStyle.borderRadius;
        const itemColorMatches = defaultItemStyle.color === expectedStyle.color;
        const directButtons = Array.from(dock.children).filter(element => element.matches('ic-icon-button'));
        const firstButtonRect = directButtons[0].getBoundingClientRect();
        const lastButtonRect = directButtons.at(-1).getBoundingClientRect();
        const edgeGaps = position === 'left'
          ? [
              firstButtonRect.top - rect.top,
              rect.bottom - lastButtonRect.bottom,
              firstButtonRect.left - rect.left,
              rect.right - firstButtonRect.right,
            ]
          : [
              firstButtonRect.top - rect.top,
              rect.bottom - firstButtonRect.bottom,
              firstButtonRect.left - rect.left,
              rect.right - lastButtonRect.right,
            ];
        const equalEdgeSpacing = Math.max(...edgeGaps) - Math.min(...edgeGaps) < 0.5;
        probe.remove();
        return {
          tag: dock.localName,
          contract: dock.dataset.icContractStatus,
          position: getComputedStyle(dock).position,
          orientation: dock.getAttribute('orientation'),
          ariaOrientation: dock.getAttribute('aria-orientation'),
          buttonCount: dock.querySelectorAll(':scope > ic-icon-button').length,
          dividerOrientation: dock.querySelector(':scope > ic-divider')?.getAttribute('orientation'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          centered: Math.abs((example.left + example.width / 2) - (stage.left + stage.width / 2)) < 1
            && Math.abs((example.top + example.height / 2) - (stage.top + stage.height / 2)) < 1,
          radiusMatches,
          itemColorMatches,
          equalEdgeSpacing,
        };
      };
      return {
        theme: document.documentElement.dataset.uiTheme,
        left: readDock('left'),
        bottom: readDock('bottom'),
      };
    });

    assert.equal(result.theme, 'light');
    assert.deepEqual(
      { ...result.left, width: undefined, height: undefined },
      {
        tag: 'ic-smart-canvas-dock', contract: 'ready', position: 'relative',
        orientation: 'vertical', ariaOrientation: 'vertical', buttonCount: 10,
        dividerOrientation: 'horizontal', width: undefined, height: undefined, centered: true,
        radiusMatches: true, itemColorMatches: true, equalEdgeSpacing: true,
      },
    );
    assert.deepEqual(
      { ...result.bottom, width: undefined, height: undefined },
      {
        tag: 'ic-smart-canvas-dock', contract: 'ready', position: 'relative',
        orientation: 'horizontal', ariaOrientation: 'horizontal', buttonCount: 10,
        dividerOrientation: 'vertical', width: undefined, height: undefined, centered: true,
        radiusMatches: true, itemColorMatches: true, equalEdgeSpacing: true,
      },
    );
    assert.ok(result.left.height > result.left.width * 5);
    assert.ok(result.bottom.width > result.bottom.height * 5);

    await page.locator('[data-target-theme-toggle]').click();
    await frame.locator('html[data-ui-theme="dark"]').waitFor({ timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
