const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json' }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'Chrome debugger timeout')), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (!operation) return;
    pending.delete(payload.id);
    if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
    else operation.resolve(payload.result);
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for Mention Picker browser contract');
}

async function dispatchMouse(cdp, sessionId, type, point, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    ...extra,
  }, sessionId);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-mention-picker-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/infinite_canvas_ui_mention_picker_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "['passed','failed'].includes(document.documentElement.dataset.icMentionPickerTestStatus)");
    const status = await evaluate(cdp, sessionId, 'document.documentElement.dataset.icMentionPickerTestStatus');
    const report = JSON.parse(await evaluate(cdp, sessionId, "document.querySelector('#results').textContent"));
    if (status !== 'passed') throw new Error(`Mention Picker browser contract failed: ${JSON.stringify(report)}`);
    const pointerPoint = await evaluate(cdp, sessionId, `(()=>{
      const option=document.querySelector('#picker').shadowRoot.querySelectorAll('[part="option"]')[5];
      const rect=option.getBoundingClientRect();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    })()`);
    await evaluate(cdp, sessionId, `(()=>{
      const picker=document.querySelector('#picker');
      picker.setActiveIndex(0);
      picker.shadowRoot.querySelector('[part="listbox"]').scrollTop=0;
      window.__icMentionPickerBrowserState.selected=null;
      window.__icMentionPickerBrowserState.bubbledWheel=0;
    })()`);
    await dispatchMouse(cdp, sessionId, 'mouseMoved', pointerPoint);
    const hoverIndex = await evaluate(cdp, sessionId, "document.querySelector('#picker').activeIndex");
    await dispatchMouse(cdp, sessionId, 'mousePressed', pointerPoint, { button: 'left', clickCount: 1 });
    await dispatchMouse(cdp, sessionId, 'mouseReleased', pointerPoint, { button: 'left', clickCount: 1 });
    const pointerSelection = await evaluate(cdp, sessionId, 'window.__icMentionPickerBrowserState.selected?.index ?? -1');
    await dispatchMouse(cdp, sessionId, 'mouseWheel', pointerPoint, { deltaX: 0, deltaY: 180 });
    await delay(100);
    const wheelState = await evaluate(cdp, sessionId, `(()=>({
      listboxScrollTop:document.querySelector('#picker').shadowRoot.querySelector('[part="listbox"]').scrollTop,
      bubbledWheel:window.__icMentionPickerBrowserState.bubbledWheel,
    }))()`);
    if (hoverIndex !== 5 || pointerSelection !== 5 || wheelState.listboxScrollTop <= 0 || wheelState.bubbledWheel !== 0) {
      throw new Error(`Mention Picker pointer ownership failed: ${JSON.stringify({ hoverIndex, pointerSelection, wheelState })}`);
    }
    await dispatchMouse(cdp, sessionId, 'mouseWheel', pointerPoint, { deltaX: 0, deltaY: -360 });
    await delay(100);
    const reverseWheelScrollTop = await evaluate(cdp, sessionId, "document.querySelector('#picker').shadowRoot.querySelector('[part=\"listbox\"]').scrollTop");
    if (reverseWheelScrollTop !== 0) {
      throw new Error(`Mention Picker reverse wheel failed: ${JSON.stringify({ reverseWheelScrollTop })}`);
    }
    const shortListHeight = await evaluate(cdp, sessionId, `(async()=>{
      const picker=document.querySelector('#picker');
      picker.items=picker.items.slice(0,3);
      picker.show(document.querySelector('#trigger'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return picker.shadowRoot.querySelector('[part="surface"]').getBoundingClientRect().height;
    })()`);
    if (Math.abs(shortListHeight - 288) > 1) {
      throw new Error(`Mention Picker fixed height failed: ${JSON.stringify({ shortListHeight })}`);
    }
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/static/design-system/infinite-canvas-ui/menu-popover-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.menuPopoverCaseStatus === 'ready'");
    const groupedLayout = await evaluate(cdp, sessionId, `(async()=>{
      document.documentElement.dataset.uiLibraryLayout='compact';
      const stylesheet=document.createElement('link');
      stylesheet.rel='stylesheet';
      stylesheet.href='/static/css/ui-component-library-preview.css';
      document.head.append(stylesheet);
      await new Promise((resolve,reject)=>{stylesheet.onload=resolve;stylesheet.onerror=reject;});
      const script=document.createElement('script');
      script.src='/static/js/ui-component-library/matrix-presentation.js';
      document.head.append(script);
      await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;});
      const summary=window.InfiniteCanvasUiMatrixPresentation.apply(document,'matrix');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const tables=[...document.querySelectorAll('.ui-library-state-matrix')];
      const columnCounts=tables.map(table=>Math.max(0,table.querySelectorAll('thead th').length-1));
      const headerHeights=tables.flatMap(table=>[...table.querySelectorAll('thead th')].map(cell=>cell.getBoundingClientRect().height));
      const rowHeights=tables.map(table=>table.querySelector('tbody tr')?.getBoundingClientRect().height||0);
      const bodyBackground=getComputedStyle(document.body).backgroundColor;
      const initiallyOpenOverlays=document.querySelectorAll('ic-menu[open],ic-popover[open],ic-confirm-popover[open],ic-mention-picker[open]').length;
      const mentionTrigger=document.querySelector('#mention-trigger');
      const mentionPicker=document.querySelector('#mention-picker');
      mentionTrigger.scrollIntoView({block:'center',inline:'nearest'});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const mentionReady=new Promise(resolve=>mentionPicker.addEventListener('ic-after-show',resolve,{once:true}));
      mentionTrigger.click();
      await mentionReady;
      const mentionSurface=mentionPicker.shadowRoot.querySelector('[part="surface"]');
      const mentionListbox=mentionPicker.shadowRoot.querySelector('[part="listbox"]');
      const mentionListboxStyle=getComputedStyle(mentionListbox);
      const paddingProbe=document.createElement('div');
      paddingProbe.style.padding='var(--ui-space-1) var(--ui-space-2) var(--ui-space-2)';
      document.body.append(paddingProbe);
      const paddingProbeStyle=getComputedStyle(paddingProbe);
      const mentionPickerContractPadding=mentionListboxStyle.paddingTop===paddingProbeStyle.paddingTop
        && mentionListboxStyle.paddingRight===paddingProbeStyle.paddingRight
        && mentionListboxStyle.paddingBottom===paddingProbeStyle.paddingBottom
        && mentionListboxStyle.paddingLeft===paddingProbeStyle.paddingLeft;
      paddingProbe.remove();
      const mentionSurfaceRect=mentionSurface.getBoundingClientRect();
      const mentionAnchorRect=mentionTrigger.closest('.mention-picker-case').getBoundingClientRect();
      const shadowProbe=document.createElement('div');
      shadowProbe.style.boxShadow='var(--ui-shadow-raised)';
      document.body.append(shadowProbe);
      const mentionPickerUsesRaisedShadow=getComputedStyle(mentionSurface).boxShadow===getComputedStyle(shadowProbe).boxShadow;
      shadowProbe.remove();
      const mentionPickerStartsBelow=mentionSurfaceRect.top>=mentionAnchorRect.bottom;
      const mentionPickerFullyVisible=mentionSurfaceRect.top>=0&&mentionSurfaceRect.bottom<=innerHeight;
      mentionPicker.hide('test');
      const mediaTrigger=document.querySelector('#mention-media-trigger');
      const mediaPicker=document.querySelector('#mention-media-picker');
      mediaTrigger.scrollIntoView({block:'center',inline:'nearest'});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const mediaReady=new Promise(resolve=>mediaPicker.addEventListener('ic-after-show',resolve,{once:true}));
      mediaTrigger.click();
      await mediaReady;
      const mediaSurface=mediaPicker.shadowRoot.querySelector('[part="surface"]');
      const mediaListbox=mediaPicker.shadowRoot.querySelector('[part="listbox"]');
      const sourceTabs=mediaPicker.shadowRoot.querySelector('[data-source-tabs]');
      const mediaTabs=[...sourceTabs.querySelectorAll('[data-tab]')];
      const mediaOptions=[...mediaPicker.shadowRoot.querySelectorAll('[part="option"]')];
      const mediaRect=mediaSurface.getBoundingClientRect();
      const mediaAnchorRect=mediaTrigger.closest('.mention-picker-media-case').getBoundingClientRect();
      const tabsRect=mediaPicker.shadowRoot.querySelector('[part="tabs"]').getBoundingClientRect();
      const sourceTabsRect=sourceTabs.getBoundingClientRect();
      const leadingMediaOption=mediaOptions.find(option=>option.querySelector('.media-badge'));
      const regularMediaOption=mediaOptions.find(option=>!option.querySelector('.media-badge'));
      const defaultBorderColor=getComputedStyle(regularMediaOption).borderColor;
      const selectedOptionStyle=getComputedStyle(leadingMediaOption);
      const selectedBorderColor=selectedOptionStyle.borderColor;
      const selectedBorderRadius=selectedOptionStyle.borderRadius;
      const selectedBoxShadow=selectedOptionStyle.boxShadow;
      const regularOptionRadius=getComputedStyle(regularMediaOption).borderRadius;
      const mediaImage=regularMediaOption.querySelector('.media img');
      const mediaImageRadius=getComputedStyle(mediaImage).borderRadius;
      const leadingImage=leadingMediaOption.querySelector('.media img');
      const leadingImageStyle=getComputedStyle(leadingImage);
      const leadingImageObjectFit=leadingImageStyle.objectFit;
      const leadingBadge=leadingMediaOption.querySelector('.media-badge');
      const leadingBadgeStyle=getComputedStyle(leadingBadge);
      const leadingBadgeBackground=leadingBadgeStyle.backgroundColor;
      const leadingRect=leadingMediaOption.getBoundingClientRect();
      const leadingBadgeRect=leadingBadge.getBoundingClientRect();
      const mediaCopyBackground=getComputedStyle(leadingMediaOption.querySelector('.media-copy')).backgroundImage;
      const mediaNameStyle=getComputedStyle(leadingMediaOption.querySelector('.media-copy .name'));
      const mediaNameColor=mediaNameStyle.color;
      const mediaNameFontSize=mediaNameStyle.fontSize;
      const mediaNameFontWeight=mediaNameStyle.fontWeight;
      const leadingMediaOptionWidth=mediaOptions[0].getBoundingClientRect().width;
      const mediaOptionWidth=mediaOptions.find(option=>!option.querySelector('.media-badge'))
        ?.getBoundingClientRect().width||0;
      const tokenProbe=document.createElement('div');
      tokenProbe.style.border='1px solid var(--ui-color-border-secondary)';
      tokenProbe.style.borderRadius='var(--ui-radius-xs)';
      tokenProbe.style.boxShadow='var(--ui-shadow-raised)';
      tokenProbe.style.backgroundColor='var(--ui-color-surface-canvas)';
      tokenProbe.style.color='var(--ui-color-text-white)';
      tokenProbe.style.fontSize='var(--ui-font-size-1)';
      tokenProbe.style.fontWeight='var(--ui-font-weight-regular)';
      document.body.append(tokenProbe);
      const tokenProbeStyle=getComputedStyle(tokenProbe);
      const expectedBorderSecondary=tokenProbeStyle.borderColor;
      const expectedRadius=tokenProbeStyle.borderRadius;
      const expectedRaisedShadow=tokenProbeStyle.boxShadow;
      const expectedBadgeBackground=tokenProbeStyle.backgroundColor;
      const expectedMediaNameColor=tokenProbeStyle.color;
      const expectedMediaNameFontSize=tokenProbeStyle.fontSize;
      const expectedMediaNameFontWeight=tokenProbeStyle.fontWeight;
      tokenProbe.style.borderColor='var(--ui-color-border-focus)';
      const expectedBorderFocus=getComputedStyle(tokenProbe).borderColor;
      tokenProbe.style.borderColor='var(--ui-color-border-secondary)';
      tokenProbe.style.borderRadius='var(--ui-radius-s)';
      tokenProbe.style.boxShadow='var(--ui-shadow-none)';
      const expectedLeadingStyle=getComputedStyle(tokenProbe);
      const expectedLeadingBorder=expectedLeadingStyle.borderColor;
      const expectedLeadingRadius=expectedLeadingStyle.borderRadius;
      const expectedLeadingShadow=expectedLeadingStyle.boxShadow;
      tokenProbe.remove();
      const canvasKinds=mediaOptions.map(option=>option.querySelector('.media')?.dataset.kind).filter(Boolean);
      mediaPicker.shadowRoot.querySelector('[data-tab="assets"]').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const assetOptions=mediaPicker.shadowRoot.querySelectorAll('[part="option"]');
      const mediaModeDetails={
        mediaMode:mediaPicker.mediaMode,
        masonry:mediaListbox.classList.contains('media-grid'),
        segmentedSmall:sourceTabs.localName==='ic-segmented-control'&&sourceTabs.getAttribute('size')==='small',
        tabsLeftAligned:Math.abs(sourceTabsRect.left-(tabsRect.left+8))<=1,
        tabsIntrinsicWidth:sourceTabsRect.width<tabsRect.width-16,
        tabs:mediaTabs.map(tab=>tab.textContent.trim()).join('|')==='当前画布|资产库',
        imageWidth150:mediaOptionWidth>=88,
        leadingImageCompactWidth:Math.abs(leadingMediaOptionWidth-65)<=1,
        defaultBorder:defaultBorderColor===expectedBorderSecondary,
        selectedBorder:selectedBorderColor===expectedLeadingBorder,
        sharedRadius:regularOptionRadius===expectedRadius&&mediaImageRadius===expectedRadius,
        raisedState:expectedRaisedShadow!=='none',
        leadingReferenceThumbnailStyle:selectedBorderRadius===expectedLeadingRadius
          && selectedBoxShadow===expectedLeadingShadow
          && Math.abs(leadingRect.width-leadingRect.height)<=1
          && leadingImageObjectFit==='cover'
          && Math.abs(leadingBadgeRect.left-leadingRect.left)<=1
          && Math.abs(leadingBadgeRect.right-leadingRect.right)<=1
          && Math.abs(leadingBadgeRect.bottom-leadingRect.bottom)<=1
          && Math.abs(leadingBadgeRect.height-14)<=1
          && leadingBadgeBackground===expectedBadgeBackground,
        hoverMask:mediaCopyBackground!=='none'&&mediaCopyBackground.includes('linear-gradient'),
        hoverText:mediaNameColor===expectedMediaNameColor&&mediaNameFontSize===expectedMediaNameFontSize&&mediaNameFontWeight===expectedMediaNameFontWeight,
        canvasItems:mediaOptions.length===5,
        image:canvasKinds.includes('image'),
        video:canvasKinds.includes('video'),
        audio:canvasKinds.includes('audio'),
        assetTab:mediaPicker.activeTab==='assets',
        assetItems:assetOptions.length===3,
        assetImages:[...assetOptions].every(option=>option.querySelector('.media')?.dataset.kind==='image'),
        anchorWidth:Math.abs(mediaRect.width-mediaAnchorRect.width)<=1,
        fittedHeight:mediaRect.height>0&&mediaRect.height<=289,
      };
      const mediaModeCatalogued=Object.values(mediaModeDetails).every(Boolean);
      mediaPicker.hide('test');
      return {
        groups:document.querySelectorAll('.menu-popover-family-section').length,
        matrices:summary.matrices,
        maxColumns:Math.max(0,...columnCounts),
        maxHeaderHeight:Math.max(0,...headerHeights),
        maxRowHeight:Math.max(0,...rowHeights),
        initiallyOpenOverlays,
        mentionPickerStartsBelow,
        mentionPickerFullyVisible,
        mentionPickerUsesRaisedShadow,
        mentionPickerContractPadding,
        mediaModeCatalogued,
        mediaModeDetails,
        whiteBackground:bodyBackground==='rgb(255, 255, 255)',
        directLegalSections:document.querySelectorAll('body > main > section[data-legal-combination]').length,
        visibleInnerHeadings:[...document.querySelectorAll('.menu-popover-example > h2')].filter(node=>getComputedStyle(node).display!=='none').length,
        visibleDescriptions:[...document.querySelectorAll('.menu-popover-example > p')].filter(node=>getComputedStyle(node).display!=='none').length,
        unifiedMatrixBackground:tables.every(table=>getComputedStyle(table).backgroundColor===bodyBackground),
      };
    })()`);
    if (groupedLayout.groups !== 12 || groupedLayout.matrices !== 11 || groupedLayout.maxColumns > 2 || groupedLayout.maxHeaderHeight > 80 || groupedLayout.maxRowHeight > 120 || groupedLayout.initiallyOpenOverlays !== 1 || !groupedLayout.mentionPickerStartsBelow || !groupedLayout.mentionPickerFullyVisible || !groupedLayout.mentionPickerUsesRaisedShadow || !groupedLayout.mentionPickerContractPadding || !groupedLayout.mediaModeCatalogued || !groupedLayout.whiteBackground || groupedLayout.directLegalSections !== 0 || groupedLayout.visibleInnerHeadings !== 0 || groupedLayout.visibleDescriptions !== 0 || !groupedLayout.unifiedMatrixBackground) {
      throw new Error(`Menu/Popover grouped layout failed: ${JSON.stringify(groupedLayout)}`);
    }
    process.stdout.write(`${JSON.stringify({ ...report, pointerOwnership: { hoverIndex, pointerSelection, wheelState, reverseWheelScrollTop }, shortListHeight, groupedLayout }, null, 2)}\n`);
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
