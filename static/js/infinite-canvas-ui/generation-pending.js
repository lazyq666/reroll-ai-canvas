const PENDING_KINDS = new Set(['image', 'video', 'text']);
const PENDING_STATES = new Set(['queued', 'generating']);
const TARGET_FRAME_MS = 1000 / 24;
const DPR_LIMIT = 1.5;
const MIN_DOT_RADIUS = 2;
const HALFTONE = Object.freeze({
  speed: 2.3,
  density: 36,
  dot: 18,
  scale: 0.5,
  contrast: 1.2,
});

const halftoneInstances = new Set();
const halftoneIntersections = new WeakMap();
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let halftoneIntersectionObserver = null;
let halftoneEnvironmentObserver = null;
let halftoneAnimationFrame = 0;
let halftoneLastFrameTime = 0;
let halftoneAnimationTime = 0;
let nextHalftoneSeed = 0;

function pendingCellMarkup(index) {
  return `<div class="pending-cell" part="cell" style="--cell-index:${index}" aria-hidden="true"></div>`;
}

function pendingHalftoneMarkup() {
  return `<canvas class="generation-pending-halftone" part="motion" aria-hidden="true"></canvas>`;
}

function escapePendingHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pendingBadgeText(elapsed, label, description) {
  return `${elapsed ? `${elapsed} ` : ''}${label}${description ? ` · ${description}` : ''}`;
}

function smoothstep(edge0, edge1, value) {
  const position = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return position * position * (3 - (2 * position));
}

function fieldValue(x, y, time, seed) {
  const first = Math.sin((x * 8.2 * HALFTONE.scale) + (time * 0.56) + seed);
  const second = Math.sin(((x * 0.72 + y) * 11.4 * HALFTONE.scale) - (time * 0.42) + (seed * 1.7));
  const centerX = 0.5 + Math.sin((time * 0.21) + seed) * 0.22;
  const centerY = 0.5 + Math.cos((time * 0.17) + (seed * 1.3)) * 0.2;
  const distance = Math.hypot(x - centerX, y - centerY);
  const ripple = Math.sin((distance * 15 * HALFTONE.scale) - (time * 0.7) + seed);
  const combined = ((first * 0.4) + (second * 0.35) + (ripple * 0.25)) * HALFTONE.contrast;
  return Math.max(0, Math.min(1, 0.5 + (combined * 0.5)));
}

function halftoneMotionAllowed(instance) {
  return !document.hidden
    && halftoneIntersections.get(instance) !== false
    && !instance.reducedMotionRequested()
    && !reducedMotion?.matches;
}

function anyHalftoneRunning() {
  return [...halftoneInstances].some(instance => halftoneMotionAllowed(instance));
}

function drawAllHalftones() {
  for (const instance of halftoneInstances) instance.drawHalftone(halftoneAnimationTime);
}

function halftoneFrame(timestamp) {
  halftoneAnimationFrame = 0;
  if (!anyHalftoneRunning()) return;
  if (!halftoneLastFrameTime) halftoneLastFrameTime = timestamp;
  const elapsed = Math.min(80, timestamp - halftoneLastFrameTime);
  if (elapsed >= TARGET_FRAME_MS) {
    halftoneAnimationTime += (elapsed / 1000) * HALFTONE.speed;
    halftoneLastFrameTime = timestamp;
    for (const instance of halftoneInstances) {
      if (halftoneMotionAllowed(instance)) instance.drawHalftone(halftoneAnimationTime);
    }
  }
  halftoneAnimationFrame = requestAnimationFrame(halftoneFrame);
}

function syncHalftoneMotion() {
  for (const instance of halftoneInstances) instance.syncHalftoneMotionState();
  const running = anyHalftoneRunning();
  if (running && !halftoneAnimationFrame) {
    halftoneLastFrameTime = 0;
    halftoneAnimationFrame = requestAnimationFrame(halftoneFrame);
  } else if (!running && halftoneAnimationFrame) {
    cancelAnimationFrame(halftoneAnimationFrame);
    halftoneAnimationFrame = 0;
    drawAllHalftones();
  }
}

function handleHalftoneEnvironmentChange() {
  drawAllHalftones();
  syncHalftoneMotion();
}

function setupHalftoneEnvironment() {
  if (halftoneInstances.size !== 1) return;
  halftoneIntersectionObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) halftoneIntersections.set(entry.target, entry.isIntersecting);
      syncHalftoneMotion();
    }, { rootMargin: '80px' })
    : null;
  halftoneEnvironmentObserver = new MutationObserver(handleHalftoneEnvironmentChange);
  halftoneEnvironmentObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ui-theme', 'data-ui-motion'],
  });
  document.addEventListener('visibilitychange', syncHalftoneMotion);
  reducedMotion?.addEventListener?.('change', syncHalftoneMotion);
}

