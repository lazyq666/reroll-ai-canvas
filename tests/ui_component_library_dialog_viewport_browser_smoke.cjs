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
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      response.writeHead(200, { 'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(body);
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
  const report = { checks:{}, observations:{} };
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/ui-component-library.html#dialog`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.body.dataset.activeReview === 'dialog');
    const frame = page.frames().find(item => item.url().includes('/infinite-canvas-ui/dialog-case.html'));
    if (!frame) throw new Error('Dialog review frame did not load');
    await frame.waitForFunction(() => document.documentElement.dataset.dialogCaseStatus === 'ready');

    const viewport = page.viewportSize();
    const scrollBefore = await page.evaluate(() => scrollY);
    const dialogs = await frame.evaluate(async () => {
      const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const frameRect = window.frameElement.getBoundingClientRect();
      const results = [];
      for (const launcher of document.querySelectorAll('[data-open]')) {
        const host = document.querySelector(`#${launcher.dataset.open}`);
        await host.show();
        await paint();
        const rect = host.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect();
        results.push({
          id:host.id,
          top:frameRect.top + rect.top,
          bottom:frameRect.top + rect.bottom,
          center:frameRect.top + rect.top + rect.height / 2,
          width:rect.width,
          height:rect.height,
          frameHeight:frameRect.height,
        });
        await host.hide('test');
      }
      return results;
    });
    const scrollAfterDialogs = await page.evaluate(() => scrollY);
    const xLarge = dialogs.filter(dialog => dialog.id.startsWith('x-large'));
    const small = dialogs.filter(dialog => ['small-task', 'small-light', 'neutral-confirm', 'danger-confirm'].includes(dialog.id));
    const compact = dialogs.filter(dialog => ['compact-shortcuts', 'compact-import'].includes(dialog.id));
    const compactLightDetails = await frame.evaluate(() => {
      const dialog = document.querySelector('#compact-shortcuts');
      const list = dialog.querySelector('.compact-modal-list');
      return {
        nestedComponentTags:dialog.querySelectorAll('.ic-component-name-tag').length,
        listPaddingBlockEnd:getComputedStyle(list).paddingBlockEnd,
      };
    });

    report.observations = { viewport, scrollBefore, scrollAfterDialogs, dialogs, compactLightDetails };
    report.checks.allExamplesCovered = dialogs.length === 13;
    report.checks.noPageJump = Math.abs(scrollAfterDialogs - scrollBefore) <= 1;
    report.checks.allInsideViewport = dialogs.every(dialog => dialog.top >= 0 && dialog.bottom <= viewport.height);
    report.checks.allViewportCentered = dialogs.every(dialog => Math.abs(dialog.center - viewport.height / 2) <= 80);
    report.checks.smallUses28Rem = small.length === 4 && small.every(dialog => Math.abs(dialog.width - 448) <= 2);
    report.checks.compactUses32Rem = compact.length === 2 && compact.every(dialog => Math.abs(dialog.width - 512) <= 2);
    report.checks.compactLightHidesNestedName = compactLightDetails.nestedComponentTags === 0;
    report.checks.compactLightKeepsBottomSpace = compactLightDetails.listPaddingBlockEnd === '8px';
    report.checks.xLargeUsesViewportHeight = xLarge.length === 2 && xLarge.every(dialog => dialog.height <= viewport.height - 32);
  } finally {
    await browser.close();
    server.close();
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
