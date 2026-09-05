const AI_PROCESSOR_DIALOG_STYLE_MARKER = 'ic-ai-processor-dialog-v2';


export function ensureAiProcessorDialogStyles() {
  if (document.querySelector(`style[data-ic-ai-processor-dialog-styles="${AI_PROCESSOR_DIALOG_STYLE_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icAiProcessorDialogStyles = AI_PROCESSOR_DIALOG_STYLE_MARKER;
  stylesheet.textContent = `
    ic-ai-processor-dialog::part(dialog) {
      inline-size: min(calc(100dvw - (2 * var(--ui-space-4))), var(--ui-dialog-size-medium));
      max-block-size: calc(100dvh - (2 * var(--ui-space-4)));
      color: var(--ui-color-text-primary);
      background-color: var(--ui-color-surface);
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-m);
      box-shadow: var(--ui-shadow-modal);
    }

    ic-ai-processor-dialog[size="large"]::part(dialog) {
      inline-size: min(calc(100dvw - (2 * var(--ui-space-4))), var(--ui-dialog-size-large));
      block-size: var(--ui-dialog-block-size-large);
      max-inline-size: none;
      max-block-size: none;
    }

    ic-ai-processor-dialog[size="x-large"]::part(dialog) {
      inline-size: var(--ui-dialog-size-x-large);
      block-size: var(--ui-dialog-block-size-x-large);
      max-inline-size: none;
      max-block-size: none;
    }

    ic-ai-processor-dialog::part(body) {
      overflow: auto;
      overscroll-behavior: contain;
    }

    ic-ai-processor-dialog::part(footer) {
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: var(--ui-space-2);
    }

    ic-ai-processor-dialog::part(close-button) {
      display: none;
    }

    ic-ai-processor-dialog::part(header) {
      padding-block-start: var(--ui-space-6);
    }

    ic-ai-processor-dialog [data-ai-processor-layout] {
      display: grid;
      gap: var(--ui-space-5);
      min-inline-size: 0;
    }

    ic-ai-processor-dialog [data-ai-processor-layout="reverse-prompt"] {
      grid-template-columns: 16.25rem minmax(0, 1fr);
      min-block-size: 26.875rem;
    }

    ic-ai-processor-dialog [data-ai-processor-source] {
      display: block;
      inline-size: 100%;
      block-size: 26.875rem;
      border-radius: var(--ui-radius-m);
      object-fit: cover;
    }

    ic-ai-processor-dialog [data-ai-processor-panel] {
      min-inline-size: 0;
      display: grid;
      align-content: start;
      gap: var(--ui-space-4);
    }

    ic-ai-processor-dialog .ai-processor-field {
      min-inline-size: 0;
      display: grid;
      gap: var(--ui-space-2);
    }

    ic-ai-processor-dialog .ai-processor-option-title,
    ic-ai-processor-dialog .ai-processor-option-group legend,
    ic-ai-processor-dialog :is(ic-select,ic-textarea)::part(form-control-label) {
      color: var(--ui-color-text-primary);
      font: var(--ui-text-label);
    }

    ic-ai-processor-dialog [data-ai-processor-template-list] {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--ui-space-2);
      max-block-size: 14.5rem;
      overflow: auto;
      overscroll-behavior: contain;
    }

    ic-ai-processor-dialog [data-template-id] {
      inline-size: 100%;
    }

    ic-ai-processor-dialog [data-template-id][data-template-id] > [data-ic-owned-label] {
      display: none;
    }

    ic-ai-processor-dialog [data-template-id] ic-heading {
      flex: 1 1 auto;
      min-inline-size: 0;
    }

    ic-ai-processor-dialog [data-template-id]::part(base) {
      min-block-size: 4.5rem;
      padding: var(--ui-space-3);
    }

    ic-ai-processor-dialog ic-select[data-component-variant="model-picker"] {
      max-inline-size: 100%;
    }

    ic-ai-processor-dialog ic-select[data-component-variant="model-picker"] > [slot="start"] img {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      object-fit: contain;
    }

    ic-ai-processor-dialog [data-ai-processor-empty] {
      min-block-size: 5rem;
    }

    ic-ai-processor-dialog [data-ai-processor-error] {
      margin-block-start: var(--ui-space-3);
    }

    ic-ai-processor-dialog [data-ai-processor-layout="outpaint"] {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      min-block-size: 0;
      block-size: 100%;
      align-items: stretch;
    }

    ic-ai-processor-dialog [data-ai-processor-layout="layer-decomposition"] {
      grid-template-columns: minmax(0, 1.45fr) minmax(18rem, 1fr);
      min-block-size: 0;
      block-size: 100%;
      align-items: stretch;
    }
    ic-ai-processor-dialog[processor="layer-decomposition"] > [data-ic-ai-processor-owned="body"] { block-size: 100%; }
    ic-ai-processor-dialog [data-layer-source-column] { min-inline-size: 0; min-block-size: 0; block-size: 100%; }
    ic-ai-processor-dialog [data-layer-source-stage] {
      box-sizing: border-box;
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      display: grid;
      place-items: center;
      padding: var(--ui-space-5);
      overflow: hidden;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-m);
      background: var(--ui-color-surface-canvas);
    }
    ic-ai-processor-dialog [data-layer-source] {
      display: block;
      min-inline-size: 0;
      min-block-size: 0;
      inline-size: 100%;
      block-size: 100%;
      max-inline-size: 100%;
      max-block-size: 100%;
      object-fit: contain;
      object-position: center;
      border-radius: var(--ui-radius-s);
    }
    ic-ai-processor-dialog [data-ai-processor-layout="layer-decomposition"] > [data-ai-processor-panel] { min-block-size: 0; overflow: auto; overscroll-behavior: contain; }
    ic-ai-processor-dialog [data-layer-resolution-options] { inline-size: 100%; }
    ic-ai-processor-dialog [data-layer-resolution-options]::part(form-control-input) { inline-size: 100%; }
    ic-ai-processor-dialog [data-layer-resolution-options] > ic-radio { flex: 1 0 auto; justify-content: center; }
    ic-ai-processor-dialog [data-layer-price] {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ui-space-3);
      padding: var(--ui-space-3) var(--ui-space-4);
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-s);
      color: var(--ui-color-text-secondary);
      font: var(--ui-text-label);
    }
    ic-ai-processor-dialog [data-layer-price] strong { color: var(--ui-color-text-primary); font-variant-numeric: tabular-nums; }

    ic-ai-processor-dialog [data-outpaint-canvas-column] {
      min-inline-size: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      align-content: stretch;
      gap: var(--ui-space-2);
    }

    ic-ai-processor-dialog [data-outpaint-stage] {
      min-block-size: 0;
      block-size: auto;
      display: grid;
      place-items: center;
      padding: var(--ui-space-5);
      overflow: hidden;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-m);
      background-color: var(--ui-color-surface);
      background-image: conic-gradient(
        var(--ui-color-border-secondary) 25%,
        var(--ui-color-surface) 0 50%,
        var(--ui-color-border-secondary) 0 75%,
        var(--ui-color-surface) 0
      );
      background-size: 1rem 1rem;
    }

    ic-ai-processor-dialog [data-outpaint-frame] {
      position: relative;
      box-sizing: border-box;
      inline-size: 1px;
      block-size: 1px;
      aspect-ratio: 1 / 1;
      max-inline-size: 100%;
      max-block-size: 100%;
      border: var(--ui-border-width-strong) solid var(--ui-color-border-selected);
      background: var(--outpaint-fill, #ffffff);
      box-shadow: var(--ui-shadow-raised);
      touch-action: none;
    }

    ic-ai-processor-dialog [data-outpaint-source] {
      position: absolute;
      display: block;
      object-fit: contain;
      pointer-events: none;
      user-select: none;
    }

    ic-ai-processor-dialog [data-outpaint-handle] {
      position: absolute;
      z-index: 2;
      background: var(--ui-color-surface);
      border: var(--ui-border-width-strong) solid var(--ui-color-border-selected);
      border-radius: var(--ui-radius-pill);
      box-shadow: var(--ui-shadow-raised);
    }

    ic-ai-processor-dialog [data-outpaint-handle="top"],
    ic-ai-processor-dialog [data-outpaint-handle="bottom"] { inline-size: 2.5rem; block-size: .65rem; inset-inline-start: 50%; transform: translate(-50%,-50%); cursor: ns-resize; }
    ic-ai-processor-dialog [data-outpaint-handle="top"] { inset-block-start: 0; }
    ic-ai-processor-dialog [data-outpaint-handle="bottom"] { inset-block-start: 100%; }
    ic-ai-processor-dialog [data-outpaint-handle="left"],
    ic-ai-processor-dialog [data-outpaint-handle="right"] { inline-size: .65rem; block-size: 2.5rem; inset-block-start: 50%; transform: translate(-50%,-50%); cursor: ew-resize; }
    ic-ai-processor-dialog [data-outpaint-handle="left"] { inset-inline-start: 0; }
    ic-ai-processor-dialog [data-outpaint-handle="right"] { inset-inline-start: 100%; }
    ic-ai-processor-dialog [data-outpaint-handle="nw"],
    ic-ai-processor-dialog [data-outpaint-handle="ne"],
    ic-ai-processor-dialog [data-outpaint-handle="se"],
    ic-ai-processor-dialog [data-outpaint-handle="sw"] { inline-size: 1rem; block-size: 1rem; transform: translate(-50%,-50%); }
    ic-ai-processor-dialog [data-outpaint-handle="nw"] { inset: 0 auto auto 0; cursor: nwse-resize; }
    ic-ai-processor-dialog [data-outpaint-handle="ne"] { inset: 0 0 auto auto; transform: translate(50%,-50%); cursor: nesw-resize; }
    ic-ai-processor-dialog [data-outpaint-handle="se"] { inset: auto 0 0 auto; transform: translate(50%,50%); cursor: nwse-resize; }
    ic-ai-processor-dialog [data-outpaint-handle="sw"] { inset: auto auto 0 0; transform: translate(-50%,50%); cursor: nesw-resize; }

    ic-ai-processor-dialog [data-outpaint-guidance] {
      margin: 0;
      color: var(--ui-color-text-tertiary);
      font: var(--ui-text-caption);
      text-align: center;
    }

    ic-ai-processor-dialog .ai-processor-resolution {
      display: flex;
      align-items: baseline;
      gap: var(--ui-space-2);
    }
    ic-ai-processor-dialog .ai-processor-resolution strong { margin-inline-start: auto; font-variant-numeric: tabular-nums; }
    ic-ai-processor-dialog .ai-processor-resolution small { color: var(--ui-color-text-warning); }

    ic-ai-processor-dialog .ai-processor-option-group {
      min-inline-size: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    ic-ai-processor-dialog .ai-processor-option-group legend { margin-block-end: var(--ui-space-2); padding: 0; }

    ic-ai-processor-dialog [data-outpaint-color-options] {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
    }
    ic-ai-processor-dialog [data-fill-color] { inline-size: 2.25rem; block-size: 2.25rem; padding: .2rem; border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius: var(--ui-radius-pill); background: var(--ui-color-surface); }
    ic-ai-processor-dialog [data-fill-color][aria-pressed="true"] { box-shadow: inset 0 0 0 var(--ui-border-width-strong) var(--ui-color-border-selected); }
    ic-ai-processor-dialog [data-fill-color] span { display: block; inline-size: 100%; block-size: 100%; border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius: inherit; }
    ic-ai-processor-dialog [data-custom-color-option] {
      position: relative;
      box-sizing: border-box;
      display: block;
      inline-size: 2.25rem;
      block-size: 2.25rem;
      padding: .2rem;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-pill);
      background: var(--ui-color-surface);
    }
    ic-ai-processor-dialog [data-custom-color-option][data-selected="true"] { box-shadow: inset 0 0 0 var(--ui-border-width-strong) var(--ui-color-border-selected); }
    ic-ai-processor-dialog [data-custom-color-option] ic-color-field {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      --wa-form-control-height: 100%;
      --wa-form-control-border-width: 0px;
    }
    ic-ai-processor-dialog [data-custom-color-option] ic-color-field::part(form-control-label) { display: none; }
    ic-ai-processor-dialog [data-custom-color-option] ic-color-field::part(trigger) { inline-size: 100%; block-size: 100%; border: 0; border-radius: var(--ui-radius-pill); }
    ic-ai-processor-dialog [data-custom-color-hint] {
      position: absolute;
      inset: .2rem;
      pointer-events: none;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-pill);
      background: conic-gradient(from 90deg, #ff3b30, #ffcc00, #34c759, #00c7be, #007aff, #af52de, #ff2d55, #ff3b30);
    }
    ic-ai-processor-dialog [data-custom-color-option][data-has-custom-color="true"] [data-custom-color-hint] { display: none; }

    ic-ai-processor-dialog [data-ai-processor-layout="angle-control"] {
      grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr);
      min-block-size: 0;
      block-size: 100%;
    }
    ic-ai-processor-dialog:is([processor="outpaint"],[processor="angle-control"]) > [data-ic-ai-processor-owned="body"] { block-size: 100%; }
    ic-ai-processor-dialog [data-angle-controller-column] { min-inline-size: 0; min-block-size: 0; block-size: 100%; overflow: hidden; border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius: var(--ui-radius-m); }
    ic-ai-processor-dialog [data-ai-processor-layout="angle-control"] > [data-ai-processor-panel] { min-block-size: 0; gap: var(--ui-space-3); overflow: auto; overscroll-behavior: contain; }
    ic-ai-processor-dialog .ai-angle-viewport { min-inline-size: 0; min-block-size: 0; block-size: 100%; overflow: hidden; background: var(--ui-color-surface); }
    ic-ai-processor-dialog .ai-angle-viewport canvas { display: block; inline-size: 100%; block-size: 100%; }
    ic-ai-processor-dialog .ai-angle-controls { display: grid; gap: var(--ui-space-4); }
    ic-ai-processor-dialog .ai-processor-output-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ui-space-4); align-items: start; }
    ic-ai-processor-dialog .ai-processor-generation-settings { align-content: start; }
    ic-ai-processor-dialog .ai-processor-generation-settings ic-generation-settings-picker { inline-size: 100%; }
    ic-ai-processor-dialog [data-outpaint-prompt] { display: grid; gap: var(--ui-space-2); }
    ic-ai-processor-dialog [data-outpaint-prompt-heading] { display: flex; align-items: center; gap: var(--ui-space-2); }
    ic-ai-processor-dialog [data-outpaint-prompt-heading] > .ai-processor-option-title { flex: 0 0 auto; }
    ic-ai-processor-dialog [data-outpaint-prompt-heading] > .ai-processor-field { flex: 1 1 auto; gap: 0; }
    ic-ai-processor-dialog [data-outpaint-prompt-heading] ic-select { inline-size: 100%; }
    ic-ai-processor-dialog [data-angle-prompt]::part(textarea) { block-size: 7rem; }
    ic-ai-processor-dialog .ai-angle-control-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: var(--ui-space-2); align-items: center; }
    ic-ai-processor-dialog .ai-angle-control-copy { min-block-size: var(--ui-control-height-s); display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-2); font: var(--ui-text-label); }
    ic-ai-processor-dialog .ai-angle-control-copy span:last-child { color: var(--ui-color-text-tertiary); font: var(--ui-text-caption); }
    ic-ai-processor-dialog .ai-angle-control-row ic-number-input,
    ic-ai-processor-dialog .ai-angle-control-row ic-slider { grid-column: 1 / -1; inline-size: 100%; }
    ic-ai-processor-dialog .ai-angle-control-row ic-slider { box-sizing: border-box; padding-inline: var(--ui-space-3); }
    ic-ai-processor-dialog .ai-angle-control-row :is(ic-number-input,ic-slider)::part(form-control-label),
    ic-ai-processor-dialog .ai-angle-control-row :is(ic-number-input,ic-slider)::part(label) { display: none; }

    ic-ai-processor-dialog [data-ai-processor-layout="lighting-reference"] {
      grid-template-columns: minmax(0, 1.7fr) minmax(20rem, .85fr);
      min-block-size: 0;
      block-size: 100%;
    }
    ic-ai-processor-dialog[processor="lighting-reference"] > [data-ic-ai-processor-owned="body"] { block-size: 100%; }
    ic-ai-processor-dialog [data-lighting-controller-column] {
      min-inline-size: 0;
      min-block-size: 0;
      block-size: 100%;
      overflow: hidden;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-m);
      background: var(--ui-color-surface-canvas);
    }
    ic-ai-processor-dialog .ai-lighting-stage { position: relative; min-inline-size: 0; min-block-size: 0; block-size: 100%; overflow: hidden; }
    ic-ai-processor-dialog [data-lighting-viewport] { min-inline-size: 0; min-block-size: 0; block-size: 100%; cursor: grab; touch-action: none; }
    ic-ai-processor-dialog [data-lighting-viewport][data-dragging="true"] { cursor: grabbing; }
    ic-ai-processor-dialog [data-lighting-viewport] canvas { display: block; inline-size: 100%; block-size: 100%; }
    ic-ai-processor-dialog [data-lighting-drag-hint] {
      position: absolute;
      inset-block-end: var(--ui-space-4);
      inset-inline-start: 50%;
      translate: -50% 0;
      padding: var(--ui-space-2) var(--ui-space-3);
      border: var(--ui-border-width-thin) solid rgb(255 255 255 / 40%);
      border-radius: var(--ui-radius-pill);
      background: color-mix(in srgb, var(--ui-color-mask) 76%, transparent);
      color: var(--ui-color-text-white);
      font: var(--ui-text-caption);
      pointer-events: none;
      white-space: nowrap;
    }
    ic-ai-processor-dialog [data-lighting-source-context] {
      position: absolute;
      inset-block-start: var(--ui-space-4);
      inset-inline-start: var(--ui-space-4);
      box-sizing: border-box;
      inline-size: 9rem;
      margin: 0;
      padding: var(--ui-space-2);
      border: var(--ui-border-width-thin) solid rgb(255 255 255 / 32%);
      border-radius: var(--ui-radius-s);
      background: color-mix(in srgb, var(--ui-color-mask) 72%, transparent);
      color: var(--ui-color-text-white);
      box-shadow: var(--ui-shadow-raised);
    }
    ic-ai-processor-dialog [data-lighting-source-context] img { display: block; inline-size: 100%; aspect-ratio: 4 / 3; object-fit: contain; border-radius: var(--ui-radius-xs); background: #25272c; }
    ic-ai-processor-dialog [data-ai-processor-layout="lighting-reference"] > [data-ai-processor-panel] { min-block-size: 0; overflow: auto; overscroll-behavior: contain; }
    ic-ai-processor-dialog .ai-lighting-controls { display: grid; gap: calc(var(--ui-space-4) + var(--ui-space-2)); }
    ic-ai-processor-dialog .ai-lighting-parameter-group {
      display: grid;
      gap: var(--ui-space-3);
      padding: var(--ui-space-4);
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-m);
      background: var(--ui-color-surface);
    }
    ic-ai-processor-dialog .ai-lighting-section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3); }
    ic-ai-processor-dialog .ai-lighting-section-heading > div { display: grid; gap: var(--ui-space-1); }
    ic-ai-processor-dialog .ai-lighting-section-heading strong { color: var(--ui-color-text-primary); font: var(--ui-text-label); }
    ic-ai-processor-dialog .ai-lighting-section-heading span { color: var(--ui-color-text-tertiary); font: var(--ui-text-caption); }
    ic-ai-processor-dialog .ai-lighting-color-mode { inline-size: 100%; }
    ic-ai-processor-dialog .ai-lighting-color-mode > button { flex: 1 1 0; }
    ic-ai-processor-dialog .ai-lighting-control-row { display: grid; grid-template-columns: minmax(0,1fr) 6.25rem; column-gap: var(--ui-space-2); row-gap: var(--ui-space-1); align-items: center; }
    ic-ai-processor-dialog .ai-lighting-control-copy { min-inline-size: 0; display: flex; align-items: baseline; justify-content: space-between; gap: var(--ui-space-2); font: var(--ui-text-label); }
    ic-ai-processor-dialog .ai-lighting-control-copy span:last-child { color: var(--ui-color-text-tertiary); font: var(--ui-text-caption); white-space: nowrap; }
    ic-ai-processor-dialog .ai-lighting-control-row ic-slider { grid-column: 1 / -1; inline-size: 100%; box-sizing: border-box; }
    ic-ai-processor-dialog .ai-lighting-control-row ic-slider::part(slider) { padding-inline: 0; }
    ic-ai-processor-dialog .ai-lighting-control-row :is(ic-number-input,ic-slider)::part(form-control-label),
    ic-ai-processor-dialog .ai-lighting-control-row :is(ic-number-input,ic-slider)::part(label) { display: none; }
    ic-ai-processor-dialog .ai-lighting-switch-row { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3); font: var(--ui-text-label); }
    ic-ai-processor-dialog [data-lighting-rgb-row] ic-color-field { inline-size: 100%; }
    ic-ai-processor-dialog [data-lighting-controller][data-lighting-color-mode="temperature"] [data-lighting-rgb-row],
    ic-ai-processor-dialog [data-lighting-controller][data-lighting-color-mode="rgb"] [data-lighting-temperature-row] { display: none; }
    ic-ai-processor-dialog .ai-lighting-prompt-group ic-textarea::part(textarea) { min-block-size: 6.5rem; font: var(--ui-text-caption); }

    @media (max-width: 68rem) {
      ic-ai-processor-dialog [data-ai-processor-layout="angle-control"] { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(20rem, 1fr) auto; overflow: auto; }
      ic-ai-processor-dialog [data-ai-processor-layout="lighting-reference"] { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(24rem, 1fr) auto; overflow: auto; }
      ic-ai-processor-dialog [data-ai-processor-layout="layer-decomposition"] { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(18rem, 1fr) auto; overflow: auto; }
    }

    @media (max-width: 45rem) {
      ic-ai-processor-dialog [data-ai-processor-layout="reverse-prompt"],
      ic-ai-processor-dialog [data-ai-processor-layout="outpaint"],
      ic-ai-processor-dialog [data-ai-processor-layout="layer-decomposition"] {
        grid-template-columns: 1fr;
        min-block-size: 0;
      }
      ic-ai-processor-dialog [data-ai-processor-source] {
        block-size: 8.125rem;
      }
      ic-ai-processor-dialog [data-outpaint-stage] { block-size: 20rem; padding: var(--ui-space-5); }
      ic-ai-processor-dialog [data-layer-source-stage] { block-size: 16rem; }
      ic-ai-processor-dialog .ai-angle-viewport { block-size: 20rem; }
      ic-ai-processor-dialog .ai-lighting-stage { block-size: 24rem; }
    }
  `;
  document.head.append(stylesheet);
}
