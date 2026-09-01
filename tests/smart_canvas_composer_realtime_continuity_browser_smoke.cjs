const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
  const page = await browser.newPage({viewport:{width:1180,height:760}});
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => {
    if(message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(
      `${origin}/static/smart-canvas.html?id=composer-realtime-continuity`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => Boolean(
      customElements.get('ic-generation-settings-picker')
    ), null, {timeout:30000});
    await page.evaluate(() => {
      const node = {
        id:'composer-node',
        type:'smart-image',
        x:360,
        y:220,
        w:320,
        h:220,
        images:[],
        generationOutputNode:true,
        title:'Composer node',
      };
      const remoteNode = {
        id:'remote-node',
        type:'smart-image',
        x:720,
        y:220,
        w:320,
        h:220,
        images:[],
        generationOutputNode:true,
        title:'Remote node',
      };
      canvas = {
        id:'composer-realtime-continuity',
        title:'Composer realtime continuity',
        nodes:[node,remoteNode],
        connections:[],
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      };
      nodes = canvas.nodes;
      selectedId = node.id;
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument(canvas);
      canvasPersistenceRevision = 0;
      render();
    });
    await page.waitForFunction(() => (
      document.querySelector('ic-generation-settings-picker')
        ?.dataset.icContractStatus === 'ready'
      && document.querySelector(
        '#composer ic-select[data-component-variant="model-picker"]',
      )?.dataset.icContractStatus === 'ready'
    ), null, {timeout:30000});
    await page.evaluate(() => {
      const model = document.querySelector(
        '#composer ic-select[data-component-variant="model-picker"]',
      );
      window.__scheduledRefreshModelIdentity = model;
      if(model) model.open = true;
      window.__scheduledRefreshModelInitiallyOpen = model?.open === true;
      model?.dispatchEvent(new CustomEvent('ic-show', {
        bubbles:true,
        composed:true,
      }));
    });
    await page.waitForSelector('#composer.open ic-select[data-component-variant="model-picker"]');
    await page.waitForTimeout(700);
    const scheduledRefreshContinuity = await page.evaluate(async () => {
      const current = document.querySelector(
        '#composer ic-select[data-component-variant="model-picker"]',
      );
      const result = {
        initiallyOpen:window.__scheduledRefreshModelInitiallyOpen,
        sameControl:current === window.__scheduledRefreshModelIdentity,
        open:current?.open === true,
      };
      await current?.hide?.();
      return result;
    });
    assert.deepEqual(scheduledRefreshContinuity, {
      initiallyOpen:true,
      sameControl:true,
      open:true,
    });
    await page.waitForTimeout(260);

    const unrelatedPositionDuringComposerFocus = await page.evaluate(async () => {
      const count = document.querySelector(
        '#composer ic-select[data-component-variant="generation-count"]',
      );
      const composerElement = document.querySelector(
        '.image-node[data-id="composer-node"]',
      );
      const remoteElement = document.querySelector(
        '.image-node[data-id="remote-node"]',
      );
      count.focus();
      const applied = window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        operation_id:'remote:unrelated-position-1',
        revision:1,
        actor_id:'remote-actor',
        changes:{
          node_updates:[
            {id:'remote-node',path:['x'],value:741},
            {id:'remote-node',path:['y'],value:261},
          ],
        },
      });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const currentCount = document.querySelector(
        '#composer ic-select[data-component-variant="generation-count"]',
      );
      const currentRemote = document.querySelector(
        '.image-node[data-id="remote-node"]',
      );
      return {
        applied,
        activeTag:document.activeElement?.localName || '',
        revision:Number(canvas.revision || 0),
        remotePosition:{
          x:nodes.find(node => node.id === 'remote-node')?.x,
          y:nodes.find(node => node.id === 'remote-node')?.y,
        },
        remoteDomPosition:currentRemote
          ? {
              x:parseFloat(currentRemote.style.left),
              y:parseFloat(currentRemote.style.top),
            }
          : null,
        sameCount:currentCount === count,
        sameComposerElement:document.querySelector(
          '.image-node[data-id="composer-node"]',
        ) === composerElement,
        sameRemoteElement:currentRemote === remoteElement,
      };
    });
    assert.deepEqual(unrelatedPositionDuringComposerFocus, {
      applied:true,
      activeTag:'ic-select',
      revision:1,
      remotePosition:{x:741,y:261},
      remoteDomPosition:{x:741,y:261},
      sameCount:true,
      sameComposerElement:true,
      sameRemoteElement:true,
    });

    const positionOnly = await page.evaluate(async () => {
      const model = document.querySelector(
        '#composer ic-select[data-component-variant="model-picker"]',
      );
      model.open = true;
      model.dispatchEvent(new CustomEvent('ic-show', {bubbles:true, composed:true}));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const interactionControl = document.querySelector(
        '#composer ic-select[data-component-variant="generation-count"]',
      );
      interactionControl.focus();
      const applied = window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        operation_id:'remote:position-1',
        revision:2,
        actor_id:'remote-actor',
        changes:{
          node_updates:[
            {id:'composer-node',path:['x'],value:401},
            {id:'composer-node',path:['y'],value:261},
          ],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 420));
      const current = document.querySelector(
        '#composer ic-select[data-component-variant="model-picker"]',
      );
      const beforeBlur = {
        activeTag:document.activeElement?.localName || '',
        sameControl:current === model,
        open:current?.open === true,
        x:nodes.find(node => node.id === 'composer-node')?.x,
        y:nodes.find(node => node.id === 'composer-node')?.y,
        revision:Number(canvas.revision || 0),
      };
      await current.hide();
      interactionControl.blur();
      await new Promise(resolve => setTimeout(resolve, 260));
      return {
        applied,
        beforeBlur,
        afterBlur:{
          sameControl:document.querySelector(
            '#composer ic-select[data-component-variant="model-picker"]',
          ) === model,
          x:nodes.find(node => node.id === 'composer-node')?.x,
          y:nodes.find(node => node.id === 'composer-node')?.y,
          revision:Number(canvas.revision || 0),
        },
      };
    });
    assert.deepEqual(positionOnly, {
      applied:true,
      beforeBlur:{
        activeTag:'ic-select',
        sameControl:true,
        open:true,
        x:360,
        y:220,
        revision:1,
      },
      afterBlur:{
        sameControl:true,
        x:401,
        y:261,
        revision:2,
      },
    });

    const nonPositionInteraction = await page.evaluate(async () => {
      const count = document.querySelector(
        '#composer ic-select[data-component-variant="generation-count"]',
      );
      count.focus();
      const activeTag = document.activeElement?.localName || '';
      const applied = window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        operation_id:'remote:title-1',
        revision:3,
        actor_id:'remote-actor',
        changes:{
          node_updates:[
            {id:'composer-node',path:['title'],value:'Remote title'},
          ],
        },
      });
      const beforeBlur = {
        title:nodes.find(node => node.id === 'composer-node')?.title,
        revision:Number(canvas.revision || 0),
      };
      count.blur();
      await new Promise(resolve => setTimeout(resolve, 260));
      return {
        activeTag,
        applied,
        beforeBlur,
        afterBlur:{
          title:nodes.find(node => node.id === 'composer-node')?.title,
          revision:Number(canvas.revision || 0),
          sameControl:document.querySelector(
            '#composer ic-select[data-component-variant="generation-count"]',
          ) === count,
        },
      };
    });
    assert.deepEqual(nonPositionInteraction, {
      activeTag:'ic-select',
      applied:true,
      beforeBlur:{title:'Composer node',revision:2},
      afterBlur:{title:'Remote title',revision:3,sameControl:false},
    });

    const sameNodeCanvasInteraction = await page.evaluate(async () => {
      const element = document.querySelector(
        '.image-node[data-id="composer-node"]',
      );
      const target = element.querySelector('.node-body') || element;
      const event = {
        button:0,
        detail:1,
        clientX:401,
        clientY:261,
        altKey:false,
        shiftKey:false,
        ctrlKey:false,
        target,
        preventDefault(){},
        stopPropagation(){},
      };
      const interaction = window.SmartCanvasModules.canvasInteraction;
      const started = interaction.begin({
        kind:'move-nodes',
        event,
        nodeId:'composer-node',
      });
      const moved = interaction.move({
        clientX:451,
        clientY:311,
        preventDefault(){},
      });
      const applied = window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        operation_id:'remote:same-node-during-move-1',
        revision:4,
        actor_id:'remote-actor',
        changes:{node_updates:[
          {id:'composer-node',path:['x'],value:500},
          {id:'composer-node',path:['y'],value:350},
        ]},
      });
      const beforeCancel = {
        revision:Number(canvas.revision || 0),
        position:{
          x:nodes.find(node => node.id === 'composer-node')?.x,
          y:nodes.find(node => node.id === 'composer-node')?.y,
        },
        activeKind:interaction.active()?.kind || '',
      };
      const cancelled = interaction.cancel({reason:'test-discard'});
      await new Promise(resolve => setTimeout(resolve,0));
      const currentElement = document.querySelector(
        '.image-node[data-id="composer-node"]',
      );
      return {
        started,
        moved,
        applied,
        beforeCancel,
        cancelled,
        afterCancel:{
          revision:Number(canvas.revision || 0),
          position:{
            x:nodes.find(node => node.id === 'composer-node')?.x,
            y:nodes.find(node => node.id === 'composer-node')?.y,
          },
          domPosition:currentElement
            ? {
                x:parseFloat(currentElement.style.left),
                y:parseFloat(currentElement.style.top),
              }
            : null,
          sameElement:currentElement === element,
          active:interaction.active(),
        },
      };
    });
    assert.deepEqual(sameNodeCanvasInteraction, {
      started:true,
      moved:true,
      applied:true,
      beforeCancel:{
        revision:3,
        position:{x:451,y:311},
        activeKind:'move-nodes',
      },
      cancelled:true,
      afterCancel:{
        revision:4,
        position:{x:500,y:350},
        domPosition:{x:500,y:350},
        sameElement:true,
        active:null,
      },
    });

    const mixedMutationQueue = await page.evaluate(async () => {
      const count = document.querySelector(
        '#composer ic-select[data-component-variant="generation-count"]',
      );
      count.focus();
      const titleAccepted = window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        operation_id:'remote:mixed-title-1',
        revision:5,
        actor_id:'remote-actor',
        changes:{node_updates:[
          {id:'remote-node',path:['title'],value:'Ordered remote title'},
        ]},
      });
      const positionAccepted = window.SmartCanvasModules.canvasRealtimeApplier.apply({
        type:'canvas_mutation',
        operation_id:'remote:mixed-position-1',
        revision:6,
        actor_id:'remote-actor',
        changes:{node_updates:[
          {id:'remote-node',path:['x'],value:800},
          {id:'remote-node',path:['y'],value:300},
        ]},
      });
      const beforeBlur = {
        revision:Number(canvas.revision || 0),
        title:nodes.find(node => node.id === 'remote-node')?.title,
        position:{
          x:nodes.find(node => node.id === 'remote-node')?.x,
          y:nodes.find(node => node.id === 'remote-node')?.y,
        },
      };
      count.blur();
      await new Promise(resolve => setTimeout(resolve,260));
      const current = document.querySelector(
        '.image-node[data-id="remote-node"]',
      );
      return {
        titleAccepted,
        positionAccepted,
        beforeBlur,
        afterBlur:{
          revision:Number(canvas.revision || 0),
          title:nodes.find(node => node.id === 'remote-node')?.title,
          position:{
            x:nodes.find(node => node.id === 'remote-node')?.x,
            y:nodes.find(node => node.id === 'remote-node')?.y,
          },
          domPosition:current
            ? {
                x:parseFloat(current.style.left),
                y:parseFloat(current.style.top),
              }
            : null,
        },
      };
    });
    assert.deepEqual(mixedMutationQueue, {
      titleAccepted:true,
      positionAccepted:true,
      beforeBlur:{
        revision:4,
        title:'Remote node',
        position:{x:741,y:261},
      },
      afterBlur:{
        revision:6,
        title:'Ordered remote title',
        position:{x:800,y:300},
        domPosition:{x:800,y:300},
      },
    });
    const unexpectedBrowserErrors = browserErrors.filter(message => (
      !message.startsWith('Failed to load resource: the server responded with a status of 404')
    ));
    assert.deepEqual(unexpectedBrowserErrors, []);
    process.stdout.write(JSON.stringify({
      passed:true,
      scheduledRefreshContinuity,
      unrelatedPositionDuringComposerFocus,
      positionOnly,
      nonPositionInteraction,
      sameNodeCanvasInteraction,
      mixedMutationQueue,
    }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
