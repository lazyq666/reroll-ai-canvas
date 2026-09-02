const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml',
};
const CANVAS_ID = 'prompt-generation-failure-details';
const TASK_ID = 'text-generation-run-failed';
const ERROR_TEXT = 'Text provider rejected the prompt with HTTP 502';
const PROMPT_TEXT = '把参考素材整理为可直接生成的电影感提示词';

function json(response, payload, status=200){
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
  response.end(JSON.stringify(payload));
}

function testSource(requestPath, source){
  if(requestPath.endsWith('/canvas-persistence.js')){
    return source
      .replace(
        /schedule\(\{delay=450\}=\{\}\)\{\s*return canvasPersistenceSchedule\(delay\);\s*\}/,
        'schedule(){ return null; }',
      )
      .replace(
        /save\(\)\{\s*return canvasPersistenceSave\(\);\s*\}/,
        'save(){ return Promise.resolve(true); }',
      )
      .replace(
        /synced\(\{timeout=5000\}=\{\}\)\{\s*return canvasPersistenceSynced\(timeout\);\s*\}/,
        'synced(){ return Promise.resolve(true); }',
      );
  }
  if(requestPath.endsWith('/generation-recovery.js')){
    return source.replace('setTimeout(resolve, 2000)', 'setTimeout(resolve, 0)');
  }
  return source;
}

