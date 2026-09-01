// THROWAWAY UI PROTOTYPE: three Canvas 2D halftone directions, switchable with ?variant=.
const variants = {
  A: {
    name: '有机墨浪（推荐）',
    description: '黑白点阵由低成本亮度场驱动，强调计算中的流动感；这是当前推荐方向。',
  },
  B: {
    name: '品牌色呼吸',
    description: '降低对比度并使用青绿色，让多个节点同时出现时更安静，更接近应用背景而不是视觉主角。',
  },
  C: {
    name: '扫描显影',
    description: '让点阵沿扫描前沿逐渐退去、露出下方色彩，直接表达从等待状态过渡到生成结果。',
  },
};

const TARGET_FRAME_MS = 1000 / 24;
const DPR_LIMIT = 1.5;
const instances = new Set();
const params = new URLSearchParams(location.search);
const defaultSettings = { speed:2, density:24, dot:.44, scale:.5, contrast:1.4 };
const defaultColors = { lightBg:'#f2f0e9', lightDot:'#1c1c1b', darkBg:'#151515', darkDot:'#eeeeea' };
const colorKeys = Object.keys(defaultColors);
const settingLimits = {
  speed:[.25, 4],
  density:[16, 52],
  dot:[.18, .56],
  scale:[.5, 2.5],
  contrast:[.5, 2],
};
const settings = Object.fromEntries(Object.entries(defaultSettings).map(([key, fallback]) => {
  const value = params.has(key) ? Number(params.get(key)) : Number.NaN;
  const [minimum, maximum] = settingLimits[key];
  return [key, Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback];
}));
function validColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : fallback;
}
const colors = Object.fromEntries(colorKeys.map(key => [key, validColor(params.get(key), defaultColors[key])]));
let colorsCustomized = colorKeys.some(key => params.has(key));
const variantKeys = Object.keys(variants);
let currentVariant = variants[params.get('variant')?.toUpperCase()] ? params.get('variant').toUpperCase() : 'A';
let nodeCount = [2, 6, 18].includes(Number(params.get('count'))) ? Number(params.get('count')) : 2;
let manuallyPaused = params.get('motion') === 'paused';
let animationFrame = 0;
let lastFrameTime = 0;
let animationTime = 0;

const root = document.documentElement;
const canvasContent = document.querySelector('#canvas-content');
const variantTitle = document.querySelector('#variant-title');
const variantDescription = document.querySelector('#variant-description');
const variantState = document.querySelector('#variant-state');
const activeState = document.querySelector('#active-state');
const renderState = document.querySelector('#render-state');
const switcherLabel = document.querySelector('#switcher-label');
const themeToggle = document.querySelector('#theme-toggle');
const motionToggle = document.querySelector('#motion-toggle');
const countToggle = document.querySelector('#count-toggle');

root.dataset.uiTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
root.dataset.uiMotion = manuallyPaused ? 'reduced' : 'standard';

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function fieldValue(x, y, time, seed) {
  const first = Math.sin(x * 8.2 * settings.scale + time * .56 + seed);
  const second = Math.sin((x * .72 + y) * 11.4 * settings.scale - time * .42 + seed * 1.7);
  const centerX = .5 + Math.sin(time * .14 + seed) * .18;
  const centerY = .48 + Math.cos(time * .11 + seed * 1.3) * .2;
  const distance = Math.hypot(x - centerX, y - centerY);
  const ripple = Math.cos(distance * 14 * settings.scale - time * .64 + seed);
  const value = .5 + first * .19 + second * .14 + ripple * .2;
  return clamp(.5 + (value - .5) * settings.contrast);
}

function colorsFor(variant, dark) {
  if (colorsCustomized) return dark
    ? { background:colors.darkBg, dot:colors.darkDot, accent:colors.darkDot }
    : { background:colors.lightBg, dot:colors.lightDot, accent:colors.lightDot };
  if (variant === 'B') return dark
    ? { background:'#11211f', dot:'#79d7c5', accent:'#cbfff2' }
    : { background:'#dff3ed', dot:'#167567', accent:'#65cbb7' };
  if (variant === 'C') return dark
    ? { background:'#25201d', dot:'#efe6da', accent:'#bf8dff' }
    : { background:'#f4ecdf', dot:'#2a241f', accent:'#8758d6' };
  return dark
    ? { background:'#151515', dot:'#eeeeea', accent:'#ffffff' }
    : { background:'#f2f0e9', dot:'#1c1c1b', accent:'#ffffff' };
}

