import { contractState } from './shared.js';


export class IcNavDisclosure extends HTMLElement {
  static observedAttributes = ['label', 'icon', 'open-icon', 'open', 'compact', 'disabled'];
  constructor() {
    super();
    this._lastContractError = '';
    this._childStateObserver = new MutationObserver(() => this.syncChildCurrentState());
    this.attachShadow({mode: 'open'});
  }
  connectedCallback() {
    this._childStateObserver.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['current'] });
    this.syncChildCurrentState();
    this.render();
  }
  disconnectedCallback() { this._childStateObserver.disconnect(); }
  attributeChangedCallback(name) {
    if (name === 'open' && this.isConnected && this.shadowRoot.hasChildNodes()) {
      this.syncOpenPresentation();
      return;
    }
    if (this.isConnected) this.render();
  }
  get open() { return this.hasAttribute('open'); }
  set open(value) { this.toggleAttribute('open', Boolean(value)); }
  syncChildCurrentState() {
    this.toggleAttribute('data-child-current', Boolean(this.querySelector(':scope > ic-nav-item[current]')));
  }
  syncOpenPresentation() {
    const trigger = this.shadowRoot.querySelector('.trigger');
    if (!trigger) return;
    const open = this.open;
    trigger.setAttribute('aria-expanded', String(open));
    const icon = trigger.querySelector('ic-icon');
    if (icon) icon.name = open
      ? (this.getAttribute('open-icon')?.trim() || this.getAttribute('icon')?.trim() || '')
      : (this.getAttribute('icon')?.trim() || '');
  }
  validateContract() {
    if (!this.getAttribute('label')?.trim()) return 'label is required';
    if (!this.getAttribute('icon')?.trim()) return 'icon is required';
    if (![...this.children].every(item => item.localName === 'ic-nav-item')) return 'children must be ic-nav-item elements';
    return '';
  }
  toggle(next = !this.open) {
    if (this.hasAttribute('disabled')) return;
    this.open = Boolean(next);
    this.dispatchEvent(new CustomEvent('ic-toggle', {
      bubbles: true,
      composed: true,
      detail: { open: this.open },
    }));
  }
  render() {
    const label = this.getAttribute('label')?.trim() || '';
    const open = this.open;
    const disabled = this.hasAttribute('disabled');
    const icon = open
      ? (this.getAttribute('open-icon')?.trim() || this.getAttribute('icon')?.trim())
      : this.getAttribute('icon')?.trim();
    contractState(this, this.validateContract());
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', label);
    this.shadowRoot.innerHTML = `<style>:host{display:block;min-width:0;color:var(--ic-nav-disclosure-color,var(--ui-color-text-tertiary));--ic-nav-disclosure-duration:var(--ui-motion-duration-normal);--ic-nav-disclosure-fade-duration:var(--ui-motion-duration-fast)}.trigger{box-sizing:border-box;display:flex;align-items:center;gap:var(--ui-density-gap);width:100%;min-height:var(--ui-density-control-height);padding-block:0;padding-inline:var(--ui-density-inline-padding);border:0;border-radius:var(--ui-radius-m);background:var(--ui-color-action-tertiary);color:inherit;font:inherit;font-size:var(--ui-density-font-size);text-align:start;white-space:nowrap;cursor:pointer;transition:background-color var(--ic-nav-disclosure-fade-duration) var(--ui-motion-ease-standard),color var(--ic-nav-disclosure-fade-duration) var(--ui-motion-ease-standard)}.trigger>ic-icon{inline-size:var(--ui-density-icon-size);block-size:var(--ui-density-icon-size);max-inline-size:var(--ui-density-icon-size);max-block-size:var(--ui-density-icon-size);flex:0 0 var(--ui-density-icon-size);overflow:hidden;contain:size layout paint}.trigger:hover:not(:disabled){background:var(--ui-color-action-tertiary-hover);color:var(--ic-nav-disclosure-active-color,var(--ui-color-text-primary))}:host(:not([data-child-current])) .trigger[aria-expanded="true"]{background:var(--ui-color-action-secondary-selected);color:var(--ic-nav-disclosure-active-color,var(--ui-color-text-primary));font-weight:var(--ui-font-weight-medium)}.trigger:focus-visible{outline:var(--ui-focus-ring);outline-offset:var(--ui-focus-ring-offset);box-shadow:var(--ui-focus-ring-shadow)}.trigger:disabled{color:var(--ui-color-text-disabled);background:var(--ui-color-action-tertiary-disabled);opacity:1;cursor:not-allowed}.items{display:grid;grid-template-rows:0fr;opacity:0;pointer-events:none;transition:grid-template-rows var(--ic-nav-disclosure-duration) var(--ui-motion-ease-fluid),opacity var(--ic-nav-disclosure-fade-duration) var(--ui-motion-ease-standard)}.items-inner{min-height:0;display:flex;flex-direction:column;gap:var(--ui-space-1);overflow:hidden}:host([open]) .items{grid-template-rows:1fr;opacity:1;pointer-events:auto}::slotted(ic-nav-item){--ic-nav-item-height:var(--ui-control-height-m);--ic-nav-item-padding-inline-start:calc(var(--ui-density-inline-padding) + var(--ui-density-icon-size) + var(--ui-density-gap));--ic-nav-item-selected-background:var(--ui-color-action-secondary-selected);--ic-nav-item-selected-color:var(--ui-color-text-primary);--ic-nav-item-selected-shadow:none}:host([compact]){width:var(--ui-density-control-height);align-self:center}:host([compact]) .trigger{width:var(--ui-density-control-height);height:var(--ui-density-control-height);min-height:0;justify-content:center;padding:0}:host([compact]) .label{display:none}:host([compact]) .items{display:none}:host-context(html[data-ui-motion="reduced"]){--ic-nav-disclosure-duration:1ms;--ic-nav-disclosure-fade-duration:1ms}@media(prefers-reduced-motion:reduce){:host{--ic-nav-disclosure-duration:1ms;--ic-nav-disclosure-fade-duration:1ms}}</style><button class="trigger" part="base trigger" type="button" aria-expanded="${String(open)}" ${disabled ? 'disabled' : ''}><ic-icon name="${icon || ''}"></ic-icon><span class="label">${label}</span></button><div class="items" part="items"><div class="items-inner"><slot></slot></div></div>`;
    this.shadowRoot.querySelector('.trigger')?.addEventListener('click', () => this.toggle());
  }
}
