const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.T25_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.T25_SCREENSHOT_DIR || '';

const combinations = [
  { theme: 'light', lang: 'en', viewport: { width: 1440, height: 900 }, name: 'desktop-light' },
  { theme: 'dark', lang: 'zh', viewport: { width: 1440, height: 900 }, name: 'desktop-dark' },
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
        if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.addInitScript(({ theme, lang }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('studio_theme', theme);
        localStorage.setItem('studio_lang', lang);
      }, combination);
      await page.goto(`${baseUrl}/zimage?token-review-theme=${combination.theme}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => (
        customElements.get('ic-dialog')
        && document.querySelector('#masonry')?.dataset.hbmAttached === '1'
        && document.querySelectorAll('.result-card').length === 15
      ));
      await page.waitForTimeout(250);

      const initial = await page.evaluate(() => {
        const consoleCard = document.getElementById('generationConsole').getBoundingClientRect();
        const consoleSurface = document.getElementById('generationConsole').shadowRoot.querySelector('.card').getBoundingClientRect();
        const engineSelector = document.getElementById('engineSelector').getBoundingClientRect();
        const dimensions = document.querySelector('.dimension-fields').getBoundingClientRect();
        const generateButton = document.getElementById('mainGenBtn').getBoundingClientRect();
        const grid = document.getElementById('masonry');
        return {
          theme: document.documentElement.dataset.uiTheme || (document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'),
          language: document.documentElement.lang,
          historyCards: document.querySelectorAll('.result-card').length,
          mediaContainers: document.querySelectorAll('.result-card ic-media-container').length,
          publicToolbarActions: document.querySelectorAll('.hbm-toolbar > ic-button').length,
          publicComponentsReady: ['ic-card', 'ic-textarea', 'ic-number-input', 'ic-segmented-control', 'ic-button', 'ic-dialog', 'ic-media-container'].every(tag => Boolean(customElements.get(tag))),
          invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
          directVendorTags: document.querySelectorAll('wa-button,wa-input,wa-textarea,wa-dialog,wa-card').length,
          nativeControlsOutsideSegmented: [...document.querySelectorAll('button,input,textarea,select')].filter(control => !control.closest('ic-segmented-control')).length,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
          consoleWidth: Math.round(consoleCard.width),
          consoleSurfaceWidth: Math.round(consoleSurface.width),
          internalOverflow: Math.max(engineSelector.right, dimensions.right, generateButton.right) - consoleSurface.right,
          internalRightEdges: {
            surface: Math.round(consoleSurface.right),
            engine: Math.round(engineSelector.right),
            dimensions: Math.round(dimensions.right),
            generate: Math.round(generateButton.right),
          },
          viewportWidth: document.documentElement.clientWidth,
        };
      });

      await page.locator('#mainGenBtn').hover();
      const generateHoverGeometry = await page.locator('#mainGenBtn').evaluate(host => {
        const base = host.shadowRoot.querySelector('.button');
        const hostRect = host.getBoundingClientRect();
        const baseRect = base.getBoundingClientRect();
        return {
          edgeDelta: Math.max(
            Math.abs(hostRect.left - baseRect.left),
            Math.abs(hostRect.top - baseRect.top),
            Math.abs(hostRect.right - baseRect.right),
            Math.abs(hostRect.bottom - baseRect.bottom),
          ),
          radius: getComputedStyle(base).borderRadius,
        };
      });

      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${combination.name}.png`), fullPage: true });
      }

      let interactions = null;
      let narrowPreview = null;
      if (combination.name === 'desktop-light') {
        await page.locator('#prompt').evaluate((element) => { element.value = '电影感海边建筑，清晨柔光'; });
        await page.locator('#mainGenBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('.result-card').length === 16);

        await page.locator('#engineSelector [data-value="cloud"]').click();
        await page.waitForFunction(() => document.getElementById('engineSelector').getAttribute('value') === 'cloud');
        await page.locator('#mainGenBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('.result-card').length === 17);

        await page.locator('.result-card ic-button[slot="footer"]').first().click();
        await page.waitForFunction(() => document.getElementById('lightbox').open && document.getElementById('lightboxMedia').getAttribute('state') === 'ready');
        await page.waitForTimeout(300);
        const preview = await page.evaluate(() => ({
          open: document.getElementById('lightbox').open,
          resolution: document.getElementById('lightboxRes').textContent.trim(),
          prompt: document.getElementById('lightboxPrompt').textContent.trim(),
          previewContract: document.getElementById('lightbox').dataset.icContractStatus,
        }));
        if (screenshotDir) {
          await page.screenshot({ path: path.join(screenshotDir, 'desktop-light-preview.png') });
        }
        await page.locator('#applySameStyleBtn').click();
        await page.waitForFunction(() => !document.getElementById('lightbox').open);
        const replicatedPrompt = await page.locator('#prompt').evaluate(element => element.value);

        await page.locator('.hbm-toolbar > ic-button').first().click();
        const selectedTimestamp = await page.locator('.result-card').first().getAttribute('data-history-ts');
        await page.locator('.result-card').first().click();
        await page.locator('.hbm-toolbar .hbm-danger').click();
        await page.waitForFunction(() => document.getElementById('bulkDeleteDialog').open);
        await page.locator('#bulkDeleteDialog [data-ic-confirmation-owned="confirm"]').click();
        await page.waitForFunction(timestamp => !document.querySelector(`[data-history-ts="${timestamp}"]`), selectedTimestamp);

        const apiState = await (await page.request.get(`${baseUrl}/api/test/state`)).json();
        interactions = {
          localRequest: apiState.localRequests.at(-1),
          cloudRequest: apiState.cloudRequests.at(-1),
          deleted: apiState.deleted.includes(selectedTimestamp),
          preview,
          replicatedPrompt,
          engineValue: await page.locator('#engineSelector').getAttribute('value'),
          remainingCards: await page.locator('.result-card').count(),
        };
      }
      if (combination.name === 'narrow-dark') {
        await page.locator('.result-card ic-button[slot="footer"]').first().click();
        await page.waitForFunction(() => document.getElementById('lightbox').open && document.getElementById('lightboxMedia').getAttribute('state') === 'ready');
        await page.waitForTimeout(300);
        narrowPreview = await page.evaluate(() => {
          const dialog = document.getElementById('lightbox').shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect();
          const frame = document.getElementById('lightboxFrame').getBoundingClientRect();
          const mediaFrame = document.getElementById('lightboxMedia').shadowRoot.querySelector('.frame').getBoundingClientRect();
          return {
            width: Math.round(dialog.width),
            frameWidth: Math.round(frame.width),
            frameHeight: Math.round(frame.height),
            mediaFrameHeight: Math.round(mediaFrame.height),
            horizontalOverflow: Math.max(0, dialog.right - innerWidth, -dialog.left),
            contract: document.getElementById('lightbox').dataset.icContractStatus,
          };
        });
        if (screenshotDir) {
          await page.screenshot({ path: path.join(screenshotDir, 'narrow-dark-preview.png') });
        }
        await page.locator('#lightbox').evaluate(element => element.hide('test'));
        await page.waitForFunction(() => !document.getElementById('lightbox').open);
      }

      evidence.push({
        name: combination.name,
        lang: combination.lang,
        viewport: combination.viewport,
        initial,
        generateHoverGeometry,
        interactions,
        narrowPreview,
        consoleErrors,
        pageErrors,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const invalid = evidence.filter(item => (
    item.initial.theme !== item.name.split('-').at(-1)
    || item.initial.language !== (item.lang === 'en' ? 'en' : 'zh-CN')
    || item.initial.historyCards !== 15
    || item.initial.mediaContainers !== 15
    || item.initial.publicToolbarActions !== 4
    || !item.initial.publicComponentsReady
    || item.initial.invalidContracts !== 0
    || item.initial.directVendorTags !== 0
    || item.initial.nativeControlsOutsideSegmented !== 0
    || item.initial.horizontalOverflow > 0
    || item.initial.internalOverflow > 1
    || item.generateHoverGeometry.edgeDelta > 1
    || item.generateHoverGeometry.radius !== '999px'
    || item.consoleErrors.length
    || item.pageErrors.length
  ));
  const desktop = evidence.find(item => item.name === 'desktop-light');
  const narrowDark = evidence.find(item => item.name === 'narrow-dark');
  const interactionsValid = Boolean(
    desktop?.interactions?.localRequest?.prompt === '电影感海边建筑，清晨柔光'
    && desktop.interactions.localRequest.width === 1024
    && desktop.interactions.localRequest.height === 1024
    && desktop.interactions.localRequest.type === 'zimage'
    && desktop.interactions.cloudRequest?.prompt === '电影感海边建筑，清晨柔光'
    && desktop.interactions.cloudRequest.resolution === '1024x1024'
    && desktop.interactions.cloudRequest.api_key === ''
    && desktop.interactions.deleted
    && desktop.interactions.preview.open
    && desktop.interactions.preview.resolution !== '…'
    && desktop.interactions.preview.previewContract === 'ready'
    && desktop.interactions.replicatedPrompt === desktop.interactions.preview.prompt
    && desktop.interactions.engineValue === 'cloud'
    && narrowDark?.narrowPreview?.horizontalOverflow === 0
    && narrowDark.narrowPreview.contract === 'ready'
    && Math.abs(narrowDark.narrowPreview.frameHeight - narrowDark.narrowPreview.mediaFrameHeight) <= 2
  );
  const responsiveValid = evidence.every(item => item.name.startsWith('narrow-') ? item.initial.gridColumns === 2 : item.initial.gridColumns === 4);
  if (invalid.length || !interactionsValid || !responsiveValid) {
    throw new Error(`Unexpected T25 ZImage browser result: ${JSON.stringify({ evidence, invalid: invalid.map(item => item.name), interactionsValid, responsiveValid }, null, 2)}`);
  }
  process.stdout.write(`${JSON.stringify({ evidence, interactionsValid, responsiveValid }, null, 2)}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
