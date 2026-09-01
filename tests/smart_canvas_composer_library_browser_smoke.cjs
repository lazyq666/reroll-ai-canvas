const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1180, height: 800 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.route('http://composer.local/**', async route => {
    const requestPath = decodeURIComponent(new URL(route.request().url()).pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      await route.fulfill({ status: 403, body: 'Forbidden' });
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    await route.fulfill({ path: filePath });
  });

  try {
    await page.goto('http://composer.local/static/design-system/infinite-canvas-ui/composer.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.composerLibraryStatus === 'ready');
    await page.waitForFunction(() => document.querySelector('ic-generation-settings-picker')?.dataset.icContractStatus === 'ready');

    const initial = await page.locator('#composer').evaluate(composer => {
      const prompt = composer.querySelector('#promptInput');
      const counter = composer.querySelector('#promptCharacterCount');
      const focus = composer.querySelector('#composerFocusToggle');
      const tertiaryProbe = document.createElement('span');
      tertiaryProbe.style.color = 'var(--ui-color-text-tertiary)';
      document.body.append(tertiaryProbe);
      const promptRect = prompt.getBoundingClientRect();
      const counterRect = counter.getBoundingClientRect();
      const counterStyle = getComputedStyle(counter);
      const counterMetrics = {
        text: counter.textContent.trim(),
        count: counter.dataset.characterCount,
        fontSize: counterStyle.fontSize,
        fontWeight: counterStyle.fontWeight,
        color: counterStyle.color,
        tokenColor: getComputedStyle(tertiaryProbe).color,
        backgroundColor: counterStyle.backgroundColor,
        doesNotOverlap: promptRect.bottom <= counterRect.top + .5,
      };
      tertiaryProbe.remove();
      return {
        kind: composer.dataset.generationKind,
        width: Math.round(composer.getBoundingClientRect().width),
        radius: getComputedStyle(composer.querySelector('.composer-card')).borderRadius,
        mediumRadius: (() => {
          const probe = document.createElement('span');
          probe.style.borderRadius = 'var(--ui-radius-m)';
          document.body.append(probe);
          const value = getComputedStyle(probe).borderRadius;
          probe.remove();
          return value;
        })(),
        promptMaxHeight: getComputedStyle(prompt).maxHeight,
      counter: counterMetrics,
      focusSize: focus.getAttribute('size'),
      focusCombination: focus.dataset.actionCombination,
      params: [...composer.querySelector('#dynamicParams').children].map(item => item.localName),
      transparent: (() => {
        const control = composer.querySelector('ic-switch[name="transparent-png"]');
        const token = document.createElement('span');
        token.style.fontSize = 'var(--ui-font-size-2)';
        token.style.paddingInline = 'var(--ui-space-2)';
        document.body.append(token);
        const result = {
          label:control?.getAttribute('label'),
          size:control?.getAttribute('size'),
          fontSize:getComputedStyle(control).fontSize,
          tokenFontSize:getComputedStyle(token).fontSize,
          paddingLeft:getComputedStyle(control).paddingLeft,
          paddingRight:getComputedStyle(control).paddingRight,
          tokenPaddingLeft:getComputedStyle(token).paddingLeft,
          tokenPaddingRight:getComputedStyle(token).paddingRight,
        };
        token.remove();
        return result;
      })(),
      };
    });
    assert.deepEqual(initial, {
      kind: 'image',
      width: 768,
      radius: '16px',
      mediumRadius: '16px',
      promptMaxHeight: 'none',
      counter: {
        text: '23 字符',
        count: '23',
        fontSize: '10px',
        fontWeight: '400',
        color: 'rgb(165, 165, 165)',
        tokenColor: 'rgb(165, 165, 165)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        doesNotOverlap: true,
      },
      focusSize: 's',
      focusCombination: 'quiet-icon-action',
      params: ['ic-select', 'ic-generation-settings-picker', 'ic-select', 'ic-switch'],
      transparent: {
        label:'透明 PNG',
        size:'s',
        fontSize:'12px',
        tokenFontSize:'12px',
        paddingLeft:'8px',
        paddingRight:'8px',
        tokenPaddingLeft:'8px',
        tokenPaddingRight:'8px',
      },
    });

    const visibilityToggle = page.locator('[data-composer-visibility-toggle]');
    const baseMotion = await page.locator('#composer').evaluate(composer => ({
      transitionProperty:getComputedStyle(composer).transitionProperty,
      transitionDuration:getComputedStyle(composer).transitionDuration,
    }));
    assert.match(baseMotion.transitionProperty, /opacity/);
    assert.match(baseMotion.transitionProperty, /transform/);
    assert.notEqual(baseMotion.transitionDuration, '0s');
    await visibilityToggle.click();
    assert.equal(await page.locator('#composer').evaluate(composer => composer.classList.contains('open')), false);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#composer')).opacity === '0');
    assert.equal(await visibilityToggle.getAttribute('aria-pressed'), 'false');
    await visibilityToggle.click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#composer')).opacity === '1');
    assert.equal(await visibilityToggle.getAttribute('aria-pressed'), 'true');

    await page.locator('#composerFocusToggle').click();
    assert.equal(await page.locator('#composer').getAttribute('class').then(value => value.includes('focused')), true);
    const focusMotion = await page.locator('#composer').evaluate(composer => ({
      transitioning:composer.classList.contains('focus-transitioning'),
      dx:composer.style.getPropertyValue('--composer-focus-dx'),
      scaleX:composer.style.getPropertyValue('--composer-focus-scale-x'),
    }));
    assert.equal(focusMotion.transitioning, true);
    assert.match(focusMotion.dx, /px$/);
    assert.notEqual(focusMotion.scaleX, '1');
    await page.waitForFunction(() => !document.querySelector('#composer').classList.contains('focus-transitioning'));
    assert.deepEqual(await page.locator('#composer').evaluate(composer => ({
      paramRow: getComputedStyle(composer.querySelector('.param-row')).backgroundColor,
      actions: getComputedStyle(composer.querySelector('.composer-actions')).backgroundColor,
    })), {
      paramRow: 'rgba(0, 0, 0, 0)',
      actions: 'rgba(0, 0, 0, 0)',
    });
    await page.locator('#composerFocusBackdrop').click({ position: { x: 2, y: 2 } });
    assert.equal(await page.locator('#composer').getAttribute('class').then(value => value.includes('focused')), false);
    assert.equal(await page.locator('#composer').evaluate(composer => composer.classList.contains('focus-transitioning')), true);
    await page.waitForFunction(() => !document.querySelector('#composer').classList.contains('focus-transitioning'));

    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.locator('#composerFocusToggle').click();
    assert.equal(await page.locator('#composer').evaluate(composer => composer.classList.contains('focused')), true);
    assert.equal(await page.locator('#composer').evaluate(composer => composer.classList.contains('focus-transitioning')), false);
    await page.locator('#composerFocusBackdrop').click({ position: { x: 2, y: 2 } });
    assert.equal(await page.locator('#composer').evaluate(composer => composer.classList.contains('focus-transitioning')), false);
    await page.emulateMedia({ reducedMotion:'no-preference' });

    await page.locator('#apiKindToggle').click();
    await page.waitForFunction(() => document.querySelector('#composer')?.dataset.generationKind === 'video');
    await page.waitForFunction(() => document.querySelector('ic-generation-settings-picker[data-smart-generation-mode="video"]')?.dataset.icContractStatus === 'ready');

    const video = await page.locator('#composer').evaluate(composer => {
      const row = composer.querySelector('.param-row');
      const params = composer.querySelector('#dynamicParams');
      const picker = params.querySelector('ic-generation-settings-picker');
      const panel = picker.shadowRoot.querySelector('[part="panel"]');
      return {
        label: composer.querySelector('#apiKindLabel').textContent.trim(),
        icon: composer.querySelector('#apiKindIcon').getAttribute('name'),
        flexWrap: getComputedStyle(row).flexWrap,
        dynamicDisplay: getComputedStyle(params).display,
        panelInlineSize: getComputedStyle(panel).inlineSize,
        settingCount: params.querySelectorAll('ic-switch.generation-setting-switch').length,
        readySwitchCount: params.querySelectorAll('ic-switch[data-ic-contract-status="ready"]').length,
        checkedLabels:[...params.querySelectorAll('ic-switch[checked]')].map(control => control.getAttribute('label')),
        sizes:[...params.querySelectorAll('ic-switch')].map(control => control.getAttribute('size')),
        legacySettingCount:params.querySelectorAll('.setting-check,.check-box').length,
      };
    });
    assert.equal(video.label, '视频生成');
    assert.equal(video.icon, 'video-generate');
    assert.equal(video.flexWrap, 'wrap');
    assert.equal(video.dynamicDisplay, 'contents');
    assert.equal(video.panelInlineSize, '320px');
    assert.equal(video.settingCount, 5);
    assert.equal(video.readySwitchCount, 5);
    assert.deepEqual(video.checkedLabels, ['生成音频']);
    assert.deepEqual(video.sizes, ['s', 's', 's', 's', 's']);
    assert.equal(video.legacySettingCount, 0);

    const forcedRatio = await page.evaluate(async () => {
      const picker = document.createElement('ic-generation-settings-picker');
      picker.setAttribute('label', '固定画幅');
      picker.setAttribute('ratio', '16:9');
      picker.setAttribute('ratio-presets', '16:9');
      picker.setAttribute('resolution', '1080p');
      picker.setAttribute('resolutions', '1080p');
      picker.setAttribute('hide-quality', '');
      picker.setAttribute('lock-ratio', '');
      document.body.append(picker);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      picker.open = true;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const aspect = picker.shadowRoot.querySelector('ic-aspect-ratio-picker');
      const option = aspect.shadowRoot.querySelector('button[data-value="16:9"]');
      const result = {
        forced: aspect.hasAttribute('data-selection-forced'),
        pickerDisabled: aspect.hasAttribute('disabled'),
        optionDisabled: option.disabled,
        selected: option.getAttribute('aria-checked'),
        cursor: getComputedStyle(option).cursor,
      };
      picker.remove();
      return result;
    });
    assert.deepEqual(forcedRatio, {
      forced: true,
      pickerDisabled: false,
      optionDisabled: false,
      selected: 'true',
      cursor: 'pointer',
    });

    await page.getByRole('button', { name: '显示参考素材' }).click();
    assert.equal(await page.locator('.input-thumb-label').allTextContents().then(items => items.join(',')), '参考图,输入文本');
    assert.equal(await page.locator('#inputThumbsRow > .input-thumb-list > ic-reference-thumbnail').count(), 2);
    const referenceThumbnail = page.locator('#inputThumbsRow ic-reference-thumbnail[data-component-name="ic-reference-thumbnail-image"]');
    assert.equal(await referenceThumbnail.getAttribute('data-preview-state'), null);
    await referenceThumbnail.hover();
    const imageHovercard = page.locator('ic-thumb-hovercard:not([hidden])');
    await imageHovercard.waitFor();
    assert.deepEqual(await imageHovercard.evaluate(card => ({
      tag:card.localName,
      kind:card.dataset.kind,
      imageCount:card.shadowRoot.querySelectorAll('img').length,
    })), { tag:'ic-thumb-hovercard', kind:'image', imageCount:1 });
    await referenceThumbnail.focus();
    await referenceThumbnail.press('Enter');
    assert.match(await page.locator('[data-composer-library-live-status]').textContent(), /已激活参考素材/);
    const removeAction = referenceThumbnail.locator('.input-thumb-remove');
    await referenceThumbnail.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#inputThumbsRow .input-thumb-remove')).opacity === '1');
    assert.deepEqual(await removeAction.evaluate(action => ({
      opacity: getComputedStyle(action).opacity,
      pointerEvents: getComputedStyle(action).pointerEvents,
    })), { opacity: '1', pointerEvents: 'auto' });
    await removeAction.click();
    assert.equal(await page.locator('#inputThumbsRow ic-reference-thumbnail').count(), 1);
    assert.match(await page.locator('[data-composer-library-live-status]').textContent(), /已移除引用/);

    assert.deepEqual(browserErrors, []);
    process.stdout.write('Composer component-library browser smoke passed.\n');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
