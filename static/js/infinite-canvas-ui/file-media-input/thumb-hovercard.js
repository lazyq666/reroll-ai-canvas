const VALID_KINDS = new Set(['image', 'video', 'audio', 'text']);
const HOVERCARD_EXIT_FALLBACK_MS = 220;

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

/** Hover-only media preview for one Reference Input Instance. */
export class IcThumbHovercard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode:'open' });
    this._motionFrame = 0;
    this._hideTimer = 0;
    this._onMotionEnd = null;
  }

  connectedCallback() {
    this.hidden = true;
    this.dataset.motionState = 'closed';
    this.setAttribute('role', 'presentation');
    this.setAttribute('aria-hidden', 'true');
    this.render();
  }

  show(anchor, { kind='image', src='', text='' }={}) {
    if (!anchor) return false;
    const normalizedKind = VALID_KINDS.has(kind) ? kind : 'image';
    if (normalizedKind === 'text' ? !text : !src) return false;
    this.dataset.kind = normalizedKind;
    this._anchor = anchor;
    this._src = src;
    this._text = text;
    this.render();
    this.cancelMotionCompletion();
    this.hidden = false;
    this.dataset.motionState = 'entering';
    this.setAttribute('aria-hidden', 'false');
    this.fitVisualMedia();
    this.positionFrom(anchor);
    this.playMedia();
    this._motionFrame = requestAnimationFrame(() => {
      this._motionFrame = requestAnimationFrame(() => {
        this._motionFrame = 0;
        if (!this.hidden && this.dataset.motionState === 'entering') this.dataset.motionState = 'open';
      });
    });
    return true;
  }

  hide() {
    this.destroyMedia();
    this.setAttribute('aria-hidden', 'true');
    if (this.hidden || this.dataset.motionState === 'closed') {
      this.finishHide();
      return;
    }
    this.cancelMotionCompletion();
    this.dataset.motionState = 'exiting';
    const finish = event => {
      if (event && event.target !== this) return;
      this.finishHide();
    };
    this._onMotionEnd = finish;
    this.addEventListener('transitionend', finish);
    this._hideTimer = window.setTimeout(() => this.finishHide(), HOVERCARD_EXIT_FALLBACK_MS);
  }

  cancelMotionCompletion() {
    if (this._motionFrame) cancelAnimationFrame(this._motionFrame);
    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (this._onMotionEnd) this.removeEventListener('transitionend', this._onMotionEnd);
    this._motionFrame = 0;
    this._hideTimer = 0;
    this._onMotionEnd = null;
  }

  finishHide() {
    this.cancelMotionCompletion();
    this.hidden = true;
    this.dataset.motionState = 'closed';
    this._src = '';
    this._text = '';
    this._anchor = null;
    this.shadowRoot.querySelector('[data-content]')?.replaceChildren();
  }

  positionFrom(anchor) {
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = this.getBoundingClientRect();
    const gap = this.shadowRoot.querySelector('[data-gap-probe]')?.getBoundingClientRect().width || 8;
    const edge = 8;
    const centeredLeft = anchorRect.left + (anchorRect.width - cardRect.width) / 2;
    const left = Math.max(edge, Math.min(window.innerWidth - cardRect.width - edge, centeredLeft));
    const aboveTop = anchorRect.top - cardRect.height - gap;
    const belowTop = anchorRect.bottom + gap;
    const placedAbove = aboveTop >= edge;
    const top = placedAbove
      ? aboveTop
      : Math.max(edge, Math.min(window.innerHeight - cardRect.height - edge, belowTop));
    this.dataset.placement = placedAbove ? 'above' : 'below';
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  }

  playMedia() {
    const media = this.shadowRoot.querySelector('video, audio');
    media?.play?.().catch(() => {});
  }

  fitVisualMedia() {
    const media = this.shadowRoot.querySelector('img, video');
    if (!media) return;
    const apply = () => {
      const width = Number(media.naturalWidth || media.videoWidth || 0);
      const height = Number(media.naturalHeight || media.videoHeight || 0);
      if (!width || !height) return;
      media.style.inlineSize = width >= height ? 'var(--ic-thumb-hovercard-media-max)' : 'auto';
      media.style.blockSize = height > width ? 'var(--ic-thumb-hovercard-media-max)' : 'auto';
      this.positionFrom(this._anchor);
    };
    media.addEventListener(media.localName === 'video' ? 'loadedmetadata' : 'load', apply, { once:true });
    if ((media.localName === 'img' && media.complete) || (media.localName === 'video' && media.readyState >= 1)) apply();
  }

  destroyMedia() {
    this.shadowRoot.querySelectorAll('video, audio').forEach(media => {
      media.pause?.();
      media.removeAttribute('src');
      media.load?.();
      media.remove();
    });
  }

  render() {
    const kind = this.dataset.kind || 'image';
    const content = !this._src && kind !== 'text'
      ? ''
      : kind === 'text'
      ? `<div class="text-preview">${escapeHtml(this._text)}</div>`
      : kind === 'audio'
        ? `<div class="audio-preview"><div class="audio-wave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><audio src="${escapeHtml(this._src)}" preload="auto"></audio></div>`
        : kind === 'video'
          ? `<video src="${escapeHtml(this._src)}" autoplay muted loop playsinline preload="auto"></video>`
          : `<img src="${escapeHtml(this._src)}" alt="">`;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --ic-thumb-hovercard-media-max: calc(12rem - var(--ui-border-width-thin) - var(--ui-border-width-thin));
          --ic-thumb-hovercard-motion-distance: var(--ui-space-1);
          --ic-thumb-hovercard-motion-scale: .98;
          position: fixed;
          z-index: var(--ui-z-popover);
          display: block;
          inline-size: max-content;
          block-size: max-content;
          max-inline-size: 12rem;
          max-block-size: 12rem;
          overflow: hidden;
          border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
          border-radius: var(--ui-radius-m);
          color: var(--ui-color-text-primary);
          background: var(--ui-color-surface);
          box-shadow: var(--ui-shadow-overlay);
          pointer-events: none;
          box-sizing: border-box;
          opacity: 1;
          transform: translateY(0) scale(1);
          transform-origin: bottom center;
          transition:
            opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),
            transform var(--ui-motion-duration-fast) var(--ui-motion-ease-fluid);
        }
        :host([data-placement="below"]) { transform-origin: top center; }
        :host([data-motion-state="entering"]),
        :host([data-motion-state="exiting"]) {
          opacity: 0;
          transform: translateY(var(--ic-thumb-hovercard-motion-distance)) scale(var(--ic-thumb-hovercard-motion-scale));
        }
        :host([data-placement="below"]:is([data-motion-state="entering"], [data-motion-state="exiting"])) {
          transform: translateY(calc(var(--ic-thumb-hovercard-motion-distance) * -1)) scale(var(--ic-thumb-hovercard-motion-scale));
        }
        :host([data-motion-state="entering"]) { transition: none; }
        :host([hidden]) { display: none; }
        [data-content] { display: grid; place-items: center; }
        img,
        video {
          display: block;
          inline-size: auto;
          block-size: auto;
          max-inline-size: var(--ic-thumb-hovercard-media-max);
          max-block-size: var(--ic-thumb-hovercard-media-max);
          object-fit: contain;
        }
        :host([data-kind="text"]),
        :host([data-kind="audio"]) {
          inline-size: 12rem;
          block-size: 8rem;
        }
        :host([data-kind="text"]) [data-content],
        :host([data-kind="audio"]) [data-content] { inline-size: 100%; block-size: 100%; }
        .text-preview {
          box-sizing: border-box;
          inline-size: 100%;
          block-size: 100%;
          overflow: hidden;
          padding: var(--ui-space-3);
          color: var(--ui-color-text-primary);
          font: var(--ui-text-body);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          user-select: none;
        }
        .audio-preview {
          display: grid;
          inline-size: 100%;
          block-size: 100%;
          place-items: center;
          border-radius: inherit;
          color: var(--ui-color-text-white);
          background: var(--ui-color-mask);
        }
        .audio-wave {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--ui-space-1);
          inline-size: 6rem;
          block-size: 6rem;
        }
        .audio-wave span {
          inline-size: .25rem;
          block-size: 70%;
          flex: 0 0 .25rem;
          border-radius: var(--ui-radius-pill);
          background: currentColor;
          transform: scaleY(.32);
          transform-origin: center;
          animation: ic-thumb-hovercard-audio-wave-pulse 1.2s ease-in-out infinite;
          will-change: transform;
        }
        .audio-wave span:nth-child(1),
        .audio-wave span:nth-child(9) { block-size: 38%; animation-delay: -.12s; }
        .audio-wave span:nth-child(2),
        .audio-wave span:nth-child(8) { block-size: 58%; animation-delay: -.24s; }
        .audio-wave span:nth-child(3),
        .audio-wave span:nth-child(7) { block-size: 76%; animation-delay: -.36s; }
        .audio-wave span:nth-child(4),
        .audio-wave span:nth-child(6) { block-size: 92%; animation-delay: -.48s; }
        .audio-wave span:nth-child(5) { block-size: 100%; animation-delay: -.6s; }
        @keyframes ic-thumb-hovercard-audio-wave-pulse {
          0%, 100% { transform: scaleY(.32); }
          50% { transform: scaleY(1); }
        }
        :host-context([data-ui-motion="reduced"]) .audio-wave span { animation: none; transform: scaleY(.66); }
        @media (prefers-reduced-motion: reduce) { .audio-wave span { animation: none; transform: scaleY(.66); } }
        :host-context([data-ui-motion="reduced"]) {
          --ic-thumb-hovercard-motion-distance: 0px;
          --ic-thumb-hovercard-motion-scale: 1;
          transition-duration: 1ms;
        }
        @media (prefers-reduced-motion: reduce) {
          :host {
            --ic-thumb-hovercard-motion-distance: 0px;
            --ic-thumb-hovercard-motion-scale: 1;
            transition-duration: 1ms;
          }
        }
        audio { display: none; }
        [data-gap-probe] {
          position: absolute;
          inline-size: var(--ui-space-2);
          block-size: 0;
          visibility: hidden;
          pointer-events: none;
        }
      </style>
      <div data-content>${content}</div><span data-gap-probe aria-hidden="true"></span>`;
  }
}
