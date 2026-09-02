import { activeOverlayScope, closeTopLayer, openTopLayer } from './overlay-layer.js?v=ic-ui-ff02b51bdc35';
import { createStackedFeedbackQueue } from './feedback-progress/stacked-feedback-queue.js?v=ic-ui-ff02b51bdc35';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger']);
const BADGE_KINDS = new Set(['label', 'count', 'status']);
const BADGE_SIZES = new Set(['small', 'medium', 'large']);

const sharedStyles = `
  :host { box-sizing: border-box; color: var(--ui-color-text-primary); font: inherit; }
  :host([hidden]) { display: none !important; }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; }
`;

function contractState(host, reason, detail = {}) {
  host.dataset.icContractStatus = reason ? 'invalid' : 'ready';
  if (!reason) {
    delete host.dataset.icContractReason;
    host.removeAttribute('aria-disabled');
    host._lastContractError = '';
    return true;
  }
  host.dataset.icContractReason = reason;
  host.setAttribute('aria-disabled', 'true');
  const signature = JSON.stringify({ reason, ...detail });
  if (signature !== host._lastContractError) {
    host._lastContractError = signature;
    host.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: { component: host.localName, reason, ...detail },
    }));
  }
  return false;
}

function toneOf(host) {
  return host.getAttribute('tone') || 'neutral';
}

function validTone(host) {
  const tone = toneOf(host);
  return TONES.has(tone) ? '' : `tone must be one of ${[...TONES].join(', ')}`;
}

