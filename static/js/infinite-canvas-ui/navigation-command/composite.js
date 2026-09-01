import { moveComposite } from './shared.js';


export class IcComposite extends HTMLElement {
  constructor() { super(); this._lastContractError = ''; this.attachShadow({mode: 'open'}); this._childObserver = new MutationObserver(() => this.render()); }
  connectedCallback() { this.render(); this._childObserver.observe(this, {childList: true}); this.addEventListener('keydown', event => this.onKeydown(event)); this.addEventListener('click', event => this.onClick(event)); }
  disconnectedCallback() { this._childObserver.disconnect(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  get orientation() { return this.getAttribute('orientation') || 'horizontal'; }
  items() { return [...this.children].filter(item => item.matches('button,[href],[data-value]') && !item.hasAttribute('disabled')); }
  onKeydown(event) { moveComposite(this.items(), event.target.closest('button,[href],[data-value]'), event, this.orientation); }
  onClick() {}
}

