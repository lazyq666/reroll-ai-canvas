const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CANVAS_ID = 'issue-109-prompt-trigger-boundary';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
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
        '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
        '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2',
      }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/config') {
    return { api_providers: [], available_models: {}, comfy_instances: [] };
  }
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname === '/api/auth/me') {
    return { user: { id: 'issue-109-reviewer', username: 'reviewer', role: 'admin' } };
  }
  if (pathname === '/api/workspace-assets') return { items: [], next_cursor: '' };
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === `/api/canvases/${CANVAS_ID}`) {
    return {
      canvas: {
        id:CANVAS_ID,
        title:'Issue #109 trigger boundary',
        project:'default',
        revision:1,
        nodes:[],
        connections:[],
        settings:{},
        logs:[],
      },
    };
  }
  return {};
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless:true, executablePath:browserExecutable });
  try {
    const page = await browser.newPage({ viewport:{ width:1200, height:800 } });
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      class PreviewWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
          this.readyState = PreviewWebSocket.CONNECTING;
          setTimeout(() => {
            this.readyState = PreviewWebSocket.OPEN;
            this.onopen?.({});
          }, 0);
        }

        send() {}
        close(code = 1000) {
          this.readyState = PreviewWebSocket.CLOSED;
          this.onclose?.({ code });
        }
      }
      window.WebSocket = PreviewWebSocket;
    });
    await page.route('**/api/**', route => route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify(apiPayload(route.request().url())),
    }));
    await page.goto(
      `http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=${CANVAS_ID}`,
      { waitUntil:'domcontentloaded', timeout:15000 },
    );
    await page.waitForFunction(() => (
      canvas?.id === 'issue-109-prompt-trigger-boundary'
      && customElements.get('ic-prompt-composer')
      && customElements.get('ic-mention-picker')
      && typeof maybeOpenMentionPicker === 'function'
    ), null, { timeout:15000 });
    await page.evaluate(() => {
      promptLibraries = [{
        id:'issue-109-library',
        name:'回归提示词库',
        categories:[{ id:'general', name:'通用' }],
        items:[{
          id:'issue-109-template',
          name:'回归提示词',
          category:'general',
          positive:'用于验证斜杠快捷选择器',
        }],
      }];
      activePromptLibraryId = 'issue-109-library';
      builtinPromptTemplates = promptLibraries[0].items;
      composer.classList.add('open');
    });

    const prompt = page.locator('#promptInput');
    const resetPrompt = async () => {
      await prompt.evaluate(editor => {
        editor.innerHTML = '';
        editor.dispatchEvent(new InputEvent('input', {
          bubbles:true,
          inputType:'deleteContentBackward',
        }));
      });
      await prompt.click();
    };
    const states = [];
    for (const trigger of ['@', '/']) {
      await resetPrompt();
      await prompt.type(trigger);
      await page.waitForFunction(() => document.querySelector('#mentionPicker')?.hasAttribute('open'));
      await prompt.type(' ');
      await page.waitForFunction(() => !document.querySelector('#mentionPicker')?.hasAttribute('open'));
      states.push(await page.evaluate(symbol => ({
        sequence:`${symbol} `,
        open:document.querySelector('#mentionPicker')?.hasAttribute('open') || false,
        text:document.querySelector('#promptInput')?.textContent || '',
      }), trigger));
      await prompt.type(trigger);
      await page.waitForFunction(() => document.querySelector('#mentionPicker')?.hasAttribute('open'));
      states.push(await page.evaluate(symbol => ({
        sequence:`${symbol} ${symbol}`,
        open:document.querySelector('#mentionPicker')?.hasAttribute('open') || false,
        query:promptQuickQuery,
        rawQuery:promptQuickQueryRaw,
        text:document.querySelector('#promptInput')?.textContent || '',
      }), trigger));
    }
    assert.deepEqual(states, [
      {sequence:'@ ', open:false, text:'@ '},
      {sequence:'@ @', open:true, query:'', rawQuery:'', text:'@ @'},
      {sequence:'/ ', open:false, text:'/ '},
      {sequence:'/ /', open:true, query:'', rawQuery:'', text:'/ /'},
    ]);
    console.log(JSON.stringify({ states }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