function teardownHalftoneEnvironment() {
  if (halftoneInstances.size) return;
  halftoneIntersectionObserver?.disconnect();
  halftoneIntersectionObserver = null;
  halftoneEnvironmentObserver?.disconnect();
  halftoneEnvironmentObserver = null;
  document.removeEventListener('visibilitychange', syncHalftoneMotion);
  reducedMotion?.removeEventListener?.('change', syncHalftoneMotion);
  if (halftoneAnimationFrame) cancelAnimationFrame(halftoneAnimationFrame);
  halftoneAnimationFrame = 0;
  halftoneLastFrameTime = 0;
}

export class IcGenerationPending extends HTMLElement {
  static get observedAttributes() {
    return ['kind', 'state', 'count', 'label', 'description', 'elapsed'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastContractError = '';
    this._halftoneSeed = 0.93 + (nextHalftoneSeed * 1.73);
    nextHalftoneSeed += 1;
  }

  connectedCallback() {
    if (!this.shadowRoot.hasChildNodes()) this.render();
    else this.syncPresentation();
    this.setupHalftone();
  }

  disconnectedCallback() {
    this.teardownHalftone();
  }

  attributeChangedCallback() {
    if (this.isConnected && this.shadowRoot.hasChildNodes()) this.syncPresentation();
  }

  reducedMotionRequested() {
    return Boolean(this.closest('[data-ui-motion="reduced"]'));
  }

  setupHalftone() {
    this.teardownHalftone();
    this._halftoneCanvas = this.shadowRoot.querySelector('canvas.generation-pending-halftone');
    this._halftoneSurface = this.shadowRoot.querySelector('.pending');
    this._halftoneContext = this._halftoneCanvas?.getContext('2d', { alpha: false }) || null;
    if (!this._halftoneCanvas || !this._halftoneContext) return;
    this._halftoneWidth = 0;
    this._halftoneHeight = 0;
    this._halftoneResizeObserver = new ResizeObserver(() => this.resizeHalftone());
    this._halftoneResizeObserver.observe(this._halftoneSurface);
    halftoneInstances.add(this);
    setupHalftoneEnvironment();
    halftoneIntersectionObserver?.observe(this);
    this.resizeHalftone();
    syncHalftoneMotion();
  }

  teardownHalftone() {
    this._halftoneResizeObserver?.disconnect();
    this._halftoneResizeObserver = null;
    halftoneIntersectionObserver?.unobserve(this);
    halftoneIntersections.delete(this);
    halftoneInstances.delete(this);
    teardownHalftoneEnvironment();
    this._halftoneCanvas = null;
    this._halftoneContext = null;
    this._halftoneSurface = null;
  }

  resizeHalftone() {
    if (!this._halftoneCanvas || !this._halftoneContext || !this._halftoneSurface) return;
    const bounds = this._halftoneSurface.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const dpr = Math.min(DPR_LIMIT, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this._halftoneCanvas.width !== pixelWidth || this._halftoneCanvas.height !== pixelHeight) {
      this._halftoneCanvas.width = pixelWidth;
      this._halftoneCanvas.height = pixelHeight;
    }
    this._halftoneWidth = width;
    this._halftoneHeight = height;
    this._halftoneContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHalftone(halftoneAnimationTime);
  }

  drawHalftone(time) {
    if (!this._halftoneContext || !this._halftoneWidth || !this._halftoneHeight) return;
    const background = getComputedStyle(this._halftoneSurface).backgroundColor;
    const dotColor = getComputedStyle(this._halftoneCanvas).color;
    const spacing = Math.max(6, this._halftoneWidth / HALFTONE.density);
    const maximumRadius = Math.max(MIN_DOT_RADIUS, spacing * (HALFTONE.dot / 100));
    const columns = Math.ceil(this._halftoneWidth / spacing) + 1;
    const rows = Math.ceil(this._halftoneHeight / spacing) + 1;
    this._halftoneCanvas.dataset.halftoneBackground = background;
    this._halftoneCanvas.dataset.halftoneDot = dotColor;
    this._halftoneContext.fillStyle = background;
    this._halftoneContext.fillRect(0, 0, this._halftoneWidth, this._halftoneHeight);
    this._halftoneContext.fillStyle = dotColor;
    this._halftoneContext.beginPath();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const px = column * spacing;
        const py = row * spacing;
        const value = fieldValue(
          px / this._halftoneWidth,
          py / this._halftoneHeight,
          time,
          this._halftoneSeed,
        );
        const radius = maximumRadius * smoothstep(0.16, 0.84, value);
        if (radius < 0.08) continue;
        this._halftoneContext.moveTo(px + radius, py);
        this._halftoneContext.arc(px, py, radius, 0, Math.PI * 2);
      }
    }
    this._halftoneContext.fill();
  }

  syncHalftoneMotionState() {
    if (!this._halftoneCanvas) return;
    const state = this.reducedMotionRequested() || reducedMotion?.matches
      ? 'static'
      : (halftoneMotionAllowed(this) ? 'running' : 'paused');
    this._halftoneCanvas.dataset.motionState = state;
  }

  validateContract() {
    const kind = this.getAttribute('kind') || '';
    const state = this.getAttribute('state') || '';
    const count = Number(this.getAttribute('count') || 1);
    if (!PENDING_KINDS.has(kind)) return 'kind must be image, video, or text';
    if (!PENDING_STATES.has(state)) return 'state must be queued or generating';
    if (!Number.isInteger(count) || count < 1) return 'count must be a positive integer';
    if (!this.getAttribute('label')?.trim()) return 'label is required';
    if (this.hasAttribute('elapsed') && !this.getAttribute('elapsed')?.trim()) return 'elapsed must not be empty';
    return '';
  }

  syncContract() {
    const reason = this.validateContract();
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) this.dataset.icContractReason = reason;
    else delete this.dataset.icContractReason;
    if (reason && reason !== this._lastContractError) {
      this.dispatchEvent(new CustomEvent('ic-contract-error', {
        bubbles: true,
        composed: true,
        detail: { component: this.localName, reason },
      }));
    }
    this._lastContractError = reason;
    return !reason;
  }

  syncCells(count) {
    const grid = this.shadowRoot.querySelector('.grid');
    if (!grid) return;
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / columns);
    grid.style.setProperty('--pending-columns', String(columns));
    grid.style.setProperty('--pending-rows', String(rows));
    grid.style.setProperty('--pending-grid-padding', count > 1 ? 'var(--ui-space-2)' : '0');
    if (grid.childElementCount !== count) {
      grid.innerHTML = Array.from({ length: count }, (_, index) => pendingCellMarkup(index)).join('');
    }
  }

  syncPresentation() {
    const count = Math.max(1, Number(this.getAttribute('count') || 1));
    const kind = this.getAttribute('kind') || '';
    const state = this.getAttribute('state') || '';
    const label = this.getAttribute('label')?.trim() || '';
    const description = this.getAttribute('description')?.trim() || '';
    const elapsed = this.getAttribute('elapsed')?.trim() || '';
    this.syncContract();
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
    this.setAttribute('aria-busy', 'true');
    this.setAttribute('aria-label', description ? `${label}，${description}` : label);
    const pending = this.shadowRoot.querySelector('.pending');
    if (pending) {
      pending.dataset.kind = kind;
      pending.dataset.state = state;
    }
    const badge = this.shadowRoot.querySelector('.generation-pending-badge');
    if (badge) {
      badge.textContent = pendingBadgeText(elapsed, label, description);
      badge.toggleAttribute('loading', true);
    }
    this.syncCells(count);
  }

  render() {
    const badgeText = pendingBadgeText(
      this.getAttribute('elapsed')?.trim() || '',
      this.getAttribute('label')?.trim() || '',
      this.getAttribute('description')?.trim() || '',
    );
    this.shadowRoot.innerHTML = `
      <style>
        :host { --ic-generation-pending-radius:var(--ic-canvas-node-radius, var(--ui-radius-m)); --ic-badge-spin-duration:calc(var(--ui-motion-duration-slow) * 4); position:relative; box-sizing:border-box; display:block; inline-size:100%; block-size:100%; min-inline-size:0; min-block-size:0; overflow:visible; color:var(--ui-color-text-primary); font-family:var(--ui-font-sans); }
        *, *::before, *::after { box-sizing:border-box; }
        .generation-pending-badge { position:absolute; inset-block-start:-20px; inset-inline-start:0; z-index:3; max-inline-size:100%; font-variant-numeric:tabular-nums; pointer-events:none; }
        .generation-pending-badge::part(base) { min-block-size:14px; padding:var(--ui-space-0); overflow:hidden; color:var(--ui-color-text-secondary); background:transparent; box-shadow:none; font-size:var(--ui-font-size-2); font-weight:var(--ui-font-weight-regular); text-overflow:ellipsis; white-space:nowrap; }
        .pending { position:relative; contain:layout paint style; inline-size:100%; block-size:100%; min-block-size:7.5rem; overflow:hidden; border-radius:var(--ic-generation-pending-radius); background:var(--ui-color-surface); }
        .grid { inline-size:100%; block-size:100%; display:grid; grid-template-columns:repeat(var(--pending-columns), minmax(0, 1fr)); grid-template-rows:repeat(var(--pending-rows), minmax(0, 1fr)); gap:var(--ui-space-2); padding:var(--pending-grid-padding); }
        .pending-cell { min-inline-size:0; min-block-size:0; overflow:hidden; border-radius:var(--ic-generation-pending-radius); }
        .generation-pending-halftone { position:absolute; inset:0; z-index:1; display:block; inline-size:100%; block-size:100%; color:var(--ui-color-text-disabled); pointer-events:none; }
        .pending[data-state="queued"] .grid { opacity:.72; }
        :host([data-ic-contract-status="invalid"]) { opacity:.55; }
      </style>
      <ic-badge class="generation-pending-badge" part="status badge" kind="status" tone="info" loading aria-hidden="true">${escapePendingHtml(badgeText)}</ic-badge>
      <div class="pending" part="base">
        <div class="grid" part="grid"></div>
        ${pendingHalftoneMarkup()}
      </div>`;
    this.syncPresentation();
  }
}
