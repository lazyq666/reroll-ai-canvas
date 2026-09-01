export class IcCanvasGrid extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host {
        position:absolute;
        inset:0;
        display:block;
        overflow:hidden;
        background-color:var(--ui-color-surface-canvas);
        background-image:radial-gradient(var(--ui-color-border-canvas-grid) .5px, transparent .5px);
        background-size:15px 15px;
        pointer-events:none;
        user-select:none;
      }
    </style>`;
  }

  connectedCallback() {
    if (!this.hasAttribute('aria-hidden')) this.setAttribute('aria-hidden', 'true');
    this.dataset.icContractStatus = 'ready';
  }
}
