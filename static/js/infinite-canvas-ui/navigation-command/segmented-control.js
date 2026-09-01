import { IcComposite } from './composite.js';
import { COMPONENT_SIZES, contractState, moveComposite, NAVIGATION_SIZE_STYLES } from './shared.js';


export class IcSegmentedControl extends IcComposite {
  static observedAttributes = ['label', 'value', 'disabled', 'size'];
  attributeChangedCallback(name) {
    if (name === 'value' && this.isConnected && this.shadowRoot.hasChildNodes()) {
      this.syncSelection();
      return;
    }
    super.attributeChangedCallback();
  }
  validateContract() { const size = this.getAttribute('size'); if (!this.getAttribute('label')?.trim()) return 'label is required'; if (!this.getAttribute('value')?.trim()) return 'value is required'; if (size && !COMPONENT_SIZES.has(size)) return 'size must be small, medium, or large'; const count = [...this.children].filter(item => item.dataset.value).length; if (count && (count < 2 || count > 5)) return 'Segmented Control requires two to five options'; return ''; }
  render() {
    contractState(this, this.validateContract()); this.setAttribute('role', 'radiogroup'); this.setAttribute('aria-label', this.getAttribute('label') || '');
    this.syncSelection();
    this.shadowRoot.innerHTML = `<style>
      ${NAVIGATION_SIZE_STYLES}
      :host {
        box-sizing: border-box;
        display: inline-flex;
        inline-size: max-content;
        max-inline-size: 100%;
        block-size: var(--ic-navigation-control-height);
        align-items: center;
        gap: var(--ui-space-1);
        padding: var(--ui-space-1);
        border: var(--ui-border-width-thin) solid var(--ui-color-border-segmented-control);
        border-radius: 10px;
        background: var(--ui-color-surface-subtle);
        --ic-navigation-state-duration: var(--ui-motion-duration-fast);
      }
      :host([size="small"]) {
        --ic-navigation-control-height: var(--ui-control-height-s);
        --ic-navigation-font-size: var(--ui-font-size-1);
        --ic-navigation-inline-padding: var(--ui-space-2);
      }
      :host([size="medium"]) {
        --ic-navigation-control-height: var(--ui-control-height-m);
        --ic-navigation-font-size: var(--ui-font-size-2);
        --ic-navigation-inline-padding: 10px;
      }
      :host([size="large"]) {
        --ic-navigation-control-height: var(--ui-control-height-l);
        --ic-navigation-font-size: var(--ui-font-size-3);
        --ic-navigation-inline-padding: var(--ui-space-3);
      }
      ::slotted([role="radio"]) {
        box-sizing: border-box;
        height: calc(var(--ic-navigation-control-height) - 2 * var(--ui-space-1) - 2 * var(--ui-border-width-thin));
        min-height: calc(var(--ic-navigation-control-height) - 2 * var(--ui-space-1) - 2 * var(--ui-border-width-thin));
        padding: 0 var(--ic-navigation-inline-padding);
        border: var(--ui-border-width-thin) solid transparent;
        border-radius: var(--ui-radius-s);
        background: var(--ui-color-action-tertiary);
        color: var(--ui-color-text-tertiary);
        font: inherit;
        font-size: var(--ic-navigation-font-size) !important;
        font-weight: var(--ui-font-weight-regular);
        white-space: nowrap;
        transition: background-color var(--ic-navigation-state-duration) var(--ui-motion-ease-standard), color var(--ic-navigation-state-duration) var(--ui-motion-ease-standard), border-color var(--ic-navigation-state-duration) var(--ui-motion-ease-standard), box-shadow var(--ic-navigation-state-duration) var(--ui-motion-ease-standard);
      }
      ::slotted([role="radio"]:hover:not(:disabled):not([aria-checked="true"])) { background: var(--ui-color-action-tertiary-hover); color: var(--ui-color-text-primary); }
      ::slotted([role="radio"][aria-checked="true"]) {
        outline: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
        outline-offset: 0;
        background: var(--ui-color-surface);
        color: var(--ui-color-text-primary);
        font-weight: var(--ui-font-weight-medium);
        box-shadow: var(--ui-shadow-raised);
      }
      :host([data-legal-combination="single-label"])::slotted([role="radio"][aria-checked="true"]),
      :host([data-legal-combination="single-icon-label"])::slotted([role="radio"][aria-checked="true"]) {
        background: var(--ui-color-surface);
        color: var(--ui-color-text-primary);
      }
      ::slotted([role="radio"]:disabled) {
        border-color: var(--ui-color-border-disabled);
        background: var(--ui-color-action-tertiary-disabled);
        color: var(--ui-color-text-disabled);
        opacity: 1;
        cursor: not-allowed;
        box-shadow: none;
      }
      ::slotted([role="radio"]:focus-visible) { position: relative; z-index: 1; outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); box-shadow: var(--ui-focus-ring-shadow); }
      :host-context(html[data-ui-motion="reduced"]) { --ic-navigation-state-duration: 1ms; }
      @media(prefers-reduced-motion:reduce) { :host { --ic-navigation-state-duration: 1ms; } }
    </style><slot></slot>`;
  }
  syncSelection() {
    const value = this.getAttribute('value'); [...this.children].filter(item => item.dataset.value).forEach(item => {
      const active = item.dataset.value === value;
      item.setAttribute('role', 'radio');
      item.setAttribute('aria-checked', String(active));
      item.tabIndex = active ? 0 : -1;
      item.toggleAttribute('disabled', this.hasAttribute('disabled') || item.hasAttribute('data-disabled'));
      if (!item._icSegmentedActivationBound) {
        item._icSegmentedActivationBound = true;
        item.addEventListener('click', () => this.activate(item));
      }
    });
  }
  activate(item) { if (!item?.dataset.value || item.disabled) return; this.setAttribute('value', item.dataset.value); this.dispatchEvent(new CustomEvent('ic-change', {bubbles: true, composed: true, detail: {value: item.dataset.value}})); }
  onClick(event) { this.activate(event.composedPath().find(node => node?.getAttribute?.('role') === 'radio')); }
  onKeydown(event) { const moved = moveComposite(this.items(), event.target.closest('[role="radio"]'), event, 'horizontal'); if (moved) this.activate(moved); }
}
