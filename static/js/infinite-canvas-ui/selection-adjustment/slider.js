import WaSlider from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/slider/slider.js';
import { applyContractState, withProjectEvents } from './shared.js';


export class IcSlider extends withProjectEvents(WaSlider, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    valueText: { attribute: 'value-text', reflect: true },
  };

  constructor() {
    super();
    this.valueText = '';
    this.lastContractError = '';
    this.valueFormatter = value => this.valueText.trim() || String(value);
    const blockInvalidInteraction = event => {
      const reason = this.validateContract();
      if (!reason) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyContractState(this, reason);
    };
    this.addEventListener('click', blockInvalidInteraction, { capture: true });
    this.addEventListener('keydown', blockInvalidInteraction, { capture: true });
  }

  validateContract() {
    if (!String(this.label || '').trim()) return 'label is required for every ic-slider';
    for (const attribute of ['min', 'max', 'value']) {
      if (!this.hasAttribute(attribute)) return `${attribute} is required for every ic-slider`;
    }
    const min = Number(this.getAttribute('min'));
    const max = Number(this.getAttribute('max'));
    const value = Number(this.getAttribute('value'));
    const step = this.hasAttribute('step') ? Number(this.getAttribute('step')) : 1;
    if (![min, max, value, step].every(Number.isFinite)) return 'ic-slider range values must be finite numbers';
    if (max <= min) return 'ic-slider max must be greater than min';
    if (step <= 0) return 'ic-slider step must be greater than zero';
    if (value < min || value > max) return 'ic-slider value must stay within min and max';
    const steps = (value - min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return 'ic-slider value must align with its step';
    return '';
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


