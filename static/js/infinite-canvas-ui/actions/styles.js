import { i as css } from '../../../vendor/webawesome/3.10.0/package/dist-cdn/chunks/chunk.TLFIX76K.js';


export const BUTTON_STYLES = css`
  :host {
    --wa-form-control-border-radius: var(--ui-radius-m);
    --ic-button-secondary-border-color: var(--ui-color-border-secondary);
    --ic-action-press-scale: .94;
  }

  [part~='base'] {
    min-block-size: var(--ui-density-control-height);
    padding-inline: var(--ui-density-inline-padding);
    gap: var(--ui-space-0);
    /* Keep non-circular actions independently rounded, including inside Button Group. */
    border-radius: var(--ui-radius-m) !important;
    corner-shape: squircle;
    font-family: var(--ui-font-sans);
    font-size: var(--ui-density-font-size);
    font-weight: var(--ui-font-weight-medium);
    line-height: var(--ui-line-height-tight);
    transition:
      color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
      background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
      border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
      box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
      transform var(--ui-motion-duration-release) var(--ui-motion-ease-spring);
  }

  :host-context(html[data-ui-motion='reduced']) {
    --ic-action-press-scale: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --ic-action-press-scale: 1;
    }
  }

  :host(:not([disabled]):not([loading]):not([data-ic-contract-status='invalid']):active) [part~='base'],
  :host([data-preview-state='pressed']:not([disabled]):not([loading]):not([data-ic-contract-status='invalid'])) [part~='base'] {
    transform: scale(var(--ic-action-press-scale)) !important;
    transition: transform var(--ui-motion-duration-press) var(--ui-motion-ease-press) !important;
  }

  :host([size='xs']),
  :host([size='x-small']) {
    --wa-form-control-height: var(--ui-control-height-xs);
  }

  :host([size='xs']) [part~='base'],
  :host([size='x-small']) [part~='base'] {
    min-block-size: var(--ui-control-height-xs);
    padding-inline: var(--ui-space-2);
    font-size: var(--ui-font-size-1);
  }

  :host([size='s']),
  :host([size='small']) {
    --wa-form-control-height: var(--ui-control-height-s);
  }

  :host([size='s']) [part~='base'],
  :host([size='small']) [part~='base'] {
    min-block-size: var(--ui-control-height-s);
    padding-inline: var(--ui-space-3);
    font-size: var(--ui-font-size-2);
  }

  :host([size='m']),
  :host([size='medium']) {
    --wa-form-control-height: var(--ui-control-height-m);
  }

  :host([size='m']) [part~='base'],
  :host([size='medium']) [part~='base'] {
    min-block-size: var(--ui-control-height-m);
    padding-inline: var(--ui-space-4);
    font-size: var(--ui-font-size-3);
  }

  :host([size='l']),
  :host([size='large']) {
    --wa-form-control-height: var(--ui-control-height-l);
  }

  :host([size='l']) [part~='base'],
  :host([size='large']) [part~='base'] {
    min-block-size: var(--ui-control-height-l);
    padding-inline: var(--ui-space-5);
    font-size: var(--ui-font-size-4);
  }

  /* The engine reflects its medium default. Keep implicit size bound to page density. */
  :host([data-ic-density-size]) {
    --wa-form-control-height: var(--ui-density-control-height);
  }

  :host([data-ic-density-size]) [part~='base'] {
    min-block-size: var(--ui-density-control-height);
    padding-inline: var(--ui-density-inline-padding);
    font-size: var(--ui-density-font-size);
  }

  :host([hierarchy='primary'][tone='neutral']) {
    --wa-color-fill-loud: var(--ui-color-action-primary);
    --wa-color-on-loud: var(--ui-color-text-on-action-primary);
  }

  ::slotted([slot='start']) {
    margin-inline-end: var(--ui-density-gap);
  }

  ::slotted([slot='end']) {
    margin-inline-start: var(--ui-density-gap);
  }

  [part~='base']:focus-visible {
    outline: var(--ui-focus-ring);
    outline-offset: var(--ui-focus-ring-offset);
    box-shadow: var(--ui-focus-ring-shadow);
  }

  :host([data-preview-state='focus-visible']) [part~='base'] {
    outline: var(--ui-focus-ring);
    outline-offset: var(--ui-focus-ring-offset);
    box-shadow: var(--ui-focus-ring-shadow);
  }

  :host([hierarchy='primary'][tone='neutral']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([hierarchy='primary'][tone='neutral'][data-preview-state='hover']) [part~='base'] {
    background-color: var(--ui-color-action-primary-hover);
  }

  :host([hierarchy='primary'][tone='danger']) [part~='base'] {
    color: var(--ui-color-text-on-action-primary-danger);
    background-color: var(--ui-color-action-primary-danger);
  }

  :host([hierarchy='primary'][tone='danger']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([hierarchy='primary'][tone='danger'][data-preview-state='hover']) [part~='base'] {
    color: var(--ui-color-text-on-action-primary-danger);
    background-color: var(--ui-color-action-primary-danger-hover);
  }

  :host([hierarchy='secondary'][tone='danger']) [part~='base'] {
    color: var(--ui-color-text-danger);
    background-color: var(--ui-color-action-secondary-danger);
    font-weight: var(--ui-font-weight-regular);
  }

  :host([hierarchy='secondary'][tone='neutral']) [part~='base'] {
    color: var(--ui-color-text-primary);
    background-color: var(--ui-color-action-secondary);
    border: var(--ui-border-width-thin) solid var(--ic-button-secondary-border-color);
    font-weight: var(--ui-font-weight-regular);
  }

  :host([hierarchy='secondary'][tone='neutral']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([hierarchy='secondary'][tone='neutral'][data-preview-state='hover']) [part~='base'] {
    color: var(--ui-color-text-primary);
    background-color: var(--ui-color-action-secondary-hover);
  }

  :host([hierarchy='secondary'][tone='danger']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([hierarchy='secondary'][tone='danger'][data-preview-state='hover']) [part~='base'] {
    color: var(--ui-color-text-danger);
    background-color: var(--ui-color-action-secondary-danger-hover);
  }

  :host([hierarchy='quiet'][tone='danger']) [part~='base'] {
    color: var(--ui-color-text-danger);
    background-color: var(--ui-color-action-tertiary-danger);
    font-weight: var(--ui-font-weight-regular);
  }

  :host([hierarchy='quiet'][tone='danger']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([hierarchy='quiet'][tone='danger'][data-preview-state='hover']) [part~='base'] {
    color: var(--ui-color-text-danger);
    background-color: var(--ui-color-action-tertiary-danger-hover);
  }

  :host([ghost][hierarchy='secondary'][tone='neutral']) [part~='base'] {
    background-color: var(--ui-color-action-tertiary);
    border: var(--ui-border-width-none);
  }

  :host([ghost][hierarchy='secondary'][tone='neutral']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([ghost][hierarchy='secondary'][tone='neutral'][data-preview-state='hover']) [part~='base'] {
    background-color: var(--ui-color-action-tertiary-hover);
  }

  :host-context(html.theme-dark),
  :host-context(html.studio-theme-dark),
  :host-context(html[data-ui-theme='dark']) {
    --ic-button-secondary-border-color: var(--ui-color-border-tertiary);
  }

  :host([tone='danger']) [part~='base'] {
    border: var(--ui-border-width-none);
  }

  :host([pressed]) [part~='base'] {
    color: var(--ui-color-text-primary);
    background-color: var(--ui-color-action-secondary-selected);
    border-color: var(--ui-color-border-selected);
  }

  /* WebAwesome dims disabled buttons with host opacity. Project semantic colors
     already encode the complete disabled presentation, so keep them unblended. */
  :host([disabled]) {
    opacity: 1;
  }

  :host([hierarchy='primary'][tone='neutral'][disabled]) [part~='base'] {
    color: var(--ui-color-text-on-action-primary-disabled);
    background-color: var(--ui-color-action-primary-disabled);
    border-color: transparent;
    box-shadow: var(--ui-shadow-none);
    transform: none;
  }

  :host([hierarchy='primary'][tone='danger'][disabled]) [part~='base'] {
    color: var(--ui-color-text-on-action-primary-disabled);
    background-color: var(--ui-color-action-primary-danger-disabled);
    border-color: transparent;
    box-shadow: var(--ui-shadow-none);
    transform: none;
  }

  :host([hierarchy='secondary'][tone='neutral'][disabled]) [part~='base'] {
    color: var(--ui-color-text-disabled);
    background-color: var(--ui-color-action-secondary-disabled);
    border-color: var(--ui-color-border-disabled);
    box-shadow: var(--ui-shadow-none);
    transform: none;
  }

  :host([hierarchy='secondary'][tone='danger'][disabled]) [part~='base'] {
    color: var(--ui-color-text-disabled);
    background-color: var(--ui-color-action-secondary-disabled);
    border-color: transparent;
    box-shadow: var(--ui-shadow-none);
    transform: none;
  }

  :host([hierarchy='quiet'][disabled]) [part~='base'],
  :host([ghost][hierarchy='secondary'][tone='neutral'][disabled]) [part~='base'] {
    color: var(--ui-color-text-disabled);
    background-color: var(--ui-color-action-tertiary-disabled);
    border-color: transparent;
    box-shadow: var(--ui-shadow-none);
    transform: none;
  }

  :host([data-ic-contract-status='invalid']) [part~='base'] {
    color: var(--ui-color-text-tertiary);
    background-color: var(--ui-color-surface-subtle);
    border-color: var(--ui-color-border-secondary);
    cursor: not-allowed;
  }

  :host([data-component-variant='generation-kind']) {
    --wa-form-control-height: var(--ui-control-height-s);
    --ic-generation-kind-color: var(--ui-color-text-primary);
    --wa-color-on-quiet: var(--ic-generation-kind-color);
    inline-size: fit-content;
    max-inline-size: 100%;
  }

  :host([data-component-variant='generation-kind']) [part~='base'] {
    box-sizing: border-box;
    block-size: var(--ui-control-height-s);
    min-block-size: var(--ui-control-height-s);
    padding-inline: var(--ui-space-2);
    border-color: transparent;
    border-radius: var(--ui-radius-s) !important;
    background: var(--ui-color-action-tertiary);
    color: var(--ic-generation-kind-color);
    font: var(--ui-text-body-compact);
    box-shadow: var(--ui-shadow-none);
  }

  :host([data-component-variant='generation-kind']:not([disabled])) [part~='base']:hover,
  :host([data-component-variant='generation-kind'][data-preview-state='hover']) [part~='base'] {
    background: var(--ui-color-action-tertiary-hover);
    color: var(--ic-generation-kind-color);
  }

  :host([data-component-variant='generation-kind']) ::slotted(ic-icon) {
    --ic-icon-size: var(--ui-icon-size-s);
    --ic-icon-stroke-width: var(--ui-icon-stroke-width-s);
    color: var(--ic-generation-kind-color);
  }

  :host([data-component-variant='generation-kind']) ::slotted(ic-icon[slot='start']) {
    margin-inline-end: var(--ui-space-2);
  }

  :host-context(.param-row) {
    --ic-generation-kind-color: var(--ui-color-text-secondary);
  }
`;


