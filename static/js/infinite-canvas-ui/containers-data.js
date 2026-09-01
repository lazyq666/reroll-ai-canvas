const CARD_TONES = new Set(['plain', 'subtle']);
const CARD_SIZES = new Set(['small', 'medium', 'large']);
const LIST_KINDS = new Set(['unordered', 'ordered', 'description']);
const TABLE_SELECTION = new Set(['none', 'single', 'multiple']);
const TABLE_SIZES = new Set(['small', 'medium', 'large']);
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'file']);
const MEDIA_FITS = new Set(['contain', 'cover']);
const MEDIA_ASPECTS = new Set(['auto', 'square', 'landscape', 'portrait']);
const MEDIA_STATES = new Set(['ready', 'loading', 'unavailable']);
const CONTAINER_DATA_STYLE_MARKER = 'ic-containers-data-v1';

function ensureContainerDataStyles() {
  if (document.querySelector(`style[data-ic-containers-data="${CONTAINER_DATA_STYLE_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icContainersData = CONTAINER_DATA_STYLE_MARKER;
  stylesheet.textContent = `
    :where(ic-table) {
      --ic-table-min-width: 100%;
      --ic-table-cell-padding-block: var(--ui-space-3);
      --ic-table-cell-padding-inline: var(--ui-space-4);
      --ic-table-header-padding-block: var(--ui-space-4);
      --ic-table-header-padding-inline: var(--ui-space-4);
      --ic-table-font: var(--ui-text-body);
      --ic-table-header-background: var(--ui-color-surface-subtle);
      --ic-table-row-background: var(--ui-color-surface);
      --ic-table-row-hover-background: var(--ui-color-surface-subtle);
      --ic-table-row-selected-background: var(--ui-color-action-secondary-selected);
      --ic-table-divider-color: var(--ui-color-border-secondary);
    }

    :where(ic-table[size="small"]) {
      --ic-table-cell-padding-block: var(--ui-space-2);
      --ic-table-cell-padding-inline: var(--ui-space-3);
      --ic-table-header-padding-block: var(--ui-space-3);
      --ic-table-header-padding-inline: var(--ui-space-3);
      --ic-table-font: var(--ui-text-body-compact);
    }

    :where(ic-table[size="large"]) {
      --ic-table-cell-padding-block: var(--ui-space-4);
      --ic-table-cell-padding-inline: var(--ui-space-5);
      --ic-table-header-padding-block: var(--ui-space-5);
      --ic-table-header-padding-inline: var(--ui-space-5);
    }

    ic-table > table {
      inline-size: 100%;
      min-inline-size: var(--ic-table-min-width);
      border-collapse: collapse;
      table-layout: auto;
      color: var(--ui-color-text-primary);
      font: var(--ic-table-font);
    }

    ic-table > table > caption {
      margin-block-end: var(--ui-space-0);
      padding: var(--ic-table-cell-padding-block) var(--ic-table-cell-padding-inline);
      color: var(--ui-color-text-primary);
      background: var(--ui-color-surface);
      font: var(--ui-text-label);
      text-align: start;
    }

    ic-table > table > thead > tr > th {
      min-block-size: var(--ui-density-control-height);
      padding: var(--ic-table-header-padding-block) var(--ic-table-header-padding-inline);
      border-block-end: var(--ui-border-width-thin) solid var(--ic-table-divider-color);
      color: var(--ui-color-text-tertiary);
      background: var(--ic-table-header-background);
      font: var(--ui-text-label);
      text-align: start;
      vertical-align: middle;
    }

    ic-table > table > :is(tbody, tfoot) > tr > :is(th, td) {
      padding: var(--ic-table-cell-padding-block) var(--ic-table-cell-padding-inline);
      border-block-end: var(--ui-border-width-thin) solid var(--ic-table-divider-color);
      background: var(--ic-table-row-background);
      text-align: start;
      vertical-align: middle;
    }

    ic-table > table > tbody:last-of-type > tr:last-child > :is(th, td) {
      border-block-end-width: var(--ui-border-width-none);
    }

    ic-table > table > tbody > tr > :is(th, td) {
      transition: background-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-table > table > tbody > tr:hover > :is(th, td) {
      background: var(--ic-table-row-hover-background);
    }

    ic-table > table > tbody > tr:is([aria-selected="true"], [data-selected]) > :is(th, td) {
      background: var(--ic-table-row-selected-background);
    }

  `;
  document.head.append(stylesheet);
}

ensureContainerDataStyles();

const sharedStyles = `
  :host { box-sizing:border-box; color:var(--ui-color-text-primary); font:inherit; }
  :host([hidden]) { display:none !important; }
  *, *::before, *::after { box-sizing:border-box; }
  :host([data-ic-contract-status="invalid"]) { opacity:.55; pointer-events:none; }
`;

function contractState(host, reason, detail = {}) {
  host.dataset.icContractStatus = reason ? 'invalid' : 'ready';
  if (!reason) {
    delete host.dataset.icContractReason;
    host.removeAttribute('aria-disabled');
    host._lastContractError = '';
    return true;
  }
  host.dataset.icContractReason = reason;
  host.setAttribute('aria-disabled', 'true');
  const signature = JSON.stringify({ reason, ...detail });
  if (signature !== host._lastContractError) {
    host._lastContractError = signature;
    host.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: { component: host.localName, reason, ...detail },
    }));
  }
  return false;
}

class IcContainerElement extends HTMLElement {
  constructor() {
    super();
    this._lastContractError = '';
    this.attachShadow({ mode: 'open' });
  }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  bindSlotValidation() {
    this.shadowRoot.querySelectorAll('slot').forEach(slot => slot.addEventListener('slotchange', () => this.validateAndExpose()));
  }
  validateAndExpose() { return contractState(this, this.validateContract()); }
}

export class IcCard extends IcContainerElement {
  static observedAttributes = ['label', 'tone', 'size'];
  validateContract() {
    const tone = this.getAttribute('tone') || 'plain';
    const size = this.getAttribute('size') || 'medium';
    if (!CARD_TONES.has(tone)) return 'tone must be plain or subtle';
    if (!CARD_SIZES.has(size)) return 'size must be small, medium, or large';
    if (this.hasAttribute('href') || this.hasAttribute('selected') || this.hasAttribute('pressed')) return 'ic-card is not an interactive choice';
    return '';
  }
  validateAndExpose() {
    const valid = super.validateAndExpose();
    const label = this.getAttribute('label')?.trim();
    if (label) { this.setAttribute('role', 'region'); this.setAttribute('aria-label', label); }
    else { this.removeAttribute('role'); this.removeAttribute('aria-label'); }
    return valid;
  }
  render() {
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; min-width:0; --ic-card-padding:var(--ui-space-5); --ic-card-content-gap:var(--ui-space-3); --ic-card-border-color:var(--ui-color-border-secondary); }
      :host([size="small"]) { --ic-card-padding:var(--ui-space-4); --ic-card-content-gap:var(--ui-space-2); }
      :host([size="medium"]) { --ic-card-padding:var(--ui-space-5); --ic-card-content-gap:var(--ui-space-3); }
      :host([size="large"]) { --ic-card-padding:var(--ui-space-6); --ic-card-content-gap:var(--ui-space-4); }
      .card { min-width:0; overflow:hidden; border:var(--ui-border-width-thin) solid var(--ic-card-border-color); border-radius:var(--ui-radius-m); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-none); }
      :host([tone="subtle"]) .card { border:0; background:var(--ui-color-surface-subtle); box-shadow:none; }
      .header[hidden],.footer[hidden] { display:none; }
      .header { padding:var(--ic-card-padding) var(--ic-card-padding) 0; font-weight:var(--ui-font-weight-bold); }
      .body { min-width:0; display:grid; gap:var(--ic-card-content-gap); padding:var(--ic-card-padding); overflow-wrap:anywhere; }
      .footer { display:flex; justify-content:flex-end; padding:0 var(--ic-card-padding) var(--ic-card-padding); }
      .footer-content { display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap; gap:var(--ui-space-2); max-width:100%; }
    </style><section class="card" part="base"><div class="header" part="header"><slot name="header"></slot></div><div class="body" part="body"><slot></slot></div><div class="footer" part="footer"><div class="footer-content"><slot name="footer"></slot></div></div></section>`;
    const syncOptionalRegion = (slot) => {
      const hasContent = slot.assignedNodes({ flatten: true }).some((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
      slot.closest(slot.name === 'header' ? '.header' : '.footer').hidden = !hasContent;
    };
    this.shadowRoot.querySelectorAll('slot[name="header"], slot[name="footer"]').forEach((slot) => {
      slot.addEventListener('slotchange', () => syncOptionalRegion(slot));
      syncOptionalRegion(slot);
    });
    this.validateAndExpose(); this.bindSlotValidation();
  }
}

export class IcDivider extends IcContainerElement {
  static observedAttributes = ['orientation'];
  validateContract() { return ['horizontal', 'vertical'].includes(this.getAttribute('orientation') || 'horizontal') ? '' : 'orientation must be horizontal or vertical'; }
  validateAndExpose() {
    const valid = super.validateAndExpose();
    const orientation = this.getAttribute('orientation') || 'horizontal';
    this.setAttribute('role', 'separator');
    this.setAttribute('aria-orientation', orientation);
    this.tabIndex = -1;
    return valid;
  }
  render() {
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; flex:none; border:0 solid var(--ui-color-border-secondary); border-block-start-width:var(--ui-border-width-thin); margin-block:var(--ui-space-1); }
      :host([orientation="vertical"]) { display:inline-block; align-self:center; block-size:1.5em; min-height:1.5em; border-block-start-width:0; border-inline-start-width:var(--ui-border-width-thin); margin:0 var(--ui-space-1); }
    </style>`;
    this.validateAndExpose();
  }
}

export class IcList extends IcContainerElement {
  static observedAttributes = ['label', 'kind'];
  validateContract() {
    const label = this.getAttribute('label')?.trim();
    const kind = this.getAttribute('kind') || 'unordered';
    if (!label) return 'label is required for ic-list';
    if (!LIST_KINDS.has(kind)) return 'kind must be unordered, ordered, or description';
    const expected = { unordered: 'UL', ordered: 'OL', description: 'DL' }[kind];
    const children = [...this.children].filter(item => item.tagName !== 'TEMPLATE');
    if (children.length !== 1 || children[0].tagName !== expected) return `ic-list kind ${kind} requires exactly one native ${expected.toLowerCase()} child`;
    return '';
  }
  validateAndExpose() {
    const valid = super.validateAndExpose();
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', this.getAttribute('label')?.trim() || '');
    return valid;
  }
  render() {
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; min-width:0; }
      .list { min-width:0; color:var(--ui-color-text-primary); }
      ::slotted(ul),::slotted(ol),::slotted(dl) { margin:0; padding:0; }
      ::slotted(ul),::slotted(ol) { padding-inline-start:1.35rem; }
      :host-context([data-ui-density="small"]) .list { font-size:var(--ui-density-font-size); }
    </style><div class="list"><slot></slot></div>`;
    this.validateAndExpose(); this.bindSlotValidation();
  }
}

export class IcTable extends IcContainerElement {
  static observedAttributes = ['label', 'row-selection', 'size'];
  validateContract() {
    const label = this.getAttribute('label')?.trim();
    const selection = this.getAttribute('row-selection') || 'none';
    const size = this.getAttribute('size') || 'medium';
    if (!label) return 'label is required for ic-table';
    if (!TABLE_SELECTION.has(selection)) return 'row-selection must be none, single, or multiple';
    if (!TABLE_SIZES.has(size)) return 'size must be small, medium, or large';
    const tables = [...this.children].filter(item => item instanceof HTMLTableElement);
    if (tables.length !== 1 || [...this.children].some(item => !(item instanceof HTMLTableElement))) return 'ic-table requires exactly one native table child';
    if (!tables[0].querySelector('th')) return 'native table requires header cells';
    return '';
  }
  validateAndExpose() {
    const valid = super.validateAndExpose();
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', this.getAttribute('label')?.trim() || '');
    const table = [...this.children].find(item => item instanceof HTMLTableElement);
    if (table) {
      if (table.querySelector('caption')) table.removeAttribute('aria-label');
      else table.setAttribute('aria-label', this.getAttribute('label')?.trim() || '');
    }
    return valid;
  }
  render() {
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; min-width:0; overflow:auto; border:var(--ic-table-border-width,var(--ui-border-width-thin)) solid var(--ic-table-border-color,var(--ui-color-border-secondary)); border-radius:var(--ic-table-radius,var(--ui-radius-m)); background:var(--ui-color-surface); overscroll-behavior-inline:contain; }
      .table-wrap { min-width:100%; width:100%; }
      ::slotted(table) { width:100%; border-collapse:collapse; color:var(--ui-color-text-primary); font:inherit; }
    </style><div class="table-wrap"><slot></slot></div>`;
    this.validateAndExpose(); this.bindSlotValidation();
  }
}

export class IcMediaContainer extends IcContainerElement {
  static observedAttributes = ['label', 'kind', 'fit', 'aspect', 'state'];
  validateContract() {
    if (!this.getAttribute('label')?.trim()) return 'label is required for ic-media-container';
    if (!MEDIA_KINDS.has(this.getAttribute('kind') || '')) return 'kind must be image, video, audio, or file';
    if (!MEDIA_FITS.has(this.getAttribute('fit') || 'contain')) return 'fit must be contain or cover';
    if (!MEDIA_ASPECTS.has(this.getAttribute('aspect') || 'auto')) return 'aspect must be auto, square, landscape, or portrait';
    if (!MEDIA_STATES.has(this.getAttribute('state') || 'ready')) return 'state must be ready, loading, or unavailable';
    if (['audio', 'file'].includes(this.getAttribute('kind')) && this.getAttribute('fit') === 'cover') return 'cover is valid only for image or video';
    return '';
  }
  validateAndExpose() {
    const valid = super.validateAndExpose();
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label')?.trim() || '');
    const state = this.getAttribute('state') || 'ready';
    this.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    return valid;
  }
  render() {
    const state = this.getAttribute('state') || 'ready';
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:grid; min-width:0; gap:var(--ui-space-2); }
      .frame { display:grid; place-items:center; min-width:0; overflow:hidden; border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-m); background:var(--ui-color-surface-subtle); }
      :host([kind="audio"]) .frame { display:contents; border:0; border-radius:0; background:transparent; }
      :host([aspect="square"]) .frame { aspect-ratio:1; } :host([aspect="landscape"]) .frame { aspect-ratio:16/9; } :host([aspect="portrait"]) .frame { aspect-ratio:3/4; }
      ::slotted(img),::slotted(video) { display:block; width:100%; height:100%; max-width:100%; object-fit:var(--ic-media-fit, contain); }
      ::slotted(audio) { display:block; max-width:100%; }
      :host([fit="cover"]) { --ic-media-fit:cover; }
      .fallback { display:${state === 'ready' ? 'none' : 'grid'}; place-items:center; min-height:5rem; padding:var(--ui-space-4); color:var(--ui-color-text-tertiary); text-align:center; }
      .content { display:${state === 'ready' ? 'contents' : 'none'}; }
      .caption { color:var(--ui-color-text-tertiary); font:var(--ui-text-body-compact); overflow-wrap:anywhere; }
    </style><div class="frame" part="frame"><div class="content"${state === 'ready' ? '' : ' hidden'}><slot></slot></div><div class="fallback"${state === 'ready' ? ' hidden' : ''}><slot name="fallback">${state === 'loading' ? 'Loading…' : 'Media unavailable'}</slot></div></div><div class="caption"><slot name="caption"></slot></div>`;
    this.validateAndExpose(); this.bindSlotValidation();
  }
}
