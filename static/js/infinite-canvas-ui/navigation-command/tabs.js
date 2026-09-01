import { IcComposite } from './composite.js';
import { COMPONENT_SIZES, contractState, moveComposite, NAVIGATION_SIZE_STYLES, ORIENTATIONS } from './shared.js';


export class IcTabs extends IcComposite {
  static observedAttributes = ['label', 'value', 'orientation', 'activation', 'size', 'space'];
  attributeChangedCallback(name) {
    if (name === 'value' && this.isConnected && this.shadowRoot.hasChildNodes()) {
      this.syncSelection();
      return;
    }
    super.attributeChangedCallback();
  }
  items() { return [...this.children].filter(item => item.hasAttribute('data-value') && !item.hasAttribute('disabled')); }
  validateContract() { const size = this.getAttribute('size'); const space = this.getAttribute('space')?.trim(); if (!this.getAttribute('label')?.trim()) return 'label is required'; if (!ORIENTATIONS.has(this.orientation)) return 'orientation must be horizontal or vertical'; if (!['automatic', 'manual'].includes(this.getAttribute('activation') || 'automatic')) return 'activation must be automatic or manual'; if (size && !COMPONENT_SIZES.has(size)) return 'size must be small, medium, or large'; if (space && globalThis.CSS?.supports && !CSS.supports('gap', space)) return 'space must be a valid CSS gap value'; return ''; }
  render() {
    contractState(this, this.validateContract());
    const space = this.getAttribute('space')?.trim();
    if (space && (!globalThis.CSS?.supports || CSS.supports('gap', space))) this.style.setProperty('--ic-tabs-space', space);
    else this.style.removeProperty('--ic-tabs-space');
    this.setAttribute('role', 'tablist'); this.setAttribute('aria-label', this.getAttribute('label') || ''); this.setAttribute('aria-orientation', this.orientation);
    this.syncSelection();
    this.shadowRoot.innerHTML = `<style>${NAVIGATION_SIZE_STYLES}:host{box-sizing:border-box;display:flex;gap:var(--ic-tabs-space,0.125rem);padding:var(--ui-focus-ring-width);overflow:auto;--ic-tabs-selected-background:var(--ui-color-action-secondary-selected);--ic-navigation-state-duration:var(--ui-motion-duration-fast)}:host([data-legal-combination="horizontal-automatic-label"]){border-radius:10px}:host([data-legal-combination="horizontal-automatic-label"]),:host([data-legal-combination="horizontal-manual-label-icon"]),:host([data-legal-combination="vertical-manual-label"]){--ic-tabs-selected-background:var(--ui-color-action-secondary-selected)}:host([orientation="vertical"]){inline-size:min(16rem,100%);flex-direction:column}::slotted([role="tab"]){display:inline-flex;align-items:center;justify-content:center;gap:var(--ui-space-2);box-sizing:border-box;height:var(--ic-navigation-control-height);min-height:var(--ic-navigation-control-height);padding-block:0;padding-inline:var(--ic-tabs-item-inline-padding,var(--ic-navigation-inline-padding));border:0;border-radius:var(--ui-radius-s);background:var(--ui-color-action-tertiary);color:var(--ui-color-text-tertiary);font:inherit;font-size:var(--ic-navigation-font-size)!important;white-space:nowrap;transition:background-color var(--ic-navigation-state-duration) var(--ui-motion-ease-standard),color var(--ic-navigation-state-duration) var(--ui-motion-ease-standard)}::slotted([role="tab"]:hover:not(:disabled)){background:var(--ui-color-action-tertiary-hover);color:var(--ui-color-text-primary)}::slotted([role="tab"][aria-selected="true"]){background:var(--ic-tabs-selected-background);color:var(--ui-color-text-primary);font-weight:var(--ui-font-weight-medium)}::slotted([role="tab"]:disabled){background:var(--ui-color-action-tertiary-disabled);color:var(--ui-color-text-disabled);opacity:1;cursor:not-allowed} :host([orientation="vertical"])::slotted([role="tab"]){border-radius:var(--ui-radius-s);text-align:start}::slotted([role="tab"]:focus-visible){position:relative;z-index:1;outline:var(--ui-focus-ring);outline-offset:var(--ui-focus-ring-offset);box-shadow:var(--ui-focus-ring-shadow)}:host-context(html[data-ui-motion="reduced"]){--ic-navigation-state-duration:1ms}@media(prefers-reduced-motion:reduce){:host{--ic-navigation-state-duration:1ms}}</style><slot></slot>`;
  }
  syncSelection() {
    const items = [...this.children].filter(item => item.hasAttribute('data-value'));
    const selected = this.getAttribute('value') || items[0]?.dataset.value || '';
    items.forEach(item => {
      const active = item.dataset.value === selected;
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
  }
  activate(item) { if (!item?.dataset.value || item.hasAttribute('disabled')) return; this.setAttribute('value', item.dataset.value); this.dispatchEvent(new CustomEvent('ic-change', {bubbles: true, composed: true, detail: {value: item.dataset.value}})); }
  eventTab(event) {
    const path = event.composedPath();
    const tab = path.find(node => node?.getAttribute?.('role') === 'tab');
    const nestedControl = path.find(node => node !== tab && node?.matches?.('button,a,input,select,textarea,ic-button,ic-icon-button,ic-input,ic-select,ic-textarea,ic-file-input'));
    return nestedControl ? null : tab;
  }
  onClick(event) { this.activate(this.eventTab(event)); }
  onKeydown(event) { const tab = this.eventTab(event); if (!tab) return; const moved = moveComposite(this.items(), tab, event, this.orientation); if (moved && (this.getAttribute('activation') || 'automatic') === 'automatic') this.activate(moved); if (['Enter', ' '].includes(event.key) && (this.getAttribute('activation') || 'automatic') === 'manual') { event.preventDefault(); this.activate(tab); } }
}