export const ICON_BUTTON_STYLES = css`
  :host {
    inline-size: var(--ic-icon-button-control-size, var(--ui-density-control-height));
    block-size: var(--ic-icon-button-control-size, var(--ui-density-control-height));
  }

  :host([size='xs']),
  :host([size='x-small']) {
    --ic-icon-button-control-size: var(--ui-control-height-xs);
    --ic-icon-button-icon-size: var(--ui-icon-size-xs);
  }

  :host([size='s']),
  :host([size='small']) {
    --ic-icon-button-control-size: var(--ui-control-height-s);
    --ic-icon-button-icon-size: var(--ui-icon-size-s);
  }

  :host([size='m']),
  :host([size='medium']) {
    --ic-icon-button-control-size: var(--ui-control-height-m);
    --ic-icon-button-icon-size: var(--ui-icon-size-m);
  }

  :host([size='l']),
  :host([size='large']) {
    --ic-icon-button-control-size: var(--ui-control-height-l);
    --ic-icon-button-icon-size: var(--ui-icon-size-l);
  }

  [part~='base'] {
    inline-size: var(--ic-icon-button-control-size, var(--ui-density-control-height));
    block-size: var(--ic-icon-button-control-size, var(--ui-density-control-height));
    min-block-size: var(--ic-icon-button-control-size, var(--ui-density-control-height));
    padding-inline: var(--ui-space-0);
    gap: var(--ui-space-0);
    justify-content: center;
    border-radius: var(--ui-radius-pill) !important;
    corner-shape: round;
  }

  [part='start'] {
    inline-size: var(--ic-icon-button-icon-size, var(--ui-density-icon-size));
    justify-content: center;
    margin-inline: var(--ui-space-0);
  }

  [part='start'],
  [part='end'] {
    display: none;
  }

  [part='label'] {
    inline-size: 100%;
    block-size: 100%;
    display: grid;
    place-items: center;
  }

  ::slotted(ic-icon[data-ic-icon-button-owned]) {
    margin-inline: var(--ui-space-0);
  }

  :host([hierarchy='secondary'][tone='neutral']) [part~='base'] {
    background-color: var(--ui-color-action-secondary);
    border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
    border-radius: var(--ui-radius-m) !important;
    corner-shape: squircle;
    box-shadow: var(--ui-shadow-raised);
  }

  :host([background='ghost'][hierarchy][tone]) [part~='base'] {
    border: var(--ui-border-width-none);
    border-radius: var(--ui-radius-m) !important;
    corner-shape: squircle;
    background: var(--ui-color-action-tertiary) !important;
    color: var(--ui-color-text-secondary) !important;
    box-shadow: var(--ui-shadow-none);
  }

  :host([background='ghost'][hierarchy][tone]:hover) [part~='base'],
  :host([background='ghost'][hierarchy][tone][data-preview-state='hover']) [part~='base'] {
    background: var(--ui-color-action-tertiary) !important;
    color: var(--ui-color-text-tertiary) !important;
  }

  :host([disabled][hierarchy][tone]) [part~='base'] {
    color: var(--ui-color-icon-disabled);
  }

  :host([hierarchy='secondary'][tone='neutral'][disabled]) [part~='base'] {
    border-color: var(--ui-color-border-disabled);
    box-shadow: var(--ui-shadow-none);
  }

  :host([background='ghost'][hierarchy][tone][disabled]) [part~='base'] {
    background: var(--ui-color-action-tertiary-disabled) !important;
    color: var(--ui-color-icon-disabled) !important;
    border-color: transparent;
    box-shadow: var(--ui-shadow-none);
  }

  :host([hierarchy='primary'][tone='neutral']) [part~='base'] {
    border: var(--ui-border-width-none);
    background: var(--ui-color-action-primary);
    color: var(--ui-color-text-on-action-primary);
    box-shadow: var(--ui-shadow-none);
    transition:
      background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
      box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
      transform var(--ui-motion-duration-release) var(--ui-motion-ease-spring);
  }

  :host([hierarchy='primary'][tone='neutral']:not([disabled]):not([loading])) [part~='base']:hover,
  :host([hierarchy='primary'][tone='neutral'][data-preview-state='hover']) [part~='base'] {
    background: var(--ui-color-action-primary-hover);
    box-shadow: var(--ui-shadow-raised);
    transform: translateY(-1px);
  }
`;


export const BUTTON_GROUP_STYLES = css`
  [part~='base'] {
    display: inline-flex;
    align-items: center;
    gap: var(--ui-space-1);
  }

  :host([orientation='vertical']) [part~='base'] {
    align-items: stretch;
    flex-direction: column;
  }
`;
