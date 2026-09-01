const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
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
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-component-name-tags-'));
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
    const origin = `http://127.0.0.1:${server.address().port}`;

    const cases = [
      ['action-case.html', 22], ['text-entry-case.html', 21], ['selection-adjustment-case.html', 40],
      ['file-media-input-case.html', 6], ['containers-data-case.html', 17], ['navigation-command-case.html', 17],
      ['dialog-case.html', 8], ['menu-popover-case.html', 12], ['feedback-progress-case.html', 33],
    ];
    const results = {};
    for (const [file, minimum] of cases) {
      await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/${file}?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
      await waitFor(cdp, sessionId, `document.querySelectorAll('.ic-component-name-tag').length >= ${minimum}`, `${file} tags`);
      results[file] = await evaluate(cdp, sessionId, `(() => {
        const tags = [...document.querySelectorAll('.ic-component-name-tag')];
        const invalid = tags.filter(tag => {
          const rect = tag.getBoundingClientRect();
          return !tag.dataset.copyComponentName || rect.width <= 0 || rect.height <= 0 || rect.right > document.documentElement.scrollWidth + 1;
        });
        return { count: tags.length, invalid: invalid.map(tag => tag.dataset.copyComponentName || tag.textContent) };
      })()`);
      if (results[file].invalid.length) throw new Error(`${file} has invalid tags: ${JSON.stringify(results[file])}`);
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/navigation-command-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll('.ic-component-name-tag').length >= 15`, 'navigation command tags');
    const navigationLayout = await evaluate(cdp, sessionId, `(async () => {
      document.documentElement.dataset.uiLibraryLayout = 'compact';
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/static/css/ui-component-library-preview.css';
      document.head.append(stylesheet);
      await new Promise(resolve => { stylesheet.onload = resolve; stylesheet.onerror = resolve; });
      const script = document.createElement('script');
      script.src = '/static/js/ui-component-library/matrix-presentation.js';
      document.head.append(script);
      await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; });
      window.InfiniteCanvasUiMatrixPresentation.apply(document, 'matrix');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const ids = ['horizontal-inline', 'horizontal-inline-plain', 'vertical-inline-plain', 'inline-scroll', 'inline-clip'];
      return ids.map(id => {
        const host = document.querySelector('[data-legal-combination="' + id + '"]');
        const cell = host?.closest('td');
        const hostRect = host?.getBoundingClientRect();
        const cellRect = cell?.getBoundingClientRect();
        const cellStyle = cell ? getComputedStyle(cell) : null;
        const cellContentWidth = cellRect && cellStyle
          ? cellRect.width - parseFloat(cellStyle.paddingLeft) - parseFloat(cellStyle.paddingRight)
          : 0;
        const wrapper = host?.closest('.ic-component-name-example');
        const shadowContent = host?.shadowRoot?.querySelector('[part="content"]');
        const visualRects = host ? [...host.children].filter(child => !child.hidden).map(child => {
          const target = child.localName === 'ic-menu'
            ? child.querySelector('[slot="trigger"]') || child
            : child;
          const visual = target.shadowRoot?.querySelector('[part~="base"]') || target;
          const rect = visual.getBoundingClientRect();
          return {tag: child.localName, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
        }) : [];
        const overlaps = visualRects.some((rect, index) => visualRects.slice(index + 1).some(other => (
          Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1
          && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1
        )));
        const visualOverflow = visualRects.some(rect => (
          rect.left < hostRect.left - 1 || rect.right > hostRect.right + 1
          || rect.top < hostRect.top - 1 || rect.bottom > hostRect.bottom + 1
        ));
        return {
          id,
          blockWrapper: wrapper?.classList.contains('is-block') || false,
          cellWidth: Math.round(cellRect?.width || 0),
          cellContentWidth: Math.round(cellContentWidth),
          hostWidth: Math.round(hostRect?.width || 0),
          hostScrollWidth: host?.scrollWidth || 0,
          hostClientWidth: host?.clientWidth || 0,
          contentScrollWidth: shadowContent?.scrollWidth || 0,
          contentClientWidth: shadowContent?.clientWidth || 0,
          withinCell: Boolean(hostRect && cellRect && hostRect.left >= cellRect.left - 1 && hostRect.right <= cellRect.right + 1),
          visualOverflow,
          overlaps,
        };
      });
    })()`, true);
    const brokenNavigationLayout = navigationLayout.filter(item => (
      !item.withinCell || item.overlaps
      || (item.id !== 'vertical-inline-plain' && item.hostWidth >= item.cellContentWidth - 1)
      || item.visualOverflow
    ));
    if (brokenNavigationLayout.length) {
      throw new Error(`Navigation command matrix clips or overlaps components: ${JSON.stringify(navigationLayout)}`);
    }

    const navigationSizes = await evaluate(cdp, sessionId, `(() => {
      const dimensions = ['small', 'medium', 'large'];
      const measure = (tag, size) => {
        const host = document.querySelector(tag + '[size="' + size + '"]');
        const item = host?.querySelector('[role="tab"], [role="radio"]');
        return {size, host: Boolean(host), itemHeight: Math.round(item?.getBoundingClientRect().height || 0)};
      };
      return {
        tabs: dimensions.map(size => measure('ic-tabs', size)),
        segmented: dimensions.map(size => measure('ic-segmented-control', size)),
      };
    })()`);
    for (const [component, sizes] of Object.entries(navigationSizes)) {
      if (sizes.some(size => !size.host)) {
        throw new Error(`${component} should expose explicit Small, Medium, and Large cases: ${JSON.stringify(sizes)}`);
      }
      if (!(sizes[0].itemHeight < sizes[1].itemHeight && sizes[1].itemHeight < sizes[2].itemHeight)) {
        throw new Error(`${component} item heights should increase from Small to Medium to Large: ${JSON.stringify(sizes)}`);
      }
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/selection-adjustment-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll('.ic-component-name-tag').length >= 40`, 'selection-adjustment variant tags');
    const selectionNames = await evaluate(cdp, sessionId, `[...document.querySelectorAll('.ic-component-name-tag')].map(tag => tag.dataset.copyComponentName)`);
    if (!selectionNames.includes('ic-select') || !selectionNames.includes('ic-select-small') || !selectionNames.includes('ic-select-large')) {
      throw new Error(`Select variants should expose concise S, M, and L copy names: ${JSON.stringify(selectionNames)}`);
    }
    if (!selectionNames.includes('ic-select-model-small') || !selectionNames.includes('ic-select-model') || !selectionNames.includes('ic-select-model-large')) {
      throw new Error(`Model select should expose S, M, and L copy names: ${JSON.stringify(selectionNames)}`);
    }
    const conciseAliases = [
      'ic-checkbox-list-small', 'ic-checkbox-list', 'ic-checkbox-list-large',
      'ic-aspect-ratio-picker-multiple-small', 'ic-aspect-ratio-picker-multiple', 'ic-aspect-ratio-picker-multiple-large',
      'ic-radio-group-tabs-small', 'ic-radio-group-tabs', 'ic-radio-group-tabs-large',
      'ic-select-secondary-small', 'ic-select-secondary', 'ic-select-secondary-large',
      'ic-select-count-small', 'ic-select-count', 'ic-select-count-large',
    ];
    if (!conciseAliases.every(name => selectionNames.includes(name))) {
      throw new Error(`Selection variants should expose concise purpose-based aliases: ${JSON.stringify(selectionNames)}`);
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/text-entry-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll('.ic-component-name-tag').length >= 21`, 'text-entry variant tags');
    const textEntryNames = await evaluate(cdp, sessionId, `[...document.querySelectorAll('.ic-component-name-tag')].map(tag => tag.dataset.copyComponentName)`);
    const expectedTextEntryNames = [
      'ic-form-field-password',
      'ic-form-field-text-s',
      'ic-form-field-text',
      'ic-form-field-text-l',
      'ic-form-field-search-s',
      'ic-form-field-search',
      'ic-form-field-search-l',
      'ic-form-field-text-end-dual',
      'ic-form-field-textarea',
      'ic-form-field-textarea-fixed',
    ];
    const missingTextEntryNames = expectedTextEntryNames.filter(name => !textEntryNames.includes(name));
    if (missingTextEntryNames.length) {
      throw new Error(`Text-entry variants are missing distinct copy names: ${JSON.stringify(missingTextEntryNames)}`);
    }
    if (textEntryNames.some(name => name.includes('without-hint') || name.includes('-with-'))) {
      throw new Error('Text-entry copy names should omit default dimensions and avoid verbose with/without wording');
    }
    if (textEntryNames.some(name => name.includes('-email-') || name.includes('-url-') || name.includes('-tel-'))) {
      throw new Error(`Redundant Email, URL, and Tel previews should be absent: ${JSON.stringify(textEntryNames)}`);
    }
    const verboseTextEntryNames = textEntryNames.filter(name => (
      /-(?:small|large)(?:-|$)/.test(name)
      || name.includes('-hint')
      || /-(?:icon|text|dual)-action(?:-|$)/.test(name)
      || name.includes('textarea-vertical')
      || name.includes('textarea-none')
    ));
    if (verboseTextEntryNames.length) {
      throw new Error(`Text-entry names should use compact token-style dimensions: ${JSON.stringify(verboseTextEntryNames)}`);
    }
    const textInputPaddings = await evaluate(cdp, sessionId, `['s', '', 'l'].map(suffix => {
      const name = \`ic-form-field-text\${suffix ? \`-\${suffix}\` : ''}\`;
      const control = document.querySelector(\`[data-component-name="\${name}"] ic-input\`);
      const base = control.shadowRoot.querySelector('[part~="base"]');
      return { name, left:getComputedStyle(base).paddingLeft, right:getComputedStyle(base).paddingRight };
    })`);
    const expectedTextInputPaddings = [
      { name:'ic-form-field-text-s', left:'8px', right:'4px' },
      { name:'ic-form-field-text', left:'8px', right:'8px' },
      { name:'ic-form-field-text-l', left:'12px', right:'12px' },
    ];
    if (JSON.stringify(textInputPaddings) !== JSON.stringify(expectedTextInputPaddings)) {
      throw new Error(`Text input inline padding should increase from Small to Medium to Large: ${JSON.stringify(textInputPaddings)}`);
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/feedback-progress-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('[data-copy-component-name="ic-badge-status-processing"]')`, 'processing badge variant tag');
    const badgeNames = await evaluate(cdp, sessionId, `[...document.querySelectorAll('ic-badge')].map(node => node.dataset.componentName)`);
    const expectedBadgeNames = ['ic-badge-label-small', 'ic-badge-label', 'ic-badge-label-large', 'ic-badge-label-category', 'ic-badge-count', 'ic-badge-status-processing', 'ic-badge-status-success', 'ic-badge-status-warning', 'ic-badge-status-danger'];
    const missingBadgeNames = expectedBadgeNames.filter(name => !badgeNames.includes(name));
    if (missingBadgeNames.length) {
      throw new Error(`Badge variants are missing distinct copy names: ${JSON.stringify(missingBadgeNames)}`);
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/action-case.html?theme=dark&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('[data-copy-component-name="primary-action"]')`, 'dark primary-action tag');
    const darkNameColors = await evaluate(cdp, sessionId, `(() => {
      const tag = document.querySelector('[data-copy-component-name="primary-action"]');
      return {
        text: getComputedStyle(tag.querySelector('code')).color,
        icon: getComputedStyle(tag.querySelector('ic-icon')).color,
      };
    })()`);
    if (darkNameColors.text !== 'rgb(255, 255, 255)' || darkNameColors.icon !== 'rgb(255, 255, 255)') {
      throw new Error(`Dark component names should use the current primary-text token: ${JSON.stringify(darkNameColors)}`);
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/action-case.html?theme=light&viewport=desktop&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('[data-copy-component-name="primary-action"]')`, 'primary-action tag');
    const copyResult = await evaluate(cdp, sessionId, `(async () => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedName = value; } } });
      const tag = document.querySelector('[data-copy-component-name="primary-action"]');
      tag.click();
      await new Promise(resolve => setTimeout(resolve, 20));
      return { copied: window.__copiedName, state: tag.dataset.copyState, label: tag.getAttribute('aria-label') };
    })()`, true);
    if (copyResult.copied !== 'primary-action' || copyResult.state !== 'copied' || !copyResult.label.startsWith('已复制')) {
      throw new Error(`Copy feedback failed: ${JSON.stringify(copyResult)}`);
    }
    const stateCopyResult = await evaluate(cdp, sessionId, `(async () => {
      const tag = document.querySelector('.action-state-sample[data-state="hover"] [data-copy-component-name="hover"]');
      tag.click();
      await new Promise(resolve => setTimeout(resolve, 20));
      return { copied: window.__copiedName, state: tag.dataset.copyState, label: tag.getAttribute('aria-label') };
    })()`, true);
    if (stateCopyResult.copied !== 'hover' || stateCopyResult.state !== 'copied' || stateCopyResult.label !== '已复制状态值 hover') {
      throw new Error(`State copy feedback failed: ${JSON.stringify(stateCopyResult)}`);
    }
    console.log(JSON.stringify({ cases: results, darkNameColors, copyResult, stateCopyResult }, null, 2));
  } finally {
    cdp?.socket.close();
    browser.kill('SIGTERM');
    server.close();
    if (browser.exitCode === null) {
      await Promise.race([
        new Promise(resolve => browser.once('exit', resolve)),
        delay(3000),
      ]);
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
