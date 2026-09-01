import './image-edit-controls.js?v=2026.08.16.1';

const IMAGE_EDIT_DOCK_STYLE = `
  :host {
    --ui-density-control-height:var(--ui-control-height-s);
    --ui-density-font-size:var(--ui-font-size-2);
    --ui-density-inline-padding:var(--ui-space-2);
    --ui-density-gap:var(--ui-space-1);
    box-sizing:border-box;
    display:inline-flex;
    width:fit-content;
    max-width:min(820px,calc(100vw - 2 * var(--ui-space-4)));
    height:48px;
    min-width:0;
    color:var(--ui-color-text-primary);
    font:var(--ui-text-label);
    pointer-events:auto;
  }
  :host([wide]) { max-width:calc(100vw - var(--ui-space-4)); }
  :host([hidden]) { display:none!important; }
  *,*::before,*::after { box-sizing:border-box; }
  .surface {
    display:flex;
    width:fit-content;
    max-width:100%;
    height:48px;
    min-width:0;
    align-items:center;
    gap:var(--ui-space-1);
    padding:6px;
    border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
    border-radius:13px;
    background:color-mix(in srgb,var(--ui-color-surface-floating) 94%,transparent);
    box-shadow:var(--ui-shadow-overlay);
    backdrop-filter:blur(22px) saturate(1.15);
  }
  .content,.tools {
    display:flex;
    min-width:0;
    align-items:center;
  }
  .content { width:max-content; max-width:100%; height:100%; gap:var(--ui-space-1); }
  .tools {
    flex:0 1 auto;
    max-width:100%;
    height:100%;
    overflow-x:auto;
    overflow-y:hidden;
    overscroll-behavior-inline:contain;
    scrollbar-width:none;
  }
  .tools::-webkit-scrollbar { display:none; }
  .divider {
    flex:0 0 var(--ui-border-width-thin);
    align-self:stretch;
    margin:0 2px;
    background:var(--ui-color-border-canvas-grid);
  }
  .actions { display:flex; flex:0 0 auto; height:100%; align-items:center; }
  :host(:not([data-has-actions])) :is(.divider,.actions) { display:none; }
  ::slotted([slot="tools"]) { min-width:0; }
  ::slotted([slot="actions"][hidden]) { display:none!important; }
`;

export class ImageEditDock extends HTMLElement {
  static get observedAttributes() { return ['label']; }

  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._observer = new MutationObserver(() => this.syncActionState());
  }

  connectedCallback() {
    this.render();
    this._observer.observe(this, {attributes:true, childList:true, subtree:true, attributeFilter:['hidden']});
    this.syncActionState();
  }

  disconnectedCallback() {
    this._observer.disconnect();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'label' && oldValue !== newValue && this.isConnected) this.syncAccessibleLabel();
  }

  syncAccessibleLabel() {
    const label = this.getAttribute('label')?.trim()
      || window.StudioI18n?.t?.('smart.imageEditControls')
      || 'Image editing controls';
    this.setAttribute('aria-label', label);
  }

  syncActionState() {
    const hasActions = [...this.querySelectorAll(':scope > [slot="actions"]')]
      .some(element => !element.hidden);
    const hasWideTools = Boolean(this.querySelector('[data-dock-width="wide"]:not([hidden])'));
    this.toggleAttribute('data-has-actions', hasActions);
    this.toggleAttribute('wide', hasWideTools);
  }

  render() {
    this.setAttribute('role', 'toolbar');
    this.syncAccessibleLabel();
    this.dataset.icContractStatus = 'ready';
    this.shadowRoot.innerHTML = `<style>${IMAGE_EDIT_DOCK_STYLE}</style>
      <div class="surface" part="surface">
        <div class="content" part="content">
          <div class="tools" part="tools"><slot name="tools"></slot></div>
          <span class="divider" part="divider" aria-hidden="true"></span>
          <div class="actions" part="actions"><slot name="actions"></slot></div>
        </div>
      </div>`;
    this.shadowRoot.querySelectorAll('slot').forEach(slot => {
      slot.addEventListener('slotchange', () => this.syncActionState());
    });
  }
}

if (!customElements.get('ic-image-edit-dock')) {
  customElements.define('ic-image-edit-dock', ImageEditDock);
}
