import { closeTopLayer, openTopLayer } from './overlay-layer.js?v=ic-ui-ef410096e2b4';
import {
  ANCHORED_OVERLAY_MOTION_STYLES,
  nextOverlayPaint,
  setOverlayInteraction,
  waitForOverlayMotion,
} from './overlay-motion.js?v=ic-ui-ef410096e2b4';

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']);
const PLACEMENTS = new Set(['block-start', 'block-end', 'overlay-block-end']);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function contractState(host, reason = '') {
  host.dataset.icContractStatus = reason ? 'invalid' : 'ready';
  if (!reason) {
    delete host.dataset.icContractReason;
    host._lastContractError = '';
    return true;
  }
  host.dataset.icContractReason = reason;
  if (host._lastContractError !== reason) {
    host._lastContractError = reason;
    host.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: { component: host.localName, reason },
    }));
  }
  return false;
}

function normalizeItem(item, index) {
  const source = item && typeof item === 'object' ? item : {};
  const mediaSource = source.media && typeof source.media === 'object' ? source.media : null;
  const media = mediaSource?.src ? Object.freeze({
    kind: ['image', 'video', 'audio'].includes(mediaSource.kind) ? mediaSource.kind : 'image',
    src: String(mediaSource.src),
    alt: String(mediaSource.alt ?? source.label ?? ''),
    aspectRatio: Number(mediaSource.aspectRatio) > 0 ? Number(mediaSource.aspectRatio) : 0,
  }) : null;
  return Object.freeze({
    value: source.value ?? String(index),
    label: String(source.label ?? ''),
    category: String(source.category ?? source.description ?? ''),
    icon: String(source.icon ?? 'book-text'),
    media,
    badge: String(source.badge ?? ''),
    leading: Boolean(source.leading),
    disabled: Boolean(source.disabled),
    error: String(source.error ?? ''),
  });
}

export class IcMentionPicker extends HTMLElement {
  static observedAttributes = ['label', 'empty-label', 'open'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._tabs = [];
    this._activeTab = '';
    this._tabState = new Map();
    this._loading = false;
    this._error = '';
    this._hasMore = false;
    this._activeIndex = -1;
    this._anchor = null;
    this._invoker = null;
    this._placement = 'block-start';
    this._lastContractError = '';
    this._positionFrame = 0;
    this._motionGeneration = 0;
    this._onViewportChange = () => this.position();
    this._onDocumentPointerDown = event => {
      if (!this.open) return;
      const path = event.composedPath();
      if (!path.includes(this) && !path.includes(this._anchor) && !path.includes(this._invoker)) {
        this.hide('outside');
      }
    };
    this._onDocumentKeyDown = event => this.handleKeydown(event);
  }

  connectedCallback() {
    if (!this.dataset.motionState) this.dataset.motionState = this.open ? 'open' : 'closed';
    this.render();
    this.syncOpenState();
    document.addEventListener('pointerdown', this._onDocumentPointerDown);
    document.addEventListener('keydown', this._onDocumentKeyDown);
  }

