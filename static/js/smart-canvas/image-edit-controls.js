const FIELD_STYLE = `
  :host {
    box-sizing:border-box;
    display:inline-flex;
    min-width:0;
    min-height:var(--ui-control-height-s);
    align-items:center;
    gap:var(--ui-space-2);
    color:var(--ui-color-text-primary);
    font:var(--ui-text-label);
    white-space:nowrap;
  }
  :host([hidden]) { display:none!important; }
  :host(ic-image-edit-slider) { padding-inline-end:var(--ui-space-2); }
  *,*::before,*::after { box-sizing:border-box; }
  slot { display:flex; min-width:0; align-items:center; gap:var(--ui-space-2); white-space:nowrap; }
  ::slotted(.image-edit-option-name) { color:var(--ui-color-text-tertiary); font:var(--ui-text-label); }
  ::slotted(.image-edit-option-input) { display:flex; min-width:0; align-items:center; gap:var(--ui-space-1); }
  :host(ic-image-edit-slider) ::slotted(.image-edit-option-input) { gap:var(--ui-space-3); padding-inline-start:var(--ui-space-3); }
`;

class ImageEditField extends HTMLElement {
  static observedAttributes = ['label'];

  constructor() {
    super();
    this.attachShadow({mode:'open'});
  }

  connectedCallback() {
    this.syncLabel();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'group');
    this.shadowRoot.innerHTML = `<style>${FIELD_STYLE}</style><slot></slot>`;
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncLabel();
  }

  syncLabel() {
    const explicitLabel = this.getAttribute('label')?.trim();
    if (explicitLabel) this.setAttribute('aria-label', explicitLabel);
    else this.removeAttribute('aria-label');
    this.dataset.icContractStatus = explicitLabel ? 'ready' : 'invalid';
  }
}

export class ImageEditSelector extends ImageEditField {}
export class ImageEditSlider extends ImageEditField {}
export class ImageEditValue extends ImageEditField {}

const IMAGE_EDIT_FIELDS = [
  ['ic-image-edit-selector', ImageEditSelector],
  ['ic-image-edit-slider', ImageEditSlider],
  ['ic-image-edit-value', ImageEditValue],
];

IMAGE_EDIT_FIELDS.forEach(([name, constructor]) => {
  if (!customElements.get(name)) customElements.define(name, constructor);
});
