const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      response.writeHead(200, { 'Content-Type': `${MIME[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
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
      if (match) { clearTimeout(timeout); resolve(match[1]); }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-actions-truth-'));
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
    await cdp.send('Page.navigate', { url: `${origin}/static/ui-component-library.html#actions` }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      `document.querySelector('[data-component-name="ic-button-primary-hover"] ic-button')?.shadowRoot?.querySelector('[part~="base"]')`,
      'Actions matrix components',
    );

    const videoPlayButton = await evaluate(cdp, sessionId, `(() => {
      const section = document.querySelector('[data-component-name="ic-video-play-button"]');
      const host = section?.querySelector('ic-video-play-button');
      const rect = host?.getBoundingClientRect();
      const asset = host?.shadowRoot?.querySelector('[part="asset"]');
      return {
        sectionPresent: Boolean(section),
        upgraded: Boolean(host?.shadowRoot?.querySelector('button')),
        visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        width: rect?.width || 0,
        height: rect?.height || 0,
        assetSource: asset?.getAttribute('src') || '',
        assetLoaded: Boolean(asset?.complete && asset?.naturalWidth > 0),
      };
    })()`);
    if (
      !videoPlayButton.sectionPresent || !videoPlayButton.upgraded || !videoPlayButton.visible
      || videoPlayButton.width !== 64 || videoPlayButton.height !== 64
      || !videoPlayButton.assetSource.endsWith('/static/images/ui/video-play-button.svg')
      || !videoPlayButton.assetLoaded
    ) {
      throw new Error(`Video play button is missing from the visible Actions page: ${JSON.stringify(videoPlayButton)}`);
    }

    const report = await evaluate(cdp, sessionId, `(async () => {
      const mappings = [
        ['ic-button-primary-hover', '--ui-color-action-primary-hover', 'backgroundColor', 'hover'],
        ['ic-button-secondary-hover', '--ui-color-action-secondary-hover', 'backgroundColor', 'hover'],
        ['ic-button-tertiary-hover', '--ui-color-action-tertiary-hover', 'backgroundColor', 'hover'],
        ['ic-button-primary-danger', '--ui-color-action-primary-danger', 'backgroundColor', null],
        ['ic-button-primary-danger', '--ui-color-text-on-action-primary-danger', 'color', null],
        ['ic-button-primary-danger-hover', '--ui-color-action-primary-danger-hover', 'backgroundColor', 'hover'],
        ['ic-button-secondary-danger', '--ui-color-action-secondary-danger', 'backgroundColor', null],
        ['ic-button-secondary-danger-hover', '--ui-color-action-secondary-danger-hover', 'backgroundColor', 'hover'],
        ['ic-button-tertiary-danger', '--ui-color-action-tertiary-danger', 'backgroundColor', null],
        ['ic-button-tertiary-danger-hover', '--ui-color-action-tertiary-danger-hover', 'backgroundColor', 'hover'],
        ['ic-icon-button-secondary-hover', '--ui-color-action-secondary-hover', 'backgroundColor', 'hover'],
        ['ic-icon-button-primary-hover', '--ui-color-action-primary-hover', 'backgroundColor', 'hover'],
        ['ic-icon-button-tertiary', '--ui-color-text-secondary', 'color', null],
        ['ic-icon-button-tertiary-hover', '--ui-color-text-tertiary', 'color', 'hover'],
      ];
      const resolveColor = (token, property) => {
        const probe = document.createElement('span');
        probe.style[property] = 'var(' + token + ')';
        document.body.append(probe);
        const value = getComputedStyle(probe)[property];
        probe.remove();
        return value;
      };
      const measure = async theme => {
        document.documentElement.dataset.uiTheme = theme;
        document.documentElement.classList.toggle('theme-dark', theme === 'dark');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise(resolve => setTimeout(resolve, 300));
        const hover = mappings.map(([name, token, property, expectedPreviewState]) => {
          const host = document.querySelector('[data-component-name="' + name + '"] > :is(ic-button, ic-icon-button)');
          const base = host?.shadowRoot?.querySelector('[part~="base"]');
          return {
            name, token, property,
            previewState: host?.dataset.previewState || null,
            expectedPreviewState,
            actual: base ? getComputedStyle(base)[property] : null,
            expected: resolveColor(token, property),
          };
        });
        const shadowProbe = document.createElement('span');
        shadowProbe.style.boxShadow = 'var(--ui-shadow-raised)';
        document.body.append(shadowProbe);
        const expectedShadow = getComputedStyle(shadowProbe).boxShadow;
        shadowProbe.remove();
        const primaryButtonBase = document.querySelector('[data-component-name="ic-button-primary"] ic-button')
          ?.shadowRoot?.querySelector('[part~="base"]');
        const expectedRadius = primaryButtonBase ? getComputedStyle(primaryButtonBase).borderRadius : null;
        const expectedBorderColor = resolveColor('--ui-color-border-secondary', 'color');
        const iconTiers = ['ic-icon-button-secondary', 'ic-icon-button-tertiary'].map(name => {
          const host = document.querySelector('[data-component-name="' + name + '"] ic-icon-button');
          const base = host?.shadowRoot?.querySelector('[part~="base"]');
          const style = base ? getComputedStyle(base) : null;
          return {
            name,
            radius: style?.borderRadius || null,
            borderColor: style?.borderColor || null,
            borderWidth: style?.borderWidth || null,
            backgroundColor: style?.backgroundColor || null,
            boxShadow: style?.boxShadow || null,
            pill: host?.pill,
          };
        });
        return { theme, hover, iconTiers, expectedRadius, expectedBorderColor, expectedShadow };
      };
      const light = await measure('light');
      const dark = await measure('dark');
      return {
        themes: [light, dark],
        externalFakes: document.querySelectorAll('.target-component-demo-hover, .target-component-demo-focus').length,
      };
    })()`, true);

    const broken = report.themes.flatMap(theme => (
      theme.hover.filter(item => item.previewState !== item.expectedPreviewState || item.actual !== item.expected)
    ));
    const brokenIconTiers = report.themes.flatMap(theme => theme.iconTiers.filter(item => {
      if (item.radius !== theme.expectedRadius || item.pill !== false) return true;
      if (item.name === 'ic-icon-button-secondary') return (
        item.borderColor !== theme.expectedBorderColor
        || item.borderWidth !== '1px'
        || item.boxShadow !== theme.expectedShadow
      );
      return item.borderWidth !== '0px'
        || item.backgroundColor !== 'rgba(0, 0, 0, 0)'
        || item.boxShadow !== 'none';
    }));
    if (report.externalFakes || broken.length || brokenIconTiers.length) throw new Error(`Actions matrix differs from component semantics: ${JSON.stringify(report, null, 2)}`);

    const primaryRect = await evaluate(cdp, sessionId, `(() => {
      document.documentElement.dataset.uiTheme = 'light';
      document.documentElement.classList.remove('theme-dark');
      const host = document.querySelector('[data-component-name="ic-button-primary"] ic-button');
      const rect = host.shadowRoot.querySelector('[part~="base"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: primaryRect.x + primaryRect.width / 2,
      y: primaryRect.y + primaryRect.height / 2,
    }, sessionId);
    await delay(300);
    const pointerHover = await evaluate(cdp, sessionId, `(() => {
      const host = document.querySelector('[data-component-name="ic-button-primary"] ic-button');
      const base = host.shadowRoot.querySelector('[part~="base"]');
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--ui-color-action-primary-hover)';
      document.body.append(probe);
      const result = {
        hostHover: host.matches(':hover'),
        baseHover: base.matches(':hover'),
        actual: getComputedStyle(base).backgroundColor,
        expected: getComputedStyle(probe).backgroundColor,
        transform: getComputedStyle(base).transform,
        boxShadow: getComputedStyle(base).boxShadow,
      };
      probe.remove();
      return result;
    })()`);
    if (
      !pointerHover.hostHover || !pointerHover.baseHover || pointerHover.actual !== pointerHover.expected
      || pointerHover.transform !== 'none' || pointerHover.boxShadow !== 'none'
    ) {
      throw new Error(`Primary pointer hover does not match its semantic state: ${JSON.stringify(pointerHover, null, 2)}`);
    }

    await cdp.send('Page.navigate', { url: `${origin}/static/design-system/infinite-canvas-ui/action-case.html?theme=light` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('[data-state="pressed"] ic-button')?.shadowRoot?.querySelector('[part~="base"]')`, 'Actions live state samples');
    const liveStates = await evaluate(cdp, sessionId, `(() => {
      const read = state => {
        const host = document.querySelector('[data-state="' + state + '"] ic-button');
        const base = host.shadowRoot.querySelector('[part~="base"]');
        const style = getComputedStyle(base);
        return { state, previewState: host.dataset.previewState, backgroundColor: style.backgroundColor, outlineWidth: style.outlineWidth, transform: style.transform };
      };
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--ui-color-action-secondary-hover)';
      document.body.append(probe);
      const secondaryHover = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { states: ['hover', 'focus-visible', 'pressed'].map(read), secondaryHover };
    })()`);
    const [liveHover, liveFocus, livePressed] = liveStates.states;
    if (
      liveHover.previewState !== 'hover' || liveHover.backgroundColor !== liveStates.secondaryHover
      || liveFocus.previewState !== 'focus-visible' || liveFocus.outlineWidth === '0px'
      || livePressed.previewState !== 'pressed' || livePressed.transform === 'none'
    ) throw new Error(`Actions live case does not use component-owned states: ${JSON.stringify(liveStates, null, 2)}`);

    process.stdout.write(`${JSON.stringify({ actionsMatrixTruth: true, iconTierSurfaceTruth: true, primaryPointerHoverTruth: true, actionsLiveStateTruth: true, themes: ['light', 'dark'], hoverSamples: 9, dangerDefaultSamples: 3, focusSamples: 1 })}\n`);
  } finally {
    cdp?.socket.close();
    if (browser.exitCode === null) {
      const exited = new Promise(resolve => browser.once('exit', resolve));
      browser.kill();
      await Promise.race([exited, delay(3000)]);
    }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
