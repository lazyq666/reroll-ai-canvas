import { layerDraft, normalizedBBox, LAYER_PRESETS, MAX_LAYER_REGIONS, clone } from './layer-state.js';
import { CropperHandle, CropperSelection } from '../../../vendor/cropperjs/2.2.0/cropper.esm.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const inputValue = event => event.composedPath()[0]?.value ?? event.currentTarget.value;
const directions = ['n','e','s','w','ne','nw','se','sw'];

export class LayerAuthoring {
  constructor(dialog) { this.dialog = dialog; this.reset(null); }
  t(key, values = {}) {
    return String(this.dialog.messages.layerAuthoring?.[key] || '').replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  }
  reset(value) {
    this.dispose(); this.state = layerDraft(value); this.selected = this.state.regions[0]?.id || '';
    this.loaded = false; this.failed = false; this.scale = 0; this.gesture = null;
  }
  snapshot() { return clone(this.state); }
  prompt() {
    if (this.state.mode !== 'regions') return this.state.prompts[this.state.preset] ?? (this.state.preset === 'auto' ? '' : this.t(`prompt.${this.state.preset}`));
    const regions = this.state.regions.map((region, index) => {
      const box = normalizedBBox(region, this.state.sourceWidth, this.state.sourceHeight);
      return this.t('regionLine', {number:index + 1, description:region.description ? ` (${region.description})` : '', bbox:box?.join(' ') || ''});
    });
    return [this.t('regionPrompt', {regions:regions.join('\n')}), this.state.supplement].filter(Boolean).join('\n');
  }
  reason() {
    if (this.state.mode !== 'regions') return this.state.preset !== 'auto' && !this.prompt().trim() ? this.t('promptRequired') : '';
    if (!this.dialog.currentModel()?.supportsLayerRegions) return this.t('unsupported');
    if (this.failed) return this.t('imageError');
    if (!this.loaded) return this.t('loading');
    if (this.stale()) return this.t('staleSize');
    if (!this.state.regions.length) return this.t('drawHint');
    if (this.state.regions.length > MAX_LAYER_REGIONS) return this.t('limit', {count:MAX_LAYER_REGIONS});
    if (this.state.regions.some(region => !normalizedBBox(region, this.state.sourceWidth, this.state.sourceHeight))) return this.t('invalidRegion');
    return '';
  }
  stale() { return this.state.regions.length && (this.state.sourceWidth !== this.width || this.state.sourceHeight !== this.height); }
  emit() {
    this.sync();
    this.dialog.dispatchEvent(new CustomEvent('ic-layer-draft-change', {bubbles:true, composed:true, detail:{draft:this.snapshot()}}));
  }
  modeMarkup() {
    return `<ic-segmented-control data-layer-mode label="${escape(this.t('mode'))}" value="${this.state.mode}" data-legal-combination="single-label">
      <button type="button" data-value="intelligent"><ic-icon name="sparkles" aria-hidden="true"></ic-icon>${escape(this.t('intelligent'))}</button>
      <button type="button" data-value="regions"><ic-icon name="scan" aria-hidden="true"></ic-icon>${escape(this.t('regions'))}</button>
    </ic-segmented-control>`;
  }
  sourceMarkup() {
    return `<div data-layer-source-stage><cropper-canvas data-layer-canvas disabled tabindex="0" aria-label="${escape(this.t('canvas'))}"><img data-layer-source src="${escape(this.dialog.sourceImage)}" alt="${escape(this.dialog.sourceAlt)}" draggable="false"></cropper-canvas></div>`;
  }
  controlsMarkup() {
    if (this.state.mode === 'regions') return `<p data-layer-hint>${escape(this.t('drawHint'))}</p>
      <div data-layer-region-actions><ic-button data-layer-add size="small" hierarchy="secondary">${escape(this.t('add'))}</ic-button><ic-button data-layer-clear size="small" hierarchy="quiet">${escape(this.t('clear'))}</ic-button></div>
      <div data-layer-region-panel></div>
      <ic-form-field label="${escape(this.t('supplement'))}" orientation="vertical"><ic-textarea name="layer-supplement" label="${escape(this.t('supplement'))}" rows="2" value="${escape(this.state.supplement)}"></ic-textarea></ic-form-field>
      <details data-layer-preview><summary>${escape(this.t('preview'))}</summary><pre data-layer-prompt-preview></pre></details>
      <p data-layer-status role="status"></p><ic-button data-layer-retry size="small" hierarchy="quiet" hidden>${escape(this.t('retry'))}</ic-button>`;
    return `<div class="ai-processor-field"><span class="ai-processor-option-title">${escape(this.t('granularity'))}</span><ic-segmented-control name="layer-preset" data-layer-preset-options label="${escape(this.t('granularity'))}" value="${this.state.preset}" size="small" data-legal-combination="single-label">${LAYER_PRESETS.map(key => `<button type="button" data-value="${key}">${escape(this.t(`preset.${key}`))}</button>`).join('')}</ic-segmented-control></div>
      <ic-form-field label="${escape(this.t('prompt'))}" orientation="vertical" data-legal-combination="textarea-vertical" data-component-name="ic-form-field-textarea"><ic-textarea name="layer-prompt" label="${escape(this.t('prompt'))}" placeholder="${escape(this.dialog.message('promptPlaceholder'))}" rows="5" resize="vertical" value="${escape(this.prompt())}"></ic-textarea></ic-form-field>`;
  }
  mount() {
    this.abort = new AbortController(); const signal = this.abort.signal;
    const body = this.dialog.bodyElement;
    const listen = (element, name, callback, capture = false) => element?.addEventListener(name, callback, {signal, capture});
    listen(body.querySelector('[data-layer-mode]'), 'ic-change', event => {
      this.state.mode = event.currentTarget.value || event.currentTarget.getAttribute('value');
      this.emit(); this.dialog.renderBody();
    });
    listen(body.querySelector('[name="layer-preset"]'), 'ic-change', event => {
      this.state.preset = event.detail.value; this.emit(); this.dialog.renderBody();
      this.dialog.bodyElement.querySelector('[name="layer-preset"] > [aria-checked="true"]')?.focus({preventScroll:true});
    });
    listen(body.querySelector('[name="layer-prompt"]'), 'input', event => {
      this.state.prompts[this.state.preset] = inputValue(event); this.emit();
    });
    listen(body.querySelector('[name="layer-supplement"]'), 'input', event => { this.state.supplement = inputValue(event); this.emit(); });
    listen(body.querySelector('[data-layer-add]'), 'click', () => this.add());
    listen(body.querySelector('[data-layer-clear]'), 'click', () => { this.state.regions = []; this.selected = ''; if (this.loaded) { this.state.sourceWidth = this.width; this.state.sourceHeight = this.height; } this.emit(); this.paint(); this.regionPanel(); });
    listen(body.querySelector('[data-layer-discard]'), 'click', () => this.dialog.hide('discard-layer-draft'));
    listen(body.querySelector('[data-layer-retry]'), 'click', () => this.dialog.renderBody());
    this.canvas = body.querySelector('[data-layer-canvas]'); this.stage = body.querySelector('[data-layer-source-stage]');
    const canvas = this.canvas; const img = canvas.querySelector('img');
    this.loaded = false; this.failed = false;
    const loaded = () => {
      if (signal.aborted) return;
      this.width = img.naturalWidth; this.height = img.naturalHeight;
      this.loaded = this.width > 0 && this.height > 0; this.failed = !this.loaded;
      if (!this.loaded) { this.sync(); return; }
      if (!this.state.regions.length) { this.state.sourceWidth = this.width; this.state.sourceHeight = this.height; }
      this.resize(); this.sync();
    };
    listen(img, 'load', loaded);
    listen(img, 'error', () => { this.failed = true; this.loaded = false; this.sync(); });
    if (img.complete && img.naturalWidth) loaded();
    this.observer = new ResizeObserver(() => { if (!this.gesture) this.resize(); }); this.observer.observe(this.stage);
    listen(canvas, 'actionstart', event => {
      if (this.dialog.pending || !this.loaded || this.stale() || !this.dialog.currentModel()?.supportsLayerRegions) { event.preventDefault(); return; }
      if (event.detail.action === 'select' && this.state.regions.length >= MAX_LAYER_REGIONS) { event.preventDefault(); this.dialog.setError(this.t('limit', {count:MAX_LAYER_REGIONS})); return; }
      this.gesture = this.snapshot(); this.cancelled = false;
      this.drawStart = event.detail.action === 'select' ? {x:event.detail.relatedEvent.pageX, y:event.detail.relatedEvent.pageY} : null;
      const selection = event.detail.relatedEvent?.target?.closest?.('cropper-selection');
      if (selection?.dataset.regionId) this.selected = selection.dataset.regionId;
      canvas.focus({preventScroll:true});
    }, true);
    listen(canvas, 'actionmove', event => { if (this.cancelled) event.preventDefault(); }, true);
    listen(canvas, 'change', event => this.selectionChange(event));
    listen(canvas, 'action', event => {
      if (event.detail.action === 'select' && this.drawStart
          && (event.detail.endX === this.drawStart.x || event.detail.endY === this.drawStart.y)) event.preventDefault();
    }, true);
    // Cropper 2.2.0 initially anchors reverse selections at startX/startY.
    // After its canvas handlers run, correct that first rectangle through the
    // public geometry API; subsequent movement/resizing stays owned by Cropper.
    listen(this.stage, 'action', event => {
      const detail = event.detail;
      if (event.defaultPrevented || !this.gesture || this.cancelled || detail.action !== 'select' || !this.drawStart) return;
      const selection = [...canvas.querySelectorAll('cropper-selection')].find(item => item.active);
      if (!selection) return;
      const bounds = canvas.getBoundingClientRect();
      selection.$change(
        Math.min(this.drawStart.x, detail.endX) - bounds.left - window.scrollX,
        Math.min(this.drawStart.y, detail.endY) - bounds.top - window.scrollY,
        Math.abs(detail.endX - this.drawStart.x), Math.abs(detail.endY - this.drawStart.y)
      );
      canvas.$setAction(`${detail.endY < this.drawStart.y ? 'n' : 's'}${detail.endX < this.drawStart.x ? 'w' : 'e'}-resize`);
    });
    listen(canvas, 'actionend', event => {
      if (this.gesture && /cancel$/.test(event.detail.relatedEvent?.type || '')) this.state = clone(this.gesture);
      const changed = this.gesture && JSON.stringify(this.gesture) !== JSON.stringify(this.state);
      this.gesture = null; this.drawStart = null; this.cancelled = false;
      if (changed) this.emit();
      this.paint(); this.regionPanel();
    });
    listen(this.dialog, 'keydown', event => {
      if (event.key === 'Escape' && this.gesture) {
        event.preventDefault(); event.stopImmediatePropagation(); this.state = clone(this.gesture); this.cancelled = true; this.paint(); this.sync(); return;
      }
      if (event.composedPath().includes(canvas)) this.keydown(event);
    }, true);
    this.regionPanel(); this.sync();
  }
  resize() {
    if (!this.loaded || !this.canvas) return;
    const style = getComputedStyle(this.stage);
    const width = this.stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = this.stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(width / this.width, height / this.height);
    if (!(scale > 0)) return;
    this.scale = scale;
    this.canvas.style.width = `${this.width * scale}px`; this.canvas.style.height = `${this.height * scale}px`;
    this.paint();
  }
  newSelection(region) {
    const selection = new CropperSelection();
    selection.multiple = true; selection.movable = true; selection.resizable = true; selection.precise = true;
    selection.themeColor = '#ffffff';
    selection.innerHTML = `<span data-layer-number aria-hidden="true"></span><cropper-handle action="move" plain></cropper-handle>${directions.map(direction => `<cropper-handle action="${direction}-resize" theme-color="#ffffff"></cropper-handle>`).join('')}`;
    if (region) selection.dataset.regionId = region.id;
    this.canvas.append(selection);
    if (region) {
      selection.$change(region.x * this.scale, region.y * this.scale, region.width * this.scale, region.height * this.scale);
      selection.active = region.id === this.selected;
      selection.querySelector('[data-layer-number]').textContent = String(this.state.regions.indexOf(region) + 1);
    } else { selection.hidden = true; selection.active = true; }
    return selection;
  }
  paint() {
    if (!this.canvas || !this.scale) return;
    this.painting = true;
    this.canvas.querySelectorAll('cropper-selection, [data-layer-draw]').forEach(element => element.remove());
    if (this.state.mode === 'regions' && !this.stale()) {
      const handle = new CropperHandle(); handle.action = 'select'; handle.plain = true; handle.dataset.layerDraw = ''; this.canvas.append(handle);
      if (this.state.regions.length) this.state.regions.forEach(region => this.newSelection(region)); else this.newSelection(null);
    }
    this.painting = false;
  }
  selectionChange(event) {
    const selection = event.target;
    if (!this.gesture || this.painting || !selection.matches('cropper-selection') || this.cancelled || !this.scale) return;
    const {x, y, width, height} = event.detail;
    if (![x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0 || x < -1e-6 || y < -1e-6
        || x + width > this.width * this.scale + 1e-6 || y + height > this.height * this.scale + 1e-6) { event.preventDefault(); return; }
    const duplicate = [...this.canvas.querySelectorAll('cropper-selection')].some(other => other !== selection && other.dataset.regionId === selection.dataset.regionId);
    if (!selection.dataset.regionId || duplicate) selection.dataset.regionId = crypto.randomUUID();
    let region = this.state.regions.find(item => item.id === selection.dataset.regionId);
    if (!region) {
      if (this.state.regions.length >= MAX_LAYER_REGIONS) { event.preventDefault(); return; }
      region = {id:selection.dataset.regionId, description:''}; this.state.regions.push(region);
    }
    Object.assign(region, {x:Math.max(0,x / this.scale), y:Math.max(0,y / this.scale), width:width / this.scale, height:height / this.scale});
    this.selected = region.id;
    selection.querySelector('[data-layer-number]').textContent = String(this.state.regions.indexOf(region) + 1);
    this.sync();
  }
  add() {
    if (!this.loaded || this.stale() || !this.dialog.currentModel()?.supportsLayerRegions || this.dialog.pending) return;
    if (this.state.regions.length >= MAX_LAYER_REGIONS) { this.dialog.setError(this.t('limit', {count:MAX_LAYER_REGIONS})); return; }
    const region = {id:crypto.randomUUID(), x:this.width * .375, y:this.height * .375, width:this.width * .25, height:this.height * .25, description:''};
    this.state.regions.push(region); this.selected = region.id; this.emit(); this.paint(); this.regionPanel(); this.canvas.focus();
  }
  remove() {
    this.state.regions = this.state.regions.filter(region => region.id !== this.selected);
    this.selected = this.state.regions[0]?.id || ''; this.emit(); this.paint(); this.regionPanel();
  }
  keydown(event) {
    const region = this.state.regions.find(item => item.id === this.selected);
    if (!region || this.dialog.pending) return;
    if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Delete' || event.key === 'Backspace') { this.remove(); return; }
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    region.x = Math.max(0, Math.min(this.width - region.width, region.x + dx));
    region.y = Math.max(0, Math.min(this.height - region.height, region.y + dy));
    this.emit(); this.paint(); this.regionPanel();
  }
  regionPanel() {
    const panel = this.dialog.bodyElement?.querySelector('[data-layer-region-panel]'); if (!panel) return;
    const region = this.state.regions.find(item => item.id === this.selected);
    panel.innerHTML = this.state.regions.length ? `<ic-select name="layer-region" label="${escape(this.t('selectedRegion'))}" value="${escape(this.selected)}">${this.state.regions.map((item,index) => `<option value="${escape(item.id)}"${item.id === this.selected ? ' selected' : ''}>${escape(this.t('regionNumber', {number:index + 1}))}</option>`).join('')}</ic-select>
      ${region ? `<div data-layer-coordinates>${['x','y','width','height'].map(key => `<ic-number-input data-layer-coordinate="${key}" name="layer-coordinate-${key}" size="small" label="${escape(this.t(key))}" value="${Math.round(region[key])}" step="any"></ic-number-input>`).join('')}</div>
      <ic-input name="layer-description" label="${escape(this.t('description'))}" placeholder="${escape(this.t('descriptionHint'))}" value="${escape(region.description)}"></ic-input>
      <ic-button data-layer-delete hierarchy="quiet" size="small">${escape(this.t('delete'))}</ic-button>` : ''}` : '';
    const signal = this.abort.signal;
    panel.querySelector('[name="layer-region"]')?.addEventListener('change', event => { this.selected = event.currentTarget.value; this.paint(); this.regionPanel(); }, {signal});
    panel.querySelector('[name="layer-description"]')?.addEventListener('input', event => { region.description = inputValue(event); this.emit(); }, {signal});
    panel.querySelector('[data-layer-delete]')?.addEventListener('click', () => this.remove(), {signal});
    panel.querySelectorAll('[data-layer-coordinate]').forEach(input => {
      const update = (final, value = input.value) => {
        const key = input.dataset.layerCoordinate;
        const next = {...region, [key]:String(value).trim() ? Number(value) : NaN};
        if (!normalizedBBox(next, this.state.sourceWidth, this.state.sourceHeight)) {
          if (final) { input.value = String(Math.round(region[key])); this.dialog.setError(this.t('invalidRegion')); }
          return;
        }
        if (region[key] === next[key]) return;
        region[key] = next[key]; this.dialog.setError(''); this.emit(); this.paint();
      };
      input.addEventListener('input', event => update(false, inputValue(event)), {signal});
      input.addEventListener('change', () => update(true), {signal});
      input.addEventListener('focusout', () => update(true), {signal});
    });
    this.sync();
  }
  sync() {
    const body = this.dialog.bodyElement; if (!body) return;
    this.dialog.prompt = this.prompt();
    const status = body.querySelector('[data-layer-status]'); if (status) status.textContent = this.reason();
    const preview = body.querySelector('[data-layer-prompt-preview]'); if (preview) preview.textContent = this.dialog.prompt;
    const retry = body.querySelector('[data-layer-retry]'); if (retry) retry.hidden = !this.failed;
    const add = body.querySelector('[data-layer-add]'); if (add) add.disabled = this.dialog.pending || !this.loaded || Boolean(this.stale()) || !this.dialog.currentModel()?.supportsLayerRegions;
    const clear = body.querySelector('[data-layer-clear]'); if (clear) clear.disabled = this.dialog.pending || !this.state.regions.length;
    if (this.canvas) this.canvas.disabled = this.dialog.pending || this.state.mode !== 'regions' || !this.loaded || Boolean(this.stale()) || !this.dialog.currentModel()?.supportsLayerRegions;
    this.dialog.syncActions();
  }
  dispose() {
    if (this.gesture) this.state = clone(this.gesture);
    this.gesture = null; this.abort?.abort(); this.observer?.disconnect(); this.canvas = null;
  }
}
