import WaInput from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/input/input.js';
import { applyContractState, withProjectEvents } from './shared.js';


export class IcNumberInput extends withProjectEvents(WaInput, {
  'wa-clear': 'ic-clear',
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  constructor() {
    super();
    this.type = 'number';
    this.lastContractError = '';
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
    if (!String(this.label || '').trim()) return 'label is required for every ic-number-input';
    if (!String(this.name || '').trim()) return 'name is required for every ic-number-input';
    if (this.type !== 'number') return 'ic-number-input does not accept another input type';

    const hasMin = this.hasAttribute('min');
    const hasMax = this.hasAttribute('max');
    const min = hasMin ? Number(this.min) : null;
    const max = hasMax ? Number(this.max) : null;
    if (hasMin && !Number.isFinite(min)) return 'ic-number-input min must be a finite number';
    if (hasMax && !Number.isFinite(max)) return 'ic-number-input max must be a finite number';
    if (hasMin && hasMax && max < min) return 'ic-number-input max must be greater than or equal to min';

    const step = this.hasAttribute('step') ? this.step : 1;
    if (step !== 'any' && (!Number.isFinite(Number(step)) || Number(step) <= 0)) {
      return 'ic-number-input step must be a positive number or any';
    }
    const rawValue = String(this.value ?? '').trim();
    if (!rawValue) return '';
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return 'ic-number-input value must be a finite number';
    if (hasMin && value < min || hasMax && value > max) return 'ic-number-input value must stay within min and max';
    if (step !== 'any') {
      const base = hasMin ? min : 0;
      const steps = (value - base) / Number(step);
      if (Math.abs(steps - Math.round(steps)) > 1e-9) return 'ic-number-input value must align with its step';
    }
    return '';
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    const reason = this.validateContract();
    if (this.input) this.input.disabled = Boolean(this.disabled || reason);
    applyContractState(this, reason);
  }
}