function hasText(host) {
  return Boolean(host.textContent?.trim());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function symbolFor(tone) {
  return { neutral: '●', info: 'ⓘ', success: '✓', warning: '!', danger: '×' }[tone];
}

function feedbackSymbolFor(tone) {
  const icon = {
    neutral: 'circle-alert',
    info: 'info',
    success: 'circle-check-big',
    warning: 'triangle-alert',
    danger: 'circle-alert',
  }[tone];
  return `<ic-icon name="${icon}" size="small" aria-hidden="true"></ic-icon>`;
}

class IcFeedbackElement extends HTMLElement {
  constructor() {
    super();
    this._lastContractError = '';
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
}

export class IcAlert extends IcFeedbackElement {
  static observedAttributes = ['tone', 'dismissible', 'heading', 'action-label'];

  validateContract() {
    return validTone(this)
      || (this.hasAttribute('action-label') && !this.getAttribute('action-label')?.trim() ? 'action-label must not be empty' : '')
      || (!hasText(this) ? 'message content is required for ic-alert' : '');
  }

  render() {
    const reason = this.validateContract();
    const tone = toneOf(this);
    const heading = this.getAttribute('heading')?.trim() || '';
    const actionLabel = this.getAttribute('action-label')?.trim() || '';
    contractState(this, reason);
    this.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    const dismissLabel = document.documentElement.lang.toLowerCase().startsWith('zh') ? '关闭' : 'Dismiss';
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; width:100%; max-width:30rem; --ic-tone:var(--ui-color-text-tertiary); }
      :host([data-ic-stack-state]) { opacity:1; transform:translateY(var(--ic-stack-offset, 0)) scale(var(--ic-stack-scale, 1)); transform-origin:top center; transition:transform var(--ui-motion-duration-deliberate) ease, opacity var(--ui-motion-duration-deliberate) ease; will-change:transform,opacity; z-index:var(--ic-stack-z, 1); }
      :host([data-ic-stack-index]:not([data-ic-stack-index="0"])) { pointer-events:none; }
      :host([data-ic-stack-hidden]) { visibility:hidden; opacity:0; }
      :host([data-ic-stack-state="entering"]) { opacity:0; transform:translateY(var(--ic-stack-motion-offset, -100%)) scale(.96); transition:none; }
      :host([data-ic-stack-state="exiting"]) { opacity:0; pointer-events:none; transform:translateY(var(--ic-stack-motion-offset, -100%)) scale(.96); transition-duration:var(--ui-motion-duration-normal); transition-timing-function:ease-out; }
      :host([tone="success"]) { --ic-tone:var(--ui-color-text-success, var(--ui-color-text-primary)); }
      :host([tone="warning"]) { --ic-tone:var(--ui-color-text-warning, var(--ui-color-text-primary)); }
      :host([tone="danger"]) { --ic-tone:var(--ui-color-text-danger); }
      .alert { position:relative; display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:var(--ui-space-3); align-items:start; padding:var(--ui-space-3) var(--ui-space-4); border:0; outline:1px solid var(--ui-color-border-secondary); outline-offset:0; border-radius:var(--ui-radius-s); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-overlay); }
      .alert::before { content:""; position:absolute; inset-block:0; inset-inline-start:0; inline-size:3px; border-start-start-radius:inherit; border-end-start-radius:inherit; background:var(--ic-tone); pointer-events:none; }
      :host([action-label]) .alert { grid-template-columns:auto minmax(0,1fr) auto auto; }
      .symbol { display:grid; place-items:center; margin-block-start:.15625rem; color:var(--ic-tone); line-height:1.4; }
      :host(:not([heading])) .symbol, :host(:not([heading])) .content { align-self:center; }
      :host(:not([heading])) .symbol { margin-block-start:0; }
      .symbol ic-icon { --ic-icon-context-stroke-width:2; display:block; }
      .content { min-width:0; display:grid; gap:var(--ui-space-1); line-height:1.45; overflow-wrap:anywhere; }
      .heading { color:var(--ui-color-text-primary); font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-medium); line-height:var(--ui-line-height-body); }
      .message { min-width:0; display:-webkit-box; overflow:hidden; color:var(--ui-color-text-tertiary); font:var(--ui-text-subtitle); font-size:var(--ui-font-size-2); -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; }
      .message ::slotted(strong) { font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-medium); }
      .action { align-self:center; white-space:nowrap; }
      .dismiss { --ic-icon-button-control-size:1.3125rem; --ic-icon-context-stroke-width:2; inline-size:1.3125rem; block-size:1.3125rem; align-self:center; }
      .dismiss::part(base) { inline-size:100%; min-inline-size:100%; max-inline-size:100%; block-size:100%; min-block-size:100%; padding-inline:0; }
      :host([data-ic-contract-status="invalid"]) .alert { opacity:.55; }
      @media (max-width:420px) { .alert { grid-template-columns:auto minmax(0,1fr) auto; } .action { grid-column:2; justify-self:start; } }
      @media (prefers-reduced-motion:reduce) {
        :host([data-ic-stack-state]) { transition-duration:1ms; }
        :host([data-ic-stack-state="entering"]), :host([data-ic-stack-state="exiting"]) { transform:translateY(var(--ic-stack-offset, 0)) scale(var(--ic-stack-scale, 1)); }
      }
      :host-context(html[data-ui-motion="reduced"])[data-ic-stack-state] { transition-duration:1ms; }
      :host-context(html[data-ui-motion="reduced"]):is([data-ic-stack-state="entering"],[data-ic-stack-state="exiting"]) { transform:translateY(var(--ic-stack-offset, 0)) scale(var(--ic-stack-scale, 1)); }
    </style><div class="alert" part="base"><span class="symbol" part="symbol" aria-hidden="true">${feedbackSymbolFor(tone)}</span><div class="content" part="content">${heading ? `<strong class="heading" part="heading">${escapeHtml(heading)}</strong>` : ''}<div class="message" part="message"><slot></slot></div><slot name="action"></slot></div>${actionLabel ? `<ic-button class="action" data-component-name="ic-button-secondary-small" type="button" size="small" hierarchy="secondary" tone="neutral">${escapeHtml(actionLabel)}</ic-button>` : ''}${this.hasAttribute('dismissible') ? `<ic-icon-button class="dismiss" part="dismiss" data-component-name="ic-icon-button-tertiary-small" type="button" size="small" background="ghost" hierarchy="secondary" tone="neutral" icon="close" label="${dismissLabel}" tooltip-disabled></ic-icon-button>` : ''}</div>`;
    this.shadowRoot.querySelector('.action')?.addEventListener('click', () => {
      if (!contractState(this, this.validateContract())) return;
      this.dispatchEvent(new CustomEvent('ic-action', {
        bubbles: true,
        composed: true,
        detail: { action: 'primary' },
      }));
    });
    this.shadowRoot.querySelector('.dismiss')?.addEventListener('click', () => {
      if (!contractState(this, this.validateContract())) return;
      this.hidden = true;
      this.dispatchEvent(new CustomEvent('ic-dismiss', { bubbles: true, composed: true }));
    });
  }
}

export class IcBadge extends IcFeedbackElement {
  static observedAttributes = ['tone', 'kind', 'size', 'loading'];

  validateContract() {
    const kind = this.getAttribute('kind') || 'label';
    const size = this.getAttribute('size') || 'medium';
    return validTone(this) || (!BADGE_KINDS.has(kind) ? 'kind must be label, count, or status' : '') || (!BADGE_SIZES.has(size) ? 'size must be small, medium, or large' : '') || (this.hasAttribute('loading') && kind !== 'status' ? 'loading badge is only valid for status kind' : '') || (!hasText(this) ? 'badge content is required' : '');
  }

  render() {
    const reason = this.validateContract();
    const kind = this.getAttribute('kind') || 'label';
    const loading = this.hasAttribute('loading');
    contractState(this, reason);
    if (kind === 'status') this.setAttribute('role', 'status'); else this.removeAttribute('role');
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:inline-flex; vertical-align:middle; --ic-badge-height:var(--ui-icon-size-m); --ic-badge-padding-inline:var(--ui-space-2); --ic-badge-font-size:var(--ui-font-size-2); --ic-badge-indicator-size:var(--ui-icon-size-xs); }
      :host([size="small"]) { --ic-badge-height:var(--ui-icon-size-s); --ic-badge-padding-inline:var(--ui-space-1); --ic-badge-font-size:var(--ui-font-size-1); --ic-badge-indicator-size:calc(var(--ui-icon-size-xs) - var(--ui-space-1)); }
      :host([size="large"]) { --ic-badge-height:var(--ui-icon-size-l); --ic-badge-padding-inline:var(--ui-space-3); --ic-badge-font-size:var(--ui-font-size-3); --ic-badge-indicator-size:var(--ui-icon-size-s); }
      .badge { display:inline-flex; gap:var(--ui-space-1); align-items:center; min-height:var(--ic-badge-height); max-width:100%; padding:0 var(--ic-badge-padding-inline); border:var(--ui-border-width-none); border-radius:var(--ui-radius-pill); color:var(--ui-color-text-primary); background:var(--ui-color-surface-subtle); font-size:var(--ic-badge-font-size); font-weight:var(--ui-font-weight-medium); line-height:var(--ui-line-height-compact); }
      .dot { color:var(--ui-color-text-tertiary); }
      :host([tone="success"]) .badge { border-color:color-mix(in srgb, var(--ui-color-border-success) 34%, transparent); color:var(--ui-color-text-success); background:var(--ui-color-surface-success); }
      :host([tone="warning"]) .badge { border-color:color-mix(in srgb, var(--ui-color-border-warning) 38%, transparent); color:var(--ui-color-text-warning); background:color-mix(in srgb, var(--ui-color-text-warning) 13%, var(--ui-color-surface)); }
      :host([tone="danger"]) .badge { border-color:color-mix(in srgb, var(--ui-color-border-danger) 34%, transparent); color:var(--ui-color-text-danger); background:var(--ui-color-surface-danger); }
      :host(:not([kind])) .badge, :host([kind="label"]) .badge { border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); background:var(--ui-color-surface); font-weight:var(--ui-font-weight-regular); }
      :host([kind="status"]) .badge { font-weight:var(--ui-font-weight-regular); }
      :host([tone="success"]) .dot { color:var(--ui-color-text-success, var(--ui-color-text-primary)); }
      :host([tone="warning"]) .dot { color:var(--ui-color-text-warning, var(--ui-color-text-primary)); }
      :host([tone="danger"]) .dot { color:var(--ui-color-text-danger); }
      .spinner { width:var(--ic-badge-indicator-size); height:var(--ic-badge-indicator-size); flex:none; border:var(--ui-border-width-thin) solid currentColor; border-inline-end-color:transparent; border-radius:var(--ui-radius-pill); animation:ic-badge-spin var(--ic-badge-spin-duration, calc(var(--ui-motion-duration-slow) * 4)) var(--ui-motion-ease-linear) infinite; }
      @keyframes ic-badge-spin { to { transform:rotate(360deg); } }
      @media (prefers-reduced-motion:reduce) { .spinner { animation:none; } }
      :host-context([data-ui-motion="reduced"]) .spinner { animation:none; }
    </style><span class="badge" part="base">${kind === 'status' ? (loading ? '<span class="spinner" aria-hidden="true"></span>' : `<span class="dot" aria-hidden="true">${symbolFor(toneOf(this))}</span>`) : ''}<slot></slot></span>`;
  }
}

