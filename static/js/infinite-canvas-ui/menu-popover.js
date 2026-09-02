import { closeTopLayer, openTopLayer } from './overlay-layer.js?v=ic-ui-ff02b51bdc35';
import {
  ANCHORED_OVERLAY_MOTION_STYLES,
  nextOverlayPaint as nextPaint,
  setOverlayInteraction as setSurfaceInteraction,
  waitForOverlayMotion as waitForSurfaceMotion,
} from './overlay-motion.js?v=ic-ui-ff02b51bdc35';

const MENU_TRIGGERS = new Set(['dropdown', 'context']);
const MENU_SELECTIONS = new Set(['command', 'single', 'multiple']);
const ITEM_KINDS = new Set(['command', 'checkbox', 'radio']);
const SIDES = new Set(['block-end', 'block-start', 'inline-end', 'inline-start']);
export const MENU_POPOVER_TAGS = Object.freeze(['ic-menu', 'ic-menu-item', 'ic-popover', 'ic-confirm-popover', 'ic-tooltip']);

export { ANCHORED_OVERLAY_MOTION_STYLES };

const TOOLTIP_MOTION_STYLES = `
  ${ANCHORED_OVERLAY_MOTION_STYLES}
  [part="surface"] {
    --ic-overlay-motion-scale: .98;
    transition-duration: var(--ui-motion-duration-fast);
  }
  :host-context(html[data-ui-motion="reduced"]) [part="surface"] { --ic-overlay-motion-scale: 1; }
  @media (prefers-reduced-motion: reduce) { [part="surface"] { --ic-overlay-motion-scale: 1; } }
`;

function contractState(host, reason) {
  host.dataset.icContractStatus = reason ? 'invalid' : 'ready';
  if (!reason) { delete host.dataset.icContractReason; host._lastContractError = ''; return true; }
  host.dataset.icContractReason = reason;
  if (host._lastContractError !== reason) {
    host._lastContractError = reason;
    host.dispatchEvent(new CustomEvent('ic-contract-error', { bubbles: true, composed: true, detail: { component: host.localName, reason } }));
  }
  return false;
}

