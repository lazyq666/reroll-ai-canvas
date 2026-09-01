const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      const type = {
        '.css': 'text/css',
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function inspectFrame(frame) {
  return frame.locator('body').evaluate(() => {
    const vertical = document.querySelector('[data-scrollbar-vertical]');
    const horizontal = document.querySelector('[data-scrollbar-horizontal]');
    const hidden = document.querySelector('[data-scrollbar-hidden]');
    const shadowHost = document.querySelector('[data-scrollbar-shadow-host]');
    const shadow = shadowHost.shadowRoot.querySelector('[data-shadow-scroll]');
    return {
      status: document.documentElement.dataset.scrollbarCaseStatus,
      theme: document.documentElement.dataset.uiTheme,
      verticalWidth: getComputedStyle(vertical, '::-webkit-scrollbar').width,
      horizontalHeight: getComputedStyle(horizontal, '::-webkit-scrollbar').height,
      shadowWidth: getComputedStyle(shadow, '::-webkit-scrollbar').width,
      hiddenDisplay: getComputedStyle(hidden, '::-webkit-scrollbar').display,
      thumbColor: getComputedStyle(vertical, '::-webkit-scrollbar-thumb').backgroundColor,
      allScrollable: vertical.scrollHeight > vertical.clientHeight
        && horizontal.scrollWidth > horizontal.clientWidth
        && shadow.scrollHeight > shadow.clientHeight
        && hidden.scrollHeight > hidden.clientHeight,
      shadowFoundationInstalled: shadowHost.shadowRoot.adoptedStyleSheets.length > 0
        || Boolean(shadowHost.shadowRoot.querySelector('[data-ic-scrollbar-foundation]')),
    };
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${baseUrl}/static/ui-component-library.html#scrollbar`);
    const preview = page.locator('iframe[data-scrollbar-matrix]');
    await assert.doesNotReject(() => preview.waitFor({ state: 'visible' }));
    const frame = page.frameLocator('iframe[data-scrollbar-matrix]');
    await frame.locator('html[data-scrollbar-case-status="ready"]').waitFor();

    const light = await inspectFrame(frame);
    assert.equal(await page.locator('[data-target-review-title]').innerText(), '滚动条');
    assert.equal(await page.locator('ic-nav-item[data-target-review="scrollbar"]').getAttribute('current'), 'page');
    assert.deepEqual(
      {
        status: light.status,
        theme: light.theme,
        verticalWidth: light.verticalWidth,
        horizontalHeight: light.horizontalHeight,
        shadowWidth: light.shadowWidth,
        hiddenDisplay: light.hiddenDisplay,
        allScrollable: light.allScrollable,
        shadowFoundationInstalled: light.shadowFoundationInstalled,
      },
      {
        status: 'ready',
        theme: 'light',
        verticalWidth: '4px',
        horizontalHeight: '4px',
        shadowWidth: '4px',
        hiddenDisplay: 'none',
        allScrollable: true,
        shadowFoundationInstalled: true,
      },
    );

    await frame.getByRole('button', { name: '滚动到末尾' }).first().click();
    await page.waitForTimeout(500);
    assert.equal(await frame.locator('[data-scrollbar-vertical]').evaluate(element => element.scrollTop > 0), true);

    await page.getByRole('button', { name: '切换深色' }).click();
    const dark = await inspectFrame(frame);
    assert.equal(dark.theme, 'dark');
    assert.notEqual(dark.thumbColor, light.thumbColor);

    await page.getByRole('button', { name: '搜索组件' }).click();
    await page.getByPlaceholder('搜索组件名称').fill('ic-scrollbar');
    assert.match(await page.locator('[data-target-component-search-results]').innerText(), /ic-scrollbar[\s\S]*滚动条/);

    console.log(JSON.stringify({ passed: true, light, dark }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