const toastStack = createStackedFeedbackQueue({
  edge: 'end',
  visibleCount: 3,
  stackStepPx: 14,
  scaleStep: 0.04,
  exitDuration: 300,
  exposeVisibleStack: true,
  setPresented(toast, visible) {
    toast.hidden = !visible;
    if (visible) openTopLayer(toast, 'toast');
    else closeTopLayer(toast);
  },
});

export class IcToast extends IcFeedbackElement {
  static observedAttributes = ['tone', 'variant', 'heading', 'action-label'];

  static notify(message, { tone = 'neutral', duration, actionLabel = '', onAction = null } = {}) {
    const text = String(message || '').trim();
    if (!text) throw new TypeError('ic-toast notification requires message content');
    const toast = document.createElement('ic-toast');
    toast.textContent = text;
    toast.setAttribute('tone', tone);
    if (String(actionLabel || '').trim()) {
      toast.setAttribute('variant', 'action');
      toast.setAttribute('action-label', String(actionLabel).trim());
      toast.addEventListener('ic-action', () => {
        if (typeof onAction === 'function') onAction();
        toast.dismiss();
      }, { once: true });
    }
    toast.dataset.icOverlay = '';
    activeOverlayScope().appendChild(toast);
    const requestedDuration = duration ?? 4000;
    toast.startAutoDismiss(requestedDuration <= 0 && !String(actionLabel || '').trim() ? 4000 : requestedDuration);
    return toast;
  }

