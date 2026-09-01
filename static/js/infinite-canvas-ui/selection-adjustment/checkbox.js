import WaCheckbox from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/checkbox/checkbox.js';
import { applyContractState, CHECKBOX_APPEARANCES, withProjectEvents } from './shared.js';


export class IcCheckbox extends withProjectEvents(WaCheckbox, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    label: { reflect: true },
    appearance: { reflect: true },
    icon: { reflect: true },
    tag: { reflect: true },
  };

  constructor() {
    super();
    this.label = '';
    this.appearance = 'default';
    this.icon = '';
    this.tag = '';
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
    const label = this.label.trim();
    if (this.appearance !== 'checkmark-end' || (!this.icon.trim() && !this.tag.trim())) {
      this.ownedLabel.textContent = label;
      return;
    }

    const content = document.createElement('span');
    content.dataset.icCheckboxContent = '';
    const title = document.createElement('span');
    title.dataset.icCheckboxTitle = '';
    title.textContent = label;
    content.append(title);

    const nodes = [];
    if (this.icon.trim()) {
      const icon = document.createElement('ic-icon');
      icon.dataset.icCheckboxIcon = '';
      icon.setAttribute('name', this.icon.trim());
      icon.setAttribute('size', 'small');
      nodes.push(icon);
    }
    nodes.push(content);
    if (this.tag.trim()) {
      const tag = document.createElement('span');
      tag.dataset.icCheckboxTag = '';
      tag.textContent = this.tag.trim();
      nodes.push(tag);
    }
    this.ownedLabel.replaceChildren(...nodes);
  }

  validateContract() {
    if (!this.label.trim()) return 'label is required for every ic-checkbox';
    if (!CHECKBOX_APPEARANCES.has(this.appearance)) return `Unsupported ic-checkbox appearance: ${this.appearance}`;
    return '';
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

