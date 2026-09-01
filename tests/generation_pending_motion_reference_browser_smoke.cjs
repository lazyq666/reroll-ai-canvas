const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({ headless:true, executablePath:CHROME });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/ui-component-library.html`, { waitUntil:'networkidle' });
    await page.locator('ic-nav-item[data-target-review="pending-motion-reference"]').click();
    const frameElement = page.locator('iframe[data-pending-motion-reference]');
    await frameElement.waitFor({ state:'visible' });
    const frame = page.frames().find(item => item.url().includes('generation-pending-motion-reference.html'));
    if (!frame) throw new Error('Pending motion reference frame did not load');
    await frame.waitForFunction(() => document.documentElement.dataset.pendingMotionReferenceStatus === 'ready');

    await frame.locator('ic-slider[data-setting="duration"]').evaluate(control => {
      control.value = 14;
      control.dispatchEvent(new InputEvent('input', { bubbles:true, composed:true }));
    });
    await frame.locator('ic-select[data-setting="count"]').evaluate(control => {
      control.value = '6';
      control.dispatchEvent(new InputEvent('input', { bubbles:true, composed:true }));
    });
    await page.locator('[data-target-theme-toggle]').click();
    await frame.locator('html').evaluate(root => { root.dataset.uiMotion = 'reduced'; });

    const report = {
      activeReview:await page.locator('body').getAttribute('data-active-review'),
      title:(await page.locator('[data-target-review-title]').textContent()).trim(),
      ready:await frame.locator('html').getAttribute('data-pending-motion-reference-status'),
      controls:await frame.locator('[data-setting]').count(),
      nodes:await frame.locator('.pending-motion-node').count(),
      duration:await frame.locator('[data-motion-stage]').evaluate(element => getComputedStyle(element).getPropertyValue('--motion-duration').trim()),
      blur:await frame.locator('[data-motion-stage]').evaluate(element => getComputedStyle(element).getPropertyValue('--motion-blur').trim()),
      drift:await frame.locator('[data-motion-stage]').evaluate(element => getComputedStyle(element).getPropertyValue('--motion-drift').trim()),
      theme:await frame.locator('html').getAttribute('data-ui-theme'),
      reducedAnimation:await frame.locator('.motion-blob').first().evaluate(element => getComputedStyle(element).animationName),
      errors,
    };
    if (process.env.IC_BROWSER_SCREENSHOT) await page.screenshot({ path:process.env.IC_BROWSER_SCREENSHOT, fullPage:true });
    if (report.activeReview !== 'pending-motion-reference') throw new Error(JSON.stringify(report));
    if (report.title !== '动画实验 A' || report.ready !== 'ready') throw new Error(JSON.stringify(report));
    if (report.controls !== 11 || report.nodes !== 6 || report.duration !== '14s') throw new Error(JSON.stringify(report));
    if (report.blur !== '28px' || report.drift !== '28%') throw new Error(JSON.stringify(report));
    if (report.theme !== 'dark' || report.reducedAnimation !== 'none' || report.errors.length) throw new Error(JSON.stringify(report));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