  validateContract() {
    const variant = this.getAttribute('variant') || 'default';
    return validTone(this)
      || (!['default', 'action'].includes(variant) ? 'variant must be default or action' : '')
      || (variant === 'action' && !this.getAttribute('action-label')?.trim() ? 'action-label is required for action variant' : '')
      || (!hasText(this) ? 'message content is required for ic-toast' : '');
  }

  connectedCallback() {
    this.setAttribute('popover', 'manual');
    this.setAttribute('data-ic-stack-state', 'entering');
    this._dismissed = false;
    super.connectedCallback();
    toastStack.enqueue(this);
  }

  disconnectedCallback() {
    window.clearTimeout(this._dismissTimer);
    window.clearTimeout(this._exitTimer);
    closeTopLayer(this);
    toastStack.disconnect(this);
  }

  dismiss() {
    if (this._dismissed) return;
    window.clearTimeout(this._dismissTimer);
    this._dismissed = true;
    return toastStack.dismiss(this);
  }

  startAutoDismiss(duration) {
    const total = Number(duration);
    if (!Number.isFinite(total) || total <= 0) return;
    let remaining = total;
    let startedAt = 0;
    const resume = () => {
      if (this._dismissed) return;
      window.clearTimeout(this._dismissTimer);
      startedAt = performance.now();
      this._dismissTimer = window.setTimeout(() => this.dismiss(), remaining);
    };
    const pause = () => {
      if (!startedAt) return;
      window.clearTimeout(this._dismissTimer);
      remaining = Math.max(0, remaining - (performance.now() - startedAt));
      startedAt = 0;
    };
    this.addEventListener('pointerenter', pause);
    this.addEventListener('pointerleave', resume);
    this.addEventListener('focusin', pause);
    this.addEventListener('focusout', (event) => { if (!this.contains(event.relatedTarget)) resume(); });
    resume();
  }

