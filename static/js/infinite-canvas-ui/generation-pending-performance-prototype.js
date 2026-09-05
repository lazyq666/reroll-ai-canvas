import './core.js?v=ic-ui-a7dd55e61123';

// Throwaway benchmark answering: which Pending animation is cheapest with 10 visible instances?
const INSTANCE_COUNT = 10;
const TARGET_FRAME_MS = 1000 / 24;
const DPR_LIMIT = 1.5;
const candidateMeta = Object.freeze({
  a: { title: '实验 A · CSS 三色团', detail: '3 个模糊合成层 + spinner / 实例' },
  b: { title: '实验 B · Canvas 2D Halftone', detail: '共享 24 FPS scheduler，DPR 上限 1.5' },
  current: { title: '现有 ic-generation-pending-video', detail: '动画 WebP + CSS mask / 实例' },
});

const stage = document.querySelector('[data-benchmark-stage]');
const runButton = document.querySelector('[data-run-benchmark]');
const runStatus = document.querySelector('[data-run-status]');
const resultPanel = document.querySelector('[data-result-panel]');
const resultBody = document.querySelector('[data-result-body]');
const params = new URLSearchParams(location.search);
const diagnosticProfile = params.get('profile') || 'baseline';
const requestedHalftoneFps = Number(params.get('bFps'));
const halftoneTargetFps = params.has('bFps') && Number.isFinite(requestedHalftoneFps)
  ? Math.max(15, Math.min(24, requestedHalftoneFps))
  : (1000 / TARGET_FRAME_MS);
let activeCandidate = ['a', 'b', 'current', 'all'].includes(params.get('candidate')) ? params.get('candidate') : 'a';
let halftoneController = null;
let animationUpdateCount = 0;

function applyDiagnosticProfile() {
  if (!diagnosticProfile.startsWith('a-')) return;
  const style = document.createElement('style');
  const rules = [];
  if (diagnosticProfile.includes('gradient')) {
    rules.push(`
      .candidate-grid[data-candidate="a"] .motion-blob { filter:none; }
      .candidate-grid[data-candidate="a"] .blob-one { background:radial-gradient(circle, var(--blob-one-color) 0 28%, color-mix(in srgb, var(--blob-one-color) 72%, transparent) 48%, transparent 76%); }
      .candidate-grid[data-candidate="a"] .blob-two { background:radial-gradient(circle, var(--blob-two-color) 0 28%, color-mix(in srgb, var(--blob-two-color) 72%, transparent) 48%, transparent 76%); }
      .candidate-grid[data-candidate="a"] .blob-three { background:radial-gradient(circle, var(--blob-three-color) 0 28%, color-mix(in srgb, var(--blob-three-color) 72%, transparent) 48%, transparent 76%); }
    `);
  }
  if (diagnosticProfile.includes('no-backdrop')) {
    rules.push('.candidate-grid[data-candidate="a"] .pending-spinner { backdrop-filter:none; background:color-mix(in srgb, var(--ui-color-text-primary) 24%, transparent); }');
  }
  style.dataset.pendingDiagnosticProfile = diagnosticProfile;
  style.textContent = rules.join('\n');
  document.head.append(style);
}

applyDiagnosticProfile();

function aMarkup(index) {
  return `<article class="pending-tile" role="status" aria-busy="true" aria-label="实验 A 正在生成 ${index + 1}">
    <span class="motion-blob blob-one" aria-hidden="true"></span>
    <span class="motion-blob blob-two" aria-hidden="true"></span>
    <span class="motion-blob blob-three" aria-hidden="true"></span>
    <span class="pending-sheen" aria-hidden="true"></span>
    <span class="pending-content" aria-hidden="true"><span class="pending-spinner"></span></span>
    <span class="pending-label">正在生成视频 · ${index + 1}</span>
  </article>`;
}

function bMarkup(index) {
  return `<article class="pending-tile" role="status" aria-busy="true" aria-label="实验 B 正在生成 ${index + 1}">
    <canvas class="pending-halftone-canvas" aria-hidden="true"></canvas>
    <span class="pending-sheen" aria-hidden="true"></span>
  </article>`;
}

function currentMarkup(index) {
  return `<div class="pending-tile"><ic-generation-pending kind="video" state="queued" count="1" label="视频 ${index + 1} 等待生成"></ic-generation-pending></div>`;
}

function smoothstep(edge0, edge1, value) {
  const position = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return position * position * (3 - (2 * position));
}

function fieldValue(x, y, time, seed) {
  const scale = 0.5;
  const first = Math.sin((x * 8.2 * scale) + (time * 0.56) + seed);
  const second = Math.sin(((x * 0.72 + y) * 11.4 * scale) - (time * 0.42) + (seed * 1.7));
  const centerX = 0.5 + Math.sin((time * 0.21) + seed) * 0.22;
  const centerY = 0.5 + Math.cos((time * 0.17) + (seed * 1.3)) * 0.2;
  const distance = Math.hypot(x - centerX, y - centerY);
  const ripple = Math.sin((distance * 15 * scale) - (time * 0.7) + seed);
  const combined = ((first * 0.4) + (second * 0.35) + (ripple * 0.25)) * 1.4;
  return Math.max(0, Math.min(1, 0.5 + (combined * 0.5)));
}

