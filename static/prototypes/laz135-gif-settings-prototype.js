import '/static/js/infinite-canvas-ui/core.js';

await Promise.all(['ic-generation-settings-picker', 'ic-select', 'ic-icon-button'].map(tag => customElements.whenDefined(tag)));

const byId = id => document.getElementById(id);
const translations = window.StudioI18n.entries();
let language = 'zh';
const tr = key => translations[language][key] || key;
const trf = (key, values) => tr(key).replace(/\{([^{}]+)\}/g, (match, name) => values[name] ?? match);
window.StudioI18n.t = tr;
window.StudioI18n.format = trf;
window.StudioI18n.lang = () => language;

const defaults = () => ({ size: 512, count: 9, milliseconds: 200, quality: 'auto', playing: false });
const frameDurations = [1000, 500, 250, 200, 160, 120, 100, 80, 60, 50, 40, 30, 20];
const frameRateLabels = [0, 3, 6, 10, 12];
let state = defaults();
let frameIndex = 0;
let timer = 0;
const picker = byId('gifSettings');
const imagePicker = byId('imageSettings');
const canvas = byId('preview');
const context = canvas.getContext('2d');
const originalRender = picker.render.bind(picker);
const frameRate = () => Number((1000 / state.milliseconds).toFixed(2));
const frameRateLabel = () => trf('laz135Prototype.fpsValue', { fps: frameRate() });
const framesLabel = count => trf('laz135Prototype.frames', { count });

function sheetValid(size = state.size, count = state.count) {
  const columns = count <= 8 ? 4 : count === 9 ? 3 : 4;
  const rows = count <= 8 ? 2 : count <= 12 ? 3 : 4;
  const width = columns * size;
  const height = rows * size;
  return Math.max(width, height) <= 3840 && width * height <= 8294400 && Math.max(width, height) / Math.min(width, height) <= 3;
}

function updateState() {
  const animated = byId('format').value === 'gif';
  document.querySelector('.preview-heading h2').textContent = tr(animated ? 'laz135Prototype.preview' : 'laz135Prototype.imagePreview');
  byId('play').hidden = !animated;
  byId('previewButton').hidden = !animated;
  byId('frameReadout').textContent = animated ? framesLabel(state.count) : `${state.size} × ${state.size}`;
  byId('total').textContent = animated ? trf('laz135Prototype.total', { seconds: Number((state.count * state.milliseconds / 1000).toFixed(2)) }) : '';
  byId('settingsState').textContent = JSON.stringify(animated ? {
    output_format: 'gif', quality: state.quality, frame_size: `${state.size}x${state.size}`,
    frame_count: state.count, frame_duration_ms: state.milliseconds, n: Number(byId('count').value),
  } : {
    output_format: 'png', quality: imagePicker.quality, aspect_ratio: imagePicker.ratio,
    resolution_tier: imagePicker.resolution, n: Number(byId('count').value),
  }, null, 2);
  const label = picker.shadowRoot.querySelector('.trigger-label');
  if (label) label.textContent = `${state.size} × ${state.size} / ${picker.qualityLabels()[picker.quality]} / ${framesLabel(state.count)}`;
  const frameValue = picker.shadowRoot.querySelector('.duration-value');
  if (frameValue) frameValue.textContent = framesLabel(state.count);
  const error = picker.shadowRoot.querySelector('[data-gif-error]');
  if (error) {
    error.textContent = sheetValid() ? '' : tr('smart.gifSheetInvalid');
    error.hidden = sheetValid();
  }
  picker.shadowRoot.querySelectorAll('[data-frame-size]').forEach(button => {
    button.disabled = !sheetValid(Number(button.dataset.frameSize));
    button.setAttribute('aria-checked', String(Number(button.dataset.frameSize) === state.size));
  });
  byId('previewButton').toggleAttribute('disabled', animated && !sheetValid());
  byId('play').disabled = animated && !sheetValid();
  byId('play').textContent = tr(state.playing ? 'laz135Prototype.pause' : 'laz135Prototype.play');
  byId('previewButton').setAttribute('label', tr(state.playing ? 'laz135Prototype.pause' : 'laz135Prototype.play'));
  byId('previewButton').setAttribute('icon', state.playing ? 'pause' : 'play');
  drawFrame();
}