  render() {
    const reason = this.validateContract();
    const tone = toneOf(this);
    const variant = this.getAttribute('variant') || 'default';
    const heading = this.getAttribute('heading')?.trim() || '';
    const actionLabel = this.getAttribute('action-label')?.trim() || '';
    contractState(this, reason);
    this.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { position:fixed; inset-block-start:auto; inset-block-end:var(--ic-toast-block-end-offset, max(var(--ui-space-6), env(safe-area-inset-bottom))); inset-inline:0; z-index:calc(var(--ui-z-toast) + var(--ic-stack-z, 0)); width:auto; inline-size:max-content; min-width:min(17rem, calc(100vw - 2 * var(--ui-space-4))); max-width:min(27.2rem, calc(100vw - 2 * var(--ui-space-4))); margin-block:0; margin-inline:auto; padding:0; overflow:visible; border:0; color:var(--ui-color-text-primary); background:transparent; transform:translateY(var(--ic-stack-offset, 0)) scale(var(--ic-stack-scale, 1)); transform-origin:bottom center; transition:transform var(--ui-motion-duration-normal) var(--ui-motion-ease-standard), opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); --ic-toast-tone:var(--ui-color-text-tertiary); }
      :host([data-ic-stack-state="entering"]) { pointer-events:none; opacity:0; transform:translateY(var(--ic-stack-offset, 0)) scale(.96); transition:none; }
      :host([data-ic-stack-state="exiting"]) { pointer-events:none; opacity:0; transform:translateY(calc(var(--ic-stack-offset, 0px) + var(--ic-stack-motion-offset, 100%))) scale(var(--ic-stack-scale, 1)); transition-duration:var(--ui-motion-duration-slow), var(--ui-motion-duration-normal); }
      :host([tone="success"]) { --ic-toast-tone:var(--ui-color-text-success, var(--ui-color-text-primary)); }
      :host([tone="warning"]) { --ic-toast-tone:var(--ui-color-text-warning, var(--ui-color-text-primary)); }
      :host([tone="danger"]) { --ic-toast-tone:var(--ui-color-text-danger); }
      .toast { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:var(--ui-space-2); align-items:center; min-height:var(--ui-control-height-m); padding:var(--ui-space-2) var(--ui-space-3); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-m); background:var(--ui-color-surface-floating); box-shadow:var(--ui-shadow-overlay); }
      .symbol { width:var(--ui-icon-size-m); height:var(--ui-icon-size-m); display:grid; flex:none; place-items:center; border-radius:var(--ui-radius-pill); color:var(--ic-toast-tone); background:color-mix(in srgb, var(--ic-toast-tone) 12%, transparent); }
      .symbol ic-icon { --ic-icon-context-stroke-width:2; display:block; }
      .content { min-width:0; display:grid; gap:var(--ui-space-1); overflow-wrap:anywhere; }
      .heading { color:var(--ui-color-text-primary); font:var(--ui-text-label); }
      .message { min-width:0; color:var(--ui-color-text-primary); font:var(--ui-text-body); }
      .action { min-height:var(--ui-control-height-s); padding:0 var(--ui-space-3); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-s); color:var(--ui-color-text-primary); background:var(--ui-color-action-secondary); cursor:pointer; font:var(--ui-text-label); white-space:nowrap; }
      .action:hover { background:var(--ui-color-action-secondary-hover); }
      .action:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); box-shadow:var(--ui-focus-ring-shadow); }
      :host(:not([data-ic-stack-index="0"])) :is(.symbol, .content, .action) { opacity:0; }
      :host([data-ic-contract-status="invalid"]) .toast { opacity:.55; }
      @media (max-width:420px) { .toast { grid-template-columns:auto minmax(0,1fr) auto; } .action { grid-column:2; justify-self:start; } }
      @media (prefers-reduced-motion:reduce) {
        :host { transition-duration:1ms; }
        :host([data-ic-stack-state="entering"]), :host([data-ic-stack-state="exiting"]) { transform:translateY(var(--ic-stack-offset, 0)) scale(var(--ic-stack-scale, 1)); }
      }
      :host-context(html[data-ui-motion="reduced"]) { transition-duration:1ms; }
      :host-context(html[data-ui-motion="reduced"]):is([data-ic-stack-state="entering"],[data-ic-stack-state="exiting"]) { transform:translateY(var(--ic-stack-offset, 0)) scale(var(--ic-stack-scale, 1)); }
    </style><div class="toast" part="base"><span class="symbol" part="symbol" aria-hidden="true">${feedbackSymbolFor(tone)}</span><div class="content" part="content">${heading ? `<strong class="heading" part="heading">${escapeHtml(heading)}</strong>` : ''}<div class="message" part="message"><slot></slot></div><slot name="action"></slot></div>${variant === 'action' ? `<button class="action" part="action" type="button">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
    this.shadowRoot.querySelector('.action')?.addEventListener('click', () => {
      if (!contractState(this, this.validateContract())) return;
      this.dispatchEvent(new CustomEvent('ic-action', {
        bubbles: true,
        composed: true,
        detail: { action: 'primary' },
      }));
    });
  }
}

export class IcLoading extends IcFeedbackElement {
  static observedAttributes = ['label', 'presentation'];
  validateContract() {
    const presentation = this.getAttribute('presentation') || 'inline';
    if (!this.getAttribute('label')?.trim()) return 'label is required for ic-loading';
    return ['inline', 'region'].includes(presentation) ? '' : 'presentation must be inline or region';
  }
  render() {
    contractState(this, this.validateContract());
    const label = this.getAttribute('label')?.trim() || '';
    this.setAttribute('role', 'status');
    this.setAttribute('aria-label', label);
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:inline-flex; align-items:center; gap:var(--ui-space-2); }
      .spinner { width:1em; height:1em; border:var(--ui-border-width-strong) solid var(--ui-color-border-secondary); border-top-color:var(--ui-color-text-primary); border-radius:50%; animation:ic-spin calc(var(--ui-motion-duration-slow) * 4) linear infinite; }
      .label { overflow-wrap:anywhere; }
      @keyframes ic-spin { to { transform:rotate(360deg); } }
      @media (prefers-reduced-motion:reduce) { .spinner { animation:none; border-top-color:var(--ui-color-border-primary, var(--ui-color-text-tertiary)); } }
      :host-context([data-ui-motion="reduced"]) .spinner { animation:none; border-top-color:var(--ui-color-border-primary, var(--ui-color-text-tertiary)); }
    </style><span class="spinner" part="spinner" aria-hidden="true"></span><span class="label" part="label">${label}</span>`;
  }
}

