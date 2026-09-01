const ADAPTER_MARKER = 'ic-foundations-v1';


export const INFINITE_CANVAS_UI_FOUNDATIONS = Object.freeze({
  source: '/static/css/design-tokens.css',
  themes: Object.freeze(['light', 'dark']),
  densities: Object.freeze(['medium', 'small', 'large']),
  motion: Object.freeze(['standard', 'reduced']),
});


export function ensureThemeAdapterStyles() {
  if (document.querySelector(`style[data-ic-ui-theme-adapter="${ADAPTER_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icUiThemeAdapter = ADAPTER_MARKER;
  stylesheet.textContent = `
    :root {
      --wa-font-family-body: var(--ui-font-sans);
      --wa-font-family-heading: var(--ui-font-display);
      --wa-font-family-code: var(--ui-font-mono);
      --wa-font-size-xs: var(--ui-font-size-1);
      --wa-font-size-s: var(--ui-font-size-2);
      --wa-font-size-m: var(--ui-font-size-3);
      --wa-font-size-l: var(--ui-font-size-4);
      --wa-font-weight-normal: var(--ui-font-weight-regular);
      --wa-font-weight-semibold: var(--ui-font-weight-medium);
      --wa-font-weight-bold: var(--ui-font-weight-bold);
      --wa-line-height-condensed: var(--ui-line-height-tight);
      --wa-line-height-normal: var(--ui-line-height-body);

      --wa-space-2xs: var(--ui-space-1);
      --wa-space-xs: var(--ui-space-2);
      --wa-space-s: var(--ui-space-3);
      --wa-space-m: var(--ui-space-4);
      --wa-space-l: var(--ui-space-6);
      --wa-space-xl: var(--ui-space-8);

      --wa-border-width-s: var(--ui-border-width-thin);
      --wa-border-width-m: var(--ui-border-width-strong);
      --wa-border-radius-s: var(--ui-radius-xs);
      --wa-border-radius-m: var(--ui-radius-s);
      --wa-border-radius-l: var(--ui-radius-l);

      --wa-color-surface-raised: var(--ui-color-surface);
      --wa-color-surface-default: var(--ui-color-surface);
      --wa-color-surface-lowered: var(--ui-color-surface-subtle);
      --wa-color-surface-border: var(--ui-color-border-secondary);
      --wa-color-text-normal: var(--ui-color-text-primary);
      --wa-color-text-quiet: var(--ui-color-text-tertiary);
      --wa-color-text-link: var(--ui-color-text-link);
      --wa-color-overlay-modal: var(--ui-color-backdrop);
      --wa-shadow-s: var(--ui-shadow-raised);
      --wa-shadow-m: var(--ui-shadow-overlay);
      --wa-shadow-l: var(--ui-shadow-modal);
      --wa-color-focus: var(--ui-color-border-focus);
      --wa-color-neutral-fill-quiet: var(--ui-color-surface-subtle);
      --wa-color-neutral-fill-normal: var(--ui-color-surface-subtle);
      --wa-color-neutral-fill-loud: var(--ui-color-action-primary);
      --wa-color-neutral-border-quiet: var(--ui-color-border-secondary);
      --wa-color-neutral-border-normal: var(--ui-color-border-primary);
      --wa-color-neutral-border-loud: var(--ui-color-border-primary);
      --wa-color-neutral-on-quiet: var(--ui-color-text-tertiary);
      --wa-color-neutral-on-normal: var(--ui-color-text-primary);
      --wa-color-neutral-on-loud: var(--ui-color-text-on-action-primary);
      --wa-color-brand-fill-quiet: var(--ui-color-action-secondary-selected);
      --wa-color-brand-fill-normal: var(--ui-color-action-primary-hover);
      --wa-color-brand-fill-loud: var(--ui-color-action-primary);
      --wa-color-brand-border-quiet: var(--ui-color-border-secondary);
      --wa-color-brand-border-normal: var(--ui-color-border-selected);
      --wa-color-brand-border-loud: var(--ui-color-action-primary);
      --wa-color-brand-on-quiet: var(--ui-color-text-primary);
      --wa-color-brand-on-normal: var(--ui-color-text-on-action-primary);
      --wa-color-brand-on-loud: var(--ui-color-text-on-action-primary);
      --wa-color-danger-fill-quiet: var(--ui-color-action-tertiary-danger-hover);
      --wa-color-danger-fill-normal: var(--ui-color-action-secondary-danger);
      --wa-color-danger-fill-loud: var(--ui-color-action-primary-danger);
      --wa-color-danger-border-quiet: var(--ui-color-border-danger);
      --wa-color-danger-border-normal: var(--ui-color-border-danger);
      --wa-color-danger-border-loud: var(--ui-color-action-primary-danger);
      --wa-color-danger-on-quiet: var(--ui-color-text-danger);
      --wa-color-danger-on-normal: var(--ui-color-text-danger);
      --wa-color-danger-on-loud: var(--ui-color-text-on-action-primary-danger);

      --wa-focus-ring-style: solid;
      --wa-focus-ring-width: var(--ui-focus-ring-width);
      --wa-focus-ring-offset: var(--ui-focus-ring-offset);
      --wa-focus-ring: var(--ui-focus-ring);
      --wa-transition-fast: var(--ui-motion-duration-fast);
      --wa-transition-normal: var(--ui-motion-duration-normal);
      --wa-transition-slow: var(--ui-motion-duration-slow);
      --wa-transition-easing: var(--ui-motion-ease-standard);

      --wa-form-control-height: var(--ui-density-control-height);
      --wa-form-control-padding-inline: var(--ui-density-inline-padding);
      --wa-form-control-background-color: var(--ui-color-surface);
      --wa-form-control-border-color: var(--ui-color-border-primary);
      --wa-form-control-border-width: var(--ui-border-width-thin);
      --wa-form-control-border-radius: var(--ui-radius-s);
      --wa-form-control-value-color: var(--ui-color-text-primary);
      --wa-form-control-value-font-size: var(--ui-density-font-size);
      --wa-form-control-value-font-weight: var(--ui-font-weight-regular);
      --wa-form-control-value-line-height: var(--ui-line-height-tight);
      --wa-form-control-label-color: var(--ui-color-text-primary);
      --wa-form-control-label-font-weight: var(--ui-font-weight-medium);
      --wa-form-control-hint-color: var(--ui-color-text-tertiary);
      --wa-form-control-placeholder-color: var(--ui-color-text-placeholder);
      --wa-form-control-activated-color: var(--ui-color-border-selected);
    }

    :root[data-ic-input-modality="pointer"] {
      --ui-focus-ring: none;
      --ui-focus-ring-shadow: none;
      --ui-focus-background: var(--ui-color-action-tertiary);
      --wa-focus-ring-style: none;
      --wa-focus-ring-width: 0px;
    }

    :root[data-ic-input-modality="pointer"]
      :where([data-preview-state="focus-visible"], [data-state="focus-visible"], [data-focus-sample], .is-focus) {
      --ui-focus-ring: var(--ui-focus-ring-enabled);
      --ui-focus-ring-shadow: var(--ui-focus-ring-shadow-enabled);
      --ui-focus-background: var(--ui-focus-background-enabled);
      --wa-focus-ring-style: solid;
      --wa-focus-ring-width: var(--ui-focus-ring-width);
    }



  `;
  document.head.append(stylesheet);
}
