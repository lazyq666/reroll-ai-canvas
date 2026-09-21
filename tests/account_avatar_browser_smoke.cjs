const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.ACCOUNT_AVATAR_PREVIEW_PORT || 8813);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, ORIGIN).pathname;
  if (requestPath === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><span id="first"></span><span id="second"></span><script src="/static/js/account-avatar.js"></script>');
    return;
  }
  if (requestPath === '/static/images/avatars/cat.png') {
    response.writeHead(404).end();
    return;
  }
  const file = path.resolve(ROOT, `.${decodeURIComponent(requestPath)}`);
  if (!file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return response.writeHead(404).end();
    const type = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

(async () => {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.InfiniteCanvasAccountAvatar.ready);

    await page.evaluate(() => {
      const avatar = window.InfiniteCanvasAccountAvatar;
      avatar.apply(document.getElementById('first'), { id: 'account-a', avatar_asset: 'bear.png' });
      avatar.apply(document.getElementById('second'), { id: 'account-a', avatar_asset: 'bear.png' });
    });
    await page.waitForFunction(() => document.querySelectorAll('img[src$="/bear.png"]').length === 2);

    await page.evaluate(() => window.InfiniteCanvasAccountAvatar.publish({ id: 'account-a', avatar_asset: 'fox.png' }));
    await page.waitForFunction(() => document.querySelectorAll('img[src$="/fox.png"]').length === 2);

    await page.evaluate(() => window.InfiniteCanvasAccountAvatar.apply(
      document.getElementById('first'),
      { id: 'account-a', display_name: 'Should never become text', avatar_asset: '../secret.png' },
    ));
    assert.equal(await page.locator('#first').textContent(), '');
    assert.equal(await page.locator('#first > ic-icon[name="account"]').count(), 1);

    await page.evaluate(() => window.InfiniteCanvasAccountAvatar.apply(
      document.getElementById('first'),
      { id: 'account-a', avatar_asset: 'cat.png' },
    ));
    await page.waitForFunction(() => document.querySelector('#first > ic-icon[name="account"]'));
    assert.equal(await page.locator('#first').textContent(), '');
    assert.deepEqual(errors, []);
    process.stdout.write('Account Avatar browser smoke passed\n');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
