export class IcCanvasMultiSelection extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'quick-add-label', 'quick-add-reason', 'quick-add-visible'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position:absolute;
          z-index:42;
          display:block;
          box-sizing:border-box;
          border:var(--ui-border-width-strong) solid var(--ui-color-border-focus);
          border-radius:var(--ui-radius-none);
          background:transparent;
          box-shadow:var(--ui-shadow-none);
          cursor:move;
          pointer-events:auto;
        }
        :host(:not([open])) { display:none; }
        [part~="handle"] {
          --smart-selection-handle-scale:var(--smart-selection-handle-inverse-scale, 1);
          position:absolute;
          box-sizing:border-box;
          width:12px;
          height:12px;
          border:var(--ui-border-width-thin) solid var(--ui-color-border-focus);
          border-radius:var(--ui-radius-xs);
          background:var(--ui-color-surface);
          box-shadow:var(--ui-shadow-none);
          pointer-events:none;
          transform-origin:center;
        }
        [part~="corner-nw"] { left:0; top:0; transform:translate(-50%, -50%) scale(var(--smart-selection-handle-scale)); }
        [part~="corner-ne"] { right:0; top:0; transform:translate(50%, -50%) scale(var(--smart-selection-handle-scale)); }
        [part~="corner-se"] { right:0; bottom:0; transform:translate(50%, 50%) scale(var(--smart-selection-handle-scale)); }
        [part~="corner-sw"] { left:0; bottom:0; transform:translate(-50%, 50%) scale(var(--smart-selection-handle-scale)); }
        [part~="resize-handle"] { cursor:nwse-resize; pointer-events:auto; }
        [part="quick-add"] {
          position:absolute; left:100%; top:50%; margin-left:12px;
          transform:translateY(-50%); cursor:pointer; pointer-events:auto;
        }
        :host(:not([quick-add-visible])) [part="quick-add"] { display:none; }
      </style>
      <span part="handle corner corner-nw" aria-hidden="true"></span>
      <span part="handle corner corner-ne" aria-hidden="true"></span>
      <span part="handle corner corner-se resize-handle"></span>
      <span part="handle corner corner-sw" aria-hidden="true"></span>
      <span part="quick-add"><ic-icon-button size="xs" hierarchy="secondary" type="button" icon="add"></ic-icon-button></span>
    `;
    this.resizeHandle = this.shadowRoot.querySelector('[part~="resize-handle"]');
    this.quickAddTrigger = this.shadowRoot.querySelector('[part="quick-add"] ic-icon-button');
  }

  connectedCallback() {
    this.syncContract();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncContract();
  }

  syncContract() {
    const quickLabel = this.getAttribute('quick-add-label') || '';
    const reason = this.getAttribute('quick-add-reason') || '';
    this.quickAddTrigger.setAttribute('aria-label', reason || quickLabel);
    this.quickAddTrigger.setAttribute('label', reason || quickLabel);
    this.quickAddTrigger.setAttribute('title', reason || quickLabel);
    this.quickAddTrigger.toggleAttribute('disabled', Boolean(reason));
    this.quickAddTrigger.setAttribute('aria-disabled', reason ? 'true' : 'false');
    const label = (this.getAttribute('label') || '').trim();
    this.dataset.icContractStatus = label ? 'ready' : 'invalid';
    if (label) {
      delete this.dataset.icContractReason;
      this.resizeHandle.title = label;
      this.resizeHandle.setAttribute('aria-label', label);
    } else {
      this.dataset.icContractReason = 'label is required';
      this.resizeHandle.removeAttribute('title');
      this.resizeHandle.removeAttribute('aria-label');
    }
    return Boolean(label);
  }

  isResizeEvent(event) {
    return Boolean(event?.composedPath?.().includes(this.resizeHandle));
  }

  isQuickAddEvent(event) {
    return Boolean(event?.composedPath?.().includes(this.quickAddTrigger));
  }
}
