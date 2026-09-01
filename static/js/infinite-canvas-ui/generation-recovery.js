const RECOVERY_KINDS = new Set(['image', 'video', 'text']);
const RECOVERY_STATES = new Set(['queued', 'recoverable', 'querying']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export class IcGenerationRecovery extends HTMLElement {
  static get observedAttributes() {
    return ['kind', 'state', 'title', 'description', 'action-label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastContractError = '';
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  validateContract() {
    const kind = this.getAttribute('kind') || '';
    const state = this.getAttribute('state') || '';
    if (!RECOVERY_KINDS.has(kind)) return 'kind must be image, video, or text';
    if (!RECOVERY_STATES.has(state)) return 'state must be queued, recoverable, or querying';
    if (!this.getAttribute('title')?.trim()) return 'title is required';
    if (!this.getAttribute('description')?.trim()) return 'description is required';
    if (!this.getAttribute('action-label')?.trim()) return 'action-label is required';
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

  render() {
    const kind = this.getAttribute('kind') || '';
    const state = this.getAttribute('state') || '';
    const title = this.getAttribute('title')?.trim() || '';
    const description = this.getAttribute('description')?.trim() || '';
    const actionLabel = this.getAttribute('action-label')?.trim() || '';
    const querying = state === 'querying';
    const icon = state === 'recoverable' ? 'refresh' : 'loader';
    this.syncContract();
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
    this.setAttribute('aria-busy', querying || state === 'queued' ? 'true' : 'false');
    this.setAttribute('aria-label', `${title}. ${description}`);
    this.shadowRoot.innerHTML = `
      <style>
        :host { box-sizing:border-box; display:block; inline-size:100%; block-size:100%; min-inline-size:0; min-block-size:0; color:var(--ui-color-text-primary); font-family:var(--ui-font-sans); }
        *, *::before, *::after { box-sizing:border-box; }
        .recovery { position:relative; inline-size:100%; block-size:100%; min-block-size:7.5rem; overflow:hidden; border:var(--ui-border-width-thin) solid var(--ui-color-border-primary); border-radius:var(--ui-radius-m); background:var(--ui-color-surface-subtle); }
        ic-skeleton { position:absolute; inset:0; inline-size:100%; block-size:100%; opacity:.7; }
        :host([state="recoverable"]) ic-skeleton { opacity:.35; }
        .content { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--ui-space-2); min-inline-size:0; padding:var(--ui-space-3); text-align:center; }
        .icon { color:var(--ui-color-text-primary); }
        :host([state="queued"]) .icon, :host([state="querying"]) .icon { animation:ic-generation-recovery-spin calc(var(--ui-motion-duration-slow) * 2) var(--ui-motion-ease-linear) infinite; }
        .title { color:var(--ui-color-text-primary); font:var(--ui-text-body); font-weight:var(--ui-font-weight-medium); }
        .description { max-inline-size:100%; overflow:hidden; color:var(--ui-color-text-tertiary); font:var(--ui-text-label); text-overflow:ellipsis; white-space:nowrap; }
        .action { margin-block-start:var(--ui-space-1); }
        :host([data-ic-contract-status="invalid"]) { opacity:.55; }
        @keyframes ic-generation-recovery-spin { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion:reduce) { .icon { animation:none !important; } }
      </style>
      <div class="recovery" part="base" data-kind="${escapeHtml(kind)}" data-state="${escapeHtml(state)}">
        <ic-skeleton shape="rectangle" aria-hidden="true"></ic-skeleton>
        <div class="content" part="content">
          <ic-icon class="icon" name="${icon}" size="medium" aria-hidden="true"></ic-icon>
          <strong class="title" part="title">${escapeHtml(title)}</strong>
          <span class="description" part="description">${escapeHtml(description)}</span>
          <ic-button class="action" part="action" type="button" size="s" hierarchy="secondary"${querying ? ' loading disabled' : ''}>${escapeHtml(actionLabel)}</ic-button>
        </div>
      </div>`;
    const action = this.shadowRoot.querySelector('.action');
    action?.addEventListener('mousedown', event => event.stopPropagation());
    action?.addEventListener('click', event => {
      event.stopPropagation();
      if (querying || !this.syncContract()) return;
      this.dispatchEvent(new CustomEvent('ic-recover', {
        bubbles: true,
        composed: true,
        detail: { kind, state },
      }));
    });
  }
}
