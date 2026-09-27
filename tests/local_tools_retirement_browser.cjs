const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {server} = require('./local_generation_browser_fixture.cjs');

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=local-generation-browser&manual=1`);
    await page.waitForFunction(() => window.SmartCanvasModules?.generationProvider && window.StudioI18n);
    await page.addScriptTag({content:`
      window.retirementProbe = (lang, theme) => {
        window.StudioI18n.set(lang);
        window.StudioTheme.set(theme);
        selectedId = 'generation'; selectedIds = []; render();
        settings.engine = 'comfy'; settings.comfyMode = 'text';
        renderComfyParams();
        return {
          options: [...dynamicParams.querySelectorAll('[name="comfy-mode"] option')].map(o => ({value:o.value,label:o.textContent})),
          retiredFields: dynamicParams.querySelectorAll('[data-param="enhanceStrength"], [data-smart-select-param="editUpscaleRes"]').length,
          models: Object.keys(MS_GEN_MODELS),
          customHtml: (() => { settings.comfyMode='custom'; renderComfyParams(); return dynamicParams.textContent; })()
        };
      };
    `});
    for (const theme of ['light','dark']) {
      for (const lang of ['zh','en']) {
        const result = await page.evaluate(({lang,theme}) => window.retirementProbe(lang,theme), {lang,theme});
        assert.deepEqual(result.options.map(o => o.value), ['text','custom']);
        assert.deepEqual(result.options.map(o => o.label), lang === 'en' ? ['Text to image','Custom'] : ['文生图','自定义']);
        assert.equal(result.retiredFields, 0);
        assert.deepEqual(result.models, ['zimage','qwen_edit','custom']);
        assert.ok(!/smart\.|canvas\./.test(result.customHtml), 'Dynamic copy must resolve in both languages');
      }
    }
    assert.deepEqual(errors, []);
    if (process.env.RETIREMENT_SCREENSHOT) await page.screenshot({path:process.env.RETIREMENT_SCREENSHOT});
    console.log('Production Canvas: remaining ComfyUI modes and ModelScope options pass in Chinese/English and Light/Dark.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
