const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');


const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME = process.env.IC_BROWSER_BIN || DEFAULT_CHROME;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function startStaticServer() {
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
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      });
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

async function connectCdp(url) {
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

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function waitForProcessExit(child, timeout = 5000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForHarness(cdp, sessionId) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const evaluation = await cdp.send(
      'Runtime.evaluate',
      { expression: "document.documentElement?.dataset.icTestStatus || ''", returnByValue: true },
      sessionId,
    );
    const status = evaluation.result.value;
    if (status) return status;
    await delay(100);
  }
  throw new Error('Timed out waiting for the Reroll UI browser harness');
}

async function accessibilityControls(cdp, sessionId) {
  const tree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
  return tree.nodes
    .filter(node => !node.ignored && ['button', 'textbox', 'dialog'].includes(node.role?.value))
    .map(node => ({ role: node.role.value, name: node.name?.value || '' }));
}

async function closeHarnessDialog(cdp, sessionId) {
  await cdp.send(
    'Runtime.evaluate',
    {
      expression: `new Promise(resolve => {
        const dialog = document.querySelector('#delete-dialog');
        if (!dialog?.open) return resolve();
        dialog.addEventListener('ic-after-hide', resolve, { once: true });
        dialog.open = false;
      })`,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );
}

async function focusPolicyInteractions(cdp, sessionId) {
  const rectResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const rect = document.querySelector('#focus-policy-button').getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const { x, y } = rectResult.result.value;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
  await delay(20);

  const pointerResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const host = document.querySelector('#focus-policy-button');
        const style = getComputedStyle(host.shadowRoot.querySelector('[part~="base"]'));
        return {
          modality: document.documentElement.dataset.icInputModality,
          focused: document.activeElement === host,
          outlineHidden: style.outlineStyle === 'none',
          shadowHidden: style.boxShadow === 'none',
        };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );

  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    sessionId,
  );
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    sessionId,
  );
  await cdp.send(
    'Runtime.evaluate',
    { expression: "document.querySelector('#focus-policy-button').focus()" },
    sessionId,
  );
  await delay(20);

  const keyboardResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const host = document.querySelector('#focus-policy-button');
        const style = getComputedStyle(host.shadowRoot.querySelector('[part~="base"]'));
        return {
          modality: document.documentElement.dataset.icInputModality,
          focused: document.activeElement === host,
          outlineVisible: style.outlineStyle !== 'none',
          shadowVisible: style.boxShadow !== 'none',
        };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );

  return {
    pointer: pointerResult.result.value,
    keyboard: keyboardResult.result.value,
  };
}

