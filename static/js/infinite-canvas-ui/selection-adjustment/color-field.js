import WaColorPicker from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/color-picker/color-picker.js';
import { applyContractState, withProjectEvents } from './shared.js';


export class IcColorField extends withProjectEvents(WaColorPicker, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    readonly: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.format = 'hex';
    this.withoutFormatToggle = true;
    this.opacity = false;
    this.readonly = false;
    this.lastContractError = '';
    const blockUnavailableInteraction = event => {
      const reason = this.validateContract();
      if (!reason && !this.readonly) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (reason) applyContractState(this, reason);
    };
    this.addEventListener('click', blockUnavailableInteraction, { capture: true });
    this.addEventListener('keydown', blockUnavailableInteraction, { capture: true });
  }

  validateContract() {
    if (!String(this.label || '').trim()) return 'label is required for every ic-color-field';
    if (!String(this.name || '').trim()) return 'name is required for every ic-color-field';
    if (!this.hasAttribute('value')) return 'value is required for every ic-color-field';
    const value = String(this.value || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) return 'ic-color-field value must be a six-digit hexadecimal UI color';
    if (this.opacity || this.format !== 'hex') return 'ic-color-field exposes one stable hexadecimal text value';
    return '';
  }

  async show() {
    const reason = this.validateContract();
    if (reason || this.readonly) {
      if (reason) applyContractState(this, reason);
      return;
    }
    return super.show();
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    const reason = this.validateContract();
    this.toggleAttribute('aria-readonly', this.readonly);
    if (this.trigger) this.trigger.setAttribute('aria-readonly', String(this.readonly));
    applyContractState(this, reason);
  }
}
