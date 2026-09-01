const STYLE_MARKER = 'ic-reference-thumbnail-v2';
const KINDS = new Set(['image', 'video', 'audio', 'text']);

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function ensureReferenceThumbnailStyles() {
  if (document.querySelector(`style[data-ic-reference-thumbnail="${STYLE_MARKER}"]`)) return;
  const stylesheet = document.createElement('style');
  stylesheet.dataset.icReferenceThumbnail = STYLE_MARKER;
  stylesheet.textContent = `
    ic-reference-thumbnail {
      box-sizing: border-box;
      position: relative;
      display: block;
      inline-size: 45px;
      block-size: 45px;
      --ic-reference-thumbnail-label-block-size: 14px;
      flex: 0 0 auto;
      overflow: hidden;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-primary);
      border-radius: var(--ui-radius-s);
      color: var(--ui-color-text-tertiary);
      background: var(--ui-color-surface);
      cursor: pointer;
      transition: border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard), background var(--ui-motion-duration-fast) var(--ui-motion-ease-standard), box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }
    ic-reference-thumbnail[hidden] { display: none; }
    ic-reference-thumbnail[draggable="true"] { cursor: grab; }
    ic-reference-thumbnail:active { cursor: grabbing; }
    ic-reference-thumbnail:hover,
    ic-reference-thumbnail[data-preview-state="hover"] {
      border-color: var(--ui-color-border-secondary);
      background: var(--ui-color-action-tertiary-hover);
      box-shadow: var(--ui-shadow-none);
    }
    ic-reference-thumbnail:focus-visible {
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
    }
    ic-reference-thumbnail > img,
    ic-reference-thumbnail > video {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
      border-radius: calc(var(--ui-radius-s) - var(--ui-border-width-thin));
      background: var(--ui-color-surface);
      pointer-events: none;
    }
    ic-reference-thumbnail[data-kind="text"] {
      border-color: var(--ui-color-border-secondary);
      background: var(--ui-color-surface);
      cursor: default;
    }
    ic-reference-thumbnail .ic-reference-thumbnail__kind {
      position: absolute;
      inset: 0 0 var(--ic-reference-thumbnail-label-block-size);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ui-color-text-tertiary);
      pointer-events: none;
    }
    ic-reference-thumbnail .input-thumb-label {
      position: absolute;
      inset-inline: 0;
      inset-block-end: 0;
      z-index: 4;
      block-size: var(--ic-reference-thumbnail-label-block-size);
      padding: var(--ui-space-0) var(--ui-space-1);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      color: var(--ui-color-text-secondary);
      background: var(--ui-color-surface-canvas);
      font: var(--ui-text-caption);
      text-align: center;
      white-space: nowrap;
      text-overflow: ellipsis;
      pointer-events: none;
    }
    ic-reference-thumbnail .input-thumb-remove {
      position: absolute;
      inset-inline-end: var(--ui-space-1);
      inset-block-start: var(--ui-space-1);
      z-index: 6;
      inline-size: var(--ui-icon-size-s);
      block-size: var(--ui-icon-size-s);
      padding: var(--ui-space-0);
      border: var(--ui-border-width-none);
      border-radius: var(--ui-radius-pill);
      display: grid;
      place-items: center;
      color: var(--ui-color-text-primary);
      background: var(--ui-color-surface);
      opacity: 0;
      pointer-events: none;
      line-height: 1;
      transition: opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard), transform var(--ui-motion-duration-fast) var(--ui-motion-ease-standard), background var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }
    ic-reference-thumbnail:hover .input-thumb-remove,
    ic-reference-thumbnail:focus-within .input-thumb-remove,
    ic-reference-thumbnail[data-preview-state="hover"] .input-thumb-remove,
    ic-reference-thumbnail .input-thumb-remove:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }
    ic-reference-thumbnail .input-thumb-remove:hover {
      color: var(--ui-color-text-primary);
      background: var(--ui-color-surface);
      transform: scale(1.04);
    }
    ic-reference-thumbnail .input-thumb-remove:focus-visible {
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
    }
    ic-reference-thumbnail .input-thumb-remove ic-icon {
      --ic-icon-context-stroke-width: var(--ui-icon-stroke-width-m);
      display: block;
      margin: var(--ui-space-0);
      pointer-events: none;
    }
    ic-reference-thumbnail.input-self {
      border-color: var(--ui-color-border-selected);
      box-shadow: inset 0 0 0 var(--ui-border-width-thin) var(--ui-color-border-selected);
    }
    ic-reference-thumbnail.input-self:hover { box-shadow: var(--ui-shadow-none); }
    ic-reference-thumbnail.input-blocked {
      border-color: var(--ui-color-border-secondary);
      box-shadow: inset 0 0 0 1px rgba(239, 68, 68, .22);
    }
    ic-reference-thumbnail.input-blocked > img,
    ic-reference-thumbnail.input-blocked > video { filter: grayscale(1); opacity: .36; }
    ic-reference-thumbnail.input-blocked::after {
      content: "";
      position: absolute;
      inset-inline: 2px;
      inset-block-start: 50%;
      block-size: 2px;
      background: var(--ui-color-surface);
      transform: rotate(-35deg);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, .55);
      pointer-events: none;
    }
    ic-reference-thumbnail.input-blocked::before {
      content: attr(data-blocked-label);
      position: absolute;
      inset-inline: 3px;
      inset-block-end: 3px;
      z-index: 3;
      overflow: hidden;
      padding: var(--ui-space-0) var(--ui-space-1);
      border-radius: var(--ui-radius-xs);
      color: var(--ui-color-text-white);
      background: var(--ui-color-mask);
      font-size: var(--ui-font-size-1);
      font-weight: var(--ui-font-weight-bold);
      line-height: var(--ui-line-height-tight);
      text-align: center;
      white-space: nowrap;
      text-overflow: ellipsis;
      pointer-events: none;
    }
    ic-reference-thumbnail.dragging { opacity: .5; }
    ic-reference-thumbnail.drop-before::before,
    ic-reference-thumbnail.drop-after::after {
      content: "";
      position: absolute;
      z-index: 8;
      inset-block: 0;
      inline-size: 3px;
      border-radius: var(--ui-radius-pill);
      background: var(--ui-color-border-selected);
    }
    ic-reference-thumbnail.drop-before::before { inset-inline-start: 0; }
    ic-reference-thumbnail.drop-after::after { inset-inline-end: 0; }
    @media (hover: none) {
      ic-reference-thumbnail .input-thumb-remove { opacity: 1; pointer-events: auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      ic-reference-thumbnail,
      ic-reference-thumbnail .input-thumb-remove { transition: none; }
    }
  `;
  document.head.append(stylesheet);
}

