const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};

function startServer(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const filePath = path.resolve(ROOT, `.${requestPath}`);
      if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
      fs.readFile(filePath, (error, body) => {
        if(error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        response.writeHead(200, {'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream'}).end(body);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async()=>{
  if(!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  const context = await browser.newContext({viewport:{width:1180,height:760}});
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => { if(message.type() === 'error') browserErrors.push(message.text()); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/design-system/infinite-canvas-ui/selection-adjustment-case.html?theme=light&viewport=desktop&locale=zh-CN`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.documentElement.dataset.selectionAdjustmentCaseStatus === 'ready', null, {timeout:30000}).catch(async error => {
      const state = await page.evaluate(() => ({
        status:document.documentElement.dataset.selectionAdjustmentCaseStatus,
        caseStatus:document.querySelector('[data-case-status]')?.textContent,
        pickerStatus:document.querySelector('ic-generation-settings-picker')?.dataset.icContractStatus,
        pickerReason:document.querySelector('ic-generation-settings-picker')?.dataset.icContractReason,
      }));
      throw new Error(`${error.message}\nstate=${JSON.stringify(state)}\nbrowserErrors=${JSON.stringify(browserErrors)}`);
    });
    const initial = await page.locator('ic-generation-settings-picker').evaluate(picker => {
      const trigger = picker.shadowRoot.querySelector('[part="trigger"]');
      return {
        status:picker.dataset.icContractStatus,
        text:trigger.textContent.trim(),
        height:trigger.getBoundingClientRect().height,
        open:picker.open,
        aspectTag:picker.shadowRoot.querySelector('ic-aspect-ratio-picker')?.localName,
      };
    });
    assert.deepEqual(initial, {status:'ready', text:'原图(1:1) / 4k / 自动', height:32, open:false, aspectTag:'ic-aspect-ratio-picker'});

    await page.locator('ic-generation-settings-picker').evaluate(picker => picker.shadowRoot.querySelector('[part="trigger"]').click());
    const opened = await page.locator('ic-generation-settings-picker').evaluate(picker => {
      const panel = picker.shadowRoot.querySelector('[part="panel"]');
      const aspect = picker.shadowRoot.querySelector('ic-aspect-ratio-picker');
      const source = aspect.shadowRoot.querySelector('[data-value="source"]').getBoundingClientRect();
      const square = aspect.shadowRoot.querySelector('[data-value="square"]').getBoundingClientRect();
      const selectedSegments = [
        picker.shadowRoot.querySelector('[data-resolution][aria-checked="true"]'),
        picker.shadowRoot.querySelector('[data-quality][aria-checked="true"]'),
      ];
      const tokenProbe = document.createElement('span');
      tokenProbe.style.backgroundColor = 'var(--ui-color-action-secondary)';
      tokenProbe.style.border = '1px solid var(--ui-color-border-primary)';
      tokenProbe.style.boxShadow = 'var(--ui-shadow-raised)';
      tokenProbe.style.borderRadius = 'var(--ui-radius-s)';
      document.body.append(tokenProbe);
      const probeStyle = getComputedStyle(tokenProbe);
      const expectedSelected = {
        background: probeStyle.backgroundColor,
        border: probeStyle.borderTopColor,
        shadow: probeStyle.boxShadow,
      };
      const expectedPanelRadius = probeStyle.borderRadius;
      const selectedTokensMatch = selectedSegments.every(segment => {
        const style = getComputedStyle(segment);
        return style.backgroundColor === expectedSelected.background
          && style.borderTopColor === expectedSelected.border
          && style.boxShadow === expectedSelected.shadow;
      });
      tokenProbe.remove();
      return {
        open:picker.open,
        headings:[...picker.shadowRoot.querySelectorAll('.setting-label')].map(item => item.textContent.trim()),
        panelVisible:getComputedStyle(panel).display !== 'none',
        topLayer:panel.matches(':popover-open'),
        sourceLeftOfGrid:source.right <= square.left + 1,
        panelInsideViewport:panel.getBoundingClientRect().left >= 0 && panel.getBoundingClientRect().right <= innerWidth,
        selectedTokensMatch,
        panelRadiusMatches:getComputedStyle(panel).borderRadius === expectedPanelRadius,
        segmentsRadiusMatches:[...picker.shadowRoot.querySelectorAll('.segments')].every(segments => getComputedStyle(segments).borderRadius === expectedPanelRadius),
        aspectOptionsRadiusMatches:getComputedStyle(aspect.shadowRoot.querySelector('.options')).borderRadius === expectedPanelRadius,
      };
    });
    assert.deepEqual(opened, {open:true, headings:['比例','分辨率','质量'], panelVisible:true, topLayer:true, sourceLeftOfGrid:true, panelInsideViewport:true, selectedTokensMatch:true, panelRadiusMatches:true, segmentsRadiusMatches:true, aspectOptionsRadiusMatches:true});

    const durationVariant = await page.evaluate(async () => {
      const picker = document.createElement('ic-generation-settings-picker');
      picker.setAttribute('label', '视频画幅画质');
      picker.setAttribute('ratio', '16:9');
      picker.setAttribute('ratio-presets', '16:9,9:16,1:1');
      picker.setAttribute('resolution', '720p');
      picker.setAttribute('resolutions', '720p,1080p');
      picker.setAttribute('hide-quality', '');
      picker.setAttribute('duration', '4');
      picker.setAttribute('duration-min', '4');
      picker.setAttribute('duration-max', '15');
      picker.setAttribute('duration-label', '时长');
      document.body.append(picker);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const tokenProbe = document.createElement('span');
      tokenProbe.style.color = 'var(--ui-color-border-tertiary)';
      document.body.append(tokenProbe);
      const durationValue = picker.shadowRoot.querySelector('.duration-value');
      const durationLabel = picker.shadowRoot.querySelector('[data-duration-label]');
      const durationTick = picker.shadowRoot.querySelector('.duration-tick');
      const result = {
        text:picker.shadowRoot.querySelector('[part="trigger"]').textContent.trim(),
        ticks:picker.shadowRoot.querySelectorAll('.duration-tick').length,
        labels:[...picker.shadowRoot.querySelectorAll('[data-duration-label]')].map(label => label.textContent.trim()),
        ariaValueText:picker.shadowRoot.querySelector('.duration-slider').getAttribute('aria-valuetext'),
        valueFontSize:getComputedStyle(durationValue).fontSize,
        labelFontSize:getComputedStyle(durationLabel).fontSize,
        tickSize:getComputedStyle(durationTick).width,
        tickColor:getComputedStyle(durationTick).backgroundColor,
        subtleBorderColor:getComputedStyle(tokenProbe).color,
      };
      tokenProbe.remove();
      picker.remove();
      return result;
    });
    assert.deepEqual(durationVariant, {text:'16:9 / 720p / 4s', ticks:12, labels:['4s','6s','8s','10s','12s','14s'], ariaValueText:'4 秒', valueFontSize:'14px', labelFontSize:'14px', tickSize:'5px', tickColor:durationVariant.subtleBorderColor, subtleBorderColor:durationVariant.subtleBorderColor});

    await page.locator('ic-generation-settings-picker').evaluate(picker => {
      picker.shadowRoot.querySelector('ic-aspect-ratio-picker').shadowRoot.querySelector('[data-value="square"]').click();
    });
    await page.locator('ic-generation-settings-picker').evaluate(picker => picker.shadowRoot.querySelector('[data-resolution="4k"]').click());
    await page.locator('ic-generation-settings-picker').evaluate(picker => picker.shadowRoot.querySelector('[data-quality="high"]').click());
    const selected = await page.locator('ic-generation-settings-picker').evaluate(picker => ({
      ratio:picker.ratio,
      resolution:picker.resolution,
      quality:picker.quality,
      text:picker.shadowRoot.querySelector('[part="trigger"]').textContent.trim(),
      open:picker.open,
    }));
    assert.deepEqual(selected, {ratio:'square', resolution:'4k', quality:'high', text:'1:1 / 4k / 高', open:true});

    await page.locator('ic-generation-settings-picker').evaluate(picker => picker.shadowRoot.querySelector('[part="trigger"]').click());
    const closedByTrigger = await page.locator('ic-generation-settings-picker').evaluate(picker => picker.open);
    assert.equal(closedByTrigger, false);
    await page.locator('ic-generation-settings-picker').evaluate(picker => picker.shadowRoot.querySelector('[part="trigger"]').click());
    await page.getByRole('heading', {name:'MOD · RAT'}).click();
    const closedByOutsideClick = await page.locator('ic-generation-settings-picker').evaluate(picker => picker.open);
    assert.equal(closedByOutsideClick, false);

    const count = await page.locator('ic-select[data-component-variant="generation-count"]').evaluate(select => ({
      status:select.dataset.icContractStatus,
      value:select.value,
      height:select.shadowRoot.querySelector('[part="combobox"]').getBoundingClientRect().height,
    }));
    assert.deepEqual(count, {status:'ready', value:'1', height:32});

    await page.locator('ic-select[data-component-variant="generation-count"]').evaluate(select => { void select.show(); });
    const countLayout = await page.locator('ic-select[data-component-variant="generation-count"]').evaluate(select => {
      const listbox = select.shadowRoot.querySelector('[part~="listbox"]');
      const slot = listbox.querySelector('slot');
      const optionRects = [...select.querySelectorAll('wa-option')].map(option => option.getBoundingClientRect());
      return {
        display:getComputedStyle(slot).display,
        columns:[...new Set(optionRects.map(rect => Math.round(rect.x)))].length,
        rows:[...new Set(optionRects.map(rect => Math.round(rect.y)))].length,
        optionCount:optionRects.length,
      };
    });
    assert.deepEqual(countLayout, {display:'grid', columns:2, rows:4, optionCount:8});
    await page.locator('ic-select[data-component-variant="generation-count"] wa-option').nth(1).click();
    const countClosedAfterSelection = await page.locator('ic-select[data-component-variant="generation-count"]').evaluate(select => select.open);
    assert.equal(countClosedAfterSelection, false);

    await page.locator('ic-select[data-component-variant="model-picker"]').evaluate(select => { void select.show(); });
    await page.locator('ic-select[data-component-variant="model-picker"] wa-option').nth(1).click();
    const modelClosedAfterSelection = await page.locator('ic-select[data-component-variant="model-picker"]').evaluate(select => select.open);
    assert.equal(modelClosedAfterSelection, false);

    await page.screenshot({path:'/tmp/t35-generation-settings-picker-light.png', fullPage:true});
    await page.goto(`${origin}/static/design-system/infinite-canvas-ui/selection-adjustment-case.html?theme=dark&viewport=desktop&locale=zh-CN`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.documentElement.dataset.selectionAdjustmentCaseStatus === 'ready');
    await page.locator('ic-generation-settings-picker').evaluate(picker => picker.shadowRoot.querySelector('[part="trigger"]').click());
    const dark = await page.locator('ic-generation-settings-picker').evaluate(picker => {
      const panel = picker.shadowRoot.querySelector('[part="panel"]');
      const trigger = picker.shadowRoot.querySelector('[part="trigger"]');
      return {panelBackground:getComputedStyle(panel).backgroundColor, triggerColor:getComputedStyle(trigger).color};
    });
    assert.notEqual(dark.panelBackground, 'rgba(0, 0, 0, 0)');
    assert.notEqual(dark.triggerColor, 'rgb(33, 33, 33)');
    await page.screenshot({path:'/tmp/t35-generation-settings-picker-dark.png', fullPage:true});

    await page.goto(`${origin}/static/smart-canvas.html?id=t35-generation-settings-browser`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('ic-generation-settings-picker[data-smart-generation-settings]')?.dataset.icContractStatus === 'ready', null, {timeout:30000});
    const production = await page.locator('#dynamicParams').evaluate(params => {
      const model = params.querySelector('ic-select[data-component-variant="model-picker"]');
      const picker = params.querySelector('ic-generation-settings-picker[data-smart-generation-settings]');
      const count = params.querySelector('ic-select[data-component-variant="generation-count"]');
      const trigger = picker.shadowRoot.querySelector('[part="trigger"]');
      return {
        order:[...params.children].map(item => item.localName),
        hasModel:Boolean(model),
        hasPicker:Boolean(picker),
        hasCount:Boolean(count),
        pickerHeight:trigger.getBoundingClientRect().height,
        modelHeight:model.shadowRoot.querySelector('[part="combobox"]').getBoundingClientRect().height,
        pickerText:trigger.textContent.trim(),
        legacySizeOptionCount:params.querySelectorAll('.size-picker-option').length,
        legacyCountCellCount:params.querySelectorAll('.count-cell').length,
      };
    });
    assert.deepEqual(production.order, ['ic-select','ic-generation-settings-picker','ic-select']);
    assert.equal(production.hasModel, true);
    assert.equal(production.hasPicker, true);
    assert.equal(production.hasCount, true);
    assert.equal(production.pickerHeight, production.modelHeight);
    assert.equal(production.legacySizeOptionCount, 0);
    assert.equal(production.legacyCountCellCount, 0);
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = `(() => {
        const node = {id:'t35-settings-node',type:'smart-image',x:360,y:220,w:320,h:220,images:[],generationOutputNode:true,title:'T35 settings'};
        canvas = {id:'t35-generation-settings-browser',title:'T35',nodes:[node],connections:[],viewport:{x:0,y:0,scale:1},settings:{},logs:[]};
        nodes = canvas.nodes;
        selectedId = node.id;
        selectedIds = [];
        selectedImage = {nodeId:'',index:-1};
        render();
      })();`;
      document.body.appendChild(script);
      script.remove();
    });
    await page.waitForSelector('#composer.open ic-generation-settings-picker[data-smart-generation-settings]');
    const productionVisible = await page.locator('#composer').evaluate(composer => {
      const params = composer.querySelector('#dynamicParams');
      const picker = params.querySelector('ic-generation-settings-picker');
      const rect = picker.getBoundingClientRect();
      return {
        composerOpen:composer.classList.contains('open'),
        composerVisibility:getComputedStyle(composer).visibility,
        pickerVisible:rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight,
        pickerText:picker.shadowRoot.querySelector('[part="trigger"]').textContent.trim(),
      };
    });
    assert.equal(productionVisible.composerOpen, true);
    assert.equal(productionVisible.composerVisibility, 'visible');
    assert.equal(productionVisible.pickerVisible, true);
    const mutualExclusion = await page.locator('#dynamicParams').evaluate(async params => {
      const model = params.querySelector('ic-select[data-component-variant="model-picker"]');
      const picker = params.querySelector('ic-generation-settings-picker');
      await model.show();
      picker.open = true;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const afterPickerOpens = {modelOpen:model.open, pickerOpen:picker.open};
      model.open = true;
      model.dispatchEvent(new CustomEvent('ic-show', {bubbles:true, composed:true}));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const afterModelOpens = {modelOpen:model.open, pickerOpen:picker.open};
      await model.hide();
      return {afterPickerOpens, afterModelOpens};
    });
    assert.deepEqual(mutualExclusion.afterPickerOpens, {modelOpen:false, pickerOpen:true});
    assert.deepEqual(mutualExclusion.afterModelOpens, {modelOpen:true, pickerOpen:false});
    await page.locator('#composer ic-generation-settings-picker').evaluate(picker => {
      picker.shadowRoot.querySelector('[part="trigger"]').click();
    });
    await page.waitForFunction(() => document.querySelector('#composer ic-generation-settings-picker')?.open);
    await page.waitForTimeout(250);
    const productionPanel = await page.locator('#composer ic-generation-settings-picker').evaluate(picker => {
      const rect = picker.shadowRoot.querySelector('[part="panel"]').getBoundingClientRect();
      const composerRect = picker.closest('#composer, .composer').getBoundingClientRect();
      const parameterRowRect = picker.closest('#composer, .composer').querySelector('.param-row').getBoundingClientRect();
      return {
        open:picker.open,
        topLayer:picker.shadowRoot.querySelector('[part="panel"]').matches(':popover-open'),
        inlineLeft:picker.shadowRoot.querySelector('[part="panel"]').style.left,
        left:rect.left,
        right:rect.right,
        top:rect.top,
        bottom:rect.bottom,
        parameterRowTop:parameterRowRect.top,
        composerLeft:composerRect.left,
        viewportWidth:innerWidth,
        viewportHeight:innerHeight,
      };
    });
    assert.equal(productionPanel.open, true);
    assert.equal(productionPanel.topLayer, true);
    await page.locator('#promptInput').click({position:{x:8,y:8}});
    await page.waitForFunction(() => !document.querySelector('#composer ic-generation-settings-picker')?.open);
    const closedByComposerInput = await page.locator('#composer ic-generation-settings-picker').evaluate(picker => picker.open);
    assert.equal(closedByComposerInput, false);
    await page.locator('#composer ic-generation-settings-picker').evaluate(picker => {
      picker.shadowRoot.querySelector('[part="trigger"]').click();
    });
    await page.waitForFunction(() => document.querySelector('#composer ic-generation-settings-picker')?.open);
    const productionDeleteProtection = await page.evaluate(async () => {
      const before = document.querySelectorAll('.image-node').length;
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true, cancelable:true}));
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {
        before,
        after:document.querySelectorAll('.image-node').length,
        pickerOpen:document.querySelector('#composer ic-generation-settings-picker')?.open,
      };
    });
    assert.deepEqual(productionDeleteProtection, {before:1, after:1, pickerOpen:true});
    assert.equal(productionPanel.left >= 0 && productionPanel.right <= productionPanel.viewportWidth, true);
    assert.equal(productionPanel.top >= 0 && productionPanel.bottom <= productionPanel.viewportHeight, true);
    assert.equal(productionPanel.bottom <= productionPanel.parameterRowTop, true);
    assert.ok(Math.abs(Number.parseFloat(productionPanel.inlineLeft) - (productionPanel.composerLeft + 115)) <= 2, productionPanel);
    await page.screenshot({path:'/tmp/t35-generation-settings-smart-canvas-panel.png', fullPage:false});
    await page.locator('#composer ic-generation-settings-picker').evaluate(picker => {
      picker.shadowRoot.querySelector('[data-quality="high"]').click();
    });
    await page.waitForFunction(() => document.querySelector('#composer ic-generation-settings-picker')?.quality === 'high');
    const productionUpdated = await page.locator('#composer ic-generation-settings-picker').evaluate(picker => {
      const panelRect = picker.shadowRoot.querySelector('[part="panel"]').getBoundingClientRect();
      return {
        quality:picker.quality,
        text:picker.shadowRoot.querySelector('[part="trigger"]').textContent.trim(),
        open:picker.open,
        panelLeft:panelRect.left,
        panelTop:panelRect.top,
      };
    });
    assert.equal(productionUpdated.quality, 'high');
    assert.match(productionUpdated.text, / \/ 高$/);
    assert.equal(productionUpdated.open, true);
    assert.equal(productionUpdated.panelLeft, productionPanel.left);
    assert.equal(productionUpdated.panelTop, productionPanel.top);

    await page.locator('#composer ic-select[data-component-variant="generation-count"]').evaluate(select => {
      select.value = '3';
      select.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
    });
    await page.waitForFunction(() => document.querySelector('#composer ic-select[data-component-variant="generation-count"]')?.value === '3');
    const productionCount = await page.locator('#composer ic-select[data-component-variant="generation-count"]').evaluate(select => select.value);
    assert.equal(productionCount, '3');

    const composerActions = await page.locator('#composer').evaluate(composer => {
      const kind = composer.querySelector('#apiKindToggle');
      const count = composer.querySelector('ic-select[data-component-variant="generation-count"]');
      const run = composer.querySelector('#runBtn');
      const runBase = run.shadowRoot.querySelector('[part="base"]');
      const tokenProbe = document.createElement('span');
      tokenProbe.style.cssText = 'position:fixed;left:-100px;background:var(--ui-color-action-primary);color:var(--ui-color-text-on-action-primary)';
      document.body.append(tokenProbe);
      const result = {
        kindTag:kind.localName,
        kindVariant:kind.dataset.componentVariant,
        kindHeight:kind.shadowRoot.querySelector('[part="base"]').getBoundingClientRect().height,
        kindValue:kind.value,
        kindLabel:kind.querySelector('#apiKindLabel').textContent.trim(),
        kindSwitchIcon:kind.querySelector('ic-icon[slot="end"]').getAttribute('name'),
        countHeight:count.shadowRoot.querySelector('[part="combobox"]').getBoundingClientRect().height,
        runTag:run.localName,
        runSize:run.getAttribute('size'),
        runHierarchy:run.getAttribute('hierarchy'),
        runIcon:run.getAttribute('icon'),
        runLabel:run.getAttribute('label'),
        runStatus:run.dataset.icContractStatus,
        runBackground:getComputedStyle(runBase).backgroundColor,
        tokenBackground:getComputedStyle(tokenProbe).backgroundColor,
      };
      tokenProbe.remove();
      return result;
    });
    assert.equal(composerActions.kindTag, 'ic-button');
    assert.equal(composerActions.kindVariant, 'generation-kind');
    assert.equal(composerActions.kindHeight, composerActions.countHeight);
    assert.equal(composerActions.kindValue, 'image');
    assert.equal(composerActions.kindLabel, '图片生成');
    assert.equal(composerActions.kindSwitchIcon, 'switch-horizontal');
    assert.equal(composerActions.runTag, 'ic-icon-button');
    assert.equal(composerActions.runSize, 'large');
    assert.equal(composerActions.runHierarchy, 'primary');
    assert.equal(composerActions.runIcon, 'submit');
    assert.equal(composerActions.runLabel, '运行');
    assert.equal(composerActions.runStatus, 'ready');
    assert.equal(composerActions.runBackground, composerActions.tokenBackground);

    await page.locator('#apiKindToggle').click();
    await page.waitForFunction(() => document.querySelector('#apiKindToggle')?.value === 'video');
    await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]')?.dataset.icContractStatus === 'ready');
    const videoPicker = await page.locator('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]').evaluate(picker => {
      picker.shadowRoot.querySelector('[part="trigger"]').click();
      const panel = picker.shadowRoot.querySelector('[part="panel"]');
      const aspect = picker.shadowRoot.querySelector('ic-aspect-ratio-picker');
      return {
        text:picker.shadowRoot.querySelector('[part="trigger"]').textContent.trim(),
        headings:[...picker.shadowRoot.querySelectorAll('.setting-label')].map(item => item.textContent.trim()),
        ratioOptions:[...aspect.shadowRoot.querySelectorAll('[data-value]')].map(item => item.dataset.value),
        resolutionOptions:[...panel.querySelectorAll('[data-resolution]')].map(item => item.dataset.resolution),
        qualityOptions:panel.querySelectorAll('[data-quality]').length,
        durationValue:panel.querySelector('.duration-value')?.textContent.trim(),
        durationMin:panel.querySelector('.duration-slider')?.min,
        durationMax:panel.querySelector('.duration-slider')?.max,
        durationTicks:panel.querySelectorAll('.duration-tick').length,
        legacyResolutionControls:document.querySelectorAll('#dynamicParams .resolution-control').length,
        legacyAspectControls:document.querySelectorAll('#dynamicParams .aspect-control').length,
        legacyDurationControls:document.querySelectorAll('#dynamicParams .duration-control').length,
      };
    });
    assert.match(videoPicker.text, /^16:9 \/ 自动 \/ 5s$/);
    assert.deepEqual(videoPicker.headings, ['画面比例','视频分辨率','时长']);
    assert.deepEqual(videoPicker.resolutionOptions, ['auto','480p','720p','1080p']);
    assert.equal(videoPicker.ratioOptions.includes('keep_ratio'), true);
    assert.equal(videoPicker.ratioOptions.includes('adaptive'), true);
    assert.equal(videoPicker.qualityOptions, 0);
    assert.equal(videoPicker.durationValue, '5s');
    assert.equal(videoPicker.durationMin, '1');
    assert.equal(videoPicker.durationMax, '60');
    assert.equal(videoPicker.durationTicks > 2, true);
    assert.equal(videoPicker.legacyResolutionControls, 0);
    assert.equal(videoPicker.legacyAspectControls, 0);
    assert.equal(videoPicker.legacyDurationControls, 0);

    await page.locator('#promptInput').click({position:{x:8,y:8}});
    await page.waitForFunction(() => !document.querySelector('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]')?.open);
    const videoClosedByComposerInput = await page.locator('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]').evaluate(picker => picker.open);
    assert.equal(videoClosedByComposerInput, false);
    await page.locator('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]').evaluate(picker => {
      picker.shadowRoot.querySelector('[part="trigger"]').click();
    });
    await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]')?.open);

    const referenceModePicker = await page.evaluate(async () => {
      const fixture = document.createElement('div');
      fixture.innerHTML = renderJimengReferenceModeControl({
        counts:{total:1},
        reference_limit:{maximum:12},
        reference_mode:'multimodal_all_around',
      });
      document.body.append(fixture);
      const select = fixture.querySelector('ic-select');
      await select.updateComplete;
      select.open = true;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const model = document.querySelector('#dynamicParams ic-select[data-component-variant="model-picker"]');
      const listbox = select.shadowRoot.querySelector('[part~="listbox"]');
      const selectedOption = select.querySelector('wa-option[aria-selected="true"], wa-option:state(current)');
      const result = {
        tag:select.localName,
        variant:select.dataset.componentVariant,
        entryHeight:select.shadowRoot.querySelector('[part="combobox"]').getBoundingClientRect().height,
        modelEntryHeight:model.shadowRoot.querySelector('[part="combobox"]').getBoundingClientRect().height,
        listboxBackground:getComputedStyle(listbox).backgroundColor,
        optionCount:select.querySelectorAll('wa-option').length,
        selectedBackground:getComputedStyle(selectedOption).backgroundColor,
        startIcon:select.querySelector('[slot="start"]')?.getAttribute('name'),
        startIconColor:getComputedStyle(select.querySelector('[slot="start"]')).color,
        displayTextColor:getComputedStyle(select.shadowRoot.querySelector('[part="display-input"]')).color,
        optionIconColors:[...select.querySelectorAll('[data-ic-select-option-start-icon]')].map(icon => ({
          icon:getComputedStyle(icon).color,
          text:getComputedStyle(icon.closest('wa-option')).color,
        })),
        count:select.querySelector('[slot="end"]')?.textContent.trim(),
        legacyControl:Boolean(fixture.querySelector('.reference-mode-control')),
      };
      select.open = false;
      fixture.remove();
      return result;
    });
    assert.equal(referenceModePicker.tag, 'ic-select');
    assert.equal(referenceModePicker.variant, 'model-picker');
    assert.equal(referenceModePicker.entryHeight, referenceModePicker.modelEntryHeight);
    assert.equal(referenceModePicker.optionCount, 2);
    assert.notEqual(referenceModePicker.listboxBackground, 'rgba(0, 0, 0, 0)');
    assert.notEqual(referenceModePicker.selectedBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(referenceModePicker.startIcon, 'omni-reference');
    assert.equal(referenceModePicker.startIconColor, referenceModePicker.displayTextColor);
    assert.ok(referenceModePicker.optionIconColors.every(colors => colors.icon === colors.text));
    assert.equal(referenceModePicker.count, '1/12');
    assert.equal(referenceModePicker.legacyControl, false);

    await page.locator('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]').evaluate(picker => {
      picker.shadowRoot.querySelector('ic-aspect-ratio-picker').shadowRoot.querySelector('[data-value="9:16"]').click();
    });
    await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]')?.ratio === '9:16');
    await page.locator('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]').evaluate(picker => {
      picker.shadowRoot.querySelector('[data-resolution="720p"]').click();
    });
    await page.waitForFunction(() => {
      const picker = document.querySelector('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]');
      return picker?.ratio === '9:16' && picker?.resolution === '720p';
    });
    await page.locator('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]').evaluate(picker => {
      const slider = picker.shadowRoot.querySelector('.duration-slider');
      slider.value = '12';
      slider.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
      slider.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
    });
    await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker[data-smart-generation-mode="video"]')?.duration === '12');
    await page.screenshot({path:'/tmp/t35-generation-settings-smart-canvas.png', fullPage:false});

    const dynamicBranchContracts = await page.evaluate(async () => {
      const original = {...settings};
      Object.assign(settings, {
        provider_id:'openai', model:'gpt-image-1', videoProvider:'volcengine', videoModel:'seedance-2.0-fast',
        msgenModel:'custom', msCustomModel:'Tongyi-MAI/Z-Image-Turbo', rhPayment:'free', rhInstanceType:'',
        comfyParams:{enabled:true, mode:'fast', notes:'details', seed:7, title:'demo'},
        comfyRandomActive:{seed:true}, rhParams:{'1::enabled':'true','2::strength':'0.5','3::mode':'fast','4::seed':'7','5::title':'demo'},
        rhRandomActive:{'4::seed':true},
      });
      const fixture = document.createElement('section');
      fixture.id = 't35-dynamic-branch-fixture';
      fixture.className = 'composer-card';
      fixture.setAttribute('aria-label', 'T35 dynamic generation controls');
      fixture.innerHTML = `<div class="param-row"><div class="dynamic-params">
        ${renderVideoProviderControl([{id:'volcengine', name:'火山引擎'}])}
        ${renderVideoModelControl(['seedance-2.0-fast'])}
        ${renderProviderControl([{id:'openai', name:'OpenAI'}])}
        ${renderModelControl(['gpt-image-1'])}
        ${renderMsFunctionControl()}
        ${renderMsCustomModelPill()}
        ${renderComfySettingField({id:'enabled',name:'Enabled',type:'boolean',default:true})}
        ${renderComfySettingField({id:'mode',name:'Mode',type:'dropdown',options:['fast','quality'],default:'fast'})}
        ${renderComfySettingField({id:'notes',name:'Notes',type:'textarea',default:'details'})}
        ${renderComfySettingField({id:'seed',name:'Seed',type:'number',min:1,max:99,step:1,default:7,random_enabled:true})}
        ${renderComfySettingField({id:'title',name:'Title',type:'text',default:'demo'})}
        ${renderRhPaymentControl()}
        ${renderRhMachineControl()}
        ${renderRhSettingField({nodeId:'1',fieldName:'enabled',label:'Enabled',fieldType:'BOOLEAN',fieldValue:true})}
        ${renderRhSettingField({nodeId:'2',fieldName:'strength',label:'Strength',fieldType:'SLIDER',fieldValue:0.5,min:0,max:1,step:0.1})}
        ${renderRhSettingField({nodeId:'3',fieldName:'mode',label:'Mode',fieldType:'STRING',fieldValue:'fast',fieldData:['fast','quality']})}
        ${renderRhSettingField({nodeId:'4',fieldName:'seed',label:'Seed',fieldType:'NUMBER',fieldValue:7,random_enabled:true})}
        ${renderRhSettingField({nodeId:'5',fieldName:'title',label:'Title',fieldType:'STRING',fieldValue:'demo'})}
      </div></div>`;
      document.body.append(fixture);
      await Promise.all([...fixture.querySelectorAll('ic-select,ic-switch,ic-slider,ic-input,ic-number-input,ic-textarea,ic-icon-button')].map(async control => {
        await control.updateComplete;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }));
      const counts = Object.fromEntries(['ic-select','ic-switch','ic-slider','ic-input','ic-number-input','ic-textarea','ic-icon-button'].map(tag => [tag, fixture.querySelectorAll(tag).length]));
      const invalidContracts = [...fixture.querySelectorAll('[data-ic-contract-status="error"]')].map(control => `${control.localName}:${control.dataset.icContractReason || ''}`);
      const legacyControls = fixture.querySelectorAll('.smart-control,.smart-pill,.smart-popover,.direct-option,.setting-check,.num-compact,.num-with-dice').length;
      Object.assign(settings, original);
      return {counts, invalidContracts, legacyControls};
    });
    assert.deepEqual(dynamicBranchContracts.counts, {
      'ic-select':10,
      'ic-switch':2,
      'ic-slider':1,
      'ic-input':2,
      'ic-number-input':2,
      'ic-textarea':1,
      'ic-icon-button':2,
    });
    assert.deepEqual(dynamicBranchContracts.invalidContracts, []);
    assert.equal(dynamicBranchContracts.legacyControls, 0);
    const dynamicFixture = page.locator('#t35-dynamic-branch-fixture');
    await page.evaluate(() => {
      document.documentElement.dataset.uiTheme = 'light';
      document.documentElement.classList.remove('theme-dark', 'studio-theme-dark');
      document.body.classList.remove('theme-dark', 'studio-theme-dark');
    });
    const dynamicLightStyle = await dynamicFixture.evaluate(fixture => ({
      background:getComputedStyle(fixture).backgroundColor,
      color:getComputedStyle(fixture).color,
    }));
    await dynamicFixture.screenshot({path:'/tmp/t35-dynamic-generation-controls-light.png'});
    await page.evaluate(() => {
      document.documentElement.dataset.uiTheme = 'dark';
      document.documentElement.classList.add('theme-dark', 'studio-theme-dark');
      document.body.classList.add('theme-dark', 'studio-theme-dark');
    });
    const dynamicDarkStyle = await dynamicFixture.evaluate(fixture => ({
      background:getComputedStyle(fixture).backgroundColor,
      color:getComputedStyle(fixture).color,
    }));
    await dynamicFixture.screenshot({path:'/tmp/t35-dynamic-generation-controls-dark.png'});
    assert.notEqual(dynamicLightStyle.background, dynamicDarkStyle.background);
    assert.notEqual(dynamicLightStyle.color, dynamicDarkStyle.color);

    console.log(JSON.stringify({passed:true, initial, opened, durationVariant, selected, closedByTrigger, closedByOutsideClick, closedByComposerInput, count, countLayout, countClosedAfterSelection, modelClosedAfterSelection, dark, production, productionVisible, mutualExclusion, productionPanel, productionDeleteProtection, productionUpdated, productionCount, composerActions, videoPicker, videoClosedByComposerInput, referenceModePicker, dynamicBranchContracts, dynamicThemeStyles:{light:dynamicLightStyle,dark:dynamicDarkStyle}, screenshots:['/tmp/t35-generation-settings-picker-light.png','/tmp/t35-generation-settings-picker-dark.png','/tmp/t35-generation-settings-smart-canvas-panel.png','/tmp/t35-generation-settings-smart-canvas.png','/tmp/t35-dynamic-generation-controls-light.png','/tmp/t35-dynamic-generation-controls-dark.png']}, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error=>{ console.error(error.stack || error); process.exitCode=1; });
