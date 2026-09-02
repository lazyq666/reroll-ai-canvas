const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME_TYPES = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml' };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

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
      response.writeHead(200, { 'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(body);
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
  const browser = await chromium.launch({ headless:true, executablePath:CHROME });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{ width:1100, height:820 } });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/tests/workspace_asset_library_browser_harness.html`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.workspaceAssetLibraryStatus === 'ready');

    const initial = await page.evaluate(() => {
      const library = document.querySelector('#library');
      const root = library.shadowRoot;
      const field = root.querySelector('.search-field');
      const toolbar = root.querySelector('.toolbar');
      const results = root.querySelector('.results');
      const layout = root.querySelector('.layout');
      const sidebar = root.querySelector('.sidebar');
      const card = root.querySelector('.card');
      const image = card.querySelector('img');
      const name = card.querySelector('.name');
      const actions = card.querySelector('.actions');
      const cardStyle = getComputedStyle(card);
      const layoutStyle = getComputedStyle(layout);
      const sidebarStyle = getComputedStyle(sidebar);
      const imageStyle = getComputedStyle(image);
      const nameStyle = getComputedStyle(name);
      const actionsStyle = getComputedStyle(actions);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;display:flex;gap:var(--ui-space-1);padding-inline:var(--ui-space-6);border-radius:var(--ui-radius-xs);font-size:var(--ui-font-size-2);font-weight:var(--ui-font-weight-regular);color:var(--ui-color-text-secondary)';
      document.body.append(probe);
      const probeStyle = getComputedStyle(probe);
      const expected = { gap:probeStyle.gap, paddingInline:probeStyle.paddingLeft, radius:probeStyle.borderTopLeftRadius, fontSize:probeStyle.fontSize, fontWeight:probeStyle.fontWeight, color:probeStyle.color };
      probe.remove();
      return {
        searchFocused:root.activeElement === root.querySelector('[data-search]'),
        cardCount:root.querySelectorAll('.card').length,
        searchContract:field.dataset.icContractStatus,
        searchComponent:field.dataset.componentName,
        hasBatchButton:Boolean(toolbar.querySelector('[data-import-trigger]')),
        layoutColumns:layoutStyle.gridTemplateColumns.split(' ').length,
        sidebarBorder:sidebarStyle.borderLeftWidth,
        cardCursor:cardStyle.cursor,
        cardLabel:card.getAttribute('aria-label'),
        nameBelowImage:name.getBoundingClientRect().top >= image.getBoundingClientRect().bottom,
        gap:cardStyle.gap,
        expectedGap:expected.gap,
        radius:imageStyle.borderTopLeftRadius,
        expectedRadius:expected.radius,
        fontSize:nameStyle.fontSize,
        expectedFontSize:expected.fontSize,
        fontWeight:nameStyle.fontWeight,
        expectedFontWeight:expected.fontWeight,
        color:nameStyle.color,
        expectedColor:expected.color,
        actionsHidden:actionsStyle.visibility === 'hidden' && actionsStyle.pointerEvents === 'none',
      };
    });
    assert.equal(initial.searchFocused, false, 'Opening the asset library must not force search focus');
    assert.equal(initial.cardCount, 2);
    assert.equal(initial.searchContract, 'valid');
    assert.equal(initial.searchComponent, 'ic-form-field-search-s');
    assert.equal(initial.hasBatchButton, true);
    assert.equal(initial.layoutColumns, 2);
    assert.notEqual(initial.sidebarBorder, '0px');
    assert.equal(initial.cardCursor, 'pointer');
    assert.equal(initial.cardLabel, '插入“晨雾森林”到智能画布');
    assert.equal(initial.nameBelowImage, true);
    assert.equal(initial.gap, initial.expectedGap);
    assert.equal(initial.radius, initial.expectedRadius);
    assert.equal(initial.fontSize, initial.expectedFontSize);
    assert.equal(initial.fontWeight, initial.expectedFontWeight);
    assert.equal(initial.color, initial.expectedColor);
    assert.equal(initial.actionsHidden, true);

    await page.locator('ic-workspace-asset-library [data-search]').click();
    const imeState = await page.evaluate(async () => {
      const library = document.querySelector('#library');
      const root = library.shadowRoot;
      const search = root.querySelector('[data-search]');
      const requestsBefore = globalThis.workspaceAssetRequests.filter(request => request.method === 'GET').length;
      search.dispatchEvent(new CompositionEvent('compositionstart', { bubbles:true, composed:true, data:'' }));
      search.value = 'l';
      search.dispatchEvent(new InputEvent('input', {
        bubbles:true,
        composed:true,
        data:'l',
        inputType:'insertCompositionText',
        isComposing:true,
      }));
      await new Promise(resolve => setTimeout(resolve, 280));
      const inputDuringComposition = root.querySelector('[data-search]');
      const requestsDuring = globalThis.workspaceAssetRequests.filter(request => request.method === 'GET').length;
      inputDuringComposition.value = '狼人';
      inputDuringComposition.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles:true,
        composed:true,
        data:'狼人',
      }));
      await new Promise(resolve => setTimeout(resolve, 280));
      const inputAfterComposition = root.querySelector('[data-search]');
      const getRequests = globalThis.workspaceAssetRequests.filter(request => request.method === 'GET');
      return {
        sameInputDuringComposition:inputDuringComposition === search,
        noRequestDuringComposition:requestsDuring === requestsBefore,
        finalQuery:getRequests.at(-1)?.query || '',
        focusedAfterComposition:inputAfterComposition.matches(':focus-within'),
      };
    });
    assert.deepEqual(imeState, {
      sameInputDuringComposition:true,
      noRequestDuringComposition:true,
      finalQuery:'狼人',
      focusedAfterComposition:true,
    });
    await page.evaluate(async () => {
      const library = document.querySelector('#library');
      library.scheduleSearch('');
      await new Promise(resolve => setTimeout(resolve, 280));
    });
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 2);

    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-new]').click());
    await page.waitForFunction(() => Boolean(document.querySelector('#library').shadowRoot.querySelector('[data-folder-name]')));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#library').shadowRoot.querySelector('[data-folder-name]'));
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.activeElement?.matches('[data-folder-new]'));
    const escapeCancelReturnedFocus = await page.evaluate(() => document.querySelector('#library').shadowRoot.activeElement?.matches('[data-folder-new]'));
    assert.equal(escapeCancelReturnedFocus, true, 'Escape must cancel the new-folder editor and return focus');

    await page.evaluate(async () => {
      const dialog = document.createElement('ic-dialog');
      dialog.id = 'folderCancelDialog';
      dialog.setAttribute('label', '资产库');
      dialog.setAttribute('size', 'x-large');
      dialog.setAttribute('dismiss-policy', 'explicit');
      const library = document.createElement('ic-workspace-asset-library');
      library.id = 'folderCancelLibrary';
      library.style.cssText = 'display:block;width:760px;height:680px';
      dialog.append(library);
      document.body.append(dialog);
      await library.refresh({preserveQuery:false});
      await dialog.show();
      library.shadowRoot.querySelector('[data-folder-new]').click();
    });
    await page.waitForFunction(() => Boolean(document.querySelector('#folderCancelLibrary').shadowRoot.querySelector('[data-folder-name]')));
    await page.keyboard.press('Escape');
    await pause(150);
    const dialogEscapeState = await page.evaluate(() => {
      const dialog = document.querySelector('#folderCancelDialog');
      const library = document.querySelector('#folderCancelLibrary');
      const state = {
        dialogOpen:dialog.hasAttribute('open'),
        editorClosed:!library.shadowRoot.querySelector('[data-folder-name]'),
      };
      dialog.remove();
      return state;
    });
    assert.deepEqual(dialogEscapeState, {dialogOpen:true, editorClosed:true}, 'Escape must cancel folder creation before dismissing the dialog');

    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-new]').click());
    await page.waitForFunction(() => Boolean(document.querySelector('#library').shadowRoot.querySelector('[data-folder-name]')));
    await page.locator('ic-workspace-asset-library [data-search]').click();
    await page.waitForFunction(() => !document.querySelector('#library').shadowRoot.querySelector('[data-folder-name]'));
    const outsideCancelState = await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      return {
        editorClosed:!root.querySelector('[data-folder-name]'),
        createButtonRestored:Boolean(root.querySelector('[data-folder-new]')),
        outsideFocusPreserved:root.activeElement === root.querySelector('[data-search]'),
      };
    });
    assert.deepEqual(outsideCancelState, {
      editorClosed:true,
      createButtonRestored:true,
      outsideFocusPreserved:true,
    });

    const folderNavigation = await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      const row = root.querySelector('[data-folder-id="folder-scenes"]').closest('.folder-row');
      const allCount = root.querySelector('[data-folder-id=""] .folder-count');
      const folderCount = row.querySelector('.folder-count');
      const label = row.querySelector('.folder-label');
      const actions = row.querySelector('.folder-actions');
      const countAlignment = Math.abs(folderCount.getBoundingClientRect().right - allCount.getBoundingClientRect().right);
      const labelRect = label.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const fontProbe = document.createElement('span');
      fontProbe.style.fontSize = 'var(--ui-font-size-3)';
      document.body.append(fontProbe);
      const expectedFontSize = getComputedStyle(fontProbe).fontSize;
      fontProbe.remove();
      return {
        fontSize:getComputedStyle(label).fontSize,
        expectedFontSize,
        labelClearOfActions:labelRect.right <= actionsRect.left + 0.5,
        countRightAligned:countAlignment <= 0.5,
      };
    });
    assert.deepEqual(folderNavigation, {
      fontSize:folderNavigation.expectedFontSize,
      expectedFontSize:folderNavigation.expectedFontSize,
      labelClearOfActions:true,
      countRightAligned:true,
    });

    await page.locator('ic-workspace-asset-library [data-folder-id="folder-scenes"]').hover();
    const folderHover = await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      const row = root.querySelector('[data-folder-id="folder-scenes"]').closest('.folder-row');
      return {
        countHidden:getComputedStyle(row.querySelector('.folder-count')).visibility === 'hidden',
        actionsVisible:getComputedStyle(row.querySelector('.folder-actions')).visibility === 'visible',
      };
    });
    assert.deepEqual(folderHover, {countHidden:true, actionsVisible:true});

    const englishCopy = await page.evaluate(() => {
      document.documentElement.lang = 'en';
      window.dispatchEvent(new CustomEvent('studio-lang-change', {detail:{lang:'en'}}));
      const root = document.querySelector('#library').shadowRoot;
      return {
        batch:root.querySelector('[data-import-trigger]').textContent.trim(),
        all:root.querySelector('[data-folder-id=""] .folder-label').textContent.trim(),
        create:root.querySelector('[data-folder-new]').textContent.trim(),
      };
    });
    assert.deepEqual(englishCopy, {batch:'Batch import', all:'All', create:'New folder'});
    await page.evaluate(() => {
      document.documentElement.lang = 'zh-CN';
      window.dispatchEvent(new CustomEvent('studio-lang-change', {detail:{lang:'zh'}}));
    });

    await page.evaluate(() => {
      globalThis.workspaceAssetInsertEvents = [];
      document.querySelector('#library').addEventListener('ic-asset-insert', event => {
        globalThis.workspaceAssetInsertEvents.push({...event.detail.item});
      });
    });
    await page.locator('ic-workspace-asset-library .card').first().click();
    await page.evaluate(() => {
      const card = document.querySelector('#library').shadowRoot.querySelector('.card');
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true}));
    });
    const insertEvents = await page.evaluate(() => globalThis.workspaceAssetInsertEvents);
    assert.equal(insertEvents.length, 2);
    assert.equal(insertEvents[0].id, 'asset-1');
    assert.equal(insertEvents[1].id, 'asset-1');

    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-id="folder-scenes"]').click());
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 1);
    await page.locator('ic-workspace-asset-library [data-import-input]').setInputFiles([
      {name:'角色正面.png', mimeType:'image/png', buffer:Buffer.from('image-one')},
      {name:'角色侧面.png', mimeType:'image/png', buffer:Buffer.from('image-two')},
    ]);
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 3);
    const importState = await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      return {
        notice:root.querySelector('.import-notice')?.textContent,
        request:globalThis.workspaceAssetRequests.find(request => request.path === '/api/workspace-assets/import'),
      };
    });
    assert.equal(importState.notice, '已导入 2 项，0 项已存在，0 项失败');
    assert.equal(importState.request.folder_id, 'folder-scenes');
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-id=""]').click());
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 4);
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-new]').click());
    await page.evaluate(() => {
      const input = document.querySelector('#library').shadowRoot.querySelector('[data-folder-name]');
      input.value = '角色';
      input.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true}));
    });
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('[data-folder-id]').length === 3);
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-edit="folder-2"]').click());
    await page.evaluate(() => {
      const input = document.querySelector('#library').shadowRoot.querySelector('[data-folder-name]');
      input.value = '角色设计';
      input.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true}));
    });
    await page.waitForFunction(() => [...document.querySelector('#library').shadowRoot.querySelectorAll('.folder-label')].some(label => label.textContent === '角色设计'));
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-delete="folder-2"]').click());
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-delete-confirmation]').hasAttribute('open'));
    const folderDeleteCopy = await page.evaluate(() => {
      const confirmation = document.querySelector('#library').shadowRoot.querySelector('[data-folder-delete-confirmation]');
      return {label:confirmation.getAttribute('label'), description:confirmation.getAttribute('description')};
    });
    assert.deepEqual(folderDeleteCopy, {
      label:'删除文件夹“角色设计”？',
      description:'其中 0 项素材会保留在“全部”中，素材本身不会被移除。',
    });
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-folder-delete-confirmation]').shadowRoot.querySelector('[data-confirm]').click());
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('[data-folder-id]').length === 2);

    await page.locator('ic-workspace-asset-library .card').first().hover();
    await page.waitForFunction(() => {
      const actions = document.querySelector('#library').shadowRoot.querySelector('.actions');
      return getComputedStyle(actions).visibility === 'visible' && getComputedStyle(actions).pointerEvents === 'auto';
    });

    await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      const search = root.querySelector('[data-search]');
      search.focus();
      search.value = '晨雾';
      search.dispatchEvent(new Event('input', { bubbles:true, composed:true }));
    });
    await pause(280);
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 1);
    const searchState = await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      return {
        clearVisible:!root.querySelector('[data-search-clear]').hidden,
        focusPreserved:root.activeElement === root.querySelector('[data-search]'),
      };
    });
    assert.deepEqual(searchState, { clearVisible:true, focusPreserved:true });
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-search-clear]').click());
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 4);

    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-rename="asset-1"]').click());
    await page.waitForFunction(() => Boolean(document.querySelector('#library').shadowRoot.querySelector('[data-rename-input]')));
    await page.evaluate(() => {
      const input = document.querySelector('#library').shadowRoot.querySelector('[data-rename-input]');
      input.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, composed:true }));
    });
    await page.waitForFunction(() => !document.querySelector('#library').shadowRoot.querySelector('[data-rename-input]'));
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.activeElement?.matches('[data-rename="asset-1"]'));
    const renameCancelReturnedFocus = await page.evaluate(() => document.querySelector('#library').shadowRoot.activeElement?.matches('[data-rename="asset-1"]'));
    assert.equal(renameCancelReturnedFocus, true);
    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-rename="asset-1"]').click());
    await page.waitForFunction(() => Boolean(document.querySelector('#library').shadowRoot.querySelector('[data-rename-input]')));
    const renameContract = await page.evaluate(() => {
      const root = document.querySelector('#library').shadowRoot;
      const field = root.querySelector('.rename-field');
      const input = root.querySelector('[data-rename-input]');
      input.value = '重命名素材';
      input.dispatchEvent(new Event('input', { bubbles:true, composed:true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, composed:true }));
      return field.dataset.componentName;
    });
    assert.equal(renameContract, 'ic-form-field-text-s');
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelector('.name')?.textContent === '重命名素材');

    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-delete="asset-1"]').click());
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelector('[data-delete-confirmation]').hasAttribute('open'));
    const confirmationCopy = await page.evaluate(() => {
      const confirmation = document.querySelector('#library').shadowRoot.querySelector('[data-delete-confirmation]');
      return { label:confirmation.label || confirmation.getAttribute('label'), description:confirmation.getAttribute('description'), consequence:confirmation.getAttribute('consequence') };
    });
    assert.deepEqual(confirmationCopy, {
      label:'从资产库移除“重命名素材”？',
      description:'移除后，这张图片将不再出现在资产库中。画布中的图片和已经插入的引用不受影响。',
      consequence:'destructive',
    });
    await page.evaluate(() => {
      const confirmation = document.querySelector('#library').shadowRoot.querySelector('[data-delete-confirmation]');
      confirmation.shadowRoot.querySelector('[data-cancel]').click();
    });
    await page.waitForFunction(() => !document.querySelector('#library').shadowRoot.querySelector('[data-delete-confirmation]').hasAttribute('open'));
    const cancelReturnedFocus = await page.evaluate(() => document.querySelector('#library').shadowRoot.activeElement?.matches('[data-delete="asset-1"]'));
    assert.equal(cancelReturnedFocus, true);

    await page.evaluate(() => document.querySelector('#library').shadowRoot.querySelector('[data-delete="asset-1"]').click());
    await page.evaluate(() => {
      const confirmation = document.querySelector('#library').shadowRoot.querySelector('[data-delete-confirmation]');
      confirmation.shadowRoot.querySelector('[data-confirm]').click();
    });
    await page.waitForFunction(() => document.querySelector('#library').shadowRoot.querySelectorAll('.card').length === 3);
    const requests = await page.evaluate(() => globalThis.workspaceAssetRequests);
    const finalInsertEventCount = await page.evaluate(() => globalThis.workspaceAssetInsertEvents.length);
    assert.equal(requests.filter(request => request.method === 'PATCH' && request.path === '/api/workspace-assets/asset-1').length, 1);
    assert.equal(requests.filter(request => request.method === 'PATCH' && request.path === '/api/workspace-assets/folders/folder-2').length, 1);
    assert.equal(requests.filter(request => request.method === 'DELETE' && request.path === '/api/workspace-assets/asset-1').length, 1);
    assert.equal(requests.filter(request => request.method === 'DELETE' && request.path === '/api/workspace-assets/folders/folder-2').length, 1);
    assert.equal(requests.filter(request => request.method === 'POST' && request.path === '/api/workspace-assets/import').length, 1);
    assert.equal(finalInsertEventCount, 2, 'Card management actions must not dispatch insertion');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ initial, requests }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
