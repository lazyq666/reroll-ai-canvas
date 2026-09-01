const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, `Boolean(${expression})`)) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function partCenter(cdp, sessionId, hostSelector, partSelector) {
  return evaluate(cdp, sessionId, `(() => {
    const part = document.querySelector(${JSON.stringify(hostSelector)}).shadowRoot.querySelector(${JSON.stringify(partSelector)});
    const rect = part.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function pressMetric(cdp, sessionId, hostSelector, partSelector, metricPartSelector = partSelector) {
  const point = await partCenter(cdp, sessionId, hostSelector, partSelector);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point }, sessionId);
  await delay(35);
  const metric = await evaluate(cdp, sessionId, `(() => {
    const host = document.querySelector(${JSON.stringify(hostSelector)});
    const style = getComputedStyle(host.shadowRoot.querySelector(${JSON.stringify(metricPartSelector)}));
    return { active: host.matches(':active'), scale: style.scale };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point }, sessionId);
  return metric;
}

async function main() {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-selection-motion-browser-'));
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
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/infinite_canvas_ui_selection_motion_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "document.documentElement.dataset.icSelectionMotionStatus === 'ready'", 'selection motion harness');

    const contracts = await evaluate(cdp, sessionId, `(() => {
      const metric = (host, part) => {
        const element = document.querySelector(host).shadowRoot.querySelector(part);
        if (!element) return { missing: part, markup: document.querySelector(host).shadowRoot.innerHTML };
        const style = getComputedStyle(element);
        return { property: style.transitionProperty, duration: style.transitionDuration, easing: style.transitionTimingFunction, scale: style.scale };
      };
      return {
        checkbox: metric('#motion-checkbox', '[part~="icon"]'),
        radio: (() => {
          const control = document.querySelector('#motion-radio-second').shadowRoot.querySelector('[part~="control"]');
          const style = getComputedStyle(control, '::after');
          return { property: style.transitionProperty, duration: style.transitionDuration, easing: style.transitionTimingFunction, scale: style.scale };
        })(),
        switch: metric('#motion-switch', '[part~="thumb"]'),
        slider: metric('#motion-slider', '[part~="thumb"]'),
      };
    })()`);

    const pressed = {
      checkbox: await pressMetric(cdp, sessionId, '#motion-checkbox', '[part~="control"]'),
      radio: await pressMetric(cdp, sessionId, '#motion-radio-second', '[part~="control"]'),
      switch: await pressMetric(cdp, sessionId, '#motion-switch', '[part~="control"]', '[part~="thumb"]'),
      slider: await pressMetric(cdp, sessionId, '#motion-slider', '[part~="thumb"]'),
      disabledSwitch: await pressMetric(cdp, sessionId, '#disabled-switch', '[part~="control"]', '[part~="thumb"]'),
    };

    await evaluate(cdp, sessionId, `(() => {
      const checkbox = document.querySelector('#motion-checkbox');
      const firstRadio = document.querySelector('#motion-radio-first');
      checkbox.checked = false;
      firstRadio.click();
    })()`);
    await delay(300);
    await evaluate(cdp, sessionId, `(() => {
      const checkbox = document.querySelector('#motion-checkbox');
      const radio = document.querySelector('#motion-radio-second');
      radio.click();
      checkbox.click();
    })()`);
    await delay(45);
    const selectionEntry = await evaluate(cdp, sessionId, `(() => {
      const metric = (host, part, pseudo = null) => {
        const style = getComputedStyle(document.querySelector(host).shadowRoot.querySelector(part), pseudo);
        return { opacity: Number(style.opacity), scale: Number(style.scale) };
      };
      return {
        checkbox: metric('#motion-checkbox', '[part~="icon"]'),
        radio: metric('#motion-radio-second', '[part~="control"]', '::after'),
      };
    })()`);

    await evaluate(cdp, sessionId, `document.documentElement.dataset.uiMotion = 'reduced'`);
    const reduced = await evaluate(cdp, sessionId, `(() => {
      const metric = (host, part, pseudo = null) => getComputedStyle(document.querySelector(host).shadowRoot.querySelector(part), pseudo).transitionDuration;
      return {
        checkbox: metric('#motion-checkbox', '[part~="icon"]'),
        radio: metric('#motion-radio-second', '[part~="control"]', '::after'),
        switch: metric('#motion-switch', '[part~="thumb"]'),
        slider: metric('#motion-slider', '[part~="thumb"]'),
      };
    })()`);
    const reducedPressed = {
      switch: await pressMetric(cdp, sessionId, '#motion-switch', '[part~="control"]', '[part~="thumb"]'),
      slider: await pressMetric(cdp, sessionId, '#motion-slider', '[part~="thumb"]'),
    };

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/infinite_canvas_ui_selection_adjustment_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, "Boolean(document.documentElement.dataset.icSelectionAdjustmentTestStatus)", 'selection behavior contract');
    const behaviorReport = await evaluate(cdp, sessionId, `JSON.parse(document.querySelector('#ic-results').textContent)`);

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/static/ui-component-library.html#selection-adjustment` }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      "document.querySelector('[data-selection-adjustment-matrix]')?.contentDocument?.documentElement?.dataset?.selectionAdjustmentCaseStatus === 'ready'",
      'selection component library fixture',
    );
    const libraryInteraction = await evaluate(cdp, sessionId, `(async () => {
      const preview = document.querySelector('[data-selection-adjustment-matrix]').contentDocument;
      const checkbox = preview.querySelector('ic-checkbox[data-component-name="ic-checkbox-small"]');
      const switchControl = preview.querySelector('ic-switch[data-component-name="ic-switch-small"]');
      const settle = () => new Promise(resolve => setTimeout(resolve, 300));
      checkbox.checked = true;
      await checkbox.updateComplete;
      await settle();
      checkbox.click();
      await checkbox.updateComplete;
      await settle();
      const checkboxInput = checkbox.shadowRoot.querySelector('input[type="checkbox"]');
      const checkboxIcon = getComputedStyle(checkbox.shadowRoot.querySelector('[part~="icon"]'));
      const checkboxAfterCancel = checkbox.checked;
      const checkboxState = {
        property: checkbox.checked,
        attribute: checkbox.hasAttribute('checked'),
        customState: checkbox.matches(':state(checked)'),
        input: checkboxInput.checked,
        iconOpacity: checkboxIcon.opacity,
      };
      const switchMetric = () => {
        const control = getComputedStyle(switchControl.shadowRoot.querySelector('[part~="control"]'));
        const thumb = getComputedStyle(switchControl.shadowRoot.querySelector('[part~="thumb"]'));
        return { background: control.backgroundColor, border: control.borderColor, translate: thumb.translate };
      };
      switchControl.checked = false;
      await switchControl.updateComplete;
      await settle();
      const switchOff = switchMetric();
      switchOff.property = switchControl.checked;
      switchOff.attribute = switchControl.hasAttribute('checked');
      switchOff.customState = switchControl.matches(':state(checked)');
      switchControl.checked = true;
      await switchControl.updateComplete;
      await settle();
      const switchOn = switchMetric();
      return {
        checkboxAfterCancel,
        checkboxState,
        switchOff,
        switchOn,
      };
    })()`);

    const includesAll = (value, names) => typeof value === 'string' && names.every(name => value.split(', ').includes(name));
    const oneMillisecond = value => typeof value === 'string' && value.split(', ').every(duration => duration === '0.001s');
    const checks = {
      checkboxContract: includesAll(contracts.checkbox.property, ['opacity', 'scale']) && contracts.checkbox.duration === '0.15s, 0.24s',
      radioContract: includesAll(contracts.radio.property, ['opacity', 'scale']) && contracts.radio.duration === '0.15s, 0.24s',
      switchContract: includesAll(contracts.switch.property, ['translate', 'scale', 'background-color']) && contracts.switch.duration === '0.24s, 0.24s, 0.15s',
      sliderContract: includesAll(contracts.slider.property, ['scale', 'background-color', 'border-color', 'box-shadow']) && !/left|right|inset|translate/.test(contracts.slider.property),
      pressedFeedback: pressed.checkbox.active && Number(pressed.checkbox.scale) < 1 && pressed.radio.active && Number(pressed.radio.scale) < 1 && pressed.switch.active && pressed.switch.scale !== '1' && pressed.slider.active && Number(pressed.slider.scale) < 1,
      disabledStable: pressed.disabledSwitch.active && ['none', '1'].includes(pressed.disabledSwitch.scale),
      selectionEntry: selectionEntry.checkbox.opacity > 0 && selectionEntry.checkbox.opacity < 1 && selectionEntry.checkbox.scale > .4 && selectionEntry.checkbox.scale < .8 && selectionEntry.radio.opacity > 0 && selectionEntry.radio.opacity < 1 && selectionEntry.radio.scale > .4 && selectionEntry.radio.scale < .7,
      reducedDurations: Object.values(reduced).every(oneMillisecond),
      reducedNoPressTransform: reducedPressed.switch.scale === '1' && reducedPressed.slider.scale === '1',
      behaviorContract: Object.values(behaviorReport.checks).every(Boolean),
      libraryCheckboxCanCancel: libraryInteraction.checkboxAfterCancel === false
        && libraryInteraction.checkboxState.customState === false
        && libraryInteraction.checkboxState.iconOpacity === '0',
      librarySwitchStatesDistinct: libraryInteraction.switchOff.background !== libraryInteraction.switchOn.background
        && libraryInteraction.switchOff.translate !== libraryInteraction.switchOn.translate,
    };
    const report = { checks, contracts, pressed, selectionEntry, reduced, reducedPressed, behaviorReport, libraryInteraction };
    console.log(JSON.stringify(report, null, 2));
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  } finally {
    cdp?.close();
    browser.kill('SIGTERM');
    server.close();
    await Promise.race([
      new Promise(resolve => browser.once('exit', resolve)),
      delay(1000),
    ]);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