/** A compact Reference Input Instance preview with shared activation/removal behavior. */
export class IcReferenceThumbnail extends HTMLElement {
  static observedAttributes = ['kind', 'label', 'src', 'preview-src', 'original-src', 'alt', 'preview-text', 'removable', 'remove-label', 'data-input-remove-reference', 'data-input-remove-text-reference'];

  constructor() {
    super();
    this._onClick = event => {
      if (event.target.closest?.('.input-thumb-remove')) return;
      if (this.getAttribute('kind') === 'text') return;
      this.activate();
    };
    this._onKeyDown = event => {
      if (!['Enter', ' '].includes(event.key) || event.target.closest?.('.input-thumb-remove')) return;
      event.preventDefault();
      this.activate();
    };
    this._onPointerEnter = () => this._showPreview();
    this._onPointerLeave = () => this._hidePreview();
  }

  connectedCallback() {
    ensureReferenceThumbnailStyles();
    this.classList.add('input-thumb');
    this.addEventListener('click', this._onClick);
    this.addEventListener('keydown', this._onKeyDown);
    this.addEventListener('pointerenter', this._onPointerEnter);
    this.addEventListener('pointerleave', this._onPointerLeave);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('keydown', this._onKeyDown);
    this.removeEventListener('pointerenter', this._onPointerEnter);
    this.removeEventListener('pointerleave', this._onPointerLeave);
    this._preview?.remove();
    this._preview = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  activate() {
    return this.dispatchEvent(new CustomEvent('ic-activate', { bubbles: true, composed: true, cancelable: true }));
  }

  requestRemove() {
    return this.dispatchEvent(new CustomEvent('ic-remove', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: {
        referenceKey: this.getAttribute('data-input-remove-reference') || '',
        textReferenceId: this.getAttribute('data-input-remove-text-reference') || '',
      },
    }));
  }