async function menuFocusPolicyInteractions(cdp, sessionId) {
  const rectResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const rect = document.querySelector('#focus-menu-trigger').getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const { x, y } = rectResult.result.value;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
  await delay(20);

  const pointerResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const menu = document.querySelector('#focus-policy-menu');
        const first = menu.querySelector('ic-menu-item[value="first"]');
        const style = getComputedStyle(first.shadowRoot.querySelector('button'));
        return {
          modality: document.documentElement.dataset.icInputModality,
          menuOpen: menu.hasAttribute('open'),
          focusedValue: document.activeElement?.getAttribute?.('value'),
          outlineHidden: style.outlineStyle === 'none',
          shadowHidden: style.boxShadow === 'none',
          backgroundHidden: style.backgroundColor === 'rgba(0, 0, 0, 0)',
        };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );

  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    sessionId,
  );
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    sessionId,
  );
  await delay(20);

  const keyboardResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const menu = document.querySelector('#focus-policy-menu');
        const second = menu.querySelector('ic-menu-item[value="second"]');
        const style = getComputedStyle(second.shadowRoot.querySelector('button'));
        return {
          modality: document.documentElement.dataset.icInputModality,
          focusedValue: document.activeElement?.getAttribute?.('value'),
          outlineVisible: style.outlineStyle !== 'none',
          shadowVisible: style.boxShadow !== 'none',
          backgroundVisible: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );

  const hideResult = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const menu = document.querySelector('#focus-policy-menu');
        const trigger = document.querySelector('#focus-menu-trigger');
        try {
          menu.hide('focus-policy-test');
          return {
            error: '',
            closed: !menu.hasAttribute('open'),
            focusReturned: document.activeElement === trigger,
          };
        } catch (error) {
          return {
            error: String(error?.stack || error),
            closed: !menu.hasAttribute('open'),
            focusReturned: document.activeElement === trigger,
          };
        }
      })()`,
      returnByValue: true,
    },
    sessionId,
  );

  return {
    pointer: pointerResult.result.value,
    keyboard: keyboardResult.result.value,
    hide: hideResult.result.value,
  };
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);

  const server = await startStaticServer();
  const address = server.address();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-core-browser-'));
  const browser = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let cdp;
  try {
    cdp = await connectCdp(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Accessibility.enable', {}, sessionId);
    await cdp.send(
      'Page.navigate',
      { url: `http://127.0.0.1:${address.port}/tests/ic_core_browser_harness.html` },
      sessionId,
    );

    const status = await waitForHarness(cdp, sessionId);
    const resultText = await cdp.send(
      'Runtime.evaluate',
      { expression: "document.querySelector('#ic-results').textContent", returnByValue: true },
      sessionId,
    );
    const report = JSON.parse(resultText.result.value);
    const modalAccessibility = await accessibilityControls(cdp, sessionId);
    await closeHarnessDialog(cdp, sessionId);
    report.focusInteractions = await focusPolicyInteractions(cdp, sessionId);
    report.checks.focusInteraction =
      report.focusInteractions.pointer.modality === 'pointer' &&
      report.focusInteractions.pointer.focused &&
      report.focusInteractions.pointer.outlineHidden &&
      report.focusInteractions.pointer.shadowHidden &&
      report.focusInteractions.keyboard.modality === 'keyboard' &&
      report.focusInteractions.keyboard.focused &&
      report.focusInteractions.keyboard.outlineVisible &&
      !report.focusInteractions.keyboard.shadowVisible;
    report.menuFocusInteractions = await menuFocusPolicyInteractions(cdp, sessionId);
    report.checks.menuFocusInteraction =
      report.menuFocusInteractions.pointer.modality === 'pointer' &&
      report.menuFocusInteractions.pointer.menuOpen &&
      report.menuFocusInteractions.pointer.focusedValue === 'first' &&
      report.menuFocusInteractions.pointer.outlineHidden &&
      report.menuFocusInteractions.pointer.shadowHidden &&
      report.menuFocusInteractions.pointer.backgroundHidden &&
      report.menuFocusInteractions.keyboard.modality === 'keyboard' &&
      report.menuFocusInteractions.keyboard.focusedValue === 'second' &&
      report.menuFocusInteractions.keyboard.outlineVisible &&
      !report.menuFocusInteractions.keyboard.shadowVisible &&
      report.menuFocusInteractions.keyboard.backgroundVisible &&
      report.menuFocusInteractions.hide.error === '' &&
      report.menuFocusInteractions.hide.closed &&
      report.menuFocusInteractions.hide.focusReturned;
    const pageAccessibility = await accessibilityControls(cdp, sessionId);
    report.accessibility = [...modalAccessibility, ...pageAccessibility].filter(
      (item, index, all) =>
        all.findIndex(candidate => candidate.role === item.role && candidate.name === item.name) === index,
    );
    report.browser = await cdp.send('Browser.getVersion');
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (status !== 'passed' || !report.checks.focusInteraction || !report.checks.menuFocusInteraction) {
      process.exitCode = 1;
    }
  } finally {
    try {
      if (cdp) await cdp.send('Browser.close');
    } catch {}
    server.close();
    await waitForProcessExit(browser);
    if (browser.exitCode === null) {
      browser.kill('SIGTERM');
      await waitForProcessExit(browser);
    }
    if (profile.startsWith(`${os.tmpdir()}${path.sep}ic-core-browser-`)) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