function startServer(){
  return new Promise((resolve, reject) => {
    let generationLogReads = 0;
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const requestPath = decodeURIComponent(requestUrl.pathname);
      if(request.method === 'POST' && requestPath === '/api/canvas-llm-tasks'){
        json(response, {task_id:TASK_ID, status:'queued', actor_id:'browser-test-user'});
        return;
      }
      if(request.method === 'GET' && requestPath === `/api/canvas-llm-tasks/${TASK_ID}`){
        json(response, {
          id:TASK_ID,
          status:'failed',
          error:ERROR_TEXT,
          status_code:502,
          provider_id:'openai',
          created_at:1,
          updated_at:2,
          diagnostics:{provider_id:'openai', http_status:502},
        });
        return;
      }
      if(request.method === 'GET' && requestPath === `/api/canvases/${CANVAS_ID}/logs`){
        generationLogReads += 1;
        if(generationLogReads === 1){
          json(response, {logs:[], next_cursor:''});
          return;
        }
        json(response, {logs:[{
          id:'persisted-text-failure-log',
          runId:TASK_ID,
          nodeId:'prompt-output-node',
          status:'failed',
          createdAt:4102444800000,
          durationMs:1000,
          platform:'openai',
          model:'gpt-4o-mini',
          prompt:PROMPT_TEXT,
          request:{provider:'openai', model:'gpt-4o-mini'},
          refs:[],
          outputs:[],
          tasks:[{status:'failed', technicalError:ERROR_TEXT}],
          error:ERROR_TEXT,
        }], next_cursor:''});
        return;
      }
      if(request.method === 'POST' && requestPath === `/api/canvases/${CANVAS_ID}/logs`){
        server.generationLogWrites = Number(server.generationLogWrites || 0) + 1;
        json(response, {log_id:'client-text-failure-log'});
        return;
      }
      if(request.method === 'GET' && requestPath === '/api/auth/me'){
        json(response, {user:{id:'browser-test-user'}});
        return;
      }
      const filePath = path.resolve(ROOT, `.${requestPath}`);
      if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)){
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(filePath, (error, body) => {
        if(error){
          response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
          return;
        }
        let responseBody = body;
        if(path.extname(filePath) === '.js'){
          responseBody = Buffer.from(testSource(requestPath, body.toString('utf8')));
        }
        response.writeHead(200, {
          'Content-Type':MIME[path.extname(filePath)] || 'application/octet-stream',
        }).end(responseBody);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  if(!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  const context = await browser.newContext({viewport:{width:1180,height:760}});
  const page = await context.newPage();
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/smart-canvas.html?id=${CANVAS_ID}`, {
      waitUntil:'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(
      window.SmartCanvasModules?.generationRecovery
      && typeof runPromptLLMNode === 'function'
      && customElements.get('ic-alert')
    ));
    await page.evaluate(({canvasId, promptText}) => {
      const promptNode = {
        id:'prompt-source-node',
        type:'smart-prompt',
        title:'提示词生成',
        x:300,
        y:220,
        w:360,
        h:260,
        llmEnabled:true,
        llmInstruction:promptText,
        llmProvider:'openai',
        llmModel:'gpt-4o-mini',
      };
      canvas = {
        id:canvasId,
        title:'Prompt generation failure details',
        nodes:[promptNode],
        connections:[],
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      };
      nodes = canvas.nodes;
      selectedId = promptNode.id;
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      smartCanvasLogsHydrated = false;
      render();
      document.documentElement.classList.remove('smart-canvas-booting');
      document.documentElement.dataset.canvasOpeningPhase = 'ready';
    }, {canvasId:CANVAS_ID, promptText:PROMPT_TEXT});

    await page.evaluate(() => runPromptLLMNode('prompt-source-node'));
    await page.waitForFunction(() => document.querySelector(
      '[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"]',
    ));
    const alertState = await page.evaluate(() => ({
      heading:document.querySelector('[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"]')?.getAttribute('heading') || '',
      message:document.querySelector('[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"]')?.textContent || '',
      localLog:canvas.logs?.[0] || null,
    }));
    assert.match(alertState.heading, /失败/);
    assert.match(alertState.message, /HTTP 502/);
    assert.equal(alertState.localLog?.generationRunId, TASK_ID);
    assert.equal(alertState.localLog?.prompt, PROMPT_TEXT);
    assert.equal(alertState.localLog?.request?.model, 'gpt-4o-mini');

    const realtimeApplied = await page.evaluate(() => {
      canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument({
        title:canvas.title,
        icon:canvas.icon,
        nodes:JSON.parse(JSON.stringify(canvas.nodes)),
        connections:JSON.parse(JSON.stringify(canvas.connections)),
        settings:JSON.parse(JSON.stringify(canvas.settings)),
        logs:[],
      });
      canvasPersistenceRevision = 0;
      canvasPersistenceInFlight = null;
      canvasPersistencePendingSave = false;
      canvasPersistenceQueuedMessages.length = 0;
      return window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        canvas_id:canvas.id,
        operation_id:'remote:text-failure-settled',
        revision:1,
        changes:{
          node_creates:[],node_updates:[],node_unsets:[],node_deletes:[],
          connection_adds:[],connection_removes:[],
          canvas_updates:[],canvas_unsets:[],
        },
      });
    });
    assert.equal(realtimeApplied, true);

    await page.waitForFunction(() => document.querySelector(
      '[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"][data-ic-stack-state="active"]',
    ));
    await page.waitForFunction(() => {
      const control = document.querySelector(
        '[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"]',
      );
      const rect = control?.shadowRoot?.querySelector('.action')?.getBoundingClientRect();
      return Boolean(rect?.width && rect?.height && rect.top >= 0);
    }, null, {timeout:3000});
    const actionRect = await page.locator(
      '[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"]',
    ).evaluate(control => {
      const rect = control.shadowRoot.querySelector('.action')?.getBoundingClientRect();
      return rect ? {x:rect.x, y:rect.y, width:rect.width, height:rect.height} : null;
    });
    assert.ok(actionRect?.width > 0 && actionRect?.height > 0);
    await page.mouse.click(
      actionRect.x + actionRect.width / 2,
      actionRect.y + actionRect.height / 2,
    );
    await page.waitForFunction(
      () => document.querySelector('#smartLogModal')?.hasAttribute('open'),
      null,
      {timeout:1500},
    );
    const immediateLogState = await page.locator('#smartLogList').evaluate(list => ({
      count:list.querySelectorAll('.generation-log-index-item').length,
      empty:list.querySelector('.generation-log-empty')?.textContent || '',
    }));
    assert.equal(immediateLogState.count, 1);
    assert.equal(immediateLogState.empty, '');
    await page.waitForFunction(taskId => document.querySelector(
      `#smartLogList [data-generation-run-id="${CSS.escape(taskId)}"]`,
    )?.classList.contains('is-focused-target'), TASK_ID);
    const detail = await page.locator('#smartLogList [data-generation-log-selected-detail]').evaluate(item => ({
      runId:item.dataset.generationRunId || '',
      prompt:item.querySelector('.generation-log-prompt')?.textContent || '',
      model:[...item.querySelectorAll('.generation-log-detail-facts span')].map(span => span.textContent),
      technicalError:item.querySelector('.generation-log-technical pre')?.textContent || '',
    }));
    assert.equal(detail.runId, TASK_ID);
    assert.equal(detail.prompt, PROMPT_TEXT);
    assert.ok(detail.model.some(value => /gpt-4o-mini/.test(value)));
    assert.match(detail.technicalError, /HTTP 502/);
    assert.equal(server.generationLogWrites, 1);
    await page.locator('ic-alert.generation-failure-alert[data-ic-stack-index="0"]').evaluate(control => {
      control.shadowRoot.querySelector('.dismiss').click();
    });
    await page.waitForFunction(() => document.querySelectorAll(
      'ic-alert.generation-failure-alert',
    ).length === 0);

    const queuedFailureState = await page.evaluate(() => {
      toast('Shared provider failure', {
        persistent:true,
        detailRunId:'same-reason-run-a',
        heading:'Generation failed',
      });
      toast('Shared provider failure', {
        persistent:true,
        detailRunId:'same-reason-run-b',
        heading:'Generation failed',
      });
      const alerts = [...document.querySelectorAll('ic-alert.generation-failure-alert:not([hidden])')];
      return {
        count:alerts.length,
        messages:alerts.map(alert => alert.textContent.trim()),
        queueLength:alerts[0]?.closest('[data-generation-failure-queue]')?.dataset.queueLength || '',
      };
    });
    assert.equal(queuedFailureState.count, 2);
    assert.deepEqual(queuedFailureState.messages, ['Shared provider failure', 'Shared provider failure']);
    assert.equal(queuedFailureState.queueLength, '2');

    await page.locator('ic-alert.generation-failure-alert[data-ic-stack-index="0"]').evaluate(control => {
      control.shadowRoot.querySelector('.dismiss').click();
    });
    await page.waitForFunction(() => document.querySelectorAll(
      'ic-alert.generation-failure-alert:not([hidden])',
    ).length === 1);
    const promotedFailure = await page.locator(
      'ic-alert.generation-failure-alert[data-ic-stack-index="0"]',
    ).evaluate(control => ({
      message:control.textContent.trim(),
      queueLength:control.closest('[data-generation-failure-queue]')?.dataset.queueLength || '',
    }));
    assert.equal(promotedFailure.message, 'Shared provider failure');
    assert.equal(promotedFailure.queueLength, '1');
    process.stdout.write('Prompt generation failure details browser smoke passed.\n');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
