import { IcComposite } from './composite.js';
import { contractState } from './shared.js';


export class IcFloatingToolbar extends IcComposite {
  static observedAttributes = ['label', 'layout', 'overflow'];
  validateContract() {
    const layout = this.getAttribute('layout') || 'inline';
    const overflow = this.getAttribute('overflow') || 'scroll';
    if (!this.getAttribute('label')?.trim()) return 'label is required';
    if (layout !== 'inline') return 'layout must be inline';
    if (!['scroll', 'clip'].includes(overflow)) return 'overflow must be scroll or clip';
    return '';
  }
  render() {
    contractState(this, this.validateContract());
    this.setAttribute('role', 'toolbar');
    this.setAttribute('aria-label', this.getAttribute('label') || '');
    this.setAttribute('aria-orientation', 'horizontal');
    this.shadowRoot.innerHTML = `<style>
      :host{box-sizing:border-box;display:inline-flex;max-inline-size:100%;min-inline-size:0;color:var(--ui-color-text-primary);vertical-align:middle}
      .surface{box-sizing:border-box;display:flex;max-inline-size:100%;min-inline-size:0;padding:var(--ui-space-1);border:var(--ui-border-width-thin) solid color-mix(in srgb,var(--ui-color-border-secondary) 76%,transparent);border-radius:var(--ui-radius-l);background:color-mix(in srgb,var(--ui-color-surface-floating) 84%,transparent);box-shadow:var(--ui-shadow-overlay);backdrop-filter:blur(18px) saturate(1.12)}
      .content{box-sizing:border-box;display:flex;align-items:center;gap:var(--ui-density-gap);max-inline-size:100%;min-inline-size:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-inline:contain;scrollbar-width:none;white-space:nowrap}
      .content::-webkit-scrollbar{display:none}
      :host([overflow="clip"]) .content{overflow:hidden}
      ::slotted([hidden]){display:none!important}
    </style><div class="surface" part="surface"><div class="content" part="content"><slot></slot></div></div>`;
  }
}
