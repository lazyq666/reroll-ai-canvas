const HEADING_LEVELS = new Set(['1', '2', '3']);

const styles = `
  :host { display:block; min-width:0; color:var(--ui-color-text-primary); }
  .heading { min-width:0; display:grid; gap:var(--ui-space-1); }
  h1,h2,h3 { margin:0; color:inherit; overflow-wrap:anywhere; }
  h1 { font:var(--ui-text-title-1); letter-spacing:var(--ui-letter-spacing-tight); }
  h2 { font:var(--ui-text-title-2); letter-spacing:var(--ui-letter-spacing-normal); }
  h3 { font:var(--ui-text-title-3); letter-spacing:var(--ui-letter-spacing-normal); }
  p { margin:0; color:var(--ui-color-text-tertiary); font:var(--ui-text-subtitle); overflow-wrap:anywhere; }
  :host([data-ic-contract-status="invalid"]) { opacity:.55; }
`;

function setContractStatus(host, error = '') {
  const status = error ? 'invalid' : 'ready';
  host.dataset.icContractStatus = status;
  if (error) host.setAttribute('ic-contract-error', error);
  else host.removeAttribute('ic-contract-error');
  if (error && host._lastContractError !== error) {
    host.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: { component: 'ic-heading', reason: error },
    }));
  }
  host._lastContractError = error;
}

export class IcHeading extends HTMLElement {
  static get observedAttributes() {
    return ['level', 'subtitle'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastContractError = '';
    this._contentObserver = new MutationObserver(() => this.render());
  }

  connectedCallback() {
    this._contentObserver.observe(this, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    this.render();
  }

  disconnectedCallback() {
    this._contentObserver.disconnect();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  get level() {
    return this.getAttribute('level') || '';
  }

  set level(value) {
    if (value === null || value === undefined || value === '') this.removeAttribute('level');
    else this.setAttribute('level', String(value));
  }

  get subtitle() {
    return this.getAttribute('subtitle') || '';
  }

  set subtitle(value) {
    if (value === null || value === undefined || value === '') this.removeAttribute('subtitle');
    else this.setAttribute('subtitle', String(value));
  }

  validateContract() {
    if (!HEADING_LEVELS.has(this.level)) return 'ic-heading level must be 1, 2 or 3';
    if (!this.textContent.trim()) return 'ic-heading requires a visible title';
    return '';
  }

  render() {
    const validLevel = HEADING_LEVELS.has(this.level) ? this.level : '2';
    const subtitle = this.subtitle.trim();
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="heading" part="base">
        <h${validLevel} part="title"><slot></slot></h${validLevel}>
        <p part="subtitle"${subtitle ? '' : ' hidden'}></p>
      </div>
    `;
    this.shadowRoot.querySelector('p').textContent = subtitle;
    setContractStatus(this, this.validateContract());
  }
}

export const IC_HEADING_LEVELS = Object.freeze(['1', '2', '3']);
