const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.ENHANCE_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.ENHANCE_SCREENSHOT_DIR || '';
const combinations = [
  { theme: 'light', lang: 'zh', viewport: { width: 1440, height: 1000 }, name: 'desktop-light' },
  { theme: 'dark', lang: 'en', viewport: { width: 1440, height: 1000 }, name: 'desktop-dark' },
  { theme: 'light', lang: 'en', viewport: { width: 390, height: 844 }, name: 'narrow-light' },
  { theme: 'dark', lang: 'zh', viewport: { width: 390, height: 844 }, name: 'narrow-dark' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const evidence = [];
  try {
    await fetch(`${baseUrl}/api/test/reset`, { method: 'POST' });
    for (const combination of combinations) {
      const page = await browser.newPage({ viewport: combination.viewport });
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.addInitScript(({ theme, lang }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('studio_theme', theme);
        localStorage.setItem('studio_lang', lang);
      }, combination);
      await page.goto(`${baseUrl}/enhance`, { waitUntil: 'networkidle' });
      try {
        await page.waitForFunction(() => (
          customElements.get('ic-file-input')
          && document.querySelectorAll('.archive-item').length === 2
          && document.querySelector('.hbm-toolbar ic-button')
        ));
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          readyState: document.readyState,
          fileInputDefined: Boolean(customElements.get('ic-file-input')),
          archiveCards: document.querySelectorAll('.archive-item').length,
          toolbar: Boolean(document.querySelector('.hbm-toolbar')),
          bodyText: document.body.innerText.slice(0, 500),
        }));
        throw new Error(`Enhance initialization timeout: ${JSON.stringify({ diagnostic, consoleErrors, pageErrors })}`);
      }

      const layout = await page.evaluate(() => ({
        invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
        language: document.documentElement.lang,
        invalidDetails: [...document.querySelectorAll('[data-ic-contract-status="invalid"]')].map(element => ({
          tag: element.localName,
          id: element.id,
          reason: element.dataset.icContractReason || element.getAttribute('ic-contract-error'),
        })),
        archiveCards: document.querySelectorAll('.archive-item').length,
        columns: getComputedStyle(document.querySelector('.enhance-workbench')).gridTemplateColumns.split(' ').filter(Boolean).length,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        directVendorTags: document.querySelectorAll('wa-button,wa-switch,wa-slider,wa-dialog').length,
        nativeVisibleButtons: [...document.querySelectorAll('button')].filter(button => !button.closest('ic-button,ic-icon-button,ic-dialog,ic-confirmation-dialog')).length,
        uploadComponentName: document.querySelector('#sourcePreview').dataset.componentName,
        uploadState: document.querySelector('#sourcePreview').getAttribute('state'),
        fileInputHidden: document.querySelector('#fileInput').hidden,
        legacyUploadCopyVisible: (() => {
          const fileInput = document.querySelector('#fileInput');
          const label = fileInput.shadowRoot.querySelector('.label');
          const summary = fileInput.shadowRoot.querySelector('.summary');
          return [label, summary].some(element => element && getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0);
        })(),
        theme: document.documentElement.dataset.uiTheme,
      }));

      let interaction = null;
      if (combination.name === 'desktop-light') {
        const fileInput = page.locator('#fileInput').locator('input[type="file"]');
        await fileInput.setInputFiles({
          name: 'enhance.png', mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64'),
        });
        await page.waitForFunction(() => document.querySelector('#sourcePreview').getAttribute('state') === 'normal');
        await page.evaluate(() => document.querySelector('#sourcePreview').preview());
        await page.waitForFunction(() => document.querySelector('#sourceLightbox').open);
        await page.evaluate(() => { window.__enhanceSmokeSourcePreviewOpened = true; });
        await page.evaluate(() => document.querySelector('#sourceLightbox').hide('smoke'));
        await page.evaluate(() => document.querySelector('#sourcePreview').remove());
        await page.waitForFunction(() => document.querySelector('#fileInput').hidden && document.querySelector('#sourcePreview').getAttribute('state') === 'upload');
        await fetch(`${baseUrl}/api/test/fail-upload`, { method: 'POST' });
        await fileInput.setInputFiles({
          name: 'enhance-failure.png', mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64'),
        });
        await page.waitForFunction(() => document.querySelector('ic-toast[data-ic-overlay]')?.textContent.includes('上传失败'));
        await page.evaluate(() => { window.__enhanceSmokeUploadToast = true; });
        await page.evaluate(() => document.querySelector('#sourcePreview').remove());
        await page.waitForFunction(() => document.querySelector('#fileInput').hidden && document.querySelector('#sourcePreview').getAttribute('state') === 'upload');
        await fileInput.setInputFiles({
          name: 'enhance-again.png', mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64'),
        });
        await page.waitForFunction(() => document.querySelector('#sourcePreview').getAttribute('state') === 'normal');
        await page.locator('#upscaleToggle').click();
        await page.locator('#btn4x').click();
        await page.evaluate(() => {
          const slider = document.querySelector('#strengthSlider');
          slider.value = 0.72;
          slider.setAttribute('value', '0.72');
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.locator('#genBtn').click();
        await page.waitForFunction(() => !document.querySelector('#outputMedia').hidden);
        await page.locator('#previewBtn').click();
        await page.waitForFunction(() => document.querySelector('#lightbox').open);
        await page.evaluate(() => {
          const slider = document.querySelector('#compareSlider');
          slider.value = 35;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.evaluate(() => document.querySelector('#lightbox').hide('smoke'));

        await page.locator('.hbm-toolbar ic-button').first().click();
        await page.locator('.archive-item').first().click();
        await page.locator('.hbm-danger').click();
        await page.waitForFunction(() => document.querySelector('#historyDeleteDialog').open);
        await page.evaluate(() => document.querySelector('#historyDeleteDialog').confirm());
        await page.waitForFunction(() => document.querySelectorAll('.archive-item').length === 2);
        await page.locator('.hbm-primary').click();

        interaction = await page.evaluate(async () => ({
          sourceState: document.querySelector('#sourcePreview').getAttribute('state'),
          sourceFit: document.querySelector('#sourcePreview').getAttribute('fit'),
          sourceObjectFit: getComputedStyle(document.querySelector('#sourcePreview').shadowRoot.querySelector('img')).objectFit,
          sourcePreviewOpened: window.__enhanceSmokeSourcePreviewOpened === true,
          uploadFailureToast: window.__enhanceSmokeUploadToast === true,
          strength: Number(document.querySelector('#strengthSlider').value),
          factor4x: document.querySelector('#btn4x').pressed,
          outputSrc: document.querySelector('#outputImg').getAttribute('src'),
          comparePosition: document.querySelector('#compareContainer').style.getPropertyValue('--enhance-compare-position'),
          historyManagerClosed: !document.body.classList.contains('history-bulk-selecting'),
          server: await fetch('/api/test/state').then(response => response.json()),
        }));
      }

      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${combination.name}.png`), fullPage: true });
      }
      evidence.push({ ...combination, ...layout, interaction, consoleErrors, pageErrors });
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
    || item.directVendorTags !== 0
    || item.nativeVisibleButtons !== 0
    || item.uploadComponentName !== 'ic-image-frame-upload'
    || item.uploadState !== 'upload'
    || !item.fileInputHidden
    || item.legacyUploadCopyVisible
    || item.theme !== item.name.split('-')[1]
    || (item.name.startsWith('narrow-') ? item.columns !== 1 : item.columns !== 2)
    || item.consoleErrors.length
    || item.pageErrors.length
  ));
  const interaction = evidence[0].interaction;
  if (
    invalid.length
    || interaction?.sourceState !== 'normal'
    || interaction?.sourceFit !== 'contain'
    || interaction?.sourceObjectFit !== 'contain'
    || !interaction?.sourcePreviewOpened
    || !interaction?.uploadFailureToast
    || interaction?.strength !== 0.72
    || !interaction?.factor4x
    || interaction?.outputSrc !== '/api/mock-image/upscaled.png'
    || interaction?.comparePosition !== '35%'
    || !interaction?.historyManagerClosed
    || interaction?.server?.uploads !== 4
    || interaction?.server?.generations?.length !== 2
    || interaction?.server?.generations?.[0]?.workflow_json !== 'Z-Image-Enhance.json'
    || interaction?.server?.generations?.[1]?.workflow_json !== 'upscale.json'
    || interaction?.server?.generations?.[1]?.params?.['172']?.resolution !== 4096
    || interaction?.server?.deletes?.length !== 1
  ) {
    throw new Error(`Unexpected Enhance browser result: ${JSON.stringify({ evidence, invalid }, null, 2)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, evidence }, null, 2)}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
