import { setContractStatus } from './shared.js';


export class IcFormField extends HTMLElement {
  static observedAttributes = ['label', 'hint', 'validation', 'required'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: grid; gap: var(--ui-space-1); }
        [part="validation"] { display: none; }
      </style>
      <slot name="control"></slot>
      <p part="validation" id="validation" role="alert"></p>`;
    this.shadowRoot.querySelector('slot').addEventListener('slotchange', () => this.sync());
  }

  connectedCallback() { this.sync(); }
  attributeChangedCallback() { this.sync(); }

  get control() {
    const controls = [...this.children].filter(child => ['IC-INPUT', 'IC-TEXTAREA'].includes(child.tagName));
    return controls.length === 1 ? controls[0] : null;
  }

  sync() {
    if (!this.shadowRoot) return;
    const controls = [...this.children].filter(child => ['IC-INPUT', 'IC-TEXTAREA'].includes(child.tagName));
    const control = controls.length === 1 ? controls[0] : null;
    const visibleLabel = this.getAttribute('label')?.trim() || '';
    const hiddenLabel = this.getAttribute('aria-label')?.trim() || control?.getAttribute('aria-label')?.trim() || '';
    const error = controls.length === 0
      ? 'ic-form-field requires one control'
      : controls.length > 1
        ? 'ic-form-field accepts only one control'
        : (!visibleLabel && !hiddenLabel ? 'ic-form-field requires label or aria-label' : '');
    setContractStatus(this, error);
    if (!control) return;
    if (typeof control.setCustomValidity !== 'function') {
      customElements.whenDefined(control.localName).then(() => {
        if (this.isConnected && control.isConnected) this.sync();
      });
      return;
    }

    if (control.getAttribute('slot') !== 'control') control.setAttribute('slot', 'control');
    control.label = visibleLabel;
    if (!visibleLabel && hiddenLabel) {
      control.setAttribute('aria-label', hiddenLabel);
      control.dataset.icFormFieldHiddenLabel = '';
    } else if (control.hasAttribute('data-ic-form-field-hidden-label')) {
      control.removeAttribute('aria-label');
      delete control.dataset.icFormFieldHiddenLabel;
    }
    const hint = this.getAttribute('hint') || '';
    const validation = this.getAttribute('validation') || '';
    control.hint = validation ? [hint, validation].filter(Boolean).join(' · ') : hint;
    control.required = this.hasAttribute('required');
    control.setCustomValidity(validation);
    if (validation) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
    this.shadowRoot.querySelector('[part="validation"]').textContent = validation;
    this.toggleAttribute('invalid', Boolean(validation));
  }
}