class IcAnchoredOverlay extends HTMLElement {
  static observedAttributes = ['open', 'label', 'placement', 'alignment'];
  constructor() {
    super();
    this._lastContractError = '';
    this._invoker = null;
    this._anchorPoint = null;
    this._motionGeneration = 0;
    this._onViewportChange = () => this.positionSurface();
    this.attachShadow({ mode: 'open' });
  }
  connectedCallback() {
    if (!this.dataset.motionState) this.dataset.motionState = this.hasAttribute('open') ? 'open' : 'closed';
    this.render();
    this.syncSurfaceLayer();
    this._onDocumentPointer = event => {
      const explicitPopover = this.localName === 'ic-popover' && this.getAttribute('dismiss-policy') === 'explicit';
      if (this.hasAttribute('open') && !explicitPopover && !this.contains(event.target) && !event.composedPath().includes(this)) this.hide('outside');
    };
    this._onDocumentKey = event => { if (this.hasAttribute('open') && event.key === 'Escape') { event.preventDefault(); this.hide('escape'); } };
    document.addEventListener('pointerdown', this._onDocumentPointer);
    document.addEventListener('keydown', this._onDocumentKey);
  }
  disconnectedCallback() {
    this._motionGeneration += 1;
    closeTopLayer(this.surface);
    document.removeEventListener('pointerdown', this._onDocumentPointer);
    document.removeEventListener('keydown', this._onDocumentKey);
    window.removeEventListener('resize', this._onViewportChange);
    window.removeEventListener('scroll', this._onViewportChange, true);
  }
  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name !== 'open') {
      closeTopLayer(this.surface);
      this.render();
      setSurfaceInteraction(this.surface, this.dataset.motionState !== 'exiting');
    } else if (this.hasAttribute('open') && ['closed', 'exiting'].includes(this.dataset.motionState)) {
      this._motionGeneration += 1;
      this.dataset.motionState = 'open';
      setSurfaceInteraction(this.surface, true);
    } else if (!this.hasAttribute('open') && !['closed', 'exiting'].includes(this.dataset.motionState)) {
      this._motionGeneration += 1;
      this.dataset.motionState = 'closed';
      setSurfaceInteraction(this.surface, true);
    }
    this.syncSurfaceLayer();
    if (this.hasAttribute('open')) queueMicrotask(() => this.positionSurface());
  }
  get surface() { return this.shadowRoot.querySelector('[part="surface"]'); }
  syncSurfaceLayer() {
    if (this.hasAttribute('open') || this.dataset.motionState === 'exiting') openTopLayer(this.surface, 'popover');
    else closeTopLayer(this.surface);
  }
  validatePositionContract() {
    const placement = this.getAttribute('placement') || 'block-end';
    const alignment = this.getAttribute('alignment') || 'start';
    if (!SIDES.has(placement)) return 'placement must be block-end, block-start, inline-end, or inline-start';
    if (!['start', 'center', 'end'].includes(alignment)) return 'alignment must be start, center, or end';
    return '';
  }
  positionSurface() {
    const surface = this.surface;
    if (!surface || !this.hasAttribute('open') || !this._invoker?.isConnected) return;
    const anchor = this._anchorPoint
      ? { left: this._anchorPoint.x, right: this._anchorPoint.x, top: this._anchorPoint.y, bottom: this._anchorPoint.y, width: 0, height: 0 }
      : this._invoker.getBoundingClientRect();
    const overlay = surface.getBoundingClientRect();
    const styles = getComputedStyle(this);
    const gap = Number.parseFloat(styles.getPropertyValue('--ui-space-2')) || 8;
    const margin = Number.parseFloat(styles.getPropertyValue('--ui-space-3')) || 12;
    const preferred = this.getAttribute('placement') || 'block-end';
    const alignment = this.getAttribute('alignment') || 'start';
    const rtl = styles.direction === 'rtl';
    const physicalSide = side => {
      if (side === 'inline-end') return rtl ? 'left' : 'right';
      if (side === 'inline-start') return rtl ? 'right' : 'left';
      return side === 'block-start' ? 'top' : 'bottom';
    };
    const opposite = { top:'bottom', bottom:'top', left:'right', right:'left' };
    const alignBlock = () => {
      if (alignment === 'center') return anchor.left + (anchor.width - overlay.width) / 2;
      if ((alignment === 'start') !== rtl) return anchor.left;
      return anchor.right - overlay.width;
    };
    const alignInline = () => {
      if (alignment === 'center') return anchor.top + (anchor.height - overlay.height) / 2;
      return alignment === 'start' ? anchor.top : anchor.bottom - overlay.height;
    };
    const positionFor = side => ({
      left: side === 'left' ? anchor.left - overlay.width - gap : side === 'right' ? anchor.right + gap : alignBlock(),
      top: side === 'top' ? anchor.top - overlay.height - gap : side === 'bottom' ? anchor.bottom + gap : alignInline(),
    });
    const overflowScore = point => (
      Math.max(0, margin - point.left)
      + Math.max(0, margin - point.top)
      + Math.max(0, point.left + overlay.width + margin - window.innerWidth)
      + Math.max(0, point.top + overlay.height + margin - window.innerHeight)
    );
    const firstSide = physicalSide(preferred);
    const candidates = [firstSide, opposite[firstSide]].map(side => ({ side, ...positionFor(side) }));
    const best = candidates.sort((a, b) => overflowScore(a) - overflowScore(b))[0];
    const left = Math.min(window.innerWidth - overlay.width - margin, Math.max(margin, best.left));
    const top = Math.min(window.innerHeight - overlay.height - margin, Math.max(margin, best.top));
    surface.dataset.motionSide = best.side;
    surface.style.left = `${Math.round(left)}px`;
    surface.style.top = `${Math.round(top)}px`;
  }
  show(invoker = document.activeElement, anchorPoint = null) {
    if (this.hasAttribute('open') && this.dataset.motionState !== 'exiting') {
      this.positionSurface();
      return;
    }
    const generation = ++this._motionGeneration;
    this._invoker = invoker instanceof HTMLElement ? invoker : null;
    this._anchorPoint = anchorPoint;
    this._invoker?.setAttribute?.('aria-expanded', 'true');
    this.dataset.motionState = 'entering';
    setSurfaceInteraction(this.surface, true);
    this.dispatchEvent(new CustomEvent('ic-show', { bubbles: true, composed: true }));
    this.setAttribute('open', '');
    window.addEventListener('resize', this._onViewportChange);
    window.addEventListener('scroll', this._onViewportChange, true);
    queueMicrotask(async () => {
      this.positionSurface();
      await nextPaint();
      if (generation !== this._motionGeneration || !this.hasAttribute('open')) return;
      this.dataset.motionState = 'open';
      await waitForSurfaceMotion(this.surface);
      if (generation !== this._motionGeneration || !this.hasAttribute('open')) return;
      this.dispatchEvent(new CustomEvent('ic-after-show', { bubbles: true, composed: true }));
    });
  }
  hide(reason = 'programmatic') {
    if (!this.hasAttribute('open')) return;
    const generation = ++this._motionGeneration;
    this.dataset.motionState = 'exiting';
    setSurfaceInteraction(this.surface, false);
    this.removeAttribute('open');
    window.removeEventListener('resize', this._onViewportChange);
    window.removeEventListener('scroll', this._onViewportChange, true);
    this._invoker?.setAttribute?.('aria-expanded', 'false');
    this.dispatchEvent(new CustomEvent('ic-hide', { bubbles: true, composed: true, detail: { reason } }));
    this._invoker?.focus?.();
    this._anchorPoint = null;
    queueMicrotask(async () => {
      await waitForSurfaceMotion(this.surface);
      if (generation !== this._motionGeneration || this.hasAttribute('open') || this.dataset.motionState !== 'exiting') return;
      this.dataset.motionState = 'closed';
      this.syncSurfaceLayer();
      setSurfaceInteraction(this.surface, true);
      this.dispatchEvent(new CustomEvent('ic-after-hide', { bubbles: true, composed: true, detail: { reason } }));
    });
  }
  focus() { this.shadowRoot.querySelector('[part="surface"]')?.focus(); }
}

