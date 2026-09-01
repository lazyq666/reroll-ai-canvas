const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME_TYPES = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
const CANDIDATES = ['a', 'b', 'current'];
const LABELS = { a:'实验 A · CSS 三色团', b:'实验 B · Canvas 2D Halftone', current:'现有 ic-generation-pending-video' };
const DIAGNOSTIC_SCENARIOS = Object.freeze({
  a:{ candidate:'a', label:LABELS.a },
  'a-gradient':{ candidate:'a', profile:'a-gradient', label:'实验 A · 径向渐变羽化' },
  'a-no-backdrop':{ candidate:'a', profile:'a-no-backdrop', label:'实验 A · 无 backdrop-filter' },
  'a-gradient-no-backdrop':{ candidate:'a', profile:'a-gradient-no-backdrop', label:'实验 A · 渐变羽化 + 无 backdrop-filter' },
  b:{ candidate:'b', label:LABELS.b },
  'b-18':{ candidate:'b', bFps:18, label:'实验 B · 18 FPS target' },
  'b-15':{ candidate:'b', bFps:15, label:'实验 B · 15 FPS target' },
  current:{ candidate:'current', label:LABELS.current },
});
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function numberArgument(name, fallback, minimum, maximum) {
  const prefix = `--${name}=`;
  const raw = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function stringArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || '';
}

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end('Forbidden');
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      response.writeHead(200, { 'Content-Type':MIME_TYPES[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control':'public, max-age=3600' }).end(body);
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
    const timer = setTimeout(() => reject(new Error(stderr || 'Chrome debugger timeout')), 15000);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
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
  const listeners = new Set();
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (operation) {
      pending.delete(payload.id);
      payload.error ? operation.reject(new Error(JSON.stringify(payload.error))) : operation.resolve(payload.result);
      return;
    }
    for (const listener of listeners) listener(payload);
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitFor(cdp, sessionId, expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function metricsMap(response) {
  return Object.fromEntries((response.metrics || []).map(metric => [metric.name, metric.value]));
}

function metricDelta(before, after, name) {
  return (after[name] || 0) - (before[name] || 0);
}

function processCpuDelta(before, after, wallSeconds) {
  const previous = new Map(before.processInfo.map(process => [process.id, process]));
  const byType = {};
  for (const process of after.processInfo) {
    const earlier = previous.get(process.id);
    const delta = Math.max(0, Number(process.cpuTime || 0) - Number(earlier?.cpuTime || 0));
    const type = String(process.type || 'other').toLowerCase();
    byType[type] = (byType[type] || 0) + ((delta / wallSeconds) * 100);
  }
  byType.total = Object.values(byType).reduce((sum, value) => sum + value, 0);
  return byType;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function summarize(runs) {
  const fields = [
    'fps', 'frameIntervalP95Ms', 'frameIntervalP99Ms', 'longFrameRate', 'longTaskCount',
    'longTaskTotalMs', 'eventLoopLagP95Ms', 'animationUpdateFps', 'canvasDrawWorkMs',
    'mainThreadTaskPercent', 'scriptPercent', 'layoutPercent', 'stylePercent', 'rendererCpuPercent',
    'gpuCpuPercent', 'browserCpuPercent', 'totalChromeCpuPercent', 'jsHeapEndMb', 'domNodes',
  ];
  return Object.fromEntries(fields.map(field => {
    const values = runs.map(run => Number(run[field] || 0));
    return [field, { mean:mean(values), stddev:standardDeviation(values), min:Math.min(...values), max:Math.max(...values) }];
  }));
}

function printableSummary(candidate, summary, label = LABELS[candidate]) {
  const value = field => summary[field].mean;
  return {
    candidate,
    label,
    fps:Number(value('fps').toFixed(2)),
    p95FrameMs:Number(value('frameIntervalP95Ms').toFixed(2)),
    longFramePercent:Number((value('longFrameRate') * 100).toFixed(3)),
    mainThreadTaskPercent:Number(value('mainThreadTaskPercent').toFixed(2)),
    rendererCpuPercent:Number(value('rendererCpuPercent').toFixed(2)),
    gpuCpuPercent:Number(value('gpuCpuPercent').toFixed(2)),
    totalChromeCpuPercent:Number(value('totalChromeCpuPercent').toFixed(2)),
    longTaskCount:Number(value('longTaskCount').toFixed(2)),
    jsHeapMb:Number(value('jsHeapEndMb').toFixed(2)),
    canvasAnimationFps:candidate === 'b' ? Number(value('animationUpdateFps').toFixed(2)) : null,
  };
}

async function main() {
  const durationMs = numberArgument('duration', 8000, 1000, 30000);
  const warmupMs = numberArgument('warmup', 2000, 0, 10000);
  const repeats = numberArgument('repeats', 3, 1, 10);
  const outputPath = stringArgument('output');
  const quiet = process.argv.includes('--quiet');
  const requestedScenarios = stringArgument('scenarios');
  const scenarioIds = requestedScenarios
    ? requestedScenarios.split(',').map(value => value.trim()).filter(Boolean)
    : CANDIDATES;
  for (const scenarioId of scenarioIds) {
    if (!DIAGNOSTIC_SCENARIOS[scenarioId]) throw new Error(`Unknown scenario: ${scenarioId}`);
  }
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-pending-benchmark-'));
  const browser = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--remote-allow-origins=*', '--remote-debugging-port=0',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-features=BackForwardCache',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio:['ignore', 'ignore', 'pipe'] });
  let cdp;
  try {
    cdp = await connect(await debuggerUrl(browser));
    const systemInfo = await cdp.send('SystemInfo.getInfo');
    const version = await cdp.send('Browser.getVersion');
    const target = await cdp.send('Target.createTarget', { url:'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId:target.targetId, flatten:true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Performance.enable', {}, sessionId);
    await cdp.send('HeapProfiler.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false }, sessionId);
    const pageErrors = [];
    const unsubscribe = cdp.onEvent(event => {
      if (event.sessionId === sessionId && event.method === 'Runtime.exceptionThrown') pageErrors.push(event.params.exceptionDetails?.text || 'Runtime exception');
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    // Warm every code/resource path once so candidate order does not measure network or first decode.
    const scenarioUrl = scenarioId => {
      const scenario = DIAGNOSTIC_SCENARIOS[scenarioId];
      const query = new URLSearchParams({ candidate:scenario.candidate });
      if (scenario.profile) query.set('profile', scenario.profile);
      if (scenario.bFps) query.set('bFps', String(scenario.bFps));
      return `${origin}/static/design-system/infinite-canvas-ui/generation-pending-performance-prototype.html?${query}`;
    };
    for (const scenarioId of scenarioIds) {
      await cdp.send('Page.navigate', { url:scenarioUrl(scenarioId) }, sessionId);
      await waitFor(cdp, sessionId, "document.documentElement.dataset.pendingPerformanceStatus === 'ready'", `${scenarioId} warmup page`);
      await delay(1000);
    }

    const runs = Object.fromEntries(scenarioIds.map(scenarioId => [scenarioId, []]));
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const offset = repeat % scenarioIds.length;
      const order = [...scenarioIds.slice(offset), ...scenarioIds.slice(0, offset)];
      for (const scenarioId of order) {
        const scenario = DIAGNOSTIC_SCENARIOS[scenarioId];
        process.stderr.write(`run ${repeat + 1}/${repeats} · ${scenario.label}\n`);
        await cdp.send('Page.navigate', { url:scenarioUrl(scenarioId) }, sessionId);
        await waitFor(cdp, sessionId, `document.documentElement.dataset.pendingPerformanceStatus === 'ready' && pendingAnimationBenchmark.activeCandidate === '${scenario.candidate}'`, `${scenarioId} benchmark page`);
        await delay(warmupMs);
        await cdp.send('HeapProfiler.collectGarbage', {}, sessionId);
        const beforeMetrics = metricsMap(await cdp.send('Performance.getMetrics', {}, sessionId));
        const beforeProcesses = await cdp.send('SystemInfo.getProcessInfo');
        const pageResult = await evaluate(cdp, sessionId, `pendingAnimationBenchmark.sample({ durationMs:${durationMs}, warmupMs:0 })`);
        const afterProcesses = await cdp.send('SystemInfo.getProcessInfo');
        const afterMetrics = metricsMap(await cdp.send('Performance.getMetrics', {}, sessionId));
        await cdp.send('HeapProfiler.collectGarbage', {}, sessionId);
        const memoryMetrics = metricsMap(await cdp.send('Performance.getMetrics', {}, sessionId));
        const domCounters = await cdp.send('Memory.getDOMCounters', {}, sessionId);
        const wallSeconds = pageResult.durationMs / 1000;
        const cpu = processCpuDelta(beforeProcesses, afterProcesses, wallSeconds);
        runs[scenarioId].push({
          ...pageResult,
          scenario:scenarioId,
          mainThreadTaskPercent:(metricDelta(beforeMetrics, afterMetrics, 'TaskDuration') / wallSeconds) * 100,
          scriptPercent:(metricDelta(beforeMetrics, afterMetrics, 'ScriptDuration') / wallSeconds) * 100,
          layoutPercent:(metricDelta(beforeMetrics, afterMetrics, 'LayoutDuration') / wallSeconds) * 100,
          stylePercent:(metricDelta(beforeMetrics, afterMetrics, 'RecalcStyleDuration') / wallSeconds) * 100,
          rendererCpuPercent:cpu.renderer || 0,
          gpuCpuPercent:cpu.gpu || 0,
          browserCpuPercent:cpu.browser || 0,
          totalChromeCpuPercent:cpu.total || 0,
          cpuByProcessType:cpu,
          jsHeapEndMb:(memoryMetrics.JSHeapUsedSize || pageResult.jsHeapEndBytes || 0) / 1048576,
          domNodes:domCounters.nodes || pageResult.domNodes,
        });
      }
    }
    unsubscribe();
    if (pageErrors.length) throw new Error(`Browser errors: ${JSON.stringify(pageErrors)}`);
    const summaries = Object.fromEntries(scenarioIds.map(scenarioId => [scenarioId, summarize(runs[scenarioId])]));
    const report = {
      schemaVersion:1,
      generatedAt:new Date().toISOString(),
      methodology:{ instancesPerCandidate:10, viewport:{ width:1440, height:1000, deviceScaleFactor:1 }, durationMs, warmupMs, repeats, isolatedCandidates:true, headless:true },
      environment:{
        browser:version.product,
        userAgent:version.userAgent,
        protocolVersion:version.protocolVersion,
        os:os.version(),
        architecture:os.arch(),
        logicalCpuCount:os.cpus().length,
        memoryGb:Number((os.totalmem() / 1073741824).toFixed(2)),
        gpuDevice:systemInfo.gpu?.devices?.[0]?.deviceString || '',
        gpuVendor:systemInfo.gpu?.devices?.[0]?.vendorString || '',
        gpuRenderer:systemInfo.gpu?.auxAttributes?.glRenderer || '',
      },
      summary:scenarioIds.map(scenarioId => printableSummary(
        DIAGNOSTIC_SCENARIOS[scenarioId].candidate,
        summaries[scenarioId],
        DIAGNOSTIC_SCENARIOS[scenarioId].label,
      )),
      statistics:summaries,
      runs,
    };
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive:true });
      fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write(`wrote ${resolved}\n`);
    }
    if (!quiet) console.log(JSON.stringify(report, null, 2));
  } finally {
    cdp?.close();
    browser.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