class HalftoneController {
  constructor(root) {
    this.instances = [...root.querySelectorAll('.pending-tile')].map((node, index) => {
      const canvas = node.querySelector('canvas');
      return { node, canvas, context:canvas.getContext('2d', { alpha:false }), seed:0.93 + (index * 1.73), width:0, height:0 };
    });
    this.frameRequest = 0;
    this.lastFrameTime = 0;
    this.animationTime = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(root);
    this.resize();
    this.frameRequest = requestAnimationFrame(timestamp => this.frame(timestamp));
  }

  resize() {
    const dpr = Math.min(DPR_LIMIT, window.devicePixelRatio || 1);
    for (const instance of this.instances) {
      const bounds = instance.node.getBoundingClientRect();
      instance.width = Math.max(1, bounds.width);
      instance.height = Math.max(1, bounds.height);
      const width = Math.max(1, Math.round(instance.width * dpr));
      const height = Math.max(1, Math.round(instance.height * dpr));
      if (instance.canvas.width !== width) instance.canvas.width = width;
      if (instance.canvas.height !== height) instance.canvas.height = height;
      instance.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(instance, this.animationTime);
    }
  }

  draw(instance, time) {
    const { context, width, height, seed } = instance;
    const spacing = Math.max(6, width / 24);
    const maximumRadius = spacing * 0.44;
    const columns = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    const dark = document.documentElement.dataset.uiTheme === 'dark';
    context.fillStyle = dark ? '#151515' : '#f2f0e9';
    context.fillRect(0, 0, width, height);
    context.fillStyle = dark ? '#eeeeea' : '#1c1c1b';
    context.beginPath();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const px = column * spacing;
        const py = row * spacing;
        const value = fieldValue(px / width, py / height, time, seed);
        const radius = maximumRadius * smoothstep(0.16, 0.84, value);
        if (radius < 0.08) continue;
        context.moveTo(px + radius, py);
        context.arc(px, py, radius, 0, Math.PI * 2);
      }
    }
    context.fill();
  }

  frame(timestamp) {
    if (!this.lastFrameTime) this.lastFrameTime = timestamp;
    const elapsed = Math.min(80, timestamp - this.lastFrameTime);
    if (elapsed >= (1000 / halftoneTargetFps)) {
      this.animationTime += (elapsed / 1000) * 2;
      this.lastFrameTime = timestamp;
      const started = performance.now();
      for (const instance of this.instances) this.draw(instance, this.animationTime);
      window.__pendingBenchmarkDrawWorkMs = (window.__pendingBenchmarkDrawWorkMs || 0) + (performance.now() - started);
      animationUpdateCount += 1;
    }
    this.frameRequest = requestAnimationFrame(next => this.frame(next));
  }

  destroy() {
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.instances.length = 0;
  }
}

function sectionMarkup(candidate) {
  const renderer = candidate === 'a' ? aMarkup : (candidate === 'b' ? bMarkup : currentMarkup);
  const items = Array.from({ length:INSTANCE_COUNT }, (_, index) => renderer(index)).join('');
  const meta = candidateMeta[candidate];
  return `<section class="candidate-section" data-candidate-section="${candidate}">
    <header class="candidate-heading"><div class="candidate-heading-copy"><h2>${meta.title}</h2><p>${meta.detail}</p></div><span class="candidate-count">10 个同时运行</span></header>
    <div class="candidate-grid" data-candidate="${candidate}">${items}</div>
  </section>`;
}

async function waitForCurrentImages() {
  const images = [...stage.querySelectorAll('ic-generation-pending')]
    .map(element => element.shadowRoot?.querySelector('img.generation-pending-loader'))
    .filter(Boolean);
  await Promise.all(images.map(image => image.decode?.().catch(() => undefined)));
}

