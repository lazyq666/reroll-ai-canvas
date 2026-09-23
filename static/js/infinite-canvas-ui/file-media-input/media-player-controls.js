const PLAYER_KINDS = new Set(['video', 'audio']);
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const isZh = () => document.documentElement.lang.toLowerCase().startsWith('zh');
const copy = () => isZh() ? {
  play: '播放', pause: '暂停', seek: '播放进度', mute: '静音', unmute: '取消静音',
} : {
  play: 'Play', pause: 'Pause', seek: 'Playback position', mute: 'Mute', unmute: 'Unmute',
};

function formatTime(value) {
  const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export class IcMediaPlayerControls extends HTMLElement {
  static observedAttributes = ['kind', 'label', 'disabled', 'variant', 'expanded'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this._media = null;
    this._listeners = [];
    this._lastContractError = '';
    this._externalMedia = null;
    this._onLanguageChange = () => this._sync();
  }

  connectedCallback() {
    this.render();
    window.addEventListener('studio-lang-change', this._onLanguageChange);
  }
  disconnectedCallback() {
    this._disconnectMedia();
    window.removeEventListener('studio-lang-change', this._onLanguageChange);
  }
  connectedMoveCallback() {}
  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'expanded') this._sync();
    else this.render();
  }
  get media() { return this._media; }
  // Node controls bind a sibling engine so presentation changes never reparent it here.
  set media(value) {
    this._externalMedia = value;
    if (this.isConnected) this._connectMedia();
  }
  get isNode() { return this.getAttribute('variant') === 'node'; }
  _text() {
    if (!this.isNode) return copy();
    return Object.fromEntries(['play', 'pause', 'seek', 'mute', 'unmute', 'expand', 'collapse', 'loopOn', 'loopOff'].map(key =>
      [key, window.StudioI18n?.t(`common.media.${key}`) || '']));
  }

  validateContract() {
    const kind = this.getAttribute('kind') || '';
    if (!PLAYER_KINDS.has(kind)) return 'kind must be video or audio';
    if (!this.getAttribute('label')?.trim()) return 'label is required for ic-media-player-controls';
    if (this.isNode) return kind === 'video' && this._externalMedia?.localName === 'video'
      ? '' : 'node variant requires a video assigned to media';
    const candidates = [...this.children].filter(node => node.getAttribute('slot') === 'media');
    if (candidates.length !== 1 || candidates[0].localName !== kind) return `exactly one slotted ${kind} element is required`;
    return '';
  }

  play() {
    if (!this._media || this.hasAttribute('disabled')) return false;
    const result = this._media.play();
    result?.catch?.(() => this._sync());
    return true;
  }

  pause() {
    if (!this._media || this.hasAttribute('disabled')) return false;
    this._media.pause();
    return true;
  }

  togglePlayback() { return this._media?.paused ? this.play() : this.pause(); }

  _setContract(reason) {
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (!reason) {
      delete this.dataset.icContractReason;
      this.removeAttribute('aria-disabled');
      this._lastContractError = '';
      return true;
    }
    this.dataset.icContractReason = reason;
    this.setAttribute('aria-disabled', 'true');
    if (reason !== this._lastContractError) {
      this._lastContractError = reason;
      this.dispatchEvent(new CustomEvent('ic-contract-error', { bubbles: true, composed: true, detail: { component: this.localName, reason } }));
    }
    return false;
  }

  _listen(target, type, listener) {
    target.addEventListener(type, listener);
    this._listeners.push(() => target.removeEventListener(type, listener));
  }

  _disconnectMedia() {
    this._listeners.splice(0).forEach(remove => remove());
    this._media = null;
  }

  _connectMedia() {
    this._disconnectMedia();
    const reason = this.validateContract();
    if (!this._setContract(reason)) return;
    this._media = this.isNode ? this._externalMedia : [...this.children].find(node => node.getAttribute('slot') === 'media');
    this._media.controls = false;
    const attributes = new MutationObserver(() => this._sync());
    attributes.observe(this._media, { attributes:true, attributeFilter:['loop'] });
    this._listeners.push(() => attributes.disconnect());
    const sync = () => this._sync();
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange'].forEach(type => this._listen(this._media, type, sync));
    this._listen(this._media, 'error', () => {
      this.dispatchEvent(new CustomEvent('ic-playback-error', { bubbles: true, composed: true }));
      this._sync();
    });
    if (!this.isNode && this.getAttribute('kind') === 'video') this._listen(this._media, 'click', () => this.togglePlayback());
    this._sync();
  }

  _syncSeek(slider, value, max, disabled = false) {
    if (!slider) return;
    const safeMax = Number.isFinite(max) && max > 0 ? Math.ceil(max * 100) / 100 : 1;
    const safeValue = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? Math.round(value * 100) / 100 : 0));
    slider.setAttribute('max', String(safeMax));
    slider.setAttribute('value', String(safeValue));
    slider.value = safeValue;
    slider.toggleAttribute('disabled', disabled);
  }

  _sync() {
    const media = this._media;
    if (!media) return;
    const text = this._text();
    const paused = media.paused || media.ended;
    const muted = media.muted || media.volume === 0;
    const play = this.shadowRoot.querySelector('[data-play]');
    const mute = this.shadowRoot.querySelector('[data-mute]');
    if (play) { play.icon = paused ? 'play-filled' : 'pause-filled'; play.label = paused ? text.play : text.pause; }
    if (mute) { mute.icon = muted ? 'volume-muted' : 'volume'; mute.label = muted ? text.unmute : text.mute; }
    const seek = this.shadowRoot.querySelector('[data-seek]');
    if (seek) { seek.label = text.seek; seek.setAttribute('value-text', `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`); }
    const expand = this.shadowRoot.querySelector('[data-expand]');
    if (expand) {
      expand.label = this.hasAttribute('expanded') ? text.collapse : text.expand;
      expand.icon = this.hasAttribute('expanded') ? 'collapse-editor' : 'focus-editor';
    }
    const loop = this.shadowRoot.querySelector('[data-loop]');
    if (loop) {
      loop.label = media.loop ? text.loopOff : text.loopOn;
      loop.pressed = media.loop;
      loop.toggleAttribute('pressed', media.loop);
      loop.setAttribute('aria-pressed', String(media.loop));
    }
    this.toggleAttribute('playing', !paused);
    this.toggleAttribute('muted', muted);
    this._syncSeek(seek, media.currentTime, media.duration, this.hasAttribute('disabled') || !Number.isFinite(media.duration) || media.duration <= 0);
    const time = this.shadowRoot.querySelector('[data-time]');
    if (time) {
      const value = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
      const timeValue = time.querySelector('[data-time-value]');
      if (timeValue) {
        // Reserve both timestamps using the duration's widest format, including minute/hour rollover.
        const reserve = formatTime(Math.max(media.duration || 0, media.currentTime || 0)).replace(/\d/g, '8');
        time.dataset.widthReserve = `${reserve} / ${reserve}`;
        timeValue.textContent = value;
      } else time.textContent = value;
    }
  }

  _bindControls() {
    this.shadowRoot.querySelector('slot')?.addEventListener('slotchange', () => this._connectMedia());
    this.shadowRoot.querySelector('[data-play]')?.addEventListener('click', () => this.togglePlayback());
    this.shadowRoot.querySelector('[data-mute]')?.addEventListener('click', () => {
      if (!this._media || this.hasAttribute('disabled')) return;
      if (this._media.volume === 0) { this._media.volume = 1; this._media.muted = false; }
      else this._media.muted = !this._media.muted;
      this._sync();
    });
    this.shadowRoot.querySelector('[data-seek]')?.addEventListener('input', event => {
      if (!this._media || this.hasAttribute('disabled') || !Number.isFinite(this._media.duration) || this._media.duration <= 0) return;
      this._media.currentTime = Math.min(this._media.duration, Math.max(0, Number(event.currentTarget.value) || 0));
      this._sync();
    });
    this.shadowRoot.querySelector('[data-expand]')?.addEventListener('click', () => {
      if (!this.hasAttribute('disabled')) this.dispatchEvent(new CustomEvent('ic-expand-request', { bubbles:true, composed:true }));
    });
    this.shadowRoot.querySelector('[data-loop]')?.addEventListener('click', () => {
      if (!this.hasAttribute('disabled')) this.dispatchEvent(new CustomEvent('ic-loop-request', { bubbles:true, composed:true }));
    });
    if (this.isNode) {
      const controls = this.shadowRoot.querySelector('.controls');
      ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown', 'keyup'].forEach(type => {
        controls.addEventListener(type, event => {
          if (this.hasAttribute('expanded') && event.key === 'Escape') return;
          event.stopPropagation();
        });
      });
    }
    this._connectMedia();
  }

  render() {
    if (this.isNode) { this._renderNode(); return; }
    const label = this.getAttribute('label')?.trim() || '';
    const disabled = this.hasAttribute('disabled');
    const text = copy();
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', label);
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;width:100%;min-width:0;overflow:hidden;border-radius:inherit;color:var(--ui-color-text-white);font:inherit}:host([hidden]){display:none!important}*{box-sizing:border-box}.player{position:relative;display:grid;width:100%;height:100%;min-width:0;overflow:hidden;border-radius:inherit;background:var(--ui-color-surface)}.stage{position:relative;display:grid;min-width:0;min-height:0;place-items:center;overflow:hidden}.controls{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;column-gap:var(--ui-space-2);row-gap:var(--ui-space-0);min-width:0;padding:var(--ui-space-3) var(--ui-space-3) var(--ui-space-2);color:var(--ui-color-text-white);background:linear-gradient(180deg,transparent 0%,var(--ui-color-mask) 100%)}.time{color:var(--ui-color-text-white);font:var(--ui-text-title-3);font-variant-numeric:tabular-nums;white-space:nowrap}[data-mute]{grid-column:4}.seek{grid-column:1/-1;width:100%;min-width:0;--track-size:var(--ui-space-2);--thumb-width:var(--ui-space-4);--thumb-height:var(--ui-space-4)}ic-slider::part(label),ic-slider::part(hint){display:none}ic-slider::part(slider){display:flex;min-height:var(--ui-space-4);align-items:flex-end}ic-slider::part(track){width:100%;background:color-mix(in srgb,var(--ui-color-text-white) 35%,transparent)}ic-slider::part(indicator){background:var(--ui-color-text-white)}ic-slider::part(thumb){border-color:var(--ui-color-text-white);background:var(--ui-color-text-white);box-shadow:var(--ui-shadow-none)}ic-icon-button{--ui-color-text-secondary:var(--ui-color-text-white);--ui-color-text-tertiary:var(--ui-color-text-white)}ic-icon-button::part(base){border-color:transparent!important;color:var(--ui-color-text-white)!important;background:transparent!important;box-shadow:var(--ui-shadow-none)!important}ic-icon-button:hover::part(base){color:var(--ui-color-text-white)!important;background:color-mix(in srgb,var(--ui-color-text-white) 12%,transparent)!important}::slotted(video){display:block;width:100%;height:100%;object-fit:contain;background:var(--ui-color-surface)}::slotted(audio){display:none}:host([kind="video"]) .controls{position:absolute;inset:auto 0 0;z-index:1}:host([kind="audio"]) .stage{display:none}:host([disabled]){opacity:.55;pointer-events:none}:host([data-ic-contract-status="invalid"]){opacity:.55;pointer-events:none}@media(max-width:34rem){.controls{column-gap:var(--ui-space-1);row-gap:var(--ui-space-0);padding:var(--ui-space-2)}.time{font:var(--ui-text-label)}}
      ic-slider::part(slider){min-height:var(--ui-space-2)}
    </style><div class="player"><div class="stage"><slot name="media"></slot></div><div class="controls"><ic-icon-button data-play type="button" size="m" hierarchy="quiet" background="ghost" icon="play-filled" label="${escapeHtml(text.play)}" ${disabled ? 'disabled' : ''}></ic-icon-button><span class="time" data-time>0:00 / 0:00</span><ic-icon-button data-mute type="button" size="m" hierarchy="quiet" background="ghost" icon="volume" label="${escapeHtml(text.mute)}" ${disabled ? 'disabled' : ''}></ic-icon-button><ic-slider class="seek" data-seek size="xs" label="${escapeHtml(text.seek)}" min="0" max="1" step="0.01" value="0" disabled></ic-slider></div></div>`;
    this._bindControls();
  }

  _renderNode() {
    const text = this._text();
    const disabled = this.hasAttribute('disabled') ? 'disabled' : '';
    const button = (action, icon, label) => `<ic-icon-button data-${action} ${action === 'loop' ? 'toggle' : ''} type="button" size="s" hierarchy="quiet" background="ghost" icon="${icon}" label="${escapeHtml(label)}" tooltip-disabled ${disabled}></ic-icon-button>`;
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.getAttribute('label') || '');
    this.shadowRoot.innerHTML = `<style>
      :host{position:absolute;inset:auto 0 0;display:block;z-index:5;pointer-events:none;color:var(--ui-color-text-white);border-radius:inherit;container-type:inline-size}
      :host([hidden]){display:none!important}*{box-sizing:border-box}
      .controls{position:relative;height:5.5rem;background:linear-gradient(180deg,transparent,var(--ui-color-mask));border-radius:inherit}
      .row{position:absolute;inset:auto var(--ui-space-3) 11px;display:flex;align-items:center;justify-content:space-between;gap:var(--ui-space-2)}
      .pill,.actions{display:flex;align-items:center;gap:var(--ui-space-1)}
      .actions ic-icon-button{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;flex:none;border-radius:var(--ui-radius-pill);background:rgb(0 0 0 / 30%)}
      .actions ic-icon-button:hover{background:rgb(0 0 0 / 50%)}
      .actions [data-loop][pressed]{background:rgb(255 255 255 / 24%)}
      [data-loop][pressed]::after{content:"";position:absolute;bottom:3px;width:3px;height:3px;border-radius:50%;background:var(--ui-color-text-white)}
      [data-loop]{position:relative}
      [data-play]{display:inline-flex;align-items:center;justify-content:center;width:var(--ui-space-6);height:var(--ui-space-6);flex:none}
      .pill{height:2.25rem;padding:0 var(--ui-space-4) 0 var(--ui-space-2);flex:none;border-radius:var(--ui-radius-pill);background:rgb(0 0 0 / 30%);pointer-events:auto}
      .time{position:relative;flex:none;font:var(--ui-text-caption);font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ui-color-text-white)}
      .time::before{content:attr(data-width-reserve);visibility:hidden}
      [data-time-value]{position:absolute;inset:0;text-align:right}
      ic-icon-button{pointer-events:auto;color:var(--ui-color-text-white);--ui-color-text-secondary:var(--ui-color-text-white);--ui-color-text-tertiary:var(--ui-color-text-white)}
      ic-icon-button::part(base){width:2.25rem;height:2.25rem;min-height:0;border:0;border-radius:var(--ui-radius-pill);background:rgb(0 0 0 / 30%)!important;color:var(--ui-color-text-white)!important;box-shadow:none}
      [data-play]::part(base){width:var(--ui-space-5);height:var(--ui-space-6);background:transparent!important}
      ic-icon-button::part(base):focus-visible{outline:var(--ui-focus-ring-width) solid var(--ui-color-text-white);outline-offset:var(--ui-focus-ring-offset)}
      ic-icon-button:hover::part(base){background:rgb(0 0 0 / 50%)!important}
      .seek{position:absolute;inset:auto 0 0;width:100%;pointer-events:auto;--track-size:3px;--thumb-width:8px;--thumb-height:8px}
      ic-slider::part(label),ic-slider::part(hint){display:none}
      ic-slider::part(slider){display:flex;min-height:10px;align-items:flex-end}
      ic-slider::part(track){width:100%;background:rgb(255 255 255 / 30%);border-radius:0}
      ic-slider::part(indicator){background:var(--ui-color-text-white)}
      ic-slider::part(thumb){background:var(--ui-color-text-white);border-color:var(--ui-color-text-white);box-shadow:none;opacity:0}
      ic-slider:hover::part(thumb),ic-slider:focus-within::part(thumb){opacity:1}
      @container(max-width:240px){.row{inset-inline:var(--ui-space-1);gap:var(--ui-space-1)}.pill{padding:0 var(--ui-space-3) 0 var(--ui-space-1)}.time{font-size:10px}.actions{gap:2px}.actions ic-icon-button{width:1.75rem;height:1.75rem}ic-icon-button::part(base){width:1.75rem;height:1.75rem}}
    </style><div class="controls"><div class="row"><div class="pill">${button('play','play-filled',text.play)}<span class="time" data-time data-width-reserve="8:88 / 8:88"><span data-time-value>0:00 / 0:00</span></span></div><div class="actions">${button('loop','loop',text.loopOn)}${button('mute','volume',text.mute)}${button('expand','focus-editor',text.expand)}</div></div><ic-slider class="seek" data-seek size="xs" label="${escapeHtml(text.seek)}" min="0" max="1" step="0.01" value="0" disabled></ic-slider></div>`;
    this._bindControls();
  }
}
