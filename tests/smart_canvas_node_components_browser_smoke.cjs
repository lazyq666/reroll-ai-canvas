const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HEADLESS = process.env.SMART_CANVAS_HEADLESS !== '0';
const MIME_TYPES = {
  '.css':'text/css',
  '.html':'text/html',
  '.js':'text/javascript',
  '.json':'application/json',
  '.png':'image/png',
  '.mp4':'video/mp4',
  '.svg':'image/svg+xml',
  '.webp':'image/webp',
};
function canvasPayload() {
  return {
    canvas:{
      id:'nodes-component-smoke',
      title:'Nodes Component Smoke',
      project:'default',
      revision:1,
      connections:[],
      settings:{},
      logs:[],
      nodes:[
        {id:'node-image',type:'smart-image',title:'Image',x:180,y:120,w:220,h:160,images:[{url:'/static/images/logo.png',name:'image.png',kind:'image'}]},
        {id:'node-generation',type:'smart-image',title:'Generation',referenceGenerationKind:'image',generationOutputNode:true,x:180,y:920,w:300,h:220,images:[]},
        {id:'node-prompt',type:'smart-prompt',title:'Prompt',text:'电影感侧逆光',x:460,y:120,w:260,h:180,images:[]},
        {id:'node-prompt-generation',type:'smart-prompt',title:'Prompt Generation',llmEnabled:true,text:'生成结构化提示词',x:780,y:120,w:280,h:220,images:[]},
        {id:'node-splitter',type:'smart-splitter',title:'Splitter',separator:';',x:180,y:380,w:280,h:220,images:[]},
        {id:'node-loop',type:'smart-loop',title:'Batch Run',x:520,y:380,w:360,h:406,images:[]},
        {id:'node-group',type:'smart-group',title:'Smart Group',x:880,y:390,w:300,h:220,images:[],items:[]},
        {id:'node-frame',type:'smart-frame',title:'Frame',x:180,y:680,w:420,h:220,items:[],frameColor:'violet'},
        {id:'node-text',type:'smart-text',title:'Text',text:'文本标注',x:680,y:700,w:220,h:100},
        {id:'node-brush',type:'smart-brush',title:'Brush',x:980,y:700,w:220,h:100,color:'#f97316',size:8,points:[{x:8,y:80},{x:100,y:20},{x:210,y:70}]},
      ],
    },
  };
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const inlineMediaPath = pathname === '/api/download-output'
      ? decodeURIComponent(requestUrl.searchParams.get('url') || '')
      : pathname;
    const filePath = path.resolve(ROOT, `.${inlineMediaPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, {'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'}).end(body);
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
  const browser = await chromium.launch({headless:HEADLESS, executablePath:CHROME});
  const errors = [];
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    const reviewApiWrites = [];
    page.on('request', request => {
      if (request.url().includes('/api/') && request.method() !== 'GET') {
        reviewApiWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/ui-component-library.html#nodes`, {waitUntil:'networkidle'});
    await page.waitForFunction(() => document.body.dataset.activeReview === 'nodes');
    const frameElement = page.locator('iframe[data-nodes-matrix]');
    await frameElement.waitFor({state:'visible'});
    const frame = page.frames().find(item => item.url().includes('componentReview=nodes'));
    if (!frame) throw new Error('Nodes preview frame did not load');
    await frame.waitForFunction(() => document.documentElement.dataset.nodesStatus === 'ready');

    async function measureHoverShadowContract() {
      const expected = await frame.locator('body').evaluate(() => {
        const probe=document.createElement('span');
        probe.style.boxShadow='var(--ui-shadow-overlay)';
        document.body.appendChild(probe);
        const value=getComputedStyle(probe).boxShadow;
        probe.remove();
        return value;
      });
      const expectedNone = await frame.locator('body').evaluate(() => {
        const probe=document.createElement('span');
        probe.style.boxShadow='var(--ui-shadow-none)';
        document.body.appendChild(probe);
        const value=getComputedStyle(probe).boxShadow;
        probe.remove();
        return value;
      });
      const contract = {expected,expectedNone};
      for (const {key, id, target} of [
        {key:'node', id:'review-prompt-filled'},
        {key:'smartGroup', id:'review-group-media'},
        {key:'frame', id:'review-frame-blue'},
        {key:'textAnnotation', id:'review-text-small', target:'.smart-canvas-text'},
        {key:'brushStroke', id:'review-brush-thin', target:'.smart-brush-mark'},
      ]) {
        const locator=frame.locator(`ic-canvas-node[data-id="${id}"]`);
        const hoverTarget=target ? locator.locator(target) : locator;
        const position=key === 'brushStroke'
          ? await hoverTarget.evaluate(svg => {
            const path=svg.querySelector('.smart-brush-hit');
            const point=path.getPointAtLength(path.getTotalLength() / 2);
            const screenPoint=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM());
            const rect=svg.getBoundingClientRect();
            return {x:screenPoint.x-rect.left,y:screenPoint.y-rect.top};
          })
          : undefined;
        await hoverTarget.hover(position ? {position} : undefined);
        contract[key]=await locator.evaluate(element => getComputedStyle(element).boxShadow);
      }
      return contract;
    }

    if (process.env.IC_BROWSER_FOCUS_ANNOTATION_HOVER === '1') {
      const hoverShadowContract = await measureHoverShadowContract();
      assert.equal(hoverShadowContract.node, hoverShadowContract.expected);
      assert.notEqual(hoverShadowContract.smartGroup, hoverShadowContract.expected);
      assert.notEqual(hoverShadowContract.frame, hoverShadowContract.expected);
      assert.equal(hoverShadowContract.textAnnotation, hoverShadowContract.expectedNone);
      assert.equal(hoverShadowContract.brushStroke, hoverShadowContract.expectedNone);
      assert.deepEqual(reviewApiWrites, []);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({status:'ready',hoverShadowContract}));
      return;
    }

    if (process.env.IC_BROWSER_FOCUS_PENDING_CORNERS === '1') {
      const pendingCorners = await frame.evaluate(() => {
        const node=document.querySelector('ic-canvas-node[data-id="review-generation-pending"]');
        const pending=node?.querySelector('ic-generation-pending[data-generation-pending-node]');
        const surface=pending?.shadowRoot?.querySelector('.pending');
        const cell=pending?.shadowRoot?.querySelector('.pending-cell');
        const radius=element => parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
        const nodeRect=node.getBoundingClientRect();
        const surfaceRect=surface.getBoundingClientRect();
        const scaleX=nodeRect.width / node.offsetWidth;
        const scaleY=nodeRect.height / node.offsetHeight;
        const round=value => Math.round(value * 100) / 100;
        return {
          nodeRadius:radius(node),
          surfaceRadius:radius(surface),
          cellRadius:radius(cell),
          inlineWidth:pending.style.width,
          inlineHeight:pending.style.height,
          contentInsets:{
            top:round((surfaceRect.top-nodeRect.top)/scaleY),
            right:round((nodeRect.right-surfaceRect.right)/scaleX),
            bottom:round((nodeRect.bottom-surfaceRect.bottom)/scaleY),
            left:round((surfaceRect.left-nodeRect.left)/scaleX),
          },
        };
      });
      assert.equal(pendingCorners.surfaceRadius, pendingCorners.nodeRadius, JSON.stringify(pendingCorners));
      assert.equal(pendingCorners.cellRadius, pendingCorners.nodeRadius, JSON.stringify(pendingCorners));
      assert.equal(pendingCorners.inlineWidth, '', JSON.stringify(pendingCorners));
      assert.equal(pendingCorners.inlineHeight, '', JSON.stringify(pendingCorners));
      assert.deepEqual(pendingCorners.contentInsets, {top:1,right:1,bottom:1,left:1}, JSON.stringify(pendingCorners));
      if (process.env.IC_BROWSER_SCREENSHOT) {
        await frame.locator('ic-canvas-node[data-id="review-generation-pending"]').screenshot({
          path:process.env.IC_BROWSER_SCREENSHOT,
        });
      }
      console.log(JSON.stringify({status:'ready',pendingCorners}));
      return;
    }

    if (process.env.IC_BROWSER_FOCUS_PROMPT_ALIGNMENT === '1') {
      const alignment = await frame.evaluate(() => {
        const node = document.querySelector('ic-canvas-node[data-id="review-prompt-generation-upstream-image"]');
        const thumb = node?.querySelector('.prompt-node-input-thumbs .input-thumb');
        const editor = node?.querySelector('.prompt-llm-instruction');
        if (!node || !thumb || !editor) return null;
        const thumbRect = thumb.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const editorStyle = getComputedStyle(editor);
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;inline-size:var(--ui-space-2);visibility:hidden';
        document.body.appendChild(probe);
        const expectedRightPadding = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          leftDelta:Math.abs((editorRect.left + Number.parseFloat(editorStyle.paddingLeft)) - thumbRect.left),
          leftPadding:Number.parseFloat(editorStyle.paddingLeft),
          rightPadding:Number.parseFloat(editorStyle.paddingRight),
          expectedRightPadding,
        };
      });
      assert.ok(alignment, JSON.stringify(alignment));
      assert.ok(alignment.leftDelta <= .1, JSON.stringify(alignment));
      assert.equal(alignment.leftPadding, 0, JSON.stringify(alignment));
      assert.equal(alignment.rightPadding, alignment.expectedRightPadding, JSON.stringify(alignment));
      if (process.env.IC_BROWSER_SCREENSHOT) {
        await frame.locator('ic-canvas-node[data-id="review-prompt-generation-upstream-image"]').screenshot({
          path:process.env.IC_BROWSER_SCREENSHOT,
        });
      }
      console.log(JSON.stringify({promptGenerationAlignment:alignment}, null, 2));
      return;
    }

    const productionRuntime = await frame.evaluate(() => ({
      world:Boolean(document.querySelector('#world')),
      productionInteraction:Boolean(window.SmartCanvasModules?.canvasInteraction),
      floatingPortal:Boolean(document.querySelector('#smartNodeFloatingPortal')),
      reviewMode:document.body.classList.contains('smart-canvas-node-review'),
      promptGenerationModelCount:document.querySelectorAll(
        'ic-canvas-node[kind="prompt-generation"] .prompt-llm-model'
      ).length,
    }));
    assert.equal(productionRuntime.world, true, JSON.stringify(productionRuntime));
    assert.equal(productionRuntime.productionInteraction, true, JSON.stringify(productionRuntime));
    assert.equal(productionRuntime.floatingPortal, true, JSON.stringify(productionRuntime));
    assert.equal(productionRuntime.reviewMode, true, JSON.stringify(productionRuntime));
    assert.equal(productionRuntime.promptGenerationModelCount, 2, JSON.stringify(productionRuntime));

    const uploadNodeCursor = await frame.evaluate(() => {
      const node = document.querySelector('ic-canvas-node[data-id="review-image-empty"]');
      const upload = node?.querySelector('ic-upload-surface.node-drop');
      const surface = upload?.shadowRoot?.querySelector('.surface');
      const title = upload?.shadowRoot?.querySelector('.copy strong');
      const hint = upload?.shadowRoot?.querySelector('.copy span');
      const button = upload?.shadowRoot?.querySelector('ic-button');
      return {
        node:getComputedStyle(node).cursor,
        upload:getComputedStyle(upload).cursor,
        surface:getComputedStyle(surface).cursor,
        title:getComputedStyle(title).cursor,
        hint:getComputedStyle(hint).cursor,
        button:getComputedStyle(button?.button).cursor,
      };
    });
    assert.deepEqual(uploadNodeCursor, {
      node:'move',
      upload:'move',
      surface:'move',
      title:'move',
      hint:'move',
      button:'pointer',
    });

    const generationNodeCursors = await frame.evaluate(() => {
      const measure = id => {
        const node = document.querySelector(`ic-canvas-node[data-id="${id}"]`);
        const target = node?.querySelector('.reference-generation-target');
        const main = target?.querySelector('.upload-node-main');
        const title = target?.querySelector('.upload-node-title');
        const subtitle = target?.querySelector('.upload-node-sub');
        const button = target?.querySelector('ic-button');
        return {
          node:getComputedStyle(node).cursor,
          target:getComputedStyle(target).cursor,
          main:getComputedStyle(main).cursor,
          title:getComputedStyle(title).cursor,
          subtitle:getComputedStyle(subtitle).cursor,
          button:button ? getComputedStyle(button.button).cursor : null,
        };
      };
      return Object.fromEntries([
        'review-generation-image',
        'review-generation-video',
        'review-generation-failed',
      ].map(id => [id, measure(id)]));
    });
    const generationDragCursor = {
      node:'move',
      target:'move',
      main:'move',
      title:'move',
      subtitle:'move',
      button:null,
    };
    assert.deepEqual(generationNodeCursors, {
      'review-generation-image':generationDragCursor,
      'review-generation-video':generationDragCursor,
      'review-generation-failed':{...generationDragCursor,button:'pointer'},
    });

    const failedGenerationNode = frame.locator('ic-canvas-node[data-id="review-generation-failed"]');
    await failedGenerationNode.locator('[data-view-generation-log]').click();
    await frame.waitForFunction(
      () => document.querySelector('#smartLogModal')?.hasAttribute('open'),
      null,
      {timeout:2000}
    );
    const failureLogModalOpened = await frame.evaluate(() =>
      document.querySelector('#smartLogModal')?.hasAttribute('open') || false
    );
    assert.equal(failureLogModalOpened, true);
    await frame.evaluate(() => closeSmartCanvasLog());

    const serialLoop = frame.locator('.image-node[data-id="review-loop-serial"]');
    const imageBatchControl = serialLoop.locator('.loop-number-control:has([data-loop-number-input="imageBatchSize"])');
    const loopStartControl = serialLoop.locator('.loop-number-control:has([data-loop-number-input="loopStart"])');
    const countControl = serialLoop.locator('.loop-number-control:has([data-loop-number-input="count"])');
    await imageBatchControl.locator('.loop-number-trigger').click();
    await imageBatchControl.locator('ic-number-input input').fill('2');
    await loopStartControl.locator('.loop-number-trigger').click();
    await loopStartControl.locator('ic-popover[open]').waitFor({state:'attached', timeout:2000});
    await countControl.locator('.loop-number-trigger').click({timeout:2000});
    await countControl.locator('ic-popover[open]').waitFor({state:'attached', timeout:2000});
    await countControl.locator('[data-loop-value="4"]').click();
    await countControl.locator('ic-popover[open]').waitFor({state:'detached', timeout:2000});

    await frame.locator('ic-canvas-node[data-id="review-image-ready"]').click({button:'right'});
    await frame.locator('#smartNodeContextMenu[open]').waitFor({state:'attached', timeout:2000});
    const nodeContextMenuRadius = await frame.evaluate(() => {
      const menu=document.querySelector('#smartNodeContextMenu');
      const surface=menu?.shadowRoot?.querySelector('[part="surface"]');
      const probe=document.createElement('span');
      probe.style.borderRadius='var(--ui-radius-m)';
      document.body.appendChild(probe);
      const expected=getComputedStyle(probe).borderRadius;
      probe.remove();
      return {actual:surface ? getComputedStyle(surface).borderRadius : '',expected};
    });
    assert.equal(nodeContextMenuRadius.actual, nodeContextMenuRadius.expected, JSON.stringify(nodeContextMenuRadius));
    await frame.evaluate(() => {
      closeSmartNodeContextMenu();
      window.SmartCanvasModules.viewportSelection.selection.clear();
      render();
    });
    await page.mouse.move(1400, 10);
    await frame.waitForTimeout(100);

    const expectedKinds = [
      'image', 'generation', 'prompt', 'prompt-generation', 'splitter', 'loop',
      'smart-group', 'frame', 'text-annotation', 'brush-stroke',
    ];
    const report = await frame.evaluate(() => ({
      status:document.documentElement.dataset.nodesStatus,
      kinds:[...document.querySelectorAll('ic-canvas-node')].map(node => node.getAttribute('kind')),
      contracts:[...document.querySelectorAll('ic-canvas-node')].map(node => node.dataset.icContractStatus),
      labels:[...document.querySelectorAll('ic-canvas-node[data-id^="review-label-"]')].map(node => ({
        id:node.dataset.id,
        text:node.textContent.replace(/\s+/g, ' ').trim(),
        y:parseFloat(node.style.top),
        right:parseFloat(node.style.left) + (node.querySelector('.smart-canvas-text')?.scrollWidth || 0),
      })),
      cases:[...document.querySelectorAll('ic-canvas-node:not([data-id^="review-label-"])')].map(node => ({
        id:node.dataset.id,
        kind:node.getAttribute('kind'),
        state:node.getAttribute('state'),
        y:parseFloat(node.style.top),
      })),
      lightBackground:getComputedStyle(document.querySelector('#shell')).backgroundColor,
      surfaceBackground:(() => {
        const probe=document.createElement('span');
        probe.style.background='var(--ui-color-surface)';
        document.body.appendChild(probe);
        const value=getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      })(),
      hosts:[...document.querySelectorAll('ic-canvas-node')].map(node => ({
        tag:node.localName,
        body:Boolean(node.querySelector(':scope > .node-body')),
        shadowSlot:Boolean(node.shadowRoot?.querySelector('slot')),
        position:getComputedStyle(node).position,
      })),
      resizeHandleCount:document.querySelectorAll('ic-canvas-node > .node-resize-handle').length,
      resizeHandleStyle:(() => {
        const node=document.querySelector('ic-canvas-node[data-id="review-image-ready"]');
        const handle=node?.querySelector(':scope > .node-resize-handle');
        const path=handle?.querySelector('.node-resize-handle-shape path');
        const nodeRect=node?.getBoundingClientRect();
        const handleRect=handle?.getBoundingClientRect();
        const shapeRect=handle?.querySelector('.node-resize-handle-shape')?.getBoundingClientRect();
        const pathStyle=path ? getComputedStyle(path) : null;
        const scaleX=nodeRect && node?.offsetWidth ? nodeRect.width / node.offsetWidth : 1;
        const scaleY=nodeRect && node?.offsetHeight ? nodeRect.height / node.offsetHeight : 1;
        const screenPoint = point => {
          const matrix=path?.getScreenCTM();
          if (!matrix || !point) return null;
          const result=new DOMPoint(point.x,point.y).matrixTransform(matrix);
          return {x:result.x,y:result.y};
        };
        const length=path?.getTotalLength() || 0;
        const start=screenPoint(path?.getPointAtLength(0));
        const end=screenPoint(path?.getPointAtLength(length));
        return {
          handleSize:handleRect ? {width:handleRect.width / scaleX,height:handleRect.height / scaleY} : null,
          shapeSize:shapeRect ? {width:shapeRect.width / scaleX,height:shapeRect.height / scaleY} : null,
          extendsOutside:nodeRect && handleRect
            ? {right:(handleRect.right - nodeRect.right) / scaleX,bottom:(handleRect.bottom - nodeRect.bottom) / scaleY}
            : null,
          visibleGap:nodeRect && start && end
            ? {right:(end.x - nodeRect.right) / scaleX,bottom:(start.y - nodeRect.bottom) / scaleY}
            : null,
          start,
          end,
          nodeCorner:nodeRect ? {right:nodeRect.right,bottom:nodeRect.bottom} : null,
          pathData:path?.getAttribute('d') || '',
          fill:pathStyle?.fill || '',
          stroke:pathStyle?.stroke || '',
          expectedStroke:(() => {
            const probe=document.createElement('span');
            probe.style.color='var(--ui-color-border-focus)';
            document.body.appendChild(probe);
            const value=getComputedStyle(probe).color;
            probe.remove();
            return value;
          })(),
          strokeWidth:pathStyle?.strokeWidth || '',
          strokeLinecap:pathStyle?.strokeLinecap || '',
          strokeLinejoin:pathStyle?.strokeLinejoin || '',
        };
      })(),
      quickAddZoneCount:document.querySelectorAll('ic-canvas-node > .smart-node-quick-add-zone').length,
      promptGenerationModelOptions:document.querySelectorAll(
        'ic-canvas-node[kind="prompt-generation"] .prompt-llm-model > option'
      ).length,
      promptGenerationModelDisabled:document.querySelector(
        'ic-canvas-node[kind="prompt-generation"] .prompt-llm-model'
      )?.disabled,
      videoMedia:document.querySelector(
        'ic-canvas-node[data-id="review-image-video"] [data-preview-kind="video"],ic-canvas-node[data-id="review-image-video"] video[data-url]'
      )?.dataset?.originalSrc || document.querySelector(
        'ic-canvas-node[data-id="review-image-video"] video[data-url]'
      )?.dataset?.url || '',
      audioMedia:document.querySelector(
        'ic-canvas-node[data-id="review-image-audio"] audio[data-url]'
      )?.dataset?.url || '',
      imageMedia:document.querySelector(
        'ic-canvas-node[data-id="review-image-ready"] img.node-img'
      )?.getAttribute('src') || '',
      promptGenerationUpstreamImage:(() => {
        const node=document.querySelector('ic-canvas-node[data-id="review-prompt-generation-upstream-image"]');
        const thumb=node?.querySelector('.prompt-node-input-thumbs .input-thumb');
        return {
          count:node?.querySelectorAll('.prompt-node-input-thumbs .input-thumb').length || 0,
          tag:thumb?.localName || '',
          url:thumb?.dataset.url || '',
          imageSrc:thumb?.querySelector('img')?.getAttribute('src') || '',
        };
      })(),
      containerStyles:(() => {
        const group=getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-group-empty"]'));
        const frame=getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-frame-violet"]'));
        const probe=document.createElement('span');
        probe.style.boxShadow='var(--ui-shadow-raised)';
        document.body.appendChild(probe);
        const raisedShadow=getComputedStyle(probe).boxShadow;
        probe.remove();
        return {
          group:{borderRadius:group.borderRadius,boxShadow:group.boxShadow},
          frame:{borderRadius:frame.borderRadius},
          raisedShadow,
        };
      })(),
      shellStyle:(() => {
        const style = getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-generation-image"]'));
        return {background:style.backgroundColor,borderWidth:style.borderWidth,borderColor:style.borderColor,borderRadius:style.borderRadius,boxShadow:style.boxShadow};
      })(),
      imageShellStyle:(() => {
        const node = document.querySelector('ic-canvas-node[data-id="review-image-ready"]');
        const image = node?.querySelector('.image-wrap > img.node-img');
        const style = node ? getComputedStyle(node) : null;
        const imageStyle = image ? getComputedStyle(image) : null;
        const nodeRect = node?.getBoundingClientRect();
        const imageRect = image?.getBoundingClientRect();
        const border = parseFloat(style?.borderLeftWidth || '0');
        const scaleX = nodeRect && node?.offsetWidth ? nodeRect.width / node.offsetWidth : 1;
        const scaleY = nodeRect && node?.offsetHeight ? nodeRect.height / node.offsetHeight : 1;
        const inset = value => Math.round(value * 10) / 10;
        return {
          padding:style?.padding || '',
          background:style?.backgroundColor || '',
          borderWidth:style?.borderWidth || '',
          borderColor:style?.borderColor || '',
          borderRadius:style?.borderRadius || '',
          boxShadow:style?.boxShadow || '',
          imageBorderWidth:imageStyle?.borderWidth || '',
          imageBorderRadius:imageStyle?.borderRadius || '',
          contentInset:nodeRect && imageRect ? {
            top:inset((imageRect.top - nodeRect.top) / scaleY - border),
            right:inset((nodeRect.right - imageRect.right) / scaleX - border),
            bottom:inset((nodeRect.bottom - imageRect.bottom) / scaleY - border),
            left:inset((imageRect.left - nodeRect.left) / scaleX - border),
          } : null,
        };
      })(),
      emptyImageBackground:getComputedStyle(
        document.querySelector('ic-canvas-node[data-id="review-image-empty"]')
      ).backgroundColor,
      nodeMediaPolish:(() => {
        const imageNode=document.querySelector('ic-canvas-node[data-id="review-image-ready"]');
        const videoNode=document.querySelector('ic-canvas-node[data-id="review-image-video"]');
        const emptyNode=document.querySelector('ic-canvas-node[data-id="review-image-empty"]');
        const image=imageNode?.querySelector('.image-wrap > img.node-img');
        const imageBadge=imageNode?.querySelector('.image-name-badge');
        const videoCard=videoNode?.querySelector('.media-video-card');
        const nativeVideo=videoCard?.querySelector('video');
        const uploadSurface=emptyNode?.querySelector('ic-upload-surface');
        const uploadButton=uploadSurface?.shadowRoot?.querySelector('ic-button');
        const uploadNodeContent=uploadSurface?.shadowRoot?.querySelector('.node');
        const imageRect=image?.getBoundingClientRect();
        const badgeRect=imageBadge?.getBoundingClientRect();
        const scaleY=imageNode?.offsetHeight ? imageNode.getBoundingClientRect().height / imageNode.offsetHeight : 1;
        return {
          nameBadgeGap:imageRect && badgeRect ? Math.round(((imageRect.top - badgeRect.bottom) / scaleY) * 100) / 100 : null,
          imageRadius:image ? getComputedStyle(image).borderRadius : '',
          videoRadius:videoCard ? getComputedStyle(videoCard).borderRadius : '',
          nativeVideoRadius:nativeVideo ? getComputedStyle(nativeVideo).borderRadius : '',
          nativeVideoControls:Boolean(nativeVideo?.controls),
          uploadButtonSize:uploadButton?.getAttribute('size') || '',
          uploadButtonHeight:uploadButton ? getComputedStyle(uploadButton).height : '',
          uploadButtonHierarchy:uploadButton?.getAttribute('hierarchy') || '',
          uploadNodeGap:uploadNodeContent ? getComputedStyle(uploadNodeContent).gap : '',
        };
      })(),
      nameBadgeStyle:(() => {
        const badge=document.querySelector('ic-canvas-node[data-id="review-image-ready"] .image-name-badge');
        const probe=document.createElement('span');
        probe.style.cssText='font:var(--ui-text-caption);color:var(--ui-color-text-on-action-primary-disabled)';
        document.body.appendChild(probe);
        const actual=badge ? getComputedStyle(badge) : null;
        const expected=getComputedStyle(probe);
        const result={
          actual:{fontFamily:actual?.fontFamily || '',fontSize:actual?.fontSize || '',fontWeight:actual?.fontWeight || '',lineHeight:actual?.lineHeight || '',color:actual?.color || ''},
          expected:{fontFamily:expected.fontFamily,fontSize:expected.fontSize,fontWeight:expected.fontWeight,lineHeight:expected.lineHeight,color:expected.color},
        };
        probe.remove();
        return result;
      })(),
      promptScrollbar:(() => {
        const prompt = document.querySelector('ic-canvas-node[data-id="review-prompt-filled"] .prompt-node-text');
        const bar = getComputedStyle(prompt, '::-webkit-scrollbar');
        const thumb = getComputedStyle(prompt, '::-webkit-scrollbar-thumb');
        return {width:bar.width,thumbBackground:thumb.backgroundColor,thumbRadius:thumb.borderRadius};
      })(),
      promptOverflow:(() => {
        const plainNode = document.querySelector('ic-canvas-node[data-id="review-prompt-filled"]');
        const generationNode = document.querySelector('ic-canvas-node[data-id="review-prompt-generation-configured"]');
        const plain = plainNode?.querySelector('.prompt-node-text');
        const generation = generationNode?.querySelector('.prompt-llm-instruction');
        return {
          plain:Boolean(plain && plain.scrollHeight > plain.clientHeight),
          generation:Boolean(generation && generation.scrollHeight > generation.clientHeight),
          plainMetrics:plain ? {clientHeight:plain.clientHeight,scrollHeight:plain.scrollHeight,textLength:plain.textContent.length} : null,
          generationMetrics:generation ? {clientHeight:generation.clientHeight,scrollHeight:generation.scrollHeight,textLength:generation.textContent.length} : null,
          plainRightInset:plain && plainNode ? Math.round((plainNode.getBoundingClientRect().right - plain.getBoundingClientRect().right) * 10) / 10 : null,
          generationRightInset:generation && generationNode ? Math.round((generationNode.getBoundingClientRect().right - generation.getBoundingClientRect().right) * 10) / 10 : null,
        };
      })(),
      promptGenerationAlignment:(() => {
        const node = document.querySelector('ic-canvas-node[data-id="review-prompt-generation-upstream-image"]');
        const thumb = node?.querySelector('.prompt-node-input-thumbs .input-thumb');
        const editor = node?.querySelector('.prompt-llm-instruction');
        if (!node || !thumb || !editor) return null;
        const thumbRect = thumb.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const editorStyle = getComputedStyle(editor);
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;inline-size:var(--ui-space-2);visibility:hidden';
        document.body.append(probe);
        const expectedRightPadding = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          leftDelta:Math.abs((editorRect.left + Number.parseFloat(editorStyle.paddingLeft)) - thumbRect.left),
          leftPadding:Number.parseFloat(editorStyle.paddingLeft),
          rightPadding:Number.parseFloat(editorStyle.paddingRight),
          expectedRightPadding,
        };
      })(),
      generationVisual:(() => {
        const main=document.querySelector('ic-canvas-node[data-id="review-generation-image"] .upload-node-main');
        const probe=document.createElement('span');
        probe.style.color='var(--ui-color-icon-secondary)';
        document.body.appendChild(probe);
        const expectedIconColor=getComputedStyle(probe).color;
        probe.remove();
        return {
          icon:main?.querySelector('svg[data-lucide="zap"]')?.getAttribute('data-lucide') || '',
          iconSize:main?.querySelector('svg[data-lucide="zap"]')?.getBoundingClientRect().width || 0,
          iconColor:main ? getComputedStyle(main).color : '',
          expectedIconColor,
          title:document.querySelector('ic-canvas-node[data-id="review-generation-image"] .upload-node-title')?.textContent.trim() || '',
          subtitle:document.querySelector('ic-canvas-node[data-id="review-generation-image"] .upload-node-sub')?.textContent.trim() || '',
        };
      })(),
      generationResultStyle:(() => {
        const node=document.querySelector('ic-canvas-node[data-id="review-generation-result"]');
        const image=node?.querySelector('.image-wrap > .node-img');
        const nodeStyle=node ? getComputedStyle(node) : null;
        const imageStyle=image ? getComputedStyle(image) : null;
        return {
          kind:node?.getAttribute('kind') || '',
          padding:nodeStyle?.padding || '',
          background:nodeStyle?.backgroundColor || '',
          borderWidth:nodeStyle?.borderWidth || '',
          borderColor:nodeStyle?.borderColor || '',
          borderRadius:nodeStyle?.borderRadius || '',
          boxShadow:nodeStyle?.boxShadow || '',
          imageBorderWidth:imageStyle?.borderWidth || '',
          imageBorderRadius:imageStyle?.borderRadius || '',
        };
      })(),
      failureVisuals:[...document.querySelectorAll('[data-node-generation-failure]')].map(node => ({
        id:node.closest('ic-canvas-node')?.dataset.id || '',
        title:node.querySelector('.upload-node-title')?.textContent.trim() || '',
        subtitle:node.querySelector('.upload-node-sub')?.textContent.trim() || '',
        action:node.querySelector('[data-view-generation-log]')?.textContent.trim() || '',
        iconBackground:getComputedStyle(node.querySelector('.upload-node-main')).backgroundColor,
        iconBorderWidth:getComputedStyle(node.querySelector('.upload-node-main')).borderWidth,
        iconContainerWidth:getComputedStyle(node.querySelector('.upload-node-main')).width,
        iconContainerHeight:getComputedStyle(node.querySelector('.upload-node-main')).height,
        iconContainerShadow:getComputedStyle(node.querySelector('.upload-node-main')).boxShadow,
        iconSize:node.querySelector('.upload-node-main ic-icon')?.getBoundingClientRect().width || 0,
      })),
      generationFailureRuntime:(() => {
        const node=document.querySelector('ic-canvas-node[data-id="review-generation-failed"]');
        const body=node?.querySelector(':scope > .node-body');
        const content=node?.querySelector('[data-node-generation-failure]');
        const nodeRect=node?.getBoundingClientRect();
        const bodyRect=body?.getBoundingClientRect();
        const contentRect=content?.getBoundingClientRect();
        return {
          hasFailureBody:Boolean(content),
          hint:node?.querySelector('.node-hint')?.textContent.trim() || '',
          text:node?.textContent.replace(/\s+/g, ' ').trim() || '',
          centerDeltaY:nodeRect && bodyRect && contentRect
            ? Math.abs((bodyRect.top + (nodeRect.bottom - bodyRect.top) / 2) - (contentRect.top + contentRect.height / 2))
            : null,
        };
      })(),
    }));

    const videoNode = frame.locator('ic-canvas-node[data-id="review-image-video"]');
    await videoNode.scrollIntoViewIfNeeded();
    await frame.waitForTimeout(100);
    const videoPlayback = await videoNode.evaluate(node => ({
      active:Boolean(node.querySelector('video[data-inline-video-active="1"]')),
      playOverlayCount:node.querySelectorAll('.smart-video-play').length,
      sharedPlayerCount:node.querySelectorAll('ic-media-player-controls').length,
    }));

    const movableNode = frame.locator('ic-canvas-node[data-id="review-group-empty"]');
    await movableNode.scrollIntoViewIfNeeded();
    const positionBeforeMove = await movableNode.evaluate(node => ({
      x:parseFloat(node.style.left),
      y:parseFloat(node.style.top),
    }));
    const moveBox = await movableNode.boundingBox();
    assert.ok(moveBox, 'smart group node should be measurable for production drag');
    await page.mouse.move(moveBox.x + 24, moveBox.y + 18);
    await page.mouse.down();
    await page.mouse.move(moveBox.x + 72, moveBox.y + 50, {steps:5});
    await page.mouse.up();
    await frame.waitForTimeout(50);
    const moveReview = await movableNode.evaluate(node => ({
      x:parseFloat(node.style.left),
      y:parseFloat(node.style.top),
      activeInteraction:Boolean(window.SmartCanvasModules.canvasInteraction.active()),
      syncRetryToast:[...document.querySelectorAll('ic-toast')].some(toast =>
        toast.textContent.includes('实时同步暂不可用')
        || toast.shadowRoot?.textContent?.includes('实时同步暂不可用')
      ),
      persistence:window.SmartCanvasModules.canvasPersistence.status(),
    }));
    assert.equal(moveReview.activeInteraction, false, JSON.stringify(moveReview));
    assert.equal(moveReview.syncRetryToast, false, JSON.stringify(moveReview));
    assert.ok(moveReview.x >= positionBeforeMove.x + 47, JSON.stringify({positionBeforeMove,moveReview}));
    assert.ok(moveReview.y >= positionBeforeMove.y + 31, JSON.stringify({positionBeforeMove,moveReview}));
    assert.equal(moveReview.persistence.state, 'ready', JSON.stringify(moveReview));
    assert.deepEqual(reviewApiWrites, []);

    for(const dragCase of [
      {
        id:'review-image-empty',
        surface:'.node-drop',
        handle:'.node-drop',
        label:'upload node content',
      },
      {
        id:'review-generation-image',
        surface:'[data-reference-generation-target]',
        handle:'.upload-node-title',
        label:'generation node content',
      },
    ]){
      const dragNode = frame.locator(`ic-canvas-node[data-id="${dragCase.id}"]`);
      await dragNode.scrollIntoViewIfNeeded();
      const before = await dragNode.evaluate(node => ({
        x:parseFloat(node.style.left),
        y:parseFloat(node.style.top),
      }));
      const handle = dragNode.locator(dragCase.handle);
      const handleBox = await handle.boundingBox();
      assert.ok(handleBox, `${dragCase.label} should be measurable`);
      const startX = dragCase.id === 'review-image-empty' ? handleBox.x + 18 : handleBox.x + handleBox.width / 2;
      const startY = dragCase.id === 'review-image-empty' ? handleBox.y + handleBox.height / 2 : handleBox.y + handleBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 44, startY + 28, {steps:5});
      await page.mouse.up();
      await frame.waitForTimeout(50);
      const after = await dragNode.evaluate(node => ({
        x:parseFloat(node.style.left),
        y:parseFloat(node.style.top),
      }));
      assert.ok(after.x >= before.x + 43, JSON.stringify({dragCase,before,after}));
      assert.ok(after.y >= before.y + 27, JSON.stringify({dragCase,before,after}));
    }

    const previewImageNode = frame.locator('ic-canvas-node[data-id="review-image-ready"]');
    await previewImageNode.scrollIntoViewIfNeeded();
    const previewResizeHandle = previewImageNode.locator(':scope > .node-resize-handle');
    const sizeBeforeResize = await previewImageNode.evaluate(node => ({
      width:parseFloat(node.style.width),
      height:parseFloat(node.style.height),
    }));
    const previewResizeBox = await previewResizeHandle.boundingBox();
    assert.ok(previewResizeBox, 'image resize handle should be measurable');
    const resizeStart = {
      x:previewResizeBox.x + previewResizeBox.width / 2,
      y:previewResizeBox.y + previewResizeBox.height / 2,
    };
    await page.mouse.move(resizeStart.x, resizeStart.y);
    await page.mouse.down();
    await page.mouse.move(resizeStart.x + 36, resizeStart.y + 24, {steps:4});
    await page.mouse.up();
    await frame.waitForTimeout(50);
    const sizeAfterResize = await previewImageNode.evaluate(node => ({
      width:parseFloat(node.style.width),
      height:parseFloat(node.style.height),
    }));
    const quickAddZone = previewImageNode.locator(
      ':scope > .smart-node-quick-add-zone--out'
    );
    const quickAddBox = await quickAddZone.boundingBox();
    assert.ok(quickAddBox, 'image Quick Add zone should be measurable');
    await page.mouse.move(quickAddBox.x + 7, quickAddBox.y + 9, {steps:4});
    await frame.waitForTimeout(100);
    const quickAddMagnetism = await quickAddZone.evaluate(zone => {
      const trigger = zone.querySelector('[data-node-quick-add]');
      return {
        classes:zone.className,
        followX:parseFloat(trigger?.style.getPropertyValue('--smart-node-quick-add-follow-x')) || 0,
        followY:parseFloat(trigger?.style.getPropertyValue('--smart-node-quick-add-follow-y')) || 0,
      };
    });
    const quickAddTriggerBox = await previewImageNode
      .locator('[data-node-quick-add][data-port="out"]')
      .boundingBox();
    assert.ok(quickAddTriggerBox, 'image Quick Add trigger should be measurable');
    await page.mouse.click(
      quickAddTriggerBox.x + quickAddTriggerBox.width / 2,
      quickAddTriggerBox.y + quickAddTriggerBox.height / 2
    );
    await frame.waitForTimeout(40);
    const quickAddMenuLocked = await quickAddZone.evaluate(zone => zone.classList.contains('is-menu-locked'));
    await frame.locator('#referenceGenerateMenu').evaluate(menu => { menu.hide?.(); });

    const promptGenerationNode = frame.locator('ic-canvas-node[data-id="review-prompt-generation-configured"]');
    await promptGenerationNode.scrollIntoViewIfNeeded();
    const promptGenerationBox = await promptGenerationNode.boundingBox();
    assert.ok(promptGenerationBox, 'Prompt Generation Node should be measurable');
    await page.mouse.click(promptGenerationBox.x + 8, promptGenerationBox.y + 8);
    await frame.waitForTimeout(50);
    const floatingMenu = await frame.evaluate(() => ({
      selected:document.querySelector('ic-canvas-node[data-id="review-prompt-generation-configured"]')?.classList.contains('selected'),
      portalOpen:document.querySelector('#smartNodeFloatingPortal')?.classList.contains('open'),
      count:document.querySelectorAll('#smartNodeFloatingPortal .smart-node-floating-menu').length,
      borderColor:getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-prompt-generation-configured"]')).borderColor,
      borderWidth:getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-prompt-generation-configured"]')).borderWidth,
      selectionBorderWidth:getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-prompt-generation-configured"]'),'::before').borderWidth,
      boxShadow:getComputedStyle(document.querySelector('ic-canvas-node[data-id="review-prompt-generation-configured"]')).boxShadow,
      expected:(() => {
        const probe=document.createElement('div');
        probe.style.cssText='position:absolute;border:1px solid var(--ui-color-border-focus);box-shadow:var(--ui-shadow-overlay)';
        document.body.appendChild(probe);
        const style=getComputedStyle(probe);
        const value={borderColor:style.borderColor,boxShadow:style.boxShadow};
        probe.remove();
        return value;
      })(),
    }));

    const mediaGeometryBeforeSelection = await frame.evaluate(() => [
      'review-image-ready',
      'review-image-video',
      'review-image-audio',
    ].map(id => {
      const node=document.querySelector(`ic-canvas-node[data-id="${id}"]`);
      const wrap=node?.querySelector('.image-wrap');
      const media=wrap?.querySelector(':scope > .node-img, :scope > .media-video-card, :scope > .media-audio-card, :scope > audio, :scope > ic-media-player-controls');
      const badge=node?.querySelector('.image-name-badge');
      const nodeRect=node?.getBoundingClientRect();
      const mediaRect=media?.getBoundingClientRect();
      const badgeRect=badge?.getBoundingClientRect();
      const scaleX=nodeRect && node?.offsetWidth ? nodeRect.width / node.offsetWidth : 1;
      const scaleY=nodeRect && node?.offsetHeight ? nodeRect.height / node.offsetHeight : 1;
      const round=value => Math.round(value * 100) / 100;
      return {
        id,
        mediaWidth:round((mediaRect?.width || 0) / scaleX),
        mediaHeight:round((mediaRect?.height || 0) / scaleY),
        badgeLeft:round(((badgeRect?.left || 0) - (nodeRect?.left || 0)) / scaleX),
        badgeTop:round(((badgeRect?.top || 0) - (nodeRect?.top || 0)) / scaleY),
      };
    }));
    const mediaSelection = [];
    for(const nodeId of ['review-image-ready','review-image-video','review-image-audio']){
      const mediaNode = frame.locator(`ic-canvas-node[data-id="${nodeId}"]`);
      await mediaNode.scrollIntoViewIfNeeded();
      await mediaNode.click({position:{x:1,y:1}});
      await frame.waitForTimeout(40);
      mediaSelection.push(await mediaNode.evaluate(node => {
        const style=getComputedStyle(node);
        const media=node.querySelector('.image-wrap > :is(img,.node-img)');
        const wrap=node.querySelector('.image-wrap');
        const renderedMedia=wrap?.querySelector(':scope > .node-img, :scope > .media-video-card, :scope > .media-audio-card, :scope > audio, :scope > ic-media-player-controls');
        const badge=node.querySelector('.image-name-badge');
        const nodeRect=node.getBoundingClientRect();
        const renderedMediaRect=renderedMedia?.getBoundingClientRect();
        const badgeRect=badge?.getBoundingClientRect();
        const scaleX=nodeRect.width / node.offsetWidth;
        const scaleY=nodeRect.height / node.offsetHeight;
        const round=value => Math.round(value * 100) / 100;
        const mediaStyle=media ? getComputedStyle(media) : null;
        return {
          id:node.dataset.id,
          selected:node.classList.contains('selected'),
          borderColor:style.borderColor,
          borderWidth:style.borderWidth,
          selectionBorderWidth:getComputedStyle(node,'::before').borderWidth,
          boxShadow:style.boxShadow,
          mediaBoxShadow:mediaStyle?.boxShadow || 'none',
          mediaWidth:round((renderedMediaRect?.width || 0) / scaleX),
          mediaHeight:round((renderedMediaRect?.height || 0) / scaleY),
          badgeLeft:round(((badgeRect?.left || 0) - nodeRect.left) / scaleX),
          badgeTop:round(((badgeRect?.top || 0) - nodeRect.top) / scaleY),
        };
      }));
    }

    const measureNodeContent = node => node.evaluate(element => {
      const body=element.querySelector(':scope > .node-body');
      const content=body?.firstElementChild;
      const nodeRect=element.getBoundingClientRect();
      const bodyRect=body?.getBoundingClientRect();
      const contentRect=content?.getBoundingClientRect();
      const scaleX=nodeRect.width / element.offsetWidth;
      const scaleY=nodeRect.height / element.offsetHeight;
      const round=value => Math.round(value * 100) / 100;
      const geometry=rect => rect ? {
        left:round((rect.left - nodeRect.left) / scaleX),
        top:round((rect.top - nodeRect.top) / scaleY),
        width:round(rect.width / scaleX),
        height:round(rect.height / scaleY),
      } : null;
      return {
        selected:element.classList.contains('selected'),
        borderWidth:getComputedStyle(element).borderWidth,
        selectionBorderWidth:getComputedStyle(element,'::before').borderWidth,
        body:geometry(bodyRect),
        content:geometry(contentRect),
      };
    });
    const nodeContentSelection=[];
    for(const id of [
      'review-prompt-filled',
      'review-prompt-generation-configured',
      'review-splitter-semicolon',
      'review-group-media',
      'review-loop-serial',
      'review-frame-violet',
    ]){
      const node=frame.locator(`ic-canvas-node[data-id="${id}"]`);
      await node.scrollIntoViewIfNeeded();
      const before=await measureNodeContent(node);
      await node.click({position:{x:1,y:1}});
      await frame.waitForTimeout(30);
      const after=await measureNodeContent(node);
      nodeContentSelection.push({id,before,after});
    }

    const modelSelect = promptGenerationNode.locator('.prompt-llm-model');
    await modelSelect.evaluate(select => { select.show(); });
    await frame.waitForTimeout(50);
    const modelSelectOpen = await modelSelect.evaluate(select => Boolean(select.open));
    await modelSelect.evaluate(select => { select.hide(); });

    const hoverShadowContract = await measureHoverShadowContract();

    const screenshot = process.env.IC_BROWSER_SCREENSHOT;
    if (screenshot) await page.screenshot({path:screenshot, fullPage:true});
    const measureUnifiedNodeSurfaces = () => frame.locator('body').evaluate(() => {
      const background = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
      const probe=document.createElement('span');
      probe.style.background='var(--ui-color-surface)';
      document.body.appendChild(probe);
      const expected=getComputedStyle(probe).backgroundColor;
      probe.style.background='transparent';
      const transparent=getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        expected,
        transparent,
        prompt:background('ic-canvas-node[data-id="review-prompt-filled"]'),
        promptGeneration:background('ic-canvas-node[data-id="review-prompt-generation-configured"]'),
        audioNode:background('ic-canvas-node[data-id="review-image-audio"]'),
        audioCard:background('ic-canvas-node[data-id="review-image-audio"] .media-audio-card'),
      };
    });
    const measureUnifiedNodeBorders = () => frame.locator('body').evaluate(() => {
      const probe=document.createElement('span');
      probe.style.border='1px solid var(--ui-color-border-nodes)';
      document.body.appendChild(probe);
      const expected=getComputedStyle(probe).borderColor;
      probe.remove();
      const ids=[
        'review-image-empty',
        'review-generation-video',
        'review-prompt-empty',
        'review-prompt-generation-upstream-image',
        'review-splitter-bar',
        'review-loop-parallel',
        'review-group-empty',
      ];
      return {
        expected,
        actual:ids.map(id => ({
          id,
          borderColor:getComputedStyle(document.querySelector(`ic-canvas-node[data-id="${id}"]`)).borderColor,
        })),
      };
    });
    const measureQuickAddBorder = () => frame.locator('body').evaluate(() => {
      const trigger=document.querySelector('ic-canvas-node[data-id="review-prompt-filled"] .smart-node-quick-add');
      const base=trigger?.shadowRoot?.querySelector('[part="base"]');
      const probe=document.createElement('span');
      probe.style.border='1px solid var(--ui-color-border-nodes)';
      document.body.appendChild(probe);
      const expected=getComputedStyle(probe).borderColor;
      probe.remove();
      return {expected,actual:base ? getComputedStyle(base).borderColor : ''};
    });
    const lightNodeSurfaces = await measureUnifiedNodeSurfaces();
    const lightNodeBorders = await measureUnifiedNodeBorders();
    const lightQuickAddBorder = await measureQuickAddBorder();
    await page.locator('[data-target-theme-toggle]').click();
    await frame.waitForFunction(() => document.documentElement.dataset.uiTheme === 'dark');
    await frame.waitForTimeout(200);
    const darkBackground = await frame.locator('#shell').evaluate(element => getComputedStyle(element).backgroundColor);
    const darkNodeSurfaces = await measureUnifiedNodeSurfaces();
    const darkNodeBorders = await measureUnifiedNodeBorders();
    const darkQuickAddBorder = await measureQuickAddBorder();
    if (screenshot) await page.screenshot({path:screenshot.replace(/\.png$/, '-dark.png'), fullPage:true});

    assert.equal(report.status, 'ready');
    assert.equal(hoverShadowContract.node, hoverShadowContract.expected);
    assert.notEqual(hoverShadowContract.smartGroup, hoverShadowContract.expected);
    assert.notEqual(hoverShadowContract.frame, hoverShadowContract.expected);
    assert.equal(hoverShadowContract.textAnnotation, hoverShadowContract.expectedNone);
    assert.equal(hoverShadowContract.brushStroke, hoverShadowContract.expectedNone);
    for (const surfaces of [lightNodeSurfaces, darkNodeSurfaces]) {
      assert.equal(surfaces.prompt, surfaces.expected);
      assert.equal(surfaces.promptGeneration, surfaces.expected);
      assert.equal(surfaces.audioNode, surfaces.transparent);
      assert.equal(surfaces.audioCard, surfaces.expected);
    }
    assert.equal(lightNodeBorders.expected, 'rgb(212, 212, 212)');
    assert.equal(darkNodeBorders.expected, 'rgb(64, 64, 64)');
    for (const borders of [lightNodeBorders, darkNodeBorders]) {
      assert.ok(
        borders.actual.every(item => item.borderColor === borders.expected),
        JSON.stringify(borders),
      );
    }
    for (const border of [lightQuickAddBorder, darkQuickAddBorder]) {
      assert.equal(border.actual, border.expected, JSON.stringify(border));
    }
    assert.deepEqual([...new Set(report.cases.map(node => node.kind))].sort(), [...expectedKinds].sort());
    assert.equal(report.cases.length, 27);
    assert.equal(report.labels.length, 10);
    assert.ok(report.labels.every(label => label.text.includes('/') && label.text.includes('·')), JSON.stringify(report.labels));
    assert.ok(report.contracts.every(status => status === 'ready'));
    assert.ok(report.cases.every(node => !/selected|dragging/.test(node.state)), JSON.stringify(report.cases));
    assert.equal(report.cases.find(node => node.id === 'review-image-empty')?.state, 'detail empty');
    assert.match(report.cases.find(node => node.id === 'review-generation-image')?.state || '', /referenceGeneration/);
    assert.match(report.cases.find(node => node.id === 'review-generation-video')?.state || '', /referenceGeneration/);
    assert.equal(report.cases.find(node => node.id === 'review-generation-pending')?.state, 'detail referenceGeneration pending');
    assert.equal(report.cases.find(node => node.id === 'review-prompt-generation-pending')?.state, 'detail pending');
    assert.match(report.cases.find(node => node.id === 'review-generation-failed')?.state || '', /failed/);
    assert.match(report.cases.find(node => node.id === 'review-prompt-generation-failed')?.state || '', /failed/);
    const casesByKind = report.cases.reduce((groups, node) => {
      (groups[node.kind] ||= []).push(node);
      return groups;
    }, {});
    assert.equal(Object.keys(casesByKind).length, 10, JSON.stringify(report.cases));
    assert.equal(casesByKind.image.length, 5, JSON.stringify(casesByKind.image));
    assert.ok(
      Object.entries(casesByKind).every(([kind, cases]) => ['image','generation','prompt-generation'].includes(kind) || cases.length === 2),
      JSON.stringify(report.cases)
    );
    assert.equal(casesByKind.generation.length, 4);
    assert.equal(casesByKind['prompt-generation'].length, 4);
    assert.ok(report.labels.every(label => label.right <= 330), JSON.stringify(report.labels));
    assert.deepEqual(report.failureVisuals.map(({iconSize,...visual}) => visual), [
      {id:'review-generation-failed',title:'生成失败',subtitle:'尺寸不受支持',action:'查看日志',iconBackground:'rgba(0, 0, 0, 0)',iconBorderWidth:'0px',iconContainerWidth:'32px',iconContainerHeight:'32px',iconContainerShadow:'none'},
      {id:'review-prompt-generation-failed',title:'生成失败',subtitle:'生成失败原因',action:'查看日志',iconBackground:'rgba(0, 0, 0, 0)',iconBorderWidth:'0px',iconContainerWidth:'32px',iconContainerHeight:'32px',iconContainerShadow:'none'},
    ]);
    assert.ok(
      report.failureVisuals.every(visual => Math.abs(visual.iconSize - report.generationVisual.iconSize) <= 0.01),
      JSON.stringify(report.failureVisuals),
    );
    assert.equal(report.generationFailureRuntime.hasFailureBody, true, JSON.stringify(report.generationFailureRuntime));
    assert.equal(report.generationFailureRuntime.hint, '', JSON.stringify(report.generationFailureRuntime));
    assert.doesNotMatch(report.generationFailureRuntime.text, /成功\s*0|失败\s*1/, JSON.stringify(report.generationFailureRuntime));
    assert.ok(report.generationFailureRuntime.centerDeltaY <= 1, JSON.stringify(report.generationFailureRuntime));
    assert.deepEqual(videoPlayback, {active:true,playOverlayCount:0,sharedPlayerCount:0});
    assert.equal(report.videoMedia, '/static/images/test/fixture.mp4');
    assert.equal(report.audioMedia, '/static/images/test/fixture.mp4');
    assert.match(report.imageMedia, /\/static\/images\/test\/test\.png/);
    assert.deepEqual(report.promptGenerationUpstreamImage, {
      count:1,
      tag:'ic-reference-thumbnail',
      url:'/static/images/test/fixture.svg',
      imageSrc:'/static/images/test/fixture.svg',
    });
    assert.deepEqual(report.containerStyles, {
      group:{borderRadius:'12px',boxShadow:report.containerStyles.raisedShadow},
      frame:{borderRadius:'12px'},
      raisedShadow:report.containerStyles.raisedShadow,
    });
    assert.deepEqual(report.shellStyle, {
      background:'rgb(255, 255, 255)',
      borderWidth:'1px',
      borderColor:'rgb(212, 212, 212)',
      borderRadius:'12px',
      boxShadow:'rgba(20, 20, 20, 0.08) 0px 1px 2px 0px',
    });
    assert.deepEqual(report.imageShellStyle, {
      padding:'2px',
      background:'rgba(0, 0, 0, 0)',
      borderWidth:'1px',
      borderColor:'rgb(212, 212, 212)',
      borderRadius:'8px',
      boxShadow:'rgba(0, 0, 0, 0.05) 0px 1px 3px 0px',
      imageBorderWidth:'0px',
      imageBorderRadius:'6px',
      contentInset:{top:2,right:2,bottom:2,left:2},
    });
    assert.equal(report.emptyImageBackground, report.surfaceBackground);
    assert.deepEqual(report.nodeMediaPolish, {
      nameBadgeGap:6,
      imageRadius:report.nodeMediaPolish.imageRadius,
      videoRadius:report.nodeMediaPolish.imageRadius,
      nativeVideoRadius:report.nodeMediaPolish.imageRadius,
      nativeVideoControls:true,
      uploadButtonSize:'small',
      uploadButtonHeight:'32px',
      uploadButtonHierarchy:'primary',
      uploadNodeGap:'12px',
    });
    assert.deepEqual(report.nameBadgeStyle.actual, report.nameBadgeStyle.expected, JSON.stringify(report.nameBadgeStyle));
    assert.deepEqual(report.promptScrollbar, {width:'4px',thumbBackground:'rgb(229, 229, 229)',thumbRadius:'0px'});
    assert.equal(report.promptOverflow.plain, true, JSON.stringify(report.promptOverflow));
    assert.equal(report.promptOverflow.generation, true, JSON.stringify(report.promptOverflow));
    assert.ok(Math.abs(report.promptOverflow.plainRightInset) <= 1, JSON.stringify(report.promptOverflow));
    assert.ok(Math.abs(report.promptOverflow.generationRightInset) <= 1, JSON.stringify(report.promptOverflow));
    assert.ok(report.promptGenerationAlignment, JSON.stringify(report.promptGenerationAlignment));
    assert.ok(report.promptGenerationAlignment.leftDelta <= .1, JSON.stringify(report.promptGenerationAlignment));
    assert.equal(report.promptGenerationAlignment.leftPadding, 0, JSON.stringify(report.promptGenerationAlignment));
    assert.equal(report.promptGenerationAlignment.rightPadding, report.promptGenerationAlignment.expectedRightPadding, JSON.stringify(report.promptGenerationAlignment));
    assert.deepEqual(report.generationVisual, {
      icon:'zap',
      iconSize:report.generationVisual.iconSize,
      iconColor:report.generationVisual.expectedIconColor,
      expectedIconColor:report.generationVisual.expectedIconColor,
      title:'生成图片或视频',
      subtitle:'选择节点后在 Composer 里生成图片/视频',
    });
    assert.deepEqual(report.generationResultStyle, {
      kind:'image',
      padding:report.imageShellStyle.padding,
      background:report.imageShellStyle.background,
      borderWidth:report.imageShellStyle.borderWidth,
      borderColor:report.imageShellStyle.borderColor,
      borderRadius:report.imageShellStyle.borderRadius,
      boxShadow:report.imageShellStyle.boxShadow,
      imageBorderWidth:report.imageShellStyle.imageBorderWidth,
      imageBorderRadius:report.imageShellStyle.imageBorderRadius,
    });
    assert.ok(report.hosts.every(host => host.tag === 'ic-canvas-node' && host.body && host.shadowSlot && host.position === 'absolute'));
    assert.equal(report.resizeHandleCount, 22);
    assert.ok(report.resizeHandleStyle.handleSize.width >= 43, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.handleSize.height >= 43, JSON.stringify(report.resizeHandleStyle));
    assert.ok(Math.abs(report.resizeHandleStyle.shapeSize.width - 18) <= 0.2, JSON.stringify(report.resizeHandleStyle));
    assert.ok(Math.abs(report.resizeHandleStyle.shapeSize.height - 18) <= 0.2, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.extendsOutside.right >= 20.9, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.extendsOutside.bottom >= 20.9, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.visibleGap.right >= 3 && report.resizeHandleStyle.visibleGap.right <= 6, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.visibleGap.bottom >= 3 && report.resizeHandleStyle.visibleGap.bottom <= 6, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.start.x < report.resizeHandleStyle.nodeCorner.right, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.start.y > report.resizeHandleStyle.nodeCorner.bottom, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.end.x > report.resizeHandleStyle.nodeCorner.right, JSON.stringify(report.resizeHandleStyle));
    assert.ok(report.resizeHandleStyle.end.y < report.resizeHandleStyle.nodeCorner.bottom, JSON.stringify(report.resizeHandleStyle));
    assert.equal(report.resizeHandleStyle.pathData, 'M1.5 16.5H2A13.5 13.5 0 0 0 16.5 2v-.5');
    assert.equal(report.resizeHandleStyle.fill, 'none');
    assert.equal(report.resizeHandleStyle.stroke, report.resizeHandleStyle.expectedStroke);
    assert.equal(report.resizeHandleStyle.strokeWidth, '2px');
    assert.equal(report.resizeHandleStyle.strokeLinecap, 'round');
    assert.equal(report.resizeHandleStyle.strokeLinejoin, 'round');
    assert.equal(report.quickAddZoneCount, 42);
    assert.ok(sizeAfterResize.width >= sizeBeforeResize.width + 35, JSON.stringify({sizeBeforeResize,sizeAfterResize}));
    assert.ok(sizeAfterResize.height >= sizeBeforeResize.height + 23, JSON.stringify({sizeBeforeResize,sizeAfterResize}));
    assert.match(quickAddMagnetism.classes, /is-active/);
    assert.ok(Math.abs(quickAddMagnetism.followX) > 0.1 || Math.abs(quickAddMagnetism.followY) > 0.1, JSON.stringify(quickAddMagnetism));
    assert.equal(quickAddMenuLocked, true);
    assert.equal(floatingMenu.selected, true);
    assert.equal(floatingMenu.portalOpen, true);
    assert.equal(floatingMenu.count, 1);
    assert.equal(floatingMenu.borderColor, floatingMenu.expected.borderColor);
    assert.equal(floatingMenu.boxShadow, floatingMenu.expected.boxShadow);
    assert.ok(mediaSelection.every(item => item.selected), JSON.stringify(mediaSelection));
    assert.ok(mediaSelection.every(item => item.borderColor === floatingMenu.expected.borderColor), JSON.stringify(mediaSelection));
    assert.ok(mediaSelection.every(item => item.boxShadow === floatingMenu.expected.boxShadow), JSON.stringify(mediaSelection));
    assert.ok(mediaSelection.every(item => item.mediaBoxShadow === 'none'), JSON.stringify(mediaSelection));
    assert.deepEqual(
      mediaSelection.map(({id,mediaWidth,mediaHeight,badgeLeft,badgeTop}) => ({id,mediaWidth,mediaHeight,badgeLeft,badgeTop})),
      mediaGeometryBeforeSelection,
      JSON.stringify({before:mediaGeometryBeforeSelection,after:mediaSelection})
    );
    assert.ok(nodeContentSelection.every(item => item.after.selected), JSON.stringify(nodeContentSelection));
    assert.deepEqual(
      nodeContentSelection.map(item => ({id:item.id,body:item.after.body,content:item.after.content})),
      nodeContentSelection.map(item => ({id:item.id,body:item.before.body,content:item.before.content})),
      JSON.stringify(nodeContentSelection)
    );
    assert.equal(floatingMenu.borderWidth, '1px');
    assert.equal(floatingMenu.selectionBorderWidth, '2px');
    assert.ok(mediaSelection.every(item => item.borderWidth === '1px'), JSON.stringify(mediaSelection));
    assert.ok(mediaSelection.every(item => item.selectionBorderWidth === '2px'), JSON.stringify(mediaSelection));
    assert.ok(nodeContentSelection.every(item => item.after.borderWidth === '1px'), JSON.stringify(nodeContentSelection));
    assert.ok(nodeContentSelection.every(item => item.after.selectionBorderWidth === '2px'), JSON.stringify(nodeContentSelection));
    assert.equal(report.promptGenerationModelOptions, 4);
    assert.equal(report.promptGenerationModelDisabled, false);
    assert.equal(modelSelectOpen, true);
    assert.notEqual(report.lightBackground, darkBackground);
    assert.deepEqual(reviewApiWrites, []);
    assert.deepEqual(errors, []);

    const canvasPage = await browser.newPage({viewport:{width:1440,height:1000}});
    const canvasErrors = [];
    canvasPage.on('console', message => { if (message.type() === 'error') canvasErrors.push(message.text()); });
    canvasPage.on('pageerror', error => canvasErrors.push(error.message));
    await canvasPage.addInitScript(() => {
      class PreviewWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        constructor() {
          this.readyState = PreviewWebSocket.CONNECTING;
          setTimeout(() => { this.readyState = PreviewWebSocket.OPEN; this.onopen?.({}); }, 0);
        }
        send() {}
        close(code = 1000) { this.readyState = PreviewWebSocket.CLOSED; this.onclose?.({code}); }
      }
      window.WebSocket = PreviewWebSocket;
    });
    await canvasPage.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === '/api/canvases/nodes-component-smoke'
        ? canvasPayload()
        : pathname === '/api/config'
          ? {api_providers:[],available_models:{},comfy_instances:[]}
          : pathname === '/api/auth/me'
            ? {user:{id:'node-reviewer',username:'reviewer',role:'admin'}}
            : pathname.endsWith('/view-state')
              ? {view_state:null}
              : pathname === '/api/smart-canvas/prompt-templates'
                ? {templates:[]}
                : pathname === '/api/prompt-libraries'
                  ? {library:{libraries:[]}}
                  : pathname === '/api/workflows'
                    ? {workflows:[]}
                    : {};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await canvasPage.goto(`${origin}/static/smart-canvas.html?id=nodes-component-smoke`, {waitUntil:'domcontentloaded'});
    await canvasPage.waitForFunction(() => (
      document.querySelectorAll('#world > ic-canvas-node').length === 10
      && [...document.querySelectorAll('#world > ic-canvas-node')]
        .every(node => node.dataset.icContractStatus === 'ready')
    ));
    const canvasReport = await canvasPage.locator('#world').evaluate(world => ({
      kinds:[...world.querySelectorAll(':scope > ic-canvas-node')].map(node => node.getAttribute('kind')),
      allDirectNodesAreComponents:[...world.querySelectorAll(':scope > .image-node')]
        .every(node => node.localName === 'ic-canvas-node'),
      allBodiesRemainQueryable:[...world.querySelectorAll(':scope > ic-canvas-node')]
        .every(node => Boolean(node.querySelector(':scope > .node-body'))),
      absolute:[...world.querySelectorAll(':scope > ic-canvas-node')]
        .every(node => getComputedStyle(node).position === 'absolute'),
      quickAddZoneCount:world.querySelectorAll(':scope > ic-canvas-node > .smart-node-quick-add-zone').length,
      publicFamilyKinds:window.InfiniteCanvasUiNodeComponents?.kinds || [],
    }));
    if (screenshot) await canvasPage.screenshot({path:screenshot.replace(/\.png$/, '-canvas.png'),fullPage:false});
    assert.deepEqual(canvasReport.kinds, [
      'frame', 'smart-group', 'image', 'generation', 'prompt', 'prompt-generation',
      'splitter', 'loop', 'text-annotation', 'brush-stroke',
    ]);
    assert.equal(canvasReport.allDirectNodesAreComponents, true);
    assert.equal(canvasReport.allBodiesRemainQueryable, true);
    assert.equal(canvasReport.absolute, true);
    assert.equal(canvasReport.quickAddZoneCount, 14);
    assert.deepEqual(canvasReport.publicFamilyKinds, expectedKinds);
    assert.deepEqual(canvasErrors, []);
    console.log(JSON.stringify({...report,nodeContextMenuRadius,hoverShadowContract,lightNodeSurfaces,darkNodeSurfaces,lightNodeBorders,darkNodeBorders,lightQuickAddBorder,darkQuickAddBorder,darkBackground,canvasReport,errors,canvasErrors}));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
