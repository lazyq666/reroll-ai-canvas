const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const fs = require('node:fs');
const base = process.env.CLOUD_PREVIEW_URL || 'http://127.0.0.1:8806';

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    for (const [lang, theme, width] of [['zh','light',1440],['en','dark',1440],['zh','dark',390],['en','light',390]]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({lang,theme}) => {
        localStorage.setItem('studio_lang',lang); localStorage.setItem('studio_theme',theme);
      }, {lang,theme});
      await page.route('**/api/workspace-storage-settings', route => route.fulfill({json:{active:{workspace_directory:'/synthetic-workspace'},cloud_records:{enabled:true,status:'connected'}}}));
      let release;
      await page.route('**/api/workspace-storage-settings/cloud', async route => {
        assert.equal(route.request().postDataJSON().enabled, false);
        await new Promise(resolve => {release = resolve;});
        await route.fulfill({status:503,json:{code:'cloud_storage_tasks_pending',detail:{code:'cloud_storage_tasks_pending'}}});
      });
      await page.goto(base + '/studio');
      await page.waitForFunction(() => !document.getElementById('studioEntryMotion'));
      await page.evaluate(() => openPreferencesModal());
      const toggle = page.locator('[data-cloud-storage]');
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('checked'), '');
      assert.equal(await page.locator('[data-cleanup-scan]').getAttribute('disabled'), '');
      // Keyboard operation on the real shared switch.
      await toggle.focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('[data-cloud-storage]')?.hasAttribute('disabled'));
      assert.ok(release, 'the switch must submit the requested storage mode');
      const next = lang === 'zh' ? 'en' : 'zh';
      await page.evaluate(next => StudioI18n.set(next), next);
      await page.getByText(next === 'en' ? 'Switching storage. Wait for verification and restart to finish…' : '正在切换保存位置，请等待校验和重启完成…', {exact:true}).waitFor();
      release();
      await page.getByText(next === 'en' ? 'Finish or cancel generation and batch tasks before switching storage.' : '请先完成或取消当前生成和批量任务，再切换保存位置。', {exact:true}).waitFor();
      assert.equal(await toggle.getAttribute('checked'), '', 'failure must retain the active cloud mode');
      await page.evaluate(lang => StudioI18n.set(lang), lang);
      await page.getByText(lang === 'en' ? 'Finish or cancel generation and batch tasks before switching storage.' : '请先完成或取消当前生成和批量任务，再切换保存位置。', {exact:true}).waitFor();
      const layout = await page.locator('#preferencesDialog').evaluate(dialog => {
        const rect = dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect();
        return {within:rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, overflow:document.documentElement.scrollWidth > innerWidth};
      });
      assert.deepEqual(layout,{within:true,overflow:false});
      assert.deepEqual(errors,[]);
      fs.mkdirSync('/private/tmp/reroll-cloud-ui',{recursive:true});
      await page.screenshot({path:`/private/tmp/reroll-cloud-ui/${lang}-${theme}-${width}.png`});
      await context.close();
    }
    console.log('cloud storage browser: four layouts, keyboard toggle, pending/error language changes, unchanged active mode passed');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
