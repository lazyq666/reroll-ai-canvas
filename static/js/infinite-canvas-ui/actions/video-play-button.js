const VALID_SIZES = new Set(['s', 'm']);

export class IcVideoPlayButton extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'size', 'disabled'];
  }

  constructor() {
    super();
    this.attachShadow({ mode:'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --ic-video-play-button-size:4rem;
          display:inline-block;
          width:var(--ic-video-play-button-size);
          height:var(--ic-video-play-button-size);
          line-height:0;
        }
        :host([size="s"]) { --ic-video-play-button-size:var(--ui-control-height-s); }
        :host([hidden]) { display:none!important; }
        [part="base"] {
          position:relative;
          display:grid;
          place-items:center;
          width:100%;
          height:100%;
          padding:0;
          overflow:visible;
          border:0;
          border-radius:var(--ui-radius-pill);
          background:rgb(0 0 0 / 25%);
          color:var(--ui-color-text-white);
          backdrop-filter:blur(10px);
          -webkit-backdrop-filter:blur(10px);
          cursor:pointer;
        }
        [part="asset"] {
          width:40%;
          height:40%;
          pointer-events:none;
          --ui-icon-size:100%;
        }
        [part="base"]:focus-visible {
          outline:var(--ui-focus-ring);
          outline-offset:var(--ui-focus-ring-offset);
        }
        :host([disabled]) [part="base"] {
          opacity:.55;
          cursor:not-allowed;
        }
        :host([data-ic-contract-status="invalid"]) { opacity:.55; pointer-events:none; }
      </style>
      <button part="base" type="button"><ic-icon part="asset" name="play-filled" size="large" aria-hidden="true"></ic-icon></button>
    `;
    this.button = this.shadowRoot.querySelector('button');
  }

  get label() { return this.getAttribute('label') || ''; }
  set label(value) { this.setAttribute('label', String(value ?? '')); }
  get size() { return this.getAttribute('size') || 'm'; }
  set size(value) { this.setAttribute('size', String(value ?? '')); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }

  connectedCallback() {
    if (!this.hasAttribute('size')) this.setAttribute('size', 'm');
    this.syncContract();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncContract();
  }

  syncContract() {
    const label = this.label.trim();
    const size = this.size;
    const reason = !label
      ? 'label is required for ic-video-play-button'
      : !VALID_SIZES.has(size)
        ? 'size must be s or m for ic-video-play-button'
        : '';
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) this.dataset.icContractReason = reason;
    else delete this.dataset.icContractReason;
    this.button.setAttribute('aria-label', label);
    this.button.disabled = this.hasAttribute('disabled') || Boolean(reason);
    return !reason;
  }
}
