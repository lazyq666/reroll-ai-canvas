import WaRadioGroup from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/radio-group/radio-group.js';
import { applyContractState, RADIO_GROUP_APPEARANCES, withProjectEvents } from './shared.js';


export class IcRadioGroup extends withProjectEvents(WaRadioGroup, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    appearance: { reflect: true },
  };

  constructor() {
    super();
    this.appearance = 'default';
    this.lastContractError = '';
    this.addEventListener('click', event => this.handleProjectRadioClick(event), { capture: true });
  }

  get validationTarget() {
    return this.querySelector('ic-radio:not([disabled])') || undefined;
  }

  getAllRadios() {
    return [...this.querySelectorAll(':scope > ic-radio')];
  }

  validateContract() {
    if (!String(this.label || '').trim()) return 'label is required for every ic-radio-group';
    if (!String(this.name || '').trim()) return 'name is required for every ic-radio-group';
    if (!RADIO_GROUP_APPEARANCES.has(this.appearance)) return `Unsupported ic-radio-group appearance: ${this.appearance}`;
    if (this.appearance === 'tabs' && this.orientation !== 'horizontal') return 'tabs appearance requires horizontal orientation';
    const invalidChild = [...this.children].find(child => child.localName !== 'ic-radio');
    if (invalidChild) return `ic-radio-group children must be ic-radio, received ${invalidChild.localName}`;
    return '';
  }

  handleProjectRadioClick(event) {
    const radio = event.target.closest?.('ic-radio');
    if (!radio || radio.parentElement !== this) return;
    event.stopImmediatePropagation();
    const reason = this.validateContract() || radio.validateContract();
    if (reason || radio.disabled || this.disabled) {
      event.preventDefault();
      applyContractState(this, reason || 'disabled radio cannot be selected');
      return;
    }

    const previousValue = this.value;
    this.value = radio.value;
    for (const item of this.getAllRadios()) {
      item.checked = item === radio;
      item.tabIndex = item === radio ? 0 : -1;
    }
    if (this.value !== previousValue) {
      this.updateComplete.then(() => {
        this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      });
    }
  }

  formResetCallback(...args) {
    super.formResetCallback(...args);
    this.updateFormValue(this.value);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    applyContractState(this, this.validateContract());
  }
}