class HalftoneInstance {
  constructor(host, index) {
    this.host = host;
    this.canvas = host.querySelector('canvas');
    this.context = this.canvas.getContext('2d', { alpha:false });
    this.index = index;
    this.seed = .67 + index * 1.31;
    this.visible = true;
    this.width = 0;
    this.height = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    sharedIntersectionObserver.observe(host);
    this.resize();
    instances.add(this);
  }

  resize() {
    const bounds = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(animationTime);
  }

  draw(time) {
    if (!this.width || !this.height) return;
    const context = this.context;
    const variant = currentVariant;
    const dark = root.dataset.uiTheme === 'dark';
    const colors = colorsFor(variant, dark);
    const spacing = Math.max(6, this.width / settings.density);

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (variant === 'C') {
      const gradient = context.createLinearGradient(0, 0, this.width, this.height);
      gradient.addColorStop(0, colors.background);
      gradient.addColorStop(.5, dark ? '#6f4fa0' : '#d9bfff');
      gradient.addColorStop(1, dark ? '#27696a' : '#8edbd1');
      context.fillStyle = gradient;
    } else {
      context.fillStyle = colors.background;
    }
    context.fillRect(0, 0, this.width, this.height);
    context.fillStyle = colors.dot;
    context.beginPath();

    const scan = (time * .11 + this.seed * .08) % 1.35 - .18;
    for (let y = spacing / 2; y < this.height; y += spacing) {
      for (let x = spacing / 2; x < this.width; x += spacing) {
        const nx = x / this.width;
        const ny = y / this.height;
        let value = fieldValue(nx, ny, time, this.seed);
        if (variant === 'B') value = .28 + value * .55;
        if (variant === 'C') {
          const front = scan - (nx * .82 + ny * .18);
          const reveal = smoothstep(-.14, .1, front);
          value = value * (1 - reveal) + .035 * reveal;
        }
        const radius = spacing * settings.dot * smoothstep(.16, .84, value);
        if (radius < .18) continue;
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    context.fill();
  }

  destroy() {
    this.resizeObserver.disconnect();
    sharedIntersectionObserver.unobserve(this.host);
    instances.delete(this);
  }
}

const sharedIntersectionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const instance = [...instances].find(candidate => candidate.host === entry.target);
    if (!instance) continue;
    instance.visible = entry.isIntersecting;
    instance.host.dataset.motionState = entry.isIntersecting && !manuallyPaused ? 'running' : 'paused';
  }
  updateRuntimeState();
  ensureAnimationLoop();
}, { rootMargin:'80px' });

function shouldAnimate() {
  return !manuallyPaused && !document.hidden && [...instances].some(instance => instance.visible);
}

function tick(timestamp) {
  animationFrame = 0;
  if (!shouldAnimate()) return;
  if (!lastFrameTime) lastFrameTime = timestamp;
  if (timestamp - lastFrameTime >= TARGET_FRAME_MS) {
    animationTime += Math.min(timestamp - lastFrameTime, 100) / 1000 * settings.speed;
    for (const instance of instances) {
      if (instance.visible) instance.draw(animationTime);
    }
    lastFrameTime = timestamp;
  }
  animationFrame = requestAnimationFrame(tick);
}