export class IcMenuItem extends HTMLElement {
  static observedAttributes = ['kind', 'label', 'checked', 'disabled', 'tone', 'icon'];
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._lastContractError = ''; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  focus(options) { this.shadowRoot.querySelector('button')?.focus(options); }
  validateContract() {
    const kind = this.getAttribute('kind') || 'command';
    if (!this.getAttribute('label')?.trim()) return 'label is required';
    if (!ITEM_KINDS.has(kind)) return 'kind must be command, checkbox, or radio';
    if (this.getAttribute('tone') === 'danger' && kind !== 'command') return 'danger is command-only';
    if (this.hasAttribute('checked') && kind === 'command') return 'checked requires checkbox or radio kind';
    return '';
  }
  render() {
    const kind = this.getAttribute('kind') || 'command';
    contractState(this, this.validateContract());
    this.setAttribute('role', kind === 'command' ? 'menuitem' : `menuitem${kind}`);
    this.tabIndex = this.hasAttribute('disabled') ? -1 : -1;
    if (kind !== 'command') this.setAttribute('aria-checked', String(this.hasAttribute('checked'))); else this.removeAttribute('aria-checked');
    this.toggleAttribute('aria-disabled', this.hasAttribute('disabled'));
    const icon = this.getAttribute('icon')?.trim();
    const check = kind === 'command' ? '' : `<span class="check" aria-hidden="true">${this.hasAttribute('checked') ? '<span class="checkmark"></span>' : ''}</span>`;
    const leadingIcon = icon ? `<span class="icon" aria-hidden="true"><ic-icon name="${icon}"></ic-icon></span>` : '';
    this.shadowRoot.innerHTML = `<style>:host{display:block;color:var(--ui-color-text-primary);text-align:start}button{box-sizing:border-box;width:100%;min-height:var(--ic-menu-item-control-height,var(--ui-density-control-height));display:flex;align-items:center;justify-content:flex-start;gap:var(--ic-menu-item-gap,var(--ui-density-gap));padding-block:var(--ui-space-1);padding-inline:var(--ui-density-inline-padding);border:0;border-radius:var(--ui-radius-s);background:var(--ui-color-action-tertiary);color:inherit;font:inherit;font-size:var(--ic-menu-item-font-size,var(--ui-density-font-size));text-align:start}button:focus-visible{background:var(--ui-focus-background);outline:var(--ui-focus-ring);outline-offset:var(--ui-focus-ring-offset);box-shadow:var(--ui-focus-ring-shadow)}button:hover:not(:disabled){background:var(--ui-color-action-tertiary-hover)}.check,.icon{display:grid;flex:0 0 var(--ic-menu-item-icon-size,var(--ui-density-icon-size));place-items:center;width:var(--ic-menu-item-icon-size,var(--ui-density-icon-size));height:var(--ic-menu-item-icon-size,var(--ui-density-icon-size));line-height:0}.icon{display:var(--ic-menu-item-icon-display,grid)}.icon ic-icon{--ic-icon-size:var(--ic-menu-item-icon-size,var(--ui-density-icon-size))}.checkmark{box-sizing:border-box;width:calc(var(--ic-menu-item-icon-size,var(--ui-density-icon-size)) * .44);height:calc(var(--ic-menu-item-icon-size,var(--ui-density-icon-size)) * .72);border:solid currentColor;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}.label{display:flex;min-width:0;min-height:var(--ic-menu-item-icon-size,var(--ui-density-icon-size));flex:1 1 auto;align-items:center;overflow-wrap:anywhere;line-height:var(--ui-line-height-tight);text-align:start}:host([tone="danger"]){color:var(--ui-color-text-danger)}:host([disabled]){opacity:1;color:var(--ui-color-text-disabled)}:host([disabled]) button{background:var(--ui-color-action-tertiary-disabled)}</style><button part="base" type="button" ${this.hasAttribute('disabled') ? 'disabled' : ''}>${check}${leadingIcon}<span class="label">${this.getAttribute('label') || ''}</span><slot></slot></button>`;
    this.shadowRoot.querySelector('button')?.addEventListener('click', () => { if (!contractState(this, this.validateContract()) || this.hasAttribute('disabled')) return; this.dispatchEvent(new CustomEvent('ic-select', { bubbles: true, composed: true, detail: { value: this.getAttribute('value'), kind } })); });
  }
}

