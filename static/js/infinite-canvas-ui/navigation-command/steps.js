import { contractState } from './shared.js';


export class IcSteps extends HTMLElement {
  static observedAttributes = ['label', 'current'];
  constructor() {
    super();
    this._lastContractError = '';
    this.attachShadow({mode: 'open'});
    this._childObserver = new MutationObserver(() => this.render());
  }
  connectedCallback() {
    this.render();
    this._childObserver.observe(this, {
      attributes: true,
      attributeFilter: ['data-step'],
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  disconnectedCallback() { this._childObserver.disconnect(); }
  attributeChangedCallback(name) {
    if (name === 'current' && this.isConnected && this.shadowRoot.querySelector('.track')) {
      this.syncCurrentPresentation();
      return;
    }
    if (this.isConnected) this.render();
  }
  steps() { return [...this.children].filter(item => item.hasAttribute('data-step')); }
  validateContract() {
    const label = this.getAttribute('label')?.trim();
    const current = this.getAttribute('current')?.trim();
    const steps = this.steps();
    if (!label) return 'label is required';
    if (steps.length < 2) return 'ic-steps requires at least two steps';
    if (!current || !steps.some(item => item.dataset.step === current)) return 'current must match one data-step value';
    if (steps.some(item => !item.dataset.step?.trim() || !item.textContent?.trim())) return 'every step requires a value and label';
    if (new Set(steps.map(item => item.dataset.step)).size !== steps.length) return 'step values must be unique';
    return '';
  }
  syncCurrentPresentation() {
    contractState(this, this.validateContract());
    const steps = this.steps();
    const current = this.getAttribute('current') || '';
    const currentIndex = steps.findIndex(item => item.dataset.step === current);
    [...this.shadowRoot.querySelectorAll('.step')].forEach((item, index) => {
      item.dataset.state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
      if (index === currentIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  }
  render() {
    contractState(this, this.validateContract());
    const steps = this.steps();
    const current = this.getAttribute('current') || '';
    const currentIndex = steps.findIndex(item => item.dataset.step === current);
    this.setAttribute('role', 'list');
    this.setAttribute('aria-label', this.getAttribute('label') || '');
    steps.forEach(item => { if (item.getAttribute('aria-hidden') !== 'true') item.setAttribute('aria-hidden', 'true'); });
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;min-width:0;margin:var(--ui-space-3) 0;overflow:hidden;--ic-steps-state-duration:var(--ui-motion-duration-fast)}
      .track{display:flex;align-items:center;min-width:0;gap:var(--ui-space-3)}
      .step{display:flex;min-width:0;align-items:center;gap:var(--ui-space-2);color:var(--ui-color-text-tertiary);white-space:nowrap;transition:color var(--ic-steps-state-duration) var(--ui-motion-ease-standard)}
      .indicator{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;box-sizing:border-box;border:var(--ui-border-width-thin) solid var(--ui-color-border-primary);border-radius:var(--ui-radius-pill);background:var(--ui-color-surface);font-size:var(--ui-font-size-1);font-weight:var(--ui-font-weight-medium);transition:color var(--ic-steps-state-duration) var(--ui-motion-ease-standard),border-color var(--ic-steps-state-duration) var(--ui-motion-ease-standard),background-color var(--ic-steps-state-duration) var(--ui-motion-ease-standard)}
      .label{overflow:hidden;text-overflow:ellipsis;font-size:var(--ui-font-size-2);font-weight:var(--ui-font-weight-bold)}
      .step[data-state="current"]{color:var(--ui-color-text-primary)}
      .step[data-state="current"] .indicator{color:var(--ui-color-text-primary);border-color:var(--ui-color-border-selected);background:var(--ui-color-action-secondary-selected)}
      .connector{flex:1 1 96px;min-width:8px;max-width:96px;height:var(--ui-border-width-thin);background:var(--ui-color-border-secondary)}
      ::slotted(*){display:none!important}
      :host-context(html[data-ui-motion="reduced"]){--ic-steps-state-duration:1ms}
      @media(prefers-reduced-motion:reduce){:host{--ic-steps-state-duration:1ms}}
      @media(max-width:600px){.track{gap:var(--ui-space-2)}.step{gap:var(--ui-space-1)}.label{font-size:var(--ui-font-size-1)}.connector{flex-basis:48px}}
    </style><div class="track"></div><slot></slot>`;
    const track = this.shadowRoot.querySelector('.track');
    steps.forEach((source, index) => {
      if (index) {
        const connector = document.createElement('span');
        connector.className = 'connector';
        connector.setAttribute('aria-hidden', 'true');
        track.append(connector);
      }
      const item = document.createElement('div');
      item.className = 'step';
      item.setAttribute('part', 'step');
      item.dataset.stepValue = source.dataset.step;
      item.dataset.state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
      item.setAttribute('role', 'listitem');
      if (index === currentIndex) item.setAttribute('aria-current', 'step');
      const indicator = document.createElement('span');
      indicator.className = 'indicator';
      indicator.setAttribute('part', 'indicator');
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = source.dataset.step;
      const label = document.createElement('span');
      label.className = 'label';
      label.setAttribute('part', 'label');
      label.textContent = source.textContent.trim();
      item.append(indicator, label);
      track.append(item);
    });
    this.syncCurrentPresentation();
  }
}
