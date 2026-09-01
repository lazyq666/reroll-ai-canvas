const PROJECT_ASPECT_RATIO_PRESETS = Object.freeze([
  Object.freeze({ value: 'source', label: '原图', kind: 'source' }),
  Object.freeze({ value: 'square', label: '1:1', width: 1, height: 1 }),
  Object.freeze({ value: 'portrait', label: '2:3', width: 2, height: 3 }),
  Object.freeze({ value: 'portrait43', label: '3:4', width: 3, height: 4 }),
  Object.freeze({ value: 'story', label: '9:16', width: 9, height: 16 }),
  Object.freeze({ value: 'ultratall', label: '9:21', width: 9, height: 21 }),
  Object.freeze({ value: 'landscape', label: '3:2', width: 3, height: 2 }),
  Object.freeze({ value: 'landscape43', label: '4:3', width: 4, height: 3 }),
  Object.freeze({ value: 'wide', label: '16:9', width: 16, height: 9 }),
  Object.freeze({ value: 'ultrawide', label: '21:9', width: 21, height: 9 }),
  // TODO: 自定义画幅暂不开放；恢复支持时重新启用下面的预设即可。
  // Object.freeze({ value: 'custom', label: '自定义', kind: 'custom' }),
]);

const ADDITIONAL_ASPECT_RATIO_PRESETS = Object.freeze([
  Object.freeze({ value: '1:1', label: '1:1', width: 1, height: 1 }),
  Object.freeze({ value: '2:3', label: '2:3', width: 2, height: 3 }),
  Object.freeze({ value: '3:2', label: '3:2', width: 3, height: 2 }),
  Object.freeze({ value: '3:4', label: '3:4', width: 3, height: 4 }),
  Object.freeze({ value: '4:3', label: '4:3', width: 4, height: 3 }),
  Object.freeze({ value: '9:16', label: '9:16', width: 9, height: 16 }),
  Object.freeze({ value: '16:9', label: '16:9', width: 16, height: 9 }),
  Object.freeze({ value: '21:9', label: '21:9', width: 21, height: 9 }),
  Object.freeze({ value: '9:21', label: '9:21', width: 9, height: 21 }),
  Object.freeze({ value: '5:4', label: '5:4', width: 5, height: 4 }),
  Object.freeze({ value: '4:5', label: '4:5', width: 4, height: 5 }),
  Object.freeze({ value: '2:1', label: '2:1', width: 2, height: 1 }),
  Object.freeze({ value: '1:2', label: '1:2', width: 1, height: 2 }),
  Object.freeze({ value: '3:1', label: '3:1', width: 3, height: 1 }),
  Object.freeze({ value: '1:3', label: '1:3', width: 1, height: 3 }),
  Object.freeze({ value: '1:4', label: '1:4', width: 1, height: 4 }),
  Object.freeze({ value: '4:1', label: '4:1', width: 4, height: 1 }),
  Object.freeze({ value: '1:8', label: '1:8', width: 1, height: 8 }),
  Object.freeze({ value: '8:1', label: '8:1', width: 8, height: 1 }),
  Object.freeze({ value: 'keep_ratio', label: '原图比例', kind: 'source' }),
  Object.freeze({ value: 'adaptive', label: '自适应', kind: 'source' }),
]);

const PRESET_BY_VALUE = new Map(
  [...PROJECT_ASPECT_RATIO_PRESETS, ...ADDITIONAL_ASPECT_RATIO_PRESETS]
    .map(item => [item.value, item]),
);

