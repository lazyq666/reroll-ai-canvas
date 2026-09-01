const assert = require('node:assert/strict');
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
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, {
        'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      }).end(body);
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
  const browser = await chromium.launch({headless:true,executablePath:CHROME});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/ui-component-library.html#nodes`, {waitUntil:'networkidle'});
    await page.waitForFunction(() => document.body.dataset.activeReview === 'nodes');
    await page.locator('iframe[data-nodes-matrix]').waitFor({state:'visible'});
    const frame = page.frames().find(item => item.url().includes('componentReview=nodes'));
    if (!frame) throw new Error('Nodes preview frame did not load');
    await frame.waitForFunction(() => document.documentElement.dataset.nodesStatus === 'ready');

    const layout = await frame.evaluate(() => {
      const node = document.querySelector(
        'ic-canvas-node[data-id="review-prompt-generation-upstream-image"]'
      );
      const instruction = node?.querySelector('.prompt-llm-instruction');
      const measure = () => {
        const viewport = node?.querySelector('.prompt-node-input-thumbs');
        const thumb = viewport?.querySelector('ic-reference-thumbnail');
        return {
          viewportHeight:viewport?.getBoundingClientRect().height || 0,
          thumbHeight:thumb?.getBoundingClientRect().height || 0,
          viewportFlexShrink:viewport ? getComputedStyle(viewport).flexShrink : '',
          viewportOverflow:viewport ? getComputedStyle(viewport).overflow : '',
          instructionFlex:instruction ? getComputedStyle(instruction).flex : '',
          instructionMinHeight:instruction ? getComputedStyle(instruction).minHeight : '',
          instructionClientHeight:instruction?.clientHeight || 0,
          instructionScrollHeight:instruction?.scrollHeight || 0,
        };
      };
      const before = measure();
      if (instruction) {
        instruction.textContent = '根据全部上游输入生成结构化中文提示词，准确整理主体、构图、空间层级、动作、视线、道具、环境元素、前后遮挡与关键接触关系。'.repeat(12);
      }
      return {before,after:measure()};
    });

    assert.ok(layout.before.viewportHeight >= layout.before.thumbHeight - .5, JSON.stringify(layout));
    assert.ok(
      layout.after.instructionScrollHeight > layout.after.instructionClientHeight,
      JSON.stringify(layout)
    );
    assert.equal(layout.after.viewportFlexShrink, '0', JSON.stringify(layout));
    assert.ok(layout.after.viewportHeight >= layout.after.thumbHeight - .5, JSON.stringify(layout));
    console.log(JSON.stringify(layout));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
