import WaSwitch from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/switch/switch.js';
import { applyContractState, withProjectEvents } from './shared.js';


export class IcSwitch extends withProjectEvents(WaSwitch, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    label: { reflect: true },
  };

  constructor() {
    super();
    this.label = '';
    this.lastContractError = '';
    this.ownedLabel = null;
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


