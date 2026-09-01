const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');


const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
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
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (!operation) return;
    pending.delete(payload.id);
    if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
    else operation.resolve(payload.result);
  });
  return {
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

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-aspect-ratio-picker-'));
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
      width: 1180, height: 720, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await cdp.send('Page.navigate', {
      url: `${origin}/static/design-system/infinite-canvas-ui/selection-adjustment-case.html?theme=light&viewport=desktop&locale=zh-CN`,
    }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      "document.documentElement.dataset.selectionAdjustmentCaseStatus === 'ready' && document.querySelector('.aspect-ratio-picker-demo ic-aspect-ratio-picker')?.shadowRoot?.querySelectorAll('button').length === 4",
      'aspect ratio picker',
    );

    const report = await evaluate(cdp, sessionId, `(async () => {
      const picker = document.querySelector('.aspect-ratio-picker-demo ic-aspect-ratio-picker');
      const tablePicker = document.querySelector('[data-component-name="ic-aspect-ratio-picker-multiple"]');
      const tableButtons = [...tablePicker.shadowRoot.querySelectorAll('.ratio-options button')];
      const tableButtonsPerRow = Object.values(tableButtons.reduce((rows, button) => {
        const top = Math.round(button.getBoundingClientRect().top);
        rows[top] = (rows[top] || 0) + 1;
        return rows;
      }, {}));
      const form = picker.closest('form');
      const events = [];
      picker.addEventListener('input', () => events.push('input'));
      picker.addEventListener('change', () => events.push('change'));
      picker.shadowRoot.querySelector('[data-value="wide"]').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selectedButton = picker.shadowRoot.querySelector('[data-value="wide"]');
      selectedButton.blur();
      const selectedStyle = getComputedStyle(selectedButton);
      const selectedBackground = selectedStyle.backgroundColor;
      const selectedBorder = selectedStyle.borderTopColor;
      const selectedShadow = selectedStyle.boxShadow;
      const selectedRadius = selectedStyle.borderRadius;
      const selectedBackgroundProbe = document.createElement('span');
      selectedBackgroundProbe.style.backgroundColor = 'var(--ui-color-action-secondary)';
      selectedBackgroundProbe.style.border = '1px solid var(--ui-color-border-primary)';
      selectedBackgroundProbe.style.boxShadow = 'var(--ui-shadow-raised)';
      selectedBackgroundProbe.style.borderRadius = 'var(--ui-radius-s)';
      document.body.append(selectedBackgroundProbe);
      const selectedTokenStyle = getComputedStyle(selectedBackgroundProbe);
      const selectedBackgroundToken = selectedTokenStyle.backgroundColor;
      const selectedBorderToken = selectedTokenStyle.borderTopColor;
      const selectedShadowToken = selectedTokenStyle.boxShadow;
      const selectedRadiusToken = selectedTokenStyle.borderRadius;
      const tableSelectedStyle = getComputedStyle(tablePicker.shadowRoot.querySelector('[aria-checked="true"]'));
      const tableSelectedBackground = tableSelectedStyle.backgroundColor;
      const tableSelectedBorder = tableSelectedStyle.borderTopColor;
      const tableSelectedShadow = tableSelectedStyle.boxShadow;
      const tableSelectedRadius = tableSelectedStyle.borderRadius;
      selectedBackgroundProbe.style.backgroundColor = 'var(--ui-color-surface-subtle)';
      selectedBackgroundProbe.style.borderColor = 'transparent';
      selectedBackgroundProbe.style.boxShadow = 'none';
      const tableSelectedBackgroundToken = getComputedStyle(selectedBackgroundProbe).backgroundColor;
      const tableSelectedBorderToken = getComputedStyle(selectedBackgroundProbe).borderTopColor;
      const tableSelectedShadowToken = getComputedStyle(selectedBackgroundProbe).boxShadow;
      const generationPicker = document.querySelector('ic-generation-settings-picker');
      const generationPanel = generationPicker.shadowRoot.querySelector('[part="panel"]');
      const generationSelectedSegments = [
        generationPicker.shadowRoot.querySelector('[data-resolution][aria-checked="true"]'),
        generationPicker.shadowRoot.querySelector('[data-quality][aria-checked="true"]'),
      ];
      selectedBackgroundProbe.style.backgroundColor = 'var(--ui-color-action-secondary)';
      selectedBackgroundProbe.style.borderColor = 'var(--ui-color-border-primary)';
      selectedBackgroundProbe.style.boxShadow = 'var(--ui-shadow-raised)';
      selectedBackgroundProbe.style.borderRadius = 'var(--ui-radius-s)';
      const generationTokenStyle = getComputedStyle(selectedBackgroundProbe);
      const generationSelectedTokensMatch = generationSelectedSegments.every(segment => {
        const style = getComputedStyle(segment);
        return style.backgroundColor === generationTokenStyle.backgroundColor
          && style.borderTopColor === generationTokenStyle.borderTopColor
          && style.boxShadow === generationTokenStyle.boxShadow;
      });
      const generationPanelRadiusMatches = getComputedStyle(generationPanel).borderRadius === generationTokenStyle.borderRadius;
      const generationSegmentsRadiusMatches = [...generationPicker.shadowRoot.querySelectorAll('.segments')]
        .every(segments => getComputedStyle(segments).borderRadius === generationTokenStyle.borderRadius);
      const generationAspectOptionsRadiusMatches = getComputedStyle(
        generationPicker.shadowRoot.querySelector('ic-aspect-ratio-picker').shadowRoot.querySelector('.options')
      ).borderRadius === generationTokenStyle.borderRadius;
      const generationAspectSelectedRadiusMatches = getComputedStyle(
        generationPicker.shadowRoot.querySelector('ic-aspect-ratio-picker').shadowRoot.querySelector('[aria-checked="true"]')
      ).borderRadius === generationTokenStyle.borderRadius;
      selectedBackgroundProbe.remove();
      const shapeStrokeWidth = getComputedStyle(picker.shadowRoot.querySelector('[data-value="wide"] .shape')).borderTopWidth;
      const shapeStrokeToken = getComputedStyle(picker).getPropertyValue('--ui-icon-stroke-width-m').trim();
      const wide = picker.shadowRoot.querySelector('[data-value="wide"] .shape').getBoundingClientRect();
      const story = picker.shadowRoot.querySelector('[data-value="portrait"] .shape').getBoundingClientRect();
      const selected = picker.shadowRoot.querySelector('[aria-checked="true"]');
      selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return {
        optionValues: [...picker.shadowRoot.querySelectorAll('button')].map(item => item.dataset.value),
        customEditorVisible: Boolean(picker.shadowRoot.querySelector('.custom-editor')),
        customOptionVisible: Boolean(picker.shadowRoot.querySelector('[data-value="custom"]')),
        selectedBackground,
        selectedBackgroundToken,
        selectedBorder,
        selectedBorderToken,
        selectedShadow,
        selectedShadowToken,
        selectedRadius,
        selectedRadiusToken,
        tableSelectedBackground,
        tableSelectedBackgroundToken,
        tableSelectedBorder,
        tableSelectedBorderToken,
        tableSelectedShadow,
        tableSelectedShadowToken,
        tableSelectedRadius,
        generationSelectedTokensMatch,
        generationPanelRadiusMatches,
        generationSegmentsRadiusMatches,
        generationAspectOptionsRadiusMatches,
        generationAspectSelectedRadiusMatches,
        shapeStrokeWidth,
        shapeStrokeToken,
        valueAfterKeyboard: picker.value,
        formValue: new FormData(form).get(picker.name),
        output: form.querySelector('output').value,
        events,
        selectedCount: picker.shadowRoot.querySelectorAll('[aria-checked="true"]').length,
        wideIsLandscape: wide.width > wide.height,
        storyIsPortrait: story.height > story.width,
        tableMultipleMaxButtonsPerRow: Math.max(0, ...tableButtonsPerRow),
        overflow: picker.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      };
    })()`);
    const tableSelectedPoint = await evaluate(cdp, sessionId, `(async () => {
      const button = document.querySelector('[data-component-name="ic-aspect-ratio-picker-multiple"]')
        .shadowRoot.querySelector('[aria-checked="true"]');
      button.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...tableSelectedPoint }, sessionId);
    await delay(120);
    report.tableSelectedHoverBackground = await evaluate(cdp, sessionId, `getComputedStyle(
      document.querySelector('[data-component-name="ic-aspect-ratio-picker-multiple"]')
        .shadowRoot.querySelector('[aria-checked="true"]')
    ).backgroundColor`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await delay(200);
    report.narrowOverflow = await evaluate(cdp, sessionId, `(() => {
      const demo = document.querySelector('.aspect-ratio-picker-demo');
      return demo.scrollWidth > demo.clientWidth + 1;
    })()`);
    const expectedValues = ['square', 'portrait', 'landscape', 'wide'];
    const passed = (
      JSON.stringify(report.optionValues) === JSON.stringify(expectedValues)
      && !report.customOptionVisible
      && !report.customEditorVisible
      && report.selectedBackground === report.selectedBackgroundToken
      && report.selectedBorder === report.selectedBorderToken
      && report.selectedShadow === report.selectedShadowToken
      && report.selectedRadius === report.selectedRadiusToken
      && report.tableSelectedBackground === report.tableSelectedBackgroundToken
      && report.tableSelectedHoverBackground === report.tableSelectedBackgroundToken
      && report.tableSelectedBorder === report.tableSelectedBorderToken
      && report.tableSelectedShadow === report.tableSelectedShadowToken
      && report.tableSelectedRadius === report.selectedRadiusToken
      && report.generationSelectedTokensMatch
      && report.generationPanelRadiusMatches
      && report.generationSegmentsRadiusMatches
      && report.generationAspectOptionsRadiusMatches
      && report.generationAspectSelectedRadiusMatches
      && report.shapeStrokeToken === '1.5'
      && Number.parseFloat(report.shapeStrokeWidth) >= 1
      && report.valueAfterKeyboard === 'square'
      && report.formValue === 'square'
      && report.output === 'square'
      && report.events.filter(event => event === 'input').length >= 2
      && report.events.filter(event => event === 'change').length >= 2
      && report.selectedCount === 1
      && report.wideIsLandscape
      && report.storyIsPortrait
      && report.tableMultipleMaxButtonsPerRow > 1
      && !report.overflow
      && !report.narrowOverflow
    );
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    fs.writeFileSync('/tmp/ic-aspect-ratio-picker.png', Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ passed, report, screenshot: '/tmp/ic-aspect-ratio-picker.png' }));
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
