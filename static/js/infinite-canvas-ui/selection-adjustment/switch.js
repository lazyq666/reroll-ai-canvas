import WaSwitch from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/switch/switch.js';
import { applyContractState, withProjectEvents } from './shared.js?v=asset-15b3b74e35cb';


export class IcSwitch extends withProjectEvents(WaSwitch, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    label: { reflect: true },
    labelledBy: { attribute: 'aria-labelledby' },
  };

  constructor() {
    super();
    this.label = '';
    this.lastContractError = '';
    this.ownedLabel = null;
    this.accessibleNameObserver = new MutationObserver(() => this.syncAccessibleName());
    this.addEventListener('click', event => {
      const reason = this.validateContract();
      if (!reason) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyContractState(this, reason);
    }, { capture: true });
  }

  connectedCallback() {
    this.syncOwnedLabel();
    super.connectedCallback();
  }

  disconnectedCallback() {
    this.accessibleNameObserver.disconnect();
    super.disconnectedCallback();
  }

  syncAccessibleName() {
    const control = this.shadowRoot?.querySelector('input');
    if (!control) return;
    this.accessibleNameObserver.disconnect();
    if (!this.hasAttribute('aria-labelledby')) {
      control.removeAttribute('aria-label');
      return;
    }
    const root = this.getRootNode();
    const references = (this.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => root.getElementById?.(id)).filter(Boolean);
    const name = references.map(element => element.textContent.trim()).filter(Boolean).join(' ') || this.label;
    control.setAttribute('aria-label', name);
    references.forEach(element => this.accessibleNameObserver.observe(element, {
      childList: true, characterData: true, subtree: true,
    }));
  }

  syncOwnedLabel() {
    if (this.hasAttribute('aria-labelledby')) {
      this.ownedLabel?.remove();
      this.ownedLabel = null;
      return;
    }
    if (!this.ownedLabel) {
      this.ownedLabel = document.createElement('span');
      this.ownedLabel.dataset.icOwnedLabel = '';
      this.append(this.ownedLabel);
    }
    this.ownedLabel.textContent = this.label.trim();
  }

  validateContract() {
    return this.label.trim() ? '' : 'label is required for every ic-switch';
  }

  updated(changedProperties) {
    this.syncOwnedLabel();
    super.updated(changedProperties);
    this.syncAccessibleName();
    applyContractState(this, this.validateContract());
  }

  click() {
    const reason = this.validateContract();
    if (reason) {
      applyContractState(this, reason);
      return;
    }
    super.click();
  }
}