  _previewData() {
    const kind = this.getAttribute('kind') || this.dataset.kind || 'image';
    const text = this.getAttribute('preview-text')
      || this.dataset.referenceText
      || this.dataset.textPreview
      || this.getAttribute('aria-label')
      || this.getAttribute('label')
      || '';
    const src = kind === 'video'
      ? this.dataset.url || this.getAttribute('original-src') || this.getAttribute('src') || ''
      : this.getAttribute('preview-src') || this.getAttribute('src') || this.dataset.url || '';
    if (kind === 'text' ? !text : !src) return null;
    return { kind, text, src };
  }

  _ensurePreview() {
    if (this._preview?.isConnected) return this._preview;
    const preview = document.createElement('ic-thumb-hovercard');
    document.body.append(preview);
    this._preview = preview;
    return preview;
  }

  _showPreview() {
    const data = this._previewData();
    if (!data) return;
    const preview = this._ensurePreview();
    preview.show?.(this, data);
  }

  _hidePreview() {
    if (!this._preview) return;
    this._preview.hide?.();
  }

  render() {
    const requestedKind = this.getAttribute('kind') || this.dataset.kind || 'image';
    const kind = KINDS.has(requestedKind) ? requestedKind : 'image';
    const label = this.getAttribute('label')?.trim() || '';
    const src = this.getAttribute('src') || '';
    const previewSrc = this.getAttribute('preview-src') || src;
    const originalSrc = this.getAttribute('original-src') || src;
    const alt = this.getAttribute('alt') || '';
    const removable = this.hasAttribute('removable');
    const removeLabel = this.getAttribute('remove-label') || (document.documentElement.lang.toLowerCase().startsWith('zh') ? '移除引用' : 'Remove reference');
    this.dataset.kind = kind;
    this.setAttribute('role', kind === 'text' ? 'group' : 'button');
    if (kind === 'text') this.removeAttribute('tabindex');
    else if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    if (!this.hasAttribute('aria-label') && label) this.setAttribute('aria-label', label);

    const media = kind === 'text'
      ? '<span class="ic-reference-thumbnail__kind input-thumb-text-icon"><ic-icon name="square-text" size="medium" aria-hidden="true"></ic-icon></span>'
      : kind === 'audio'
        ? '<span class="ic-reference-thumbnail__kind input-thumb-audio"><ic-icon name="audio-lines" size="medium" aria-hidden="true"></ic-icon></span>'
        : `<img src="${escapeHtml(previewSrc)}" data-preview-src="${escapeHtml(previewSrc)}" data-original-src="${escapeHtml(originalSrc)}"${kind === 'video' ? ' data-preview-kind="video"' : ''} alt="${escapeHtml(alt)}" draggable="false">`;
    const referenceKey = this.getAttribute('data-input-remove-reference');
    const textReferenceId = this.getAttribute('data-input-remove-text-reference');
    const removeData = referenceKey !== null
      ? ` data-input-remove-reference="${escapeHtml(referenceKey)}"`
      : textReferenceId !== null
        ? ` data-input-remove-text-reference="${escapeHtml(textReferenceId)}"`
        : '';
    this.innerHTML = `${media}<span class="input-thumb-label">${escapeHtml(label)}</span>${removable ? `<button class="input-thumb-remove" type="button" draggable="false" aria-label="${escapeHtml(removeLabel)}" title="${escapeHtml(removeLabel)}"${removeData}><ic-icon name="close" size="x-small" aria-hidden="true"></ic-icon></button>` : ''}`;
    this.querySelector('.input-thumb-remove')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.requestRemove();
    });
  }
}
