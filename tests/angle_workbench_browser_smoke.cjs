const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.ANGLE_PREVIEW_URL || 'http://127.0.0.1:8797';
const browserExecutable = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.ANGLE_SCREENSHOT_DIR || '';
const combinations = [
  { theme: 'light', lang: 'en', viewport: { width: 1440, height: 1000 }, name: 'desktop-light' },
  { theme: 'dark', lang: 'zh', viewport: { width: 1440, height: 1000 }, name: 'desktop-dark' },
  { theme: 'light', lang: 'en', viewport: { width: 390, height: 844 }, name: 'narrow-light' },
  { theme: 'dark', lang: 'zh', viewport: { width: 390, height: 844 }, name: 'narrow-dark' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const evidence = [];
  try {
    for (const combination of combinations) {
      const page = await browser.newPage({ viewport: combination.viewport });
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.addInitScript(({ theme, lang }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('studio_theme', theme);
        localStorage.setItem('studio_lang', lang);
        class MockWebSocket extends EventTarget {
          static OPEN = 1;
          readyState = MockWebSocket.OPEN;
          constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
          send() {}
          close() {}
        }
        window.WebSocket = MockWebSocket;
      }, combination);
      await page.goto(`${baseUrl}/angle`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => customElements.get('ic-card') && document.readyState === 'complete');
      await page.waitForTimeout(500);

      const initial = await page.evaluate(() => {
        const workspace = document.querySelector('.angle-workspace');
        const camera = document.querySelector('.camera-layout');
        return {
          invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
          language: document.documentElement.lang,
          archiveCards: document.querySelectorAll('.archive-card').length,
          workspaceColumns: getComputedStyle(workspace).gridTemplateColumns.split(' ').filter(Boolean).length,
          cameraColumns: getComputedStyle(camera).gridTemplateColumns.split(' ').filter(Boolean).length,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          canvasSize: {
            width: Math.round(document.querySelector('#threeContainer canvas')?.getBoundingClientRect().width || 0),
            height: Math.round(document.querySelector('#threeContainer canvas')?.getBoundingClientRect().height || 0),
          },
          visibleUploadSurfaces: ['dropzone', 'inputPreview']
            .filter(id => getComputedStyle(document.getElementById(id)).display !== 'none'),
          inputPanelChildren: [...document.querySelector('.input-panel').children]
            .map(node => node.id || node.localName),
          uploadFrameState: document.getElementById('inputPreview').getAttribute('state'),
          uploadComponentName: document.getElementById('inputPreview').dataset.componentName,
          visibleResultStates: ['emptyState', 'loadingState', 'textResult', 'outputMedia']
            .filter(id => getComputedStyle(document.getElementById(id)).display !== 'none'),
        };
      });

      let interaction = null;
      if (combination.name === 'desktop-light') {
        const fileInput = page.locator('#dropzone').locator('input[type="file"]');
        await fileInput.setInputFiles({ name: 'angle.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64') });
        await page.waitForFunction(() => document.getElementById('inputPreview').getAttribute('state') === 'normal');
        await page.evaluate(() => {
          const slider = document.getElementById('rotate-h');
          slider.value = 30;
          slider.setAttribute('value', '30');
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.locator('#genBtn').click();
        await page.waitForFunction(() => !document.getElementById('outputMedia').hidden);
        const localOutput = await page.locator('#outputImg').getAttribute('src');
        await page.locator('#engineMode [data-value="cloud"]').click();
        await page.locator('#genBtn').click();
        await page.waitForFunction(() => document.getElementById('outputImg').getAttribute('src') === '/api/mock-image/generated-cloud.png');
        await page.locator('#archiveManageBtn').click();
        await page.locator('.archive-card').first().click();
        await page.locator('#archiveDeleteBtn').click();
        await page.waitForFunction(() => document.getElementById('archiveDeleteDialog').open);
        await page.evaluate(() => document.getElementById('archiveDeleteDialog').confirm());
        await page.waitForFunction(() => !document.getElementById('archiveDeleteDialog').open);
        interaction = await page.evaluate(async localOutput => ({
          previewState: document.getElementById('inputPreview').getAttribute('state'),
          prompt: document.getElementById('promptInput').value,
          localOutput,
          outputSrc: document.getElementById('outputImg').getAttribute('src'),
          archiveCards: document.querySelectorAll('.archive-card').length,
          managerExited: !document.getElementById('archiveManageBtn').hidden,
          visibleResultStates: ['emptyState', 'loadingState', 'textResult', 'outputMedia']
            .filter(id => getComputedStyle(document.getElementById(id)).display !== 'none'),
          server: await fetch('/api/test/state').then(response => response.json()),
        }), localOutput);
      }

      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${combination.name}.png`), fullPage: true });
      }
      evidence.push({ ...combination, ...initial, interaction, consoleErrors, pageErrors });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const invalid = evidence.filter(item => (
    item.invalidContracts !== 0
    || item.language !== (item.lang === 'en' ? 'en' : 'zh-CN')
    || item.archiveCards !== 2
    || item.horizontalOverflow > 0
    || JSON.stringify(item.visibleUploadSurfaces) !== JSON.stringify(['inputPreview'])
    || JSON.stringify(item.inputPanelChildren) !== JSON.stringify(['ic-heading', 'inputPreview'])
    || item.uploadFrameState !== 'upload'
    || item.uploadComponentName !== 'ic-image-frame-upload'
    || item.canvasSize.width <= 0
    || item.canvasSize.height <= 0
    || item.visibleResultStates.length !== 1
    || item.visibleResultStates[0] !== 'emptyState'
    || (item.name.startsWith('narrow-') ? item.workspaceColumns !== 1 : item.workspaceColumns !== 2)
    || (item.name.startsWith('narrow-') ? item.cameraColumns !== 1 : item.cameraColumns !== 2)
    || item.consoleErrors.length
    || item.pageErrors.length
  ));
  const interaction = evidence[0].interaction;
  if (
    invalid.length
    || interaction?.previewState !== 'normal'
    || !interaction?.prompt.includes('30')
    || interaction?.localOutput !== '/api/mock-image/generated-local.png'
    || interaction?.outputSrc !== '/api/mock-image/generated-cloud.png'
    || interaction?.archiveCards !== 3
    || !interaction?.managerExited
    || interaction?.visibleResultStates?.length !== 1
    || interaction?.visibleResultStates?.[0] !== 'outputMedia'
    || interaction?.server?.uploads !== 1
    || interaction?.server?.generations !== 2
    || interaction?.server?.deletes?.length !== 1
  ) {
    throw new Error(`Unexpected Angle browser result: ${JSON.stringify({ evidence, invalid }, null, 2)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, evidence }, null, 2)}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
