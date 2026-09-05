import './core.js?v=ic-ui-0e81b6afe7d8';

const TARGET_FRAME_MS = 1000 / 24;
const DPR_LIMIT = 1.5;
const MIN_DOT_RADIUS = 2;
const defaults = Object.freeze({
  playing: true,
  count: 2,
  speed: 2.3,
  density: 36,
  dot: 18,
  scale: 0.5,
  contrast: 1.2,
});

const limits = Object.freeze({
  speed: [0.25, 4],
  density: [16, 52],
  dot: [18, 56],
  scale: [0.5, 2.5],
  contrast: [0.5, 2],
});
const allowedCounts = new Set([1, 2, 6, 18]);
const params = new URLSearchParams(location.search);
const settings = { ...defaults };

function clampedNumber(name) {
  if (!params.has(name)) return defaults[name];
  const value = Number(params.get(name));
  if (!Number.isFinite(value)) return defaults[name];
  const [minimum, maximum] = limits[name];
  return Math.min(maximum, Math.max(minimum, value));
}

for (const name of Object.keys(limits)) settings[name] = clampedNumber(name);
settings.count = allowedCounts.has(Number(params.get('count'))) ? Number(params.get('count')) : defaults.count;
settings.playing = params.get('playing') !== 'false';

const root = document.documentElement;
const form = document.querySelector('[data-parameter-form]');
const stage = document.querySelector('[data-halftone-stage]');
const output = document.querySelector('[data-parameter-output] code');
const visibleCount = document.querySelector('[data-visible-count]');
const motionStatus = document.querySelector('[data-motion-status]');
const resetButton = document.querySelector('[data-reset-settings]');
const copyButton = document.querySelector('[data-copy-settings]');
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const instances = new Set();
const intersections = new WeakMap();
let intersectionObserver;
let animationFrame = 0;
let lastFrameTime = 0;
let animationTime = 0;

function smoothstep(edge0, edge1, value) {
  const position = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return position * position * (3 - (2 * position));
}

function fieldValue(x, y, time, seed) {
  const scale = settings.scale;
  const first = Math.sin((x * 8.2 * scale) + (time * 0.56) + seed);
  const second = Math.sin(((x * 0.72 + y) * 11.4 * scale) - (time * 0.42) + (seed * 1.7));
  const centerX = 0.5 + Math.sin((time * 0.21) + seed) * 0.22;
  const centerY = 0.5 + Math.cos((time * 0.17) + (seed * 1.3)) * 0.2;
  const distance = Math.hypot(x - centerX, y - centerY);
  const ripple = Math.sin((distance * 15 * scale) - (time * 0.7) + seed);
  const combined = ((first * 0.4) + (second * 0.35) + (ripple * 0.25)) * settings.contrast;
  return Math.max(0, Math.min(1, 0.5 + (combined * 0.5)));
}

function motionAllowed(instance) {
  return settings.playing
    && !document.hidden
    && intersections.get(instance.node) !== false
    && root.dataset.uiMotion !== 'reduced'
    && !reducedMotion?.matches;
}

class HalftoneInstance {
  constructor(node, index) {
    this.node = node;
    this.canvas = node.querySelector('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.seed = 0.93 + (index * 1.73);
    this.width = 0;
    this.height = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    instances.add(this);
    this.resizeObserver.observe(node);
    intersectionObserver?.observe(node);
    this.resize();
  }

  resize() {
    const bounds = this.node.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const dpr = Math.min(DPR_LIMIT, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.width = width;
    this.height = height;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(animationTime);
  }

  draw(time) {
    if (!this.width || !this.height) return;
    const background = getComputedStyle(this.node).backgroundColor;
    const dotColor = getComputedStyle(this.canvas).color;
    const spacing = Math.max(6, this.width / settings.density);
    const maximumRadius = Math.max(MIN_DOT_RADIUS, spacing * (settings.dot / 100));
    const columns = Math.ceil(this.width / spacing) + 1;
    const rows = Math.ceil(this.height / spacing) + 1;
    this.context.fillStyle = background;
    this.context.fillRect(0, 0, this.width, this.height);
    this.context.fillStyle = dotColor;
    this.canvas.dataset.halftoneBackground = background;
    this.canvas.dataset.halftoneDot = dotColor;
    this.context.beginPath();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const px = column * spacing;
        const py = row * spacing;
        const x = px / this.width;
        const y = py / this.height;
        const value = fieldValue(x, y, time, this.seed);
        const radius = maximumRadius * smoothstep(0.16, 0.84, value);
        if (radius < 0.08) continue;
        this.context.moveTo(px + radius, py);
        this.context.arc(px, py, radius, 0, Math.PI * 2);
      }
    }
    this.context.fill();
  }

  destroy() {
    this.resizeObserver.disconnect();
    intersectionObserver?.unobserve(this.node);
    instances.delete(this);
  }
}

function pendingNodeMarkup(index) {
  return `<article class="pending-halftone-node" data-motion-state="running" role="status" aria-live="polite" aria-busy="true" aria-label="正在生成图片 ${index + 1}">
    <canvas class="pending-halftone-canvas" aria-hidden="true"></canvas>
    <span class="pending-sheen" aria-hidden="true"></span>
  </article>`;
}

function drawAll() {
  for (const instance of instances) instance.draw(animationTime);
}

