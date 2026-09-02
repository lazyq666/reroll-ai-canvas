import './core.js?v=ic-ui-b0dd1bc6845c';

const DEFAULTS = Object.freeze({
  count: 8,
  radius: 16,
  length: 10,
  lineWidth: 1.5,
  duration: 360,
  maxBursts: 3,
});

const LIMITS = Object.freeze({
  count: [4, 16],
  radius: [12, 42],
  length: [4, 18],
  lineWidth: [0.5, 2.5],
  duration: [160, 700],
  maxBursts: [1, 6],
});

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const DPR_LIMIT = 1.5;
const DRAG_DISTANCE_PX = 4;

function clampedAttribute(element, name) {
  const fallback = DEFAULTS[name];
  const value = Number(element.getAttribute(`spark-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`));
  if (!Number.isFinite(value)) return fallback;
  const [minimum, maximum] = LIMITS[name];
  return Math.min(maximum, Math.max(minimum, value));
}

class IcClickSparkReference extends HTMLElement {
  static get observedAttributes() {
    return [
      'spark-color',
      'spark-count',
      'spark-radius',
      'spark-length',
      'spark-line-width',
      'spark-duration',
      'spark-max-bursts',
      'disabled',
    ];
  }

  constructor() {
    super();
    this.attachShadow({ mode:'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position:relative;
          display:block;
          min-width:0;
          min-height:0;
          overflow:hidden;
          contain:layout paint style;
          isolation:isolate;
        }
        canvas {
          position:absolute;
          z-index:2;
          inset:0;
          display:block;
          width:100%;
          height:100%;
          pointer-events:none;
          user-select:none;
        }
        .color-probe {
          position:absolute;
          width:0;
          height:0;
          overflow:hidden;
          pointer-events:none;
          color:var(--click-spark-color, #5b5ff0);
        }
        .color-probe[data-kind="outline"] {
          color:var(--click-spark-outline, rgba(255,255,255,.78));
        }
        .content { position:relative; z-index:1; width:100%; height:100%; }
        ::slotted(*) { box-sizing:border-box; }
      </style>
      <span class="color-probe" data-kind="spark" aria-hidden="true"></span>
      <span class="color-probe" data-kind="outline" aria-hidden="true"></span>
      <canvas aria-hidden="true"></canvas>
      <div class="content"><slot></slot></div>`;
    this._canvas = this.shadowRoot.querySelector('canvas');
    this._sparkColorProbe = this.shadowRoot.querySelector('[data-kind="spark"]');
    this._outlineColorProbe = this.shadowRoot.querySelector('[data-kind="outline"]');
    this._context = this._canvas.getContext('2d');
    this._bursts = [];
    this._raf = 0;
    this._reducedClearTimer = 0;
    this._press = null;
    this._triggerCount = 0;
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._onMouseDown = event => this._beginGesture(event);
    this._onMouseUp = event => this._finishGesture(event);
    this._drawFrame = timestamp => this._draw(timestamp);
  }

  connectedCallback() {
    this.dataset.animationState = 'idle';
    this.dataset.triggerCount = String(this._triggerCount);
    this.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this._resizeObserver.observe(this);
    this._resize();
  }

  disconnectedCallback() {
    this.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this._resizeObserver.disconnect();
    cancelAnimationFrame(this._raf);
    clearTimeout(this._reducedClearTimer);
    this._raf = 0;
    this._bursts = [];
  }

  attributeChangedCallback() {
    if (this.isConnected) this._resize();
  }

  get animationActive() {
    return Boolean(this._raf);
  }

  _settings() {
    return {
      count:Math.round(clampedAttribute(this, 'count')),
      radius:clampedAttribute(this, 'radius'),
      length:clampedAttribute(this, 'length'),
      lineWidth:clampedAttribute(this, 'lineWidth'),
      duration:clampedAttribute(this, 'duration'),
      maxBursts:Math.round(clampedAttribute(this, 'maxBursts')),
    };
  }

  _resize() {
    const rect = this.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this._canvas.width === width && this._canvas.height === height) return;
    this._canvas.width = width;
    this._canvas.height = height;
    this._canvas.dataset.dpr = String(dpr);
  }

  _beginGesture(event) {
    if (this.hasAttribute('disabled') || event.button !== 0) return;
    this._press = { x:event.clientX, y:event.clientY };
  }

  _finishGesture(event) {
    const press = this._press;
    this._press = null;
    if (!press || this.hasAttribute('disabled') || event.button !== 0) return;
    const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const rect = this.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    this.burstAt(x, y, distance >= DRAG_DISTANCE_PX ? 'drag-release' : 'click');
  }

  _colors() {
    return {
      color:this.getAttribute('spark-color')
        || getComputedStyle(this._sparkColorProbe).color
        || '#5b5ff0',
      outline:getComputedStyle(this._outlineColorProbe).color
        || 'rgba(255,255,255,.78)',
    };
  }

  burstAt(x, y, gesture='programmatic') {
    if (this.hasAttribute('disabled') || document.hidden) return false;
    const rect = this.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const settings = this._settings();
    const colors = this._colors();
    this._triggerCount += 1;
    this.dataset.triggerCount = String(this._triggerCount);
    this.dataset.lastGesture = gesture;

    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) {
      this.dataset.lastMotion = 'reduced';
      this._drawReduced(x, y, colors);
      this._emitSpark(gesture, settings, true);
      return true;
    }

    const directions = Array.from({ length:settings.count }, (_, index) => {
      const angle = Math.PI * 2 * index / settings.count;
      return { dx:Math.cos(angle), dy:Math.sin(angle) };
    });
    this._bursts.push({
      x,
      y,
      start:performance.now(),
      directions,
      settings,
      colors,
    });
    if (this._bursts.length > settings.maxBursts) {
      this._bursts.splice(0, this._bursts.length - settings.maxBursts);
    }
    this.dataset.lastMotion = 'animated';
    this.dataset.animationState = 'active';
    if (!this._raf) this._raf = requestAnimationFrame(this._drawFrame);
    this._emitSpark(gesture, settings, false);
    return true;
  }

  _emitSpark(gesture, settings, reducedMotion) {
    this.dispatchEvent(new CustomEvent('ic-spark', {
      bubbles:true,
      composed:true,
      detail:{
        gesture,
        sparkCount:settings.count,
        reducedMotion,
        triggerCount:this._triggerCount,
      },
    }));
  }

  _clearCanvas() {
    const context = this._context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  _prepareContext() {
    const dpr = Number(this._canvas.dataset.dpr) || 1;
    this._context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._context.lineCap = 'round';
  }

  _drawReduced(x, y, colors) {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._bursts = [];
    clearTimeout(this._reducedClearTimer);
    this._clearCanvas();
    this._prepareContext();
    this._context.beginPath();
    this._context.arc(x, y, 2.1, 0, Math.PI * 2);
    this._context.fillStyle = colors.outline;
    this._context.fill();
    this._context.beginPath();
    this._context.arc(x, y, 1.2, 0, Math.PI * 2);
    this._context.fillStyle = colors.color;
    this._context.fill();
    this.dataset.animationState = 'idle';
    this._reducedClearTimer = window.setTimeout(() => this._clearCanvas(), 120);
  }

  _strokeBursts(bursts, outline=false) {
    const context = this._context;
    for (const burst of bursts) {
      const { progress, eased } = burst;
      const distance = eased * burst.settings.radius;
      const lineLength = burst.settings.length * (1 - eased);
      context.globalAlpha = Math.max(0, 1 - progress);
      context.strokeStyle = outline ? burst.colors.outline : burst.colors.color;
      context.lineWidth = outline
        ? burst.settings.lineWidth + 0.9
        : burst.settings.lineWidth;
      context.beginPath();
      for (const direction of burst.directions) {
        const x1 = burst.x + distance * direction.dx;
        const y1 = burst.y + distance * direction.dy;
        context.moveTo(x1, y1);
        context.lineTo(
          x1 + lineLength * direction.dx,
          y1 + lineLength * direction.dy,
        );
      }
      context.stroke();
    }
  }

  _draw(timestamp) {
    this._raf = 0;
    this._clearCanvas();
    this._prepareContext();
    const visible = [];
    for (const burst of this._bursts) {
      const progress = (timestamp - burst.start) / burst.settings.duration;
      if (progress >= 1) continue;
      const normalized = Math.max(0, progress);
      visible.push({
        ...burst,
        progress:normalized,
        eased:1 - (1 - normalized) * (1 - normalized),
      });
    }
    this._bursts = visible.map(({ progress, eased, ...burst }) => burst);
    this._strokeBursts(visible, true);
    this._strokeBursts(visible, false);
    this._context.globalAlpha = 1;
    if (this._bursts.length) {
      this._raf = requestAnimationFrame(this._drawFrame);
      return;
    }
    this.dataset.animationState = 'idle';
  }
}

if (!customElements.get('ic-click-spark-reference')) {
  customElements.define('ic-click-spark-reference', IcClickSparkReference);
}

const defaults = { ...DEFAULTS, useCustomColor:false, color:'#675cff' };
const settings = { ...defaults };
const form = document.querySelector('[data-click-spark-form]');
const previews = [...document.querySelectorAll('ic-click-spark-reference')];
const output = document.querySelector('[data-click-spark-output] code');
const triggerStatus = document.querySelector('[data-trigger-status]');
const animationStatus = document.querySelector('[data-animation-status]');
const resetButton = document.querySelector('[data-reset-settings]');
const playButton = document.querySelector('[data-play-example]');

function controlFor(name) {
  return form?.querySelector(`[data-setting="${name}"]`);
}

function syncControls() {
  for (const [name, value] of Object.entries(settings)) {
    const control = controlFor(name);
    if (!control) continue;
    if (name === 'useCustomColor') {
      control.checked = Boolean(value);
      control.toggleAttribute('checked', Boolean(value));
    } else {
      control.value = String(value);
      control.setAttribute('value', String(value));
    }
    if (control.localName === 'ic-slider') {
      const suffix = name === 'duration' ? 'ms' : 'px';
      control.setAttribute('value-text', name === 'count' ? String(value) : `${value}${suffix}`);
    }
  }
}

function parameterText() {
  return [
    `count:${settings.count}`,
    `radius:${settings.radius}px`,
    `length:${settings.length}px`,
    `lineWidth:${settings.lineWidth}px`,
    `duration:${settings.duration}ms`,
    `maxBursts:${settings.maxBursts}`,
    settings.useCustomColor ? `color:${settings.color}` : 'color:theme-token',
  ].join('; ');
}

function applySettings() {
  for (const preview of previews) {
    preview.setAttribute('spark-count', String(settings.count));
    preview.setAttribute('spark-radius', String(settings.radius));
    preview.setAttribute('spark-length', String(settings.length));
    preview.setAttribute('spark-line-width', String(settings.lineWidth));
    preview.setAttribute('spark-duration', String(settings.duration));
    preview.setAttribute('spark-max-bursts', String(settings.maxBursts));
    if (settings.useCustomColor) preview.setAttribute('spark-color', settings.color);
    else preview.removeAttribute('spark-color');
  }
  output.textContent = parameterText();
}

function readControl(control) {
  const name = control?.dataset.setting;
  if (!name) return;
  if (name === 'useCustomColor') settings[name] = Boolean(control.checked);
  else if (name === 'color') settings[name] = String(control.value || defaults.color);
  else settings[name] = Number(control.value);
  syncControls();
  applySettings();
}

form?.addEventListener('input', event => readControl(event.target.closest?.('[data-setting]')));
form?.addEventListener('change', event => readControl(event.target.closest?.('[data-setting]')));
resetButton?.addEventListener('click', () => {
  Object.assign(settings, defaults);
  syncControls();
  applySettings();
});
playButton?.addEventListener('click', () => {
  for (const preview of previews) {
    const rect = preview.getBoundingClientRect();
    preview.burstAt(rect.width / 2, rect.height / 2, 'programmatic');
  }
});

for (const preview of previews) {
  preview.addEventListener('ic-spark', event => {
    triggerStatus.textContent = event.detail.gesture === 'drag-release'
      ? '最近：拖动松手'
      : event.detail.gesture === 'click'
        ? '最近：普通点击'
        : '最近：示例播放';
  });
  const observer = new MutationObserver(() => {
    const active = previews.some(item => item.dataset.animationState === 'active');
    animationStatus.textContent = active ? 'RAF 运行中' : 'RAF 已停止';
    animationStatus.dataset.state = active ? 'active' : 'idle';
  });
  observer.observe(preview, { attributes:true, attributeFilter:['data-animation-state'] });
}

for (const token of document.querySelectorAll('[data-drag-token]')) {
  let drag = null;
  token.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    const rect = token.getBoundingClientRect();
    const surfaceRect = token.closest('ic-click-spark-reference').getBoundingClientRect();
    drag = {
      offsetX:event.clientX - (rect.left + rect.width / 2),
      offsetY:event.clientY - (rect.top + rect.height / 2),
      surfaceRect,
    };
    token.dataset.dragging = 'true';
    event.preventDefault();
  });
  window.addEventListener('mousemove', event => {
    if (!drag) return;
    const x = Math.min(drag.surfaceRect.width - 28, Math.max(28, event.clientX - drag.surfaceRect.left - drag.offsetX));
    const y = Math.min(drag.surfaceRect.height - 28, Math.max(28, event.clientY - drag.surfaceRect.top - drag.offsetY));
    token.style.left = `${x}px`;
    token.style.top = `${y}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    delete token.dataset.dragging;
  });
}

await Promise.all([
  'ic-button',
  'ic-switch',
  'ic-slider',
  'ic-color-field',
  'ic-click-spark-reference',
].map(tag => customElements.whenDefined(tag)));
syncControls();
applySettings();
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
document.documentElement.dataset.clickSparkReferenceStatus = 'ready';