  disconnectedCallback() {
    this._motionGeneration += 1;
    closeTopLayer(this.surface);
    document.removeEventListener('pointerdown', this._onDocumentPointerDown);
    document.removeEventListener('keydown', this._onDocumentKeyDown);
    this.removeViewportListeners();
    this.stopPositionTracking();
    this.stopAudio();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name !== 'open') this.render();
    else if (this.open && ['closed', 'exiting'].includes(this.dataset.motionState)) {
      this._motionGeneration += 1;
      this.dataset.motionState = 'open';
      setOverlayInteraction(this.surface, true);
    } else if (!this.open && !['closed', 'exiting'].includes(this.dataset.motionState)) {
      this._motionGeneration += 1;
      this.dataset.motionState = 'closed';
      setOverlayInteraction(this.surface, true);
    }
    this.syncOpenState();
  }

  get surface() {
    return this.shadowRoot.querySelector('[part="surface"]');
  }

  get open() {
    return this.hasAttribute('open');
  }

  set open(value) {
    this.toggleAttribute('open', Boolean(value));
  }

  get items() {
    return this._items.slice();
  }

  set items(value) {
    const activeValue = this._items[this._activeIndex]?.value;
    this._items = Array.isArray(value) ? value.map(normalizeItem) : [];
    const preservedIndex = this._items.findIndex(item => item.value === activeValue);
    this._activeIndex = preservedIndex >= 0 ? preservedIndex : (this._items.length ? 0 : -1);
    if (this.isConnected) this.render();
  }

  get tabs() { return this._tabs.map(tab => ({ ...tab })); }
  set tabs(value) {
    this._tabs = Array.isArray(value) ? value.map((tab, index) => ({
      value: String(tab?.value ?? index),
      label: String(tab?.label ?? tab?.value ?? index),
    })) : [];
    if (!this._tabs.some(tab => tab.value === this._activeTab)) {
      this._activeTab = this._tabs[0]?.value || '';
    }
    if (this.isConnected) this.render();
  }

  get activeTab() { return this._activeTab; }
  set activeTab(value) {
    const next = String(value ?? '');
    if (next === this._activeTab || !this._tabs.some(tab => tab.value === next)) return;
    this.rememberTabState();
    this._activeTab = next;
    this._activeIndex = this._tabState.get(next)?.activeIndex ?? (this._items.length ? 0 : -1);
    if (this.isConnected) this.render();
  }

  get loading() { return this._loading; }
  set loading(value) { this._loading = Boolean(value); if (this.isConnected) this.render(); }
  get error() { return this._error; }
  set error(value) { this._error = String(value ?? ''); if (this.isConnected) this.render(); }
  get hasMore() { return this._hasMore; }
  set hasMore(value) { this._hasMore = Boolean(value); if (this.isConnected) this.render(); }

  get activeIndex() {
    return this._activeIndex;
  }

  get mediaMode() {
    return Boolean(this._items.length && this._items.every(item => item.media));
  }

  validateContract() {
    return this.getAttribute('label')?.trim() ? '' : 'label is required';
  }

  render() {
    closeTopLayer(this.surface);
    contractState(this, this.validateContract());
    const label = escapeHtml(this.getAttribute('label') || '');
    const emptyLabel = escapeHtml(this.getAttribute('empty-label') || '没有匹配项');
    const loadingMarkup = '<div part="status" role="status">正在加载…</div>';
    const errorMarkup = `<div part="status" role="alert">${escapeHtml(this._error)}<button part="retry" type="button">重试</button></div>`;
    const contentMarkup = this._items.length
      ? `<div part="listbox" role="listbox" class="${this.mediaMode ? 'media-grid' : ''}">${this.mediaMode ? '<div class="media-leading"></div><div class="media-columns"></div>' : ''}</div>`
      : this._loading
        ? loadingMarkup.replace('part="status"', 'part="status" class="state"')
        : this._error
          ? errorMarkup.replace('part="status"', 'part="status" class="state"')
          : `<div part="empty">${emptyLabel}</div>`;
    const footerMarkup = this._items.length
      ? (this._loading ? loadingMarkup : (this._error ? errorMarkup : ''))
      : '';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:contents; }
        ${ANCHORED_OVERLAY_MOTION_STYLES}
        [part="surface"] {
          box-sizing:border-box;
          position:fixed;
          inset:auto;
          z-index:var(--ui-z-popover);
          display:flex;
          flex-direction:column;
          width:var(--ic-mention-picker-width, 20rem);
          max-width:calc(100vw - 2 * var(--ui-space-3));
          height:var(--ic-mention-picker-height, 18rem);
          max-height:var(--ic-mention-picker-max-height, 18rem);
          overflow:hidden;
          overscroll-behavior:contain;
          padding:var(--ui-space-0);
          border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
          border-radius:var(--ui-radius-m);
          background:var(--ui-color-surface-floating, var(--ui-color-surface));
          box-shadow:var(--ui-shadow-raised);
          color:var(--ui-color-text-primary);
          pointer-events:auto;
        }
        [part="tabs"] {
          flex:0 0 auto;
          display:flex;
          align-items:center;
          justify-content:flex-start;
          padding:var(--ui-space-1) var(--ui-space-2);
          border-block-end:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
          background:var(--ui-color-surface);
        }
        [part="tabs"] ic-segmented-control { flex:0 0 auto; inline-size:max-content; max-inline-size:100%; }
        [part="listbox"] {
          box-sizing:border-box;
          min-height:0;
          flex:1 1 auto;
          overflow-x:hidden;
          overflow-y:auto;
          overscroll-behavior:contain;
          padding:var(--ui-space-1) var(--ui-space-2) var(--ui-space-2);
          background:var(--ui-color-surface);
        }
        [part="option"] {
          box-sizing:border-box;
          width:100%;
          min-width:0;
          height:1.5rem;
          min-height:1.5rem;
          display:flex;
          align-items:center;
          justify-content:flex-start;
          gap:var(--ui-space-2);
          padding:var(--ui-space-0) var(--ui-space-1);
          border:var(--ui-border-width-thin) solid transparent;
          border-radius:var(--ui-radius-s);
          background:var(--ui-color-action-tertiary);
          color:var(--ui-color-text-tertiary);
          font:inherit;
          text-align:start;
          cursor:pointer;
        }
        [part="option"]:hover,
        [part="option"][aria-selected="true"] {
          border-color:var(--ui-color-border-primary);
          background:var(--ui-color-action-secondary-selected);
          color:var(--ui-color-text-primary);
        }
        .icon {
          width:var(--ui-icon-size-s);
          height:var(--ui-icon-size-s);
          flex:0 0 var(--ui-icon-size-s);
          display:inline-flex;
          align-items:center;
          justify-content:center;
          color:var(--ui-color-text-tertiary);
        }
        .icon ic-icon { --ic-icon-size:var(--ui-icon-size-s); }
        .name,
        .category {
          min-width:0;
          overflow:hidden;
          font-size:var(--ui-font-size-2);
          font-weight:var(--ui-font-weight-regular);
          line-height:var(--ui-line-height-tight);
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .name {
          width:auto;
          max-width:60%;
          flex:0 1 auto;
          color:var(--ui-color-text-secondary);
        }
        .category {
          flex:0 1 auto;
          color:var(--ui-color-text-tertiary);
        }
        .media-option {
          min-height:3.125rem;
          height:3.125rem;
          display:grid;
          grid-template-columns:4.5rem minmax(0, 1fr);
          gap:var(--ui-space-2);
          padding:var(--ui-space-1);
        }
        .media {
          box-sizing:border-box;
          width:4.5rem;
          height:2.625rem;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:center;
          border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
          border-radius:var(--ui-radius-s);
          background:var(--ui-color-surface-subtle);
          color:var(--ui-color-text-tertiary);
        }
        .media img {
          width:100%;
          height:100%;
          display:block;
          object-fit:cover;
        }
        .media ic-icon { --ic-icon-size:var(--ui-icon-size-m); }
        .media-copy {
          min-width:0;
          display:flex;
          flex-direction:column;
          align-items:flex-start;
          gap:var(--ui-space-1);
          overflow:hidden;
        }
        .media-copy .name,
        .media-copy .category {
          width:100%;
          max-width:none;
          flex:0 1 auto;
          text-align:start;
        }
        .media-copy .name {
          color:inherit;
          font-size:var(--ui-font-size-3);
          font-weight:var(--ui-font-weight-bold);
        }
        .media-copy .category {
          font-size:var(--ui-font-size-1);
          font-weight:var(--ui-font-weight-medium);
        }
        [part="listbox"].media-grid {
          padding:var(--ui-space-1) var(--ui-space-2) var(--ui-space-2);
        }
        .media-columns {
          width:100%;
          columns:var(--ic-mention-picker-card-width, 5.625rem);
          column-gap:var(--ui-space-2);
        }
        .media-leading {
          width:100%;
          display:grid;
          grid-template-columns:repeat(auto-fill,var(--ic-mention-picker-leading-card-width, 4.0625rem));
          align-items:start;
          justify-content:start;
          gap:var(--ui-space-2);
          margin-block-end:var(--ui-space-2);
        }
        .media-leading:empty { display:none; }
        .media-grid [part="option"] {
          position:relative;
          width:100%;
          height:auto;
          min-height:0;
          margin:0 0 var(--ui-space-2);
          padding:0;
          display:inline-flex;
          grid-template-columns:none;
          break-inside:avoid;
          overflow:hidden;
          border-color:var(--ui-color-border-secondary);
          border-radius:var(--ui-radius-xs);
          background:var(--ui-color-surface-subtle);
          vertical-align:top;
          transition:border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
        }
        .media-leading [part="option"] {
          aspect-ratio:1;
          margin:0;
          border-color:var(--ui-color-border-primary);
          border-radius:var(--ui-radius-s);
          background:var(--ui-color-surface);
          box-shadow:var(--ui-shadow-none);
        }
        .media-grid [part="option"]:hover,
        .media-grid [part="option"][aria-selected="true"] {
          border-color:var(--ui-color-border-focus);
          border-radius:var(--ui-radius-xs);
          background:var(--ui-color-surface-subtle);
          box-shadow:var(--ui-shadow-raised);
        }
        .media-leading [part="option"]:hover,
        .media-leading [part="option"][aria-selected="true"] {
          border-color:var(--ui-color-border-secondary);
          border-radius:var(--ui-radius-s);
          background:var(--ui-color-action-tertiary-hover);
          box-shadow:var(--ui-shadow-none);
        }
        .media-grid .media {
          width:100%;
          height:auto;
          min-height:3.75rem;
          max-height:22.5rem;
          aspect-ratio:auto;
          border:0;
          border-radius:var(--ui-radius-xs);
        }
        .media-grid .media[data-kind="audio"] { aspect-ratio:3 / 2; }
        .media-grid .media img {
          width:100%;
          height:auto;
          max-height:22.5rem;
          object-fit:contain;
          border-radius:var(--ui-radius-xs);
          background:var(--ui-color-surface-subtle);
        }
        .media-leading .media {
          height:100%;
          min-height:0;
          max-height:none;
          border-radius:calc(var(--ui-radius-s) - var(--ui-border-width-thin));
          background:var(--ui-color-surface);
        }
        .media-leading .media img {
          height:100%;
          max-height:none;
          object-fit:cover;
          border-radius:calc(var(--ui-radius-s) - var(--ui-border-width-thin));
          background:var(--ui-color-surface);
        }
        .media-grid .media-copy {
          position:absolute;
          inset:auto 0 0;
          padding:var(--ui-space-3) var(--ui-space-2) var(--ui-space-1);
          background:linear-gradient(180deg,transparent 0%,var(--ui-color-mask) 100%);
          opacity:0;
          pointer-events:none;
        }
        .media-leading .media-copy {
          inset:auto 0 var(--ic-mention-picker-leading-label-block-size, 0.875rem);
        }
        .media-grid [part="option"]:hover .media-copy,
        .media-grid [part="option"][aria-selected="true"] .media-copy { opacity:1; }
        .media-grid .media-copy .name {
          color:var(--ui-color-text-white);
          font-size:var(--ui-font-size-1);
          font-weight:var(--ui-font-weight-regular);
        }
        .media-grid .media-copy .category { display:none; }
        .media-badge {
          position:absolute;
          inset:var(--ui-space-1) var(--ui-space-1) auto auto;
          display:inline-flex;
          align-items:center;
          min-height:var(--ui-control-height-xs);
          padding:0 var(--ui-space-2);
          border-radius:var(--ui-radius-pill);
          background:var(--ui-color-mask);
          color:var(--ui-color-text-white);
          font-size:var(--ui-font-size-1);
          font-weight:var(--ui-font-weight-medium);
          line-height:var(--ui-line-height-tight);
          pointer-events:none;
        }
        .media-leading .media-badge {
          inset:auto 0 0;
          z-index:4;
          min-height:0;
          height:var(--ic-mention-picker-leading-label-block-size, 0.875rem);
          padding:var(--ui-space-0) var(--ui-space-1);
          justify-content:center;
          overflow:hidden;
          border-radius:0;
          color:var(--ui-color-text-secondary);
          background:var(--ui-color-surface-canvas);
          font:var(--ui-text-caption);
          text-align:center;
          white-space:nowrap;
          text-overflow:ellipsis;
        }
        .media-kind-badge {
          position:absolute;
          inset:var(--ui-space-1) auto auto var(--ui-space-1);
          display:inline-flex;
          padding:var(--ui-space-1);
          border-radius:var(--ui-radius-pill);
          background:var(--ui-color-mask);
          color:var(--ui-color-text-white);
          pointer-events:none;
        }
        .media-kind-badge ic-icon { --ic-icon-size:var(--ui-icon-size-s); }
        .audio-play {
          position:absolute;
          inset:50% auto auto 50%;
          width:var(--ui-control-height-s);
          height:var(--ui-control-height-s);
          display:grid;
          place-items:center;
          transform:translate(-50%,-50%);
          border:0;
          border-radius:var(--ui-radius-pill);
          background:var(--ui-color-mask);
          color:var(--ui-color-text-white);
          cursor:pointer;
          opacity:0;
        }
        .media-grid [part="option"]:hover .audio-play,
        .media-grid [part="option"]:focus-visible .audio-play { opacity:1; }
        .audio-play ic-icon { --ic-icon-size:var(--ui-icon-size-s); }
        [part="option"][aria-disabled="true"] { cursor:not-allowed; opacity:.58; }
        [part="status"] {
          flex:0 0 auto;
          padding:var(--ui-space-2);
          color:var(--ui-color-text-tertiary);
          font-size:var(--ui-font-size-2);
          text-align:center;
        }
        [part="status"].state {
          min-height:0;
          flex:1 1 auto;
          display:grid;
          place-items:center;
        }
        [part="retry"] {
          margin-inline-start:var(--ui-space-2);
          border:0;
          background:transparent;
          color:var(--ui-color-text-link);
          cursor:pointer;
        }
        [part="empty"] {
          min-height:0;
          flex:1 1 auto;
          display:grid;
          place-items:center;
          padding:var(--ui-space-3);
          color:var(--ui-color-text-tertiary);
          font-size:var(--ui-font-size-2);
          text-align:center;
        }
      </style>
      <section part="surface" popover="manual" aria-label="${label}">
        ${this._tabs.length > 1 ? `<div part="tabs"><ic-segmented-control data-source-tabs data-legal-combination="single-label" size="small" label="${label}" value="${escapeHtml(this._activeTab)}">${this._tabs.map(tab => `
          <button type="button" data-value="${escapeHtml(tab.value)}" data-tab="${escapeHtml(tab.value)}">${escapeHtml(tab.label)}</button>
        `).join('')}</ic-segmented-control></div>` : ''}
        ${contentMarkup}
        ${footerMarkup}
      </section>
    `;
    const sourceTabs = this.shadowRoot.querySelector('[data-source-tabs]');
    sourceTabs?.querySelectorAll('[data-tab]').forEach(tab => {
      tab.addEventListener('mousedown', event => event.preventDefault());
    });
    sourceTabs?.addEventListener('ic-change', event => this.selectTab(event.detail?.value || ''));
    this.shadowRoot.querySelector('[part="retry"]')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ic-retry', {
        bubbles: true,
        composed: true,
        detail: { tab: this._activeTab },
      }));
    });
    const listbox = this.shadowRoot.querySelector('[part="listbox"]');
    if (listbox) {
      this._items.forEach((item, index) => {
        const optionContainer = this.mediaMode
          ? listbox.querySelector(item.leading ? '.media-leading' : '.media-columns')
          : listbox;
        const option = document.createElement('button');
        option.type = 'button';
        option.setAttribute('part', 'option');
        option.classList.toggle('media-option', Boolean(item.media));
        option.setAttribute('role', 'option');
        option.setAttribute('aria-disabled', String(item.disabled));
        option.title = item.error || [...new Set([item.label, item.badge].filter(Boolean))].join(' · ');
        option.dataset.index = String(index);
        option.setAttribute('aria-selected', String(index === this._activeIndex));
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.label;
        const category = item.category ? document.createElement('small') : null;
        if (category) {
          category.className = 'category';
          category.textContent = item.category;
        }
        if (item.media) {
          const media = document.createElement('span');
          media.className = 'media';
          media.dataset.kind = item.media.kind;
          media.setAttribute('aria-hidden', 'true');
          if (item.media.kind === 'audio') {
            const glyph = document.createElement('ic-icon');
            glyph.setAttribute('name', 'file-audio');
            glyph.setAttribute('size', 'medium');
            media.append(glyph);
          } else {
            const image = document.createElement('img');
            image.src = item.media.src;
            image.alt = '';
            image.loading = 'lazy';
            media.append(image);
          }
          const copy = document.createElement('span');
          copy.className = 'media-copy';
          copy.append(name);
          if (category) copy.append(category);
          option.append(media, copy);
          if (item.media.kind === 'video') {
            const badge = document.createElement('span');
            badge.className = 'media-kind-badge';
            badge.innerHTML = '<ic-icon name="video" size="small" aria-hidden="true"></ic-icon>';
            option.append(badge);
          } else if (item.media.kind === 'audio') {
            const play = document.createElement('span');
            play.className = 'audio-play';
            play.setAttribute('role', 'button');
            play.setAttribute('aria-label', `试听${item.label}`);
            play.innerHTML = '<ic-icon name="play" size="small" aria-hidden="true"></ic-icon>';
            play.addEventListener('mousedown', event => {
              event.preventDefault();
              event.stopPropagation();
            });
            play.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              this.playAudio(item.media.src, play);
            });
            option.addEventListener('pointerleave', () => this.stopAudio());
            option.append(play);
          }
          if (item.badge) {
            const badge = document.createElement('span');
            badge.className = 'media-badge';
            badge.textContent = item.badge;
            option.append(badge);
          }
        } else {
          const icon = document.createElement('span');
          icon.className = 'icon';
          icon.setAttribute('aria-hidden', 'true');
          const iconGlyph = document.createElement('ic-icon');
          iconGlyph.setAttribute('name', item.icon);
          iconGlyph.setAttribute('size', 'small');
          icon.append(iconGlyph);
          option.append(icon, name);
          if (category) option.append(category);
        }
        option.addEventListener('pointerenter', () => this.setActiveIndex(index));
        option.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
          this.setActiveIndex(index);
          if (!item.disabled) this.selectActive();
        });
        optionContainer.append(option);
      });
      listbox.addEventListener('wheel', event => event.stopPropagation(), { passive: false });
      listbox.addEventListener('scroll', () => {
        this.rememberTabState();
        if (this._hasMore && !this._loading && listbox.scrollHeight - listbox.scrollTop - listbox.clientHeight < 96) {
          this.requestMore('scroll');
        }
      }, { passive: true });
      queueMicrotask(() => {
        listbox.scrollTop = this._tabState.get(this._activeTab || '__default__')?.scrollTop || 0;
      });
    }
    this.surface?.addEventListener('wheel', event => event.stopPropagation(), { passive: false });
    this.syncOpenState();
  }

  syncOpenState() {
    const surface = this.surface;
    if (!surface) return;
    if ((this.open || this.dataset.motionState === 'exiting') && contractState(this, this.validateContract())) {
      openTopLayer(surface, 'popover');
      setOverlayInteraction(surface, this.dataset.motionState !== 'exiting');
      if (this.open) {
        this.addViewportListeners();
        this.startPositionTracking();
      }
    } else {
      closeTopLayer(surface);
      setOverlayInteraction(surface, true);
      this.removeViewportListeners();
      this.stopPositionTracking();
    }
  }

  addViewportListeners() {
    window.addEventListener('resize', this._onViewportChange);
    window.addEventListener('scroll', this._onViewportChange, true);
  }

  removeViewportListeners() {
    window.removeEventListener('resize', this._onViewportChange);
    window.removeEventListener('scroll', this._onViewportChange, true);
  }

  startPositionTracking() {
    if (this._positionFrame || !this.open) return;
    this._positionFrame = requestAnimationFrame(() => {
      this._positionFrame = 0;
      this.position();
      this.startPositionTracking();
    });
  }

  stopPositionTracking() {
    if (!this._positionFrame) return;
    cancelAnimationFrame(this._positionFrame);
    this._positionFrame = 0;
  }

  show(anchor = document.activeElement, { invoker = anchor, placement = 'block-start' } = {}) {
    if (!contractState(this, this.validateContract())) return;
    const nextAnchor = anchor instanceof HTMLElement ? anchor : null;
    const nextInvoker = invoker instanceof HTMLElement ? invoker : nextAnchor;
    if (!nextAnchor || !nextInvoker) return;
    if (this._invoker && this._invoker !== nextInvoker) {
      this._invoker.setAttribute('aria-expanded', 'false');
    }
    this._anchor = nextAnchor;
    this._invoker = nextInvoker;
    this._placement = PLACEMENTS.has(placement) ? placement : 'block-start';
    this._invoker.setAttribute('aria-expanded', 'true');
    if (this.open && this.dataset.motionState !== 'exiting') {
      this.position();
      return;
    }
    const generation = ++this._motionGeneration;
    this.dataset.motionState = 'entering';
    setOverlayInteraction(this.surface, true);
    this.dispatchEvent(new CustomEvent('ic-show', { bubbles: true, composed: true }));
    this.open = true;
    queueMicrotask(async () => {
      this.position();
      await nextOverlayPaint();
      if (generation !== this._motionGeneration || !this.open) return;
      this.dataset.motionState = 'open';
      await waitForOverlayMotion(this.surface);
      if (generation !== this._motionGeneration || !this.open) return;
      this.dispatchEvent(new CustomEvent('ic-after-show', { bubbles: true, composed: true }));
    });
  }

  hide(reason = 'programmatic') {
    if (!this.open) return;
    const generation = ++this._motionGeneration;
    this.stopAudio();
    this.dataset.motionState = 'exiting';
    setOverlayInteraction(this.surface, false);
    this.open = false;
    this.removeViewportListeners();
    this.stopPositionTracking();
    this._invoker?.setAttribute?.('aria-expanded', 'false');
    this.dispatchEvent(new CustomEvent('ic-hide', {
      bubbles: true,
      composed: true,
      detail: { reason },
    }));
    queueMicrotask(async () => {
      await waitForOverlayMotion(this.surface);
      if (generation !== this._motionGeneration || this.open || this.dataset.motionState !== 'exiting') return;
      this.dataset.motionState = 'closed';
      this.syncOpenState();
      setOverlayInteraction(this.surface, true);
      this.dispatchEvent(new CustomEvent('ic-after-hide', {
        bubbles: true,
        composed: true,
        detail: { reason },
      }));
    });
  }

  position() {
    const surface = this.surface;
    if (!this.open || !surface || !this._anchor?.isConnected) return;
    const anchor = this._anchor.getBoundingClientRect();
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gap = rootFontSize * 0.25;
    const viewportInset = rootFontSize;
    const preferredHeight = rootFontSize * 18;
    surface.dataset.motionSide = this._placement === 'block-end' ? 'bottom' : 'top';
    surface.style.setProperty('--ic-mention-picker-width', `${anchor.width}px`);
    const availableHeight = this._placement === 'overlay-block-end'
      ? anchor.bottom - viewportInset
      : this._placement === 'block-end'
        ? window.innerHeight - anchor.bottom - gap - viewportInset
        : anchor.top - gap - viewportInset;
    const fittedHeight = Math.min(preferredHeight, Math.max(0, availableHeight));
    surface.style.setProperty('--ic-mention-picker-height', `${fittedHeight}px`);
    surface.style.setProperty('--ic-mention-picker-max-height', `${fittedHeight}px`);
    const overlay = surface.getBoundingClientRect();
    const left = anchor.left;
    const top = this._placement === 'overlay-block-end'
      ? anchor.bottom - overlay.height
      : this._placement === 'block-end'
        ? anchor.bottom + gap
        : anchor.top - overlay.height - gap;
    surface.style.left = `${Math.round(left)}px`;
    surface.style.top = `${Math.round(top)}px`;
  }

  rememberTabState() {
    this._tabState.set(this._activeTab || '__default__', {
      activeIndex: this._activeIndex,
      scrollTop: this.shadowRoot.querySelector('[part="listbox"]')?.scrollTop || 0,
    });
  }

  selectTab(value) {
    const next = String(value ?? '');
    if (!this._tabs.some(tab => tab.value === next) || next === this._activeTab) return;
    this.rememberTabState();
    this._activeTab = next;
    this._activeIndex = this._tabState.get(next)?.activeIndex ?? 0;
    this.stopAudio();
    this.dispatchEvent(new CustomEvent('ic-tab-change', {
      bubbles: true,
      composed: true,
      detail: { value: next },
    }));
  }

  requestMore(reason = 'navigation') {
    if (!this._hasMore || this._loading) return false;
    this.dispatchEvent(new CustomEvent('ic-load-more', {
      bubbles: true,
      composed: true,
      detail: { tab: this._activeTab, reason },
    }));
    return true;
  }

  stopAudio() {
    if (!this._audio) return;
    this._audio.pause();
    this._audio.removeAttribute('src');
    this._audio.load?.();
    this._audio = null;
    if (this._audioButton?.isConnected) {
      this._audioButton.innerHTML = '<ic-icon name="play" size="small" aria-hidden="true"></ic-icon>';
    }
    this._audioButton = null;
  }

  playAudio(src, button) {
    const source = String(src || '');
    if (!source) return;
    if (this._audio && this._audioButton === button) {
      this.stopAudio();
      return;
    }
    this.stopAudio();
    const audio = new Audio(source);
    audio.preload = 'metadata';
    this._audio = audio;
    this._audioButton = button;
    button.innerHTML = '<ic-icon name="pause" size="small" aria-hidden="true"></ic-icon>';
    audio.addEventListener('ended', () => this.stopAudio(), { once:true });
    audio.addEventListener('error', () => this.stopAudio(), { once:true });
    audio.play().catch(() => this.stopAudio());
  }

  setActiveIndex(index, { ensureVisible = false } = {}) {
    const options = [...this.shadowRoot.querySelectorAll('[part="option"]')];
    if (!options.length) {
      this._activeIndex = -1;
      return;
    }
    const next = ((Number(index) % options.length) + options.length) % options.length;
    this._activeIndex = next;
    options.forEach((option, optionIndex) => {
      option.setAttribute('aria-selected', String(optionIndex === next));
    });
    if (ensureVisible) options[next]?.scrollIntoView?.({ block: 'nearest' });
  }

  moveActive(offset) {
    this.setActiveIndex((this._activeIndex < 0 ? 0 : this._activeIndex) + Number(offset || 0), {
      ensureVisible: true,
    });
  }

  moveVisual(direction) {
    const options = [...this.shadowRoot.querySelectorAll('[part="option"]')];
    const current = options[this._activeIndex];
    if (!current || !this.mediaMode) {
      this.moveActive(['ArrowDown', 'ArrowRight'].includes(direction) ? 1 : -1);
      return true;
    }
    const rect = current.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const vertical = direction === 'ArrowDown' || direction === 'ArrowUp';
    const sign = (direction === 'ArrowDown' || direction === 'ArrowRight') ? 1 : -1;
    const candidates = options.map((option, index) => {
      if (index === this._activeIndex) return null;
      const candidateRect = option.getBoundingClientRect();
      const point = {
        x: candidateRect.left + candidateRect.width / 2,
        y: candidateRect.top + candidateRect.height / 2,
      };
      const primary = vertical ? point.y - origin.y : point.x - origin.x;
      if (primary * sign <= 1) return null;
      const secondary = vertical ? point.x - origin.x : point.y - origin.y;
      return { index, score: Math.abs(primary) * 4 + Math.abs(secondary) };
    }).filter(Boolean).sort((left, right) => left.score - right.score);
    if (candidates.length) {
      this.setActiveIndex(candidates[0].index, { ensureVisible: true });
      return true;
    }
    if (sign > 0) return this.requestMore('keyboard');
    return false;
  }

  selectActive() {
    const item = this._items[this._activeIndex];
    if (!item || item.disabled) return false;
    this.dispatchEvent(new CustomEvent('ic-select', {
      bubbles: true,
      composed: true,
      detail: { index: this._activeIndex, value: item.value, item },
    }));
    return true;
  }

  handleKeydown(event) {
    if (!this.open || !NAVIGATION_KEYS.has(event.key)) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.hide('escape');
      return true;
    }
    if (this.mediaMode && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopPropagation();
      this.moveVisual(event.key);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'Enter' && !event.shiftKey && this.selectActive()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  }
}