function normalizedShape(preset) {
  if (!preset.width || !preset.height) return { inline: 72, block: 72 };
  const scale = 100 / Math.max(preset.width, preset.height);
  return {
    inline: Math.max(16, preset.width * scale),
    block: Math.max(16, preset.height * scale),
  };
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isPositiveInteger(value) {
  return /^\d+$/.test(String(value || '')) && Number(value) >= 1;
}

export class IcAspectRatioPicker extends HTMLElement {
  static formAssociated = true;

  static get observedAttributes() {
    return [
      'value', 'name', 'label', 'presets', 'disabled', 'required',
      'size',
      'multiple', 'source-label', 'custom-label', 'keep-ratio-label', 'adaptive-label',
      'custom-ratio-width', 'custom-ratio-height',
    ];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.internals = this.attachInternals();
    this.defaultValue = '';
    this.defaultCustomRatioWidth = '';
    this.defaultCustomRatioHeight = '';
    this.hasConnected = false;
    this.suppressAttributeSync = false;
    this.customTouched = false;
    this.handleClick = this.handleClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleCustomInput = this.handleCustomInput.bind(this);
    this.handleCustomChange = this.handleCustomChange.bind(this);
  }

  connectedCallback() {
    if (!this.hasConnected) {
      this.defaultValue = this.getAttribute('value') || '';
      this.defaultCustomRatioWidth = this.customRatioWidth;
      this.defaultCustomRatioHeight = this.customRatioHeight;
      this.shadowRoot.addEventListener('click', this.handleClick);
      this.shadowRoot.addEventListener('keydown', this.handleKeydown);
      this.shadowRoot.addEventListener('input', this.handleCustomInput);
      this.shadowRoot.addEventListener('change', this.handleCustomChange);
      this.hasConnected = true;
    }
    this.sync();
  }

  attributeChangedCallback() {
    if (this.hasConnected && !this.suppressAttributeSync) this.sync();
  }

  get name() {
    return this.getAttribute('name') || '';
  }

  set name(value) {
    this.setAttribute('name', value);
  }

  get value() {
    return this.getAttribute('value') || '';
  }

  set value(value) {
    this.setAttribute('value', value);
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(value) {
    this.toggleAttribute('disabled', Boolean(value));
  }

  get required() {
    return this.hasAttribute('required');
  }

  set required(value) {
    this.toggleAttribute('required', Boolean(value));
  }

  get multiple() {
    return this.hasAttribute('multiple');
  }

  set multiple(value) {
    this.toggleAttribute('multiple', Boolean(value));
  }

  get size() {
    return this.getAttribute('size') || 'm';
  }

  set size(value) {
    this.setAttribute('size', value);
  }

  get values() {
    if (!this.multiple) return this.value ? [this.value] : [];
    return [...new Set(this.value.split(',').map(value => value.trim()).filter(Boolean))];
  }

  set values(values) {
    const normalized = [...new Set((Array.isArray(values) ? values : [values])
      .map(value => String(value || '').trim()).filter(Boolean))];
    this.value = this.multiple ? normalized.join(',') : (normalized[0] || '');
  }

  get customRatioWidth() {
    return this.getAttribute('custom-ratio-width') || '';
  }

  set customRatioWidth(value) {
    if (value === '' || value === null || value === undefined) this.removeAttribute('custom-ratio-width');
    else this.setAttribute('custom-ratio-width', String(value));
  }

  get customRatioHeight() {
    return this.getAttribute('custom-ratio-height') || '';
  }

  set customRatioHeight(value) {
    if (value === '' || value === null || value === undefined) this.removeAttribute('custom-ratio-height');
    else this.setAttribute('custom-ratio-height', String(value));
  }

  get customRatio() {
    return isPositiveInteger(this.customRatioWidth) && isPositiveInteger(this.customRatioHeight)
      ? `${Number(this.customRatioWidth)}:${Number(this.customRatioHeight)}`
      : '';
  }

  get options() {
    const requested = (this.getAttribute('presets') || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    const values = requested.length ? requested : PROJECT_ASPECT_RATIO_PRESETS.map(item => item.value);
    return values.map(value => PRESET_BY_VALUE.get(value)).filter(Boolean);
  }

  formResetCallback() {
    this.suppressAttributeSync = true;
    this.customRatioWidth = this.defaultCustomRatioWidth;
    this.customRatioHeight = this.defaultCustomRatioHeight;
    this.suppressAttributeSync = false;
    this.customTouched = false;
    this.value = this.defaultValue;
  }

  formDisabledCallback(disabled) {
    this.toggleAttribute('disabled', disabled);
  }

  checkValidity() {
    return this.internals.checkValidity();
  }

  reportValidity() {
    this.customTouched = true;
    this.updateCustomEditorState();
    return this.internals.reportValidity();
  }

  sync() {
    const options = this.options;
    if (this.multiple) {
      const optionValues = new Set(options.map(item => item.value));
      const requested = this.values.filter(value => optionValues.has(value));
      const selected = requested;
      const serialized = selected.join(',');
      if (serialized !== this.value) this.setAttribute('value', serialized);
      this.render(options, selected);
      this.syncFormState(selected);
      return;
    }
    const requestedValue = this.value || (!this.required ? this.defaultValue || 'square' : '');
    const selected = options.some(item => item.value === requestedValue)
      ? requestedValue
      : (this.required ? '' : options[0]?.value || '');
    if (selected && selected !== this.value) this.setAttribute('value', selected);
    this.render(options, selected);
    this.syncFormState(selected);
  }

  syncFormState(selected = this.value) {
    const isEnglish = (this.closest('[lang]')?.lang || document.documentElement.lang || '').toLowerCase().startsWith('en');
    const selectedValues = Array.isArray(selected) ? selected : [selected].filter(Boolean);
    const customSelected = selectedValues.includes('custom');
    const customInvalid = customSelected && !this.customRatio;
    if (this.multiple && this.name) {
      const values = new FormData();
      selectedValues.forEach(value => values.append(this.name, value));
      if (customSelected && this.customRatio) values.append(`${this.name}-custom-ratio`, this.customRatio);
      this.internals.setFormValue(values);
    } else if (selected === 'custom' && this.name) {
      const values = new FormData();
      values.append(this.name, 'custom');
      if (this.customRatio) values.append(`${this.name}-custom-ratio`, this.customRatio);
      this.internals.setFormValue(values);
    } else {
      this.internals.setFormValue(this.multiple ? null : selected);
    }
    const anchor = customInvalid ? this.shadowRoot.querySelector('[data-custom-axis="width"]') : undefined;
    if (customInvalid) {
      this.internals.setValidity(
        { customError: true },
        isEnglish ? 'Enter a valid custom aspect ratio' : '请输入有效的自定义宽高比',
        anchor,
      );
    } else if (this.required && !selectedValues.length) {
      this.internals.setValidity(
        { valueMissing: true },
        isEnglish ? 'Choose an aspect ratio' : '请选择画幅',
      );
    } else {
      this.internals.setValidity({});
    }
    this.updateCustomEditorState();
  }

  localizedLabel(preset) {
    const isEnglish = (this.closest('[lang]')?.lang || document.documentElement.lang || '').toLowerCase().startsWith('en');
    if (preset.value === 'source') return this.getAttribute('source-label') || (isEnglish ? 'Original' : '原图');
    if (preset.value === 'keep_ratio') return this.getAttribute('keep-ratio-label') || (isEnglish ? 'Keep' : '原图比例');
    if (preset.value === 'adaptive') return this.getAttribute('adaptive-label') || (isEnglish ? 'Adaptive' : '自适应');
    if (preset.value === 'custom') return this.getAttribute('custom-label') || (isEnglish ? 'Custom' : '自定义');
    return preset.label;
  }

  render(options, selected) {
    const isEnglish = (this.closest('[lang]')?.lang || document.documentElement.lang || '').toLowerCase().startsWith('en');
    const label = this.getAttribute('label') || (isEnglish ? 'Aspect ratio' : '画幅');
    const selectedValues = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
    const focusedValue = [...selectedValues][0] || options[0]?.value || '';
    const optionRole = this.multiple ? 'role="checkbox"' : 'role="radio"';
    const generationVariant = this.getAttribute('data-component-variant') === 'generation-settings';
    const optionMarkup = preset => {
      const shape = normalizedShape(preset);
      const optionLabel = this.localizedLabel(preset);
      return `<button type="button" ${optionRole} aria-checked="${selectedValues.has(preset.value)}" data-value="${htmlEscape(preset.value)}" tabindex="${preset.value === focusedValue ? '0' : '-1'}" ${this.disabled ? 'disabled' : ''} aria-label="${htmlEscape(optionLabel)}">
        <span class="glyph" aria-hidden="true"><span class="shape" data-kind="${htmlEscape(preset.kind || 'ratio')}" style="--ratio-inline:${shape.inline}%;--ratio-block:${shape.block}%"></span></span>
        <span class="text">${htmlEscape(optionLabel)}</span>
      </button>`;
    };
    const sourceOption = generationVariant ? options.find(preset => preset.value === 'source') : null;
    const ratioOptions = sourceOption ? options.filter(preset => preset !== sourceOption) : options;
    this.shadowRoot.innerHTML = `
      <style>
        :host { --ic-aspect-ratio-option-inline:var(--ui-control-height-l); --ic-aspect-ratio-option-block:calc(var(--ui-control-height-l) + var(--ui-space-4)); --ic-aspect-ratio-glyph-size:var(--ui-icon-size-l); --ic-aspect-ratio-option-padding:var(--ui-space-2); --ic-aspect-ratio-option-font:var(--ui-text-body-compact); min-inline-size: 0; display: block; color: var(--ui-color-text-primary); font-family: var(--ui-font-sans); }
        :host([size="s"]), :host([size="small"]) { --ic-aspect-ratio-option-inline:var(--ui-control-height-m); --ic-aspect-ratio-option-block:calc(var(--ui-control-height-m) + var(--ui-space-3)); --ic-aspect-ratio-glyph-size:var(--ui-icon-size-m); --ic-aspect-ratio-option-padding:var(--ui-space-1); --ic-aspect-ratio-option-font:var(--ui-text-caption); }
        :host([size="l"]), :host([size="large"]) { --ic-aspect-ratio-option-inline:calc(var(--ui-control-height-l) + var(--ui-space-2)); --ic-aspect-ratio-option-block:calc(var(--ui-control-height-l) + var(--ui-space-6)); --ic-aspect-ratio-glyph-size:calc(var(--ui-icon-size-l) + var(--ui-space-2)); --ic-aspect-ratio-option-padding:var(--ui-space-3); --ic-aspect-ratio-option-font:var(--ui-text-body); }
        :host([hidden]) { display: none; }
        :host([data-component-variant="multiple"]) { --ic-aspect-ratio-options-background: var(--ui-color-action-tertiary); --ic-aspect-ratio-selected-background: var(--ui-color-surface-subtle); --ic-aspect-ratio-selected-border-color: transparent; --ic-aspect-ratio-selected-shadow: none; }
        :host([data-component-variant="toolbar"]) { inline-size: max-content; max-inline-size: 100%; display: inline-flex; }
        fieldset { min-inline-size: 0; margin: var(--ui-space-0); padding: var(--ui-space-0); border: var(--ui-border-width-none); }
        legend { margin-block-end: var(--ui-space-2); padding: var(--ui-space-0); color: var(--ui-color-text-tertiary); font: var(--ui-text-label); }
        :host([hide-label]) legend { display: none; }
        .options { display: flex; flex-wrap: wrap; align-items: stretch; gap: var(--ui-space-1); padding: var(--ui-space-1); border-radius: var(--ui-radius-s); background: var(--ic-aspect-ratio-options-background, var(--ui-color-surface-subtle)); }
        .ratio-options { display: contents; }
        button { min-inline-size: var(--ic-aspect-ratio-option-inline); min-block-size: var(--ic-aspect-ratio-option-block); display: grid; grid-template-rows: var(--ic-aspect-ratio-glyph-size) auto; place-items: center; align-content: center; gap: var(--ui-space-1); padding: var(--ic-aspect-ratio-option-padding); border: var(--ui-border-width-thin) solid transparent; border-radius: var(--ui-radius-xs); color: var(--ui-color-text-tertiary); background: var(--ui-color-action-tertiary); font: var(--ic-aspect-ratio-option-font); cursor: pointer; transition: color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard), background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard), border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
        button:hover { color: var(--ui-color-text-primary); background: var(--ui-color-action-tertiary-hover); }
        button[aria-checked="true"] { border-radius: var(--ui-radius-s); color: var(--ic-aspect-ratio-selected-foreground, var(--ui-color-text-primary)); border-color: var(--ic-aspect-ratio-selected-border-color, var(--ui-color-border-primary)); background: var(--ic-aspect-ratio-selected-background, var(--ui-color-action-secondary)); box-shadow: var(--ic-aspect-ratio-selected-shadow, var(--ui-shadow-raised)); }
        :host([data-component-variant="multiple"]) button:hover { background: var(--ui-color-surface-subtle); }
        button:focus-visible { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
        button:disabled { color: var(--ui-color-text-disabled); background: var(--ui-color-action-tertiary-disabled); border-color: var(--ui-color-border-disabled); opacity: 1; cursor: not-allowed; }
        .glyph { inline-size: var(--ic-aspect-ratio-glyph-size); block-size: var(--ic-aspect-ratio-glyph-size); display: grid; place-items: center; }
        .shape { inline-size: var(--ratio-inline); block-size: var(--ratio-block); box-sizing: border-box; border: calc(var(--ui-icon-stroke-width-m) * 1px) solid currentColor; border-radius: var(--ui-radius-xs); }
        .shape[data-kind="custom"] { border-style: dashed; }
        .shape[data-kind="source"] { position: relative; }
        .shape[data-kind="source"]::after { position: absolute; inset: var(--ui-space-1); border: var(--ui-border-width-thin) solid currentColor; border-radius: var(--ui-radius-xs); content: ""; }
        .text { white-space: nowrap; }
        :host([data-component-variant="toolbar"]) fieldset { inline-size: max-content; }
        :host([data-component-variant="toolbar"]) .options { inline-size: max-content; flex-wrap: nowrap; align-items: center; gap: var(--ui-space-1); padding: 0; border-radius: 0; background: transparent; }
        :host([data-component-variant="toolbar"]) button { min-inline-size: auto; min-block-size: var(--ui-control-height-s); block-size: var(--ui-control-height-s); display: inline-flex; grid-template-rows: none; gap: 0; padding: 0 var(--ui-space-2); border-radius: var(--ui-radius-s); font: var(--ui-text-label); }
        :host([data-component-variant="toolbar"]) button[aria-checked="true"] { border-color: var(--ui-color-border-primary); background: var(--ui-color-action-secondary); }
        :host([data-component-variant="toolbar"]) .glyph { display: none; }
        .custom-editor { display: grid; gap: var(--ui-space-2); margin-block-start: var(--ui-space-2); padding: var(--ui-space-3); border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius: var(--ui-radius-s); background: var(--ui-color-surface); }
        .custom-editor-header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--ui-space-1) var(--ui-space-3); }
        .custom-editor-header strong { font: var(--ui-text-label); }
        .custom-editor-header span, .custom-help { color: var(--ui-color-text-tertiary); font: var(--ui-text-body-compact); }
        .custom-input-row { display: flex; flex-wrap: wrap; align-items: end; gap: var(--ui-space-2); }
        .custom-input-row label { display: grid; gap: var(--ui-space-1); color: var(--ui-color-text-tertiary); font: var(--ui-text-caption); }
        .custom-input-row input { inline-size: calc(var(--ui-control-height-l) + var(--ui-space-8)); block-size: var(--ui-control-height-m); box-sizing: border-box; padding-inline: var(--ui-space-2); border: var(--ui-border-width-thin) solid var(--ui-color-border-primary); border-radius: var(--ui-radius-s); color: var(--ui-color-text-primary); background: var(--ui-color-surface); font: var(--ui-text-body); }
        .custom-input-row input:focus-visible { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
        .custom-input-row input[aria-invalid="true"] { border-color: var(--ui-color-border-danger); }
        .custom-colon { min-block-size: var(--ui-control-height-m); display: grid; place-items: center; color: var(--ui-color-text-tertiary); font: var(--ui-text-title-3); }
        .custom-ratio-preview { min-block-size: var(--ui-control-height-m); display: inline-flex; align-items: center; color: var(--ui-color-text-tertiary); font: var(--ui-text-code); }
        .custom-editor[data-invalid="true"] .custom-help { color: var(--ui-color-text-danger); }
        :host([data-component-variant="generation-settings"]) .options { display: flex; flex-wrap: nowrap; align-items: stretch; gap: var(--ui-space-2); padding: var(--ui-space-2); }
        :host([data-component-variant="generation-settings"]) .source-option { flex: 0 0 3.25rem; min-inline-size: 3.25rem; display: flex; }
        :host([data-component-variant="generation-settings"]) .source-option button { inline-size: 100%; min-inline-size: 0; min-block-size: 100%; grid-template-rows: var(--ui-icon-size-l) auto; }
        :host([data-component-variant="generation-settings"]) .ratio-options { min-inline-size: 0; flex: 1 1 auto; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--ui-space-1); }
        :host([data-component-variant="generation-settings"]) .ratio-options button { min-inline-size: 0; min-block-size: 3.25rem; grid-template-rows: var(--ui-icon-size-s) auto; gap: var(--ui-space-1); padding: var(--ui-space-1); }
        :host([data-component-variant="generation-settings"]) .ratio-options .glyph { inline-size: var(--ui-icon-size-s); block-size: var(--ui-icon-size-s); }
        :host([data-component-variant="generation-settings"]) button { font: var(--ui-text-body-compact); }
        :host([data-component-variant="outpaint"]) .options { display: block; padding: var(--ui-space-2); border-radius: var(--ui-radius-m); }
        :host([data-component-variant="outpaint"]) .ratio-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--ui-space-1); }
        :host([data-component-variant="outpaint"]) .ratio-options button { min-inline-size: 0; min-block-size: 3.25rem; grid-template-rows: var(--ui-icon-size-s) auto; gap: var(--ui-space-1); padding: var(--ui-space-1); }
        :host([data-component-variant="outpaint"]) .ratio-options .glyph { inline-size: var(--ui-icon-size-s); block-size: var(--ui-icon-size-s); }
        :host([data-component-variant="outpaint"]) button { font: var(--ui-text-body-compact); }
      </style>
      <fieldset ${this.disabled ? 'disabled' : ''}>
        <legend>${htmlEscape(label)}</legend>
        <div class="options">
          ${sourceOption ? `<div class="source-option">${optionMarkup(sourceOption)}</div>` : ''}<div class="ratio-options">${ratioOptions.map(optionMarkup).join('')}</div>
        </div>
        ${selectedValues.has('custom') ? `
          <div class="custom-editor" role="group" aria-label="${isEnglish ? 'Custom aspect ratio' : '自定义宽高比'}">
            <div class="custom-editor-header">
              <strong>${isEnglish ? 'Custom aspect ratio' : '自定义宽高比'}</strong>
              <span>${isEnglish ? 'Ratio, not pixel resolution' : '输入比例，不是像素分辨率'}</span>
            </div>
            <div class="custom-input-row">
              <label><span>${isEnglish ? 'Width' : '宽'}</span><input type="number" inputmode="numeric" min="1" step="1" value="${htmlEscape(this.customRatioWidth)}" data-custom-axis="width" aria-describedby="ic-custom-ratio-help"></label>
              <span class="custom-colon" aria-hidden="true">:</span>
              <label><span>${isEnglish ? 'Height' : '高'}</span><input type="number" inputmode="numeric" min="1" step="1" value="${htmlEscape(this.customRatioHeight)}" data-custom-axis="height" aria-describedby="ic-custom-ratio-help"></label>
              <output class="custom-ratio-preview" aria-live="polite"></output>
            </div>
            <span class="custom-help" id="ic-custom-ratio-help">${isEnglish ? 'Use positive integers, for example 4:5.' : '请输入正整数，例如 4:5。分辨率请在独立的尺寸控件中设置。'}</span>
          </div>` : ''}
      </fieldset>`;
  }

  select(value, { focus = false, emit = true } = {}) {
    if (this.disabled || !this.options.some(item => item.value === value)) return;
    if (this.multiple) {
      const selected = new Set(this.values);
      const wasSelected = selected.has(value);
      if (wasSelected) selected.delete(value);
      else selected.add(value);
      if (!wasSelected && value === 'custom') this.customTouched = false;
      const previousValue = this.value;
      this.values = [...selected];
      const button = [...this.shadowRoot.querySelectorAll('button[data-value]')]
        .find(item => item.dataset.value === value);
      if (focus) button?.focus();
      if (this.value !== previousValue && emit) {
        this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
      return;
    }
    const changed = value !== this.value;
    if (changed && value === 'custom') this.customTouched = false;
    this.value = value;
    const button = [...this.shadowRoot.querySelectorAll('button[data-value]')]
      .find(item => item.dataset.value === value);
    if (focus) button?.focus();
    if (changed && emit) {
      this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
  }

  handleClick(event) {
    const button = event.target.closest('button[data-value]');
    if (button) this.select(button.dataset.value, { focus: true });
  }

  setCustomRatioAttribute(axis, value) {
    this.suppressAttributeSync = true;
    if (axis === 'width') this.customRatioWidth = value;
    else this.customRatioHeight = value;
    this.suppressAttributeSync = false;
  }

  handleCustomInput(event) {
    const input = event.target.closest('input[data-custom-axis]');
    if (!input) return;
    event.stopPropagation();
    this.customTouched = true;
    this.setCustomRatioAttribute(input.dataset.customAxis, input.value);
    this.syncFormState(this.multiple ? this.values : 'custom');
    this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  }

  handleCustomChange(event) {
    const input = event.target.closest('input[data-custom-axis]');
    if (!input) return;
    event.stopPropagation();
    this.customTouched = true;
    this.updateCustomEditorState();
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  updateCustomEditorState() {
    const editor = this.shadowRoot.querySelector('.custom-editor');
    if (!editor) return;
    const invalid = !this.customRatio;
    editor.dataset.invalid = String(this.customTouched && invalid);
    for (const input of editor.querySelectorAll('input[data-custom-axis]')) {
      input.setAttribute('aria-invalid', String(this.customTouched && invalid));
    }
    const preview = editor.querySelector('.custom-ratio-preview');
    if (preview) preview.value = this.customRatio || '—';
  }

  handleKeydown(event) {
    const button = event.target.closest('button[data-value]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = this.options;
    const current = Math.max(0, options.findIndex(item => item.value === button.dataset.value));
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (current + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
    if (this.multiple) {
      const nextButton = [...this.shadowRoot.querySelectorAll('button[data-value]')]
        .find(item => item.dataset.value === options[next].value);
      nextButton?.focus();
      return;
    }
    this.select(options[next].value, { focus: true });
  }
}

export { PROJECT_ASPECT_RATIO_PRESETS };
