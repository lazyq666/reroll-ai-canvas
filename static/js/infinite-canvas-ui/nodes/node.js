import {
  CANVAS_FRAME_DEFAULT_COLOR,
  CANVAS_NODE_KINDS,
  CANVAS_NODE_STATES,
  canvasNodeClasses,
  isCanvasNodeKind,
} from './shared.js?v=ic-ui-0e81b6afe7d8';

const MANAGED_CLASSES = new Set(CANVAS_NODE_KINDS.flatMap(kind => [
  ...canvasNodeClasses(kind, { detail:true }).split(' '),
  ...CANVAS_NODE_STATES.flatMap(state => canvasNodeClasses(kind, { [state]:true }).split(' ')),
]));

export class IcCanvasNode extends HTMLElement {
  static get observedAttributes() {
    return ['kind', 'state', 'frame-color', 'data-id', 'aria-label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    if (!this.shadowRoot.hasChildNodes()) this.render();
    this.syncPresentation();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncPresentation();
  }

  syncContract() {
    const kind = this.getAttribute('kind') || '';
    const states = this.stateTokens();
    const unknownState = states.find(state => !CANVAS_NODE_STATES.includes(state));
    const id = this.dataset.id || '';
    const label = this.getAttribute('aria-label') || '';
    const reason = !isCanvasNodeKind(kind)
      ? `kind must be one of: ${CANVAS_NODE_KINDS.join(', ')}`
      : unknownState
        ? `unknown state: ${unknownState}`
        : !id.trim()
        ? 'data-id is required'
        : !label.trim()
          ? 'aria-label is required'
          : '';
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) this.dataset.icContractReason = reason;
    else delete this.dataset.icContractReason;
    return !reason;
  }

  stateTokens() {
    return String(this.getAttribute('state') || 'detail')
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  syncPresentation() {
    const kind = this.getAttribute('kind') || '';
    const states = Object.fromEntries(this.stateTokens().map(state => [state, true]));
    MANAGED_CLASSES.forEach(className => this.classList.remove(className));
    if (isCanvasNodeKind(kind)) {
      canvasNodeClasses(kind, states).split(' ').forEach(className => this.classList.add(className));
    }
    const frameColor = this.getAttribute('frame-color') || '';
    if (kind === 'frame') this.dataset.frameColor = frameColor || CANVAS_FRAME_DEFAULT_COLOR;
    else delete this.dataset.frameColor;
    this.syncContract();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --ic-canvas-node-radius:12px;
          position:absolute;
          display:block;
          box-sizing:border-box;
          width:260px;
          min-height:178px;
          border:var(--ui-border-width-thin) solid var(--ui-color-border-nodes);
          border-radius:var(--ic-canvas-node-radius);
          background:var(--ui-color-surface);
          box-shadow:0 1px 2px 0 rgba(20,20,20,.08);
          overflow:visible;
          user-select:none;
          cursor:move;
        }
        :host([kind="image"]:not([state~="empty"]):not([state~="failed"])) {
          --ic-canvas-node-radius:var(--ui-radius-s);
          padding:2px;
          border:1px solid var(--ui-color-border-nodes);
          border-radius:var(--ui-radius-s);
          background:transparent;
          box-shadow:var(--ui-shadow-raised);
        }
        :host(.selected:not([kind="text-annotation"]):not([kind="brush-stroke"]))::before {
          content:"";
          position:absolute;
          inset:-1px;
          box-sizing:border-box;
          border:var(--ui-border-width-strong) solid var(--ui-color-border-focus);
          border-radius:inherit;
          pointer-events:none;
          z-index:11;
        }
        :host([data-ic-contract-status="invalid"]) { outline:var(--ui-border-width-strong) dashed var(--ui-color-border-danger); }
        slot { display:contents; }
      </style>
      <slot></slot>`;
  }
}