export class IcMenu extends IcAnchoredOverlay {
  static observedAttributes = [...IcAnchoredOverlay.observedAttributes, 'trigger', 'selection', 'size', 'appearance', 'variant'];
  constructor() {
    super();
    this.addEventListener('ic-select', event => this.handleSelection(event));
  }
  validateContract() {
    const trigger = this.getAttribute('trigger') || 'dropdown';
    const selection = this.getAttribute('selection') || 'command';
    const size = this.getAttribute('size') || 'medium';
    const appearance = this.getAttribute('appearance') || 'standard';
    const variant = this.getAttribute('variant') || 'standard';
    if (!this.getAttribute('label')?.trim()) return 'label is required';
    if (!MENU_TRIGGERS.has(trigger)) return 'trigger must be dropdown or context';
    if (!MENU_SELECTIONS.has(selection)) return 'selection must be command, single, or multiple';
    if (!['medium', 'small'].includes(size)) return 'size must be medium or small';
    if (!['standard', 'iconless'].includes(appearance)) return 'appearance must be standard or iconless';
    if (!['standard', 'reference-generate'].includes(variant)) return 'variant must be standard or reference-generate';
    if (trigger === 'context' && selection !== 'command') return 'Context Menu is command-only';
    if (appearance === 'iconless' && selection !== 'command') return 'iconless appearance is command-only';
    if (variant === 'reference-generate' && (trigger !== 'context' || selection !== 'command' || size !== 'small')) return 'reference-generate variant requires context command small';
    return this.validatePositionContract();
  }
  handleSelection(event) {
    if (event.target === this) return;
    const selection = this.getAttribute('selection') || 'command';
    const item = event.composedPath().find(node => node?.localName === 'ic-menu-item');
    if (selection === 'single' && item) {
      this.querySelectorAll('ic-menu-item[kind="radio"]').forEach(option => option.toggleAttribute('checked', option === item));
    }
    if (selection === 'multiple' && item?.getAttribute('kind') === 'checkbox') item.toggleAttribute('checked');
    if (selection !== 'multiple') this.hide('select');
  }
  render() {
    contractState(this, this.validateContract());
    this.shadowRoot.innerHTML = `<style>:host{display:contents}:host([trigger="dropdown"][selection="command"]:not([size="small"])){--ic-menu-item-gap:var(--ui-space-3)}:host([size="small"]){--ic-menu-item-control-height:var(--ui-control-height-s);--ic-menu-item-font-size:var(--ui-font-size-2);--ic-menu-item-icon-size:var(--ui-icon-size-s);--ic-menu-item-gap:var(--ui-space-2);--ic-menu-surface-gap:var(--ui-space-1)}:host([appearance="iconless"]){--ic-menu-item-icon-display:none}[part="surface"]{position:fixed;inset:auto;margin:0;z-index:var(--ui-z-popover);min-width:12rem;max-width:min(22rem,calc(100vw - 2 * var(--ui-space-4)));max-height:min(24rem,calc(100vh - 2 * var(--ui-space-4)));overflow:auto;padding:var(--ic-menu-surface-gap,var(--ui-density-gap));border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);border-radius:var(--ui-radius-m);background:var(--ui-color-surface);box-shadow:var(--ui-shadow-overlay);color:var(--ui-color-text-primary);text-align:start}:host([variant="reference-generate"]) [part="surface"]{box-sizing:border-box;width:12.75rem;max-width:calc(100vw - 28px);border-radius:var(--ui-radius-m);background:var(--ui-color-surface-floating);backdrop-filter:blur(20px)}:host([variant="reference-generate"]) ::slotted(.reference-generate-label){display:block;padding:var(--ui-space-1) var(--ui-space-2) var(--ui-space-2);color:var(--ui-color-text-tertiary);font-size:var(--ui-font-size-1);line-height:var(--ui-line-height-tight);font-weight:var(--ui-font-weight-regular);letter-spacing:var(--ui-letter-spacing-wide)}::slotted([role="separator"]){display:block;height:var(--ui-border-width-thin);margin:var(--ic-menu-surface-gap,var(--ui-density-gap));background:var(--ui-color-border-secondary)}${ANCHORED_OVERLAY_MOTION_STYLES}</style><slot name="trigger"></slot><div part="surface" role="menu" aria-label="${this.getAttribute('label') || ''}" tabindex="-1" popover="manual"><slot></slot></div>`;
    const items = () => [...this.querySelectorAll('ic-menu-item:not([disabled])')];
    this.shadowRoot.querySelector('[part="surface"]')?.addEventListener('keydown', event => { const enabled = items(); const current = enabled.indexOf(document.activeElement); let next = -1; if (event.key === 'ArrowDown') next = current < enabled.length - 1 ? current + 1 : 0; if (event.key === 'ArrowUp') next = current > 0 ? current - 1 : enabled.length - 1; if (event.key === 'Home') next = 0; if (event.key === 'End') next = enabled.length - 1; if (event.key === 'Escape') { event.preventDefault(); this.hide('escape'); return; } if (next >= 0) { event.preventDefault(); enabled[next]?.focus(); } });
  }
  focusFirstItem() {
    queueMicrotask(() => {
      const firstItem = this.querySelector('ic-menu-item:not([disabled])');
      firstItem?.focus();
    });
  }
  show(invoker) { if (!contractState(this, this.validateContract())) return; super.show(invoker); this.focusFirstItem(); }
  showAt(clientX, clientY, invoker = document.activeElement) {
    if (!contractState(this, this.validateContract())) return;
    const x = Number(clientX);
    const y = Number(clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      contractState(this, 'showAt requires finite viewport coordinates');
      return;
    }
    super.show(invoker, { x, y });
    this.focusFirstItem();
  }
}

