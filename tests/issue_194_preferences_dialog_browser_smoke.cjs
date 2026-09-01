const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.ISSUE_194_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.ISSUE_194_SCREENSHOT_DIR || '';
const combinations = [
  { name: 'desktop-light-zh', theme: 'light', locale: 'zh', viewport: { width: 1440, height: 900 }, expectedLabel: '数据存储位置' },
  { name: 'desktop-dark-en', theme: 'dark', locale: 'en', viewport: { width: 1440, height: 900 }, expectedLabel: 'Data Storage Location' },
  { name: 'narrow-light-zh', theme: 'light', locale: 'zh', viewport: { width: 390, height: 844 }, expectedLabel: '数据存储位置' },
  { name: 'narrow-dark-en', theme: 'dark', locale: 'en', viewport: { width: 390, height: 844 }, expectedLabel: 'Data Storage Location' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const evidence = [];
  try {
    for (const combination of combinations) {
      const context = await browser.newContext({ viewport: combination.viewport });
      await context.addCookies([{ name: 't30-role', value: 'admin', url: baseUrl }]);
      const page = await context.newPage();
      const errors = [];
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', error => errors.push(String(error)));
      await page.addInitScript(({ theme, locale }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('studio_theme', theme);
        localStorage.setItem('studio_lang', locale);
      }, combination);
      await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForFunction(() => customElements.get('ic-dialog') && typeof openPreferencesModal === 'function');
      await page.evaluate(() => openPreferencesModal());
      await page.waitForFunction(() => document.getElementById('preferencesDialog')?.open);

      const observation = await page.locator('#preferencesDialog').evaluate(dialog => {
        const shell = dialog.shadowRoot.querySelector('[part="dialog"]');
        const header = dialog.shadowRoot.querySelector('[part="header"]');
        const body = dialog.shadowRoot.querySelector('[part="body"]');
        const shellRect = shell.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const contentRect = dialog.querySelector('.preferences-body').getBoundingClientRect();
        const bodyStyle = getComputedStyle(body);
        const headerStyle = getComputedStyle(header);
        const headerPadding = ['Top', 'Right', 'Left'].map(side => (
          Number.parseFloat(headerStyle[`padding${side}`])
        ));
        const padding = ['Top', 'Right', 'Bottom', 'Left'].map(side => (
          Number.parseFloat(bodyStyle[`padding${side}`])
        ));
        const contentInset = {
          left: contentRect.left - bodyRect.left,
          right: bodyRect.right - contentRect.right,
        };
        return {
          contract: dialog.dataset.icContractStatus,
          size: dialog.getAttribute('size'),
          label: dialog.getAttribute('label'),
          menuLabel: document.getElementById('preferences-entry').getAttribute('label'),
          width: Math.round(shellRect.width),
          withinViewport: shellRect.left >= 0
            && shellRect.top >= 0
            && shellRect.right <= innerWidth
            && shellRect.bottom <= innerHeight,
          bodyPadding: padding,
          headerPadding,
          contentInset,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${combination.name}.png`) });
      }
      evidence.push({ ...combination, ...observation, errors });
      await context.close();
    }

    const invalid = evidence.filter(item => (
      item.contract !== 'ready'
      || item.size !== 'medium'
      || item.label !== item.expectedLabel
      || item.menuLabel !== item.expectedLabel
      || item.width > 720
      || !item.withinViewport
      || item.bodyPadding.some(value => value !== 24)
      || item.headerPadding.some(value => value !== 24)
      || Math.abs(item.contentInset.left - item.contentInset.right) >= 1
      || item.horizontalOverflow > 0
      || item.errors.length
    ));
    if (invalid.length) throw new Error(`Unexpected issue #194 result: ${JSON.stringify({ evidence, invalid }, null, 2)}`);
    process.stdout.write(`${JSON.stringify({ ok: true, evidence }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
