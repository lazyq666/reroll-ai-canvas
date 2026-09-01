const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UI_STALL_BUDGET_MS = 500;
const NODE_COUNT = 335;
const QUEUED_MUTATION_COUNT = 1080;
const mimeTypes = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml',
};

function startServer(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestPath = decodeURIComponent(
        new URL(request.url, 'http://127.0.0.1').pathname,
      );
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
        response.writeHead(200, {
          'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        }).end(body);
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
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => {
    if(message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(
      `${origin}/static/smart-canvas.html?id=realtime-position-fast-path`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      customElements.get('ic-generation-settings-picker')
    ), null, {timeout:30000});
    const initial = await page.evaluate(nodeCount => {
      const syntheticNodes = Array.from({length:nodeCount}, (_, index) => ({
        id:`node-${index}`,
        type:'smart-image',
        x:(index % 24) * 360,
        y:Math.floor(index / 24) * 280,
        w:320,
        h:220,
        images:[],
        items:[],
        generationOutputNode:true,
        title:`Synthetic Node ${index}`,
        created_at:index,
      }));
      canvas = {
        id:'realtime-position-fast-path',
        title:'Realtime position fast path',
        nodes:syntheticNodes,
        connections:[],
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      };
      nodes = canvas.nodes;
      selectedId = 'node-0';
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument(canvas);
      canvasPersistenceRevision = 0;
      render();
      return {
        hasPublicApplier:Boolean(
          window.SmartCanvasModules?.canvasRealtimeApplier?.apply
        ),
        mountedNodeCount:document.querySelectorAll('.image-node').length,
      };
    }, NODE_COUNT);
    assert.equal(
      initial.hasPublicApplier,
      true,
      'CanvasRealtimeApplier public interface must exist',
    );
    await page.waitForFunction(() => (
      document.querySelector('ic-generation-settings-picker')
        ?.dataset.icContractStatus === 'ready'
    ), null, {timeout:30000});
    const result = await page.evaluate(async queuedMutationCount => {
      const control = document.querySelector(
        '#composer ic-select[data-component-variant="generation-count"]',
      );
      const selectedElement = document.querySelector(
        '.image-node[data-id="node-0"]',
      );
      control.focus();
      const expected = new Map();
      for(let offset = 1; offset <= queuedMutationCount; offset += 1){
        const index = (offset - 1) % 9;
        const node = nodes.find(item => item.id === `node-${index}`);
        const next = {x:Number(node.x || 0) + offset,y:Number(node.y || 0) + offset};
        expected.set(node.id,next);
        const applied = window.SmartCanvasModules.canvasRealtimeApplier.apply({
          type:'canvas_mutation',
          operation_id:`remote:${offset}`,
          revision:offset,
          actor_id:`robot-${index + 1}`,
          changes:{node_updates:[
            {id:node.id,path:['x'],value:next.x},
            {id:node.id,path:['y'],value:next.y},
          ]},
        });
        if(!applied) throw new Error(`Mutation ${offset} was not accepted`);
      }
      const beforeBlur = {
        revision:window.SmartCanvasModules.canvasPersistence.status().revision,
        selectedX:nodes.find(node => node.id === 'node-0')?.x,
        selectedElementSame:document.querySelector(
          '.image-node[data-id="node-0"]',
        ) === selectedElement,
      };
      const longTasks = [];
      const longTaskObserver = typeof PerformanceObserver === 'function'
        && PerformanceObserver.supportedEntryTypes?.includes('longtask')
        ? new PerformanceObserver(list => {
            list.getEntries().forEach(entry => longTasks.push(entry.duration));
          })
        : null;
      longTaskObserver?.observe({type:'longtask',buffered:false});
      const started = performance.now();
      control.blur();
      await new Promise(resolve => setTimeout(resolve,0));
      const flushMs = performance.now() - started;
      await new Promise(resolve => setTimeout(resolve,50));
      longTaskObserver?.takeRecords().forEach(
        entry => longTasks.push(entry.duration),
      );
      longTaskObserver?.disconnect();
      const positions = [...expected].map(([id,position]) => {
        const node = nodes.find(item => item.id === id);
        const element = document.querySelector(
          `.image-node[data-id="${CSS.escape(id)}"]`,
        );
        return {
          id,
          expected:position,
          model:{x:node?.x,y:node?.y},
          dom:element
            ? {x:parseFloat(element.style.left),y:parseFloat(element.style.top)}
            : null,
        };
      });
      return {
        beforeBlur,
        flushMs,
        revision:window.SmartCanvasModules.canvasPersistence.status().revision,
        selectedElementSame:document.querySelector(
          '.image-node[data-id="node-0"]',
        ) === selectedElement,
        mountedNodeCount:document.querySelectorAll('.image-node').length,
        longTaskSupported:Boolean(longTaskObserver),
        longTaskCount:longTasks.length,
        longestLongTaskMs:longTasks.length ? Math.max(...longTasks) : 0,
        positions,
      };
    }, QUEUED_MUTATION_COUNT);
    assert.deepEqual(result.beforeBlur, {
      revision:0,
      selectedX:0,
      selectedElementSame:true,
    });
    assert.ok(
      result.flushMs <= UI_STALL_BUDGET_MS,
      `Queued position flush blocked ${result.flushMs.toFixed(1)}ms`,
    );
    assert.equal(result.revision, QUEUED_MUTATION_COUNT);
    assert.equal(result.selectedElementSame, true);
    assert.ok(
      result.longestLongTaskMs <= UI_STALL_BUDGET_MS,
      `Queued position flush produced a ${result.longestLongTaskMs.toFixed(1)}ms Long Task`,
    );
    assert.ok(
      result.mountedNodeCount > 0
        && result.mountedNodeCount <= initial.mountedNodeCount,
      'Position updates must keep the mounted Node set virtualization-bounded',
    );
    result.positions.forEach(position => {
      assert.deepEqual(position.model, position.expected);
      if(position.dom) assert.deepEqual(position.dom, position.expected);
    });
    const virtualizationBoundary = await page.evaluate(async revision => {
      const selectedElement = document.querySelector(
        '.image-node[data-id="node-0"]',
      );
      const beforeMounted = Boolean(document.querySelector(
        '.image-node[data-id="node-334"]',
      ));
      const intoViewportAccepted =
        window.SmartCanvasModules.canvasRealtimeApplier.apply({
          type:'canvas_mutation',
          operation_id:'remote:virtualization-enter',
          revision:revision + 1,
          actor_id:'robot-boundary',
          changes:{node_updates:[
            {id:'node-334',path:['x'],value:80},
            {id:'node-334',path:['y'],value:80},
          ]},
        });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const enteredElement = document.querySelector(
        '.image-node[data-id="node-334"]',
      );
      const afterEnter = {
        mounted:Boolean(enteredElement),
        model:{
          x:nodes.find(node => node.id === 'node-334')?.x,
          y:nodes.find(node => node.id === 'node-334')?.y,
        },
        dom:enteredElement
          ? {
              x:parseFloat(enteredElement.style.left),
              y:parseFloat(enteredElement.style.top),
            }
          : null,
        selectedElementSame:document.querySelector(
          '.image-node[data-id="node-0"]',
        ) === selectedElement,
      };
      const outOfViewportAccepted =
        window.SmartCanvasModules.canvasRealtimeApplier.apply({
          type:'canvas_mutation',
          operation_id:'remote:virtualization-exit',
          revision:revision + 2,
          actor_id:'robot-boundary',
          changes:{node_updates:[
            {id:'node-334',path:['x'],value:9000},
            {id:'node-334',path:['y'],value:9000},
          ]},
        });
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {
        beforeMounted,
        intoViewportAccepted,
        afterEnter,
        outOfViewportAccepted,
        afterExit:{
          mounted:Boolean(document.querySelector(
            '.image-node[data-id="node-334"]',
          )),
          revision:Number(canvas.revision || 0),
          model:{
            x:nodes.find(node => node.id === 'node-334')?.x,
            y:nodes.find(node => node.id === 'node-334')?.y,
          },
          selectedElementSame:document.querySelector(
            '.image-node[data-id="node-0"]',
          ) === selectedElement,
        },
      };
    }, QUEUED_MUTATION_COUNT);
    assert.deepEqual(virtualizationBoundary, {
      beforeMounted:false,
      intoViewportAccepted:true,
      afterEnter:{
        mounted:true,
        model:{x:80,y:80},
        dom:{x:80,y:80},
        selectedElementSame:true,
      },
      outOfViewportAccepted:true,
      afterExit:{
        mounted:false,
        revision:QUEUED_MUTATION_COUNT + 2,
        model:{x:9000,y:9000},
        selectedElementSame:true,
      },
    });
    const unexpectedBrowserErrors = browserErrors.filter(message => (
      !message.startsWith(
        'Failed to load resource: the server responded with a status of 404',
      )
    ));
    assert.deepEqual(unexpectedBrowserErrors, []);
    process.stdout.write(`${JSON.stringify({
      passed:true,
      budgetMs:UI_STALL_BUDGET_MS,
      initial:{mountedNodeCount:initial.mountedNodeCount},
      result,
      virtualizationBoundary,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
