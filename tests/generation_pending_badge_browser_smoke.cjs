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
        '.css':'text/css',
        '.html':'text/html',
        '.js':'text/javascript',
      }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type':`${type}; charset=utf-8` }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless:true, executablePath:CHROME });
  try {
    const page = await browser.newPage({ viewport:{ width:1200, height:800 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/design-system/infinite-canvas-ui/feedback-progress-case.html?theme=light&locale=zh-CN`, {
      waitUntil:'domcontentloaded',
    });
    await page.waitForFunction(() => document.documentElement.dataset.feedbackProgressCaseStatus === 'ready');
    const report = await page.evaluate(async () => {
      const elements = [
        document.querySelector('#generation-pending-image'),
        document.querySelector('#generation-pending-video'),
        document.querySelector('#generation-pending-text'),
      ];
      elements.forEach((element, index) => element.setAttribute('elapsed', `${index + 6}s`));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const continuity = elements.map(element => {
        const badge = element.shadowRoot.querySelector('ic-badge.generation-pending-badge');
        const spinner = badge?.shadowRoot?.querySelector('.spinner');
        element.setAttribute('elapsed', '12s');
        return {
          badge:badge === element.shadowRoot.querySelector('ic-badge.generation-pending-badge'),
          spinner:spinner === badge?.shadowRoot?.querySelector('.spinner'),
        };
      });
      elements.forEach((element, index) => element.setAttribute('elapsed', `${index + 6}s`));
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {
        continuity,
        items:elements.map(element => {
          const badge = element.shadowRoot.querySelector('ic-badge.generation-pending-badge');
          const surface = element.shadowRoot.querySelector('.pending');
          const badgeRect = badge?.getBoundingClientRect();
          const surfaceRect = surface?.getBoundingClientRect();
          return {
            kind:element.getAttribute('kind'),
            text:badge?.textContent.trim() || '',
            ready:badge?.dataset.icContractStatus === 'ready',
            loading:badge?.hasAttribute('loading') === true,
            spinner:Boolean(badge?.shadowRoot?.querySelector('.spinner')),
            outside:Boolean(badgeRect && surfaceRect && badgeRect.bottom <= surfaceRect.top + 1),
            legacyStatusAbsent:!element.shadowRoot.querySelector('.status'),
          };
        }),
      };
    });
    assert.deepEqual(report.continuity, [
      { badge:true, spinner:true },
      { badge:true, spinner:true },
      { badge:true, spinner:true },
    ]);
    assert.deepEqual(report.items.map(item => item.kind), ['image', 'video', 'text']);
    assert.deepEqual(report.items.map(item => item.text), [
      '6s 正在生成 4 张图片',
      '7s 视频等待生成',
      '8s 正在生成文本',
    ]);
    assert.equal(report.items.every(item => item.ready && item.loading && item.spinner), true);
    assert.equal(report.items.every(item => item.outside && item.legacyStatusAbsent), true);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
