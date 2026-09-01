import { contractState } from './shared.js';


export class IcBreadcrumb extends HTMLElement {
  static observedAttributes = ['label'];
  constructor() { super(); this._lastContractError = ''; this.attachShadow({mode: 'open'}); }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() { contractState(this, this.getAttribute('label')?.trim() ? '' : 'label is required'); this.setAttribute('role', 'navigation'); this.setAttribute('aria-label', this.getAttribute('label') || ''); const items = [...this.children]; items.forEach((item, index) => { item.toggleAttribute('data-current', index === items.length - 1); if (index === items.length - 1) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); }); this.shadowRoot.innerHTML = `<style>:host{display:block;overflow:hidden}ol{display:flex;align-items:center;gap:var(--ui-space-2);margin:0;padding:0;list-style:none;white-space:nowrap;font-size:var(--ui-density-font-size);color:var(--ui-color-text-tertiary)}::slotted(*){min-width:0}::slotted(:not(:last-child))::after{content:"/";margin-inline-start:var(--ui-space-2);color:var(--ui-color-text-tertiary)}::slotted([data-current]){overflow:hidden;text-overflow:ellipsis;color:var(--ui-color-text-primary)}</style><ol><slot></slot></ol>`; }
}