export class IcPopover extends IcAnchoredOverlay {
  validateContract() { if (!this.getAttribute('label')?.trim()) return 'label is required'; const content = this.getAttribute('content') || 'informational'; const dismiss = this.getAttribute('dismiss-policy') || 'light'; const focus = this.getAttribute('focus-policy') || (content === 'interactive' ? 'move-into' : 'retain-trigger'); if (!['informational', 'interactive'].includes(content)) return 'content must be informational or interactive'; if (content === 'informational' && (dismiss !== 'light' || focus !== 'retain-trigger')) return 'informational Popover requires light dismissal and retained trigger focus'; return this.validatePositionContract(); }
  render() { contractState(this, this.validateContract()); this.shadowRoot.innerHTML = `<style>:host{display:contents}[part="surface"]{position:fixed;inset:auto;margin:0;z-index:var(--ui-z-popover);max-width:min(28rem,calc(100vw - 2 * var(--ui-space-4)));max-height:calc(100vh - 2 * var(--ui-space-4));overflow:auto;padding:var(--ui-density-inline-padding);border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);border-radius:var(--ui-radius-m);background:var(--ui-color-surface);box-shadow:var(--ui-shadow-overlay);font-size:var(--ui-density-font-size)}${ANCHORED_OVERLAY_MOTION_STYLES}</style><slot name="trigger"></slot><section part="surface" aria-label="${this.getAttribute('label') || ''}" tabindex="-1" popover="manual"><slot></slot></section>`; }
  show(invoker) { if (!contractState(this, this.validateContract())) return; super.show(invoker); if ((this.getAttribute('focus-policy') || '') === 'move-into') queueMicrotask(() => super.focus()); }
}

