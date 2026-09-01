const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.WORKSPACE_MOVE_SCREENSHOT || '';
const pageHtml = execFileSync(
  path.join(ROOT, '.venv/bin/python'),
  ['-c', 'from backend.infinite_canvas.app import _workspace_move_page; print(_workspace_move_page())'],
  { cwd: ROOT, encoding: 'utf8' },
);
const moveState = {
  stage: 'copying',
  file_count: 12,
  copied_files: 5,
  total_bytes: 1000,
  copied_bytes: 420,
  finished: false,
  return_url: '/studio',
};

function contentType(filePath) {
  if(filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if(filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if(filePath.endsWith('.svg')) return 'image/svg+xml';
  if(filePath.endsWith('.png')) return 'image/png';
  if(filePath.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if(requestUrl.pathname === '/workspace-move') {
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(pageHtml);
      return;
    }
    if(requestUrl.pathname === '/api/workspace-move/status') {
      response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(moveState));
      return;
    }
    const filePath = path.resolve(ROOT, `.${requestUrl.pathname}`);
    if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if(error) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {'Content-Type':contentType(filePath)}).end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  try {
    const context = await browser.newContext({viewport:{width:1200, height:800}});
    await context.addInitScript(() => {
      class LocalMoveSocket {
        addEventListener() {}
        close() {}
      }
      window.WebSocket = LocalMoveSocket;
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', message => { if(message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/workspace-move?operation_id=issue-181`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => (
      customElements.get('ic-progress')
      && document.getElementById('move-progress')?.getAttribute('value') === '42'
    ));

    const desktop = await page.evaluate(() => {
      const card = document.querySelector('.workspace-move-card').getBoundingClientRect();
      const progress = document.getElementById('move-progress');
      return {
        theme:document.documentElement.dataset.uiTheme,
        cardWidth:Math.round(card.width),
        overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,
        nativeControls:document.querySelectorAll('progress, button, a#enter-product').length,
        progress:{
          value:progress.getAttribute('value'),
          valueText:progress.getAttribute('value-text'),
          contract:progress.dataset.icContractStatus,
        },
        badgeContract:document.getElementById('move-stage').dataset.icContractStatus,
        badgeText:document.getElementById('move-stage').textContent.trim(),
        message:document.getElementById('move-message').textContent.trim(),
        files:document.getElementById('move-files').textContent.trim(),
        size:document.getElementById('move-size').textContent.trim(),
      };
    });
    if(screenshotPath) await page.screenshot({path:screenshotPath.replace(/\.png$/i, '-light.png')});

    await page.setViewportSize({width:375, height:760});
    await page.evaluate(() => localStorage.setItem('studio_theme', 'dark'));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => (
      document.documentElement.dataset.uiTheme === 'dark'
      && document.getElementById('move-progress')?.getAttribute('value') === '42'
    ));
    const narrow = await page.evaluate(() => ({
      theme:document.documentElement.dataset.uiTheme,
      overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,
      cardWidth:Math.round(document.querySelector('.workspace-move-card').getBoundingClientRect().width),
      viewportWidth:document.documentElement.clientWidth,
      countColumns:getComputedStyle(document.querySelector('.workspace-move-counts')).gridTemplateColumns.split(' ').length,
    }));
    if(screenshotPath) await page.screenshot({path:screenshotPath.replace(/\.png$/i, '-dark-narrow.png')});

    assert.deepEqual(desktop.progress, {value:'42', valueText:'42%', contract:'ready'});
    assert.equal(desktop.theme, 'light');
    assert.equal(desktop.cardWidth <= 608, true);
    assert.equal(desktop.overflow, false);
    assert.equal(desktop.nativeControls, 0);
    assert.equal(desktop.badgeContract, 'ready');
    assert.match(desktop.badgeText, /搬家中|Moving/);
    assert.match(desktop.message, /复制|Copying/);
    assert.match(desktop.files, /5 \/ 12/);
    assert.match(desktop.size, /420 B \/ 1000 B/);
    assert.deepEqual(narrow, {
      theme:'dark',
      overflow:false,
      cardWidth:narrow.cardWidth,
      viewportWidth:375,
      countColumns:1,
    });
    assert.equal(narrow.cardWidth <= narrow.viewportWidth, true);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    process.stdout.write(`${JSON.stringify({desktop, narrow}, null, 2)}\n`);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