function ensureAnimationLoop() {
  if (shouldAnimate() && !animationFrame) animationFrame = requestAnimationFrame(tick);
  if (!shouldAnimate() && animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
}

function syncUrl() {
  const next = new URL(location.href);
  next.searchParams.set('variant', currentVariant);
  next.searchParams.set('count', String(nodeCount));
  next.searchParams.set('theme', root.dataset.uiTheme);
  next.searchParams.set('motion', manuallyPaused ? 'paused' : 'standard');
  for (const [key, value] of Object.entries(settings)) next.searchParams.set(key, String(value));
  for (const key of colorKeys) {
    if (colorsCustomized) next.searchParams.set(key, colors[key]);
    else next.searchParams.delete(key);
  }
  history.replaceState(null, '', next);
}

function settingDisplay(key, value) {
  if (key === 'dot') return `${Math.round(value * 100)}%`;
  if (key === 'density') return String(Math.round(value));
  return `${value.toFixed(key === 'speed' ? 2 : 1).replace(/\.?0+$/, '')}×`;
}

function syncSettingControls() {
  document.querySelectorAll('[data-setting]').forEach(input => {
    const key = input.dataset.setting;
    input.value = String(settings[key]);
    document.querySelector(`#${key}-output`).textContent = settingDisplay(key, settings[key]);
  });
}

function syncColorControls() {
  const light = colorsFor(currentVariant, false);
  const dark = colorsFor(currentVariant, true);
  const shownColors = colorsCustomized
    ? colors
    : { lightBg:light.background, lightDot:light.dot, darkBg:dark.background, darkDot:dark.dot };
  document.querySelectorAll('[data-color-setting]').forEach(input => {
    const key = input.dataset.colorSetting;
    input.value = shownColors[key];
    document.querySelector(`#${input.id.replace('-input', '-output')}`).textContent = shownColors[key].toUpperCase();
  });
}

function redrawInstances() {
  for (const instance of instances) instance.draw(animationTime);
}

function updateRuntimeState() {
  const visibleCount = [...instances].filter(instance => instance.visible).length;
  activeState.textContent = `可见动画：${visibleCount}`;
  renderState.textContent = `渲染：${shouldAnimate() ? '运行中' : '已暂停'}`;
  motionToggle.textContent = manuallyPaused ? '恢复动态' : '暂停动态';
  document.querySelectorAll('.pending-node').forEach(node => {
    node.dataset.motionState = shouldAnimate() ? 'running' : 'paused';
  });
}

function pendingNodeMarkup(index) {
  const label = `图片生成中 · ${index + 1}`;
  return `<article class="pending-node variant-${currentVariant.toLowerCase()}" aria-label="${label}" aria-busy="true" data-motion-state="running">
    <canvas class="pending-canvas" aria-hidden="true"></canvas>
    <span class="pending-sheen"></span>
  </article>`;
}

function render() {
  for (const instance of [...instances]) instance.destroy();
  const variant = variants[currentVariant];
  variantTitle.textContent = `${currentVariant} · ${variant.name}`;
  variantDescription.textContent = variant.description;
  variantState.textContent = `Variant ${currentVariant}${currentVariant === 'A' ? ' · 推荐' : ''}`;
  switcherLabel.textContent = `${currentVariant} · ${variant.name}`;
  canvasContent.dataset.count = String(nodeCount);
  canvasContent.innerHTML = Array.from({ length:nodeCount }, (_, index) => pendingNodeMarkup(index)).join('');
  canvasContent.querySelectorAll('.pending-node').forEach((node, index) => new HalftoneInstance(node, index));
  syncSettingControls();
  syncColorControls();
  themeToggle.textContent = root.dataset.uiTheme === 'dark' ? '切换浅色' : '切换深色';
  countToggle.textContent = `节点数：${nodeCount}`;
  updateRuntimeState();
  syncUrl();
  ensureAnimationLoop();
}

function cycleVariant(direction) {
  const index = variantKeys.indexOf(currentVariant);
  currentVariant = variantKeys[(index + direction + variantKeys.length) % variantKeys.length];
  render();
}

document.querySelector('#previous-variant').addEventListener('click', () => cycleVariant(-1));
document.querySelector('#next-variant').addEventListener('click', () => cycleVariant(1));
themeToggle.addEventListener('click', () => {
  root.dataset.uiTheme = root.dataset.uiTheme === 'dark' ? 'light' : 'dark';
  render();
});
motionToggle.addEventListener('click', () => {
  manuallyPaused = !manuallyPaused;
  root.dataset.uiMotion = manuallyPaused ? 'reduced' : 'standard';
  if (manuallyPaused) {
    redrawInstances();
  }
  updateRuntimeState();
  syncUrl();
  ensureAnimationLoop();
});
countToggle.addEventListener('click', () => {
  nodeCount = nodeCount === 2 ? 6 : (nodeCount === 6 ? 18 : 2);
  render();
});
document.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('input', () => {
  const key = input.dataset.setting;
  settings[key] = Number(input.value);
  document.querySelector(`#${key}-output`).textContent = settingDisplay(key, settings[key]);
  redrawInstances();
  syncUrl();
}));
document.querySelectorAll('[data-color-setting]').forEach(input => input.addEventListener('input', () => {
  if (!colorsCustomized) {
    const light = colorsFor(currentVariant, false);
    const dark = colorsFor(currentVariant, true);
    Object.assign(colors, { lightBg:light.background, lightDot:light.dot, darkBg:dark.background, darkDot:dark.dot });
    colorsCustomized = true;
  }
  const key = input.dataset.colorSetting;
  colors[key] = input.value.toLowerCase();
  syncColorControls();
  redrawInstances();
  syncUrl();
}));
document.querySelector('#tuning-reset').addEventListener('click', () => {
  Object.assign(settings, defaultSettings);
  Object.assign(colors, defaultColors);
  colorsCustomized = false;
  syncSettingControls();
  syncColorControls();
  redrawInstances();
  syncUrl();
});
document.addEventListener('visibilitychange', () => {
  updateRuntimeState();
  ensureAnimationLoop();
});
document.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, [contenteditable]')) return;
  if (event.key === 'ArrowLeft') cycleVariant(-1);
  if (event.key === 'ArrowRight') cycleVariant(1);
});

render();
