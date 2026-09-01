const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME_TYPES = {
  '.css':'text/css',
  '.html':'text/html',
  '.js':'text/javascript',
  '.json':'application/json',
  '.png':'image/png',
  '.svg':'image/svg+xml',
  '.webp':'image/webp',
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
      response.writeHead(200, { 'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function dispatchGesture(frame, selector, from, to, button=0) {
  await frame.locator(selector).evaluate((element, gesture) => {
    const rect = element.getBoundingClientRect();
    const point = value => ({
      x:rect.left + rect.width * value.x,
      y:rect.top + rect.height * value.y,
    });
    const start = point(gesture.from);
    const end = point(gesture.to);
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles:true,
      composed:true,
      cancelable:true,
      button:gesture.button,
      buttons:gesture.button === 0 ? 1 : 2,
      clientX:start.x,
      clientY:start.y,
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles:true,
      composed:true,
      cancelable:true,
      button:gesture.button,
      buttons:gesture.button === 0 ? 1 : 2,
      clientX:end.x,
      clientY:end.y,
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles:true,
      composed:true,
      cancelable:true,
      button:gesture.button,
      buttons:0,
      clientX:end.x,
      clientY:end.y,
    }));
  }, { from, to, button });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({ headless:true, executablePath:CHROME });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:1000 }, deviceScaleFactor:2 });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/ui-component-library.html`, { waitUntil:'networkidle' });
    await page.locator('ic-nav-item[data-target-review="click-spark-reference"]').click();
    const frameElement = page.locator('iframe[data-click-spark-reference]');
    await frameElement.waitFor({ state:'visible' });
    const frame = page.frames().find(item => item.url().includes('click-spark-reference.html'));
    if (!frame) throw new Error('Click spark reference frame did not load');
    await frame.waitForFunction(() => document.documentElement.dataset.clickSparkReferenceStatus === 'ready');

    const light = 'ic-click-spark-reference[aria-label="浅色点击反馈预览"]';
    const dark = 'ic-click-spark-reference[aria-label="深色点击反馈预览"]';
    await dispatchGesture(frame, light, { x:.3, y:.35 }, { x:.3, y:.35 });
    await frame.waitForFunction(selector => document.querySelector(selector)?.dataset.animationState === 'active', light);
    await frame.waitForFunction(selector => document.querySelector(selector)?.dataset.animationState === 'idle', light);

    await dispatchGesture(frame, `${light} [data-drag-token]`, { x:.5, y:.5 }, { x:.82, y:.7 });
    await frame.waitForFunction(selector => document.querySelector(selector)?.dataset.lastGesture === 'drag-release', light);
    await frame.waitForFunction(selector => document.querySelector(selector)?.dataset.animationState === 'idle', light);

    await dispatchGesture(frame, light, { x:.4, y:.4 }, { x:.4, y:.4 }, 2);
    await page.locator('[data-target-theme-toggle]').click();
    await page.emulateMedia({ reducedMotion:'reduce' });
    await dispatchGesture(frame, light, { x:.62, y:.42 }, { x:.62, y:.42 });

    const report = await frame.locator(light).evaluate(element => {
      const canvas = element.shadowRoot.querySelector('canvas');
      const rect = element.getBoundingClientRect();
      return {
        ready:document.documentElement.dataset.clickSparkReferenceStatus,
        triggerCount:Number(element.dataset.triggerCount),
        lastGesture:element.dataset.lastGesture,
        lastMotion:element.dataset.lastMotion,
        animationState:element.dataset.animationState,
        animationActive:element.animationActive,
        pointerEvents:getComputedStyle(canvas).pointerEvents,
        canvasWidth:canvas.width,
        cssWidth:rect.width,
        dpr:Number(canvas.dataset.dpr),
        previewCount:document.querySelectorAll('ic-click-spark-reference').length,
        sparkLineWidth:element.getAttribute('spark-line-width'),
        parameterText:document.querySelector('[data-click-spark-output] code')?.textContent || '',
      };
    });
    report.activeReview = await page.locator('body').getAttribute('data-active-review');
    report.sparkColors = await frame.evaluate(({ light, dark }) => ({
      light:document.querySelector(light)._colors().color,
      dark:document.querySelector(dark)._colors().color,
    }), { light, dark });
    report.title = (await page.locator('[data-target-review-title]').textContent()).trim();
    report.theme = await frame.locator('html').getAttribute('data-ui-theme');
    report.errors = errors;

    if (process.env.IC_BROWSER_SCREENSHOT) await page.screenshot({ path:process.env.IC_BROWSER_SCREENSHOT, fullPage:true });
    if (report.ready !== 'ready' || report.activeReview !== 'click-spark-reference') throw new Error(JSON.stringify(report));
    if (report.title !== '点击反馈实验' || report.previewCount !== 2) throw new Error(JSON.stringify(report));
    if (report.triggerCount !== 3 || report.lastGesture !== 'click' || report.lastMotion !== 'reduced') throw new Error(JSON.stringify(report));
    if (report.animationState !== 'idle' || report.animationActive) throw new Error(JSON.stringify(report));
    if (report.pointerEvents !== 'none' || report.dpr !== 1.5 || report.canvasWidth > report.cssWidth * 1.5 + 1) throw new Error(JSON.stringify(report));
    if (report.sparkLineWidth !== '1.5' || !report.parameterText.includes('lineWidth:1.5px')) throw new Error(JSON.stringify(report));
    if (!report.sparkColors.light.startsWith('rgb') || !report.sparkColors.dark.startsWith('rgb') || report.sparkColors.light === report.sparkColors.dark) throw new Error(JSON.stringify(report));
    if (report.theme !== 'dark' || report.errors.length) throw new Error(JSON.stringify(report));
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
