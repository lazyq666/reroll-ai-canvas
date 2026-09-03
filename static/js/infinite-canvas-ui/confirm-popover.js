import { ANCHORED_OVERLAY_MOTION_STYLES, IcPopover, menuPopoverContractState } from './menu-popover.js?v=ic-ui-ef410096e2b4';

const CONSEQUENCES = new Set(['neutral', 'destructive']);
let confirmPopoverId = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export class IcConfirmPopover extends IcPopover {
  static observedAttributes = [
    ...IcPopover.observedAttributes,
    'description', 'confirm-label', 'cancel-label', 'consequence', 'confirm-loading',
  ];

  constructor() {
    super();
    this._confirmPopoverId = `ic-confirm-popover-${++confirmPopoverId}`;
    this._onConfirmEscape = event => {
      if (event.key !== 'Escape' || !this.hasAttribute('open') || this.confirmLoading) return;
      event.preventDefault();
      event.stopPropagation();
      this.cancel('escape');
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onConfirmEscape, { capture: true });
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onConfirmEscape, { capture: true });
    super.disconnectedCallback();
  }

  validateContract() {
    if (!this.getAttribute('label')?.trim()) return 'label is required for every ic-confirm-popover';
    if (!this.getAttribute('confirm-label')?.trim() || !this.getAttribute('cancel-label')?.trim()) {
      return 'Confirm Popover requires visible Cancel and Confirm labels';
    }
    const consequence = this.getAttribute('consequence') || 'neutral';
    if (!CONSEQUENCES.has(consequence)) return `Unknown Confirm Popover consequence: ${consequence || '(empty)'}`;
    return this.validatePositionContract();
  }

  get confirmLoading() { return this.hasAttribute('confirm-loading'); }
  set confirmLoading(value) { this.toggleAttribute('confirm-loading', Boolean(value)); }

  render() {
    const contractReady = menuPopoverContractState(this, this.validateContract());
    const titleId = `${this._confirmPopoverId}-title`;
    const descriptionId = `${this._confirmPopoverId}-description`;
    const description = this.getAttribute('description')?.trim() || '';
    const destructive = (this.getAttribute('consequence') || 'neutral') === 'destructive';
    const loading = this.confirmLoading;
    this.shadowRoot.innerHTML = `<style>
      :host { display:contents; }
      [part="surface"] { position:fixed; inset:auto; z-index:var(--ui-z-popover); width:min(20rem,calc(100vw - 2 * var(--ui-space-4))); max-height:calc(100vh - 2 * var(--ui-space-4)); overflow:auto; padding:var(--ui-space-4); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-l); color:var(--ui-color-text-primary); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-overlay); }
      [part="title"] { margin:0; color:var(--ui-color-text-primary); font:var(--ui-text-title-3); overflow-wrap:anywhere; }
      [part="description"] { margin:var(--ui-space-2) 0 0; color:var(--ui-color-text-tertiary); font:var(--ui-text-body-compact); overflow-wrap:anywhere; }
      [part="actions"] { display:flex; justify-content:flex-end; gap:var(--ui-space-2); margin-top:var(--ui-space-4); }
      [part="actions"] ic-button { flex:none; }
      ${ANCHORED_OVERLAY_MOTION_STYLES}
    </style>
    <section part="surface" role="alertdialog" aria-labelledby="${titleId}" ${description ? `aria-describedby="${descriptionId}"` : ''} tabindex="-1" popover="manual">
      <h2 part="title" id="${titleId}">${escapeHtml(this.getAttribute('label') || '')}</h2>
      ${description ? `<p part="description" id="${descriptionId}">${escapeHtml(description)}</p>` : ''}
      <footer part="actions"></footer>
    </section>`;
    if (!contractReady) return;
    const cancel = document.createElement('ic-button');
    cancel.type = 'button';
    cancel.hierarchy = 'secondary';
    cancel.toggleAttribute('data-cancel', true);
    cancel.disabled = loading;
    cancel.textContent = this.getAttribute('cancel-label') || '';
    cancel.addEventListener('click', () => this.cancel('cancel'));
    const confirm = document.createElement('ic-button');
    confirm.type = 'button';
    confirm.hierarchy = 'primary';
    confirm.tone = destructive ? 'danger' : 'neutral';
    confirm.toggleAttribute('data-confirm', true);
    confirm.loading = loading;
    confirm.textContent = this.getAttribute('confirm-label') || '';
    confirm.addEventListener('click', () => this.confirm());
    this.shadowRoot.querySelector('[part="actions"]')?.append(cancel, confirm);
  }

  show(invoker) {
    super.show(invoker);
    if (this.dataset.icContractStatus !== 'ready') return;
    queueMicrotask(() => this.shadowRoot.querySelector('[data-cancel]')?.focus({ preventScroll: true }));
  }

  hide(reason = 'programmatic') {
    if (this.hasAttribute('open') && ['outside', 'escape'].includes(reason)) {
      this.cancel(reason);
      return;
    }
    super.hide(reason);
  }

  cancel(reason = 'cancel') {
    if (this.confirmLoading || !this.hasAttribute('open')) return;
    const event = new CustomEvent('ic-cancel', { bubbles: true, composed: true, cancelable: true, detail: { reason } });
    if (!this.dispatchEvent(event)) return;
    super.hide(reason);
  }

  confirm() {
    if (this.confirmLoading || !this.hasAttribute('open')) return;
    this.dispatchEvent(new CustomEvent('ic-confirm', { bubbles: true, composed: true }));
  }
}