let tooltipId = 0;

export class IcTooltip extends HTMLElement {
  static observedAttributes = ['content', 'open', 'placement', 'shortcut'];
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastContractError = '';
    this._invoker = null;
    this._previousDescribedBy = null;
    this._tooltipId = `ic-tooltip-${++tooltipId}`;
    this._motionGeneration = 0;
    this._onPointerEnter = () => this.show();
    this._onPointerLeave = () => this.hide('pointerleave');
    this._onFocusIn = () => this.show();
    this._onFocusOut = () => this.hide('focusout');
    this._onKeydown = event => { if (event.key === 'Escape') this.hide('escape'); };
    this._onViewportChange = () => this.position();
  }
  connectedCallback() {
    if (!this.dataset.motionState) this.dataset.motionState = this.hasAttribute('open') ? 'open' : 'closed';
    this.render();
    this.syncListeners();
    this.syncSurfaceLayer();
  }
  disconnectedCallback() {
    this._motionGeneration += 1;
    closeTopLayer(this.surface);
    this.removeInteractionListeners();
    this.removeViewportListeners();
    this.restoreDescription();
  }
  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name !== 'open') {
      closeTopLayer(this.surface);
      this.render();
      setSurfaceInteraction(this.surface, this.dataset.motionState !== 'exiting');
    } else if (this.hasAttribute('open') && ['closed', 'exiting'].includes(this.dataset.motionState)) {
      this._motionGeneration += 1;
      this.dataset.motionState = 'open';
      setSurfaceInteraction(this.surface, true);
    } else if (!this.hasAttribute('open') && !['closed', 'exiting'].includes(this.dataset.motionState)) {
      this._motionGeneration += 1;
      this.dataset.motionState = 'closed';
      setSurfaceInteraction(this.surface, true);
    }
    this.syncSurfaceLayer();
    if (this.hasAttribute('open')) queueMicrotask(() => this.position());
  }
  get trigger() { return this.querySelector('[slot="trigger"]'); }
  get surface() { return this.shadowRoot.querySelector('[role="tooltip"]'); }
  syncSurfaceLayer() {
    if (this.hasAttribute('open') || this.dataset.motionState === 'exiting') openTopLayer(this.surface, 'tooltip');
    else closeTopLayer(this.surface);
  }
  validateContract() {
    if (!this.getAttribute('content')?.trim()) return 'content is required';
    if (!SIDES.has(this.getAttribute('placement') || 'block-start')) return 'placement must be block-end, block-start, inline-end, or inline-start';
    return '';
  }
  syncListeners() {
    this.removeInteractionListeners();
    if (!this.trigger) return;
    this.addEventListener('pointerenter', this._onPointerEnter);
    this.addEventListener('pointerleave', this._onPointerLeave);
    this.addEventListener('focusin', this._onFocusIn);
    this.addEventListener('focusout', this._onFocusOut);
    this.addEventListener('keydown', this._onKeydown);
    this.trigger?.removeAttribute('title');
  }
  removeInteractionListeners() {
    this.removeEventListener('pointerenter', this._onPointerEnter);
    this.removeEventListener('pointerleave', this._onPointerLeave);
    this.removeEventListener('focusin', this._onFocusIn);
    this.removeEventListener('focusout', this._onFocusOut);
    this.removeEventListener('keydown', this._onKeydown);
  }
  addViewportListeners() {
    window.addEventListener('resize', this._onViewportChange);
    window.addEventListener('scroll', this._onViewportChange, true);
  }
  removeViewportListeners() {
    window.removeEventListener('resize', this._onViewportChange);
    window.removeEventListener('scroll', this._onViewportChange, true);
  }
  restoreDescription() {
    if (!this._invoker) return;
    if (this._previousDescribedBy) this._invoker.setAttribute('aria-describedby', this._previousDescribedBy);
    else this._invoker.removeAttribute('aria-describedby');
    this._invoker = null;
    this._previousDescribedBy = null;
  }
  render() {
    const content = this.getAttribute('content')?.trim() || '';
    const shortcut = this.getAttribute('shortcut')?.trim() || '';
    contractState(this, this.validateContract());
    this.shadowRoot.innerHTML = `<style>:host{display:contents}[role="tooltip"]{position:fixed;inset:auto;margin:0;z-index:var(--ui-z-tooltip);max-width:min(18rem,calc(100vw - 2 * var(--ui-space-3)));padding:var(--ui-space-1) var(--ui-space-2);border:0;border-radius:var(--ui-radius-s);background:var(--ui-color-mask);color:var(--ui-color-text-white);box-shadow:var(--ui-shadow-raised);font:var(--ui-text-body-compact);line-height:var(--ui-line-height-tight);white-space:normal;pointer-events:none}[part="surface"]{display:inline-flex;align-items:center;gap:var(--ui-space-4)}[part="shortcut"]{padding:0;border:0;background:transparent;color:currentColor;opacity:.72;font:inherit;font-weight:var(--ui-font-weight-medium);white-space:nowrap}[part="shortcut"]:empty{display:none}${TOOLTIP_MOTION_STYLES}</style><slot name="trigger"></slot><span id="${this._tooltipId}" part="surface" role="tooltip" popover="manual"><span part="label"></span><kbd part="shortcut"></kbd></span>`;
    this.shadowRoot.querySelector('[part="label"]').textContent = content;
    this.shadowRoot.querySelector('[part="shortcut"]').textContent = shortcut;
  }
  position() {
    const surface = this.surface;
    if (!surface || !this.hasAttribute('open') || !this._invoker?.isConnected) return;
    const anchor = this._invoker.getBoundingClientRect();
    const tip = surface.getBoundingClientRect();
    const styles = getComputedStyle(this);
    const gap = Number.parseFloat(styles.getPropertyValue('--ui-space-2')) || 8;
    const margin = Number.parseFloat(styles.getPropertyValue('--ui-space-3')) || 12;
    const placement = this.getAttribute('placement') || 'block-start';
    const candidates = {
      'block-start': [anchor.left + (anchor.width - tip.width) / 2, anchor.top - tip.height - gap],
      'block-end': [anchor.left + (anchor.width - tip.width) / 2, anchor.bottom + gap],
      'inline-start': [anchor.left - tip.width - gap, anchor.top + (anchor.height - tip.height) / 2],
      'inline-end': [anchor.right + gap, anchor.top + (anchor.height - tip.height) / 2],
    };
    let [left, top] = candidates[placement];
    let actualPlacement = placement;
    if (placement === 'block-start' && top < margin) { top = anchor.bottom + gap; actualPlacement = 'block-end'; }
    if (placement === 'block-end' && top + tip.height > window.innerHeight - margin) { top = anchor.top - tip.height - gap; actualPlacement = 'block-start'; }
    if (placement === 'inline-start' && left < margin) { left = anchor.right + gap; actualPlacement = 'inline-end'; }
    if (placement === 'inline-end' && left + tip.width > window.innerWidth - margin) { left = anchor.left - tip.width - gap; actualPlacement = 'inline-start'; }
    surface.dataset.motionSide = { 'block-start':'top', 'block-end':'bottom', 'inline-start':'left', 'inline-end':'right' }[actualPlacement];
    surface.style.left = `${Math.round(Math.min(window.innerWidth - tip.width - margin, Math.max(margin, left)))}px`;
    surface.style.top = `${Math.round(Math.min(window.innerHeight - tip.height - margin, Math.max(margin, top)))}px`;
  }
  show(invoker = this.trigger) {
    if (!contractState(this, this.validateContract())) return;
    const anchor = invoker instanceof HTMLElement ? invoker : this.trigger;
    if (!anchor) return;
    if (this.hasAttribute('open') && this.dataset.motionState !== 'exiting') {
      this.position();
      return;
    }
    const generation = ++this._motionGeneration;
    if (this._invoker !== anchor) {
      this.restoreDescription();
      this._invoker = anchor;
      this._previousDescribedBy = anchor.getAttribute('aria-describedby');
    }
    anchor.removeAttribute('title');
    const describedBy = [this._previousDescribedBy, this._tooltipId].filter(Boolean).join(' ');
    anchor.setAttribute('aria-describedby', describedBy);
    this.dataset.motionState = 'entering';
    setSurfaceInteraction(this.surface, true);
    this.setAttribute('open', '');
    this.addViewportListeners();
    queueMicrotask(async () => {
      this.position();
      await nextPaint();
      if (generation !== this._motionGeneration || !this.hasAttribute('open')) return;
      this.dataset.motionState = 'open';
      await waitForSurfaceMotion(this.surface);
      if (generation !== this._motionGeneration || !this.hasAttribute('open')) return;
      this.dispatchEvent(new CustomEvent('ic-after-show', { bubbles: true, composed: true }));
    });
  }
  hide(reason = 'programmatic') {
    if (!this.hasAttribute('open')) return;
    const generation = ++this._motionGeneration;
    this.dataset.motionState = 'exiting';
    setSurfaceInteraction(this.surface, false);
    this.removeAttribute('open');
    this.removeViewportListeners();
    this.restoreDescription();
    queueMicrotask(async () => {
      await waitForSurfaceMotion(this.surface);
      if (generation !== this._motionGeneration || this.hasAttribute('open') || this.dataset.motionState !== 'exiting') return;
      this.dataset.motionState = 'closed';
      this.syncSurfaceLayer();
      setSurfaceInteraction(this.surface, true);
      this.dispatchEvent(new CustomEvent('ic-after-hide', { bubbles: true, composed: true, detail: { reason } }));
    });
  }
}

export { contractState as menuPopoverContractState, SIDES as menuPopoverSides };
