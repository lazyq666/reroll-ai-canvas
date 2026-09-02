import './core.js?v=ic-ui-b0dd1bc6845c';

const defaults = Object.freeze({
  playing: true,
  count: 2,
  duration: 8,
  blur: 28,
  drift: 28,
  size: 78,
  opacity: 82,
  saturation: 100,
  colorOne: '#ffbd8e',
  colorTwo: '#9f7cff',
  colorThree: '#61d8d0',
});

const limits = Object.freeze({
  count: [1, 12],
  duration: [3, 20],
  blur: [0, 64],
  drift: [8, 42],
  size: [55, 120],
  opacity: [30, 100],
  saturation: [60, 180],
});

const params = new URLSearchParams(location.search);
const settings = { ...defaults };

function clampedNumber(name) {
  if (!params.has(name)) return defaults[name];
  const value = Number(params.get(name));
  if (!Number.isFinite(value)) return defaults[name];
  const [minimum, maximum] = limits[name];
  return Math.min(maximum, Math.max(minimum, value));
}

function safeColor(name) {
  const value = params.get(name) || '';
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : defaults[name];
}

for (const name of Object.keys(limits)) settings[name] = clampedNumber(name);
if (![1, 2, 6, 12].includes(settings.count)) settings.count = defaults.count;
for (const name of ['colorOne', 'colorTwo', 'colorThree']) settings[name] = safeColor(name);
settings.playing = params.get('playing') !== 'false';

const root = document.documentElement;
const form = document.querySelector('[data-parameter-form]');
const stage = document.querySelector('[data-motion-stage]');
const output = document.querySelector('[data-parameter-output] code');
const visibleCount = document.querySelector('[data-visible-count]');
const motionStatus = document.querySelector('[data-motion-status]');
const resetButton = document.querySelector('[data-reset-settings]');
const copyButton = document.querySelector('[data-copy-settings]');
const intersections = new WeakMap();
let observer;

function pendingNodeMarkup(index) {
  return `<article class="pending-motion-node" data-motion-state="running" role="status" aria-live="polite" aria-busy="true" aria-label="正在生成图片 ${index + 1}">
    <span class="motion-blob blob-one" aria-hidden="true"></span>
    <span class="motion-blob blob-two" aria-hidden="true"></span>
    <span class="motion-blob blob-three" aria-hidden="true"></span>
    <span class="pending-sheen" aria-hidden="true"></span>
    <span class="pending-content" aria-hidden="true"><span class="pending-spinner"></span></span>
    <span class="pending-label">正在生成图片 · ${index + 1}</span>
  </article>`;
}

function motionAllowed(node) {
  return settings.playing
    && !document.hidden
    && intersections.get(node) !== false
    && root.dataset.uiMotion !== 'reduced'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function syncMotionState() {
  for (const node of stage.querySelectorAll('.pending-motion-node')) {
    node.dataset.motionState = motionAllowed(node) ? 'running' : 'paused';
  }
  const anyRunning = [...stage.querySelectorAll('.pending-motion-node')]
    .some(node => node.dataset.motionState === 'running');
  motionStatus.textContent = anyRunning ? '播放中' : '已暂停';
}

function observeNodes() {
  observer?.disconnect();
  if (!('IntersectionObserver' in window)) {
    syncMotionState();
    return;
  }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) intersections.set(entry.target, entry.isIntersecting);
    syncMotionState();
  }, { rootMargin: '80px' });
  for (const node of stage.querySelectorAll('.pending-motion-node')) observer.observe(node);
}

function renderNodes() {
  stage.dataset.count = settings.count >= 6 ? 'dense' : 'standard';
  stage.innerHTML = Array.from({ length: settings.count }, (_, index) => pendingNodeMarkup(index)).join('');
  visibleCount.textContent = `${settings.count} 个实例`;
  observeNodes();
}

function cssParameterText() {
  return [
    `--motion-duration:${settings.duration}s`,
    `--motion-blur:${settings.blur}px`,
    `--motion-drift:${settings.drift}%`,
    `--motion-blob-size:${settings.size}%`,
    `--motion-opacity:${(settings.opacity / 100).toFixed(2)}`,
    `--motion-saturation:${(settings.saturation / 100).toFixed(2)}`,
    `--blob-one-color:${settings.colorOne}`,
    `--blob-two-color:${settings.colorTwo}`,
    `--blob-three-color:${settings.colorThree}`,
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
  stage.style.setProperty('--motion-duration', `${settings.duration}s`);
  stage.style.setProperty('--motion-blur', `${settings.blur}px`);
  stage.style.setProperty('--motion-drift', `${settings.drift}%`);
  stage.style.setProperty('--motion-blob-size', `${settings.size}%`);
  stage.style.setProperty('--motion-opacity', String(settings.opacity / 100));
  stage.style.setProperty('--motion-saturation', String(settings.saturation / 100));
  stage.style.setProperty('--blob-one-color', settings.colorOne);
  stage.style.setProperty('--blob-two-color', settings.colorTwo);
  stage.style.setProperty('--blob-three-color', settings.colorThree);
  if (rerender) renderNodes();
  syncMotionState();
  output.textContent = cssParameterText();
  syncUrl();
}

function controlFor(name) {
  return form.querySelector(`[data-setting="${name}"]`);
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
    if (control.localName === 'ic-slider') {
      const suffix = name === 'duration' ? 's' : (name === 'blur' ? 'px' : '%');
      control.setAttribute('value-text', `${value}${suffix}`);
    }
  }
}

function readControl(control) {
  const name = control.dataset.setting;
  if (!name) return false;
  if (name === 'playing') {
    settings.playing = Boolean(control.checked);
    return false;
  }
  if (name.startsWith('color')) {
    const value = String(control.value || '').toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) settings[name] = value;
    return false;
  }
  const value = Number(control.value);
  if (!Number.isFinite(value)) return false;
  const previous = settings[name];
  settings[name] = value;
  if (control.localName === 'ic-slider') {
    const suffix = name === 'duration' ? 's' : (name === 'blur' ? 'px' : '%');
    control.setAttribute('value-text', `${value}${suffix}`);
  }
  return name === 'count' && previous !== value;
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
  applySettings({ rerender:true });
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(cssParameterText());
    copyButton.textContent = '已复制';
    window.setTimeout(() => { copyButton.textContent = '复制参数'; }, 1200);
  } catch (_) {
    output.focus?.();
  }
});
document.addEventListener('visibilitychange', syncMotionState);
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', syncMotionState);

await Promise.all(['ic-button', 'ic-switch', 'ic-select', 'ic-slider', 'ic-color-field'].map(tag => customElements.whenDefined(tag)));
syncControls();
renderNodes();
applySettings();
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const controlsReady = [...form.querySelectorAll('ic-switch, ic-select, ic-slider, ic-color-field')]
  .every(control => control.dataset.icContractStatus === 'ready');
root.dataset.pendingMotionReferenceStatus = controlsReady ? 'ready' : 'failed';
