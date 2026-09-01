import WaButton from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/button/button.js';
import { withProjectEvents } from './shared.js';
import { BUTTON_STYLES } from './styles.js';


const BUTTON_HIERARCHIES = new Set(['primary', 'secondary', 'quiet']);
const BUTTON_TONES = new Set(['neutral', 'danger']);


export class IcButton extends withProjectEvents(WaButton, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static get styles() {
    return [...super.styles, BUTTON_STYLES];
  }

  static properties = {
    hierarchy: { reflect: true },
    tone: { reflect: true },
    ghost: { type: Boolean, reflect: true },
    toggle: { type: Boolean, reflect: true },
    pressed: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.usesDensitySize = !this.hasAttribute('size');
    this.hierarchy = 'secondary';
    this.tone = 'neutral';
    this.ghost = false;
    this.toggle = false;
    this.pressed = false;
    this.lastContractError = '';
    this.handleContractClick = this.handleContractClick.bind(this);
    this.addEventListener('click', this.handleContractClick, { capture: true });
  }

  get size() {
    return super.size;
  }

  set size(value) {
    const tracksDensity = this.usesDensitySize !== undefined;
    super.size = value;
    if (!tracksDensity) return;
    this.usesDensitySize = false;
    if (this.isConnected) this.removeAttribute('data-ic-density-size');
  }

  connectedCallback() {
    super.connectedCallback();
    this.toggleAttribute('data-ic-density-size', this.usesDensitySize);
  }

  get contractCombination() {
    return {
      hierarchy: this.hierarchy,
      tone: this.tone,
      presentation: this.ghost ? 'ghost' : 'default',
      behavior: this.toggle ? 'toggle' : 'action',
    };
  }

  get requiresVisibleLabel() {
    return true;
  }

  hasVisibleLabel() {
    return [...this.childNodes].some(node => {
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (['start', 'end'].includes(node.getAttribute('slot') || '')) return false;
      if (node.localName === 'ic-icon') return false;
      return Boolean(node.textContent?.trim());
    });
  }

  validateContract() {
    if (!BUTTON_HIERARCHIES.has(this.hierarchy)) {
      return `Unknown hierarchy: ${this.hierarchy || '(empty)'}`;
    }
    if (!BUTTON_TONES.has(this.tone)) {
      return `Unknown tone: ${this.tone || '(empty)'}`;
    }
    if (this.ghost && (
      this.hierarchy !== 'secondary'
      || this.tone !== 'neutral'
      || this.toggle
    )) {
      return 'ghost presentation requires a secondary neutral action';
    }
    if (this.toggle && this.hierarchy === 'primary') {
      return 'primary hierarchy cannot be combined with toggle behavior';
    }
    if (this.toggle && this.tone === 'danger') {
      return 'danger tone cannot be combined with toggle behavior';
    }
    if (!this.toggle && this.pressed) {
      return 'pressed state requires toggle behavior';
    }
    if (this.requiresVisibleLabel && !this.hasVisibleLabel()) {
      return 'ic-button requires a visible action label; icon-only actions use ic-icon-button';
    }
    return '';
  }

  syncEnginePresentation() {
    this.variant = this.tone === 'danger' ? 'danger' : 'neutral';
    this.appearance = this.ghost || this.hierarchy === 'quiet' ? 'plain' : (
      this.hierarchy === 'secondary' ? 'outlined' : 'accent'
    );
    if (this.toggle) this.type = 'button';
  }

  reportContractError(reason) {
    const signature = JSON.stringify({ reason, ...this.contractCombination });
    if (signature === this.lastContractError) return;
    this.lastContractError = signature;
    this.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: {
        component: this.localName,
        reason,
        combination: this.contractCombination,
      },
    }));
  }

  applyContractState() {
    const reason = this.validateContract();
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) {
      this.dataset.icContractReason = reason;
      this.setAttribute('aria-disabled', 'true');
      this.reportContractError(reason);
    } else {
      delete this.dataset.icContractReason;
      if (!this.disabled && !this.loading) this.removeAttribute('aria-disabled');
      this.lastContractError = '';
    }

    if (this.toggle && this.button) {
      this.button.setAttribute('aria-pressed', String(this.pressed));
    } else {
      this.button?.removeAttribute('aria-pressed');
    }
  }

  handleContractClick(event) {
    const reason = this.validateContract();
    if (reason) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.applyContractState();
      return;
    }
    if (this.toggle && !this.disabled && !this.loading) this.pressed = !this.pressed;
  }

  willUpdate(changedProperties) {
    this.syncEnginePresentation();
    super.willUpdate(changedProperties);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this.applyContractState();
  }

  click() {
    const reason = this.validateContract();
    if (reason) {
      this.applyContractState();
      return;
    }
    super.click();
  }
}
