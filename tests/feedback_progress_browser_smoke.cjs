const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server)); });
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
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (operation) { pending.delete(payload.id); payload.error ? operation.reject(new Error(JSON.stringify(payload.error))) : operation.resolve(payload.result); }
    else if (payload.method) events.push(payload);
  });
  return { events, send(method, params = {}, sessionId) { const id = ++nextId; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); } };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(cdp, sessionId, expression)) return; await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-feedback-progress-browser-'));
  const browser = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let report;
  try {
    const cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Log.enable', {}, sessionId); await cdp.send('Accessibility.enable', {}, sessionId);
    const port = server.address().port;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/infinite_canvas_ui_feedback_progress_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "['passed','failed'].includes(document.documentElement?.dataset.icFeedbackProgressTestStatus)", 'Feedback/Progress harness');
    report = JSON.parse(await evaluate(cdp, sessionId, "document.querySelector('#ic-results').textContent"));
    if (!report.checks?.toastQueue) {
      throw new Error(`Toast stack regression: ${JSON.stringify(report.observations?.beforeQueue || {})}`);
    }
    const tree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    report.accessibility = tree.nodes.filter(node => !node.ignored && ['alert','status','progressbar','region'].includes(node.role?.value)).map(node => ({ role: node.role.value, name: node.name?.value || '' }));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/design-system/infinite-canvas-ui/feedback-progress.html` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.feedbackProgressMatrixStatus === 'ready'", 'six Feedback/Progress matrix cases', 60000);
    await waitFor(cdp, sessionId, `(() => [...document.querySelectorAll('[data-feedback-progress-case]')]
      .flatMap(card=>[...card.querySelector('iframe').contentDocument.querySelectorAll('ic-generation-pending')])
      .map(element=>element.shadowRoot?.querySelector('canvas.generation-pending-halftone'))
      .every(canvas=>canvas?.width>0&&canvas?.height>0&&canvas.dataset.halftoneBackground))()`, 'pending halftones to paint');
    report.matrix = await evaluate(cdp, sessionId, `(async () => {
      const cards=[...document.querySelectorAll('[data-feedback-progress-case]')];
      const docs=cards.map(card=>card.querySelector('iframe').contentDocument);
      return {
        cases:cards.length,
        themes:[...new Set(cards.map(x=>x.dataset.theme))].sort(),
        viewports:[...new Set(cards.map(x=>x.dataset.viewport))].sort(),
        locales:[...new Set(cards.map(x=>x.dataset.locale))].sort(),
        motions:[...new Set(cards.map(x=>x.dataset.motion))].sort(),
        ready:docs.every(doc=>doc.documentElement.dataset.feedbackProgressCaseStatus==='ready'),
        legalCounts:docs.map(doc=>doc.querySelectorAll('[data-legal-combination]').length),
        loadingBadges:docs.map(doc=>{const badge=doc.querySelector('[data-component-name="ic-badge-status-processing"]');const spinner=badge?.shadowRoot?.querySelector('.spinner');const style=spinner&&getComputedStyle(spinner);const reduced=doc.documentElement.dataset.uiMotion==='reduced';return Boolean(badge?.dataset.icContractStatus==='ready'&&badge?.getAttribute('role')==='status'&&spinner&&style.display!=='none'&&(reduced?style.animationName==='none':style.animationDuration==='1.2s'));}),
        processingSpinners:docs.map(doc=>{const badgeSpinner=doc.querySelector('[data-component-name="ic-badge-status-processing"]')?.shadowRoot?.querySelector('.spinner');const badgeStyle=badgeSpinner&&getComputedStyle(badgeSpinner);const reduced=doc.documentElement.dataset.uiMotion==='reduced';return Boolean(badgeStyle&&badgeStyle.borderInlineEndColor==='rgba(0, 0, 0, 0)'&&(reduced?badgeStyle.animationName==='none':badgeStyle.animationName==='ic-badge-spin'&&badgeStyle.animationDuration==='1.2s'));}),
        badgeSizes:docs.map(doc=>['small','medium','large'].map(size=>{const badge=doc.querySelector('[data-component-name="ic-badge-label'+(size==='medium'?'':'-'+size)+'"]');const surface=badge?.shadowRoot?.querySelector('.badge');return {size,ready:badge?.dataset.icContractStatus==='ready',height:surface?Math.round(surface.getBoundingClientRect().height):0,fontSize:surface?getComputedStyle(surface).fontSize:''};})),
        badgeStatuses:docs.map(doc=>{const section=doc.querySelector('[data-copy="badge-statuses"]')?.closest('section');const badges=[...(section?.querySelectorAll('ic-badge')||[])];return {count:badges.length,names:badges.map(badge=>badge.dataset.componentName),tones:badges.map(badge=>badge.getAttribute('tone')),idleAbsent:![...doc.querySelectorAll('ic-badge')].some(badge=>['空闲','Idle'].includes(badge.textContent.trim()))};}),
        actionAlerts:docs.map(doc=>{const alert=doc.querySelector('[data-alert-queue-stage] ic-alert[action-label]');const heading=alert?.shadowRoot?.querySelector('.heading');const message=alert?.shadowRoot?.querySelector('.message');const symbol=alert?.shadowRoot?.querySelector('.symbol ic-icon');const action=alert?.shadowRoot?.querySelector('.action');const dismiss=alert?.shadowRoot?.querySelector('.dismiss');const headingRect=heading?.getBoundingClientRect();const symbolRect=symbol?.getBoundingClientRect();return {ready:alert?.dataset.icContractStatus==='ready',componentName:alert?.dataset.componentName,hasLegacyVariant:alert?.hasAttribute('variant'),headingSize:heading?getComputedStyle(heading).fontSize:'',headingWeight:heading?getComputedStyle(heading).fontWeight:'',messageSize:message?getComputedStyle(message).fontSize:'',messageFont:message?getComputedStyle(message).font:'',radius:alert?getComputedStyle(alert.shadowRoot.querySelector('.alert')).borderRadius:'',headingText:heading?.textContent||'',messageText:alert?.textContent.trim()||'',symbolName:symbol?.getAttribute('name')||'',symbolStroke:symbol?.shadowRoot?.querySelector('svg')?getComputedStyle(symbol.shadowRoot.querySelector('svg')).strokeWidth:'',symbolTitleOffset:headingRect&&symbolRect?Math.abs((headingRect.top+headingRect.height/2)-(symbolRect.top+symbolRect.height/2)):999,actionKind:action?.localName||'',actionVariant:action?.dataset.componentName||'',actionHierarchy:action?.getAttribute('hierarchy')||'',actionSize:action?.getAttribute('size')||'',actionReady:action?.dataset.icContractStatus==='ready',dismissKind:dismiss?.localName||'',dismissVariant:dismiss?.dataset.componentName||'',dismissReady:dismiss?.dataset.icContractStatus==='ready',dismissHeight:dismiss?.getBoundingClientRect().height||0,titleHeight:headingRect?.height||0};}),
        alertInlineTitles:docs.map(doc=>{const title=doc.querySelector('[data-alert-queue-stage] ic-alert')?.shadowRoot?.querySelector('.heading');return {size:title?getComputedStyle(title).fontSize:'',weight:title?getComputedStyle(title).fontWeight:''};}),
        alertSizing:docs.map(doc=>[doc.querySelector('[data-alert-queue-stage] ic-alert'),doc.querySelector('[data-alert-queue-stage] ic-alert[action-label]')].map(alert=>{const message=alert.shadowRoot.querySelector('.message');const style=getComputedStyle(message);return {width:alert.getBoundingClientRect().width,maxWidth:getComputedStyle(alert).maxWidth,lineClamp:style.webkitLineClamp,overflow:style.overflow,height:message.getBoundingClientRect().height,lineHeight:parseFloat(style.lineHeight)};})),
        dismissibleAlerts:docs.map(doc=>[doc.querySelector('[data-alert-queue-stage] ic-alert'),doc.querySelector('[data-alert-queue-stage] ic-alert[action-label]')].map(alert=>{const surface=alert.shadowRoot.querySelector('.alert');const dismiss=alert.shadowRoot.querySelector('.dismiss');const button=dismiss.shadowRoot.querySelector('[part~="base"]');const icon=dismiss.querySelector('ic-icon');const surfaceRect=surface.getBoundingClientRect();const dismissRect=dismiss.getBoundingClientRect();const buttonRect=button.getBoundingClientRect();const iconRect=icon.getBoundingClientRect();const surfaceStyle=getComputedStyle(surface);return {hostCenterOffset:Math.abs((dismissRect.top+dismissRect.height/2)-(surfaceRect.top+surfaceRect.height/2)),iconXOffset:Math.abs((iconRect.left+iconRect.width/2)-(dismissRect.left+dismissRect.width/2)),iconYOffset:Math.abs((iconRect.top+iconRect.height/2)-(dismissRect.top+dismissRect.height/2)),hostWidth:dismissRect.width,buttonWidth:buttonRect.width,rightInset:surfaceRect.right-dismissRect.right,expectedRightInset:parseFloat(surfaceStyle.paddingInlineEnd)+parseFloat(surfaceStyle.borderInlineEndWidth)};})),
        alertQueues:await Promise.all(docs.map(async doc=>{
          const stage=doc.querySelector('[data-alert-queue-stage]');
          const buttons=[...doc.querySelectorAll('[data-alert-trigger]')];
          const triggerTones=buttons.map(button=>button.dataset.alertTrigger);
          const initial=stage.querySelector('ic-alert');
          const initialTone=initial?.getAttribute('tone')||'';
          buttons.forEach(button=>button.click());
          const enteringAlert=stage.querySelector('ic-alert');
          const enteringStyle=getComputedStyle(enteringAlert);
          const entryStarts=enteringAlert.getAttribute('data-ic-stack-state')==='entering'
            && Number(enteringStyle.opacity)===0
            && enteringStyle.transform!=='none';
          await new Promise(resolve=>setTimeout(resolve,450));
          const entrySettles=enteringAlert.getAttribute('data-ic-stack-state')==='active'
            && Number(getComputedStyle(enteringAlert).opacity)===1;
          const transitionDuration=getComputedStyle(enteringAlert).transitionDuration;
          const transitionTiming=getComputedStyle(enteringAlert).transitionTimingFunction;
          const motionDirection=enteringAlert.style.getPropertyValue('--ic-stack-motion-offset');
          const queuedAfterClicks=Number(stage.dataset.queueLength);
          const stackedAlerts=[...stage.querySelectorAll('ic-alert')];
          const visibleLayers=stackedAlerts.filter(alert=>!alert.hasAttribute('data-ic-stack-hidden'));
          const layerRects=visibleLayers.map(alert=>alert.getBoundingClientRect());
          const stacked=stackedAlerts.length===8
            && stage.dataset.visibleCount==='3'
            && visibleLayers.length===3
            && visibleLayers.map(alert=>alert.dataset.icStackIndex).join(',')==='0,1,2'
            && layerRects[0].top<layerRects[1].top&&layerRects[1].top<layerRects[2].top
            && Math.abs(layerRects[1].top-layerRects[0].top-19)<=1
            && Math.abs(layerRects[2].top-layerRects[1].top-19)<=1
            && layerRects[0].width>layerRects[1].width&&layerRects[1].width>layerRects[2].width
            && getComputedStyle(visibleLayers[0]).pointerEvents!=='none'
            && visibleLayers.slice(1).every(alert=>getComputedStyle(alert).pointerEvents==='none')
            && stackedAlerts.slice(3).every(alert=>alert.hasAttribute('data-ic-stack-hidden'));
          const sequence=[];
          const icons=[];
          const positions=[];
          const counts=[];
          const clamps=[];
          const exitFlags=[];
          for(let index=0;index<stackedAlerts.length;index+=1){
            const current=stage.querySelector('ic-alert');
            const rect=current?.getBoundingClientRect();
            sequence.push(current?.getAttribute('tone')||'');
            icons.push(current?.shadowRoot?.querySelector('.symbol ic-icon')?.getAttribute('name')||'');
            positions.push(rect?{left:Math.round(rect.left),top:Math.round(rect.top)}:null);
            counts.push(Number(stage.dataset.queueLength));
            const message=current?.shadowRoot?.querySelector('.message');
            const messageStyle=message?getComputedStyle(message):null;
            clamps.push(Boolean(message&&messageStyle?.webkitLineClamp==='2'&&messageStyle.overflow==='hidden'&&message.getBoundingClientRect().height<=parseFloat(messageStyle.lineHeight)*2+1));
            current?.shadowRoot?.querySelector('.dismiss')?.click();
            exitFlags.push(Boolean(current?.getAttribute('data-ic-stack-state')==='exiting'&&!current.hidden&&current.isConnected));
            await new Promise(resolve=>setTimeout(resolve,450));
          }
          return {motion:doc.documentElement.dataset.uiMotion,motionDirection,initialTone,triggerTones,queuedAfterClicks,stacked,entryStarts,entrySettles,transitionDuration,transitionTiming,sequence,icons,positions,counts,clamps,exitFlags,empty:stage.querySelectorAll('ic-alert').length===0&&stage.dataset.activeTone===''&&stage.dataset.queueLength==='0'&&stage.dataset.visibleCount==='0'};
        })),
        generationPending:docs.map(doc=>{
          const image=doc.querySelector('#generation-pending-image');
          const video=doc.querySelector('#generation-pending-video');
          const text=doc.querySelector('#generation-pending-text');
          const base=element=>element?.shadowRoot?.querySelector('.pending');
          const elements=[image,video,text];
          elements.forEach((element,index)=>element.setAttribute('elapsed',String(index+6)+'s'));
          const canvases=elements.map(element=>element.shadowRoot.querySelector('canvas.generation-pending-halftone'));
          const videoCanvas=canvases[1];
          video.setAttribute('state','generating');
          video.setAttribute('label','Generating video');
          video.setAttribute('count','2');
          const canvasContinuous=video.shadowRoot.querySelector('canvas.generation-pending-halftone')===videoCanvas
            && video.shadowRoot.querySelector('ic-badge.generation-pending-badge')?.textContent.trim()==='7s Generating video'
            && video.shadowRoot.querySelectorAll('[part="cell"]').length===2;
          video.setAttribute('state','queued');
          video.setAttribute('label',doc.documentElement.lang==='en'?'Video waiting for generation':'视频等待生成');
          video.setAttribute('count','1');
          const reduced=doc.documentElement.dataset.uiMotion==='reduced';
          return {
            ready:elements.every(element=>element?.dataset.icContractStatus==='ready'&&element.getAttribute('role')==='status'&&element.getAttribute('aria-busy')==='true'),
            kinds:[base(image)?.dataset.kind,base(video)?.dataset.kind,base(text)?.dataset.kind],
            states:[base(image)?.dataset.state,base(video)?.dataset.state,base(text)?.dataset.state],
            imageCells:image?.shadowRoot?.querySelectorAll('[part="cell"]').length,
            videoCells:video?.shadowRoot?.querySelectorAll('[part="cell"]').length,
            textCells:text?.shadowRoot?.querySelectorAll('[part="cell"]').length,
            canvasesReady:canvases.every(canvas=>canvas&&canvas.width>0&&canvas.height>0&&['running','paused','static'].includes(canvas.dataset.motionState)),
            halftoneColorsReady:canvases.every((canvas,index)=>canvas.dataset.halftoneBackground===doc.defaultView.getComputedStyle(base(elements[index])).backgroundColor&&canvas.dataset.halftoneDot===doc.defaultView.getComputedStyle(canvas).color),
            motionReady:canvases.every(canvas=>reduced?canvas.dataset.motionState==='static':['running','paused'].includes(canvas.dataset.motionState)),
            canvasContinuous,
            badges:elements.map(element=>{
              const badge=element.shadowRoot.querySelector('ic-badge.generation-pending-badge');
              const pending=base(element);
              const badgeRect=badge?.getBoundingClientRect();
              const pendingRect=pending?.getBoundingClientRect();
              return {
                ready:badge?.dataset.icContractStatus==='ready',
                loading:badge?.hasAttribute('loading'),
                text:badge?.textContent.trim()||'',
                outside:Boolean(badgeRect&&pendingRect&&badgeRect.bottom<=pendingRect.top+1),
                labelAbsent:!element.shadowRoot.querySelector('.status'),
              };
            }),
            halftoneCanvasLayers:elements.reduce((total,element)=>total+element.shadowRoot.querySelectorAll('canvas.generation-pending-halftone').length,0),
            obsoleteAnimationLayers:elements.reduce((total,element)=>total+element.shadowRoot.querySelectorAll('video,img,ic-skeleton,.media-glow,.kind-icon,.generation-pending-loader-visual').length,0),
            imageDecodeLayers:elements.reduce((total,element)=>total+element.shadowRoot.querySelectorAll('img').length,0),
            visible:elements.every(element=>element?.getBoundingClientRect().width>0&&element?.getBoundingClientRect().height>0),
          };
        }),
        generationRecovery:docs.map(doc=>{
          const image=doc.querySelector('#generation-recovery-image');
          const video=doc.querySelector('#generation-recovery-video');
          const text=doc.querySelector('#generation-recovery-text');
          const base=element=>element?.shadowRoot?.querySelector('.recovery');
          const textAction=text?.shadowRoot?.querySelector('ic-button.action');
          return {
            ready:[image,video,text].every(element=>element?.dataset.icContractStatus==='ready'&&element.getAttribute('role')==='status'),
            kinds:[base(image)?.dataset.kind,base(video)?.dataset.kind,base(text)?.dataset.kind],
            states:[base(image)?.dataset.state,base(video)?.dataset.state,base(text)?.dataset.state],
            queryingDisabled:Boolean(textAction?.disabled&&textAction?.loading),
            visible:[image,video,text].every(element=>element?.getBoundingClientRect().width>0&&element?.getBoundingClientRect().height>0),
          };
        }),
        toastTriggers:await Promise.all(docs.map(async doc=>{
          const results=[];
          for(const button of doc.querySelectorAll('[data-toast-trigger]')){
            button.click();
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const overlays=[...doc.querySelectorAll('ic-toast[data-ic-overlay]')];
            const toast=overlays.find(item=>item.dataset.icStackIndex==='0');
            const visible=overlays.filter(item=>item.matches(':popover-open')&&!item.hidden);
            const toastRect=toast?.getBoundingClientRect();
            results.push({
              triggerTone:button.dataset.toastTrigger,
              toastTone:toast?.getAttribute('tone')||'',
              message:toast?.textContent?.trim()||'',
              visible:Boolean(toast?.matches(':popover-open')&&!toast.hidden),
              overlayCount:overlays.length,
              visibleCount:visible.length,
              stackIndices:visible.map(item=>item.dataset.icStackIndex).sort().join(','),
              noDismiss:overlays.every(item=>!item.shadowRoot?.querySelector('.dismiss')),
              shadowSafe:Boolean(toastRect&&doc.defaultView.innerHeight-toastRect.bottom>=24),
            });
          }
          [...doc.querySelectorAll('ic-toast[data-ic-overlay]')].forEach(toast=>toast.dismiss());
          return results;
        })),
        englishLocalized:docs.filter(doc=>doc.documentElement.lang==='en').every(doc=>doc.querySelector('[data-component-name="ic-badge-status-processing"]')?.textContent.trim()==='Processing'&&doc.querySelector('#loading-inline')?.getAttribute('label')==='Preparing preview'&&doc.querySelector('#progress-batch')?.getAttribute('label')==='Batch generation'&&doc.querySelector('[data-alert-trigger="neutral"]')?.textContent.trim()==='Default Alert'&&doc.querySelector('#generation-pending-image')?.getAttribute('label')==='Generating 4 images'&&doc.querySelector('#generation-recovery-image')?.getAttribute('title')==='Generation can continue'),
        overflows:docs.map(doc=>doc.documentElement.scrollWidth>doc.documentElement.clientWidth)
      };
    })()`);
    report.checks.accessibility = report.accessibility.some(item => item.role === 'progressbar' && item.name === 'Upload') && report.accessibility.some(item => item.role === 'region' && item.name === 'Results');
    report.checks.matrix = report.matrix.cases === 6 && report.matrix.ready
      && report.matrix.legalCounts.every(value=>value===32)
      && report.matrix.loadingBadges.every(Boolean)
      && report.matrix.processingSpinners.every(Boolean)
      && report.matrix.badgeSizes.every(sizes=>JSON.stringify(sizes.map(item=>item.height))===JSON.stringify([16,20,24])&&JSON.stringify(sizes.map(item=>item.fontSize))===JSON.stringify(['10px','12px','14px'])&&sizes.every(item=>item.ready))
      && report.matrix.badgeStatuses.every(value=>value.count===4&&value.idleAbsent&&value.names.join(',')==='ic-badge-status-processing,ic-badge-status-success,ic-badge-status-warning,ic-badge-status-danger'&&value.tones.join(',')==='info,success,warning,danger')
      && report.matrix.actionAlerts.every(value=>value.ready&&value.componentName==='ic-alert'&&!value.hasLegacyVariant&&value.headingSize==='14px'&&value.headingWeight==='500'&&value.messageSize==='12px'&&value.messageFont.includes('12px / 18px')&&value.radius==='8px'&&value.headingText&&value.messageText&&value.symbolName==='circle-alert'&&value.symbolStroke==='2px'&&value.symbolTitleOffset<=1&&value.actionKind==='ic-button'&&value.actionVariant==='ic-button-secondary-small'&&value.actionHierarchy==='secondary'&&value.actionSize==='small'&&value.actionReady&&value.dismissKind==='ic-icon-button'&&value.dismissVariant==='ic-icon-button-tertiary-small'&&value.dismissReady&&Math.abs(value.dismissHeight-value.titleHeight)<=1)
      && report.matrix.alertInlineTitles.every(value=>value.size==='14px'&&value.weight==='500')
      && report.matrix.dismissibleAlerts.every(alerts=>alerts.every(value=>value.hostCenterOffset<=1&&value.iconXOffset<=1&&value.iconYOffset<=1&&Math.abs(value.hostWidth-value.buttonWidth)<=1&&Math.abs(value.rightInset-value.expectedRightInset)<=1))
      && report.matrix.alertQueues.every(value=>value.initialTone==='neutral'&&value.queuedAfterClicks===8&&value.stacked&&value.empty&&value.triggerTones.join(',')==='neutral,info,success,warning,danger,danger'&&value.sequence.join(',')==='danger,danger,warning,success,info,neutral,neutral,danger'&&value.icons.join(',')==='circle-alert,circle-alert,triangle-alert,circle-check-big,info,circle-alert,circle-alert,circle-alert'&&value.counts.join(',')==='8,7,6,5,4,3,2,1'&&value.positions.every(position=>position&&position.left===value.positions[0].left&&position.top===value.positions[0].top))
      && report.matrix.generationPending.every(value=>value.ready&&value.visible&&JSON.stringify(value.kinds)===JSON.stringify(['image','video','text'])&&JSON.stringify(value.states)===JSON.stringify(['generating','queued','generating'])&&value.imageCells===4&&value.videoCells===1&&value.textCells===1&&value.canvasesReady&&value.halftoneColorsReady&&value.motionReady&&value.canvasContinuous&&value.badges.every(item=>item.ready&&item.loading&&item.outside&&item.labelAbsent)&&value.badges.map(item=>item.text).join('|')===(value.badges[0].text.includes('Generating')?'6s Generating 4 images|7s Video waiting for generation|8s Generating text':'6s 正在生成 4 张图片|7s 视频等待生成|8s 正在生成文本')&&value.halftoneCanvasLayers===3&&value.obsoleteAnimationLayers===0&&value.imageDecodeLayers===0)
      && report.matrix.generationRecovery.every(value=>value.ready&&value.visible&&value.queryingDisabled&&JSON.stringify(value.kinds)===JSON.stringify(['image','video','text'])&&JSON.stringify(value.states)===JSON.stringify(['recoverable','queued','querying']))
      && report.matrix.toastTriggers.every(results=>results.length===5&&results.map(result=>result.triggerTone).join(',')==='neutral,info,success,warning,danger'&&results.every((result,index)=>result.toastTone===result.triggerTone&&result.message&&result.visible&&result.overlayCount===index+1&&result.visibleCount===Math.min(index+1,3)&&result.stackIndices===Array.from({length:Math.min(index+1,3)},(_,stackIndex)=>String(stackIndex)).join(',')&&result.noDismiss&&result.shadowSafe))
      && report.matrix.englishLocalized
      && JSON.stringify(report.matrix.themes) === JSON.stringify(['dark','light'])
      && JSON.stringify(report.matrix.viewports) === JSON.stringify(['desktop','narrow'])
      && JSON.stringify(report.matrix.locales) === JSON.stringify(['en','zh-CN'])
      && JSON.stringify(report.matrix.motions) === JSON.stringify(['reduced','standard'])
      && report.matrix.overflows.every(value => !value);
    report.checks.alertMotion = report.matrix.alertQueues.every(value=>value.motionDirection==='-100%'&&value.entryStarts&&value.entrySettles&&value.exitFlags.every(Boolean)&&value.transitionTiming.split(',').every(timing=>timing.trim()==='ease')&&(value.motion==='reduced'?value.transitionDuration.split(',').every(duration=>duration.trim()==='0.001s'):value.transitionDuration.split(',').every(duration=>duration.trim()==='0.4s')));
    report.checks.alertSizing = report.matrix.alertSizing.every(alerts=>alerts.every(value=>value.width<=480&&value.maxWidth==='480px'&&value.lineClamp==='2'&&value.overflow==='hidden'&&value.height<=value.lineHeight*2+1))&&report.matrix.alertQueues.every(value=>value.clamps.every(Boolean));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/ui-component-library.html#feedback-progress` }, sessionId);
    await waitFor(cdp, sessionId, `(() => {
      const frame=document.querySelector('[data-feedback-progress-matrix]');
      return Boolean(frame&&!frame.hidden&&frame.contentDocument?.documentElement?.dataset.feedbackProgressCaseStatus==='ready');
    })()`, 'Feedback/Progress preview in component library');
    await waitFor(cdp, sessionId, `(() => {
      const doc=document.querySelector('[data-feedback-progress-matrix]')?.contentDocument;
      return doc?.body && getComputedStyle(doc.body).backgroundColor==='rgb(255, 255, 255)';
    })()`, 'Feedback/Progress white surface');
    report.libraryBackground = await evaluate(cdp, sessionId, `(() => {
      const doc=document.querySelector('[data-feedback-progress-matrix]').contentDocument;
      return {
        page:getComputedStyle(doc.documentElement).backgroundColor,
        body:getComputedStyle(doc.body).backgroundColor,
        matrix:getComputedStyle(doc.querySelector('.ui-library-state-matrix')).backgroundColor,
      };
    })()`);
    report.checks.libraryBackground = Object.values(report.libraryBackground).every(color=>color==='rgb(255, 255, 255)');
    report.libraryToastPreview = await evaluate(cdp, sessionId, `(async () => {
      const outerDocument=document;
      const doc=document.querySelector('[data-feedback-progress-matrix]').contentDocument;
      const results=[];
      for(const button of doc.querySelectorAll('[data-toast-trigger]')){
        button.click();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const overlays=[...outerDocument.querySelectorAll('ic-toast[data-ic-overlay]')];
        const toast=overlays.find(item=>item.dataset.icStackIndex==='0');
        const visible=overlays.filter(item=>item.matches(':popover-open')&&!item.hidden);
        results.push({
          triggerTone:button.dataset.toastTrigger,
          toastTone:toast?.getAttribute('tone')||'',
          visible:Boolean(toast?.matches(':popover-open')&&!toast.hidden),
          overlayCount:overlays.length,
          visibleCount:visible.length,
          stackIndices:visible.map(item=>item.dataset.icStackIndex).sort().join(','),
          noDismiss:overlays.every(item=>!item.shadowRoot?.querySelector('.dismiss')),
        });
      }
      [...outerDocument.querySelectorAll('ic-toast[data-ic-overlay]')].forEach(toast=>toast.dismiss());
      [...doc.querySelectorAll('ic-toast[data-ic-overlay]')].forEach(toast=>toast.dismiss());
      return results;
    })()`);
    report.checks.libraryToastPreview = report.libraryToastPreview.length===5
      && report.libraryToastPreview.every((result,index)=>result.toastTone===result.triggerTone&&result.visible&&result.overlayCount===index+1&&result.visibleCount===Math.min(index+1,3)&&result.stackIndices===Array.from({length:Math.min(index+1,3)},(_,stackIndex)=>String(stackIndex)).join(',')&&result.noDismiss);
    await evaluate(cdp, sessionId, `(() => {
      const frame=document.querySelector('[data-feedback-progress-matrix]');
      const doc=frame.contentDocument;
      [...document.querySelectorAll('ic-toast[data-ic-overlay]')].forEach(toast=>toast.dismiss());
      [...doc.querySelectorAll('ic-toast[data-ic-overlay]')].forEach(toast=>toast.dismiss());
      const button=doc.querySelector('[data-toast-trigger="success"]');
      const frameRect=frame.getBoundingClientRect();
      const buttonRect=button.getBoundingClientRect();
      window.scrollTo({top:window.scrollY+frameRect.top+buttonRect.top-(window.innerHeight-buttonRect.height)/2});
    })()`);
    await delay(100);
    const pointerTarget = await evaluate(cdp, sessionId, `(() => {
      const frame=document.querySelector('[data-feedback-progress-matrix]');
      const doc=frame.contentDocument;
      const button=doc.querySelector('[data-toast-trigger="success"]');
      const frameRect=frame.getBoundingClientRect();
      const buttonRect=button.getBoundingClientRect();
      return {
        x:frameRect.left+buttonRect.left+buttonRect.width/2,
        y:frameRect.top+buttonRect.top+buttonRect.height/2,
        hit:doc.elementFromPoint(buttonRect.left+buttonRect.width/2,buttonRect.top+buttonRect.height/2)?.closest?.('[data-toast-trigger]')?.dataset.toastTrigger||'',
      };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:pointerTarget.x, y:pointerTarget.y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:pointerTarget.x, y:pointerTarget.y, button:'left', clickCount:1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:pointerTarget.x, y:pointerTarget.y, button:'left', clickCount:1 }, sessionId);
    await delay(100);
    report.libraryToastPointer = await evaluate(cdp, sessionId, `(() => {
      const toast=[...document.querySelectorAll('ic-toast[data-ic-overlay]:not([data-ic-stack-state="exiting"])')].find(item=>item.dataset.icStackIndex==='0');
      const toastRect=toast?.getBoundingClientRect();
      const viewportTop=toastRect?toastRect.top:-1;
      const viewportBottom=toastRect?toastRect.bottom:-1;
      return {
        hit:'${pointerTarget.hit}',
        tone:toast?.getAttribute('tone')||'',
        visible:Boolean(toast?.matches(':popover-open')&&!toast.hidden),
        visibleInLibraryViewport:Boolean(toastRect&&viewportTop>=0&&viewportBottom<=window.innerHeight),
        viewportTop:Math.round(viewportTop),
        viewportBottom:Math.round(viewportBottom),
        viewportHeight:window.innerHeight,
      };
    })()`);
    report.checks.libraryToastPointer = report.libraryToastPointer.hit==='success'
      && report.libraryToastPointer.tone==='success'
      && report.libraryToastPointer.visible
      && report.libraryToastPointer.visibleInLibraryViewport;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/ui-component-library.html#empty-states` }, sessionId);
    await waitFor(cdp, sessionId, `(() => {
      const emptyFrame=document.querySelector('[data-empty-states-matrix]');
      const feedbackFrame=document.querySelector('[data-feedback-progress-matrix]');
      return Boolean(emptyFrame&&!emptyFrame.hidden&&feedbackFrame?.hidden&&emptyFrame.contentDocument?.documentElement?.dataset.emptyStatesStatus==='ready');
    })()`, 'Empty states preview in component library');
    report.libraryEmptyStateCategory = await evaluate(cdp, sessionId, `(() => {
      const emptyDoc=document.querySelector('[data-empty-states-matrix]').contentDocument;
      const feedbackDoc=document.querySelector('[data-feedback-progress-matrix]').contentDocument;
      return {
        emptyStateCount:emptyDoc.querySelectorAll('ic-empty-state').length,
        namedSample:Boolean(emptyDoc.querySelector('[data-component-name="ic-empty-state"]')),
        absentFromFeedback:feedbackDoc.querySelectorAll('ic-empty-state').length===0,
      };
    })()`);
    report.checks.libraryEmptyStateCategory = report.libraryEmptyStateCategory.emptyStateCount===2
      && report.libraryEmptyStateCategory.namedSample
      && report.libraryEmptyStateCategory.absentFromFeedback;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/static/design-system/infinite-canvas-ui/generation-failure-feedback.html` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.generationFeedbackHarnessStatus === 'ready'", 'Smart Canvas generation feedback scenarios');
    report.scenarios = await evaluate(cdp, sessionId, `(async () => {
      const alert = document.querySelector('#scenario-alert');
      const harness = window.__generationFeedbackHarness;
      const records = {};
      for (const name of Object.keys(harness.scenarios)) {
        const current = harness.show(name);
        records[name] = {
          status:current.aggregate.status,
          successfulCount:current.aggregate.successfulCount,
          failedCount:current.aggregate.failedCount,
          totalCount:current.aggregate.totalCount,
          categories:current.aggregate.reasons.map(item => item.category),
          heading:alert.getAttribute('heading'),
          message:alert.textContent,
        };
      }
      harness.show('partial-success');
      await new Promise(resolve => requestAnimationFrame(resolve));
      const partial = {
        heading:alert.getAttribute('heading'),
        message:alert.textContent,
        visible:!alert.hidden,
        categories:harness.current.aggregate.reasons.map(item => item.category),
      };
      alert.shadowRoot.querySelector('.action').click();
      const detailsVisible = !document.querySelector('#details').hidden;
      harness.show('apimart-restricted');
      await new Promise(resolve => requestAnimationFrame(resolve));
      const apimart = {
        heading:alert.getAttribute('heading'),
        message:alert.textContent,
        visible:!alert.hidden,
        successfulCount:harness.current.aggregate.successfulCount,
        failedCount:harness.current.aggregate.failedCount,
        category:harness.current.aggregate.reasons[0]?.category,
        billing:harness.current.aggregate.tasks.find(task => task.error)?.error?.billingEvidence,
      };
      return {scenarioCount:Object.keys(harness.scenarios).length, records, partial, detailsVisible, apimart};
    })()`);
    const coveredCategories = [...new Set(Object.values(report.scenarios.records).flatMap(value => value.categories))].sort();
    report.checks.scenarios = report.scenarios.scenarioCount === 25
      && coveredCategories.join(',') === 'application_internal_error,cancelled_or_replaced,connection_interrupted,credential_invalid,credential_missing,empty_output,invalid_parameter,local_dependency_missing,network_timeout,processing_timeout,prompt_too_long,provider_account_restricted,provider_busy,provider_internal_error,quota_insufficient,rate_limited,safety_blocked,unknown,unsupported_size'
      && Object.values(report.scenarios.records).every(value => value.heading && value.message)
      && report.scenarios.partial.visible
      && report.scenarios.partial.heading === '生成图片：1 项成功，2 项失败'
      && report.scenarios.partial.message === 'maximum processing time exceeded 15 minutes、content policy moderation safety violation'
      && report.scenarios.partial.categories.join(',') === 'processing_timeout,safety_blocked'
      && report.scenarios.detailsVisible
      && report.scenarios.records['all-failed-mixed'].heading === '生成视频失败'
      && report.scenarios.records['text-generation-failed'].heading === '生成文字失败'
      && report.scenarios.records['matting-failed'].heading === '抠图失败'
      && report.scenarios.records['invalid-parameter'].message === 'Unsupported parameter: quality'
      && report.scenarios.records['jimeng-prompt-too-long'].heading === '生成图片失败'
      && report.scenarios.records['jimeng-prompt-too-long'].message === '即梦 5.0 文生图提示词长度为 6070 个字符，超过稳定上限 1500；请压缩到 1400 字符以内后重试'
      && report.scenarios.records['jimeng-prompt-too-long'].categories.join(',') === 'prompt_too_long'
      && report.scenarios.records['cli-invalid-size'].heading === '生成图片失败'
      && report.scenarios.records['cli-invalid-size'].message === "GPT Image 2 Skill 调用失败：codex: error: invalid value '1K' for '--size <SIZE>': Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.\n\nFor more information, try '--help'. 2 项"
      && report.scenarios.records['cli-invalid-size'].failedCount === 2
      && report.scenarios.records['cli-invalid-size'].categories.join(',') === 'unsupported_size'
      && report.scenarios.apimart.visible
      && report.scenarios.apimart.successfulCount === 2
      && report.scenarios.apimart.failedCount === 5
      && report.scenarios.apimart.heading === '生成图片：2 项成功，5 项失败'
      && report.scenarios.apimart.message === 'The provider account is temporarily restricted. 5 项'
      && report.scenarios.apimart.category === 'provider_account_restricted'
      && report.scenarios.apimart.billing.cost === 0;
    report.consoleErrors = cdp.events.flatMap(event => event.method === 'Runtime.exceptionThrown' ? [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text] : event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error' ? [event.params.args?.map(arg => arg.value || arg.description).join(' ')] : []);
    report.checks.console = report.consoleErrors.length === 0;
    report.browser = await cdp.send('Browser.getVersion');
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
