export class IcPromptNodeFocusSurface extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'open'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.handleWindowKeydown = this.handleWindowKeydown.bind(this);
  }

  connectedCallback() {
    if (!this.shadowRoot.hasChildNodes()) this.render();
    this.syncPresentation();
    window.addEventListener('keydown', this.handleWindowKeydown);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.handleWindowKeydown);
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncPresentation();
  }

  get open() {
    return this.hasAttribute('open');
  }

  set open(value) {
    this.toggleAttribute('open', Boolean(value));
  }

  requestDismiss(reason) {
    if (!this.open) return;
    this.dispatchEvent(new CustomEvent('ic-dismiss', {
      bubbles: true,
      composed: true,
      detail: { reason },
    }));
  }

  handleWindowKeydown(event) {
    if (!this.open || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    this.requestDismiss('escape');
  }

  syncPresentation() {
    const label = String(this.getAttribute('label') || '').trim();
    const surface = this.shadowRoot.querySelector('[part="surface"]');
    if (surface) surface.setAttribute('aria-label', label);
    this.setAttribute('aria-hidden', this.open ? 'false' : 'true');
    this.dataset.icContractStatus = label ? 'ready' : 'invalid';
    if (label) delete this.dataset.icContractReason;
    else this.dataset.icContractReason = 'label is required';
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:contents; }
        :host(:not([open])) { display:none; }
        [part="backdrop"] {
          position:fixed;
          inset:0;
          z-index:var(--ui-z-backdrop);
          background:var(--ui-color-backdrop);
          backdrop-filter:blur(10px);
        }
        [part="surface"] {
          position:fixed;
          z-index:var(--ui-z-modal);
          left:50%;
          top:50%;
          width:min(850px, calc(100vw - 32px));
          height:min(660px, calc(100vh - 32px));
          border-radius:var(--ui-radius-m);
          translate:-50% -50%;
        }
        slot { display:block; width:100%; height:100%; }
      </style>
      <div part="backdrop" aria-hidden="true"></div>
      <div part="surface" role="dialog" aria-modal="true"><slot></slot></div>`;
    this.shadowRoot.querySelector('[part="backdrop"]').addEventListener('click', () => {
      this.requestDismiss('backdrop');
    });
  }
}
