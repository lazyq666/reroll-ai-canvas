const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE_URL = process.env.CANVAS_MANAGEMENT_PREVIEW_URL || 'http://127.0.0.1:8798';
const CHROME = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Chrome debugger did not start: ${stderr}`)), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    browser.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before debugger startup (${code}): ${stderr}`));
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
  const events = [];
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (operation) {
      pending.delete(payload.id);
      if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
      else operation.resolve(payload.result);
    } else if (payload.method) events.push(payload);
  });
  return {
    events,
    close: () => socket.close(),
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(description || 'Browser evaluation failed');
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function navigate(cdp, sessionId, url) {
  await cdp.send('Page.navigate', { url }, sessionId);
  await waitFor(
    cdp,
    sessionId,
    `document.readyState === 'complete' && document.querySelector('.ws-card') && document.getElementById('board')?.getAttribute('aria-busy') === 'false' && customElements.get('ic-popover')`,
    `ready Canvas List at ${url}`,
  );
}

const adminScenario = `(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (check, label, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await sleep(50); }
    throw new Error('Timed out: ' + label);
  };
  const apiState = async () => (await fetch('/api/test-state')).json();
  const card = id => document.querySelector('.ws-card[data-canvas-id="' + id + '"]');
  const menuAction = async (id, action) => {
    card(id).querySelector('.ws-card-menu').click();
    await wait(() => document.querySelector('ic-menu.ws-card-pop[open]'), 'menu ' + action);
    const item = document.querySelector('ic-menu-item[data-act="' + action + '"]');
    if (!item) throw new Error('Missing menu action: ' + action);
    item.shadowRoot.querySelector('button').click();
  };
  const answer = async accepted => {
    const dialog = document.getElementById('canvasActionConfirmation');
    await wait(() => dialog.open, 'confirmation open');
    dialog.querySelector('[data-ic-confirmation-owned="' + (accepted ? 'confirm' : 'cancel') + '"]').click();
    await wait(() => !dialog.open, 'confirmation close');
  };
  const setInput = (element, value, commit = false) => {
    element.value = value;
    element.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
    if (commit) {
      element.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true, cancelable:true}));
    }
  };
  const components = {
    createDialog: document.getElementById('createCanvasDialog').localName,
    confirmation: document.getElementById('canvasActionConfirmation').localName,
    sharePopover: document.getElementById('canvasSharePopover').localName,
    invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
    invalidReasons: [...document.querySelectorAll('[data-ic-contract-status="invalid"]')].map(element => ({tag:element.localName,id:element.id,reason:element.dataset.icContractReason||element.getAttribute('ic-contract-error')||''})),
    legacyMarkup: document.querySelectorAll('.ws-create-card,.ws-share-tooltip,.ws-card-delete-confirm,.ws-trash-confirm').length,
  };

  document.getElementById('newCanvasBtn').click();
  const createDialog = document.getElementById('createCanvasDialog');
  await wait(() => createDialog.open, 'create dialog');
  const defaultKind = document.getElementById('createCanvasKind').getAttribute('value');
  setInput(document.getElementById('createCanvasName'), 'Launch Storyboard');
  document.getElementById('createCanvasConfirm').click();
  await wait(() => card('created-1'), 'created canvas');
  await wait(async () => (await apiState()).metrics.created === 1, 'create request');
  const createdKind = (await apiState()).canvases.find(canvas => canvas.id === 'created-1').kind;

  await menuAction('created-1', 'rename');
  await wait(() => card('created-1').querySelector('.ws-card-title-input'), 'rename input');
  setInput(card('created-1').querySelector('.ws-card-title-input'), 'Launch Film', true);
  await wait(async () => (await apiState()).metrics.renamed === 1, 'rename request');

  await menuAction('owned-smart', 'share');
  await wait(async () => (await apiState()).metrics.shareCreated === 1, 'share create');
  await menuAction('owned-smart', 'share');
  const popover = document.getElementById('canvasSharePopover');
  await wait(() => popover.hasAttribute('open'), 'share popover');
  popover.querySelector('[data-share-regenerate]').click();
  await answer(true);
  await wait(async () => (await apiState()).metrics.shareRegenerated === 1, 'share regenerate');
  popover.querySelector('[data-share-revoke]').click();
  await answer(false);
  const revokeAfterCancel = (await apiState()).metrics.shareRevoked;
  popover.querySelector('[data-share-revoke]').click();
  await answer(true);
  await wait(async () => (await apiState()).metrics.shareRevoked === 1, 'share revoke');

  await menuAction('owned-smart', 'privacy');
  await answer(true);
  await wait(() => card('owned-smart').querySelector('.ws-card-privacy'), 'private badge');
  await menuAction('owned-smart', 'privacy');
  await wait(() => !card('owned-smart').querySelector('.ws-card-privacy'), 'shared badge state');

  await menuAction('created-1', 'delete');
  await answer(false);
  const existsAfterDeleteCancel = Boolean(card('created-1'));
  await menuAction('created-1', 'delete');
  await answer(true);
  await wait(() => !card('created-1'), 'canvas moved to trash');
  document.getElementById('trashEntry').click();
  await wait(() => document.querySelector('.ws-trash-card[data-canvas-id="created-1"]'), 'trash card');
  document.querySelector('.ws-trash-card[data-canvas-id="created-1"] .restore').click();
  await wait(async () => (await apiState()).metrics.restored === 1, 'restore request');
  document.getElementById('trashClose').click();
  await wait(() => card('created-1'), 'restored canvas');
  await menuAction('created-1', 'delete');
  await answer(true);
  document.getElementById('trashEntry').click();
  await wait(() => document.querySelector('.ws-trash-card[data-canvas-id="created-1"] .purge'), 'purge action');
  document.querySelector('.ws-trash-card[data-canvas-id="created-1"] .purge').click();
  await answer(true);
  await wait(async () => (await apiState()).metrics.purged === 1, 'purge request');
  document.getElementById('trashClose').click();

  await menuAction('team-smart', 'delete');
  await answer(true);
  await wait(() => !card('team-smart'), 'team canvas trashed');
  const finalState = await apiState();
  return { components, defaultKind, createdKind, revokeAfterCancel, existsAfterDeleteCancel, metrics:finalState.metrics };
})()`;

const designerScenario = `(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (check, label) => { const deadline=Date.now()+10000; while(Date.now()<deadline){if(await check())return;await sleep(50);}throw new Error('Timed out: '+label); };
  const card = document.querySelector('.ws-card[data-canvas-id="owned-smart"]');
  card.querySelector('.ws-card-menu').click();
  await wait(() => document.querySelector('ic-menu.ws-card-pop[open]'), 'designer menu');
  const visibilityCommands = document.querySelectorAll('ic-menu-item[data-act="privacy"]').length;
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  document.getElementById('trashEntry').click();
  await wait(() => document.querySelector('.ws-trash-card[data-canvas-id="team-smart"]'), 'designer trash');
  return {
    newProjectHidden: document.getElementById('newProjectBtn').hidden,
    projectActions: document.querySelectorAll('.ws-project-actions').length,
    purgeActions: document.querySelectorAll('.ws-trash-act.purge').length,
    visibilityCommands,
  };
})()`;

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-canvas-management-browser-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false }, sessionId);
    await navigate(cdp, sessionId, `${BASE_URL}/canvas-list`);
    const trashGeometry = await evaluate(cdp, sessionId, `(async () => {
      const project = document.querySelector('.ws-project-row');
      const projectRows = [...document.querySelectorAll('.ws-project-row')];
      const trash = document.getElementById('trashEntry');
      const trashBadgeElement = trash.querySelector('.ws-project-count');
      const badgeWasVisible = trashBadgeElement.classList.contains('visible');
      trashBadgeElement.classList.add('visible');
      await new Promise(resolve => requestAnimationFrame(resolve));
      const projectIcon = project.querySelector('.ws-project-icon').getBoundingClientRect();
      const trashIcon = trash.querySelector('.ws-project-icon').getBoundingClientRect();
      const projectBadge = project.querySelector('.ws-project-count').getBoundingClientRect();
      const trashBadge = trashBadgeElement.getBoundingClientRect();
      const projectRect = project.getBoundingClientRect();
      const trashRect = trash.getBoundingClientRect();
      const trashBase = trash.shadowRoot.querySelector('[part~="base"]');
      const dangerProbe = document.createElement('span');
      dangerProbe.style.backgroundColor = 'var(--ui-color-surface-danger)';
      document.body.append(dangerProbe);
      const result = {
        projectHeight:Math.round(projectRect.height),
        trashHeight:Math.round(trashRect.height),
        projectIconSize:[Math.round(projectIcon.width),Math.round(projectIcon.height)],
        trashIconSize:[Math.round(trashIcon.width),Math.round(trashIcon.height)],
        contentStartDelta:Math.round(trashIcon.left-projectIcon.left),
        badgeRightDelta:Math.round(trashBadge.right-projectBadge.right),
        projectItemGap:Math.round(projectRows[1].getBoundingClientRect().top-projectRows[0].getBoundingClientRect().bottom),
        trashPaddingInline:getComputedStyle(trashBase).paddingInline,
        projectBorderRadius:getComputedStyle(project).borderRadius,
        trashBorderRadius:getComputedStyle(trashBase).borderRadius,
        trashTextAlign:getComputedStyle(trash.querySelector('.ws-project-name')).textAlign,
        dangerSoft:getComputedStyle(dangerProbe).backgroundColor,
        hoverPoint:{x:Math.round(trashRect.left+trashRect.width/2),y:Math.round(trashRect.top+trashRect.height/2)}
      };
      dangerProbe.remove();
      if (!badgeWasVisible) trashBadgeElement.classList.remove('visible');
      return result;
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:trashGeometry.hoverPoint.x, y:trashGeometry.hoverPoint.y }, sessionId);
    await delay(100);
    trashGeometry.hoverBackground = await evaluate(cdp, sessionId, `getComputedStyle(document.getElementById('trashEntry').shadowRoot.querySelector('[part~="base"]')).backgroundColor`);
    delete trashGeometry.hoverPoint;
    const projectHoverPoint = await evaluate(cdp, sessionId, `(() => { const rect=document.querySelector('.ws-project-row.has-actions:not([data-project-id="default"])').getBoundingClientRect(); return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:projectHoverPoint.x, y:projectHoverPoint.y }, sessionId);
    await delay(200);
    const projectHover = await evaluate(cdp, sessionId, `(() => {
      const row=document.querySelector('.ws-project-row.has-actions:not([data-project-id="default"])');
      const count=row.querySelector('.ws-project-count');
      const actions=row.querySelector('.ws-project-actions');
      const actionButtons=[...actions.querySelectorAll('.ws-proj-act')];
      const rowRect=row.getBoundingClientRect();
      const actionsRect=actions.getBoundingClientRect();
      const actionButtonRects=actionButtons.map(button=>button.getBoundingClientRect());
      return {
        countHidden:getComputedStyle(count).visibility==='hidden',
        actionsVisible:getComputedStyle(actions).visibility==='visible'&&getComputedStyle(actions).opacity==='1',
        actionsEndInset:Math.round(rowRect.right-actionsRect.right),
        actionsGap:Math.round(Number.parseFloat(getComputedStyle(actions).gap)),
        actionsWidth:Math.round(actionsRect.width),
        buttonWidths:actionButtonRects.map(rect=>Math.round(rect.width)),
        contentEndDelta:Math.round(actionsRect.right-actionButtonRects.at(-1).right)
      };
    })()`);
    const operations = await evaluate(cdp, sessionId, adminScenario);

    const visual = [];
    for (const combination of [
      { name:'desktop-dark', expectedTheme:'dark', width:1440, height:900, expectedDirection:'row' },
      { name:'narrow-light', expectedTheme:'light', width:390, height:844, expectedDirection:'column' },
      { name:'narrow-dark', expectedTheme:'dark', width:390, height:844, expectedDirection:'column' },
    ]) {
      await evaluate(cdp, sessionId, `localStorage.setItem('studio_theme', ${JSON.stringify(combination.expectedTheme)})`);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width:combination.width, height:combination.height, deviceScaleFactor:1, mobile:false }, sessionId);
      await navigate(cdp, sessionId, `${BASE_URL}/canvas-list`);
      const observation = await evaluate(cdp, sessionId, `(() => ({
        theme:document.documentElement.classList.contains('theme-dark')?'dark':'light',
        direction:getComputedStyle(document.querySelector('.workspace')).flexDirection,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        invalidContracts:document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
        invalidReasons:[...document.querySelectorAll('[data-ic-contract-status="invalid"]')].map(element=>({tag:element.localName,id:element.id,reason:element.dataset.icContractReason||element.getAttribute('ic-contract-error')||''}))
      }))()`);
      visual.push({ ...combination, ...observation });
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', { width:1200, height:800, deviceScaleFactor:1, mobile:false }, sessionId);
    await navigate(cdp, sessionId, `${BASE_URL}/canvas-list?as=designer`);
    const permissions = await evaluate(cdp, sessionId, designerScenario);
    const browserErrors = cdp.events.filter(event => (
      event.method === 'Runtime.exceptionThrown'
      || (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params.entry.level))
    ));
    const evidence = { operations, projectHover, trashGeometry, visual, permissions, browserErrors };
    const invalid = (
      operations.components.createDialog !== 'ic-dialog'
      || operations.components.confirmation !== 'ic-confirmation-dialog'
      || operations.components.sharePopover !== 'ic-popover'
      || operations.components.invalidContracts !== 0
      || operations.components.legacyMarkup !== 0
      || operations.defaultKind !== 'smart'
      || operations.createdKind !== 'smart'
      || operations.revokeAfterCancel !== 0
      || !operations.existsAfterDeleteCancel
      || operations.metrics.created !== 1
      || operations.metrics.renamed !== 1
      || operations.metrics.trashed !== 3
      || operations.metrics.restored !== 1
      || operations.metrics.purged !== 1
      || operations.metrics.visibility !== 2
      || operations.metrics.shareCreated !== 1
      || operations.metrics.shareRegenerated !== 1
      || operations.metrics.shareRevoked !== 1
      || trashGeometry.projectHeight !== trashGeometry.trashHeight
      || trashGeometry.projectIconSize.join('x') !== trashGeometry.trashIconSize.join('x')
      || Math.abs(trashGeometry.contentStartDelta) > 4
      || Math.abs(trashGeometry.badgeRightDelta) > 4
      || trashGeometry.projectItemGap !== 8
      || trashGeometry.trashBorderRadius !== trashGeometry.projectBorderRadius
      || !['start', 'left'].includes(trashGeometry.trashTextAlign)
      || trashGeometry.hoverBackground === trashGeometry.dangerSoft
      || !projectHover.countHidden
      || !projectHover.actionsVisible
      || projectHover.actionsEndInset !== 12
      || projectHover.actionsGap !== 4
      || projectHover.actionsWidth !== projectHover.buttonWidths.reduce((sum,width)=>sum+width,0)+projectHover.actionsGap
      || projectHover.contentEndDelta !== 0
      || visual.some(item => item.theme !== item.expectedTheme || item.direction !== item.expectedDirection || item.overflow > 0 || item.invalidContracts)
      || !permissions.newProjectHidden
      || permissions.projectActions !== 0
      || permissions.purgeActions !== 0
      || permissions.visibilityCommands !== 0
      || browserErrors.length
    );
    if (invalid) throw new Error(`Unexpected Canvas List content management result: ${JSON.stringify(evidence, null, 2)}`);
    process.stdout.write(`${JSON.stringify({ok:true,evidence}, null, 2)}\n`);
  } finally {
    cdp?.close();
    browser.kill('SIGTERM');
    await delay(250);
    fs.rmSync(profile, { recursive:true, force:true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
