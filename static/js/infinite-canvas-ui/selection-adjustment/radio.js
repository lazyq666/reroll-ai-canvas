import WaRadio from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/radio/radio.js';
import { applyContractState } from './shared.js';


export class IcRadio extends WaRadio {
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
    if (!this.ownedLabel) {
      this.ownedLabel = document.createElement('span');
      this.ownedLabel.dataset.icOwnedLabel = '';
      this.append(this.ownedLabel);
    }
    this.ownedLabel.textContent = this.label.trim();
  }

  validateContract() {
    if (!this.closest('ic-radio-group')) return 'ic-radio is only valid inside ic-radio-group';
    if (!this.label.trim()) return 'label is required for every ic-radio';
    if (!this.value.trim()) return 'value is required for every ic-radio';
    return '';
  }

  updated(changedProperties) {
    this.syncOwnedLabel();
    super.updated(changedProperties);
    applyContractState(this, this.validateContract(), { value: this.value });
  }

  click() {
    const reason = this.validateContract();
    if (reason) {
      applyContractState(this, reason, { value: this.value });
      return;
    }
    super.click();
  }
}


