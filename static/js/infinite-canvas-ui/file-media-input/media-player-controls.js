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
  static observedAttributes = ['kind', 'label', 'disabled'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this._media = null;
    this._listeners = [];
    this._lastContractError = '';
  }

  connectedCallback() { this.render(); }
  disconnectedCallback() { this._disconnectMedia(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  get media() { return this._media; }

  validateContract() {
    const kind = this.getAttribute('kind') || '';
    if (!PLAYER_KINDS.has(kind)) return 'kind must be video or audio';
    if (!this.getAttribute('label')?.trim()) return 'label is required for ic-media-player-controls';
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
    this._media = [...this.children].find(node => node.getAttribute('slot') === 'media');
    this._media.controls = false;
    const sync = () => this._sync();
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange'].forEach(type => this._listen(this._media, type, sync));
    this._listen(this._media, 'error', () => {
      this.dispatchEvent(new CustomEvent('ic-playback-error', { bubbles: true, composed: true }));
      this._sync();
    });
    if (this.getAttribute('kind') === 'video') this._listen(this._media, 'click', () => this.togglePlayback());
    this._sync();
  }

  _syncSeek(slider, value, max, disabled = false) {
    if (!slider) return;
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const safeValue = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? Math.round(value * 100) / 100 : 0));
    slider.setAttribute('max', String(safeMax));
    slider.setAttribute('value', String(safeValue));
    slider.value = safeValue;
    slider.toggleAttribute('disabled', disabled);
  }

  _sync() {
    const media = this._media;
    if (!media) return;
    const text = copy();
    const paused = media.paused || media.ended;
    const muted = media.muted || media.volume === 0;
    const play = this.shadowRoot.querySelector('[data-play]');
    const mute = this.shadowRoot.querySelector('[data-mute]');
    if (play) { play.icon = paused ? 'play' : 'pause'; play.label = paused ? text.play : text.pause; }
    if (mute) { mute.icon = muted ? 'volume-muted' : 'volume'; mute.label = muted ? text.unmute : text.mute; }
    this.toggleAttribute('playing', !paused);
    this.toggleAttribute('muted', muted);
    this._syncSeek(this.shadowRoot.querySelector('[data-seek]'), media.currentTime, media.duration, !Number.isFinite(media.duration));
    const time = this.shadowRoot.querySelector('[data-time]');
    if (time) time.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
  }

  _bindControls() {
    this.shadowRoot.querySelector('slot')?.addEventListener('slotchange', () => this._connectMedia());
    this.shadowRoot.querySelector('[data-play]')?.addEventListener('click', () => this.togglePlayback());
    this.shadowRoot.querySelector('[data-mute]')?.addEventListener('click', () => { if (this._media) { this._media.muted = !this._media.muted; this._sync(); } });
    this.shadowRoot.querySelector('[data-seek]')?.addEventListener('input', event => { if (this._media) { this._media.currentTime = Number(event.currentTarget.value); this._sync(); } });
    this._connectMedia();
  }

  render() {
    const label = this.getAttribute('label')?.trim() || '';
    const disabled = this.hasAttribute('disabled');
    const text = copy();
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', label);
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;width:100%;min-width:0;overflow:hidden;border-radius:inherit;color:var(--ui-color-text-white);font:inherit}:host([hidden]){display:none!important}*{box-sizing:border-box}.player{position:relative;display:grid;width:100%;height:100%;min-width:0;overflow:hidden;border-radius:inherit;background:var(--ui-color-surface)}.stage{position:relative;display:grid;min-width:0;min-height:0;place-items:center;overflow:hidden}.controls{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;column-gap:var(--ui-space-2);row-gap:var(--ui-space-0);min-width:0;padding:var(--ui-space-3) var(--ui-space-3) var(--ui-space-2);color:var(--ui-color-text-white);background:linear-gradient(180deg,transparent 0%,var(--ui-color-mask) 100%)}.time{color:var(--ui-color-text-white);font:var(--ui-text-title-3);font-variant-numeric:tabular-nums;white-space:nowrap}[data-mute]{grid-column:4}.seek{grid-column:1/-1;width:100%;min-width:0;--track-size:var(--ui-space-2);--thumb-width:var(--ui-space-4);--thumb-height:var(--ui-space-4)}ic-slider::part(label),ic-slider::part(hint){display:none}ic-slider::part(slider){display:flex;min-height:var(--ui-space-4);align-items:flex-end}ic-slider::part(track){width:100%;background:color-mix(in srgb,var(--ui-color-text-white) 35%,transparent)}ic-slider::part(indicator){background:var(--ui-color-text-white)}ic-slider::part(thumb){border-color:var(--ui-color-text-white);background:var(--ui-color-text-white);box-shadow:var(--ui-shadow-none)}ic-icon-button{--ui-color-text-secondary:var(--ui-color-text-white);--ui-color-text-tertiary:var(--ui-color-text-white)}ic-icon-button::part(base){border-color:transparent!important;color:var(--ui-color-text-white)!important;background:transparent!important;box-shadow:var(--ui-shadow-none)!important}ic-icon-button:hover::part(base){color:var(--ui-color-text-white)!important;background:color-mix(in srgb,var(--ui-color-text-white) 12%,transparent)!important}::slotted(video){display:block;width:100%;height:100%;object-fit:contain;background:var(--ui-color-surface)}::slotted(audio){display:none}:host([kind="video"]) .controls{position:absolute;inset:auto 0 0;z-index:1}:host([kind="audio"]) .stage{display:none}:host([disabled]){opacity:.55;pointer-events:none}:host([data-ic-contract-status="invalid"]){opacity:.55;pointer-events:none}@media(max-width:34rem){.controls{column-gap:var(--ui-space-1);row-gap:var(--ui-space-0);padding:var(--ui-space-2)}.time{font:var(--ui-text-label)}}
      ic-slider::part(slider){min-height:var(--ui-space-2)}
    </style><div class="player"><div class="stage"><slot name="media"></slot></div><div class="controls"><ic-icon-button data-play type="button" size="m" hierarchy="quiet" background="ghost" icon="play" label="${escapeHtml(text.play)}" ${disabled ? 'disabled' : ''}></ic-icon-button><span class="time" data-time>0:00 / 0:00</span><ic-icon-button data-mute type="button" size="m" hierarchy="quiet" background="ghost" icon="volume" label="${escapeHtml(text.mute)}" ${disabled ? 'disabled' : ''}></ic-icon-button><ic-slider class="seek" data-seek size="xs" label="${escapeHtml(text.seek)}" min="0" max="1" step="0.01" value="0" disabled></ic-slider></div></div>`;
    this._bindControls();
  }
}
