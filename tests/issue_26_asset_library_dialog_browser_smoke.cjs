const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROJECT_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const PYTHON = process.env.SMART_CANVAS_PYTHON
  || (fs.existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : 'python3');

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('manual server did not start')), 10000);
    child.once('exit', code => reject(new Error(`manual server exited with ${code}`)));
    child.stdout.on('data', chunk => {
      if (!String(chunk).includes('Smart Canvas manual server:')) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

(async () => {
  const port = await freePort();
  const server = spawn(PYTHON, ['tests/smart_canvas_manual_server.py'], {
    cwd:ROOT,
    env:{...process.env, SMART_CANVAS_PORT:String(port)},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    page.setDefaultTimeout(15000);
    let releaseRequest = null;
    let requestCount = 0;
    const assetPayload = {
      items:[{
        id:'issue-26-asset',
        media_id:'a'.repeat(64),
        name:'晨雾森林',
        url:'/static/images/brand/logo.png',
        kind:'image',
        can_manage:false,
      }],
      folders:[],
      all_count:1,
      next_cursor:'',
      at_capacity:false,
    };
    await page.route('**/api/workspace-assets?**', route => {
      requestCount += 1;
      releaseRequest?.(route);
      releaseRequest = null;
    });
    await page.goto(
      `http://127.0.0.1:${port}/static/smart-canvas.html?id=issue-26-asset-library&manual=1`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      customElements.get('ic-dialog')
      && customElements.get('ic-workspace-asset-library')
      && typeof openWorkspaceAssetLibrary === 'function'
      && typeof closeWorkspaceAssetLibrary === 'function'
    ));

    async function openWithDeferredRefresh() {
      const previousRequestCount = requestCount;
      const request = new Promise(resolve => { releaseRequest = resolve; });
      await page.locator('#workspaceAssetDockToggle').click({clickCount:3,delay:10});
      const route = await request;
      await page.waitForTimeout(80);
      assert.equal(requestCount, previousRequestCount + 1, 'Repeated activation during refresh must reuse the opening');
      const dialogOpen = await page.locator('#workspaceAssetDialog').evaluate(dialog => dialog.open);
      assert.equal(dialogOpen, false, 'The asset library Dialog must stay hidden until its refresh is ready');

      await route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify(assetPayload),
      });
      await page.waitForFunction(() => (
        document.querySelector('#workspaceAssetDialog').open
        && document.querySelector('#workspaceAssetPanel').shadowRoot.querySelectorAll('.card').length === 1
      ));
    }

    await openWithDeferredRefresh();
    await page.evaluate(() => closeWorkspaceAssetLibrary());
    await page.waitForFunction(() => !document.querySelector('#workspaceAssetDialog').open);

    await openWithDeferredRefresh();
    assert.equal(requestCount, 2, 'Each opening must perform exactly one refresh');
    process.stdout.write(JSON.stringify({ok:true, requestCount}, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