export class IcProgress extends IcFeedbackElement {
  static observedAttributes = ['label', 'value', 'max', 'value-text'];
  validateContract() {
    const label = this.getAttribute('label')?.trim();
    const value = Number(this.getAttribute('value'));
    const max = Number(this.getAttribute('max'));
    if (!label) return 'label is required for ic-progress';
    if (!Number.isFinite(value) || !Number.isFinite(max)) return 'value and max must be finite';
    if (max <= 0 || value < 0 || value > max) return 'value must be between zero and a positive max';
    return '';
  }
  render() {
    const reason = this.validateContract();
    const value = Number(this.getAttribute('value')) || 0;
    const max = Number(this.getAttribute('max')) || 1;
    const label = this.getAttribute('label')?.trim() || '';
    const valueText = this.getAttribute('value-text')?.trim() || `${Math.round(value / max * 100)}%`;
    contractState(this, reason);
    this.setAttribute('role', 'progressbar');
    this.setAttribute('aria-label', label);
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuemax', String(max));
    this.setAttribute('aria-valuenow', String(value));
    this.setAttribute('aria-valuetext', valueText);
    const percent = Math.max(0, Math.min(100, value / max * 100));
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:grid; gap:var(--ui-space-2); min-width:8rem; --ic-progress-text:var(--ui-color-text-tertiary); --ic-progress-track:var(--ui-color-surface-subtle); --ic-progress-fill:var(--ui-color-text-primary); }
      .meta { display:flex; justify-content:space-between; gap:var(--ui-space-3); font:var(--ui-text-body-compact); }
      .value { color:var(--ic-progress-text); white-space:nowrap; }
      .track { height:6px; overflow:hidden; border-radius:999px; background:var(--ic-progress-track); }
      .fill { width:${percent}%; height:100%; border-radius:inherit; background:var(--ic-progress-fill); transition:width var(--ui-motion-duration-normal) var(--ui-motion-ease-standard); }
      @media (prefers-reduced-motion:reduce) { .fill { transition:none; } }
      :host-context([data-ui-motion="reduced"]) .fill { transition:none; }
    </style><div class="meta"><span>${label}</span><span class="value">${valueText}</span></div><div class="track" aria-hidden="true"><div class="fill"></div></div>`;
  }
}

export class IcSkeleton extends IcFeedbackElement {
  static observedAttributes = ['shape'];
  validateContract() {
    const shape = this.getAttribute('shape') || 'text';
    return ['text', 'circle', 'rectangle'].includes(shape) ? '' : 'shape must be text, circle, or rectangle';
  }
  render() {
    contractState(this, this.validateContract());
    this.setAttribute('aria-hidden', 'true');
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; width:100%; min-width:1.5rem; min-height:1em; border-radius:var(--ui-radius-s); overflow:hidden; background:var(--ui-color-surface-subtle); }
      :host([shape="circle"]) { width:2.5rem; aspect-ratio:1; border-radius:50%; }
      :host([shape="rectangle"]) { min-height:5rem; border-radius:var(--ui-radius-m); }
      .shine { width:100%; height:100%; min-height:inherit; background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--ui-color-text-primary) 8%, transparent), transparent); animation:ic-shimmer 1.4s ease-in-out infinite; }
      @keyframes ic-shimmer { from { transform:translateX(-100%); } to { transform:translateX(100%); } }
      @media (prefers-reduced-motion:reduce) { .shine { animation:none; } }
      :host-context([data-ui-motion="reduced"]) .shine { animation:none; }
    </style><span class="shine"></span>`;
  }
}

