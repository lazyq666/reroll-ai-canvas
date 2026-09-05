import { orderAspectRatios, orderResolutions } from './generation-option-order.js?v=ic-ui-0e81b6afe7d8';
import { closeTopLayer, isTopLayerOpen, openTopLayer } from './overlay-layer.js?v=ic-ui-0e81b6afe7d8';
import {
  ANCHORED_OVERLAY_MOTION_STYLES,
  nextOverlayPaint,
  setOverlayInteraction,
  waitForOverlayMotion,
} from './overlay-motion.js?v=ic-ui-0e81b6afe7d8';

const QUALITY_VALUES = Object.freeze(['auto', 'low', 'medium', 'high']);
const EXCLUSIVE_OVERLAY_REQUEST_EVENT = 'ic-exclusive-overlay-request';

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function csvValues(value) {
  return [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
}

function isEnglish(host) {
  return (host.closest('[lang]')?.lang || document.documentElement.lang || '')
    .toLowerCase()
    .startsWith('en');
}

function numericAttribute(host, name, fallback) {
  const value = Number(host.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function inclusiveScaleValues(minimum, maximum, interval) {
  const values = [minimum];
  for (let value = minimum + interval; value < maximum; value += interval) values.push(value);
  if (maximum !== minimum) values.push(maximum);
  return values;
}

function intervalScaleValues(minimum, maximum, interval) {
  const values = [];
  for (let value = minimum; value <= maximum; value += interval) values.push(value);
  return values;
}

export class IcGenerationSettingsPicker extends HTMLElement {
  static get observedAttributes() {
    return [
      'open', 'label', 'ratio', 'ratio-presets', 'resolution', 'resolutions', 'quality',
      'ratio-label', 'resolution-label', 'quality-label', 'source-label', 'source-ratio',
      'keep-ratio-label', 'adaptive-label', 'resolution-auto-label',
      'quality-auto-label', 'quality-low-label', 'quality-medium-label', 'quality-high-label',
      'duration', 'duration-min', 'duration-max', 'duration-step', 'duration-label',
      'hide-ratio', 'hide-resolution', 'hide-quality', 'lock-ratio', 'ratio-variant', 'warning', 'disabled',
    ];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastContractError = '';
    this._motionGeneration = 0;
    this._onViewportChange = () => this.positionPanel();
    this._onExclusiveOverlayRequest = event => {
      const source = event.detail?.source || event.target;
      if (source !== this && this.open) this.hide('exclusive-overlay');
    };
    this._onDocumentPointer = event => {
      if (this.open && !event.composedPath().includes(this)) this.hide('outside');
    };
    this._onDocumentKeydown = event => {
      if (this.open && event.key === 'Escape') {
        event.preventDefault();
        this.hide('escape');
        this.shadowRoot.querySelector('[part="trigger"]')?.focus();
      }
    };
  }

  connectedCallback() {
    if (!this.dataset.motionState) this.dataset.motionState = this.open ? 'open' : 'closed';
    // Composer stops pointer events from bubbling into the canvas. Listen in
    // the capture phase so clicks on its prompt or empty areas can still
    // dismiss this overlay before that boundary handles the event.
    document.addEventListener('pointerdown', this._onDocumentPointer, true);
    document.addEventListener('keydown', this._onDocumentKeydown);
    document.addEventListener(EXCLUSIVE_OVERLAY_REQUEST_EVENT, this._onExclusiveOverlayRequest);
    window.addEventListener('resize', this._onViewportChange);
    window.addEventListener('scroll', this._onViewportChange, true);
    this.render();
  }

  disconnectedCallback() {
    this._motionGeneration += 1;
    closeTopLayer(this.panel);
    document.removeEventListener('pointerdown', this._onDocumentPointer, true);
    document.removeEventListener('keydown', this._onDocumentKeydown);
    document.removeEventListener(EXCLUSIVE_OVERLAY_REQUEST_EVENT, this._onExclusiveOverlayRequest);
    window.removeEventListener('resize', this._onViewportChange);
    window.removeEventListener('scroll', this._onViewportChange, true);
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'open') {
      if (this.open && ['closed', 'exiting'].includes(this.dataset.motionState)) {
        this._motionGeneration += 1;
        this.dataset.motionState = 'open';
        setOverlayInteraction(this.panel, true);
      } else if (!this.open && !['closed', 'exiting'].includes(this.dataset.motionState)) {
        this._motionGeneration += 1;
        this.dataset.motionState = 'closed';
        setOverlayInteraction(this.panel, true);
      }
      this.syncOpenPresentation();
      return;
    }
    closeTopLayer(this.panel);
    this.render();
  }

  get open() { return this.hasAttribute('open'); }
  set open(value) {
    const next = Boolean(value);
    if (next === this.open) return;
    this.toggleAttribute('open', next);
    if (next) {
      this.dispatchEvent(new CustomEvent(EXCLUSIVE_OVERLAY_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: { source: this },
      }));
    }
  }
  get panel() { return this.shadowRoot.querySelector('[part="panel"]'); }
  get ratio() { return this.getAttribute('ratio') || ''; }
  set ratio(value) { this.setAttribute('ratio', String(value || '')); }
  get resolution() { return this.getAttribute('resolution') || ''; }
  set resolution(value) { this.setAttribute('resolution', String(value || '')); }
  get quality() { return this.getAttribute('quality') || 'auto'; }
  set quality(value) { this.setAttribute('quality', String(value || 'auto')); }
  get duration() { return this.getAttribute('duration') || ''; }
  set duration(value) { this.setAttribute('duration', String(value ?? '')); }

  durationConfig() {
    const minimum = numericAttribute(this, 'duration-min', 1);
    const maximum = Math.max(minimum, numericAttribute(this, 'duration-max', 60));
    const step = Math.max(1, numericAttribute(this, 'duration-step', 1));
    const value = numericAttribute(this, 'duration', minimum);
    const span = Math.max(0, maximum - minimum);
    const tickInterval = span <= 15 ? 1 : Math.max(1, Math.ceil(span / 14));
    const labelInterval = span <= 15 ? 2 : span <= 30 ? 5 : 10;
    const labels = intervalScaleValues(minimum, maximum, labelInterval);
    return {
      minimum,
      maximum,
      step,
      value,
      ticks: inclusiveScaleValues(minimum, maximum, tickInterval),
      labels,
    };
  }

  validateContract() {
    const ratios = orderAspectRatios(csvValues(this.getAttribute('ratio-presets')));
    const resolutions = orderResolutions(csvValues(this.getAttribute('resolutions')));
    if (!this.getAttribute('label')?.trim()) return 'label is required';
    if (!this.hasAttribute('hide-ratio') && !ratios.length) return 'ratio-presets requires at least one value';
    if (!this.hasAttribute('hide-ratio') && this.ratio && !ratios.includes(this.ratio)) return 'ratio must match one ratio-presets value';
    if (!this.hasAttribute('hide-resolution') && this.resolution && resolutions.length && !resolutions.includes(this.resolution)) {
      return 'resolution must match one resolutions value';
    }
    if (!this.hasAttribute('hide-quality') && !QUALITY_VALUES.includes(this.quality)) {
      return 'quality must be auto, low, medium, or high';
    }
    if (this.hasAttribute('duration')) {
      const { minimum, maximum, value } = this.durationConfig();
      if (!Number.isFinite(Number(this.duration))) return 'duration must be numeric';
      if (value < minimum || value > maximum) return 'duration must be within duration-min and duration-max';
    }
    return '';
  }

  syncContract() {
    const reason = this.validateContract();
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) this.dataset.icContractReason = reason;
    else delete this.dataset.icContractReason;
    if (reason && reason !== this._lastContractError) {
      this.dispatchEvent(new CustomEvent('ic-contract-error', {
        bubbles: true,
        composed: true,
        detail: { component: this.localName, reason },
      }));
    }
    this._lastContractError = reason;
    return !reason;
  }

  qualityLabels() {
    const english = isEnglish(this);
    return {
      auto: this.getAttribute('quality-auto-label') || (english ? 'Auto' : '自动'),
      low: this.getAttribute('quality-low-label') || (english ? 'Low' : '低'),
      medium: this.getAttribute('quality-medium-label') || (english ? 'Medium' : '中'),
      high: this.getAttribute('quality-high-label') || (english ? 'High' : '高'),
    };
  }

  ratioText() {
    if (this.ratio === 'source') {
      const sourceLabel = this.getAttribute('source-label') || (isEnglish(this) ? 'Original' : '原图');
      const sourceRatio = this.getAttribute('source-ratio')?.trim();
      return sourceRatio ? `${sourceLabel}(${sourceRatio})` : sourceLabel;
    }
    if (this.ratio === 'keep_ratio') {
      return this.getAttribute('keep-ratio-label') || (isEnglish(this) ? 'Keep' : '原图比例');
    }
    if (this.ratio === 'adaptive') {
      return this.getAttribute('adaptive-label') || (isEnglish(this) ? 'Adaptive' : '自适应');
    }
    return ({ square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4', landscape43:'4:3', story:'9:16', wide:'16:9', ultrawide:'21:9', ultratall:'9:21' }[this.ratio] || this.ratio);
  }

  resolutionText(value = this.resolution) {
    if (value === 'auto') {
      return this.getAttribute('resolution-auto-label') || (isEnglish(this) ? 'Auto' : '自动');
    }
    return String(value || '').toLowerCase();
  }

  durationAriaText(value) {
    return isEnglish(this) ? `${value} seconds` : `${value} 秒`;
  }

  emitSetting(field, value) {
    this.dispatchEvent(new CustomEvent('ic-change', {
      bubbles: true,
      composed: true,
      detail: { field, value },
    }));
  }

  positionPanel() {
    if (!this.open) return;
    const trigger = this.shadowRoot.querySelector('[part="trigger"]');
    const panel = this.panel;
    if (!trigger || !panel) return;
    const triggerRect = trigger.getBoundingClientRect();
    const composer = this.closest('#composer, .composer');
    const parameterRow = composer?.querySelector('.param-row');
    const anchorRect = parameterRow?.getBoundingClientRect() || composer?.getBoundingClientRect() || triggerRect;
    panel.style.left = '0px';
    panel.style.top = '0px';
    const panelRect = panel.getBoundingClientRect();
    const styles = getComputedStyle(this);
    const gap = Number.parseFloat(styles.getPropertyValue('--ui-space-2')) || 8;
    const margin = Number.parseFloat(styles.getPropertyValue('--ui-space-3')) || 12;
    const centeredFallbackLeft = anchorRect.left + (anchorRect.width - panelRect.width) / 2;
    const desiredLeft = composer ? composer.getBoundingClientRect().left + 115 : centeredFallbackLeft;
    const viewportLeft = Math.min(
      window.innerWidth - panelRect.width - margin,
      Math.max(margin, desiredLeft),
    );
    const preferredTop = anchorRect.top - panelRect.height - gap;
    const alternateTop = anchorRect.bottom + gap;
    const viewportTop = preferredTop >= margin
      ? preferredTop
      : Math.min(window.innerHeight - panelRect.height - margin, Math.max(margin, alternateTop));
    panel.dataset.motionSide = preferredTop >= margin ? 'top' : 'bottom';
    if (isTopLayerOpen(panel)) {
      panel.style.left = `${Math.round(viewportLeft)}px`;
      panel.style.top = `${Math.round(viewportTop)}px`;
      return;
    }
    // Compatibility path for browsers without Popover API: transformed
    // ancestors become the containing block for fixed descendants.
    panel.style.left = composer ? '115px' : `${Math.round(viewportLeft - panelRect.left)}px`;
    panel.style.top = `${Math.round(viewportTop - panelRect.top)}px`;
  }

  render() {
    const ratios = orderAspectRatios(csvValues(this.getAttribute('ratio-presets')));
    const resolutions = orderResolutions(csvValues(this.getAttribute('resolutions')));
    const qualityLabels = this.qualityLabels();
    const ratioLabel = this.getAttribute('ratio-label') || (isEnglish(this) ? 'Aspect ratio' : '比例');
    const resolutionLabel = this.getAttribute('resolution-label') || (isEnglish(this) ? 'Resolution' : '分辨率');
    const qualityLabel = this.getAttribute('quality-label') || (isEnglish(this) ? 'Quality' : '质量');
    const sourceLabel = this.getAttribute('source-label') || (isEnglish(this) ? 'Original' : '原图');
    const hideRatio = this.hasAttribute('hide-ratio');
    const hideResolution = this.hasAttribute('hide-resolution') || !resolutions.length;
    const hideQuality = this.hasAttribute('hide-quality');
    const showDuration = this.hasAttribute('duration');
    const duration = this.durationConfig();
    const durationLabel = this.getAttribute('duration-label') || (isEnglish(this) ? 'Duration' : '时长');
    const disabled = this.hasAttribute('disabled');
    const ratioLocked = this.hasAttribute('lock-ratio');
    const singleRatio = ratios.length === 1;
    const ratioDisabled = disabled || (ratioLocked && !singleRatio);
    const ratioDisplay = this.ratioText() || ratioLabel;
    const entryParts = hideRatio ? [] : [ratioDisplay];
    if (!hideResolution && this.resolution) entryParts.push(this.resolutionText());
    if (!hideQuality) entryParts.push(qualityLabels[this.quality] || this.quality);
    if (showDuration) entryParts.push(`${duration.value}s`);

    this.syncContract();
    this.shadowRoot.innerHTML = `
      <style>
        :host { --ic-generation-settings-entry-foreground: var(--ui-color-text-primary); --ic-generation-settings-label-foreground: var(--ui-color-text-tertiary); --ic-generation-settings-selected-foreground: var(--ui-color-text-primary); position: relative; display: inline-block; min-inline-size: 0; color: var(--ui-color-text-primary); font-family: var(--ui-font-sans); }
        :host([hidden]) { display: none; }
        ${ANCHORED_OVERLAY_MOTION_STYLES.replaceAll('[part~="surface"]', '[part="panel"]')}
        [part="trigger"] { box-sizing: border-box; block-size: 2rem; min-block-size: 2rem; max-inline-size: 15rem; display: inline-flex; align-items: center; gap: var(--ui-space-2); padding-inline: var(--ui-space-2); border: var(--ui-border-width-thin) solid transparent; border-radius: var(--ui-radius-pill); background: var(--ui-color-action-tertiary); color: var(--ic-generation-settings-entry-foreground); font: var(--ui-text-body-compact); white-space: nowrap; cursor: pointer; }
        [part="trigger"]:hover, :host([open]) [part="trigger"] { background: var(--ui-color-action-tertiary-hover); }
        [part="trigger"]:focus-visible { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
        [part="trigger"]:disabled { color: var(--ui-color-text-disabled); background: var(--ui-color-action-tertiary-disabled); border-color: var(--ui-color-border-disabled); opacity: 1; cursor: not-allowed; }
        .trigger-label { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
        .trigger-icon { --ic-icon-size: var(--ui-icon-size-s); --ic-icon-stroke-width: var(--ui-icon-stroke-width-s); flex: 0 0 auto; }
        [part="panel"] { position: fixed; inset: auto; z-index: var(--ui-z-popover); inline-size: 20rem; max-inline-size: min(20rem, calc(100vw - 2 * var(--ui-space-4))); max-block-size: min(32rem, calc(100vh - 2 * var(--ui-space-4))); box-sizing: border-box; display: grid; gap: var(--ui-space-3); overflow: auto; margin: 0; padding: var(--ui-space-3); border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius: var(--ui-radius-s); background: var(--ui-color-surface); box-shadow: var(--ui-shadow-overlay); }
        .setting-section { display: grid; gap: var(--ui-space-2); min-inline-size: 0; }
        .setting-label { color: var(--ic-generation-settings-label-foreground); font: var(--ui-text-label); }
        .warning { margin: 0; padding: var(--ui-space-2); border-radius: var(--ui-radius-s); background: var(--ui-color-surface-warning); color: var(--ui-color-text-primary); font: var(--ui-text-caption); }
        ic-aspect-ratio-picker { --ic-aspect-ratio-selected-foreground: var(--ic-generation-settings-selected-foreground); inline-size: 100%; }
        .segments { display: grid; grid-template-columns: repeat(var(--segment-count), minmax(0, 1fr)); gap: var(--ui-space-1); padding: var(--ui-space-1); border-radius: var(--ui-radius-s); background: var(--ui-color-surface-subtle); }
        .segment { min-inline-size: 0; block-size: var(--ui-control-height-s); padding-inline: var(--ui-space-2); border: var(--ui-border-width-thin) solid transparent; border-radius: var(--ui-radius-s); background: var(--ui-color-action-tertiary); color: var(--ui-color-text-tertiary); font: var(--ui-text-body-compact); cursor: pointer; }
        .segment:hover { background: var(--ui-color-action-tertiary-hover); color: var(--ui-color-text-primary); }
        .segment[aria-checked="true"] { color: var(--ic-generation-settings-selected-foreground); border-color: var(--ui-color-border-primary); background: var(--ui-color-action-secondary); box-shadow: var(--ui-shadow-raised); font-weight: var(--ui-font-weight-medium); }
        .segment:focus-visible { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
        .duration-heading { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ui-space-3); }
        .duration-value { color: var(--ic-generation-settings-label-foreground); font: var(--ui-text-body); font-variant-numeric: tabular-nums; }
        .duration-scale { --duration-thumb-size: 1.25rem; position: relative; block-size: 2rem; }
        .duration-ticks { position: absolute; inset-inline: calc(var(--duration-thumb-size) / 2); inset-block-start: 50%; block-size: 0; pointer-events: none; }
        .duration-ticks::before { content: ''; position: absolute; inset-inline: 0; inset-block-start: -0.1875rem; block-size: 0.375rem; border-radius: var(--ui-radius-pill); background: var(--ui-color-surface-subtle); }
        .duration-tick { position: absolute; inset-inline-start: var(--tick-position); inline-size: 0.3125rem; block-size: 0.3125rem; border-radius: var(--ui-radius-pill); background: var(--ui-color-border-tertiary); translate: -50% -50%; }
        .duration-slider { position: absolute; inset: 0; inline-size: 100%; block-size: 2rem; margin: 0; appearance: none; -webkit-appearance: none; background: transparent; cursor: pointer; }
        .duration-slider::-webkit-slider-runnable-track { block-size: 0.375rem; border-radius: var(--ui-radius-pill); background: transparent; }
        .duration-slider::-webkit-slider-thumb { inline-size: var(--duration-thumb-size); block-size: var(--duration-thumb-size); margin-block-start: -0.4375rem; appearance: none; -webkit-appearance: none; border: var(--ui-border-width-thin) solid var(--ui-color-border-primary); border-radius: var(--ui-radius-pill); background: var(--ui-color-surface); box-shadow: var(--ui-shadow-none); }
        .duration-slider::-moz-range-track { block-size: 0.375rem; border: 0; border-radius: var(--ui-radius-pill); background: transparent; }
        .duration-slider::-moz-range-thumb { inline-size: var(--duration-thumb-size); block-size: var(--duration-thumb-size); border: var(--ui-border-width-thin) solid var(--ui-color-border-primary); border-radius: var(--ui-radius-pill); background: var(--ui-color-surface); box-shadow: var(--ui-shadow-none); }
        .duration-slider:focus-visible { outline: none; }
        .duration-slider:focus-visible::-webkit-slider-thumb { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
        .duration-slider:focus-visible::-moz-range-thumb { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
        .duration-labels { position: relative; block-size: 1.3125rem; margin-inline: calc(1.25rem / 2); color: var(--ui-color-text-tertiary); font: var(--ui-text-body); font-variant-numeric: tabular-nums; }
        .duration-label { position: absolute; inset-inline-start: var(--label-position); translate: -50% 0; white-space: nowrap; }
        .duration-label:first-child { translate: 0 0; }
        .duration-label:last-child { translate: -100% 0; }
        .duration-label.is-current { color: var(--ic-generation-settings-selected-foreground); }
      </style>
      <button part="trigger" type="button" aria-expanded="${String(this.open)}" ${disabled ? 'disabled' : ''}>
        <span class="trigger-label">${htmlEscape(entryParts.join(' / '))}</span>
        <ic-icon class="trigger-icon" name="expand" size="small" aria-hidden="true"></ic-icon>
      </button>
      <section part="panel" aria-label="${htmlEscape(this.getAttribute('label') || '')}" popover="manual">
        ${this.getAttribute('warning') ? `<p class="warning">${htmlEscape(this.getAttribute('warning'))}</p>` : ''}
        ${hideRatio ? '' : `<div class="setting-section">
          <span class="setting-label">${htmlEscape(ratioLabel)}</span>
          <ic-aspect-ratio-picker name="generation-ratio" label="${htmlEscape(ratioLabel)}" value="${htmlEscape(this.ratio)}" presets="${htmlEscape(ratios.join(','))}" source-label="${htmlEscape(sourceLabel)}" keep-ratio-label="${htmlEscape(this.getAttribute('keep-ratio-label') || '')}" adaptive-label="${htmlEscape(this.getAttribute('adaptive-label') || '')}" hide-label data-component-variant="${htmlEscape(this.getAttribute('ratio-variant') || 'generation-settings')}" ${this.ratio ? '' : 'required'} ${singleRatio ? 'data-selection-forced' : ''} ${ratioDisabled ? 'disabled' : ''}></ic-aspect-ratio-picker>
        </div>`}
        ${hideResolution ? '' : `<div class="setting-section">
          <span class="setting-label">${htmlEscape(resolutionLabel)}</span>
          <div class="segments" style="--segment-count:${resolutions.length}" role="radiogroup" aria-label="${htmlEscape(resolutionLabel)}">
            ${resolutions.map(value => `<button class="segment" type="button" role="radio" aria-checked="${String(value === this.resolution)}" aria-pressed="${String(value === this.resolution)}" data-resolution="${htmlEscape(value)}">${htmlEscape(this.resolutionText(value))}</button>`).join('')}
          </div>
        </div>`}
        ${hideQuality ? '' : `<div class="setting-section">
          <span class="setting-label">${htmlEscape(qualityLabel)}</span>
          <div class="segments" style="--segment-count:4" role="radiogroup" aria-label="${htmlEscape(qualityLabel)}">
            ${QUALITY_VALUES.map(value => `<button class="segment" type="button" role="radio" aria-checked="${String(value === this.quality)}" aria-pressed="${String(value === this.quality)}" data-quality="${value}">${htmlEscape(qualityLabels[value])}</button>`).join('')}
          </div>
        </div>`}
        ${showDuration ? `<div class="setting-section duration-section">
          <div class="duration-heading">
            <span class="setting-label">${htmlEscape(durationLabel)}</span>
            <output class="duration-value">${htmlEscape(duration.value)}s</output>
          </div>
          <div class="duration-scale">
            <div class="duration-ticks" aria-hidden="true">
              ${duration.ticks.map(value => `<span class="duration-tick" style="--tick-position:${((value - duration.minimum) / Math.max(1, duration.maximum - duration.minimum)) * 100}%"></span>`).join('')}
            </div>
            <input class="duration-slider" type="range" min="${htmlEscape(duration.minimum)}" max="${htmlEscape(duration.maximum)}" step="${htmlEscape(duration.step)}" value="${htmlEscape(duration.value)}" aria-label="${htmlEscape(durationLabel)}" aria-valuetext="${htmlEscape(this.durationAriaText(duration.value))}" ${disabled ? 'disabled' : ''}>
          </div>
          <div class="duration-labels" aria-hidden="true">
            ${duration.labels.map(value => `<span class="duration-label ${value === duration.value ? 'is-current' : ''}" style="--label-position:${((value - duration.minimum) / Math.max(1, duration.maximum - duration.minimum)) * 100}%" data-duration-label="${htmlEscape(value)}">${htmlEscape(value)}s</span>`).join('')}
          </div>
        </div>` : ''}
      </section>`;

    this.shadowRoot.querySelector('[part="trigger"]')?.addEventListener('click', () => {
      if (!disabled && this.syncContract()) {
        if (this.open) this.hide('trigger');
        else this.show();
      }
    });
    this.shadowRoot.querySelector('ic-aspect-ratio-picker')?.addEventListener('input', event => {
      event.stopPropagation();
      const value = event.currentTarget.value;
      if (value === this.ratio) return;
      this.ratio = value;
      this.emitSetting('ratio', value);
    });
    this.shadowRoot.querySelectorAll('[data-resolution]').forEach(button => button.addEventListener('click', () => {
      const value = button.dataset.resolution;
      if (value === this.resolution) return;
      this.resolution = value;
      this.emitSetting('resolution', value);
    }));
    this.shadowRoot.querySelectorAll('[data-quality]').forEach(button => button.addEventListener('click', () => {
      const value = button.dataset.quality;
      if (value === this.quality) return;
      this.quality = value;
      this.emitSetting('quality', value);
    }));
    const durationSlider = this.shadowRoot.querySelector('.duration-slider');
    const previewDuration = () => {
      if (!durationSlider) return;
      const value = Number(durationSlider.value);
      const output = this.shadowRoot.querySelector('.duration-value');
      if (output) output.textContent = `${value}s`;
      durationSlider.setAttribute('aria-valuetext', this.durationAriaText(value));
      this.shadowRoot.querySelectorAll('[data-duration-label]').forEach(label => {
        label.classList.toggle('is-current', Number(label.dataset.durationLabel) === value);
      });
    };
    durationSlider?.addEventListener('input', previewDuration);
    durationSlider?.addEventListener('change', () => {
      const value = Number(durationSlider.value);
      if (value === Number(this.duration)) return;
      this.duration = value;
      this.emitSetting('duration', value);
    });
    this.syncOpenPresentation();
    if (this.open) queueMicrotask(() => this.positionPanel());
  }

  syncOpenPresentation() {
    const panel = this.panel;
    const trigger = this.shadowRoot.querySelector('[part="trigger"]');
    trigger?.setAttribute('aria-expanded', String(this.open));
    if (!panel) return;
    if (this.open || this.dataset.motionState === 'exiting') {
      openTopLayer(panel, 'popover');
      setOverlayInteraction(panel, this.dataset.motionState !== 'exiting');
      if (this.open) queueMicrotask(() => this.positionPanel());
    } else {
      closeTopLayer(panel);
      setOverlayInteraction(panel, true);
    }
  }

  show() {
    if (this.open && this.dataset.motionState !== 'exiting') {
      this.positionPanel();
      return;
    }
    if (!this.syncContract()) return;
    const generation = ++this._motionGeneration;
    this.dataset.motionState = 'entering';
    setOverlayInteraction(this.panel, true);
    this.dispatchEvent(new CustomEvent('ic-show', { bubbles:true, composed:true }));
    this.open = true;
    queueMicrotask(async () => {
      this.positionPanel();
      await nextOverlayPaint();
      if (generation !== this._motionGeneration || !this.open) return;
      this.dataset.motionState = 'open';
      await waitForOverlayMotion(this.panel);
      if (generation !== this._motionGeneration || !this.open) return;
      this.dispatchEvent(new CustomEvent('ic-after-show', { bubbles:true, composed:true }));
    });
  }

  hide(reason = 'programmatic') {
    if (!this.open) return;
    const generation = ++this._motionGeneration;
    this.dataset.motionState = 'exiting';
    setOverlayInteraction(this.panel, false);
    this.open = false;
    this.dispatchEvent(new CustomEvent('ic-hide', { bubbles:true, composed:true, detail:{ reason } }));
    queueMicrotask(async () => {
      await waitForOverlayMotion(this.panel);
      if (generation !== this._motionGeneration || this.open || this.dataset.motionState !== 'exiting') return;
      this.dataset.motionState = 'closed';
      this.syncOpenPresentation();
      setOverlayInteraction(this.panel, true);
      this.dispatchEvent(new CustomEvent('ic-after-hide', { bubbles:true, composed:true, detail:{ reason } }));
    });
  }
}
