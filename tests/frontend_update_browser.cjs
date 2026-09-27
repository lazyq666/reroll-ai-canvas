// Real pages, production notices/save paths, native WebSockets and enabled cache.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.env.ASSET_TEST_PYTHON || 'python3', ['tests/frontend_upgrade_fixture.py', String(port)], {cwd:root});
  let logs = '';
  server.stderr.on('data', chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const control = async (url, body) => {
    const response = await fetch(base + url, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    assert(response.ok, `${url}: ${response.status}`);
    return response.json();
  };
  let browser;
  try {
    for(let attempt=0; ; attempt++) {
      try { await control('/fixture/state'); break; }
      catch(error) {
        if(attempt >= 600 || server.exitCode !== null) throw new Error(`Fixture did not start: ${logs}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    browser = await chromium.launch({headless:true,
      ...(process.env.IC_BROWSER_BIN ? {executablePath:process.env.IC_BROWSER_BIN} : {}),
      args:process.platform === 'darwin' ? ['--use-mock-keychain','--password-store=basic'] : [],
    });
    const context = await browser.newContext({viewport:{width:1280,height:900}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = async target => target.waitForFunction(() => window.SmartCanvasModules?.canvasPersistence?.online() && window.upgradeProbe?.worker);
    const check = async () => page.evaluate(() => window.StudioFrontendUpdate.check());
    const dialog = page.locator('#frontendUpdateNotice');
    const confirm = dialog.locator('[data-update-action="apply"]');
    const cancel = dialog.locator('[data-update-action="later"]');
    await page.goto(`${base}/static/smart-canvas.html?id=upgrade-fixture`);
    await ready(page);
    console.log('Old page ready');
    await check();
    assert.equal(await dialog.count(), 0);
    await control('/fixture/options', {app_info_error:true});
    await check();
    assert.equal(await dialog.count(), 0, 'An unavailable server is not an upgrade');
    await control('/fixture/options', {app_info_error:false});
    const peerContext = await browser.newContext();
    const peer = await peerContext.newPage();
    await peer.goto(`${base}/static/smart-canvas.html?id=upgrade-fixture`);
    await ready(peer);
    await peer.evaluate(() => window.StudioFrontendUpdate.check());
    // Keep a real page control focused while the update arrives.
    await page.bringToFront();
    await page.locator('#smartResetView').focus();
    await control('/fixture/upgrade', {}); // Same VERSION, changed generated manifest.
    await page.bringToFront();
    await check();
    await dialog.locator('[data-update-action="later"]').waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => window.upgradeProbe.direct), 'old', 'Detection must not reload');
    assert.equal(await dialog.locator('h2').innerText(), 'Reroll 有新版');
    assert.equal(await confirm.innerText(), '应用更新');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'smartResetView', 'Arrival must not take focus');
    assert.equal(await page.locator('ic-confirmation-dialog[open]:visible, dialog[open]:visible, [aria-modal="true"]:visible').count(), 0);
    const placement = await page.evaluate(() => {
      const notice = document.getElementById('frontendUpdateNotice').getBoundingClientRect();
      const map = document.getElementById('minimap').getBoundingClientRect();
      const dot = document.querySelector('.frontend-update-dot');
      const color = document.createElement('span');
      color.style.color = 'var(--ui-color-icon-success)';
      document.body.append(color);
      const green = getComputedStyle(color).color;
      color.remove();
      return {width:notice.width, right:innerWidth - notice.right, aboveMap:notice.bottom <= map.top, fill:getComputedStyle(dot).fill, green};
    });
    assert(placement.width <= 320 && placement.right >= 20, JSON.stringify(placement));
    assert(placement.aboveMap, 'Notice must leave the navigation map usable');
    assert.equal(placement.fill, placement.green, 'Notification dot uses the green semantic token');
    await page.locator('#smartResetView').click(); // Pointer operation outside the notice remains available.
    assert.equal(await dialog.isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true, 'Canvas Escape must not dismiss an unrelated notice');
    await peer.bringToFront();
    await peer.evaluate(() => window.StudioFrontendUpdate.check());
    await peer.locator('#frontendUpdateNotice [data-update-action="apply"]').waitFor({state:'visible'});
    await page.bringToFront();
    assert.equal(await dialog.locator('[data-i18n="frontendUpdate.description"]').isVisible(), true);
    await page.screenshot({path:'/tmp/frontend-update-light.png'});
    await page.evaluate(() => { window.StudioI18n.set('en'); applyTheme('dark'); });
    assert.equal(await dialog.locator('h2').innerText(), 'Reroll update available');
    assert.equal(await confirm.innerText(), 'Apply update');
    await page.screenshot({path:'/tmp/frontend-update-dark.png'});
    await page.setViewportSize({width:390,height:720});
    const narrow = await dialog.boundingBox();
    assert(narrow.x >= 0 && narrow.x + narrow.width <= 390, 'Narrow windows keep actions inside the viewport');
    assert.equal(await confirm.isVisible(), true);
    await page.setViewportSize({width:1280,height:900});
    console.log('Update prompt, non-modal interaction, language/theme and narrow layout verified');
    // Keyboard cancellation uses the production card controls without a focus trap.
    await cancel.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('frontendUpdateNotice').hidden);
    await check();
    assert.equal(await dialog.isVisible(), false, 'Same update is snoozed');
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 11 * 60000;
    });
    await check();
    await confirm.waitFor({state:'visible'});
    await dialog.locator('[data-update-action="close"]').click();
    await check();
    assert.equal(await dialog.isVisible(), false, 'Close also snoozes');
    await page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 11 * 60000; });
    await check();
    await confirm.waitFor({state:'visible'});
    await confirm.focus();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false, 'Escape inside the card snoozes it');
    await page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 11 * 60000; });
    await check();
    await confirm.waitFor({state:'visible'});
    console.log('Snooze and reminder verified');
    await page.evaluate(() => { nodes[0].queuedGenerationRun = {id:'test-pending'}; });
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('#frontendUpdateNotice [role="status"]').textContent.includes('Finish editing'));
    assert.equal(await page.evaluate(() => window.upgradeProbe.direct), 'old');
    await page.evaluate(() => { delete nodes[0].queuedGenerationRun; });
    await control('/fixture/options', {disconnect:true});
    await page.waitForFunction(() => !window.SmartCanvasModules.canvasPersistence.online());
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('#frontendUpdateNotice [role="status"]').textContent.includes('Canvas not synced'));
    assert.equal(await page.evaluate(() => window.upgradeProbe.direct), 'old', 'Offline canvas must stay open');
    await control('/fixture/options', {disconnect:false});
    await ready(page);
    // Server connectivity failure keeps a synchronized page open.
    await control('/fixture/options', {app_info_error:true});
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('#frontendUpdateNotice [role="status"]').textContent.includes('Cannot reach the server'));
    await control('/fixture/options', {app_info_error:false, hold_mutations:true});
    console.log('Generation and unavailable-server guards verified');
    await page.evaluate(() => {
      nodes[0].title = 'Saved before update';
      window.SmartCanvasModules.canvasPersistence.schedule();
    });
    await confirm.click();
    assert.equal(await confirm.getAttribute('disabled'), '', 'Applying twice is disabled during save');
    assert.equal(await cancel.getAttribute('disabled'), '', 'Dismissal cannot conceal a pending reload');
    assert.equal(await dialog.locator('[data-update-action="close"]').getAttribute('disabled'), '');
    await page.waitForFunction(() => document.querySelector('#frontendUpdateNotice [role="status"]').textContent.includes('Canvas not synced'), null, {timeout:10000});
    assert.equal(await page.evaluate(() => window.upgradeProbe.direct), 'old', 'Save timeout must prevent refresh');
    await control('/fixture/options', {hold_mutations:false});
    console.log('Save timeout verified');
    await page.waitForFunction(() => !window.SmartCanvasModules.canvasPersistence.status().pending);
    // A fresh edit is still pending when the user asks to reload.
    await page.evaluate(() => {
      nodes[0].title = 'Latest edit survives update';
      window.SmartCanvasModules.canvasPersistence.schedule({delay:10000});
    });
    await Promise.all([page.waitForEvent('load'), confirm.click()]);
    await ready(page);
    assert.equal(await page.evaluate(() => window.upgradeProbe.direct), 'new');
    assert.equal(await page.evaluate(() => nodes[0].title), 'Latest edit survives update');
    assert.equal((await control('/fixture/state')).persisted.nodes[0].title, 'Latest edit survives update');
    assert.equal(await peer.evaluate(() => window.upgradeProbe.direct), 'old', 'Another session chooses its own refresh time');
    await peer.close();
    await peerContext.close();
    console.log('Saved edit and new code verified after refresh');
    await check();
    assert.equal(await dialog.count(), 0, 'Fresh page does not immediately prompt again');
    // Application-only release changes also count; rollback to baseline hides prompt.
    await control('/fixture/options', {version:'2026.09.23.2'});
    await check();
    await confirm.waitFor({state:'visible'});
    await control('/fixture/options', {version:'2026.09.23.1'});
    await check();
    await page.waitForFunction(async () => {
      await window.StudioFrontendUpdate.check();
      return document.getElementById('frontendUpdateNotice').hidden;
    });

    // The actual workbench hosts an actual canvas; only the parent owns polling.
    await page.goto(`${base}/static/index.html`);
    await page.waitForFunction(() => window.StudioFrontendUpdate);
    await check();
    await page.evaluate(() => { document.getElementById('frame-canvas').src='/static/smart-canvas.html?id=upgrade-fixture'; });
    const frame = await (await page.locator('#frame-canvas').elementHandle()).contentFrame();
    await ready(frame);
    assert.equal(await frame.evaluate(() => Boolean(window.StudioFrontendUpdate)), false);
    await control('/fixture/options', {version:'2026.09.23.3'});
    await check();
    await confirm.waitFor({state:'visible'});
    assert.equal(await frame.locator('#frontendUpdateNotice').count(), 0);
    await frame.evaluate(() => { nodes[0].textGenerationPending = true; });
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('#frontendUpdateNotice [role="status"]').textContent.length > 0);
    assert.equal(await page.evaluate(() => document.getElementById('frontendUpdateNotice').hidden), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({sameVersionAssetUpdate:true, unavailableSilent:true, snooze:true,
      keyboard:true, nonModal:true, preservesFocus:true, greenDot:true, avoidsMinimap:true, narrowLayout:true, lightDark:true, languageSwitch:true, generationBlocks:true, offlineBlocks:true, saveTimeoutBlocks:true,
      acknowledgedSaveBeforeReload:true, cachedPageLoadsNewCode:true, versionOnlyUpdate:true,
      rollback:true, independentSessions:true, onePromptAcrossFrames:true, childGenerationBlocksParentReload:true}, null, 2));
    await context.close();
  } catch(error) { throw new Error(`${error.stack}\n${logs.slice(-5000)}`); }
  finally {
    await browser?.close();
    server.kill('SIGTERM');
    const killTimer = setTimeout(() => server.kill('SIGKILL'), 3000);
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    clearTimeout(killTimer);
  }
})().catch(error => { console.error(error); process.exitCode=1; });
