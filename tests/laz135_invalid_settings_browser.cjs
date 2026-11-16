const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((request, response) => {
        if (request.url === '/') {
            response.writeHead(200, {'Content-Type':'text/html'});
            response.end('<html><body></body></html>');
            return;
        }
        const file = path.resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
        if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
        fs.readFile(file, (error, data) => {
            response.writeHead(error ? 404 : 200, {'Content-Type':'text/javascript'});
            response.end(error ? '' : data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({headless:true, executablePath:process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(async () => {
            const component = await import('/static/js/infinite-canvas-ui/generation-settings-picker.js');
            customElements.define('ic-generation-settings-picker', Object.values(component)[0]);
        });
        for (const locale of ['zh-CN', 'en']) {
            for (const theme of ['light', 'dark']) {
                for (const width of [390, 1440]) {
                    await page.setViewportSize({width, height:900});
                    await page.evaluate(({locale,theme}) => {
                        document.documentElement.lang = locale;
                        document.documentElement.dataset.theme = theme;
                        document.body.innerHTML = '<ic-generation-settings-picker label="Settings" ratio="square" ratio-presets="square,wide" resolution="1k" resolutions="1k,2k" quality="xhigh" qualities="auto,low,medium,high"></ic-generation-settings-picker>';
                    }, {locale,theme});
                    const picker = page.locator('ic-generation-settings-picker');
                    await picker.getByRole('button').filter({hasText:locale === 'en' ? '1:1' : '1:1'}).first().click();
                    assert.equal(await picker.evaluate(element => element.open), true, 'Invalid quality must not prevent opening');
                    await picker.locator('[data-quality="high"]').click();
                    assert.equal(await picker.evaluate(element => element.quality), 'high');
                    assert.equal(await picker.getAttribute('data-ic-contract-status'), 'ready');
                    await picker.evaluate(element => { element.hide(); element.resolution = '4k'; });
                    await picker.locator('[part="trigger"]').press('Enter');
                    assert.equal(await picker.evaluate(element => element.open), true, 'Invalid resolution must remain correctable with keyboard');
                    await picker.locator('[data-resolution="2k"]').click();
                    assert.equal(await picker.getAttribute('data-ic-contract-status'), 'ready');
                    await picker.evaluate(element => { element.hide(); element.setAttribute('disabled', ''); });
                    assert.equal(await picker.locator('[part="trigger"]').isDisabled(), true);
                }
            }
        }
        console.log('PASS: invalid settings remain editable in both languages, themes and viewport sizes');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