async function render(candidate) {
  halftoneController?.destroy();
  halftoneController = null;
  animationUpdateCount = 0;
  window.__pendingBenchmarkDrawWorkMs = 0;
  activeCandidate = candidate;
  stage.classList.toggle('all-mode', candidate === 'all');
  const candidates = candidate === 'all' ? ['a', 'b', 'current'] : [candidate];
  stage.innerHTML = candidates.map(sectionMarkup).join('');
  const halftoneGrid = stage.querySelector('[data-candidate="b"]');
  if (halftoneGrid) halftoneController = new HalftoneController(halftoneGrid);
  await customElements.whenDefined('ic-generation-pending');
  await waitForCurrentImages();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const button of document.querySelectorAll('[data-candidate-select]')) {
    button.setAttribute('aria-pressed', String(button.dataset.candidateSelect === candidate));
  }
  runStatus.textContent = candidate === 'all' ? '30 个实例 · 仅供压力观察' : '10 个实例 · 等待测试';
  const url = new URL(location.href);
  url.searchParams.set('candidate', candidate);
  history.replaceState(null, '', url);
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sample({ durationMs = 5000, warmupMs = 1000 } = {}) {
  if (activeCandidate === 'all') throw new Error('自动采样必须使用单一候选动画');
  await delay(warmupMs);
  const frameIntervals = [];
  const eventLoopLags = [];
  const longTasks = [];
  let previousFrame = 0;
  let stopped = false;
  const startUpdates = animationUpdateCount;
  window.__pendingBenchmarkDrawWorkMs = 0;
  const longTaskObserver = 'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
    : null;
  longTaskObserver?.observe({ type:'longtask', buffered:false });
  function frame(timestamp) {
    if (previousFrame) frameIntervals.push(timestamp - previousFrame);
    previousFrame = timestamp;
    if (!stopped) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const timerStart = performance.now();
  let expectedTimer = timerStart + 50;
  const timer = setInterval(() => {
    const now = performance.now();
    eventLoopLags.push(Math.max(0, now - expectedTimer));
    expectedTimer = now + 50;
  }, 50);
  const heapStart = performance.memory?.usedJSHeapSize || 0;
  await delay(durationMs);
  stopped = true;
  clearInterval(timer);
  longTaskObserver?.disconnect();
  const elapsedMs = performance.now() - timerStart;
  const sorted = [...frameIntervals].sort((left, right) => left - right);
  const refreshInterval = sorted.length ? percentile(sorted, 0.5) : 1000 / 60;
  const longFrameThreshold = Math.max(25, refreshInterval * 1.5);
  const longFrames = frameIntervals.filter(value => value > longFrameThreshold).length;
  return {
    candidate:activeCandidate,
    instances:INSTANCE_COUNT,
    durationMs:elapsedMs,
    deliveredFrames:frameIntervals.length,
    fps:frameIntervals.length / (elapsedMs / 1000),
    frameIntervalAvgMs:frameIntervals.reduce((sum, value) => sum + value, 0) / Math.max(1, frameIntervals.length),
    frameIntervalP95Ms:percentile(sorted, 0.95),
    frameIntervalP99Ms:percentile(sorted, 0.99),
    longFrames,
    longFrameRate:longFrames / Math.max(1, frameIntervals.length),
    longTaskCount:longTasks.length,
    longTaskTotalMs:longTasks.reduce((sum, value) => sum + value, 0),
    eventLoopLagP95Ms:percentile([...eventLoopLags].sort((a, b) => a - b), 0.95),
    animationUpdates:animationUpdateCount - startUpdates,
    animationUpdateFps:(animationUpdateCount - startUpdates) / (elapsedMs / 1000),
    requestedAnimationFps:activeCandidate === 'b' ? halftoneTargetFps : null,
    diagnosticProfile,
    canvasDrawWorkMs:window.__pendingBenchmarkDrawWorkMs || 0,
    jsHeapStartBytes:heapStart,
    jsHeapEndBytes:performance.memory?.usedJSHeapSize || 0,
    domNodes:document.getElementsByTagName('*').length,
  };
}

function resultRow(result) {
  const heap = result.jsHeapEndBytes ? `${(result.jsHeapEndBytes / 1048576).toFixed(1)} MB` : '不可用';
  const updateFps = result.candidate === 'b' ? result.animationUpdateFps.toFixed(1) : '合成/媒体';
  return `<tr><td>${candidateMeta[result.candidate].title}</td><td>${result.fps.toFixed(1)}</td><td>${result.frameIntervalP95Ms.toFixed(1)} ms</td><td>${(result.longFrameRate * 100).toFixed(2)}%</td><td>${result.longTaskCount} / ${result.longTaskTotalMs.toFixed(0)} ms</td><td>${updateFps}</td><td>${heap}</td></tr>`;
}

async function runInteractiveBenchmark() {
  runButton.disabled = true;
  resultPanel.hidden = false;
  resultBody.innerHTML = '';
  const results = [];
  try {
    for (const candidate of ['a', 'b', 'current']) {
      runStatus.textContent = `正在测试 ${candidateMeta[candidate].title}…`;
      await render(candidate);
      const result = await sample();
      results.push(result);
      resultBody.insertAdjacentHTML('beforeend', resultRow(result));
    }
    window.__pendingBenchmarkResults = results;
    runStatus.textContent = '三组测试完成';
  } finally {
    runButton.disabled = false;
  }
}

for (const button of document.querySelectorAll('[data-candidate-select]')) {
  button.addEventListener('click', () => render(button.dataset.candidateSelect));
}
runButton.addEventListener('click', runInteractiveBenchmark);

window.pendingAnimationBenchmark = Object.freeze({
  candidates:['a', 'b', 'current'],
  instanceCount:INSTANCE_COUNT,
  render,
  sample,
  get activeCandidate() { return activeCandidate; },
});

await render(activeCandidate);
document.documentElement.dataset.pendingPerformanceStatus = 'ready';

if (params.get('autorun') === 'true' && activeCandidate !== 'all') {
  const durationMs = Math.max(1000, Math.min(30000, Number(params.get('duration')) || 8000));
  const warmupMs = Math.max(0, Math.min(10000, Number(params.get('warmup')) || 2000));
  window.__pendingBenchmarkResult = await sample({ durationMs, warmupMs });
  document.documentElement.dataset.pendingPerformanceStatus = 'complete';
}
