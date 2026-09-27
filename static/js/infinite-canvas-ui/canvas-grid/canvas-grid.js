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
        pointer-events:none;
        user-select:none;
      }
      svg { display:block; width:100%; height:100%; }
      circle { fill:var(--ui-color-border-canvas-grid); }
    </style>
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="dots" patternUnits="userSpaceOnUse" width="20" height="20">
          <circle cx="10" cy="10" r="1"></circle>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)"></rect>
    </svg>`;
    this._pattern = root.querySelector('pattern');
    this._dot = root.querySelector('circle');
  }

  setViewport({ x = 0, y = 0, scale = 1 } = {}) {
    const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const gap = 20 * zoom;
    // Keep the pattern anchored in world space without enormous SVG offsets.
    const offset = value => Number.isFinite(value) ? ((value % gap) + gap) % gap : 0;
    this._pattern.setAttribute('x', String(offset(x)));
    this._pattern.setAttribute('y', String(offset(y)));
    this._pattern.setAttribute('width', String(gap));
    this._pattern.setAttribute('height', String(gap));
    this._dot.setAttribute('cx', String(gap / 2));
    this._dot.setAttribute('cy', String(gap / 2));
    this._dot.setAttribute('r', String(zoom));
  }

  connectedCallback() {
    if (!this.hasAttribute('aria-hidden')) this.setAttribute('aria-hidden', 'true');
    this.dataset.icContractStatus = 'ready';
  }
}
