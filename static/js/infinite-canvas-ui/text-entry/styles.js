const STYLE_MARKER = 'ic-text-entry-v2';


export function ensureTextEntryStyles() {
  if (document.querySelector(`style[data-ic-text-entry="${STYLE_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icTextEntry = STYLE_MARKER;
  stylesheet.textContent = `
    ic-input::part(base),
    ic-textarea::part(base) {
      box-sizing: border-box;
      inline-size: 100%;
      color: var(--ui-color-text-primary);
      background: var(--ui-color-surface);
      border-color: var(--ui-color-border-primary);
      border-radius: var(--ui-radius-s);
      transition:
        border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-input::part(input),
    ic-textarea::part(textarea) {
      caret-color: var(--ui-color-text-caret);
    }

    ic-input {
      --ic-input-text-fade-size: var(--ui-space-1);
      --wa-form-control-padding-inline: calc(var(--ui-density-inline-padding) - var(--ic-input-text-fade-size));
    }

    ic-input::part(input) {
      -webkit-mask-image: none;
      mask-image: none;
    }

    ic-input[data-inline-fade-start]:not([data-inline-fade-end])::part(input) {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--ic-input-text-fade-size),
        black 100%
      );
      mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--ic-input-text-fade-size),
        black 100%
      );
    }

    ic-input[data-inline-fade-end]:not([data-inline-fade-start])::part(input) {
      -webkit-mask-image: linear-gradient(
        to right,
        black 0,
        black calc(100% - var(--ic-input-text-fade-size)),
        transparent 100%
      );
      mask-image: linear-gradient(
        to right,
        black 0,
        black calc(100% - var(--ic-input-text-fade-size)),
        transparent 100%
      );
    }

    ic-input[data-inline-fade-start][data-inline-fade-end]::part(input) {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--ic-input-text-fade-size),
        black calc(100% - var(--ic-input-text-fade-size)),
        transparent 100%
      );
      mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--ic-input-text-fade-size),
        black calc(100% - var(--ic-input-text-fade-size)),
        transparent 100%
      );
    }

    :is(ic-input, ic-textarea):is([size="s"], [size="small"]) {
      --wa-form-control-height: var(--ui-control-height-s);
      --wa-form-control-value-font-size: var(--ui-font-size-2);
    }

    ic-input:is([size="s"], [size="small"]) {
      --wa-form-control-padding-inline: calc(var(--ui-space-2) - var(--ic-input-text-fade-size));
    }

    :is(ic-input[type="text"], ic-input:not([type])):is([size="s"], [size="small"]):not([appearance="subtle"]):not([end-action])::part(base) {
      padding-inline-start: var(--ui-space-2);
    }

    ic-input:is([size="s"], [size="small"]) > ic-icon[slot="start"] {
      --ic-icon-size: var(--ui-icon-size-s);
      --ic-icon-stroke-width: var(--ui-icon-stroke-width-s);
    }

    :is(ic-input, ic-textarea):is([size="m"], [size="medium"]) {
      --wa-form-control-height: var(--ui-control-height-m);
      --wa-form-control-value-font-size: var(--ui-font-size-3);
    }

    ic-input:is([size="m"], [size="medium"]) {
      --wa-form-control-padding-inline: calc(var(--ui-space-3) - var(--ic-input-text-fade-size));
    }

    ic-input:is([size="m"], [size="medium"]) > ic-icon[slot="start"] {
      --ic-icon-size: var(--ui-icon-size-m);
      --ic-icon-stroke-width: var(--ui-icon-stroke-width-m);
    }

    :is(ic-input, ic-textarea):is([size="l"], [size="large"]) {
      --wa-form-control-height: var(--ui-control-height-l);
      --wa-form-control-value-font-size: var(--ui-font-size-4);
    }

    ic-input:is([size="l"], [size="large"]) {
      --wa-form-control-padding-inline: calc(var(--ui-space-4) - var(--ic-input-text-fade-size));
    }

    ic-input:is([size="l"], [size="large"]) > ic-icon[slot="start"] {
      --ic-icon-size: var(--ui-icon-size-l);
      --ic-icon-stroke-width: var(--ui-icon-stroke-width-l);
    }

    ic-form-field ic-input::part(base),
    ic-form-field ic-textarea::part(base) { border-color: var(--ui-color-border-secondary); }

    ic-input[appearance="subtle"]::part(base),
    ic-form-field ic-input[appearance="subtle"]::part(base) {
      background: var(--ui-color-surface-subtle);
      border-color: transparent;
      border-width: var(--ui-border-width-none);
    }

    ic-input[end-action]::part(base) { padding-inline-end: var(--ui-space-1); }

    ic-input[end-action] > ic-icon-button[slot="end"]::part(base) {
      inline-size: var(--ic-icon-button-control-size, var(--ui-control-height-s));
      block-size: var(--ic-icon-button-control-size, var(--ui-control-height-s));
      min-block-size: var(--ic-icon-button-control-size, var(--ui-control-height-s));
      display: grid;
      place-items: center;
    }

    ic-input[type="search"][end-action] > ic-icon-button[data-search-clear] {
      align-self: center;
      display: grid;
      place-items: center;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
        visibility var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-input[type="search"][end-action]:focus-within > ic-icon-button[data-search-clear] {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    ic-input[end-action] > ic-button[slot="end"]::part(base) {
      block-size: var(--ui-control-height-s);
      min-block-size: var(--ui-control-height-s);
      padding-inline: var(--ui-space-2);
    }

    ic-input[end-action] > [slot="end"] { margin-inline-start: 0; }

    ic-input[end-action] > [slot="end"] + [slot="end"] { margin-inline-start: var(--ui-space-1); }

    ic-form-field,
    ic-input,
    ic-textarea {
      min-inline-size: 0;
      max-inline-size: 100%;
    }

    ic-input:focus-within::part(base),
    ic-textarea:focus-within::part(base) {
      border-color: var(--ui-color-border-focus);
      border-radius: var(--ui-radius-s);
      outline: none;
      box-shadow: none;
    }

    ic-input[appearance="subtle"]:focus-within::part(base) {
      border-color: transparent;
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
      box-shadow: var(--ui-focus-ring-shadow);
    }

    ic-input[aria-invalid="true"]::part(base),
    ic-textarea[aria-invalid="true"]::part(base),
    ic-form-field[invalid] ic-input::part(base),
    ic-form-field[invalid] ic-textarea::part(base) { border-color: var(--ui-color-border-danger); }

    ic-form-field[invalid] ic-input::part(hint),
    ic-form-field[invalid] ic-textarea::part(hint) { color: var(--ui-color-text-danger); }

    :is(ic-input, ic-textarea)[disabled] {
      color: var(--ui-color-text-disabled);
      opacity: 1;
      cursor: not-allowed;
    }

    :is(ic-input, ic-textarea)[disabled]::part(base) {
      color: var(--ui-color-text-disabled);
      background: var(--ui-color-action-secondary-disabled);
      border-color: var(--ui-color-border-disabled);
      box-shadow: var(--ui-shadow-none);
    }

    ic-input[disabled]::part(input),
    ic-textarea[disabled]::part(textarea) {
      color: var(--ui-color-text-disabled);
      -webkit-text-fill-color: var(--ui-color-text-disabled);
    }
  `;
  document.head.append(stylesheet);
}
