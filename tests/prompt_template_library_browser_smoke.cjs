const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('http://prompt-library.local/**', async route => {
    const requestPath = decodeURIComponent(new URL(route.request().url()).pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath)) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    await route.fulfill({ path: filePath });
  });

  try {
    await page.goto('http://prompt-library.local/tests/infinite_canvas_ui_prompt_template_library_browser_harness.html');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const dialog = page.locator('#libraryDialog');
    const library = page.locator('#library');
    await library.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await dialog.evaluate(element => element.open), true);
    const createTemplateEntry = library.locator('[part="new-card"]');
    assert.equal(await createTemplateEntry.innerText(), '创建新提示词模板');
    assert.deepEqual(await createTemplateEntry.evaluate(entry => {
      const entryRect = entry.getBoundingClientRect();
      const gridRect = entry.parentElement.getBoundingClientRect();
      return {
        compact:entryRect.height <= 64,
        fullWidth:Math.abs(entryRect.width - gridRect.width) <= 10,
        display:getComputedStyle(entry).display,
        borderStyle:getComputedStyle(entry).borderTopStyle,
      };
    }), { compact:true, fullWidth:true, display:'flex', borderStyle:'solid' });
    assert.deepEqual(await library.locator('[data-library-switch]').evaluate(control => ({
      localName:control.localName,
      combination:control.dataset.legalCombination,
      contract:control.dataset.icContractStatus,
      value:control.getAttribute('value'),
    })), { localName:'ic-segmented-control', combination:'single-label', contract:'ready', value:'canvas' });
    const librarySwitchStyles = await library.locator('[data-library-switch]').evaluate(async control => {
      const reference = document.createElement('ic-segmented-control');
      reference.setAttribute('label', 'Reference library');
      reference.setAttribute('value', 'canvas');
      reference.setAttribute('size', 'large');
      reference.dataset.legalCombination = 'single-label';
      reference.innerHTML = '<button data-value="canvas">当前画布</button><button data-value="common">通用</button>';
      document.body.append(reference);
      await customElements.whenDefined('ic-segmented-control');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const snapshot = element => {
        const host = getComputedStyle(element);
        const button = getComputedStyle(element.querySelector('[role="radio"]'));
        return {
          controlHeight:host.getPropertyValue('--ic-navigation-control-height').trim(),
          inlinePadding:host.getPropertyValue('--ic-navigation-inline-padding').trim(),
          fontSize:button.fontSize,
          buttonHeight:button.height,
          paddingInlineStart:button.paddingInlineStart,
          paddingInlineEnd:button.paddingInlineEnd,
          borderRadius:button.borderRadius,
        };
      };
      const result = {actual:snapshot(control), reference:snapshot(reference)};
      reference.remove();
      return result;
    });
    assert.deepEqual(librarySwitchStyles.actual, librarySwitchStyles.reference);
    assert.equal(await library.locator('[data-library-switch]').getAttribute('size'), 'large');
    const modalState = await dialog.evaluate(element => {
      const nativeDialog = element.dialog;
      const rect = nativeDialog.getBoundingClientRect();
      return { modal:nativeDialog.matches(':modal'), width:rect.width, height:rect.height };
    });
    assert.equal(modalState.modal, true);
    assert.equal(modalState.width, 1132);
    assert.equal(modalState.height, 752);
    assert.equal(await library.getAttribute('active-library'), 'canvas');
    assert.equal(await library.locator('[data-category-tabs]').count(), 0);
    assert.equal(await library.locator('ic-empty-state,[part="empty"]').count(), 0);
    await library.locator('[data-library-switch] > [data-value="common"]').click();
    assert.deepEqual(await library.locator('[data-category-tabs]').evaluate(tabs => ({
      localName:tabs.localName,
      combination:tabs.dataset.legalCombination,
      activation:tabs.getAttribute('activation'),
      orientation:tabs.getAttribute('orientation'),
    })), { localName:'ic-tabs', combination:'vertical-manual-label', activation:'manual', orientation:'vertical' });
    assert.equal(await library.locator('[data-category-tabs] > [aria-selected="true"]').getAttribute('data-value'), 'all');
    assert.equal(await library.locator('[part="manage"],[data-manage]').count(), 0);
    const cards = library.locator('[part="template-card"]');
    assert.equal(await cards.count(), 2);
    const searchCompositionStability = await library.evaluate(async element => {
      const search = element.shadowRoot.querySelector('[data-search]');
      const input = search.shadowRoot.querySelector('input');
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true, composed:true, data:''}));
      input.value = '广';
      input.setSelectionRange(1, 1);
      input.dispatchEvent(new InputEvent('input', {
        bubbles:true,
        composed:true,
        data:'广',
        inputType:'insertCompositionText',
        isComposing:true,
      }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const currentSearch = element.shadowRoot.querySelector('[data-search]');
      const currentInput = currentSearch.shadowRoot.querySelector('input');
      const result = {
        searchPreserved:currentSearch === search,
        inputPreserved:currentInput === input,
        inputFocused:currentSearch.shadowRoot.activeElement === currentInput,
        value:currentInput.value,
        selectionStart:currentInput.selectionStart,
        selectionEnd:currentInput.selectionEnd,
      };
      currentInput.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles:true,
        composed:true,
        data:'广',
      }));
      element.query = '';
      return result;
    });
    assert.deepEqual(searchCompositionStability, {
      searchPreserved:true,
      inputPreserved:true,
      inputFocused:true,
      value:'广',
      selectionStart:1,
      selectionEnd:1,
    });
    const transientStateStability = await library.evaluate(async element => {
      const snapshot = () => [...element.shadowRoot.querySelectorAll('[part="template-card"]')];
      const waitForPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const beforeSelection = snapshot();
      beforeSelection[0].querySelector('[part="template-select"]').click();
      await waitForPaint();
      const afterSelection = snapshot();
      const beforeBusy = afterSelection;
      element.busy = true;
      const busyAria = element.shadowRoot.querySelector('[part="workspace"]')?.getAttribute('aria-busy');
      await waitForPaint();
      element.busy = false;
      await waitForPaint();
      const afterBusy = snapshot();
      return {
        selectionPreserved:afterSelection.every((card, index) => card === beforeSelection[index]),
        busyPreserved:afterBusy.every((card, index) => card === beforeBusy[index]),
        busyAria,
        idleAria:element.shadowRoot.querySelector('[part="workspace"]')?.getAttribute('aria-busy'),
      };
    });
    assert.deepEqual(transientStateStability, {
      selectionPreserved:true,
      busyPreserved:true,
      busyAria:'true',
      idleAria:'false',
    });
    assert.deepEqual(await cards.evaluateAll(items => items.map(card => card.hasAttribute('aria-pressed'))), [false, false]);
    assert.equal(await cards.evaluateAll(items => items.every(card => {
      const cardRect = card.getBoundingClientRect();
      const previewRect = card.querySelector('[part="template-preview"]').getBoundingClientRect();
      const imageRect = card.querySelector('[part="template-preview"] img')?.getBoundingClientRect();
      const titleRect = card.querySelector('[part="template-name"]').getBoundingClientRect();
      return Math.abs(cardRect.width / cardRect.height - 1) < .01
        && Math.abs(previewRect.width - cardRect.width) <= 2
        && Math.abs(previewRect.height - cardRect.height) <= 2
        && (!imageRect || (Math.abs(imageRect.width - previewRect.width) <= 1
          && Math.abs(imageRect.height - previewRect.height) <= 1))
        && titleRect.top > cardRect.top + cardRect.height * .6
        && titleRect.bottom <= cardRect.bottom;
    })), true);
    assert.equal(await cards.first().locator('[part="template-mask"]').evaluate(mask => {
      const style = getComputedStyle(mask);
      return style.pointerEvents === 'none'
        && style.height === '64px'
        && style.backgroundImage.startsWith('linear-gradient(')
        && style.backgroundImage !== 'none';
    }), true);
    assert.deepEqual(await cards.first().evaluate(card => {
      const meta = card.querySelector('[part="template-meta"]');
      const divider = getComputedStyle(meta, '::before');
      return {
        paddingTop:getComputedStyle(meta).paddingTop,
        dividerContent:divider.content,
        titleFontSize:getComputedStyle(card.querySelector('[part="template-name"]')).fontSize,
      };
    }), {
      paddingTop:'13px',
      dividerContent:'none',
      titleFontSize:'16px',
    });
    const noCoverCard = library.locator('[part="template-card"][data-no-cover]');
    assert.equal(await noCoverCard.count(), 1);
    assert.equal(await noCoverCard.getAttribute('data-no-cover'), '');
    const noCoverVisual = await noCoverCard.evaluate(card => {
      const preview = card.querySelector('[part="template-preview"]');
      const excerpt = preview.querySelector('p');
      const meta = card.querySelector('[part="template-meta"]');
      const edit = card.querySelector('[part="template-actions"] ic-icon-button');
      const editBase = edit.shadowRoot.querySelector('[part~="base"]');
      const grid = getComputedStyle(preview, '::before');
      const quote = getComputedStyle(preview, '::after');
      const rgb = getComputedStyle(preview).backgroundColor.match(/[\d.]+/g).map(Number);
      const luminance = rgb.slice(0, 3).map(channel => {
        const value = channel / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      return {
        background:getComputedStyle(preview).backgroundColor,
        gridSize:grid.backgroundSize,
        gridLayers:grid.backgroundImage.match(/linear-gradient/g)?.length || 0,
        gridMask:grid.maskImage,
        quote:quote.content,
        quoteLeft:quote.left,
        quoteTop:quote.top,
        excerptColor:getComputedStyle(excerpt).color,
        excerptFontSize:getComputedStyle(excerpt).fontSize,
        excerptLineHeight:getComputedStyle(excerpt).lineHeight,
        excerptLineClamp:getComputedStyle(excerpt).webkitLineClamp,
        excerptMask:getComputedStyle(excerpt).maskImage,
        excerptOverflowing:excerpt.scrollHeight > excerpt.clientHeight,
        excerptPadding:getComputedStyle(excerpt).padding,
        excerptBottom:getComputedStyle(excerpt).bottom,
        metaPaddingTop:getComputedStyle(meta).paddingTop,
        dividerContent:getComputedStyle(meta, '::before').content,
        titleFontSize:getComputedStyle(card.querySelector('[part="template-name"]')).fontSize,
        maskDisplay:getComputedStyle(card.querySelector('[part="template-mask"]')).display,
        cardRadius:getComputedStyle(card).borderRadius,
        editSize:getComputedStyle(edit).width,
        editColor:getComputedStyle(edit).color,
        editBackground:getComputedStyle(editBase).backgroundColor,
        editBorder:getComputedStyle(editBase).borderTopWidth,
        whiteContrast:1.05 / (luminance + .05),
      };
    });
    assert.deepEqual({...noCoverVisual, whiteContrast:undefined}, {
      background:'rgb(101, 112, 97)',
      gridSize:'28px 28px, 28px 28px',
      gridLayers:2,
      gridMask:'linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0) 72%)',
      quote:'"“"',
      quoteLeft:'18px',
      quoteTop:'11px',
      excerptColor:'rgba(255, 255, 255, 0.8)',
      excerptFontSize:'14px',
      excerptLineHeight:'28px',
      excerptLineClamp:'none',
      excerptMask:'linear-gradient(rgb(0, 0, 0) 0px, rgb(0, 0, 0) calc(100% - 10px), rgba(0, 0, 0, 0) 100%)',
      excerptOverflowing:true,
      excerptPadding:'0px',
      excerptBottom:'76px',
      metaPaddingTop:'13px',
      dividerContent:'none',
      titleFontSize:'17px',
      maskDisplay:'none',
      cardRadius:'13px',
      editSize:'34px',
      editColor:'rgb(255, 255, 255)',
      editBackground:'rgba(0, 0, 0, 0)',
      editBorder:'0px',
      whiteContrast:undefined,
    });
    assert.ok(noCoverVisual.whiteContrast >= 4.5, JSON.stringify(noCoverVisual));
    const themeVisuals = {};
    for (const theme of ['light', 'dark']) {
      themeVisuals[theme] = await library.evaluate(async (element, activeTheme) => {
        document.documentElement.dataset.uiTheme = activeTheme;
        document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
        document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
        document.body.classList.toggle('theme-dark', activeTheme === 'dark');
        document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const workspace = element.shadowRoot.querySelector('[part="workspace"]');
        return {background:getComputedStyle(workspace).backgroundColor, color:getComputedStyle(workspace).color};
      }, theme);
      await page.screenshot({path:`/tmp/t35-prompt-template-library-${theme}.png`, fullPage:false});
    }
    assert.notEqual(themeVisuals.light.background, themeVisuals.dark.background);
    assert.notEqual(themeVisuals.light.color, themeVisuals.dark.color);
    await library.evaluate(async () => {
      document.documentElement.dataset.uiTheme = 'light';
      document.documentElement.classList.remove('theme-dark', 'studio-theme-dark');
      document.body.classList.remove('theme-dark', 'studio-theme-dark');
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    await library.locator('[data-template-edit="wide"]').hover();
    await page.waitForFunction(() => document.querySelector('ic-tooltip[open]')?.getAttribute('content') === '编辑模板');
    const tooltip = page.locator('ic-tooltip[open]');
    assert.equal(await tooltip.getAttribute('placement'), 'block-start');
    assert.equal(await tooltip.evaluate(element => element.shadowRoot.querySelector('[role="tooltip"]').getBoundingClientRect().width > 0), true);
    assert.equal(await library.locator('[data-template-edit="wide"]').evaluate(button => (
      getComputedStyle(button).getPropertyValue('--ic-icon-context-stroke-width').trim()
    )), '1.5');
    const secondaryIconVisual = await library.locator('[data-template-edit="wide"]').evaluate(button => {
      const base = button.shadowRoot.querySelector('[part~="base"]');
      const style = getComputedStyle(base);
      return {
        width:getComputedStyle(button).width,
        color:getComputedStyle(button).color,
        backgroundColor:style.backgroundColor,
        borderWidth:style.borderTopWidth,
      };
    });
    assert.deepEqual(secondaryIconVisual, {
      width:'34px',
      color:'rgb(255, 255, 255)',
      backgroundColor:'rgba(0, 0, 0, 0)',
      borderWidth:'0px',
    });
    assert.deepEqual(await noCoverCard.locator('[part="template-actions"] ic-icon-button').evaluate(button => {
      const base = button.shadowRoot.querySelector('[part~="base"]');
      return {
        width:getComputedStyle(button).width,
        color:getComputedStyle(button).color,
        backgroundColor:getComputedStyle(base).backgroundColor,
        borderWidth:getComputedStyle(base).borderTopWidth,
      };
    }), secondaryIconVisual);
    assert.equal(await library.locator('[part="template-actions"] [data-template-delete]').count(), 0);
    const templateActionGeometry = await library.locator('[part="template-card"]').first()
      .locator('[part="template-actions"]')
      .evaluate(actions => [...actions.children].map(button => {
        const buttonRect = button.getBoundingClientRect();
        const iconRect = button.querySelector('ic-icon').getBoundingClientRect();
        const base = button.shadowRoot.querySelector('[part~="base"]');
        const baseRect = base.getBoundingClientRect();
        return {
          tagName:button.localName,
          width:buttonRect.width,
          height:buttonRect.height,
          borderRadius:getComputedStyle(base).borderRadius,
          baseWidth:baseRect.width,
          baseHeight:baseRect.height,
          iconOffsetX:Math.abs((iconRect.left + iconRect.width / 2) - (buttonRect.left + buttonRect.width / 2)),
          iconOffsetY:Math.abs((iconRect.top + iconRect.height / 2) - (buttonRect.top + buttonRect.height / 2)),
        };
      }));
    assert.deepEqual(templateActionGeometry.map(action => action.tagName), [
      'ic-icon-button',
    ]);
    for (const action of templateActionGeometry) {
      assert.ok(Math.abs(action.width - action.height) <= 0.1, JSON.stringify(action));
      assert.ok(Math.abs(action.baseWidth - action.width) <= 0.1, JSON.stringify(action));
      assert.ok(Math.abs(action.baseHeight - action.height) <= 0.1, JSON.stringify(action));
      assert.equal(action.borderRadius, '9999px');
      assert.ok(action.iconOffsetX <= 0.5, JSON.stringify(action));
      assert.ok(action.iconOffsetY <= 0.5, JSON.stringify(action));
    }

    await page.evaluate(() => { window.canvasShortcutKeys = []; });
    await library.locator('[part="close"]').focus();
    await page.keyboard.press('t');
    assert.deepEqual(await page.evaluate(() => window.canvasShortcutKeys), []);

    await library.locator('[data-category-tabs] > [data-value="light"]').click();
    assert.equal(await cards.count(), 1);
    assert.equal(await cards.first().getAttribute('data-template-id'), 'soft');
    await library.locator('[data-category-tabs] > [data-value="all"]').click();
    assert.equal(await cards.count(), 2);

    const search = library.locator('[part="search-input"] input');
    await search.fill('柔光');
    assert.equal(await cards.count(), 1);
    assert.equal(await cards.first().getAttribute('data-template-id'), 'soft');
    await library.locator('[part="search-clear"]').click();
    assert.equal(await cards.count(), 2);

    assert.equal(await library.getAttribute('active-category'), 'all');
    await library.locator('[data-category-item="view"]').hover();
    await page.waitForTimeout(180);
    assert.deepEqual(await library.locator('[data-category-item="view"] [part="category-actions"]').evaluate(actions => ({
      opacity:getComputedStyle(actions).opacity,
      visibility:getComputedStyle(actions).visibility,
      buttons:actions.querySelectorAll('ic-icon-button').length,
    })), { opacity:'1', visibility:'visible', buttons:2 });
    await library.locator('[data-category-edit="view"]').click();
    assert.equal(await library.getAttribute('active-category'), 'all');
    const categoryName = library.locator('[data-category-editor-name] input');
    assert.equal(await library.locator('[data-category-item="view"] [part="category-label"]').count(), 0);
    assert.deepEqual(await library.locator('[part="category-rename-field"]').evaluate(field => ({
      componentName:field.dataset.componentName,
      height:field.querySelector('ic-input').getBoundingClientRect().height,
      focused:field.querySelector('ic-input').matches(':focus-within'),
    })), { componentName:'ic-form-field-text-s', height:28, focused:true });
    assert.equal(await library.locator('[data-category-item="view"] [part="category-actions"]').count(), 0);
    assert.equal(await library.locator('[part="library-layout"]').count(), 1);
    assert.equal(await library.locator('[part="library-view"]').getAttribute('inert'), null);
    assert.equal(await library.locator('[part="task-layer"]').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('[part="category-rename-field"]').count(), 0);
    assert.equal(await library.locator('[part="library-layout"]').count(), 1);
    assert.equal(await library.locator('[part="library-view"]').getAttribute('inert'), null);
    await library.locator('[data-category-item="view"]').hover();
    await library.locator('[data-category-edit="view"]').click();
    await categoryName.fill('镜头语言');
    await library.locator('[part="library-title"]').first().click();
    await page.waitForFunction(() => !document.querySelector('#library').shadowRoot.querySelector('[part="category-rename-field"]'));
    assert.deepEqual(await page.evaluate(() => window.events.findLast(item => item.type === 'ic-category-edit').detail), {
      libraryId:'common', categoryId:'view', name:'镜头语言',
    });
    assert.equal(await library.locator('[data-category-item="view"] > [part="category-label"]').innerText(), '镜头语言');
    await library.locator('[part="category-add"]').click();
    assert.equal(await library.locator('[part="category-add-editor"] [data-category-editor-name]').count(), 1);
    assert.equal(await library.locator('[part="task-layer"]').count(), 0);
    assert.equal(await library.locator('[part="category-add-editor"] [data-category-editor-name]').getAttribute('placeholder'), '请输入分组名');
    assert.equal(await categoryName.inputValue(), '');
    await categoryName.fill('新分组');
    await page.keyboard.press('Enter');
    assert.equal(await library.locator('[data-category-item]').count(), 3);
    assert.equal(await library.locator('[data-category-item]').last().locator('[part="category-label"]').innerText(), '新分组');
    assert.equal(await library.locator('[data-category-tabs]').evaluate(tabs => tabs.lastElementChild?.getAttribute('part')), 'category-add');
    assert.equal(await library.locator('[data-category-move]').count(), 0);
    assert.deepEqual(await library.locator('[part="category-drag"] ic-icon').evaluateAll(icons => icons.map(icon => icon.getAttribute('name'))), ['drag', 'drag', 'drag']);
    const dragSourceHandle = library.locator('[data-category-item="view"] [data-category-drag]');
    await dragSourceHandle.evaluate(handle => {
      handle.removeAttribute('draggable');
      handle.closest('[data-category-item]').removeAttribute('draggable');
    });
    const dragSourceBox = await dragSourceHandle.boundingBox();
    const dragTargetBox = await library.locator('[data-category-item="light"] [data-category-drag]').boundingBox();
    assert.ok(dragSourceBox && dragTargetBox);
    const dragSource = { x:dragSourceBox.x + dragSourceBox.width / 2, y:dragSourceBox.y + dragSourceBox.height / 2 };
    const dragTarget = { x:dragTargetBox.x + dragTargetBox.width / 2, y:dragTargetBox.y + dragTargetBox.height / 2 };
    await page.mouse.move(dragSource.x, dragSource.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(
        dragSource.x + (dragTarget.x - dragSource.x) * step / 6,
        dragSource.y + (dragTarget.y - dragSource.y) * step / 6,
      );
    }
    const dragPreview = library.locator('[part="category-drag-preview"]');
    assert.equal(await dragPreview.count(), 1);
    assert.deepEqual(await dragPreview.evaluate(preview => {
      const style = getComputedStyle(preview);
      const rect = preview.getBoundingClientRect();
      return {
        position:style.position,
        pointerEvents:style.pointerEvents,
        visible:style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0,
      };
    }), { position:'fixed', pointerEvents:'none', visible:true });
    await page.mouse.up();
    assert.equal(await dragPreview.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.events.findLast(item => item.type === 'ic-template-reorder').detail.categoryIds), ['light', 'view', 'created']);

    await library.locator('[data-category-tabs] > [data-value="all"]').click();
    const templateDragSource = library.locator('[data-template-id="soft"]');
    const templateDropTarget = library.locator('[data-category-item="view"]');
    await library.evaluate(element => {
      const source = element.shadowRoot.querySelector('[data-template-id="soft"]');
      const target = element.shadowRoot.querySelector('[data-category-item="view"]');
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles:true, composed:true, dataTransfer:transfer, clientX:sourceRect.left + sourceRect.width / 2, clientY:sourceRect.top + sourceRect.height / 2 }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles:true, composed:true, cancelable:true, dataTransfer:transfer, clientX:targetRect.left + targetRect.width / 2, clientY:targetRect.top + targetRect.height / 2 }));
      window.promptTemplateDragTransfer = transfer;
    });
    assert.deepEqual(await library.locator('[part="template-drag-preview"]').evaluate(preview => ({
      visible:getComputedStyle(preview).visibility !== 'hidden' && Number(getComputedStyle(preview).opacity) > 0,
      pointerEvents:getComputedStyle(preview).pointerEvents,
      magnetized:preview.hasAttribute('data-magnetized'),
      status:preview.querySelector('[data-template-drag-status]').textContent,
      sourceDimmed:Boolean(preview.getRootNode().querySelector('[data-template-id="soft"][data-template-dragging]')),
      targetHighlighted:Boolean(preview.getRootNode().querySelector('[data-category-item="view"][data-template-drop-target]')),
    })), { visible:true, pointerEvents:'none', magnetized:true, status:'松开即移动·镜头语言', sourceDimmed:true, targetHighlighted:true });
    await library.evaluate(element => {
      const target = element.shadowRoot.querySelector('[data-category-item="view"]');
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('drop', { bubbles:true, composed:true, cancelable:true, dataTransfer:window.promptTemplateDragTransfer, clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2 }));
    });
    assert.equal(await library.locator('[part="template-drag-preview"][data-releasing]').count(), 1);
    await page.waitForFunction(() => window.events.findLast(item => item.type === 'ic-template-move')?.detail?.templateId === 'soft');
    assert.deepEqual(await page.evaluate(() => window.events.findLast(item => item.type === 'ic-template-move').detail), {
      libraryId:'common', templateId:'soft', categoryId:'view',
    });
    await page.waitForTimeout(240);
    assert.equal(await library.locator('[part="template-drag-preview"]').count(), 0);
    assert.equal(await library.locator('[data-template-id="soft"]').count(), 1);
    await library.locator('[data-category-tabs] > [data-value="all"]').click();
    await library.locator('[data-template-id="wide"]').dragTo(library.locator('[data-category-item="light"]'));
    await page.waitForFunction(() => window.events.findLast(item => item.type === 'ic-template-move')?.detail?.templateId === 'wide');
    assert.deepEqual(await page.evaluate(() => window.events.findLast(item => item.type === 'ic-template-move').detail), {
      libraryId:'common', templateId:'wide', categoryId:'light',
    });

    await library.locator('[part="new-card"]').click();
    assert.deepEqual(await library.locator('[part~="editor-preview"] ic-media-container').evaluate(media => ({
      fit:media.getAttribute('fit'),
      aspect:media.getAttribute('aspect'),
      state:media.getAttribute('state'),
    })), { fit:'cover', aspect:'auto', state:'unavailable' });
    assert.deepEqual(await library.locator('[part="editor"]').evaluate(editor => [
      ...editor.querySelectorAll('[data-editor-field], [data-editor-cover-input], [data-editor-cancel], [data-editor-save]'),
    ].map(control => control.localName)), [
      'ic-file-input', 'ic-input', 'ic-textarea', 'ic-button', 'ic-button',
    ]);
    const editorVisual = await library.locator('[part="editor"]').evaluate(editor => {
      const rect = element => element.getBoundingClientRect();
      const preview = rect(editor.querySelector('[part~="editor-preview"]'));
      const fields = rect(editor.querySelector('[part="editor-fields"]'));
      const footer = rect(editor.querySelector('[part="editor-preview-footer"]'));
      const name = rect(editor.querySelector('[data-editor-preview-name]'));
      const choose = rect(editor.querySelector('[data-editor-cover-choose]'));
      const fieldStyle = getComputedStyle(editor.querySelector('[part="editor-fields"]'));
      const editorStyle = getComputedStyle(editor);
      const taskLayerStyle = getComputedStyle(editor.closest('[part="task-layer"]'));
      return {
        width:rect(editor).width,
        previewHeight:preview.height,
        columnsTopDelta:Math.abs(preview.top - fields.top),
        columnsBottomDelta:Math.abs(preview.bottom - fields.bottom),
        footerAlignmentDelta:Math.abs((name.top + name.height / 2) - (choose.top + choose.height / 2)),
        fieldsPadding:[fieldStyle.paddingTop,fieldStyle.paddingRight,fieldStyle.paddingBottom,fieldStyle.paddingLeft],
        surfaceBackground:editorStyle.backgroundColor,
        surfaceBorder:editorStyle.borderTopWidth,
        surfaceRadius:editorStyle.borderRadius,
        surfaceShadow:editorStyle.boxShadow,
        taskLayerBackground:taskLayerStyle.backgroundColor,
        taskLayerBlur:taskLayerStyle.backdropFilter,
        hasCharacterLimit:Boolean(editor.querySelector('[maxlength],[data-character-count]')) || editor.textContent.includes('/ 4000'),
      };
    });
    assert.equal(editorVisual.width, 940);
    assert.ok(editorVisual.previewHeight >= 440, JSON.stringify(editorVisual));
    assert.ok(editorVisual.columnsTopDelta <= .5, JSON.stringify(editorVisual));
    assert.ok(editorVisual.columnsBottomDelta <= .5, JSON.stringify(editorVisual));
    assert.ok(editorVisual.footerAlignmentDelta <= .5, JSON.stringify(editorVisual));
    assert.deepEqual(editorVisual.fieldsPadding, ['0px','0px','0px','0px']);
    assert.equal(editorVisual.surfaceBackground, 'rgb(255, 255, 255)');
    assert.equal(editorVisual.surfaceBorder, '1px');
    assert.notEqual(editorVisual.surfaceRadius, '0px');
    assert.notEqual(editorVisual.surfaceShadow, 'none');
    assert.notEqual(editorVisual.taskLayerBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(editorVisual.taskLayerBlur, 'blur(7px)');
    assert.equal(editorVisual.hasCharacterLimit, false);
    assert.equal(await library.locator('[part="library-layout"]').count(), 1);
    assert.equal(await library.locator('[part="library-view"]').getAttribute('inert'), '');
    await library.locator('[data-editor-name] input').fill('实时模板名称');
    await library.locator('[data-editor-positive] textarea').fill('左侧预览跟随右侧输入实时变化');
    assert.deepEqual(await library.locator('[part~="editor-preview"]').evaluate(preview => ({
      name:preview.querySelector('[data-editor-preview-name]').textContent,
      prompt:preview.querySelector('[data-editor-preview-prompt]').textContent,
    })), { name:'实时模板名称', prompt:'左侧预览跟随右侧输入实时变化' });
    const chooserPromise = page.waitForEvent('filechooser');
    await library.locator('[data-editor-cover-choose]').click();
    await chooserPromise;
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('[part="editor"]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await library.locator('[part="editor"]').count(), 0);
    assert.equal(await library.locator('[part="task-layer"]').count(), 0);
    assert.equal(await library.locator('[part="library-view"]').getAttribute('inert'), null);

    await library.locator('[part="new-card"]').click();
    await library.locator('[data-editor-name] input').fill('新建模板');
    await library.locator('[data-editor-positive] textarea').fill('组件库拼装的模板内容');
    await library.locator('[data-editor-save]').click();
    assert.equal(await library.locator('[data-template-id="created-template"]').count(), 1);

    await library.locator('[data-template-edit="created-template"]').click();
    await library.locator('[data-editor-delete]').click();
    const templateConfirmation = library.locator('[data-template-delete-confirmation]');
    assert.equal(await templateConfirmation.getAttribute('open'), '');
    assert.equal(await library.locator('[part="editor"]').count(), 1);
    assert.equal(await library.locator('[part="workspace"][data-task]').count(), 1);
    assert.equal(await library.locator('[part="library-layout"]').count(), 1);
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-template-delete').length), 0);
    await page.keyboard.press('Escape');
    assert.equal(await templateConfirmation.getAttribute('open'), null);
    assert.equal(await library.locator('[part="editor"]').count(), 1);
    assert.equal(await library.evaluate(element => element.templates.some(item => item.id === 'created-template')), true);
    await library.locator('[data-editor-delete]').click();
    await templateConfirmation.evaluate(popover => popover.shadowRoot.querySelector('[data-confirm]').click());
    assert.equal(await library.locator('[data-template-id="created-template"]').count(), 0);

    await library.locator('[data-category-item="light"]').hover();
    await library.locator('[data-category-delete="light"]').click();
    const groupConfirmation = library.locator('[data-category-delete-confirmation]');
    assert.equal(await groupConfirmation.getAttribute('open'), '');
    assert.equal(await groupConfirmation.getAttribute('label'), '删除“光影”分组？');
    assert.equal(await groupConfirmation.getAttribute('description'), '组内 1 个提示词会移至“未分类”，模板本身不会删除。');
    assert.deepEqual(await groupConfirmation.evaluate(popover => ({
      contract:popover.dataset.icContractStatus,
      role:popover.shadowRoot.querySelector('[part="surface"]').getAttribute('role'),
      initialFocus:popover.shadowRoot.activeElement?.hasAttribute('data-cancel'),
      borderUsesToken:popover.shadowRoot.querySelector('style').textContent.includes('var(--ui-color-border-secondary)'),
      actions:[...popover.shadowRoot.querySelectorAll('[part="actions"] ic-button')].map(button => button.tone),
    })), { contract:'ready', role:'alertdialog', initialFocus:true, borderUsesToken:true, actions:['neutral','danger'] });
    await groupConfirmation.evaluate(popover => popover.cancel('test-cancel'));
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-category-delete').length), 0);
    await library.locator('[data-category-item="light"]').hover();
    await library.locator('[data-category-delete="light"]').click();
    await groupConfirmation.evaluate(popover => popover.shadowRoot.querySelector('[data-confirm]').click());
    assert.deepEqual(await page.evaluate(() => window.events.findLast(item => item.type === 'ic-category-delete').detail), {
      libraryId:'common', categoryId:'light',
    });
    assert.equal(await library.locator('[data-category-item="light"]').count(), 0);
    assert.equal(await library.locator('[data-category-item="uncategorized"] [part="category-label"]').innerText(), '未分类');
    assert.equal(await library.locator('[data-category-item="uncategorized"] [part="category-actions"]').count(), 0);
    assert.equal(await library.evaluate(element => element.templates.find(item => item.id === 'soft').category), 'uncategorized');

    await library.locator('[data-category-tabs] > [data-value="all"]').click();
    const selectCount = await page.evaluate(() => window.events.filter(item => item.type === 'ic-template-select').length);
    await library.locator('[data-template-id="wide"] [part="template-select"]').click();
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-template-select').length), selectCount + 1);
    assert.equal(await library.getAttribute('selected-template'), 'wide');
    await library.evaluate(element => {
      element.templates = [...element.templates, {id:'canvas-card', libraryId:'canvas', category:'', name:'当前画布模板', positive:'当前画布提示词', cover:'/static/images/favicon.png'}];
    });
    await library.locator('[data-library-switch] > [data-value="canvas"]').click();
    assert.equal(await cards.count(), 1);
    assert.equal(await cards.first().getAttribute('data-template-id'), 'canvas-card');
    assert.equal(await library.locator('[data-category-tabs]').count(), 0);
    await cards.first().click();
    assert.equal(await library.getAttribute('selected-template'), 'canvas-card');
    assert.equal(await library.locator('[data-template-copy],[data-template-promote]').count(), 0);

    await library.locator('[part="close"]').click();
    await page.waitForFunction(() => !document.querySelector('#libraryDialog')?.open);
    const emittedTypes = await page.evaluate(() => window.events.map(item => item.type));
    for (const type of ['ic-library-change','ic-category-change','ic-category-edit','ic-category-create','ic-category-delete','ic-template-reorder','ic-template-move','ic-template-create','ic-template-delete','ic-template-select','ic-close']) {
      assert.ok(emittedTypes.includes(type), `${type} was not emitted: ${emittedTypes.join(',')}`);
    }
    assert.deepEqual(errors, []);
    process.stdout.write('Prompt template library browsing smoke passed.\n');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
