const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const port = 19673;
const output = '/private/tmp/model-providers-connection-review';

(async () => {
  fs.mkdirSync(output, {recursive:true});
  const server = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd:root, env:{...process.env, API_SETTINGS_PREVIEW_PORT:String(port)}, stdio:['ignore','pipe','pipe'],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', chunk => {if(String(chunk).includes('API Settings preview:')) resolve();});
      server.on('exit', code => reject(new Error(`Preview exited ${code}`)));
    });
    browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/api-settings`);
    await page.locator('[data-provider-id="long-provider-name"] .provider-open').click();
    for (const theme of ['light','dark']) {
      await page.evaluate(value => window.StudioTheme.set(value), theme);
      for (const width of [1440,390]) {
        await page.setViewportSize({width,height:1000});
        for (const language of ['zh','en']) {
          await page.evaluate(value => window.StudioI18n.set(value), language);
          await page.locator('#connectionDetails').evaluate(element => {element.open = false;});
          assert.equal(await page.locator('#nameInput input').isVisible(),false);
          await page.locator('#connectionDetails summary').focus();
          await page.keyboard.press('Enter');
          await page.locator('#nameInput input').waitFor({state:'visible'});
          await page.locator('#connectionDetails summary').click();
          await page.locator('#connectionDetails summary').click();
          await page.screenshot({path:path.join(output,`connection-${theme}-${width}-${language}.png`),fullPage:true,animations:'disabled'});
          const surfaces = await page.evaluate(() => {
            const card = document.getElementById('providerSettingsCard');
            const form = card.querySelector('.form');
            const wrappers = [];
            for(let element = form; element !== card; element = element.parentElement) {
              const style = getComputedStyle(element);
              wrappers.push({background:style.backgroundColor,border:style.borderWidth,radius:style.borderRadius});
            }
            const heading = card.querySelector('.content-head');
            const surface = getComputedStyle(card.shadowRoot.querySelector('[part="base"]'));
            const scope = document.documentElement.getAttribute('data-ui-scope');
            const background = getComputedStyle(document.body).backgroundColor;
            document.documentElement.removeAttribute('data-ui-scope');
            const sharedBackground = getComputedStyle(document.body).backgroundColor;
            document.documentElement.setAttribute('data-ui-scope',scope);
            return {
              headingVisible:!!heading && getComputedStyle(heading).display !== 'none',
              wrappers, cardBackground:surface.backgroundColor, cardRadius:surface.borderRadius, background, sharedBackground,
              overflow:document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.equal(surfaces.headingVisible,false,'Connection summary must not have a duplicate heading strip');
          for (const wrapper of surfaces.wrappers) {
            assert.equal(wrapper.background,'rgba(0, 0, 0, 0)','Connection form wrappers must not paint rounded panels');
            assert.equal(wrapper.radius,'0px');
          }
          assert.equal(surfaces.cardBackground,'rgba(0, 0, 0, 0)');
          assert.equal(surfaces.cardRadius,'0px','Transparent card must not clip field labels at its corners');
          assert.equal(surfaces.background,surfaces.sharedBackground,'Page background must use the shared theme palette');
          assert.equal(surfaces.overflow,false,'Expanded connection must fit the viewport');
          assert.equal(await page.locator('#nameFormField').getAttribute('label'),language === 'zh' ? '供应商名称' : 'Provider name');
        }
      }
    }
    await page.locator('#nameInput input').fill('Renamed connection');
    await page.locator('#nameInput input').press('Tab');
    await page.waitForFunction(async () => {
      const state = await fetch('/api/test/state').then(response => response.json());
      return state.providers.find(provider => provider.id === 'long-provider-name').name === 'Renamed connection';
    });
    assert.deepEqual(errors,[]);
    console.log('Connection layout passed: expanded/collapsed, shared background, light/dark, desktop/mobile, Chinese/English, autosave.');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {console.error(error);process.exitCode=1;});
