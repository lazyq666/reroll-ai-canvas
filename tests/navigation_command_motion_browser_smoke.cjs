const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(process.env.IC_TEST_ROOT || path.resolve(__dirname, '..'));
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      const type = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json' }[path.extname(filePath)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
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
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once:true });
    socket.addEventListener('error', reject, { once:true });
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-navigation-motion-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio:['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url:'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId:target.targetId, flatten:true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await cdp.send('Page.navigate', { url:`${origin}/tests/infinite_canvas_ui_navigation_command_browser_harness.html` }, sessionId);
    await waitFor(cdp, sessionId, `Boolean(document.documentElement.dataset.icNavigationCommandTestStatus)`, 'navigation public behavior harness');
    const behaviorHarness = await evaluate(cdp, sessionId, `({status:document.documentElement.dataset.icNavigationCommandTestStatus,checks:document.body.dataset.checks})`);
    await cdp.send('Page.navigate', { url:`${origin}/static/design-system/infinite-canvas-ui/navigation-command-case.html?theme=light&locale=zh-CN` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelector('[data-component-name="ic-tabs-horizontal"]')?.dataset?.icContractStatus === 'ready'`, 'navigation fixture');

    const report = await evaluate(cdp, sessionId, `(async () => {
      const tabs = document.querySelector('[data-component-name="ic-tabs-horizontal"]');
      const tabsStyle = tabs.shadowRoot.querySelector('style');
      const tabItems = [...tabs.querySelectorAll('[role="tab"]')];
      tabItems[1].click();
      const tabsResult = {
        sameShadow: tabsStyle === tabs.shadowRoot.querySelector('style'),
        value: tabs.getAttribute('value'),
        selected: tabItems.map(item => item.getAttribute('aria-selected')),
        duration: getComputedStyle(tabItems[1]).transitionDuration,
      };

      const segmented = document.querySelector('[data-component-name="ic-segmented-control"]');
      const segmentedStyle = segmented.shadowRoot.querySelector('style');
      const segmentItems = [...segmented.querySelectorAll('[role="radio"]')];
      segmentItems[1].click();
      const segmentedResult = {
        sameShadow: segmentedStyle === segmented.shadowRoot.querySelector('style'),
        value: segmented.getAttribute('value'),
        checked: segmentItems.map(item => item.getAttribute('aria-checked')),
        duration: getComputedStyle(segmentItems[1]).transitionDuration,
      };

      const disclosure = document.querySelector('[data-component-name="ic-nav-disclosure"]');
      const disclosureItems = disclosure.shadowRoot.querySelector('.items');
      const openHeight = disclosureItems.getBoundingClientRect().height;
      disclosure.shadowRoot.querySelector('.trigger').click();
      await new Promise(resolve => setTimeout(resolve, 40));
      const closingHeight = disclosureItems.getBoundingClientRect().height;
      const closingOpacity = Number(getComputedStyle(disclosureItems).opacity);
      const disclosureResult = {
        sameItems: disclosureItems === disclosure.shadowRoot.querySelector('.items'),
        expanded: disclosure.shadowRoot.querySelector('.trigger').getAttribute('aria-expanded'),
        openHeight,
        closingHeight,
        closingOpacity,
        duration: getComputedStyle(disclosureItems).transitionDuration,
      };
      await new Promise(resolve => setTimeout(resolve, 260));
      disclosureResult.closedHeight = disclosureItems.getBoundingClientRect().height;
      disclosureResult.closedOpacity = getComputedStyle(disclosureItems).opacity;

      const steps = document.querySelector('ic-steps');
      const stepsTrack = steps.shadowRoot.querySelector('.track');
      steps.setAttribute('current', '3');
      const stepItems = [...steps.shadowRoot.querySelectorAll('.step')];
      const stepsResult = {
        sameTrack: stepsTrack === steps.shadowRoot.querySelector('.track'),
        states: stepItems.map(item => item.dataset.state),
        current: stepItems.map(item => item.getAttribute('aria-current')),
        duration: getComputedStyle(stepItems[2].querySelector('.indicator')).transitionDuration,
      };

      document.documentElement.dataset.uiMotion = 'reduced';
      const reduced = {
        tabs: getComputedStyle(tabItems[1]).transitionDuration,
        segmented: getComputedStyle(segmentItems[1]).transitionDuration,
        disclosure: getComputedStyle(disclosureItems).transitionDuration,
        steps: getComputedStyle(stepItems[2].querySelector('.indicator')).transitionDuration,
      };
      return { tabs:tabsResult, segmented:segmentedResult, disclosure:disclosureResult, steps:stepsResult, reduced };
    })()`);
    report.behaviorHarness = behaviorHarness;
    const allowedBaselineFailures = new Set([
      'tabsHorizontalAutomaticRadius',
      'tabsFocusRingContained',
      'segmentedSizes',
    ]);
    const behaviorChecks = JSON.parse(report.behaviorHarness.checks || '{}');
    report.behaviorHarness.unexpectedFailures = Object.entries(behaviorChecks)
      .filter(([name, passed]) => !passed && !allowedBaselineFailures.has(name))
      .map(([name]) => name);

    const standardDuration = value => value.split(',').every(item => parseFloat(item) > 0.001);
    const reducedDuration = value => value.split(',').every(item => item.trim() === '0.001s');
    const passed = (
      report.behaviorHarness.unexpectedFailures.length === 0
      && report.tabs.sameShadow && report.tabs.value === 'assets'
      && JSON.stringify(report.tabs.selected) === JSON.stringify(['false', 'true', 'false'])
      && standardDuration(report.tabs.duration)
      && report.segmented.sameShadow && report.segmented.value === 'list'
      && JSON.stringify(report.segmented.checked) === JSON.stringify(['false', 'true', 'false'])
      && standardDuration(report.segmented.duration)
      && report.disclosure.sameItems && report.disclosure.expanded === 'false'
      && report.disclosure.closingHeight > 0 && report.disclosure.closingHeight < report.disclosure.openHeight
      && report.disclosure.closingOpacity > 0 && report.disclosure.closingOpacity < 1
      && report.disclosure.closedHeight === 0 && report.disclosure.closedOpacity === '0'
      && standardDuration(report.disclosure.duration)
      && report.steps.sameTrack
      && JSON.stringify(report.steps.states) === JSON.stringify(['complete', 'complete', 'current'])
      && JSON.stringify(report.steps.current) === JSON.stringify([null, null, 'step'])
      && standardDuration(report.steps.duration)
      && Object.values(report.reduced).every(reducedDuration)
    );
    if (!passed) throw new Error(`Navigation motion contract failed: ${JSON.stringify(report)}`);
    console.log(JSON.stringify({ passed, report }, null, 2));
  } finally {
    cdp?.socket.close();
    browser.kill('SIGTERM');
    server.close();
    if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
    fs.rmSync(profile, { recursive:true, force:true, maxRetries:3, retryDelay:100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