export class IcEmptyState extends IcFeedbackElement {
  static observedAttributes = ['title', 'label'];
  validateContract() { return this.getAttribute('title')?.trim() ? '' : 'title is required for ic-empty-state'; }
  render() {
    contractState(this, this.validateContract());
    const title = this.getAttribute('title')?.trim() || '';
    const label = this.getAttribute('label')?.trim();
    if (label) { this.setAttribute('role', 'region'); this.setAttribute('aria-label', label); }
    else { this.removeAttribute('role'); this.removeAttribute('aria-label'); }
    this.shadowRoot.innerHTML = `<style>${sharedStyles}
      :host { display:block; text-align:center; padding:var(--ui-space-6) var(--ui-space-4); }
      .empty { display:grid; justify-items:center; gap:var(--ui-space-3); max-width:34rem; margin:auto; }
      .illustration { color:var(--ui-color-text-tertiary); font-size:1.75rem; }
      h3 { margin:0; font:inherit; font-weight:700; color:var(--ui-color-text-primary); }
      .description { color:var(--ui-color-text-tertiary); line-height:1.5; overflow-wrap:anywhere; }
    </style><div class="empty"><div class="illustration" aria-hidden="true"><slot name="illustration">◇</slot></div><h3>${title}</h3><div class="description"><slot></slot></div><div><slot name="action"></slot></div></div>`;
  }
}
