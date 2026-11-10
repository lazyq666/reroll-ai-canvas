const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = 19678;

(async () => {
  const server = spawn('node', ['tests/t30_studio_shell_browser_app.cjs'], {
    cwd:root, env:{...process.env,T30_PREVIEW_PORT:String(port)}, stdio:['ignore','pipe','pipe'],
  });
  let browser;
  try {
    await new Promise((resolve,reject) => {
      server.stdout.once('data',resolve);
      server.once('exit',code => reject(new Error(`Preview exited ${code}`)));
    });
    browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage();
    await page.addInitScript(() => {
      if(window !== window.top) return;
      localStorage.setItem('studio_active_page','model-providers');
      localStorage.setItem('studio_brand_entry_seen','1');
    });
    await page.goto(`http://127.0.0.1:${port}/?page=canvas`);
    await page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    assert.equal(await page.locator('.stage iframe.active').getAttribute('id'),'frame-canvas');
    assert.equal(await page.evaluate(() => localStorage.getItem('studio_active_page')),'canvas');
    await page.context().addCookies([{name:'t30-role',value:'designer',url:`http://127.0.0.1:${port}`}]);
    await page.goto(`http://127.0.0.1:${port}/?page=model-providers`);
    await page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'));
    assert.equal(await page.locator('.stage iframe.active').getAttribute('id'),'frame-canvas');
    console.log('PASS: workspace handoff overrides remembered settings; explicit routes preserve role restrictions');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
