const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      response.writeHead(200, { 'Content-Type': `${mimeTypes[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(body);
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
    const timeout = setTimeout(() => reject(new Error(`Chrome debugger did not start: ${stderr}`)), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
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
    if (payload.error) operation.reject(new Error(payload.error.message));
    else operation.resolve(payload.result);
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, `Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-selection-adjustment-browser-'));
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await cdp.send('Page.navigate', {
      url: `${origin}/static/design-system/infinite-canvas-ui/selection-adjustment-case.html?theme=light&viewport=desktop&locale=zh-CN`,
    }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      "document.documentElement.dataset.selectionAdjustmentCaseStatus === 'ready' && document.querySelectorAll('.ic-component-name-tag').length >= 40",
      'selection category and size fixture',
    );

    const report = await evaluate(cdp, sessionId, `(async () => {
      const metrics = selector => [...document.querySelectorAll(selector)].map(control => {
        const part = control.shadowRoot.querySelector('[part~="combobox"], [part~="base"], [part~="control"]');
        return {
          size: control.getAttribute('size'),
          name: control.dataset.componentName,
          height: Math.round(part.getBoundingClientRect().height),
          status: control.dataset.icContractStatus,
        };
      });
      const familyNames = [...document.querySelectorAll('[data-component-family]')].map(section => section.dataset.componentFamily);
      const copyNames = [...document.querySelectorAll('.ic-component-name-tag')].map(tag => tag.dataset.copyComponentName);
      const multiplePicker = document.querySelector('[data-component-family="aspect-ratio-picker"] ic-aspect-ratio-picker[multiple][size="m"]');
      const thirdRatio = multiplePicker.options[2].value;
      multiplePicker.values = [thirdRatio];
      multiplePicker.select(thirdRatio, { emit: false });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const multipleClear = {
        value: multiplePicker.value,
        checked: multiplePicker.shadowRoot.querySelectorAll('[aria-checked="true"]').length,
      };
      const slider = document.querySelector('[data-component-family="slider"] ic-slider[size="m"]');
      const sliderContainment = async value => {
        slider.value = value;
        await slider.updateComplete;
        const surface = slider.shadowRoot.querySelector('[part~="slider"]').getBoundingClientRect();
        const thumb = slider.shadowRoot.querySelector('[part~="thumb"]').getBoundingClientRect();
        return {
          paddingStart: parseFloat(getComputedStyle(slider.shadowRoot.querySelector('[part~="slider"]')).paddingInlineStart),
          paddingEnd: parseFloat(getComputedStyle(slider.shadowRoot.querySelector('[part~="slider"]')).paddingInlineEnd),
          contained: thumb.left >= surface.left - .5 && thumb.right <= surface.right + .5,
        };
      };
      const sliderBounds = {
        min: await sliderContainment(slider.min),
        max: await sliderContainment(slider.max),
      };
      const selectLayout = await Promise.all(
        [...document.querySelectorAll('[data-component-family="select"] ic-select')].map(async control => {
          const card = control.closest('article');
          const cardStyle = getComputedStyle(card);
          const availableWidth = card.clientWidth
            - parseFloat(cardStyle.paddingInlineStart)
            - parseFloat(cardStyle.paddingInlineEnd);
          const clone = control.cloneNode(true);
          clone.removeAttribute('data-component-name');
          clone.removeAttribute('data-copy-kind');
          clone.style.cssText = 'position:fixed;visibility:hidden;inset:0 auto auto 0;';
          document.body.append(clone);
          await clone.updateComplete;
          await new Promise(resolve => requestAnimationFrame(resolve));
          const intrinsicWidth = clone.getBoundingClientRect().width;
          clone.remove();
          const optionLabel = control.querySelector('wa-option')?.shadowRoot?.querySelector('[part~="label"]');
          return {
            width: Math.round(control.getBoundingClientRect().width),
            availableWidth: Math.round(availableWidth),
            intrinsicWidth: Math.round(intrinsicWidth),
            optionTextAlign: optionLabel ? getComputedStyle(optionLabel).textAlign : '',
          };
        }),
      );
      const checkboxListLayout = [...document.querySelectorAll('[data-component-family="checkbox"] ic-checkbox[data-component-variant="list"]')].map(control => {
        const card = control.closest('article');
        const cardStyle = getComputedStyle(card);
        const availableWidth = card.clientWidth
          - parseFloat(cardStyle.paddingInlineStart)
          - parseFloat(cardStyle.paddingInlineEnd);
        const base = control.shadowRoot.querySelector('[part~="base"]');
        const title = control.querySelector('[data-ic-checkbox-title]');
        return {
          width: Math.round(control.getBoundingClientRect().width),
          baseWidth: Math.round(base.getBoundingClientRect().width),
          availableWidth: Math.round(availableWidth),
          titleTextAlign: getComputedStyle(title).textAlign,
        };
      });
      const colorProbe = document.createElement('span');
      colorProbe.style.color = 'var(--ui-color-text-primary)';
      colorProbe.style.background = 'var(--ui-color-action-secondary-selected)';
      document.body.append(colorProbe);
      const secondaryExpected = {
        color: getComputedStyle(colorProbe).color,
        background: getComputedStyle(colorProbe).backgroundColor,
      };
      colorProbe.remove();
      const secondaryControls = [...document.querySelectorAll('[data-component-family="select"] ic-select[data-component-variant="secondary"]')];
      await Promise.all(secondaryControls.flatMap(control => (
        [...control.querySelectorAll('wa-option')].map(option => option.updateComplete)
      )));
      const secondarySelect = secondaryControls.map(control => {
        const combobox = control.shadowRoot.querySelector('[part~="combobox"]');
        const displayInput = control.shadowRoot.querySelector('[part~="display-input"]');
        const options = [...control.querySelectorAll('wa-option')];
        const selectedOption = options.find(option => option.selected);
        const unselectedOption = options.find(option => !option.selected);
        const optionMetric = option => {
          const style = getComputedStyle(option);
          return {
            background: style.backgroundColor,
            color: style.color,
            borderWidth: style.borderTopWidth,
          };
        };
        const comboboxStyle = getComputedStyle(combobox);
        return {
          size: control.getAttribute('size'),
          comboboxBackground: comboboxStyle.backgroundColor,
          comboboxColor: comboboxStyle.color,
          comboboxBorderWidth: comboboxStyle.borderTopWidth,
          displayColor: getComputedStyle(displayInput).color,
          selectedOption: optionMetric(selectedOption),
          unselectedOption: optionMetric(unselectedOption),
        };
      });
      return {
        familyNames,
        multipleClear,
        sliderBounds,
        sizeGridCount: document.querySelectorAll('.selection-size-grid').length,
        sizeCellCount: document.querySelectorAll('.selection-size-grid > article').length,
        everyGridIsSml: [...document.querySelectorAll('.selection-size-grid')].every(grid => (
          [...grid.children].map(item => item.dataset.uiLibraryMatrixLabel).join(',') === 'S,M,L'
        )),
        model: metrics('[data-component-family="model-picker"] ic-select'),
        modelPickerLayout: [...document.querySelectorAll('[data-component-family="model-picker"] ic-select')].map(control => {
          const card = control.closest('article');
          const cardStyle = getComputedStyle(card);
          const availableWidth = card.clientWidth
            - parseFloat(cardStyle.paddingInlineStart)
            - parseFloat(cardStyle.paddingInlineEnd);
          const optionLabel = control.querySelector('wa-option')?.shadowRoot?.querySelector('[part~="label"]');
          return {
            width: Math.round(control.getBoundingClientRect().width),
            availableWidth: Math.round(availableWidth),
            optionTextAlign: optionLabel ? getComputedStyle(optionLabel).textAlign : '',
          };
        }),
        selectLayout,
        checkboxListLayout,
        secondaryExpected,
        secondarySelect,
        number: metrics('[data-component-family="number-input"] ic-number-input'),
        switches: metrics('[data-component-family="switch"] ic-switch'),
        copyNames,
        copyTagCount: copyNames.length,
        oldMixedStateCount: document.querySelectorAll('[data-selection-states]').length,
        oldMixedStateText: document.body.textContent.includes('Default · Hover · Focus'),
        listSubtitleCount: document.querySelectorAll('[data-component-variant="list"] [data-ic-checkbox-subtitle]').length,
        contractsReady: [...document.querySelectorAll('ic-checkbox, ic-radio-group, ic-radio, ic-switch, ic-select, ic-slider, ic-number-input, ic-color-field')]
          .every(control => control.dataset.icContractStatus === 'ready'),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    })()`);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await delay(250);
    report.narrowOverflow = await evaluate(cdp, sessionId, 'document.documentElement.scrollWidth > document.documentElement.clientWidth + 1');

    await cdp.send('Page.navigate', {
      url: `${origin}/static/design-system/infinite-canvas-ui/text-entry-case.html?theme=light&viewport=desktop&locale=zh-CN`,
    }, sessionId);
    await waitFor(cdp, sessionId, "document.querySelectorAll('.ic-component-name-tag').length >= 21", 'text entry sizes');
    report.textEntry = await evaluate(cdp, sessionId, `(() => {
      const search = document.querySelector('ic-input[name="search-m"]');
      const clear = search.querySelector('[data-search-clear]');
      const invalidAppearance = document.createElement('ic-input');
      invalidAppearance.setAttribute('name', 'invalid-appearance');
      invalidAppearance.setAttribute('appearance', 'glass');
      document.body.append(invalidAppearance);
      const beforeOpacity = getComputedStyle(clear).opacity;
      search.focus();
      return new Promise(resolve => setTimeout(() => {
        const host = clear.getBoundingClientRect();
        const base = clear.shadowRoot.querySelector('[part~="base"]').getBoundingClientRect();
        const icon = clear.querySelector('ic-icon').getBoundingClientRect();
        const afterOpacity = getComputedStyle(clear).opacity;
        clear.click();
        const subtleMetrics = () => {
          const probe = document.createElement('div');
          probe.style.background = 'var(--ui-color-surface-subtle)';
          document.body.append(probe);
          const expectedBackground = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const controls = [...document.querySelectorAll('ic-input[appearance="subtle"]')];
          return {
            expectedBackground,
            containerBackground: getComputedStyle(controls[0].closest('article')).backgroundColor,
            controls: controls.map(control => {
              const style = getComputedStyle(control.shadowRoot.querySelector('[part~="base"]'));
              return {
                background: style.backgroundColor,
                borderWidth: style.borderTopWidth,
                status: control.dataset.icContractStatus,
              };
            }),
          };
        };
        const subtleLight = subtleMetrics();
        document.documentElement.dataset.uiTheme = 'dark';
        document.documentElement.classList.add('theme-dark');
        const subtleDark = subtleMetrics();
        resolve({
          heights: ['s', 'm', 'l'].map(size => Math.round(document.querySelector('ic-input[name="text-' + size + '"]').shadowRoot.querySelector('[part~="base"]').getBoundingClientRect().height)),
          beforeOpacity,
          afterOpacity,
          centered: Math.abs((host.x + host.width / 2) - (base.x + base.width / 2)) < .5
            && Math.abs((host.y + host.height / 2) - (base.y + base.height / 2)) < .5
            && Math.abs((host.x + host.width / 2) - (icon.x + icon.width / 2)) < .5
            && Math.abs((host.y + host.height / 2) - (icon.y + icon.height / 2)) < .5,
          clearedValue: search.value,
          redundantTypes: document.querySelectorAll('ic-input[type="email"], ic-input[type="url"], ic-input[type="tel"]').length,
          iconActionBackgrounds: [...document.querySelectorAll('ic-input[name="icon-end-action"] ic-icon-button, ic-input[name="dual-end-action"] ic-icon-button')]
            .map(button => button.getAttribute('background')),
          subtleLight,
          subtleDark,
          invalidAppearance: {
            status: invalidAppearance.dataset.icContractStatus,
            error: invalidAppearance.getAttribute('ic-contract-error'),
          },
        });
      }, 180));
    })()`);

    await cdp.send('Page.navigate', {
      url: `${origin}/static/design-system/infinite-canvas-ui/heading-case.html?theme=light&viewport=desktop&locale=zh-CN`,
    }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.headingCaseStatus === 'ready'", 'heading fixture');
    report.heading = await evaluate(cdp, sessionId, `({
      combinations: document.querySelectorAll('.heading-combination ic-heading').length,
      captions: document.querySelectorAll('.heading-combination > span').length,
      redundantCopy: /Title only|Subtitle/.test(document.body.textContent),
    })`);

    await cdp.send('Page.navigate', {
      url: `${origin}/static/ui-component-library.html`,
    }, sessionId);
    await waitFor(cdp, sessionId, "document.querySelector('ic-nav-item[data-target-review=\"heading\"]')", 'component library navigation');
    await waitFor(cdp, sessionId, "document.querySelector('[data-component-name=\"ic-icon-button-tertiary\"] ic-icon-button')?.dataset?.icContractStatus === 'ready'", 'tertiary icon button matrix');
    report.actionLibrary = await evaluate(cdp, sessionId, `(() => {
      const metric = name => {
        const button = document.querySelector('[data-component-name="' + name + '"] ic-icon-button');
        const style = getComputedStyle(button.shadowRoot.querySelector('[part~="base"]'));
        return { background: style.backgroundColor, color: style.color };
      };
      const probe = document.createElement('span');
      probe.style.color = 'var(--ui-color-text-secondary)';
      document.body.append(probe);
      const subtitleColor = getComputedStyle(probe).color;
      probe.style.color = 'var(--ui-color-text-tertiary)';
      const hoverColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        normal: metric('ic-icon-button-tertiary'),
        hover: metric('ic-icon-button-tertiary-hover'),
        subtitleColor,
        hoverColor,
      };
    })()`);
    await evaluate(cdp, sessionId, `(() => {
      const item = document.querySelector('ic-nav-item[data-target-review="heading"]');
      (item.shadowRoot?.querySelector('a') || item).click();
      return true;
    })()`);
    await waitFor(
      cdp,
      sessionId,
      "document.querySelector('[data-heading-matrix]')?.contentDocument?.documentElement?.dataset?.headingCaseStatus === 'ready'",
      'aggregated heading fixture',
    );
    Object.assign(report.heading, await evaluate(cdp, sessionId, `(() => {
      const preview = document.querySelector('[data-heading-matrix]').contentDocument;
      return {
        aggregateStatus: preview.documentElement.dataset.headingCaseStatus,
        aggregateCount: preview.querySelector('[data-heading-legal-count]').textContent,
      };
    })()`));

    await cdp.send('Page.navigate', {
      url: `${origin}/static/design-system/infinite-canvas-ui/action-case.html?theme=light&viewport=desktop&locale=zh-CN`,
    }, sessionId);
    await waitFor(cdp, sessionId, "customElements.get('ic-icon-button')", 'icon button fixture');
    report.xsmallIconStroke = await evaluate(cdp, sessionId, `(async () => {
      const button = document.createElement('ic-icon-button');
      button.setAttribute('size', 'xs');
      button.setAttribute('icon', 'save');
      button.setAttribute('label', '保存');
      document.body.append(button);
      await button.updateComplete;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return getComputedStyle(button.querySelector('ic-icon').shadowRoot.querySelector('svg')).strokeWidth;
    })()`);
    const bareButton = await evaluate(cdp, sessionId, `(async () => {
      const button = document.createElement('ic-icon-button');
      button.id = 'bare-icon-button';
      button.setAttribute('background', 'ghost');
      button.setAttribute('icon', 'detect');
      button.setAttribute('label', '验证');
      document.body.append(button);
      await button.updateComplete;
      button.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const base = button.shadowRoot.querySelector('[part~="base"]');
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(base);
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        background: style.backgroundColor,
        color: style.color,
        borderWidth: style.borderTopWidth,
      };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bareButton.x, y: bareButton.y }, sessionId);
    await delay(120);
    report.bareIconButton = {
      ...bareButton,
      hover: await evaluate(cdp, sessionId, `(() => {
        const button = document.querySelector('#bare-icon-button');
        const style = getComputedStyle(button.shadowRoot.querySelector('[part~="base"]'));
        return {
          background: style.backgroundColor,
          color: style.color,
          hostHovered: button.matches(':hover'),
          attribute: button.getAttribute('background'),
          property: button.background,
          appearance: button.appearance,
          status: button.dataset.icContractStatus,
          reason: button.dataset.icContractReason || '',
        };
      })()`),
    };

    const requiredFamilies = ['aspect-ratio-picker', 'model-picker', 'checkbox', 'radio', 'number-input', 'switch', 'select', 'slider', 'color-field'];
    const requiredCopyNames = [
      'ic-aspect-ratio-picker-multiple-small', 'ic-aspect-ratio-picker-multiple', 'ic-aspect-ratio-picker-multiple-large',
      'ic-select-model-small', 'ic-select-model', 'ic-select-model-large',
      'ic-checkbox-small', 'ic-checkbox', 'ic-checkbox-large',
      'ic-checkbox-list-small', 'ic-checkbox-list', 'ic-checkbox-list-large',
      'ic-radio-group-small', 'ic-radio-group', 'ic-radio-group-large',
      'ic-radio-group-tabs-small', 'ic-radio-group-tabs', 'ic-radio-group-tabs-large',
      'ic-number-input-small', 'ic-number-input', 'ic-number-input-large',
      'ic-switch-small', 'ic-switch', 'ic-switch-large',
      'ic-select-secondary-small', 'ic-select-secondary', 'ic-select-secondary-large',
      'ic-select-count-small', 'ic-select-count', 'ic-select-count-large',
    ];
    const modelPickerLayoutPassed = report.modelPickerLayout.every(item => (
      item.width < item.availableWidth && item.optionTextAlign === 'start'
    ));
    const selectLayoutPassed = report.selectLayout.every(item => (
      item.width === item.intrinsicWidth
      && item.width < item.availableWidth
      && item.optionTextAlign === 'start'
    ));
    const checkboxListLayoutPassed = report.checkboxListLayout.every(item => (
      item.width === item.baseWidth
      && item.width < item.availableWidth
      && item.titleTextAlign === 'start'
    ));
    const secondarySelectPassed = (
      report.secondarySelect.length === 3
      && ['ic-select-secondary-small', 'ic-select-secondary', 'ic-select-secondary-large']
        .every(name => report.copyNames.includes(name))
      && report.secondarySelect.every(item => (
        item.comboboxBackground === report.secondaryExpected.background
        && item.comboboxColor === report.secondaryExpected.color
        && item.comboboxBorderWidth === '0px'
        && item.displayColor === report.secondaryExpected.color
        && item.selectedOption.background === report.secondaryExpected.background
        && item.selectedOption.color === report.secondaryExpected.color
        && item.selectedOption.borderWidth === '0px'
        && item.unselectedOption.color === report.secondaryExpected.color
      ))
    );
    const allPassed = (
      requiredFamilies.every(name => report.familyNames.includes(name))
      && report.sizeGridCount === 14
      && report.sizeCellCount === 42
      && report.everyGridIsSml
      && report.listSubtitleCount === 0
      && report.multipleClear.value === ''
      && report.multipleClear.checked === 0
      && report.sliderBounds.min.paddingStart > 0
      && report.sliderBounds.min.paddingEnd > 0
      && report.sliderBounds.min.contained
      && report.sliderBounds.max.contained
      && JSON.stringify(report.model.map(item => item.height)) === JSON.stringify([24, 32, 36])
      && modelPickerLayoutPassed
      && selectLayoutPassed
      && checkboxListLayoutPassed
      && secondarySelectPassed
      && JSON.stringify(report.number.map(item => item.height)) === JSON.stringify([32, 32, 40])
      && report.switches[0].height < report.switches[1].height
      && report.switches[1].height < report.switches[2].height
      && requiredCopyNames.every(name => report.copyNames.includes(name))
      && report.copyTagCount === 43
      && report.oldMixedStateCount === 0
      && !report.oldMixedStateText
      && report.contractsReady
      && !report.overflow
      && !report.narrowOverflow
      && JSON.stringify(report.textEntry.heights) === JSON.stringify([32, 36, 40])
      && report.textEntry.beforeOpacity === '0'
      && report.textEntry.afterOpacity === '1'
      && report.textEntry.centered
      && report.textEntry.clearedValue === ''
      && report.textEntry.redundantTypes === 0
      && JSON.stringify(report.textEntry.iconActionBackgrounds) === JSON.stringify(['ghost', 'ghost'])
      && [report.textEntry.subtleLight, report.textEntry.subtleDark].every(theme => (
        theme.controls.length === 6
        && theme.containerBackground !== theme.expectedBackground
        && theme.controls.every(control => control.background === theme.expectedBackground && control.borderWidth === '0px' && control.status === 'valid')
      ))
      && report.textEntry.invalidAppearance.status === 'invalid'
      && report.textEntry.invalidAppearance.error === 'Unsupported ic-input appearance: glass'
      && report.heading.combinations === 6
      && report.heading.captions === 0
      && !report.heading.redundantCopy
      && report.heading.aggregateStatus === 'ready'
      && report.heading.aggregateCount === '6/6'
      && report.actionLibrary.normal.background === 'rgba(0, 0, 0, 0)'
      && report.actionLibrary.hover.background === 'rgba(0, 0, 0, 0)'
      && report.actionLibrary.hover.color === report.actionLibrary.hoverColor
      && report.actionLibrary.hover.color !== report.actionLibrary.normal.color
      && report.xsmallIconStroke === '1.33px'
      && report.bareIconButton.background === 'rgba(0, 0, 0, 0)'
      && report.bareIconButton.hover.background === 'rgba(0, 0, 0, 0)'
      && report.bareIconButton.borderWidth === '0px'
      && report.bareIconButton.hover.color !== report.bareIconButton.color
    );
    const focusResults = {
      'model-picker-layout': modelPickerLayoutPassed,
      'select-layout': selectLayoutPassed,
      'selection-item-layout': selectLayoutPassed && checkboxListLayoutPassed,
      'select-secondary': secondarySelectPassed,
    };
    const passed = process.env.IC_SELECTION_ADJUSTMENT_FOCUS
      ? focusResults[process.env.IC_SELECTION_ADJUSTMENT_FOCUS] === true
      : allPassed;
    console.log(JSON.stringify({ passed, report }));
    if (!passed) process.exitCode = 1;
  } finally {
    cdp?.close();
    browser.kill('SIGTERM');
    server.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
