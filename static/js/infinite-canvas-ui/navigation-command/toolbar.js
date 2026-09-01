import { IcComposite } from './composite.js';
import { contractState, ORIENTATIONS } from './shared.js';


export class IcToolbar extends IcComposite {
  static observedAttributes = ['label', 'orientation', 'appearance'];
  validateContract() { const appearance = this.getAttribute('appearance') || 'framed'; if (!this.getAttribute('label')?.trim()) return 'label is required'; if (!ORIENTATIONS.has(this.orientation)) return 'orientation must be horizontal or vertical'; if (!['framed', 'plain'].includes(appearance)) return 'appearance must be framed or plain'; return ''; }
  render() { contractState(this, this.validateContract()); this.setAttribute('role', 'toolbar'); this.setAttribute('aria-label', this.getAttribute('label') || ''); this.setAttribute('aria-orientation', this.orientation); this.shadowRoot.innerHTML = `<style>:host{display:flex;align-items:center;gap:var(--ui-density-gap);min-height:var(--ui-density-control-height);padding:var(--ui-space-1);border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);border-radius:var(--ui-radius-m);background:var(--ui-color-surface)}:host([appearance="plain"]){padding:0;border:0;border-radius:0;background:transparent}:host([orientation="vertical"]){display:inline-flex;flex-direction:column;align-items:stretch}</style><slot></slot>`; }
}

