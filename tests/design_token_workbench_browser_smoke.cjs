const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };

function snapshot(source) {
  return {
    revision: crypto.createHash('sha256').update(source).digest('hex'),
    tokens: [
      { name: '--ui-palette-gray-0', kind: 'primitive-color', value: '#FFFFFF' },
      { name: '--ui-palette-gray-800', kind: 'primitive-color', value: '#212121' },
      { name: '--ui-palette-gray-950', kind: 'primitive-color', value: '#141414' },
      {
        name: '--ui-color-text-primary', kind: 'semantic-color',
        light: '--ui-palette-gray-950', dark: '--ui-palette-gray-0',
        value: 'light-dark(var(--ui-palette-gray-950), var(--ui-palette-gray-0))',
      },
    ],
  };
}

function startServer() {
  let tokenSource = fs.readFileSync(path.join(ROOT, 'static/css/design-tokens.css'), 'utf8');
  const saves = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/admin/design-tokens' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify(snapshot(tokenSource)));
    }
    if (url.pathname === '/api/admin/design-tokens' && request.method === 'PUT') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      return request.on('end', () => {
        const payload = JSON.parse(body);
        saves.push(payload);
        const change = payload.changes.find(item => item.name === '--ui-color-text-primary');
        if (change) {
          tokenSource = tokenSource.replace(
            '--ui-color-text-primary: light-dark(var(--ui-palette-gray-950), var(--ui-palette-gray-0));',
            `--ui-color-text-primary: light-dark(var(${change.light}), var(${change.dark}));`,
          );
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(snapshot(tokenSource)));
      });
    }
    if (url.pathname === '/static/css/design-tokens.css') {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return response.end(tokenSource);
    }
    const filePath = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, content) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      response.writeHead(200, { 'Content-Type': `${mimeTypes[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, saves, tokenSource: () => tokenSource }));
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
    if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
    else operation.resolve(payload.result);
  });
  return {
    socket,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const runtime = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-token-workbench-'));
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    const origin = `http://127.0.0.1:${runtime.server.address().port}`;
    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/design-tokens.html` }, sessionId);
    await waitFor(cdp, sessionId, `!document.querySelector('[data-token-edit-toggle]').disabled`, 'editable token workbench');

    const toolbarContract = await evaluate(cdp, sessionId, `(() => {
      const toolbar = document.querySelector('.token-toolbar');
      const style = getComputedStyle(toolbar);
      return {
        copyFormatRemoved: !document.querySelector('[data-copy-format]'),
        copyVisibleRemoved: !document.querySelector('[data-copy-visible]'),
        localThemeRemoved: !document.querySelector('[data-theme]'),
        background: style.backgroundColor,
        borderWidth: style.borderWidth,
        shadow: style.boxShadow,
      };
    })()`);
    if (!toolbarContract.copyFormatRemoved || !toolbarContract.copyVisibleRemoved || !toolbarContract.localThemeRemoved
      || toolbarContract.background !== 'rgba(0, 0, 0, 0)' || toolbarContract.borderWidth !== '0px'
      || toolbarContract.shadow !== 'none') {
      throw new Error(`Token toolbar contract is incomplete: ${JSON.stringify(toolbarContract)}`);
    }

    await waitFor(cdp, sessionId, `customElements.get('ic-nav-item') && [...document.querySelectorAll('[data-token-filters] ic-nav-item')].every(item => item.shadowRoot)`, 'token section navigation');
    const navigationContract = await evaluate(cdp, sessionId, `(() => {
      const navigation = document.querySelector('[data-token-filters]');
      const categories = [...navigation.querySelectorAll('.token-filter-category')];
      const semanticItem = navigation.querySelector('ic-nav-item[data-category="semantic-color"]');
      semanticItem.click();
      const semanticGroup = navigation.querySelector('ic-nav-item[data-category="semantic-color"]').closest('.token-filter-group');
      const semanticCount = Number(semanticGroup.querySelector('.token-filter-count').textContent.trim());
      const families = [...semanticGroup.querySelectorAll('[data-filter-family]')].map(item => item.getAttribute('label'));
      semanticGroup.querySelector('[data-filter-family="action"]').click();
      const refreshedSemanticGroup = navigation.querySelector('ic-nav-item[data-category="semantic-color"]').closest('.token-filter-group');
      return {
        pattern: navigation.dataset.navigationPattern,
        width: getComputedStyle(navigation).width,
        legacyChips: navigation.querySelectorAll('.filter-chip').length,
        labels: categories.map(item => item.querySelector('ic-nav-item').getAttribute('label')),
        counts: categories.map(item => Number(item.querySelector('.token-filter-count').textContent.trim())),
        semanticCount,
        reportedSemanticCount: Number(document.querySelector('[data-results-count]').textContent.split('/')[0].trim()),
        families,
        activeCategory: refreshedSemanticGroup.querySelector(':scope > .token-filter-category ic-nav-item')?.hasAttribute('current'),
        activeFamily: refreshedSemanticGroup.querySelector('[data-filter-family="action"]')?.getAttribute('current'),
        familyTargetVisible: Boolean(document.querySelector('[data-token-category="semantic-color"][data-token-family="action"]')),
      };
    })()`);
    const expectedNavigationLabels = ['全部', '语义颜色', '原子色板', '文字排版', '间距', '形状层次', '控件尺寸', '焦点', '动效'];
    const expectedSemanticNavigationFamilies = ['Action', 'Border', 'Surface', 'Text', 'Icon', 'Backdrop', 'Mask', 'Prompt Template Placeholder'];
    if (navigationContract.pattern !== 'section-navigation' || navigationContract.width !== '160px'
      || navigationContract.legacyChips !== 0
      || JSON.stringify(navigationContract.labels) !== JSON.stringify(expectedNavigationLabels)
      || navigationContract.counts.some(count => !Number.isInteger(count) || count < 1)
      || navigationContract.semanticCount !== navigationContract.reportedSemanticCount
      || JSON.stringify(navigationContract.families) !== JSON.stringify(expectedSemanticNavigationFamilies)
      || !navigationContract.activeCategory || navigationContract.activeFamily !== 'section'
      || !navigationContract.familyTargetVisible) {
      throw new Error(`Token section navigation is incomplete: ${JSON.stringify(navigationContract)}`);
    }

    const semanticReference = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[data-category="semantic-color"]').click();
      const guide = document.querySelector('[data-semantic-color-guide]');
      const families = [...document.querySelectorAll('[data-token-family]')];
      const row = [...document.querySelectorAll('[data-token-name]')]
        .find(item => item.dataset.tokenName === '--ui-color-text-primary');
      const result = {
        guideVisible: !guide.hidden,
        families: families.map(item => item.querySelector('h2').textContent.trim()),
        headings: families.map(item => [...item.querySelectorAll('.token-table th')].map(cell => cell.textContent.trim())),
        familyRowCounts: families.map(item => item.querySelectorAll('[data-token-name]').length),
        actionPrimaryStart: [...families[0].querySelectorAll('[data-token-name]')]
          .slice(0, 3)
          .map(item => item.dataset.tokenName),
        actionSecondaryOrder: [...families[0].querySelectorAll('[data-token-name]')]
          .map(item => item.dataset.tokenName)
          .filter(name => /^--ui-color-action-secondary(?:-(?:hover|selected|selected-hover|disabled))?$/.test(name)),
        textFamily: row?.closest('[data-token-family]')?.querySelector('h2')?.textContent.trim(),
        usage: row?.querySelector('.token-usage-cell')?.textContent.trim(),
        mapping: row?.querySelector('[data-token-raw-value]')?.textContent.trim(),
        resolved: row?.querySelector('[data-token-resolved]')?.textContent.trim(),
        previews: [...row.querySelectorAll('.preview-color')].map(preview => {
          const box = preview.getBoundingClientRect();
          return {
            theme: preview.dataset.previewTheme,
            color: getComputedStyle(preview).backgroundColor,
            width: box.width,
            height: box.height,
          };
        }),
      };
      return result;
    })()`);
    const expectedSemanticFamilies = ['Action', 'Border', 'Surface', 'Text', 'Icon', 'Backdrop', 'Mask', 'Prompt Template Placeholder'];
    const expectedActionPrimaryStart = [
      '--ui-color-action-primary', '--ui-color-action-primary-hover',
      '--ui-color-action-primary-disabled',
    ];
    const expectedActionSecondaryOrder = [
      '--ui-color-action-secondary', '--ui-color-action-secondary-hover',
      '--ui-color-action-secondary-selected', '--ui-color-action-secondary-selected-hover', '--ui-color-action-secondary-disabled',
    ];
    if (!semanticReference.guideVisible || JSON.stringify(semanticReference.families) !== JSON.stringify(expectedSemanticFamilies)
      || !semanticReference.headings.every(headings => JSON.stringify(headings) === JSON.stringify(['Token Name', '使用规则', 'Value']))
      || semanticReference.familyRowCounts.some(count => count < 1) || semanticReference.textFamily !== 'Text'
      || JSON.stringify(semanticReference.actionPrimaryStart) !== JSON.stringify(expectedActionPrimaryStart)
      || JSON.stringify(semanticReference.actionSecondaryOrder) !== JSON.stringify(expectedActionSecondaryOrder)) {
      throw new Error(`Semantic reference or table headings are incomplete: ${JSON.stringify(semanticReference)}`);
    }
    if (!semanticReference.usage.includes('标题、正文') || !semanticReference.mapping.includes('light-dark') || !semanticReference.resolved) {
      throw new Error(`Semantic table row is incomplete: ${JSON.stringify(semanticReference)}`);
    }
    if (JSON.stringify(semanticReference.previews.map(preview => preview.theme)) !== JSON.stringify(['light', 'dark'])
      || semanticReference.previews.some(preview => Math.abs(preview.width - preview.height) > 0.01)
      || semanticReference.previews[0].color === semanticReference.previews[1].color) {
      throw new Error(`Semantic color previews are incomplete: ${JSON.stringify(semanticReference.previews)}`);
    }

    const typeContract = await evaluate(cdp, sessionId, `(() => {
      const probe = document.createElement('span');
      probe.style.fontSize = 'var(--ui-font-size-3)';
      document.body.append(probe);
      const expected = getComputedStyle(probe).fontSize;
      probe.remove();
      return {
        expected,
        tokenName: getComputedStyle(document.querySelector('.token-name')).fontSize,
        usage: getComputedStyle(document.querySelector('.token-usage-cell p')).fontSize,
      };
    })()`);
    if (typeContract.tokenName !== typeContract.expected || typeContract.usage !== typeContract.expected) {
      throw new Error(`Token table typography is incomplete: ${JSON.stringify(typeContract)}`);
    }

    const typographyReference = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[data-category="typography"]').click();
      const guide = document.querySelector('[data-typography-guide]');
      const rule = name => document.querySelector('[data-token-name="' + name + '"] .token-usage-cell')?.textContent.trim();
      const textStyleRow = document.querySelector('[data-token-name="--ui-text-title-1"]');
      const textStylePreview = textStyleRow?.querySelector('.token-preview')?.getBoundingClientRect();
      const valueCell = textStyleRow?.querySelector('.token-value-cell')?.getBoundingClientRect();
      return {
        guideVisible: !guide.hidden,
        heading: guide.querySelector('h2')?.textContent.trim(),
        roles: [...guide.querySelectorAll('.typography-role-map strong')].map(item => item.textContent.trim()),
        titleRule: rule('--ui-text-title-1'),
        bodyRule: rule('--ui-text-body'),
        captionRule: rule('--ui-text-caption'),
        sizeRule: rule('--ui-font-size-7'),
        previewWidth: textStylePreview?.width,
        previewHeight: textStylePreview?.height,
        valueCellWidth: valueCell?.width,
      };
    })()`);
    if (!typographyReference.guideVisible || typographyReference.heading !== '先选文字角色，再调整基础值'
      || JSON.stringify(typographyReference.roles) !== JSON.stringify(['Title 1–3', 'Body / Subtitle', 'Label / Caption', 'Code'])
      || !typographyReference.titleRule.includes('页面主标题')
      || !typographyReference.bodyRule.includes('默认正文')
      || !typographyReference.captionRule.includes('不得承载关键操作')
      || !typographyReference.sizeRule.includes('展示型大标题')
      || typographyReference.previewWidth < 200 || typographyReference.previewHeight < 96
      || typographyReference.valueCellWidth < 400) {
      throw new Error(`Typography guidance is incomplete: ${JSON.stringify(typographyReference)}`);
    }
    await evaluate(cdp, sessionId, `document.querySelector('[data-category="semantic-color"]').click()`);

    const groupedSearch = await evaluate(cdp, sessionId, `(() => {
      const search = document.querySelector('[data-token-search]');
      search.value = 'selected';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const families = [...document.querySelectorAll('[data-token-family]')];
      return {
        families: families.map(item => item.querySelector('h2').textContent.trim()),
        rowCounts: families.map(item => item.querySelectorAll('[data-token-name]').length),
        names: [...document.querySelectorAll('[data-token-name]')].map(item => item.dataset.tokenName),
      };
    })()`);
    if (JSON.stringify(groupedSearch.families) !== JSON.stringify(['Action', 'Border'])
      || groupedSearch.rowCounts.some(count => count < 1)
      || groupedSearch.names.some(name => !name.includes('selected'))) {
      throw new Error(`Search did not preserve non-empty family groups: ${JSON.stringify(groupedSearch)}`);
    }
    await evaluate(cdp, sessionId, `(() => {
      const search = document.querySelector('[data-token-search]');
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(cdp, sessionId, `document.documentElement.dataset.uiTheme = 'dark'`);
    await delay(50);
    const darkResolved = await evaluate(cdp, sessionId, `(() => {
      const row = [...document.querySelectorAll('[data-token-name]')]
        .find(item => item.dataset.tokenName === '--ui-color-text-primary');
      return row?.querySelector('[data-token-resolved]')?.textContent.trim();
    })()`);
    if (darkResolved !== 'rgb(255, 255, 255)') {
      throw new Error(`Outer dark theme did not refresh the concrete value: ${darkResolved}`);
    }
    await evaluate(cdp, sessionId, `document.documentElement.dataset.uiTheme = 'light'`);
    await delay(50);
    if (process.env.IC_REFERENCE_SCREENSHOT_PATH) {
      await evaluate(cdp, sessionId, `document.querySelector('[data-category="semantic-color"]').click()`);
      await delay(200);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      fs.writeFileSync(process.env.IC_REFERENCE_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
      await evaluate(cdp, sessionId, `document.querySelector('[data-category="all"]').click()`);
    }

    const paletteOrder = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[data-category="palette"]').click();
      const families = [...document.querySelectorAll('[data-token-family] h2')].map(item => item.textContent.trim());
      const firstRow = document.querySelector('[data-token-name="--ui-palette-gray-0"]');
      const previews = [...firstRow.querySelectorAll('.preview-color')].map(preview => {
        const box = preview.getBoundingClientRect();
        return { theme: preview.dataset.previewTheme, color: getComputedStyle(preview).backgroundColor, width: box.width, height: box.height };
      });
      const names = [...document.querySelectorAll('[data-token-name]')]
        .map(card => card.dataset.tokenName)
        .filter(name => name.startsWith('--ui-palette-gray-'));
      return { families, names, previews };
    })()`);
    const expectedPaletteOrder = [
      '--ui-palette-gray-0', '--ui-palette-gray-50', '--ui-palette-gray-100',
      '--ui-palette-gray-200', '--ui-palette-gray-300', '--ui-palette-gray-400',
      '--ui-palette-gray-500', '--ui-palette-gray-600', '--ui-palette-gray-700',
      '--ui-palette-gray-800', '--ui-palette-gray-950', '--ui-palette-gray-1000',
    ];
    if (JSON.stringify(paletteOrder.families) !== JSON.stringify(['Gray', 'Blue', 'Green', 'Amber', 'Red', 'Transparent', 'Brand'])
      || JSON.stringify(paletteOrder.names) !== JSON.stringify(expectedPaletteOrder)
      || JSON.stringify(paletteOrder.previews.map(preview => preview.theme)) !== JSON.stringify(['light', 'dark'])
      || paletteOrder.previews.some(preview => Math.abs(preview.width - preview.height) > 0.01)
      || paletteOrder.previews[0].color !== paletteOrder.previews[1].color) {
      throw new Error(`Palette tokens are not naturally sorted: ${JSON.stringify(paletteOrder)}`);
    }

    const categoryFamilies = await evaluate(cdp, sessionId, `(() => {
      const expectedCategories = ['typography', 'spacing', 'shape', 'sizing', 'focus', 'motion'];
      return Object.fromEntries(expectedCategories.map(category => {
        document.querySelector('[data-category="' + category + '"]').click();
        return [category, [...document.querySelectorAll('[data-token-family] h2')].map(item => item.textContent.trim())];
      }));
    })()`);
    const expectedCategoryFamilies = {
      typography: ['Text Style', 'Font', 'Font Size', 'Font Weight', 'Line Height', 'Letter Spacing'],
      spacing: ['Space'],
      shape: ['Radius', 'Border Width', 'Shadow', 'Z Index'],
      sizing: ['Control Height', 'Icon Size', 'Icon Stroke Width', 'Density'],
      focus: ['Focus Ring', 'Focus Background'],
      motion: ['Duration', 'Easing', 'Distance', 'Iteration'],
    };
    if (JSON.stringify(categoryFamilies) !== JSON.stringify(expectedCategoryFamilies)) {
      throw new Error(`Category family order is incomplete: ${JSON.stringify(categoryFamilies)}`);
    }
    const shadowLevels = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[data-category="shape"]').click();
      return [...document.querySelector('[data-token-family="shadow"]').querySelectorAll('[data-token-name]')]
        .map(item => ({ name: item.dataset.tokenName, value: item.querySelector('[data-token-raw-value]').textContent.trim() }));
    })()`);
    const expectedShadowLevels = [
      { name: '--ui-shadow-none', value: 'none' },
      { name: '--ui-shadow-raised', value: '0 1px 3px 0 rgba(0, 0, 0, 0.05)' },
      { name: '--ui-shadow-overlay', value: '0 8px 10px -5px rgba(0, 0, 0, 0.15)' },
      { name: '--ui-shadow-modal', value: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' },
    ];
    if (JSON.stringify(shadowLevels) !== JSON.stringify(expectedShadowLevels)) {
      throw new Error(`Shadow levels are incomplete or out of order: ${JSON.stringify(shadowLevels)}`);
    }
    await evaluate(cdp, sessionId, `document.querySelector('[data-category="palette"]').click()`);

    const mobileGrouping = await evaluate(cdp, sessionId, `(() => {
      const family = document.querySelector('[data-token-family]');
      const row = family.querySelector('[data-token-name]');
      return {
        heading: family.querySelector('h2')?.textContent.trim(),
        tableDisplay: getComputedStyle(family.querySelector('.token-table')).display,
        rowFamily: row.closest('[data-token-family]') === family,
      };
    })()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await delay(50);
    const mobileTableDisplay = await evaluate(cdp, sessionId, `getComputedStyle(document.querySelector('[data-token-family] .token-table')).display`);
    if (!mobileGrouping.heading || !mobileGrouping.rowFamily || mobileTableDisplay !== 'block') {
      throw new Error(`Mobile family hierarchy is incomplete: ${JSON.stringify({ mobileGrouping, mobileTableDisplay })}`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await evaluate(cdp, sessionId, `document.querySelector('[data-category="all"]').click()`);
    await delay(50);

    const allIntegrity = await evaluate(cdp, sessionId, `(() => {
      const names = [...document.querySelectorAll('[data-token-name]')].map(item => item.dataset.tokenName);
      return {
        rendered: names.length,
        unique: new Set(names).size,
        reported: Number(document.querySelector('[data-results-count]').textContent.split('/')[1].trim()),
        emptyFamilies: [...document.querySelectorAll('[data-token-family]')].filter(item => !item.querySelector('[data-token-name]')).length,
      };
    })()`);
    if (allIntegrity.rendered !== allIntegrity.unique || allIntegrity.rendered !== allIntegrity.reported || allIntegrity.emptyFamilies !== 0) {
      throw new Error(`Tokens were omitted, duplicated, or placed in an empty family: ${JSON.stringify(allIntegrity)}`);
    }

    const draft = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[data-token-edit-toggle]').click();
      const card = [...document.querySelectorAll('[data-token-name]')].find(item => item.dataset.tokenName === '--ui-color-text-primary');
      const light = card.querySelector('[data-token-light]');
      light.value = '--ui-palette-gray-800';
      light.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        cardChanged: card.classList.contains('is-changed'),
        family: card.closest('[data-token-family]')?.querySelector('h2')?.textContent.trim(),
        changeBarVisible: !document.querySelector('[data-token-change-bar]').hidden,
        override: document.querySelector('[data-live-token-overrides]').textContent,
      };
    })()`);
    if (!draft.cardChanged || draft.family !== 'Text' || !draft.changeBarVisible || !draft.override.includes('--ui-palette-gray-800')) {
      throw new Error(`Semantic mapping did not enter preview state: ${JSON.stringify(draft)}`);
    }
    if (process.env.IC_SCREENSHOT_PATH) {
      await evaluate(cdp, sessionId, `(() => {
        const card = [...document.querySelectorAll('[data-token-name]')].find(item => item.dataset.tokenName === '--ui-color-text-primary');
        card.scrollIntoView({ block: 'center' });
      })()`);
      await delay(200);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      fs.writeFileSync(process.env.IC_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    }

    const review = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[data-token-review]').click();
      const dialog = document.querySelector('[data-token-diff-dialog]');
      return { open: dialog.open, text: dialog.textContent.replace(/\\s+/g, ' ').trim() };
    })()`);
    if (!review.open || !review.text.includes('--ui-palette-gray-800') || !review.text.includes('--ui-color-text-primary')) {
      throw new Error(`Diff confirmation is incomplete: ${JSON.stringify(review)}`);
    }

    await evaluate(cdp, sessionId, `document.querySelector('[data-token-save]').click()`);
    await waitFor(cdp, sessionId, `document.querySelector('[data-copy-toast]').textContent.includes('安全保存')`, 'save confirmation');
    if (runtime.saves.length !== 1) throw new Error(`Expected one save, received ${runtime.saves.length}`);
    const savedChange = runtime.saves[0].changes[0];
    if (savedChange.name !== '--ui-color-text-primary' || savedChange.light !== '--ui-palette-gray-800') {
      throw new Error(`Unexpected save payload: ${JSON.stringify(runtime.saves[0])}`);
    }
    if (!runtime.tokenSource().includes('--ui-color-text-primary: light-dark(var(--ui-palette-gray-800), var(--ui-palette-gray-0));')) {
      throw new Error('Saved CSS did not contain the confirmed semantic mapping');
    }
    process.stdout.write(JSON.stringify({ toolbarContract, navigationContract, semanticReference, typeContract, groupedSearch, darkResolved, paletteOrder, categoryFamilies, shadowLevels, mobileTableDisplay, allIntegrity, draft, review, savedChange }) + '\n');
  } finally {
    if (cdp) cdp.socket.close();
    const browserExited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill('SIGTERM');
    await Promise.race([browserExited, delay(2000)]);
    runtime.server.close();
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (_error) {
      // Chrome may still hold a transient profile lock; the OS temp cleaner owns it.
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
