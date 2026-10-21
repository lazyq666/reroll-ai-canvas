const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {chromium} = require('playwright');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
    const child = spawn(path.join(root, '.venv/bin/python'), ['tests/agent_canvas_fixture.py'], {cwd:root, stdio:['ignore','pipe','pipe']});
    let logs = '';
    child.stderr.on('data', d => logs += d);
    let browser;
    try {
        const config = await new Promise((resolve, reject) => {
            let out = '';
            const timer = setTimeout(() => reject(Error(logs)), 15000);
            child.stdout.on('data', d => {
                out += d;
                const line = out.split('\n').find(x => x.startsWith('{"port"'));
                if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
            });
        });
        const base = `http://127.0.0.1:${config.port}`;
        browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
        const context = await browser.newContext();
        await context.addCookies([{name:'ic_session', value:config.cookie, url:base}]);
        const writes = [];
        let pending = true;
        await context.route('**/api/**', route => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname === '/api/account/agent-pairings') return route.fulfill({json:{requests:pending?[{id:'fixture',name:'Test client',ip:'127.0.0.1',code:'ABC123'}]:[],enabled:false,can_enable:true,account:'admin'}});
            if (pathname.startsWith('/api/account/agent-pairings/')) {
                writes.push(route.request().postDataJSON()); pending=false;
                return route.fulfill({json:{state:'denied'}});
            }
            if (pathname === '/api/auth/me') return route.fulfill({json:{user:config.user}});
            if (pathname === '/api/account/agent-access') return route.fulfill({json:{enabled:false,concurrency:2,confirmation:false}});
            return route.fulfill({json:apiPayload(route.request().url())});
        });
        const page = await context.newPage();
        const events = [];
        await page.exposeFunction('recordPairingEvent', detail => events.push(detail));
        await page.addInitScript(() => document.addEventListener('ic-hide', e => {
            if(e.target.id === 'agent-pairing-dialog') window.recordPairingEvent({reason:e.detail?.reason,open:e.target.open});
        }));
        await page.goto(base + '/static/index.html');
        await page.waitForTimeout(4000);
        console.log('Untouched pairing:', JSON.stringify({writes,events}));
        assert.deepEqual(writes, [], 'Opening a pairing must never submit a rejection');
        await page.locator('#agent-pairing-dialog [data-decision="yes"]').waitFor({timeout:5000});
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        assert.deepEqual(writes, [{approve:false}], 'Explicit dismissal rejects once');
        await page.evaluate(() => window.openAgentAccess());
        pending = true;
        await page.locator('[data-action="review-pairing"]').waitFor({timeout:6000});
        assert.equal(writes.length, 1);
        pending = false;
        await page.locator('[data-action="review-pairing"]').waitFor({state:'detached',timeout:6000});
        pending = true;
        await page.locator('[data-action="review-pairing"]').waitFor({timeout:6000});
        for (const lang of ['en','zh']) {
            await page.evaluate(lang => window.StudioI18n.set(lang), lang);
            assert.equal(await page.locator('[data-action="review-pairing"]').textContent(), lang==='en'?'Review request':'查看请求');
        }
        await page.screenshot({path:'/tmp/agent-pairing-notice.png'});
        await page.locator('[data-action="review-pairing"]').focus();
        await page.keyboard.press('Enter');
        await page.locator('#agent-pairing-dialog [data-decision="yes"]').waitFor({timeout:6000});
        assert.equal(await page.locator('ic-dialog[open]').count(),1);
        assert.equal(writes.length,1,'Reviewing must not approve or deny');
        console.log('PASS: first pairing, explicit dismissal, blocked notice, language switch and review');
    } finally { if(browser) await browser.close(); child.kill(); }
})().catch(e => {console.error(e);process.exitCode=1;});