function anyInstanceRunning() {
  return [...instances].some(instance => motionAllowed(instance));
}

function frame(timestamp) {
  animationFrame = 0;
  if (!anyInstanceRunning()) return;
  if (!lastFrameTime) lastFrameTime = timestamp;
  const elapsed = Math.min(80, timestamp - lastFrameTime);
  if (elapsed >= TARGET_FRAME_MS) {
    animationTime += (elapsed / 1000) * settings.speed;
    lastFrameTime = timestamp;
    for (const instance of instances) {
      if (motionAllowed(instance)) instance.draw(animationTime);
    }
  }
  animationFrame = requestAnimationFrame(frame);
}

function syncMotionState() {
  for (const instance of instances) {
    instance.node.dataset.motionState = motionAllowed(instance) ? 'running' : 'paused';
  }
  const running = anyInstanceRunning();
  motionStatus.textContent = running ? '播放中' : (settings.playing ? '静态帧' : '已暂停');
  if (running && !animationFrame) {
    lastFrameTime = 0;
    animationFrame = requestAnimationFrame(frame);
  } else if (!running && animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    drawAll();
  }
}

function renderNodes() {
  for (const instance of [...instances]) instance.destroy();
  stage.dataset.density = settings.count === 1 ? 'single' : (settings.count >= 18 ? 'stress' : (settings.count >= 6 ? 'dense' : 'standard'));
  stage.innerHTML = Array.from({ length: settings.count }, (_, index) => pendingNodeMarkup(index)).join('');
  visibleCount.textContent = `${settings.count} 个实例`;
  stage.querySelectorAll('.pending-halftone-node').forEach((node, index) => new HalftoneInstance(node, index));
  syncMotionState();
}

function parameterText() {
  return [
    `speed:${settings.speed}x`,
    `density:${settings.density}`,
    `dot:${settings.dot}%`,
    `scale:${settings.scale}x`,
    `contrast:${settings.contrast}`,
    'background:var(--ui-color-surface)',
    'dot:var(--ui-color-text-disabled)',
  ].join('; ');
}

function syncUrl() {
  const url = new URL(location.href);
  for (const [name, value] of Object.entries(settings)) {
    if (value === defaults[name]) url.searchParams.delete(name);
    else url.searchParams.set(name, String(value));
  }
  history.replaceState(null, '', url);
}

function applySettings({ rerender = false } = {}) {
  if (rerender) renderNodes();
  else {
    drawAll();
    syncMotionState();
  }
  output.textContent = parameterText();
  syncUrl();
}

function controlFor(name) {
  return form.querySelector(`[data-setting="${name}"]`);
}

function sliderValueText(name, value) {
  if (name === 'dot') return `${value}%`;
  if (name === 'speed' || name === 'scale' || name === 'contrast') return `${value}×`;
  return String(value);
}

function syncControls() {
  for (const [name, value] of Object.entries(settings)) {
    const control = controlFor(name);
    if (!control) continue;
    if (name === 'playing') {
      control.checked = Boolean(value);
      control.toggleAttribute('checked', Boolean(value));
      continue;
    }
    control.value = String(value);
    control.setAttribute('value', String(value));
    if (control.localName === 'ic-slider') control.setAttribute('value-text', sliderValueText(name, value));
  }
}

function readControl(control) {
  const name = control.dataset.setting;
  if (!name) return false;
  if (name === 'playing') {
    settings.playing = Boolean(control.checked);
    return false;
  }
  const value = Number(control.value);
  if (!Number.isFinite(value)) return false;
  const previous = settings[name];
  settings[name] = name === 'count' && !allowedCounts.has(value) ? defaults.count : value;
  if (control.localName === 'ic-slider') control.setAttribute('value-text', sliderValueText(name, settings[name]));
  return name === 'count' && previous !== settings[name];
}

form.addEventListener('input', event => {
  const control = event.target.closest?.('[data-setting]');
  if (!control) return;
  applySettings({ rerender: readControl(control) });
});
form.addEventListener('change', event => {
  const control = event.target.closest?.('[data-setting]');
  if (!control) return;
  applySettings({ rerender: readControl(control) });
});
resetButton.addEventListener('click', () => {
  Object.assign(settings, defaults);
  syncControls();
  applySettings({ rerender: true });
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(parameterText());
    copyButton.textContent = '已复制';
    window.setTimeout(() => { copyButton.textContent = '复制参数'; }, 1200);
  } catch (_) {
    output.focus?.();
  }
});

intersectionObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) intersections.set(entry.target, entry.isIntersecting);
  syncMotionState();
}, { rootMargin: '80px' }) : null;

document.addEventListener('visibilitychange', syncMotionState);
reducedMotion?.addEventListener?.('change', syncMotionState);
new MutationObserver(() => {
  drawAll();
  syncMotionState();
}).observe(root, { attributes: true, attributeFilter: ['data-ui-theme', 'data-ui-motion'] });

await Promise.all(['ic-button', 'ic-switch', 'ic-select', 'ic-slider'].map(tag => customElements.whenDefined(tag)));
syncControls();
renderNodes();
applySettings();
requestAnimationFrame(() => requestAnimationFrame(() => { root.dataset.pendingHalftoneReferenceStatus = 'ready'; }));