function drawFrame() {
  context.clearRect(0, 0, 512, 512);
  const progress = frameIndex / Math.max(1, state.count);
  const horizontal = 256 + Math.sin(progress * Math.PI * 2) * 148;
  const vertical = 260 - Math.abs(Math.sin(progress * Math.PI * 2)) * 100;
  context.strokeStyle = getComputedStyle(document.querySelector('.preview-node')).borderColor;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(56, 320);
  context.lineTo(456, 320);
  context.stroke();
  context.fillStyle = getComputedStyle(document.body).color;
  context.beginPath();
  context.arc(horizontal, vertical, 32, 0, Math.PI * 2);
  context.fill();
}

function restartPreview() {
  clearInterval(timer);
  frameIndex = 0;
  drawFrame();
  if (state.playing) timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % state.count;
    drawFrame();
  }, state.milliseconds);
}

function setFrameRate(input) {
  state.milliseconds = frameDurations[Number(input.value)];
  picker.shadowRoot.querySelector('[data-fps-value]').textContent = frameRateLabel();
  input.setAttribute('aria-valuetext', frameRateLabel());
  picker.shadowRoot.querySelectorAll('[data-fps-label]').forEach(label => {
    label.classList.toggle('is-current', Number(label.dataset.fpsLabel) === Number(input.value));
  });
  updateState();
  restartPreview();
  picker.positionPanel();
}

picker.durationAriaText = framesLabel;
picker.positionPanel = function positionPrototypePanel() {
  if (!this.open || !this.panel) return;
  const anchor = byId('composer').querySelector('.param-row').getBoundingClientRect();
  const desiredLeft = byId('composer').getBoundingClientRect().left + 115;
  this.panel.style.left = `${Math.max(16, Math.min(desiredLeft, innerWidth - this.panel.offsetWidth - 16))}px`;
  this.panel.style.top = `${Math.max(16, Math.min(anchor.top - this.panel.offsetHeight - 8, innerHeight - this.panel.offsetHeight - 16))}px`;
  this.panel.dataset.motionSide = 'top';
};
picker.render = function renderPrototypePicker() {
  originalRender();
  const style = document.createElement('style');
  style.textContent = `
    [part="panel"] { max-block-size: calc(100dvh - 32px); }
    .prototype-fps-value { color: var(--ic-generation-settings-label-foreground); font: var(--ui-text-body); font-variant-numeric: tabular-nums; }
    .prototype-message { margin: 0; font: var(--ui-text-caption); font-size: 12px; color: var(--ui-color-text-secondary); }
    [data-gif-error] { color: var(--ui-color-text-danger); }
    [data-frame-size]:disabled { color: var(--ui-color-text-disabled); cursor: not-allowed; }
    @media (max-width: 700px) { .segment { min-height: 40px; } .duration-slider, .duration-scale { height: 44px; } }
  `;
  this.shadowRoot.append(style);
  const resolution = document.createElement('div');
  resolution.className = 'setting-section';
  resolution.innerHTML = `<span class="setting-label" data-i18n="laz135Prototype.resolution">${tr('laz135Prototype.resolution')}</span>
    <div class="segments" style="--segment-count:3" role="radiogroup" aria-label="${tr('laz135Prototype.resolution')}">
      ${[256, 512, 768].map(size => `<button type="button" class="segment" role="radio" data-frame-size="${size}" aria-checked="${size === state.size}">${size} × ${size}</button>`).join('')}
    </div>`;
  this.panel.prepend(resolution);
  const timing = document.createElement('div');
  timing.className = 'setting-section';
  timing.innerHTML = `<div class="duration-heading">
      <span class="setting-label" data-i18n="laz135Prototype.frameRate">${tr('laz135Prototype.frameRate')}</span>
      <output class="prototype-fps-value" data-fps-value>${frameRateLabel()}</output>
    </div>
    <div class="duration-scale">
      <div class="duration-ticks" aria-hidden="true">${frameDurations.map((duration, index) => `<span class="duration-tick" style="--tick-position:${index / (frameDurations.length - 1) * 100}%"></span>`).join('')}</div>
      <input class="duration-slider" type="range" data-timing="fps" min="0" max="${frameDurations.length - 1}" step="1" value="${frameDurations.indexOf(state.milliseconds)}" aria-label="${tr('laz135Prototype.frameRate')}" aria-valuetext="${frameRateLabel()}" title="${tr('laz135Prototype.fpsHint')}">
    </div>
    <div class="duration-labels" aria-hidden="true">${frameRateLabels.map(index => `<span class="duration-label ${frameDurations[index] === state.milliseconds ? 'is-current' : ''}" style="--label-position:${index / (frameDurations.length - 1) * 100}%" data-fps-label="${index}">${Number((1000 / frameDurations[index]).toFixed(2))}</span>`).join('')}</div>`;
  this.panel.querySelector('.duration-section').before(timing);
  const error = document.createElement('p');
  error.className = 'prototype-message';
  error.dataset.gifError = '';
  error.setAttribute('role', 'status');
  error.hidden = true;
  this.panel.append(error);
  this.shadowRoot.querySelectorAll('[data-duration-label]').forEach(label => {
    label.textContent = label.dataset.durationLabel;
  });
  this.shadowRoot.querySelector('.duration-section .setting-label').textContent = tr('smart.frameCount');
  const slider = this.shadowRoot.querySelector('.duration-section .duration-slider');
  slider.setAttribute('aria-label', tr('smart.frameCount'));
  slider.setAttribute('aria-valuetext', framesLabel(state.count));
  slider.addEventListener('input', () => {
    state.count = Number(slider.value);
    this.shadowRoot.querySelector('.duration-value').textContent = framesLabel(state.count);
    updateState();
    restartPreview();
  });
  this.shadowRoot.querySelectorAll('[data-frame-size]').forEach(button => button.addEventListener('click', () => {
    state.size = Number(button.dataset.frameSize);
    updateState();
  }));
  const fpsSlider = this.shadowRoot.querySelector('[data-timing="fps"]');
  fpsSlider.addEventListener('input', () => setFrameRate(fpsSlider));
  updateState();
};

