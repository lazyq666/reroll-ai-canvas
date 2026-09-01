const SMART_MINIMAP_ITEM_KINDS = Object.freeze(['frame', 'group', 'text', 'media']);
const SMART_MINIMAP_FRAME_COLORS = Object.freeze(['blue', 'violet', 'amber', 'green', 'slate']);
const SMART_MINIMAP_DEFAULT_FRAME_COLOR = 'slate';
const SMART_MINIMAP_MIN_ITEM_SIZE = 1.5;
const SMART_MINIMAP_MIN_VIEWPORT_AREA_RATIO = 0.1;
const SMART_MINIMAP_MAX_FOCUS_ZOOM = 2;
let smartMinimapInstanceCount = 0;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRect(value = {}) {
  return {
    x: finite(value.x),
    y: finite(value.y),
    width: Math.max(1, finite(value.width, 1)),
    height: Math.max(1, finite(value.height, 1)),
  };
}

function normalizeItem(value = {}) {
  const kind = SMART_MINIMAP_ITEM_KINDS.includes(value.kind) ? value.kind : 'media';
  const validFrameColor = SMART_MINIMAP_FRAME_COLORS.includes(value.frameColor)
    ? value.frameColor
    : '';
  return {
    id: String(value.id || ''),
    kind,
    frameColor: kind === 'frame'
      ? validFrameColor || SMART_MINIMAP_DEFAULT_FRAME_COLOR
      : validFrameColor,
    ...normalizeRect(value),
  };
}

function projectRect(rect, state) {
  return {
    x: state.offsetX + (rect.x - state.minX) * state.scale,
    y: state.offsetY + (rect.y - state.minY) * state.scale,
    width: Math.max(SMART_MINIMAP_MIN_ITEM_SIZE, rect.width * state.scale),
    height: Math.max(SMART_MINIMAP_MIN_ITEM_SIZE, rect.height * state.scale),
  };
}

export function projectSmartMinimapScene({
  items = [],
  viewport = {},
  width = 170,
  height = 108,
  padding = 200,
} = {}) {
  const normalizedItems = items.map(normalizeItem);
  const normalizedViewport = normalizeRect(viewport);
  const safeWidth = Math.max(1, finite(width, 170));
  const safeHeight = Math.max(1, finite(height, 108));
  const safePadding = Math.max(0, finite(padding, 200));
  const rects = [...normalizedItems, normalizedViewport];
  const minX = Math.min(...rects.map(rect => rect.x), -safePadding);
  const minY = Math.min(...rects.map(rect => rect.y), -safePadding);
  const maxX = Math.max(
    ...rects.map(rect => rect.x + rect.width),
    normalizedViewport.x + normalizedViewport.width + safePadding,
  );
  const maxY = Math.max(
    ...rects.map(rect => rect.y + rect.height),
    normalizedViewport.y + normalizedViewport.height + safePadding,
  );
  const fitScale = Math.min(
    safeWidth / Math.max(1, maxX - minX),
    safeHeight / Math.max(1, maxY - minY),
  );
  const viewportFocusScale = Math.sqrt(
    safeWidth * safeHeight * SMART_MINIMAP_MIN_VIEWPORT_AREA_RATIO
      / (normalizedViewport.width * normalizedViewport.height),
  );
  const scale = Math.min(
    fitScale * SMART_MINIMAP_MAX_FOCUS_ZOOM,
    Math.max(fitScale, viewportFocusScale),
  );
  const usesViewportFocus = scale > fitScale + Number.EPSILON;
  const offsetX = usesViewportFocus
    ? safeWidth / 2
      - (normalizedViewport.x + normalizedViewport.width / 2 - minX) * scale
    : (safeWidth - (maxX - minX) * scale) / 2;
  const offsetY = usesViewportFocus
    ? safeHeight / 2
      - (normalizedViewport.y + normalizedViewport.height / 2 - minY) * scale
    : (safeHeight - (maxY - minY) * scale) / 2;
  const state = {
    minX,
    minY,
    maxX,
    maxY,
    scale,
    fitScale,
    usesViewportFocus,
    offsetX,
    offsetY,
    width: safeWidth,
    height: safeHeight,
  };
  return {
    ...state,
    items: normalizedItems.map(item => ({ ...item, ...projectRect(item, state) })),
    viewport: projectRect(normalizedViewport, state),
  };
}

function rectPath(rects) {
  return rects.map(rect => {
    const x = Math.round(rect.x * 10) / 10;
    const y = Math.round(rect.y * 10) / 10;
    const width = Math.round(rect.width * 10) / 10;
    const height = Math.round(rect.height * 10) / 10;
    return `M${x} ${y}h${width}v${height}h-${width}Z`;
  }).join('');
}

