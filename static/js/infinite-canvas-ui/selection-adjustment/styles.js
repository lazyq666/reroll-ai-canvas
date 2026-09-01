const STYLE_MARKER = 'ic-selection-adjustment-v3';


export function ensureSelectionAdjustmentStyles() {
  if (document.querySelector(`style[data-ic-selection-adjustment="${STYLE_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icSelectionAdjustment = STYLE_MARKER;
  stylesheet.textContent = `
    :is(ic-number-input, ic-color-field):is([size="s"], [size="small"]) {
      --wa-form-control-height: var(--ui-control-height-s);
      --wa-form-control-value-font-size: var(--ui-font-size-2);
    }

    :is(ic-number-input, ic-color-field):is([size="m"], [size="medium"]) {
      --wa-form-control-height: var(--ui-control-height-s);
      --wa-form-control-value-font-size: var(--ui-font-size-3);
    }

    :is(ic-number-input, ic-color-field):is([size="l"], [size="large"]) {
      --wa-form-control-height: var(--ui-control-height-l);
      --wa-form-control-value-font-size: var(--ui-font-size-4);
    }

    ic-checkbox::part(control),
    ic-radio::part(control),
    ic-switch::part(control),
    ic-slider::part(thumb),
    ic-slider::part(track) {
      border-color: var(--ui-color-border-primary);
      transition:
        color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-checkbox,
    ic-switch {
      --wa-form-control-activated-color: var(--ui-color-action-primary);
      --wa-form-control-padding-inline: var(--ui-space-3);
    }

    ic-switch[aria-labelledby]::part(label) {
      display: none;
      margin-inline-start: 0;
    }

    ic-radio {
      --wa-form-control-activated-color: var(--ui-color-action-primary);
      --wa-form-control-padding-inline: var(--ui-space-3);
    }

    ic-select {
      --wa-form-control-padding-inline: var(--ui-space-3);
    }

    ic-checkbox:state(checked)::part(control),
    ic-checkbox:state(indeterminate)::part(control),
    ic-switch:state(checked)::part(control) {
      color: var(--ui-color-text-on-action-primary);
      background-color: var(--ui-color-action-primary);
      border-color: var(--ui-color-action-primary);
    }

    ic-checkbox::part(icon) {
      visibility: visible;
      opacity: 0;
      scale: .4;
      transition:
        opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        scale var(--ui-motion-duration-release) var(--ui-motion-ease-spring);
    }

    ic-checkbox:is(:state(checked), :state(indeterminate))::part(icon) {
      opacity: 1;
      scale: .8;
    }

    ic-radio::part(checked-icon) {
      display: none;
    }

    ic-radio::part(control)::after {
      content: '';
      inline-size: 70%;
      block-size: 70%;
      border-radius: 50%;
      background: currentColor;
      opacity: 0;
      scale: .4;
      transition:
        opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        scale var(--ui-motion-duration-release) var(--ui-motion-ease-spring);
    }

    ic-radio:state(checked)::part(control)::after {
      opacity: 1;
      scale: .7;
    }

    :is(ic-checkbox, ic-radio):not([disabled]):not([data-ic-contract-status="invalid"])::part(control) {
      scale: 1;
      transition:
        color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        scale var(--ui-motion-duration-release) var(--ui-motion-ease-spring);
    }

    :is(ic-checkbox, ic-radio):not([disabled]):not([data-ic-contract-status="invalid"]):active::part(control) {
      scale: .88;
      transition-duration: var(--ui-motion-duration-press);
      transition-timing-function: var(--ui-motion-ease-press);
    }

    ic-switch:not([disabled]):not([data-ic-contract-status="invalid"])::part(thumb) {
      scale: 1;
      transition:
        translate var(--ui-motion-duration-release) var(--ui-motion-ease-spring),
        scale var(--ui-motion-duration-release) var(--ui-motion-ease-spring),
        background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-switch:not([disabled]):not([data-ic-contract-status="invalid"]):active::part(thumb) {
      scale: 1.25 .86;
      transition-duration: var(--ui-motion-duration-press);
      transition-timing-function: var(--ui-motion-ease-press);
    }

    ic-slider:not([disabled]):not([data-ic-contract-status="invalid"])::part(thumb) {
      scale: 1;
      transition:
        background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        scale var(--ui-motion-duration-release) var(--ui-motion-ease-spring);
    }

    ic-slider:not([disabled]):not([data-ic-contract-status="invalid"]):active::part(thumb) {
      scale: .88;
      transition-duration: var(--ui-motion-duration-press);
      transition-timing-function: var(--ui-motion-ease-press);
    }

    ic-radio-group[appearance="tabs"]::part(form-control-label) {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    ic-radio-group[appearance="tabs"]::part(form-control-input) {
      display: flex;
      flex-flow: row nowrap;
      gap: var(--ui-space-2);
      padding: var(--ui-focus-ring-width);
      overflow-x: auto;
    }

    ic-radio-group[appearance="tabs"] > ic-radio {
      box-sizing: border-box;
      min-block-size: var(--ui-density-control-height);
      margin: 0;
      padding-block: 0;
      padding-inline: var(--ui-density-inline-padding);
      align-items: center;
      border: 0;
      border-radius: var(--ui-radius-s);
      background: var(--ui-color-action-tertiary);
      color: var(--ui-color-text-tertiary);
      font-size: var(--ui-density-font-size);
      white-space: nowrap;
    }

    ic-radio-group[appearance="tabs"] > ic-radio::part(control) {
      display: none;
    }

    ic-radio-group[appearance="tabs"] > ic-radio:hover {
      background: var(--ui-color-action-tertiary-hover);
      color: var(--ui-color-text-primary);
    }

    ic-radio-group[appearance="tabs"] > ic-radio:state(checked) {
      background: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
      font-weight: var(--ui-font-weight-medium);
    }

    ic-radio-group[appearance="tabs"] > ic-radio:focus-visible {
      position: relative;
      z-index: 1;
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
      box-shadow: var(--ui-focus-ring-shadow);
    }

    ic-checkbox[appearance="checkmark-end"] {
      display: block;
    }

    ic-checkbox[appearance="checkmark-end"]::part(base) {
      box-sizing: border-box;
      inline-size: 100%;
      min-block-size: var(--ui-density-control-height);
      align-items: center;
      justify-content: space-between;
      gap: var(--ui-space-2);
      padding-inline: var(--ui-space-2);
      border: var(--ui-border-width-thin) solid transparent;
      border-radius: var(--ui-radius-xs);
      background: var(--ui-color-action-tertiary);
      color: var(--ui-color-text-tertiary);
    }

    ic-checkbox[appearance="checkmark-end"] [data-ic-owned-label] {
      display: flex;
      flex: 1 1 auto;
      min-inline-size: 0;
      align-items: center;
      gap: var(--ui-space-2);
    }

    ic-checkbox[appearance="checkmark-end"] [data-ic-checkbox-icon] {
      color: currentColor;
    }

    ic-checkbox[appearance="checkmark-end"] [data-ic-checkbox-content] {
      display: grid;
      flex: 1 1 auto;
      min-inline-size: 0;
      gap: var(--ui-space-0);
    }

    ic-checkbox[appearance="checkmark-end"] [data-ic-checkbox-title] {
      color: currentColor;
      font-weight: var(--ui-font-weight-medium);
      line-height: var(--ui-line-height-tight);
    }

    ic-checkbox[appearance="checkmark-end"] [data-ic-checkbox-tag] {
      flex: 0 0 auto;
      padding: var(--ui-space-0) var(--ui-space-1);
      border: var(--ui-border-width-thin) solid currentColor;
      border-radius: var(--ui-radius-pill);
      color: currentColor;
      font-size: var(--ui-font-size-1);
      font-weight: var(--ui-font-weight-medium);
      line-height: var(--ui-line-height-tight);
    }

    ic-checkbox[appearance="checkmark-end"]::part(label) {
      display: flex;
      flex: 1 1 auto;
      min-inline-size: 0;
      align-items: center;
      gap: var(--ui-space-2);
      order: 1;
    }

    ic-checkbox[appearance="checkmark-end"]::part(control) {
      order: 2;
      inline-size: var(--ui-density-icon-size);
      block-size: var(--ui-density-icon-size);
      margin-inline-end: 0;
      border: 0;
      border-radius: 0;
      background-color: var(--ui-color-action-tertiary);
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 12 4 4L19 6' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 12 4 4L19 6' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
      opacity: 0;
      scale: .4;
    }

    ic-checkbox[appearance="checkmark-end"]::part(check-icon),
    ic-checkbox[appearance="checkmark-end"]::part(indeterminate-icon) {
      display: none;
    }

    ic-checkbox[appearance="checkmark-end"]:not([disabled]):hover::part(base) {
      background: var(--ui-color-action-tertiary-hover);
      color: var(--ui-color-text-tertiary);
    }

    ic-checkbox[appearance="checkmark-end"][data-component-variant="list"] {
      --ic-checkbox-checkmark-end-selected-background: var(--ui-color-action-secondary-selected);
      --ic-checkbox-checkmark-end-selected-border-color: transparent;
      display: inline-block;
      inline-size: fit-content;
      max-inline-size: 100%;
    }

    ic-checkbox[appearance="checkmark-end"][data-component-variant="list"]::part(base) {
      inline-size: auto;
      max-inline-size: 100%;
    }

    ic-checkbox[appearance="checkmark-end"][data-component-variant="list"] [data-ic-checkbox-title] {
      text-align: start;
    }

    ic-checkbox[appearance="checkmark-end"]:state(checked)::part(base) {
      border-color: var(--ic-checkbox-checkmark-end-selected-border-color, var(--ui-color-border-secondary));
      background: var(--ic-checkbox-checkmark-end-selected-background, var(--ui-color-surface));
      color: var(--ui-color-text-primary);
      font-weight: var(--ui-font-weight-medium);
    }

    ic-checkbox[appearance="checkmark-end"]:state(checked)::part(control),
    ic-checkbox[appearance="checkmark-end"]:state(indeterminate)::part(control) {
      border: 0;
      color: var(--ui-color-text-primary);
      background-color: currentColor;
      opacity: 1;
      scale: 1;
    }

    ic-checkbox[appearance="checkmark-end"]:state(indeterminate)::part(control) {
      -webkit-mask-image: none;
      mask-image: none;
      background: currentColor;
      clip-path: inset(calc(50% - 1px) 18%);
    }

    ic-checkbox[appearance="checkmark-end"]:focus-visible::part(base) {
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
      box-shadow: var(--ui-focus-ring-shadow);
    }

    ic-select::part(combobox),
    ic-number-input::part(base) {
      color: var(--ui-color-text-primary);
    }

    ic-select::part(combobox),
    ic-number-input::part(base),
    ic-color-field::part(trigger) {
      background-color: var(--ui-color-surface);
      border-radius: var(--ui-radius-s);
      transition:
        border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-select::part(combobox) {
      border-color: var(--ui-color-border-secondary);
    }

    ic-number-input::part(base),
    ic-color-field::part(trigger) {
      border-color: var(--ui-color-border-primary);
    }

    ic-select {
      --wa-form-control-height: var(--ui-control-height-m);
      --wa-form-control-padding-inline: var(--ui-space-3);
      --wa-form-control-value-font-size: var(--ui-font-size-3);
      --wa-form-control-activated-color: var(--ui-color-action-primary);
    }

    ic-select wa-option {
      --current-text-color: var(--ui-color-text-on-action-primary);
    }

    ic-select wa-option::part(label) {
      text-align: start;
    }

    ic-select[data-component-variant="secondary"] {
      --wa-form-control-activated-color: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="secondary"]::part(combobox) {
      border-width: var(--ui-border-width-none);
      background: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="secondary"]::part(display-input) {
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="secondary"] wa-option {
      --current-text-color: var(--ui-color-text-primary);
      border-width: var(--ui-border-width-none);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="secondary"] wa-option[aria-selected="true"],
    ic-select[data-component-variant="secondary"] wa-option:state(selected),
    ic-select[data-component-variant="secondary"] wa-option:state(current) {
      --current-text-color: var(--ui-color-text-primary);
      border-width: var(--ui-border-width-none);
      background: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
    }

    ic-select::part(combobox),
    ic-select::part(display-input) {
      font-size: var(--ui-font-size-3);
    }

    ic-select[size="s"],
    ic-select[size="small"] {
      --wa-form-control-height: var(--ui-control-height-s);
      --wa-form-control-padding-inline: var(--ui-space-2);
      --wa-form-control-value-font-size: var(--ui-font-size-2);
    }

    ic-select[size="s"]::part(combobox),
    ic-select[size="s"]::part(display-input),
    ic-select[size="small"]::part(combobox),
    ic-select[size="small"]::part(display-input) {
      --wa-form-control-value-font-size: var(--ui-font-size-2);
      font-size: var(--ui-font-size-2);
    }

    ic-select:is([size="l"], [size="large"]) {
      --wa-form-control-height: var(--ui-control-height-l);
      --wa-form-control-padding-inline: var(--ui-space-4);
      --wa-form-control-value-font-size: var(--ui-font-size-4);
    }

    ic-select:is([size="l"], [size="large"])::part(combobox),
    ic-select:is([size="l"], [size="large"])::part(display-input) {
      --wa-form-control-value-font-size: var(--ui-font-size-4);
      font-size: var(--ui-font-size-4);
    }

    ic-select[hierarchy="quiet"] {
      --wa-form-control-height: 1lh;
      --wa-form-control-padding-inline: 0;
      --wa-form-control-border-width: 0;
      display: inline-flex;
      inline-size: fit-content;
    }

    ic-select[hierarchy="quiet"]::part(combobox) {
      min-height: 1lh;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: var(--ui-color-action-tertiary);
    }

    ic-select[hierarchy="quiet"]::part(display-input) {
      inline-size: auto;
      min-inline-size: 0;
      field-sizing: content;
    }

    ic-select[hierarchy="quiet"]::part(listbox) {
      min-inline-size: 10rem;
    }

    ic-select[hierarchy="quiet"] wa-option::part(label) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    ic-select[hierarchy="quiet"]::part(expand-icon) {
      margin-inline-start: var(--ui-space-1);
    }

    ic-select[data-component-variant="model-picker"] {
      --wa-form-control-height: var(--ui-control-height-m);
      --wa-form-control-padding-inline: var(--ui-space-2);
      --wa-form-control-value-font-size: var(--ui-font-size-2);
      --wa-form-control-activated-color: var(--ui-color-action-secondary-selected);
      inline-size: fit-content;
      max-inline-size: 100%;
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="model-picker"]::part(combobox) {
      box-sizing: border-box;
      block-size: 2rem;
      min-block-size: 2rem;
      padding-inline: var(--ui-space-2);
      border-radius: var(--ui-radius-pill);
      border-color: transparent;
      background: var(--ui-color-action-tertiary);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="model-picker"]:not([disabled])::part(combobox):hover {
      background: var(--ui-color-action-tertiary-hover);
    }

    ic-select[data-component-variant="model-picker"]::part(display-input) {
      min-inline-size: 0;
      color: var(--ui-color-text-primary);
      font: var(--ui-text-body-compact);
      text-overflow: ellipsis;
    }

    ic-select[data-component-variant="model-picker"]::part(listbox) {
      box-sizing: border-box;
      inline-size: 15rem;
      max-block-size: 20rem;
      padding: var(--ui-space-1);
      overflow-y: auto;
      background: var(--ui-color-surface);
    }

    ic-select[data-component-variant="model-picker"] wa-option {
      --current-text-color: var(--ui-color-text-primary);
      box-sizing: border-box;
      block-size: 2rem;
      min-block-size: 2rem;
      padding: 0 var(--ui-space-2);
      border-radius: var(--ui-radius-s);
      color: var(--ui-color-text-tertiary);
      font: var(--ui-text-body-compact);
    }

    ic-select[data-component-variant="model-picker"] wa-option:hover {
      background: var(--ui-color-action-tertiary-hover);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="model-picker"] wa-option[aria-selected="true"] {
      background: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="model-picker"] wa-option:state(current) {
      background: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="model-picker"] wa-option::part(checked-icon) {
      display: none;
    }

    ic-select[data-component-variant="model-picker"] wa-option::part(label) {
      min-inline-size: 0;
      overflow: hidden;
      color: inherit;
      font: var(--ui-text-body-compact);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    ic-select[data-component-variant="model-picker"] [data-ic-select-option-start-icon],
    ic-select[data-component-variant="model-picker"] > [slot="start"] {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1rem;
      min-inline-size: 1rem;
      block-size: 1rem;
      margin-inline-start: 0.5rem;
      margin-inline-end: 10px;
      overflow: hidden;
      border-radius: var(--ui-radius-xs);
    }

    ic-select[data-component-variant="model-picker"] > ic-icon[slot="expand-icon"] {
      --ic-icon-size: var(--ui-icon-size-s);
      --ic-icon-stroke-width: var(--ui-icon-stroke-width-s);
    }

    ic-select[data-component-variant="model-picker"] [data-ic-select-option-start-icon] img,
    ic-select[data-component-variant="model-picker"] > [slot="start"] img {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      object-fit: contain;
    }

    ic-select[data-component-variant="model-picker"] > [slot="start"] > .model-vendor-icon {
      inline-size: 1rem;
      min-inline-size: 1rem;
      block-size: 1rem;
      flex: 0 0 1rem;
    }

    ic-select[data-component-variant="model-picker"] > [slot="start"] > .model-vendor-icon :is(img, svg) {
      inline-size: 1rem !important;
      block-size: 1rem !important;
      object-fit: contain;
    }

    ic-select[data-component-variant="model-picker"] [data-ic-select-option-start-icon][data-brand-mark] img {
      inline-size: auto;
      max-inline-size: none;
      object-fit: fill;
    }

    ic-select[data-component-variant="model-picker"]:is([size="s"], [size="small"]) {
      --wa-form-control-height: var(--ui-control-height-xs);
      --wa-form-control-value-font-size: var(--ui-font-size-1);
    }

    ic-select[data-component-variant="model-picker"]:is([size="s"], [size="small"])::part(combobox) {
      block-size: var(--ui-control-height-xs);
      min-block-size: var(--ui-control-height-xs);
    }

    ic-select[data-component-variant="model-picker"]:is([size="s"], [size="small"])::part(display-input) {
      font-size: var(--ui-font-size-1);
    }

    ic-select[data-component-variant="model-picker"]:is([size="l"], [size="large"]) {
      --wa-form-control-height: var(--ui-control-height-m);
      --wa-form-control-value-font-size: var(--ui-font-size-3);
    }

    ic-select[data-component-variant="model-picker"]:is([size="l"], [size="large"])::part(combobox) {
      block-size: var(--ui-control-height-m);
      min-block-size: var(--ui-control-height-m);
    }

    ic-select[data-component-variant="model-picker"]:is([size="l"], [size="large"])::part(display-input) {
      font-size: var(--ui-font-size-3);
    }

    ic-select[data-component-variant="generation-count"] {
      --wa-form-control-height: var(--ui-control-height-s);
      --wa-form-control-value-font-size: var(--ui-font-size-2);
      --wa-form-control-activated-color: var(--ui-color-action-secondary-selected);
      inline-size: fit-content;
      max-inline-size: 100%;
    }

    ic-select[data-component-variant="generation-count"]::part(combobox) {
      box-sizing: border-box;
      block-size: 2rem;
      min-block-size: 2rem;
      padding-inline: var(--ui-space-2);
      border-color: transparent;
      border-radius: var(--ui-radius-pill);
      background: var(--ui-color-action-tertiary);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="generation-count"]:not([disabled])::part(combobox):hover {
      background: var(--ui-color-action-tertiary-hover);
    }

    ic-select[data-component-variant="generation-count"]::part(display-input) {
      color: var(--ui-color-text-primary);
      font: var(--ui-text-body-compact);
    }

    ic-select[data-component-variant="generation-count"]::part(listbox) {
      box-sizing: border-box;
      inline-size: 10rem;
      min-inline-size: 10rem;
      max-block-size: 16rem;
      padding: var(--ui-space-1);
      background: var(--ui-color-surface);
    }

    ic-select[data-component-variant="generation-count"] wa-option {
      box-sizing: border-box;
      block-size: 2rem;
      min-block-size: 2rem;
      justify-content: center;
      padding: 0 var(--ui-space-2);
      border-radius: var(--ui-radius-s);
      color: var(--ui-color-text-tertiary);
      font: var(--ui-text-body-compact);
      text-align: center;
    }

    ic-select[data-component-variant="generation-count"] wa-option:hover {
      background: var(--ui-color-action-tertiary-hover);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="generation-count"] wa-option[aria-selected="true"],
    ic-select[data-component-variant="generation-count"] wa-option:state(current) {
      background: var(--ui-color-action-secondary-selected);
      color: var(--ui-color-text-primary);
    }

    ic-select[data-component-variant="generation-count"] wa-option::part(checked-icon) {
      display: none;
    }

    ic-select[data-component-variant="generation-count"] wa-option::part(label) {
      text-align: center;
    }

    ic-select[data-component-variant="generation-count"] > ic-icon[slot="expand-icon"] {
      --ic-icon-size: var(--ui-icon-size-s);
      --ic-icon-stroke-width: var(--ui-icon-stroke-width-s);
    }

    ic-select[data-component-variant="generation-count"]:is([size="s"], [size="small"])::part(combobox) {
      block-size: var(--ui-control-height-xs);
      min-block-size: var(--ui-control-height-xs);
      font-size: var(--ui-font-size-1);
    }

    ic-select[data-component-variant="generation-count"]:is([size="l"], [size="large"])::part(combobox) {
      block-size: var(--ui-control-height-m);
      min-block-size: var(--ui-control-height-m);
      font-size: var(--ui-font-size-3);
    }

    .param-row ic-select::part(combobox),
    .param-row ic-select::part(display-input),
    .param-row ic-select > ic-icon,
    .param-row ic-select > [slot="start"],
    .param-row ic-select > [slot="end"] {
      color: var(--ui-color-text-secondary);
    }

    .param-row ic-select wa-option[aria-selected="true"],
    .param-row ic-select wa-option:state(current) {
      --current-text-color: var(--ui-color-text-secondary);
      color: var(--ui-color-text-secondary);
    }

    :is(.theme-dark, .studio-theme-dark, [data-ui-theme="dark"])
      ic-select[data-component-variant="model-picker"]
      [data-ic-select-option-start-icon]
      img[data-monochrome="true"] {
      filter: invert(1);
    }

    ic-select,
    ic-slider,
    ic-number-input,
    ic-color-field {
      box-sizing: border-box;
      min-inline-size: 0;
      max-inline-size: 100%;
    }

    ic-number-input::part(base) {
      box-sizing: border-box;
      inline-size: 100%;
      min-inline-size: 0;
      max-inline-size: 100%;
    }

    ic-checkbox:focus-visible::part(control),
    ic-radio:focus-visible::part(control),
    ic-switch:focus-visible::part(control),
    ic-select:focus-visible::part(combobox),
    ic-slider:focus-visible::part(thumb),
    ic-number-input:focus-visible::part(base),
    ic-color-field:focus-visible::part(trigger),
    [data-preview-state="focus-visible"]::part(combobox) {
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
      box-shadow: var(--ui-focus-ring-shadow);
    }

    [data-preview-state="hover"]:not([disabled])::part(control) {
      background-color: var(--ui-color-action-tertiary-hover);
      border-color: var(--ui-color-text-tertiary);
    }

    ic-slider::part(indicator) {
      background-color: var(--ui-color-action-primary);
    }

    ic-slider::part(slider) {
      box-sizing: border-box;
      padding-inline: calc(var(--thumb-width) / 2);
    }

    ic-slider::part(thumb) {
      background-color: var(--ui-color-surface);
      border-color: var(--ui-color-border-primary);
      box-shadow: var(--ui-shadow-raised);
    }

    :is(ic-checkbox, ic-radio, ic-switch, ic-select, ic-slider, ic-number-input, ic-color-field)[disabled] {
      color: var(--ui-color-text-disabled);
      opacity: 1;
      cursor: not-allowed;
    }

    html[data-ui-motion="reduced"]
      :is(ic-checkbox, ic-radio, ic-switch, ic-slider):active::part(control),
    html[data-ui-motion="reduced"]
      :is(ic-switch, ic-slider):active::part(thumb) {
      scale: 1 !important;
    }

    @media (prefers-reduced-motion: reduce) {
      :is(ic-checkbox, ic-radio, ic-switch, ic-slider):active::part(control),
      :is(ic-switch, ic-slider):active::part(thumb) {
        scale: 1 !important;
      }
    }

    :is(ic-checkbox, ic-radio, ic-switch)[disabled]::part(control),
    ic-slider[disabled]::part(track),
    ic-slider[disabled]::part(thumb) {
      color: var(--ui-color-icon-disabled);
      background-color: var(--ui-color-action-secondary-disabled);
      border-color: var(--ui-color-border-disabled);
      box-shadow: var(--ui-shadow-none);
    }

    ic-slider[disabled]::part(indicator) {
      background-color: var(--ui-color-action-secondary-disabled);
    }

    ic-select[disabled]::part(combobox),
    ic-number-input[disabled]::part(base),
    ic-color-field[disabled]::part(trigger) {
      color: var(--ui-color-text-disabled);
      background-color: var(--ui-color-action-secondary-disabled);
      border-color: var(--ui-color-border-disabled);
      box-shadow: var(--ui-shadow-none);
    }

    ic-select[disabled]::part(display-input) {
      color: var(--ui-color-text-disabled);
    }

    ic-checkbox[data-ic-contract-status="invalid"],
    ic-radio-group[data-ic-contract-status="invalid"],
    ic-radio[data-ic-contract-status="invalid"],
    ic-switch[data-ic-contract-status="invalid"],
    ic-select[data-ic-contract-status="invalid"],
    ic-slider[data-ic-contract-status="invalid"],
    ic-number-input[data-ic-contract-status="invalid"],
    ic-color-field[data-ic-contract-status="invalid"] {
      color: var(--ui-color-text-tertiary);
      cursor: not-allowed;
    }
  `;
  document.head.append(stylesheet);
}