function localize() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = tr(element.dataset.i18n); });
  for (const attribute of ['label', 'aria-label', 'placeholder']) {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => {
      element.setAttribute(attribute, tr(element.getAttribute(`data-i18n-${attribute}`)));
    });
  }
  for (const settingsPicker of [picker, imagePicker]) {
    for (const [attribute, key] of Object.entries({
      'quality-label': 'smart.quality', 'quality-auto-label': 'smart.qualityAuto',
      'quality-low-label': 'smart.qualityLow', 'quality-medium-label': 'smart.qualityMid',
      'quality-high-label': 'smart.qualityHigh', 'quality-xhigh-label': 'smart.qualityXhigh',
      'quality-max-label': 'smart.qualityMax', 'duration-label': 'smart.frameCount',
      'resolution-label': 'laz135Prototype.resolution',
    })) settingsPicker.setAttribute(attribute, tr(key));
    settingsPicker.render();
  }
  updateCountLabels();
  document.querySelectorAll('ic-select').forEach(select => { select.syncOptions(); select.selectionChanged(); });
  updateState();
}

function updateCountLabels() {
  const animated = byId('format').value === 'gif';
  byId('count').querySelectorAll('option').forEach(option => {
    const single = Number(option.value) === 1;
    option.textContent = animated
      ? trf(single ? 'laz135Prototype.animation' : 'laz135Prototype.animations', { count: option.value })
      : `${option.value} ${tr(single ? 'smart.countUnitOne' : 'smart.countUnit')}`;
  });
  byId('count').syncOptions();
  byId('count').selectionChanged();
}

picker.addEventListener('ic-change', () => {
  state.quality = picker.quality;
  state.count = Number(picker.duration);
  updateState();
});
imagePicker.addEventListener('ic-change', updateState);
byId('count').addEventListener('change', updateState);
byId('format').addEventListener('change', () => {
  picker.hide();
  imagePicker.hide();
  const animated = byId('format').value === 'gif';
  picker.hidden = !animated;
  imagePicker.hidden = animated;
  state.playing = false;
  updateCountLabels();
  restartPreview();
  updateState();
});
byId('language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; localize(); });
byId('theme').addEventListener('click', () => {
  document.documentElement.classList.toggle('theme-dark');
  document.body.classList.toggle('theme-dark');
  drawFrame();
});
byId('reset').addEventListener('click', () => {
  state = defaults();
  picker.quality = state.quality;
  picker.duration = state.count;
  byId('format').value = 'gif';
  byId('count').value = '1';
  imagePicker.ratio = '1:1';
  imagePicker.resolution = '1K';
  imagePicker.quality = 'auto';
  picker.hidden = false;
  imagePicker.hidden = true;
  picker.render();
  updateCountLabels();
  restartPreview();
  updateState();
  picker.show();
});
function togglePreview() {
  if (!sheetValid() && byId('format').value === 'gif') return;
  state.playing = !state.playing;
  restartPreview();
  updateState();
}
byId('play').addEventListener('click', togglePreview);
byId('previewButton').addEventListener('click', togglePreview);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { state.playing = false; restartPreview(); updateState(); }
});
localize();
picker.show();
window.GifSettingsPrototype = { getState: () => ({ ...state, fps: frameRate(), valid: sheetValid() }) };