function setRect(element, rect) {
  element.setAttribute('x', String(rect.x));
  element.setAttribute('y', String(rect.y));
  element.setAttribute('width', String(rect.width));
  element.setAttribute('height', String(rect.height));
}

export class IcSmartMinimap extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._scene = null;
    this._projection = null;
    this._activePointerId = null;
    this._maskId = `ic-smart-minimap-mask-${++smartMinimapInstanceCount}`;
    this._resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.renderScene())
      : null;
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerEnd = this.onPointerEnd.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  connectedCallback() {
    if (!this.shadowRoot.hasChildNodes()) this.render();
    this.upgradeProperty('scene');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', '导航地图');
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.dataset.icContractStatus = 'ready';
    this.addEventListener('pointerdown', this.onPointerDown);
    this.addEventListener('pointermove', this.onPointerMove);
    this.addEventListener('pointerup', this.onPointerEnd);
    this.addEventListener('pointercancel', this.onPointerEnd);
    this.addEventListener('keydown', this.onKeyDown);
    this._resizeObserver?.observe(this);
    this.renderScene();
  }

  disconnectedCallback() {
    this.removeEventListener('pointerdown', this.onPointerDown);
    this.removeEventListener('pointermove', this.onPointerMove);
    this.removeEventListener('pointerup', this.onPointerEnd);
    this.removeEventListener('pointercancel', this.onPointerEnd);
    this.removeEventListener('keydown', this.onKeyDown);
    this._resizeObserver?.disconnect();
  }

  upgradeProperty(name) {
    if (!Object.prototype.hasOwnProperty.call(this, name)) return;
    const value = this[name];
    delete this[name];
    this[name] = value;
  }

  set scene(value) {
    this._scene = value && typeof value === 'object'
      ? {
          items: Array.isArray(value.items) ? value.items : [],
          viewport: normalizeRect(value.viewport),
          padding: Math.max(0, finite(value.padding, 200)),
        }
      : null;
    this.renderScene();
  }

  get scene() {
    return this._scene;
  }

  updateViewport(value) {
    if (!this._scene) return;
    this._scene.viewport = normalizeRect(value);
    if (!this._projection) {
      this.renderScene();
      return;
    }
    const projected = projectRect(this._scene.viewport, this._projection);
    this.updateViewportPresentation(projected);
  }

  worldPointFromClient(clientX, clientY) {
    if (!this._projection || !this._content) return null;
    const bounds = this._content.getBoundingClientRect();
    const x = finite(clientX) - bounds.left;
    const y = finite(clientY) - bounds.top;
    return {
      x: this._projection.minX
        + (x - this._projection.offsetX) / Math.max(0.0001, this._projection.scale),
      y: this._projection.minY
        + (y - this._projection.offsetY) / Math.max(0.0001, this._projection.scale),
    };
  }

  emitNavigate(point, source) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.dispatchEvent(new CustomEvent('ic-minimap-navigate', {
      bubbles: true,
      composed: true,
      detail: { point, source },
    }));
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._activePointerId = event.pointerId;
    this.setPointerCapture?.(event.pointerId);
    this.emitNavigate(this.worldPointFromClient(event.clientX, event.clientY), 'pointer');
  }

  onPointerMove(event) {
    if (event.pointerId !== this._activePointerId) return;
    event.preventDefault();
    this.emitNavigate(this.worldPointFromClient(event.clientX, event.clientY), 'pointer');
  }

  onPointerEnd(event) {
    if (event.pointerId !== this._activePointerId) return;
    this._activePointerId = null;
    if (this.hasPointerCapture?.(event.pointerId)) this.releasePointerCapture(event.pointerId);
  }

  onKeyDown(event) {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction || !this._scene) return;
    event.preventDefault();
    const viewport = this._scene.viewport;
    this.emitNavigate({
      x: viewport.x + viewport.width / 2 + direction[0] * viewport.width * 0.25,
      y: viewport.y + viewport.height / 2 + direction[1] * viewport.height * 0.25,
    }, 'keyboard');
  }

  renderScene() {
    if (!this.isConnected || !this._scene || !this._content) return;
    const width = this._content.clientWidth || 170;
    const height = this._content.clientHeight || 108;
    const projection = projectSmartMinimapScene({
      ...this._scene,
      width,
      height,
    });
    this._projection = projection;
    this._svg.setAttribute('viewBox', `0 0 ${projection.width} ${projection.height}`);
    this._maskBase.setAttribute('width', String(projection.width));
    this._maskBase.setAttribute('height', String(projection.height));
    this._outsideMask.setAttribute('width', String(projection.width));
    this._outsideMask.setAttribute('height', String(projection.height));

    SMART_MINIMAP_FRAME_COLORS.forEach(color => {
      const rects = projection.items.filter(item => item.kind === 'frame' && item.frameColor === color);
      this._paths.get(`frame:${color}`).setAttribute('d', rectPath(rects));
      const memberRects = projection.items.filter(item => item.kind !== 'frame' && item.frameColor === color);
      this._paths.get(`frame-member:${color}`).setAttribute('d', rectPath(memberRects));
    });
    for (const kind of ['group', 'text', 'media']) {
      const rects = projection.items.filter(item => item.kind === kind && !item.frameColor);
      this._paths.get(kind).setAttribute('d', rectPath(rects));
    }
    this.updateViewportPresentation(projection.viewport);
  }

  updateViewportPresentation(projected) {
    setRect(this._maskHole, projected);
  }

  render() {
    const framePaths = SMART_MINIMAP_FRAME_COLORS.map(color => (
      `<path data-minimap-kind="frame" data-frame-color="${color}"></path>`
    )).join('');
    const frameMemberPaths = SMART_MINIMAP_FRAME_COLORS.map(color => (
      `<path data-minimap-kind="frame-member" data-frame-color="${color}"></path>`
    )).join('');
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          box-sizing:border-box;
          width:190px;
          height:128px;
          border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
          border-radius:var(--ui-radius-l);
          background:var(--ui-color-surface-floating);
          box-shadow:var(--ui-shadow-none);
          backdrop-filter:blur(16px);
          overflow:hidden;
          cursor:crosshair;
          touch-action:none;
          user-select:none;
        }
        :host(:focus-visible) { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
        .smart-minimap-content {
          position:absolute;
          inset:10px;
          overflow:hidden;
          border-radius:var(--ui-radius-s);
          background-color:var(--ui-color-surface);
          background-image:radial-gradient(var(--ui-color-border-canvas-grid) .5px, transparent .5px);
          background-size:15px 15px;
        }
        .minimap-node-map { display:block; width:100%; height:100%; overflow:hidden; }
        path { vector-effect:non-scaling-stroke; }
        path[data-frame-color="blue"] { --ic-minimap-frame-color:var(--ui-color-border-selected); }
        path[data-frame-color="slate"] { --ic-minimap-frame-color:rgb(100 116 139); }
        path[data-frame-color="violet"] { --ic-minimap-frame-color:rgb(139 92 246); }
        path[data-frame-color="amber"] { --ic-minimap-frame-color:rgb(245 158 11); }
        path[data-frame-color="green"] { --ic-minimap-frame-color:rgb(16 185 129); }
        path[data-minimap-kind="frame"] { fill:var(--ic-minimap-frame-color); fill-opacity:.2; }
        path[data-minimap-kind="frame-member"] { fill:var(--ic-minimap-frame-color); fill-opacity:.3; }
        path[data-minimap-kind="group"] { fill:var(--ui-color-minimap-group); }
        path[data-minimap-kind="media"] { fill:var(--ui-color-minimap-media); }
        path[data-minimap-kind="text"] { fill:var(--ui-color-minimap-text); }
        .smart-minimap-outside-mask { fill:var(--ui-color-mask); opacity:.12; pointer-events:none; }
      </style>
      <div class="smart-minimap-content" part="content">
        <svg class="minimap-node-map" part="map" aria-hidden="true">
          <defs>
            <mask id="${this._maskId}" maskUnits="userSpaceOnUse">
              <rect class="smart-minimap-mask-base" fill="white"></rect>
              <rect class="smart-minimap-mask-hole" fill="black"></rect>
            </mask>
          </defs>
          <g class="smart-minimap-items">
            ${framePaths}
            ${frameMemberPaths}
            <path data-minimap-kind="group"></path>
            <path data-minimap-kind="text"></path>
            <path data-minimap-kind="media"></path>
          </g>
          <rect class="smart-minimap-outside-mask" mask="url(#${this._maskId})"></rect>
        </svg>
      </div>`;
    this._content = this.shadowRoot.querySelector('.smart-minimap-content');
    this._svg = this.shadowRoot.querySelector('.minimap-node-map');
    this._maskBase = this.shadowRoot.querySelector('.smart-minimap-mask-base');
    this._maskHole = this.shadowRoot.querySelector('.smart-minimap-mask-hole');
    this._outsideMask = this.shadowRoot.querySelector('.smart-minimap-outside-mask');
    this._paths = new Map();
    SMART_MINIMAP_FRAME_COLORS.forEach(color => {
      this._paths.set(
        `frame:${color}`,
        this.shadowRoot.querySelector(`[data-minimap-kind="frame"][data-frame-color="${color}"]`),
      );
      this._paths.set(
        `frame-member:${color}`,
        this.shadowRoot.querySelector(`[data-minimap-kind="frame-member"][data-frame-color="${color}"]`),
      );
    });
    for (const kind of ['group', 'text', 'media']) {
      this._paths.set(kind, this.shadowRoot.querySelector(`[data-minimap-kind="${kind}"]`));
    }
  }
}
